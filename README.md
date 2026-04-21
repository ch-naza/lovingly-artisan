# Lovingly Artisan – Intelligent Bread Recommendation  

A small‑scale e‑commerce website that helps shoppers find the perfect loaf or pastry using a **weighted‑score engine** and a **local Llama 3.2 3B model** (Ollama).

---  

## What’s inside  

| Folder / file | Content |
|---------------|----------|
| `data/products.json` | 45 breads & pastries with dietary, health‑goal, occasion & style tags, also nutritional information |
| `public/` | Static front‑end: `index.html`, `shop.html`, `style.css`, `script.js`, plus product images |
| `routes/recommend.js` | Recommendation endpoint (`POST /api/recommend`) |
| `server.js` | Express server – serves static files and API (`/api/products`, `/api/recommend`, `/api/chat`) |
| `package.json` | npm dependencies (`express`, `cors`) and start script |

---  

## Prerequisites

| Tool | Minimum version |
|------|-----------------|
| Node.js | 18.x |
| npm | any recent release |
| Ollama | latest (download from https://ollama.com) |
| Llama model | `llama3.2:3b` |

---  

## Setup & run  

```bash
# 1. Install Node deps
npm install

# 2. Pull the Llama model (only done once)
ollama pull llama3.2:3b

# 3. Start the server
npm start          # http://localhost:3000
```

Navigate to:  **http://localhost:3000** :-D

---  

## How to use

1. **Shop page** – browse the full product grid, filter by category if you wish.  
2. **Find My Bread** – click the floating ★ button, fill any combination of:  
   * dietary check‑boxes (vegan, gluten‑free, …)  
   * health‑goal check‑boxes (weight‑loss, energy, …)  
   * occasion dropdown (daily, gifting, …)  
   * optional free‑text description (e.g., “light crust for breakfast”).  
   Press **Get Recommendations** → the top‑3 items are highlighted in the grid and shown in the results panel.  
3. **Chat** – click the **CHAT** tab on the right, type a request, and the assistant replies while highlighting matching products.  
4. **Cart** – add any highlighted product to the temporary cart; the badge updates and the side‑panel shows total price.  

---  

## License  

MIT – free for research, teaching and personal use.