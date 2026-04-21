/*
  server.js – express backend for Lovingly Artisan
  -------------------------------------------------
  - serves static assets from the /public folder
  - GET  /api/products   → returns the full product catalogue (data/products.json)
  - POST /api/chat       → ollama‑powered conversational assistant (history support)
  - POST /api/recommend  → delegates to routes/recommend.js (keyword + AI fallback)
  -------------------------------------------------
*/

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

/* -------------------------------------------------
   utility: levenshtein similarity (0.0 to 1.0)
   used for fuzzy product matching in the chat
------------------------------------------------- */
/**
 * return a similarity score between 0 and 1.
 * the score is based on the levenshtein edit distance between the two strings.
 * a value of 1 means the strings are identical, 0 means they share no characters.
 *
 * @param {string} str1  first string
 * @param {string} str2  second string
 * @returns {number} similarity (0‑1)
 */
function similarity(str1, str2) {
  // pick the longer and shorter strings – the longer one determines the normaliser
  const longer  = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  // levenshtein distance is the number of single‑character edits required
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * calculate the levenshtein edit distance between two strings.
 * the algorithm builds a matrix of costs; each cell represents the minimum
 * number of insertions, deletions or substitutions needed to transform
 * a prefix of s1 into a prefix of s2.
 *
 * @param {string} s1  first string
 * @param {string} s2  second string
 * @returns {number} edit distance
 */
function levenshteinDistance(s1, s2) {
  const costs = [];

  // initialise first row (transform empty string → prefix of s2)
  for (let k = 0; k <= s1.length; k++) costs[k] = [k];
  // initialise first column (transform prefix of s1 → empty string)
  for (let k = 0; k <= s2.length; k++) costs[0][k] = k;

  // fill the matrix
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        // no edit needed – carry over the diagonal value
        costs[i][j] = costs[i - 1][j - 1];
      } else {
        // pick the cheapest of substitution, insertion or deletion
        costs[i][j] = 1 + Math.min(
          costs[i - 1][j - 1], // substitution
          costs[i][j - 1],     // insertion
          costs[i - 1][j]      // deletion
        );
      }
    }
  }
  // bottom‑right cell holds the final distance
  return costs[s1.length][s2.length];
}


/* -------------------------------------------------
   GET /api/products – return the full catalogue
   ------------------------------------------------- */
app.get('/api/products', (req, res) => {
  // locate the json file inside the data folder
  const dataPath = path.join(__dirname, 'data', 'products.json');

  try {
    // read it synchronously (fast enough for this prototype)
    const raw = fs.readFileSync(dataPath, 'utf-8');

    // parse the json and send it to the client
    res.json(JSON.parse(raw));
  } catch (err) {
    // if anything goes wrong, log it and reply with a 500 error
    console.error('Failed to read products.json:', err);
    res.status(500).json({ error: 'Unable to load product list' });
  }
});


/* -------------------------------------------------
   post /api/chat – ollama‑powered conversational endpoint
   accepts: { message: string, history?: array }
   returns: { response: string, recommendations: array }
   ------------------------------------------------- */
