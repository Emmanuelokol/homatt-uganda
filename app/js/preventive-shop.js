/**
 * Homatt Health — Preventive Shop
 *
 * Loads marketplace categories + items from Supabase, manages a local cart,
 * routes orders to the nearest delivery-capable pharmacy, and inserts a row
 * into `marketplace_orders` on Place Order.
 */

const SUPABASE_URL  = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ─────────────────────────────────────────────────────────────────────

let allItems       = [];
let categories     = [];
let cart           = {};            // { itemId: { item, qty } }
let selectedCatId  = 'all';
let paymentMethod  = 'cash_on_delivery';
let userProfile    = {};
let routedPharmacy = null;
let userLat        = null;
let userLon        = null;
let sessionUserId  = null;

// ── Category icon colour map ──────────────────────────────────────────────────

const CAT_ICON_COLORS = {
  'Mosquito Protection': { bg: '#E8F5E9', color: '#388E3C' },
  'Water Safety':        { bg: '#E3F2FD', color: '#1565C0' },
  'Test Kits':           { bg: '#F3E5F5', color: '#6A1B9A' },
  'Vitamins':            { bg: '#FFF3E0', color: '#E65100' },
  'Baby & Child':        { bg: '#FFF8E1', color: '#F57C00' },
  'Maternal Health':     { bg: '#FCE4EC', color: '#AD1457' },
  'First Aid':           { bg: '#FFEBEE', color: '#C62828' },
  'Hygiene':             { bg: '#E0F2F1', color: '#00695C' },
  'All':                 { bg: '#E8F5E9', color: '#1B5E20' },
};

function catStyle(name) {
  return CAT_ICON_COLORS[name] || { bg: '#F5F5F5', color: '#555' };
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Auth check
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'signin.html';
    return;
  }
  sessionUserId = session.user.id;

  // Load profile
  const { data: profile } = await sb
    .from('profiles')
    .select('first_name, last_name, phone_number, district, city')
    .eq('id', sessionUserId)
    .single();

  if (profile) {
    userProfile = profile;
    localStorage.setItem('homatt_user', JSON.stringify({
      firstName: profile.first_name,
      lastName:  profile.last_name,
      phone:     profile.phone_number,
      district:  profile.district,
      city:      profile.city,
    }));
  } else {
    const cached = JSON.parse(localStorage.getItem('homatt_user') || '{}');
    userProfile = {
      first_name:   cached.firstName,
      last_name:    cached.lastName,
      phone_number: cached.phone,
      district:     cached.district,
      city:         cached.city,
    };
  }

  await Promise.all([loadCategories(), loadItems(), loadPharmacies()]);
  renderBanner();
  renderCategories();
  renderProducts();
  loadMyOrders();
});

// ── Load Data ─────────────────────────────────────────────────────────────────

async function loadCategories() {
  const { data, error } = await sb
    .from('marketplace_categories')
    .select('id, name, icon, color, sort_order')
    .eq('active', true)
    .order('sort_order');

  if (!error && data) {
    categories = [
      { id: 'all', name: 'All', icon: 'grid_view', color: '#1B5E20' },
      ...data,
    ];
  }
}

async function loadItems() {
  const { data, error } = await sb
    .from('marketplace_items')
    .select('id, category_id, name, description, price, unit, in_stock, featured, trigger_tags')
    .eq('active', true)
    .order('sort_order');

  if (!error && data) allItems = data;
}

let pharmacies = [];

async function loadPharmacies() {
  const { data, error } = await sb
    .from('pharmacies')
    .select('id, name, address, district, city, latitude, longitude, delivery_fee, delivery_radius_km')
    .eq('active', true)
    .eq('delivery_available', true);

  if (!error && data) pharmacies = data;
}

// ── Personalised Banner ───────────────────────────────────────────────────────

const HIGH_MALARIA = ['jinja','gulu','lira','soroti','arua','hoima'];

function renderBanner() {
  const district = (userProfile.district || '').toLowerCase();
  const isMalariaHigh = HIGH_MALARIA.includes(district);

  const el = document.getElementById('personalBanner');

  // Always show malaria banner (matches screenshot)
  el.innerHTML = `
    <p class="personalised-label">
      <span class="material-icons-outlined" style="font-size:13px">shield</span>
      Personalised for your health
    </p>
    <div class="health-alert-card malaria">
      <div class="alert-row">
        <div class="alert-icon-circle">
          <span class="material-icons-outlined">warning</span>
        </div>
        <div class="alert-text">
          <h4>Malaria Season Has Started</h4>
          <p>${district ? district.charAt(0).toUpperCase() + district.slice(1) : 'Your area'} is in the ${isMalariaHigh ? 'long rains' : 'rainy'} season — high malaria risk period. Stock up on nets, repellents and test kits now before demand peaks</p>
        </div>
      </div>
      <button class="alert-cta-btn" onclick="filterByCategoryName('Mosquito Protection')">
        <span class="material-icons-outlined" style="font-size:16px">warning</span>
        Stock Up Before It Peaks
      </button>
    </div>
  `;
}

