/*
  script.js — Client logic for the shop page.
  - Fetches `/api/products` and renders product cards into `#productsGrid`.
  - Implements filtering by category, product modal details, and cart state.
  - Handles recommendation form: POSTs form data to `/api/recommend` and updates highlights.
  - Includes scroll-to-top button, validation, and UI toast messages.
*/

// -------------------------------------------------------
// CATEGORY HELPER
// -------------------------------------------------------
function getCategory(product) {
  const name = product.name.toLowerCase();
  const categories = [];

  if (name.includes('gift') || name.includes('hamper') || name.includes('assorted')) categories.push('gifting');
  if (name.includes('croissant') || name.includes('pain') || name.includes('brioche') || 
      name.includes('assorted') || name.includes('pastry')) categories.push('pastry');
  if (name.includes('focaccia') || name.includes('flatbread') || name.includes('naan') || 
      name.includes('cornbread')) categories.push('flatbread');
  if (name.includes('brownie') || name.includes('cookie') || name.includes('gingerbread') || 
      name.includes('muffin')) categories.push('sweet');
  if (categories.length === 0 || name.includes('sourdough') || name.includes('rye') || 
      name.includes('spelt') || name.includes('multigrain') || name.includes('pumpernickel') || 
      name.includes('loaf') || name.includes('bagel')) categories.push('sourdough');

  return categories.join(' ');
}


// -------------------------------------------------------
// FILTER LOGIC
// -------------------------------------------------------
let filtersInitialised = false; // prevent duplicate event listeners

function setupFilters() {
  if (filtersInitialised) {
    applyActiveFilter(); // just reapply filter if already set up
    return;
  }

  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active')); // clear all active states
      btn.classList.add('active'); // set clicked button as active
      applyActiveFilter(); // update visible cards
    });
  });

  filtersInitialised = true; // mark as initialised
}

function applyActiveFilter() {
  const activeBtn = document.querySelector('.filter-btn.active');
  const filter = activeBtn ? activeBtn.dataset.filter : 'all'; // get filter type
  const cards = document.querySelectorAll('.product-card');
  cards.forEach(card => {
    if (filter === 'all' || card.dataset.category.includes(filter)) {
      card.style.display = 'block'; // show matching cards
    } else {
      card.style.display = 'none'; // hide non-matching cards
    }
  });
}


// -------------------------------------------------------
// LOAD PRODUCTS INTO GRID
// -------------------------------------------------------
async function loadProducts(highlightIds = []) {
  const grid = document.getElementById('productsGrid');
  if (!grid) return; // exit if grid element missing

  try {
    const response = await fetch('/api/products'); // fetch product data
    const data = await response.json(); // parse json response

    // build html for each product
    grid.innerHTML = data.products.map(product => `
    <div class="product-card ${highlightIds.includes(product.id) ? 'highlighted' : ''}" 
        id="product-${product.id}"
        data-category="${getCategory(product)}"
        onclick="openProductModal(${product.id})">
        <img src="${product.image}" alt="${product.name}" onerror="this.src='images/placeholder.jpg'">
        <div class="card-body">
        <div class="dietary-tags">
            ${product.dietary.map(tag => `<span class="tag tag-${tag.replace('-', '')}">${tag}</span>`).join('')}
        </div>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <div class="price">£${product.price.toFixed(2)}</div>
        </div>
    </div>
    `).join('');

    // wire up filters after grid renders
    setupFilters();

  } catch (error) {
    console.error('Could not load products:', error); // log fetch error
    grid.innerHTML = '<p style="color:#8a7060;">Unable to load products. Make sure the server is running.</p>'; // show error message
  }
}

// load products on page start
loadProducts();


