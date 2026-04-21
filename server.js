/*
  server.js — Express server for the Lovingly Artisan bakery.
  - Serves static files from `public`.
  - GET  /api/products   – loads product catalog.
  - POST /api/chat       – Ollama-powered conversational chat with history support.
  - POST /api/recommend  – delegates to routes/recommend.js.
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
   Utility: Levenshtein similarity (0.0 to 1.0)
   Used for fuzzy product matching in the chat
------------------------------------------------- */
function similarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(s1, s2) {
  const costs = [];
  for (let k = 0; k <= s1.length; k++) costs[k] = [k];
  for (let k = 0; k <= s2.length; k++) costs[0][k] = k;

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        costs[i][j] = costs[i - 1][j - 1];
      } else {
        costs[i][j] = 1 + Math.min(
          costs[i - 1][j - 1],
          costs[i][j - 1],
          costs[i - 1][j]
        );
      }
    }
  }
  return costs[s1.length][s2.length];
}

/* -------------------------------------------------
   GET /api/products
------------------------------------------------- */
app.get('/api/products', (req, res) => {
  const dataPath = path.join(__dirname, 'data', 'products.json');
  try {
    const raw = fs.readFileSync(dataPath, 'utf-8');
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('Failed to read products.json:', err);
    res.status(500).json({ error: 'Unable to load product list' });
  }
});

/* -------------------------------------------------
   POST /api/chat – Ollama-powered conversational endpoint
   Accepts: { message: string, history?: array }
   Returns: { response: string, recommendations: array }
------------------------------------------------- */
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    // Load products
    const dataPath = path.join(__dirname, 'data', 'products.json');
    const raw = fs.readFileSync(dataPath, 'utf-8');
    const products = JSON.parse(raw).products;

    // Build product context for Ollama
    const productList = products.map(p => 
      `- ${p.name}: ${p.description} (£${p.price}, dietary: ${p.dietary.join(', ')}, occasions: ${p.occasion.join(', ')})`
    ).join('\n');

    // Build conversation history for context
    const historyText = history
      .slice(-6) // keep last 6 messages for context
      .map(msg => `${msg.role === 'user' ? 'Customer' : 'Chef Naza'}: ${msg.text}`)
      .join('\n');

    // Call Ollama to generate conversational response
    const ollamaPrompt = `You are Chef Naza, a warm and knowledgeable bread assistant for Lovingly Artisan bakery. 
You are conversational, friendly, and helpful. You recommend breads based on customer preferences and can discuss bread characteristics.
Keep responses concise (2-3 sentences). Always be personable and use the customer's inputs to inform your recommendations.

Our bread selection:
${productList}

Previous conversation:
${historyText || '(No previous messages)'}

Customer: ${message}

Respond naturally as Chef Naza. Recommend specific breads by name if appropriate, but don't make up products.`;

    const ollamaResp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:3b',
        prompt: ollamaPrompt,
        stream: false
      })
    });

    if (!ollamaResp.ok) {
      throw new Error(`Ollama error: ${ollamaResp.status}`);
    }

    const ollamaData = await ollamaResp.json();
    const botResponse = (ollamaData.response || '').trim();

    // Extract product names from response and find matching products
    const recommendations = [];
    
    for (const product of products) {
      if (botResponse.toLowerCase().includes(product.name.toLowerCase())) {
        recommendations.push(product);
      }
    }

    // Also try to find products based on customer message keywords
    const msgLower = message.toLowerCase();
    for (const product of products) {
      if (recommendations.find(r => r.id === product.id)) continue; // skip duplicates
      
      // Check if product's dietary/goal tags match
      const tags = [...product.dietary, ...product.goals];
      const matches = tags.filter(tag => msgLower.includes(tag));
      if (matches.length > 0) {
        recommendations.push(product);
      }
    }

    // Remove duplicates and limit to 3
    const uniqueRecs = Array.from(
      new Map(recommendations.map(r => [r.id, r])).values()
    ).slice(0, 3);

    return res.json({
      response: botResponse,
      recommendations: uniqueRecs
    });

  } catch (err) {
    console.error('Chat error:', err.message);
    return res.status(500).json({
      response: 'Sorry, I had trouble thinking that through. Please try again!',
      recommendations: [],
      error: err.message
    });
  }
});

/* -------------------------------------------------
   POST /api/recommend – delegates to routes/recommend.js
------------------------------------------------- */
const recommendRoute = require('./routes/recommend');
app.post('/api/recommend', recommendRoute);

/* -------------------------------------------------
   Server start
------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
