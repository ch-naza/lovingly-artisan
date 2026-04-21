/*
  script.js – client logic for the shop page
  -------------------------------------------------
  - fetches `/api/products` and renders product cards into #productsgrid
  - implements category filtering, product‑modal details and cart state
  - handles the recommendation form (POST /api/recommend) and highlights results
  - includes scroll‑to‑top button, validation and UI toast messages
  -------------------------------------------------
*/

/* -------------------------------------------------
   category helper – works out which filter bucket a product belongs to
   ------------------------------------------------- */
function getCategory(product) {
  const name = product.name.toLowerCase()
  const categories = []

  if (name.includes('gift') || name.includes('hamper') || name.includes('assorted'))
    categories.push('gifting')
  if (
    name.includes('croissant') ||
    name.includes('pain') ||
    name.includes('brioche') ||
    name.includes('assorted') ||
    name.includes('pastry')
  )
    categories.push('pastry')
  if (name.includes('focaccia') || name.includes('flatbread') || name.includes('naan') || name.includes('cornbread'))
    categories.push('flatbread')
  if (name.includes('brownie') || name.includes('cookie') || name.includes('gingerbread') || name.includes('muffin'))
    categories.push('sweet')
  if (
    categories.length === 0 ||
    name.includes('sourdough') ||
    name.includes('rye') ||
    name.includes('spelt') ||
    name.includes('multigrain') ||
    name.includes('pumpernickel') ||
    name.includes('loaf') ||
    name.includes('bagel')
  )
    categories.push('sourdough')

  return categories.join(' ')
}

/* -------------------------------------------------
   filter logic – initialise once and apply active filter
   ------------------------------------------------- */
let filtersInitialised = false // prevent duplicate listeners

function setupFilters() {
  if (filtersInitialised) {
    applyActiveFilter()
    return
  }

  const buttons = document.querySelectorAll('.filter-btn')
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active')) // clear all active states
      btn.classList.add('active') // set clicked button as active
      applyActiveFilter() // update visible cards
    })
  })

  filtersInitialised = true
}

function applyActiveFilter() {
  const activeBtn = document.querySelector('.filter-btn.active')
  const filter = activeBtn ? activeBtn.dataset.filter : 'all'
  const cards = document.querySelectorAll('.product-card')
  cards.forEach(card => {
    if (filter === 'all' || card.dataset.category.includes(filter)) {
      card.style.display = 'block'
    } else {
      card.style.display = 'none'
    }
  })
}

/* -------------------------------------------------
   load products – fetch catalogue, render grid and store data for modals
   ------------------------------------------------- */
let allProducts = [] // used by the product modal and cart

async function loadProducts(highlightIds = []) {
  const grid = document.getElementById('productsGrid')
  if (!grid) return // safety: page without a grid (e.g. home page)

  try {
    const response = await fetch('/api/products')
    const data = await response.json()
    allProducts = data.products // keep a copy for the modal

    grid.innerHTML = data.products
      .map(product => `
        <div class="product-card ${highlightIds.includes(product.id) ? 'highlighted' : ''}"
             id="product-${product.id}"
             data-category="${getCategory(product)}"
             onclick="openProductModal(${product.id})">
          <img src="${product.image}" alt="${product.name}" onerror="this.src='images/placeholder.jpg'">
          <div class="card-body">
            <div class="dietary-tags">
              ${product.dietary
                .map(tag => `<span class="tag tag-${tag.replace('-', '')}">${tag}</span>`)
                .join('')}
            </div>
            <h3>${product.name}</h3>
            <p>${product.description}</p>
            <div class="price">£${product.price.toFixed(2)}</div>
          </div>
        </div>
      `)
      .join('')

    // initialise filter buttons now that the cards exist
    setupFilters()
  } catch (error) {
    console.error('could not load products:', error)
    grid.innerHTML =
      '<p style="color:#8a7060;">unable to load products. make sure the server is running.</p>'
  }
}

// initial load when the page starts
loadProducts()

/* -------------------------------------------------
   recommendation form – submit request and show results
   ------------------------------------------------- */