// -------------------------------------------------------
// RECOMMENDATION FORM SUBMISSION
// -------------------------------------------------------
const submitBtn = document.getElementById('submitBtn');
if (submitBtn) {
  submitBtn.addEventListener('click', async () => {
    // disable button while processing
    submitBtn.disabled = true;
    submitBtn.textContent = 'Finding…';

    // collect form data
    const freeText = document.getElementById('freeText').value.trim();
    const dietary = Array.from(document.querySelectorAll('input[name="dietary"]:checked')).map(i => i.value);
    const goals = Array.from(document.querySelectorAll('input[name="goals"]:checked')).map(i => i.value);
    const occasion = document.getElementById('occasion').value;

    // validate at least one input provided
    if (!freeText && dietary.length === 0 && goals.length === 0 && !occasion) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Get Recommendations';
    showValidationError('Please describe what you\'re looking for, or select at least one option below.');
    return;
    }

    // show loading, hide results
    document.getElementById('loading').style.display = 'block';
    document.getElementById('results').style.display = 'none';

    try {
      // send recommendation request
      const response = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dietary, goals, occasion, freeText })
      });

      const data = await response.json();
      document.getElementById('loading').style.display = 'none';

          if (data.success && data.recommendations.length > 0) {
        // highlight recommended products
        const highlightIds = data.recommendations.map(r => r.id);
        document.querySelectorAll('.product-card').forEach(card => {
          const id = parseInt(card.id.replace('product-', ''), 10);
          if (highlightIds.includes(id)) {
            card.classList.add('highlighted');
          } else {
            card.classList.remove('highlighted');
          }
        });

        // show recommendation results
        document.getElementById('recommendations').innerHTML = data.recommendations.map(product => `
          <div class="result-card">
            <h4>${product.name}</h4>
            <p>${product.description}</p>
            <div class="price">£${product.price.toFixed(2)}</div>
            <button class="submit-btn rec-add-btn" type="button" data-id="${product.id}">Add to Cart</button>
          </div>
        `).join('');
        document.getElementById('results').style.display = 'block';

        // wire up recommendation 'add to cart' buttons (for dynamic elements)
        document.querySelectorAll('.rec-add-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id, 10);
            if (!Number.isNaN(id)) {
              addToCart(id);
              btn.textContent = 'Added ✓';
              btn.disabled = true;
              setTimeout(() => {
                btn.textContent = 'Add to Cart';
                btn.disabled = false;
              }, 1200);
            }
          });
        });
      } else {
        // show no results message
        document.getElementById('recommendations').innerHTML = `
          <p style="color:#5a4a40; font-size:13px; font-family:'Lato',sans-serif;">
            No exact matches found. Try adjusting your preferences.
          </p>
        `;
        document.getElementById('results').style.display = 'block';
      }

    } catch (error) {
      console.error('Error:', error);
      document.getElementById('loading').style.display = 'none';
      alert('Something went wrong. Make sure Ollama is running.');
    } finally {
      // re-enable button
      submitBtn.disabled = false;
      submitBtn.textContent = 'Get Recommendations';
    }
  });
}

// show temporary validation error
function showValidationError(message) {
  let error = document.getElementById('validationError');
  if (!error) {
    error = document.createElement('p');
    error.id = 'validationError';
    error.style.cssText = 'color:#c0392b; font-size:12px; font-family:Lato,sans-serif; margin-top:8px;';
    document.getElementById('submitBtn').insertAdjacentElement('afterend', error);
  }
  error.textContent = message;
  setTimeout(() => { error.textContent = ''; }, 4000);
}


// -------------------------------------------------------
// FLOATING CHAT TAB + PANEL (replaces modal chat)
// -------------------------------------------------------
function setupFloatingChat() {
  const chatTab    = document.getElementById('chatTab');
  const chatPanel  = document.getElementById('chatPanel');
  const closeBtn   = document.getElementById('closeChatPanel');
  const sendBtn    = document.getElementById('chatPanelSend');
  const input      = document.getElementById('chatPanelInput');
  const messages   = document.getElementById('chatPanelMessages');

  if (!chatTab || !chatPanel) return;

  // Track conversation history for context
  let conversationHistory = [];

  // open panel
  chatTab.addEventListener('click', () => {
    chatPanel.classList.add('active');
  });

  // close panel
  closeBtn.addEventListener('click', () => {
    chatPanel.classList.remove('active');
  });

  // helper to add a message (HTML optional)
  function addPanelMessage(role, text, isHtml = false) {
    const msg = document.createElement('div');
    msg.className = `chat-message ${role}`;
    if (isHtml) msg.innerHTML = text;
    else msg.textContent = text;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  // send a chat message
  async function sendPanelMessage() {
    const txt = input.value.trim();
    if (!txt) return;

    // Add user message to history and display
    addPanelMessage('user', txt);
    conversationHistory.push({ role: 'user', text: txt });
    input.value = '';
    addPanelMessage('bot', 'Thinking...');

    try {
      // Send message with full conversation history to server
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: txt,
          history: conversationHistory
        })
      });
      const data = await resp.json();

      // Replace "Thinking..." with bot response
      const thinking = messages.lastElementChild;
      if (thinking && thinking.textContent === 'Thinking...') thinking.remove();

      // Add bot response to history and display
      const botText = data.response || 'I had trouble thinking that through. Please try again!';
      addPanelMessage('bot', botText);
      conversationHistory.push({ role: 'bot', text: botText });

      // Show recommendations (if any)
      if (data.recommendations && data.recommendations.length) {
        const ids = data.recommendations.map(r => r.id);
        document.querySelectorAll('.product-card').forEach(card => {
          const id = parseInt(card.id.replace('product-', ''), 10);
          card.classList.toggle('highlighted', ids.includes(id));
        });

        const recList = data.recommendations.map(p =>
          `<strong>${p.name}</strong> (£${p.price.toFixed(2)})`).join('<br>');
        addPanelMessage('bot', recList, true);
      }
    } catch (e) {
      console.error('chat error', e);
      const thinking = messages.lastElementChild;
      if (thinking && thinking.textContent === 'Thinking...') thinking.remove();
      addPanelMessage('bot', 'Oops something went wrong. Please try again later.');
    }
  }

  // event listeners
  sendBtn?.addEventListener('click', sendPanelMessage);
  input?.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendPanelMessage();
    }
  });
}