// ── Categories ────────────────────────────────────────────────────────────────

function renderCategories() {
  const wrap = document.getElementById('categoryScroll');
  wrap.innerHTML = categories.map(c => {
    const st = catStyle(c.name);
    return `
      <button
        class="cat-chip ${c.id === selectedCatId ? 'active' : ''}"
        onclick="selectCategory('${c.id}')"
        data-id="${c.id}"
        style="${c.id === selectedCatId ? '' : `--chip-icon-color:${c.color}`}"
      >
        <span class="material-icons-outlined" style="color:${c.id === selectedCatId ? '#fff' : c.color}">${c.icon}</span>
        ${c.name}
      </button>
    `;
  }).join('');
}

function selectCategory(id) {
  selectedCatId = id;
  renderCategories();
  renderProducts();
}

function filterByCategoryName(name) {
  const cat = categories.find(c => c.name === name);
  if (cat) selectCategory(cat.id);
}

// ── Products ──────────────────────────────────────────────────────────────────

function getFilteredItems() {
  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  return allItems.filter(item => {
    const matchCat = selectedCatId === 'all' || item.category_id === selectedCatId;
    const matchQ   = !query ||
      item.name.toLowerCase().includes(query) ||
      (item.description || '').toLowerCase().includes(query);
    return matchCat && matchQ;
  });
}

function filterProducts() {
  renderProducts();
}

function getCatForItem(item) {
  return categories.find(c => c.id === item.category_id) || { color: '#1B5E20', icon: 'medication' };
}

function renderProducts() {
  const grid  = document.getElementById('productsGrid');
  const items = getFilteredItems();

  if (!items.length) {
    grid.innerHTML = `
      <div class="shop-empty" style="grid-column:1/-1">
        <div class="material-icons-outlined">search_off</div>
        <p>No products found</p>
      </div>`;
    return;
  }

  grid.innerHTML = items.map(item => {
    const cat   = getCatForItem(item);
    const st    = catStyle(cat.name);
    const inCart = cart[item.id];
    return `
      <div class="product-card" onclick="addToCart('${item.id}')">
        ${item.featured  ? '<span class="product-featured-badge">Popular</span>' : ''}
        ${!item.in_stock ? '<span class="product-out-badge">Out of stock</span>' : ''}
        <div class="product-img" style="background:${st.bg}">
          <span class="material-icons-outlined" style="color:${st.color || cat.color}">${cat.icon || 'medication'}</span>
        </div>
        <p class="product-name">${item.name}</p>
        <p class="product-unit">per ${item.unit}</p>
        <p class="product-price">UGX ${item.price.toLocaleString()}</p>
        <button class="product-add-btn" onclick="event.stopPropagation();addToCart('${item.id}')">
          <span class="material-icons-outlined">add</span>
        </button>
      </div>
    `;
  }).join('');
}

// ── Cart ──────────────────────────────────────────────────────────────────────

function addToCart(itemId) {
  const item = allItems.find(i => i.id === itemId);
  if (!item || !item.in_stock) { showToast('This item is out of stock'); return; }

  if (cart[itemId]) {
    cart[itemId].qty += 1;
  } else {
    cart[itemId] = { item, qty: 1 };
  }
  updateCartBadge();
  openCart();
}

function changeQty(itemId, delta) {
  if (!cart[itemId]) return;
  cart[itemId].qty += delta;
  if (cart[itemId].qty <= 0) delete cart[itemId];
  updateCartBadge();
  renderCart();
  if (!Object.keys(cart).length) closeCart();
}

function updateCartBadge() {
  const total = Object.values(cart).reduce((s, e) => s + e.qty, 0);
  const badge = document.getElementById('cartBadge');
  badge.textContent = total;
  badge.classList.toggle('hidden', total === 0);
}

function openCart() {
  renderCart();
  document.getElementById('cartOverlay').classList.add('open');
}

function closeCart() {
  document.getElementById('cartOverlay').classList.remove('open');
}

document.getElementById('cartBtn').addEventListener('click', () => {
  if (Object.keys(cart).length) openCart();
  else showToast('Your cart is empty');
});

// Close when clicking overlay background
document.getElementById('cartOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('cartOverlay')) closeCart();
});