app.post('/api/chat', async (req, res) => {
  // -----------------------------------------------------------------
  // 1️ - validate request – we need a message from the user
  // -----------------------------------------------------------------
  const { message, history = [] } = req.body
  if (!message) return res.status(400).json({ error: 'Message is required' })

  try {
    // -----------------------------------------------------------------
    // 2️ - load the product catalogue (needed for context & keyword look‑up)
    // -----------------------------------------------------------------
    const dataPath = path.join(__dirname, 'data', 'products.json')
    const raw      = fs.readFileSync(dataPath, 'utf-8')
    const products = JSON.parse(raw).products

    // -----------------------------------------------------------------
    // 3️ - build a plain‑text list of products for the LLM to read
    // -----------------------------------------------------------------
    const productList = products.map(p =>
      `- ${p.name}: ${p.description} (£${p.price}, dietary: ${p.dietary.join(', ')}, occasions: ${p.occasion.join(', ')})`
    ).join('\n')

    // -----------------------------------------------------------------
    // 4️ - assemble a short conversation history (last 6 exchanges)
    // -----------------------------------------------------------------
    const historyText = history
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'Customer' : 'Chef Naza'}: ${m.text}`)
      .join('\n')

    // -----------------------------------------------------------------
    // 5️ - craft the prompt that tells Ollama who Chef Naza is (AI-Chatbot modelled after me :D) and how to talk
    // -----------------------------------------------------------------
    const ollamaPrompt = `You are Chef Naza, a 21‑year‑old Black‑British (Nigerian from London) MSci (Hons) Computer Science student who just finished a 10‑week placement at Lovingly Artisan bakery.

You know the ins and outs of sourdough, artisan breads, pastries and the shop’s full range, but you speak like a relaxed London‑born girl.  
Speak like a relaxed/chill/cool Londoner: use light, everyday slang sparingly – e.g. “mate”, “innit”, “proper”, “sound”, “safe”, “big up”, “mad good”.  
Avoid profanity, overly‑formal phrasing, and any slang that feels forced (no “blud”, “yo”, etc.).  
Stay kind, helpful and professional at all times.

Keep replies short (3‑5 sentences). When you recommend a product, give its name and one useful detail, e.g. “Our Dark Rye Sourdough is proper for a hearty lunch – low‑calorie and high‑fiber”.

Product catalogue (for reference only):
${productList}

Conversation so far:
${historyText || '(no prior messages)'}

Customer: ${message}

Answer as Chef Naza, keeping to the tone and slang described above. Recommend specific breads by name if appropriate, but don't make up products.`;

    // -----------------------------------------------------------------
    // 6️ - call the local ollama server (http://localhost:11434)
    // -----------------------------------------------------------------
    const ollamaResp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:3b',
        prompt: ollamaPrompt,
        stream: false
      })
    })

    if (!ollamaResp.ok) {
      throw new Error(`ollama error: ${ollamaResp.status}`)
    }

    const ollamaData = await ollamaResp.json()
    const botResponse = (ollamaData.response || '').trim()

    // -----------------------------------------------------------------
    // 7️ - pull any product names mentioned in the LLM's reply
    // -----------------------------------------------------------------
    const recommendations = []

    for (const product of products) {
      if (botResponse.toLowerCase().includes(product.name.toLowerCase())) {
        recommendations.push(product)
      }
    }

    // -----------------------------------------------------------------
    // 8️ -  additionally, look for matches based on keywords in the
    //     original user message (dietary/goal tags)
    // -----------------------------------------------------------------
    const msgLower = message.toLowerCase()
    for (const product of products) {
      if (recommendations.find(r => r.id === product.id)) continue // avoid dupes

      const tags    = [...product.dietary, ...product.goals]
      const matches = tags.filter(t => msgLower.includes(t))
      if (matches.length) recommendations.push(product)
    }

    // -----------------------------------------------------------------
    // 9️ -  dedupe (by id) and keep only the top three
    // -----------------------------------------------------------------
    const uniqueRecs = Array.from(
      new Map(recommendations.map(r => [r.id, r])).values()
    ).slice(0, 3)

    // -----------------------------------------------------------------
    // 10️ -  send the final payload back to the front‑end
    // -----------------------------------------------------------------
    return res.json({
      response: botResponse,
      recommendations: uniqueRecs
    })
  } catch (err) {
    // -----------------------------------------------------------------
    // any error – log it and return a friendly fallback message
    // -----------------------------------------------------------------
    console.error('chat error:', err.message)
    return res.status(500).json({
      response: 'My bad, I had trouble thinking that through. Please try again!',
      recommendations: [],
      error: err.message
    })
  }
})


/* -------------------------------------------------
   POST /api/recommend – delegates to routes/recommend.js
------------------------------------------------- */
const recommendRoute = require('./routes/recommend');
app.post('/api/recommend', recommendRoute);


/* -------------------------------------------------
   server start
------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});