// initialise floating chat on page load
document.addEventListener('DOMContentLoaded', setupFloatingChat);


// -------------------------------------------------------
// MODAL OPEN / CLOSE
// -------------------------------------------------------
// get modal elements
const openModal = document.getElementById('openModal');
const closeModal = document.getElementById('closeModal');
const modalOverlay = document.getElementById('modalOverlay');

// open modal when button clicked
if (openModal) {
  openModal.addEventListener('click', () => {
    modalOverlay.classList.add('active');
  });
}

// close modal when x clicked
if (closeModal) {
  closeModal.addEventListener('click', () => {
    modalOverlay.classList.remove('active');
  });
}

// close modal when clicking outside
if (modalOverlay) {
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove('active');
    }
  });
}


// -------------------------------------------------------
// BACK TO TOP BUTTON FUNCTIONALITY
// -------------------------------------------------------
// get back to top button
const backToTop = document.getElementById('backToTop');

// show/hide button based on scroll position
window.addEventListener('scroll', () => {
  if (window.scrollY > 400) {
    backToTop.classList.add('visible'); // show when scrolled down
  } else {
    backToTop.classList.remove('visible'); // hide when at top
  }
});

// scroll to top when clicked
if (backToTop) {
  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' }); // smooth scroll to top
  });
}


// -------------------------------------------------------
// PRODUCT MODAL
// -------------------------------------------------------
// store all products for modal access
let allProducts = [];

async function loadProducts(highlightIds = []) {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  try {
    const response = await fetch('/api/products');
    const data = await response.json();
    allProducts = data.products; // save for modal use

    grid.innerHTML = data.products.map(product => `
      <div class="product-card ${highlightIds.includes(product.id) ? 'highlighted' : ''}" 
           id="product-${product.id}"
           data-category="${getCategory(product)}"
           onclick="openProductModal(${product.id})">
        <img src="${product.image}" alt="${product.name}" onerror="this.src='images/placeholder.jpg'">
        <div class="card-body">
          <div class="dietary-tags">
            ${product.dietary.map(tag => `<span class="tag tag-${tag.replace('-', '')}">${tag}</span>`).join('')}
          </div>
          <h3>${product.name}</h3>
          <p>${product.description}</p>
          <div class="price">£${product.price.toFixed(2)}</div>
        </div>
      </div>
    `).join('');

    setupFilters();

  } catch (error) {
    console.error('Could not load products:', error);
    grid.innerHTML = '<p style="color:#8a7060;">Unable to load products. Make sure the server is running.</p>';
  }
}

