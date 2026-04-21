/* -------------------------------------------------
   recommend.js – recommendation endpoint for Lovingly Artisan
   -------------------------------------------------
   POST /api/recommend
   - receives: dietary[], goals[], occasion (string), freeText (string)
   - tries a fast keyword search → falls back to Ollama extraction
   - merges form + AI data, scores with dietary ×3, goals ×2, occasion ×1
   - returns the top‑3 products (or an empty list on error)
------------------------------------------------- */

// core modules
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------
//
// fetch polyfill (node insurance)
//
// ---------------------------------------------------------
let fetchFn;
if (typeof fetch === 'function') {
  fetchFn = fetch; // node ≥18
} else {
  fetchFn = (...args) => import('node-fetch')
    .then(({ default: fetch }) => fetch(...args));
}

// ---------------------------------------------------------
//
// simple sanitiser for array inputs
//
// ---------------------------------------------------------
const safeArray = arr => Array.isArray(arr)
  ? arr.map(v => String(v).toLowerCase()).filter(Boolean)
  : [];

// ---------------------------------------------------------
//
// style matching for abstract adjectives
// maps user adjectives to product style tags
//
// ---------------------------------------------------------
const adjectiveToStyles = {
  'trendy': ['trendy', 'modern', 'premium'],
  'trending': ['trendy', 'modern', 'premium'],
  'cool': ['trendy', 'modern', 'premium'],
  'sophisticated': ['trendy', 'premium', 'artisanal'],
  'artisanal': ['artisanal', 'traditional', 'wholesome'],
  'handmade': ['artisanal', 'traditional'],
  'traditional': ['traditional', 'cosy', 'artisanal'],
  'cosy': ['cosy', 'wholesome', 'traditional'],
  'cozy': ['cosy', 'wholesome', 'traditional'],
  'indulgent': ['indulgent', 'premium'],
  'decadent': ['indulgent', 'premium'],
  'luxurious': ['premium', 'indulgent'],
  'wholesome': ['wholesome', 'modern', 'artisanal'],
  'healthy': ['wholesome', 'modern'],
  'exotic': ['exotic', 'modern', 'artisanal'],
  'unique': ['exotic', 'modern', 'trendy'],
  'seasonal': ['seasonal', 'cosy'],
  'simple': ['simple', 'artisanal'],
  'classic': ['traditional', 'artisanal', 'simple'],
  'premium': ['premium', 'trendy', 'indulgent'],
  'pastry': ['pastry', 'sweet', 'indulgent'],
  'pastries': ['pastry', 'sweet', 'indulgent'],
  'patisserie': ['pastry', 'indulgent']
};

// ---------------------------------------------------------
//
// keyword search utilities
// fuzzy matching, similarity scoring, and searches
//
// ---------------------------------------------------------
// simple fuzzy match: count matching characters
const similarity = (str1, str2) => {
  const s1 = String(str1).toLowerCase();
  const s2 = String(str2).toLowerCase();
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
};

// levenshtein distance for typo tolerance
const levenshtein = (s1, s2) => {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
};

// search products by keywords (name + description + style)
const searchByKeywords = (products, freeText) => {
  if (!freeText.trim()) return [];

  const normalized = freeText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // remove punctuation
    .replace(/\s+/g, ' ')         // collapse whitespace
    .trim();

  const keywords = normalized.split(' ').filter(Boolean);
  const matches = [];

  products.forEach(product => {
    const name = product.name.toLowerCase();
    const desc = product.description.toLowerCase();
    const styles = product.style || [];
    let matchScore = 0;

    keywords.forEach(keyword => {
      const singular = keyword.endsWith('s') ? keyword.slice(0, -1) : keyword;
      const targetStyles = adjectiveToStyles[keyword] || adjectiveToStyles[singular] || [];

      // exact substring match (highest priority)
      if (name.includes(keyword) || desc.includes(keyword) || name.includes(singular) || desc.includes(singular)) {
        matchScore += 10;
      } else if (targetStyles.length > 0) {
        // check if product has any of the target styles
        const styleMatches = styles.filter(s => targetStyles.includes(s));
        if (styleMatches.length > 0) {
          matchScore += styleMatches.length * 6;
        }
      } else {
        // fuzzy match on product name
        const nameSim = similarity(keyword, name);
        const descSim = similarity(keyword, desc);
        const bestSim = Math.max(nameSim, descSim);
        
        // only count fuzzy matches above 60% similarity
        if (bestSim > 0.6) {
          matchScore += bestSim * 5;
        }
      }
    });
    
    if (matchScore > 0) {
      matches.push({ ...product, keywordScore: matchScore });
    }
  });
  
  // sort by keyword score, highest first
  return matches.sort((a, b) => b.keywordScore - a.keywordScore);
};