function renderCart() {
  const entries   = Object.values(cart);
  const itemsEl   = document.getElementById('cartItems');
  const totalsEl  = document.getElementById('cartTotals');
  const btnEl     = document.getElementById('placeOrderBtn');

  if (!entries.length) {
    itemsEl.innerHTML = `
      <div class="cart-empty">
        <div class="material-icons-outlined">shopping_cart</div>
        <p>Your cart is empty</p>
      </div>`;
    totalsEl.style.display = 'none';
    btnEl.disabled = true;
    return;
  }

  // Items
  itemsEl.innerHTML = entries.map(({ item, qty }) => {
    const cat = getCatForItem(item);
    const st  = catStyle(cat.name);
    return `
      <div class="cart-item">
        <div class="cart-item-icon" style="background:${st.bg}">
          <span class="material-icons-outlined" style="color:${st.color || cat.color}">${cat.icon || 'medication'}</span>
        </div>
        <div class="cart-item-info">
          <p class="cart-item-name">${item.name}</p>
          <p class="cart-item-price">UGX ${item.price.toLocaleString()} / ${item.unit}</p>
        </div>
        <div class="qty-controls">
          <button class="qty-btn" onclick="changeQty('${item.id}', -1)">−</button>
          <span class="qty-value">${qty}</span>
          <button class="qty-btn" onclick="changeQty('${item.id}', 1)">+</button>
        </div>
      </div>
    `;
  }).join('');

  // Totals
  const subtotal    = entries.reduce((s, { item, qty }) => s + item.price * qty, 0);
  const deliveryFee = calcDeliveryFee();
  const total       = subtotal + deliveryFee;

  totalsEl.style.display = 'block';
  document.getElementById('cartSubtotal').textContent = 'UGX ' + subtotal.toLocaleString();
  document.getElementById('cartDelivery').textContent = 'UGX ' + deliveryFee.toLocaleString();
  document.getElementById('cartTotal').textContent    = 'UGX ' + total.toLocaleString();

  // Routing
  updateRoutingDisplay();

  btnEl.disabled = false;
}

// ── Pharmacy Routing ──────────────────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcDeliveryFee() {
  if (!routedPharmacy) return 8500;
  if (!userLat || !userLon || !routedPharmacy.latitude || !routedPharmacy.longitude) {
    return routedPharmacy.delivery_fee || 8500;
  }
  const dist = haversineKm(userLat, userLon, routedPharmacy.latitude, routedPharmacy.longitude);
  return dist <= (routedPharmacy.delivery_radius_km || 10)
    ? (routedPharmacy.delivery_fee || 2000)
    : 8500;
}

function routeToNearestPharmacy() {
  if (!pharmacies.length) return;

  if (userLat && userLon) {
    // Find nearest with coordinates
    const withCoords = pharmacies.filter(p => p.latitude && p.longitude);
    if (withCoords.length) {
      let best = null, bestDist = Infinity;
      withCoords.forEach(p => {
        const d = haversineKm(userLat, userLon, parseFloat(p.latitude), parseFloat(p.longitude));
        if (d < bestDist) { bestDist = d; best = p; best._dist = d; }
      });
      routedPharmacy = best;
      routedPharmacy._dist = bestDist;
      return;
    }
  }

  // Fallback: match by district, else first pharmacy
  const district = (userProfile.district || '').toLowerCase();
  routedPharmacy = pharmacies.find(p =>
    (p.district || '').toLowerCase() === district
  ) || pharmacies[0];
}

function updateRoutingDisplay() {
  routeToNearestPharmacy();
  const infoEl = document.getElementById('routingInfo');
  if (routedPharmacy) {
    infoEl.style.display = 'flex';
    document.getElementById('routingPharmacy').textContent = routedPharmacy.name;
    document.getElementById('routingDist').textContent =
      routedPharmacy._dist != null
        ? routedPharmacy._dist.toFixed(1) + ' km away'
        : routedPharmacy.district || 'nearby';
  } else {
    infoEl.style.display = 'none';
  }
}

// ── Geolocation ───────────────────────────────────────────────────────────────

function useMyLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported on this device');
    return;
  }
  const btn = document.getElementById('useLocationBtn');
  btn.textContent = 'Getting location…';
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLon = pos.coords.longitude;
      document.getElementById('deliveryAddress').value =
        `${userLat.toFixed(4)}, ${userLon.toFixed(4)}`;
      btn.innerHTML = `<span class="material-icons-outlined" style="font-size:18px">check_circle</span> Location captured`;
      btn.disabled = false;
      routeToNearestPharmacy();
      renderCart();
    },
    () => {
      showToast('Could not get location. Enter address manually.');
      btn.innerHTML = `<span class="material-icons-outlined" style="font-size:18px">my_location</span> Use my current location`;
      btn.disabled = false;
    },
    { timeout: 8000 }
  );
}