// populate and show product modal
function openProductModal(id) {
  const product = allProducts.find(p => p.id === id);
  if (!product) return; // product not found

  // set modal content
  document.getElementById('pm-image').src = product.image;
  document.getElementById('pm-image').alt = product.name;
  document.getElementById('pm-name').textContent = product.name;
  document.getElementById('pm-description').textContent = product.description;
  document.getElementById('pm-price').textContent = `£${product.price.toFixed(2)}`;
  document.getElementById('pm-add-btn').dataset.id = product.id;

  // render dietary tags
  const tagsContainer = document.getElementById('pm-tags');
  tagsContainer.innerHTML = product.dietary.map(tag =>
    `<span class="tag tag-${tag.replace('-', '')}">${tag}</span>`
  ).join('');

  // render health goals
  const goalsContainer = document.getElementById('pm-goals');
  if (product.goals.length > 0) {
    goalsContainer.innerHTML = `<span class="pm-label">Good for:</span> ${product.goals.map(g =>
      `<span class="pm-goal">${g.replace('-', ' ')}</span>`
    ).join('')}`;
  } else {
    goalsContainer.innerHTML = '';
  }

  // render occasions
  const occasionContainer = document.getElementById('pm-occasion');
  occasionContainer.innerHTML = `<span class="pm-label">Occasion:</span> ${product.occasion.map(o =>
    `<span class="pm-goal">${o}</span>`
  ).join('')}`;

  // show modal
  document.getElementById('productModalOverlay').classList.add('active');
}

// hide product modal
function closeProductModal() {
  document.getElementById('productModalOverlay').classList.remove('active');
}

// close modal when clicking outside
document.getElementById('productModalOverlay')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('productModalOverlay')) {
    closeProductModal();
  }
});


// -------------------------------------------------------
// CART
// -------------------------------------------------------
let cart = [];

function addToCart(id) {
  // find product by id
  const product = allProducts.find(p => p.id === id);
  // exit if not found
  if (!product) return;
  // check if already in cart
  const existing = cart.find(item => item.id === id);
  if (existing) {
    // increase quantity
    existing.qty += 1;
  } else {
    // add new item
    cart.push({ ...product, qty: 1 });
  }
  // update cart badge
  updateCartCount();
  // close product modal
  closeProductModal();
  // show success message
  showCartToast(`${product.name} added to cart`);
}

function updateCartCount() {
  // sum all quantities
  const total = cart.reduce((sum, item) => sum + item.qty, 0);
  // get cart badge element
  const badge = document.getElementById('cartCount');
  if (badge) {
    // set badge text
    badge.textContent = total;
    // show/hide badge
    badge.style.display = total > 0 ? 'flex' : 'none';
  }
}

function showCartToast(message) {
  // get toast element
  const toast = document.getElementById('cartToast');
  // exit if not found
  if (!toast) return;
  // set message text
  toast.textContent = message;
  // show toast
  toast.classList.add('visible');
  // hide after 3 seconds
  setTimeout(() => toast.classList.remove('visible'), 3000);
}


// -------------------------------------------------------
// CART PANEL TOGGLE
// -------------------------------------------------------
function toggleCart() {
  // get panel and overlay elements
  const panel = document.getElementById('cartPanel');
  const overlay = document.getElementById('cartOverlay');
  // toggle visibility classes
  if (panel) panel.classList.toggle('active');
  if (overlay) overlay.classList.toggle('active');
  // refresh panel content
  updateCartPanel();
}

function closeCart() {
  // get panel and overlay elements
  const panel = document.getElementById('cartPanel');
  const overlay = document.getElementById('cartOverlay');
  // hide panel and overlay
  if (panel) panel.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
}

function updateCartPanel() {
  // get container and footer elements
  const container = document.getElementById('cartItems');
  const footer = document.getElementById('cartFooter');
  
  // exit if elements missing
  if (!container || !footer) return;

  // show empty message if no items
  if (cart.length === 0) {
    container.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    footer.style.display = 'none';
    return;
  }

  // show footer
  footer.style.display = 'block';

  // render cart items html
  container.innerHTML = cart.map(item => `
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
  `).join('');

  // calculate total price
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  // update total display
  document.getElementById('cartTotal').textContent = `£${total.toFixed(2)}`;
}

function removeFromCart(id) {
  // remove item from cart array
  cart = cart.filter(item => item.id !== id);
  // update badge count
  updateCartCount();
  // refresh panel display
  updateCartPanel();
}

function updateQty(id, change) {
  // find cart item
  const item = cart.find(i => i.id === id);
  // exit if not found
  if (!item) return;
  // change quantity
  item.qty += change;
  // remove if quantity zero or less
  if (item.qty <= 0) {
    removeFromCart(id);
    return;
  }
  // update badge and panel
  updateCartCount();
  updateCartPanel();
}