const submitBtn = document.getElementById('submitBtn')
if (submitBtn) {
  submitBtn.addEventListener('click', async () => {
    // disable while we wait for the back‑end
    submitBtn.disabled = true
    submitBtn.textContent = 'finding…'

    // gather user input
    const freeText = document.getElementById('freeText').value.trim()
    const dietary = Array.from(
      document.querySelectorAll('input[name="dietary"]:checked')
    ).map(i => i.value)
    const goals = Array.from(
      document.querySelectorAll('input[name="goals"]:checked')
    ).map(i => i.value)
    const occasion = document.getElementById('occasion').value

    // must have at least one piece of input
    if (!freeText && dietary.length === 0 && goals.length === 0 && !occasion) {
      submitBtn.disabled = false
      submitBtn.textContent = 'get recommendations'
      showValidationError(
        "please describe what you're looking for, or select at least one option below."
      )
      return
    }

    // UI feedback while we wait
    document.getElementById('loading').style.display = 'block'
    document.getElementById('results').style.display = 'none'

    try {
      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dietary, goals, occasion, freeText })
      })
      const data = await response.json()
      document.getElementById('loading').style.display = 'none'

      if (data.success && data.recommendations.length > 0) {
        // highlight the recommended products in the grid
        const highlightIds = data.recommendations.map(r => r.id)
        document.querySelectorAll('.product-card').forEach(card => {
          const id = parseInt(card.id.replace('product-', ''), 10)
          card.classList.toggle('highlighted', highlightIds.includes(id))
        })

        // render the recommendation list in the side panel
        document.getElementById('recommendations').innerHTML = data.recommendations
          .map(product => `
            <div class="result-card">
              <h4>${product.name}</h4>
              <p>${product.description}</p>
              <div class="price">£${product.price.toFixed(2)}</div>
              <button class="submit-btn rec-add-btn" type="button" data-id="${product.id}">
                add to cart
              </button>
            </div>
          `)
          .join('')
        document.getElementById('results').style.display = 'block'

        // bind the dynamically added add‑to‑cart buttons
        document.querySelectorAll('.rec-add-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id, 10)
            if (!Number.isNaN(id)) {
              addToCart(id)
              btn.textContent = 'added ✓'
              btn.disabled = true
              setTimeout(() => {
                btn.textContent = 'add to cart'
                btn.disabled = false
              }, 1200)
            }
          })
        })
      } else {
        // no matches – gentle hint
        document.getElementById('recommendations').innerHTML = `
          <p style="color:#5a4a40; font-size:13px; font-family:'Lato',sans-serif;">
            no exact matches found. try adjusting your preferences.
          </p>
        `
        document.getElementById('results').style.display = 'block'
      }
    } catch (error) {
      console.error('error:', error)
      document.getElementById('loading').style.display = 'none'
      alert('something went wrong. make sure ollama is running.')
    } finally {
      // re‑enable button
      submitBtn.disabled = false
      submitBtn.textContent = 'get recommendations'
    }
  })
}

// show a temporary validation error beneath the submit button
function showValidationError(message) {
  let error = document.getElementById('validationError')
  if (!error) {
    error = document.createElement('p')
    error.id = 'validationError'
    error.style.cssText =
      'color:#c0392b; font-size:12px; font-family:Lato,sans-serif; margin-top:8px;'
    document.getElementById('submitBtn').insertAdjacentElement('afterend', error)
  }
  error.textContent = message
  setTimeout(() => {
    error.textContent = ''
  }, 4000)
}

/* -------------------------------------------------
   floating chat tab + panel (replaces modal chat)
   ------------------------------------------------- */