// ── Payment ───────────────────────────────────────────────────────────────────

function selectPayment(method, el) {
  paymentMethod = method;
  document.querySelectorAll('.pay-opt').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

// ── Place Order ───────────────────────────────────────────────────────────────

async function placeOrder() {
  const entries = Object.values(cart);
  if (!entries.length) { showToast('Your cart is empty'); return; }

  const address = document.getElementById('deliveryAddress').value.trim();
  if (!address) {
    showToast('Please enter a delivery address');
    document.getElementById('deliveryAddress').focus();
    return;
  }

  const btn = document.getElementById('placeOrderBtn');
  btn.disabled  = true;
  btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 0.8s linear infinite">refresh</span> Placing order…';

  const subtotal    = entries.reduce((s, { item, qty }) => s + item.price * qty, 0);
  const deliveryFee = calcDeliveryFee();
  const totalAmount = subtotal + deliveryFee;

  const orderItems = entries.map(({ item, qty }) => ({
    item_id:   item.id,
    name:      item.name,
    unit:      item.unit,
    price:     item.price,
    quantity:  qty,
    subtotal:  item.price * qty,
  }));

  const patientName  = [userProfile.first_name, userProfile.last_name].filter(Boolean).join(' ') || 'Patient';
  const patientPhone = userProfile.phone_number || '';
  const district     = userProfile.district || userProfile.city || '';

  const orderPayload = {
    user_id:          sessionUserId,
    patient_name:     patientName,
    patient_phone:    patientPhone,
    delivery_address: address,
    district:         district,
    items:            orderItems,
    total_amount:     totalAmount,
    delivery_fee:     deliveryFee,
    status:           'pending',
    payment_method:   paymentMethod,
    pharmacy_id:      routedPharmacy?.id || null,
    user_latitude:    userLat,
    user_longitude:   userLon,
  };

  const { data, error } = await sb
    .from('marketplace_orders')
    .insert(orderPayload)
    .select('id')
    .single();

  if (error) {
    console.error('Order placement error:', error);
    showToast('Order failed. Please try again.', 'error');
    btn.disabled  = false;
    btn.innerHTML = '<span class="material-icons-outlined">shopping_bag</span> Place Order';
    return;
  }

  // Success
  cart = {};
  updateCartBadge();
  closeCart();
  showToast('Order placed successfully! We will contact you shortly.', 'success');

  // Refresh orders tab
  loadMyOrders();

  btn.disabled  = false;
  btn.innerHTML = '<span class="material-icons-outlined">shopping_bag</span> Place Order';
}

// ── My Orders ─────────────────────────────────────────────────────────────────

async function loadMyOrders() {
  if (!sessionUserId) return;
  const listEl = document.getElementById('ordersList');

  const { data, error } = await sb
    .from('marketplace_orders')
    .select('id, items, total_amount, delivery_fee, status, created_at, pharmacy_id, delivery_address')
    .eq('user_id', sessionUserId)
    .order('created_at', { ascending: false });

  if (error || !data?.length) {
    listEl.innerHTML = `
      <div class="shop-empty">
        <div class="material-icons-outlined">receipt_long</div>
        <p>No orders yet</p>
        <p style="font-size:12px;color:var(--text-hint);margin-top:4px">Products you order will appear here</p>
      </div>`;
    return;
  }

  listEl.innerHTML = data.map(o => {
    const items   = Array.isArray(o.items) ? o.items : [];
    const summary = items.map(i => `${i.name} ×${i.quantity}`).join(', ');
    const date    = new Date(o.created_at).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' });
    return `
      <div class="my-order-card">
        <div class="my-order-header">
          <span class="my-order-id">${o.id.slice(0, 8).toUpperCase()}</span>
          <span class="order-status-badge ${o.status}">${o.status}</span>
        </div>
        <p class="my-order-items">${summary || 'Order items'}</p>
        <div class="my-order-meta">
          <span>${date}</span>
          <span class="my-order-total">UGX ${(o.total_amount || 0).toLocaleString()}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.getElementById('panelProducts').classList.toggle('active', name === 'products');
  document.getElementById('panelOrders').classList.toggle('active',   name === 'orders');
  document.getElementById('tabProducts').classList.toggle('active', name === 'products');
  document.getElementById('tabOrders').classList.toggle('active',   name === 'orders');
  if (name === 'orders') loadMyOrders();
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('shopToast');
  el.textContent = msg;
  el.className   = 'shop-toast' + (type ? ' ' + type : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── CSS spin keyframe (injected once) ─────────────────────────────────────────
const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(styleEl);