// -------------------------------------------------------
// RECOMMENDATION ENDPOINT
// -------------------------------------------------------
module.exports = async (req, res) => {
  try {
    console.log('\n========== RECOMMENDATION ENGINE START =========\n');

    // ---------- STEP 1: INPUT ----------
    const {
      dietary: rawDietary,
      goals: rawGoals,
      occasion: rawOccasion,
      freeText = ''
    } = req.body;

    const dietary   = safeArray(rawDietary);       // from check‑boxes
    const goals    = safeArray(rawGoals);         // from check‑boxes
    const occasion = typeof rawOccasion === 'string' ? rawOccasion.toLowerCase() : '';

    console.log('[INPUT] form data received:');
    console.log('  · dietary:', dietary.length ? dietary : '(none)');
    console.log('  · goals:',   goals.length   ? goals   : '(none)');
    console.log('  · occasion:', occasion || '(none)');
    console.log('  · freeText:', freeText ? `"${freeText}"` : '(none)\n');

    // ---------- STEP 2: LOAD PRODUCTS ----------
    const productsPath = path.join(__dirname, '..', 'data', 'products.json');
    const rawProducts  = await fs.promises.readFile(productsPath, 'utf-8');
    const { products } = JSON.parse(rawProducts);
    console.log(`[DATABASE] loaded ${products.length} products\n`);

    // ---------- STEP 3: FAST‑PATH: keyword search ----------
    let keywordMatches = [];
    if (freeText && freeText.trim() !== '') {
      console.log('[SEARCH] attempting keyword‑based search...');
      keywordMatches = searchByKeywords(products, freeText);
      console.log(`[SEARCH] found ${keywordMatches.length} keyword matches\n`);

      // ----- apply the filters to the keyword results -----
      if (keywordMatches.length) {
        const filtered = keywordMatches.filter(p => {
          // dietary – all selected tags must be present (hard constraint)
          if (dietary.length && !dietary.every(d => p.dietary.includes(d))) return false;
          // goals – at least one selected goal must be present (soft constraint)
          if (goals.length && !goals.some(g => p.goals.includes(g))) return false;
          // occasion – if chosen, product must list that occasion
          if (occasion && !p.occasion.includes(occasion)) return false;
          return true;
        });

        // if any matches survive the filter, return them (still sorted by keywordScore)
        if (filtered.length) {
          console.log('[FILTER] keyword results after applying form constraints:', filtered.length);
          const recommendations = filtered.slice(0, 3);
          console.log('========== RECOMMENDATION ENGINE END ===========\n');
          return res.json({
            success: true,
            recommendations,
            aiUsed: false,
            message: 'Found products matching your search'
          });
        }
        // otherwise fall‑through to AI extraction (or later scoring)
        console.log('[FILTER] no keyword matches passed the form constraints – will try AI fallback');
      }
    }

    // ---------- STEP 4: AI EXTRACTION (fallback) ----------
    console.log('[AI] keyword search empty or filtered out, attempting Ollama extraction...\n');
    let aiExtracted = { dietary: [], goals: [], occasion: '' };

    if (freeText && freeText.trim() !== '') {
      try {
        const ollamaResp = await fetchFn('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3.2:3b',
            prompt: `You are a bread recommendation assistant.

A customer said: "${freeText}"

Extract their preferences. Map product keywords to goals where relevant (e.g. "chocolate" → "weight-gain", "light"/"thin" → "weight-loss").

Respond ONLY with JSON in this exact format:
{
  "dietary": [],
  "goals": [],
  "occasion": ""
}

Allowed dietary values: "vegan","vegetarian","gluten-free","nut-free"
Allowed goals values: "weight-loss","weight-gain","energy","muscle-building","general-health"
Allowed occasion values: "daily","entertaining","gifting","catering"

Only output the JSON object, no extra text.`,
            stream: false,
            format: 'json'
          })
        });

        const ollamaData = await ollamaResp.json();

        const match = (ollamaData.response || '').match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          aiExtracted = {
            dietary: safeArray(parsed.dietary),
            goals:   safeArray(parsed.goals),
            occasion: typeof parsed.occasion === 'string' ? parsed.occasion.toLowerCase() : ''
          };
          console.log('[AI] extraction successful:');
          console.log('  · dietary:', aiExtracted.dietary.length ? aiExtracted.dietary : '(none)');
          console.log('  · goals:',   aiExtracted.goals.length ? aiExtracted.goals : '(none)');
          console.log('  · occasion:', aiExtracted.occasion || '(none)\n');
        }
      } catch (aiErr) {
        console.warn('[AI] ollama extraction failed:', aiErr.message, '\n');
      }
    }

    // ---------- STEP 5: MERGE FORM + AI ----------
    const allDietary = [...new Set([...dietary, ...aiExtracted.dietary])];
    const allGoals   = [...new Set([...goals,   ...aiExtracted.goals])];
    const finalOccasion = occasion || aiExtracted.occasion || '';

    console.log('[MERGE] combined preferences:');
    console.log('  · dietary:', allDietary.length ? allDietary : '(none)');
    console.log('  · goals:',   allGoals.length ? allGoals : '(none)');
    console.log('  · occasion:', finalOccasion || '(none)\n');

    // ---------- STEP 6: SCORE (fallback when keyword‑search didn’t give usable results) ----------
    const scored = products.map(p => {
      let score = 0;

      // dietary – hard constraint
      if (allDietary.length) {
        const matches = allDietary.filter(d => p.dietary.includes(d));
        score += matches.length * 3;
      }

      // health goals – soft
      if (allGoals.length) {
        const matches = allGoals.filter(g => p.goals.includes(g));
        score += matches.length * 2;
      }

      // occasion
      if (finalOccasion && p.occasion.includes(finalOccasion)) score += 1;

      return { ...p, score };
    });

    const recommendations = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    console.log('[SCORE] top 3 matches:');
    recommendations.forEach((rec, i) => {
      console.log(`  ${i + 1}. ${rec.name} (score: ${rec.score})`);
    });
    console.log('\n[RESULT] returning AI‑based recommendations');
    console.log('========== RECOMMENDATION ENGINE END ===========\n');

    res.json({
      success: true,
      recommendations,
      aiUsed: Boolean(freeText && freeText.trim()),
      message: 'Here are your top recommendations'
    });

  } catch (err) {
    console.error('\n[ERROR] recommend route failed:', err.message);
    console.log('========== RECOMMENDATION ENGINE END ===========\n');
    res.status(500).json({
      success: false,
      error: err.message,
      recommendations: []
    });
  }
};