function setupFloatingChat() {
  const chatTab = document.getElementById('chatTab')
  const chatPanel = document.getElementById('chatPanel')
  const closeBtn = document.getElementById('closeChatPanel')
  const sendBtn = document.getElementById('chatPanelSend')
  const input = document.getElementById('chatPanelInput')
  const messages = document.getElementById('chatPanelMessages')

  if (!chatTab || !chatPanel) return

  // conversation history – kept locally for context
  let conversationHistory = []

  // open / close panel
  chatTab.addEventListener('click', () => chatPanel.classList.add('active'))
  closeBtn.addEventListener('click', () => chatPanel.classList.remove('active'))

  // helper: add a message bubble
  function addPanelMessage(role, text, isHtml = false) {
    const msg = document.createElement('div')
    msg.className = `chat-message ${role}`
    if (isHtml) msg.innerHTML = text
    else msg.textContent = text
    messages.appendChild(msg)
    messages.scrollTop = messages.scrollHeight
  }

  // send a message to the back‑end
  async function sendPanelMessage() {
    const txt = input.value.trim()
    if (!txt) return

    addPanelMessage('user', txt)
    conversationHistory.push({ role: 'user', text: txt })
    input.value = ''
    addPanelMessage('bot', 'thinking...')

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: txt, history: conversationHistory })
      })
      const data = await resp.json()

      // replace the placeholder
      const thinking = messages.lastElementChild
      if (thinking && thinking.textContent === 'thinking...') thinking.remove()

      const botText = data.response || 'i had trouble thinking that through. please try again!'
      addPanelMessage('bot', botText)
      conversationHistory.push({ role: 'bot', text: botText })

      // highlight any products the bot mentioned
      if (data.recommendations && data.recommendations.length) {
        const ids = data.recommendations.map(r => r.id)
        document.querySelectorAll('.product-card').forEach(card => {
          const id = parseInt(card.id.replace('product-', ''), 10)
          card.classList.toggle('highlighted', ids.includes(id))
        })

        const recList = data.recommendations
          .map(p => `<strong>${p.name}</strong> (£${p.price.toFixed(2)})`)
          .join('<br>')
        addPanelMessage('bot', recList, true)
      }
    } catch (e) {
      console.error('chat error', e)
      const thinking = messages.lastElementChild
      if (thinking && thinking.textContent === 'thinking...') thinking.remove()
      addPanelMessage('bot', 'oops something went wrong. please try again later.')
    }
  }

  // bind UI events
  sendBtn?.addEventListener('click', sendPanelMessage)
  input?.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      sendPanelMessage()
    }
  })
}

// initialise the chat when the DOM is ready
document.addEventListener('DOMContentLoaded', setupFloatingChat)

/* -------------------------------------------------
   modal open / close – product detail overlay
   ------------------------------------------------- */
const openModal = document.getElementById('openModal')
const closeModal = document.getElementById('closeModal')
const modalOverlay = document.getElementById('modalOverlay')

if (openModal) {
  openModal.addEventListener('click', () => modalOverlay.classList.add('active'))
}
if (closeModal) {
  closeModal.addEventListener('click', () => modalOverlay.classList.remove('active'))
}
if (modalOverlay) {
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) modalOverlay.classList.remove('active')
  })
}

/* -------------------------------------------------
   back‑to‑top button
   ------------------------------------------------- */
const backToTop = document.getElementById('backToTop')
window.addEventListener('scroll', () => {
  if (window.scrollY > 400) backToTop.classList.add('visible')
  else backToTop.classList.remove('visible')
})
if (backToTop) {
  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

/* -------------------------------------------------
   product modal – populate dynamic content
   ------------------------------------------------- */
function openProductModal(id) {
  const product = allProducts.find(p => p.id === id)
  if (!product) return

  document.getElementById('pm-image').src = product.image
  document.getElementById('pm-image').alt = product.name
  document.getElementById('pm-name').textContent = product.name
  document.getElementById('pm-description').textContent = product.description
  document.getElementById('pm-price').textContent = `£${product.price.toFixed(2)}`
  document.getElementById('pm-add-btn').dataset.id = product.id

  // dietary tags
  document.getElementById('pm-tags').innerHTML = product.dietary
    .map(tag => `<span class="tag tag-${tag.replace('-', '')}">${tag}</span>`)
    .join('')

  // health goals
  const goalsContainer = document.getElementById('pm-goals')
  if (product.goals.length) {
    goalsContainer.innerHTML = `<span class="pm-label">good for:</span> ${product.goals
      .map(g => `<span class="pm-goal">${g.replace('-', ' ')}</span>`)
      .join('')}`
  } else {
    goalsContainer.innerHTML = ''
  }

  // occasions
  document.getElementById('pm-occasion').innerHTML = `<span class="pm-label">occasion:</span> ${product.occasion
    .map(o => `<span class="pm-goal">${o}</span>`)
    .join('')}`

  document.getElementById('productModalOverlay').classList.add('active')
}

function closeProductModal() {
  document.getElementById('productModalOverlay').classList.remove('active')
}

// click outside the modal to close it
document
  .getElementById('productModalOverlay')
  ?.addEventListener('click', e => {
    if (e.target === document.getElementById('productModalOverlay')) closeProductModal()
  })

/* -------------------------------------------------
   cart handling
   ------------------------------------------------- */
let cart = []

function addToCart(id) {
  const product = allProducts.find(p => p.id === id)
  if (!product) return

  const existing = cart.find(item => item.id === id)
  if (existing) existing.qty += 1
  else cart.push({ ...product, qty: 1 })

  updateCartCount()
  closeProductModal()
  showCartToast(`${product.name} added to cart`)
}

function updateCartCount() {
  const total = cart.reduce((sum, item) => sum + item.qty, 0)
  const badge = document.getElementById('cartCount')
  if (badge) {
    badge.textContent = total
    badge.style.display = total > 0 ? 'flex' : 'none'
  }
}

function showCartToast(message) {
  const toast = document.getElementById('cartToast')
  if (!toast) return
  toast.textContent = message
  toast.classList.add('visible')
  setTimeout(() => toast.classList.remove('visible'), 3000)
}

/* -------------------------------------------------
   cart side‑panel toggle
   ------------------------------------------------- */
function toggleCart() {
  const panel = document.getElementById('cartPanel')
  const overlay = document.getElementById('cartOverlay')
  if (panel) panel.classList.toggle('active')
  if (overlay) overlay.classList.toggle('active')
  updateCartPanel()
}
function closeCart() {
  const panel = document.getElementById('cartPanel')
  const overlay = document.getElementById('cartOverlay')
  if (panel) panel.classList.remove('active')
  if (overlay) overlay.classList.remove('active')
}

/* -------------------------------------------------
   cart panel UI – render items, totals, removal, qty changes
   ------------------------------------------------- */
function updateCartPanel() {
  const container = document.getElementById('cartItems')
  const footer = document.getElementById('cartFooter')
  if (!container || !footer) return

  if (cart.length === 0) {
    container.innerHTML = '<p class="cart-empty">Your cart is empty.</p>'
    footer.style.display = 'none'
    return
  }

  footer.style.display = 'block'
  container.innerHTML = cart
    .map(item => `
      <div class="cart-item">
        <img src="${item.image}" alt="${item.name}" onerror="this.src='images/placeholder.jpg'">
        <div class="cart-item-info">
          <h4>${item.name}</h4>
          <p>£${item.price.toFixed(2)} each</p>
          <div class="cart-item-qty">
            <button onclick="updateQty(${item.id}, -1)">−</button>
            <span>${item.qty}</span>
            <button onclick="updateQty(${item.id}, 1)">+</button>
          </div>
        </div>
        <div class="cart-item-right">
          <span class="cart-item-total">£${(item.price * item.qty).toFixed(2)}</span>
          <button class="cart-item-remove" onclick="removeFromCart(${item.id})">✕</button>
        </div>
      </div>
    `)
    .join('')

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0)
  document.getElementById('cartTotal').textContent = `£${total.toFixed(2)}`
}

function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id)
  updateCartCount()
  updateCartPanel()
}
function updateQty(id, change) {
  const item = cart.find(i => i.id === id)
  if (!item) return
  item.qty += change
  if (item.qty <= 0) {
    removeFromCart(id)
    return
  }
  updateCartCount()
  updateCartPanel()
}
