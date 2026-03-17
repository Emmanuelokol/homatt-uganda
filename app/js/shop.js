/**
 * Homatt Health — Preventive Shop
 * Standalone shop page: products browsing, cart, checkout, order tracking
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Auth check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'signin.html'; return; }

  const userId = session.user.id;

  // Status bar time
  function updateTime() {
    const n = new Date();
    document.getElementById('statusTime').textContent =
      `${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // ====== State ======
  let categories = [];
  let items = [];
  let cart = JSON.parse(localStorage.getItem('homatt_cart') || '[]');
  let selectedCategoryId = null;
  let _nearestPharmacy = null;

  // ====== Helpers ======
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showToast(msg, type) {
    const t = document.getElementById('shopToast');
    t.textContent = msg;
    t.className = 'tracker-toast visible' + (type === 'error' ? ' error' : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('visible'), 3200);
  }

  // Custom confirm dialog — window.confirm() is broken in Capacitor WebViews
  function showConfirm(message, okText = 'OK') {
    return new Promise(resolve => {
      const overlay = document.getElementById('confirmOverlay');
      const msgEl   = document.getElementById('confirmMsg');
      const okBtn   = document.getElementById('confirmOkBtn');
      const cancelBtn = document.getElementById('confirmCancelBtn');
      msgEl.textContent = message;
      okBtn.textContent = okText;
      overlay.style.display = 'flex';

      function done(result) {
        overlay.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      }
      function onOk()     { done(true);  }
      function onCancel() { done(false); }
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  // ====== Tab Switching ======
  const tabs = document.querySelectorAll('.tracker-tab');
  const panes = document.querySelectorAll('.family-pane');

  let ordersLoaded = false;

  function activateTab(target) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    panes.forEach(p => p.classList.toggle('active', p.id === 'pane-' + target));

    if (target === 'products') {
      document.getElementById('cartFab').classList.add('visible');
    } else {
      document.getElementById('cartFab').classList.remove('visible');
      if (!ordersLoaded) loadMyOrders();
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  // Cart header button also opens cart
  document.getElementById('shopCartHeaderBtn').addEventListener('click', openCartSheet);

  // ====== Cart Badge ======
  function updateCartBadge() {
    const total = cart.reduce((s, c) => s + c.qty, 0);
    const badge = document.getElementById('cartBadgeDot');
    const hBadge = document.getElementById('cartHeaderBadge');
    badge.textContent = total;
    hBadge.textContent = total;
    const show = total > 0;
    badge.classList.toggle('visible', show);
    hBadge.classList.toggle('visible', show);
  }

  updateCartBadge();

  // ====== Sheet Helpers ======
  const overlay = document.getElementById('sheetOverlay');
  const appScreen = document.querySelector('.app-screen');

  function openSheet(el) {
    overlay.classList.add('visible');
    el.classList.add('open');
    // Lock the scrollable content area, NOT the body.
    // Setting body.overflow:hidden conflicts with Capacitor's "resize:body" keyboard mode,
    // which shrinks body.style.height when the keyboard opens — keeping body overflow
    // unrestricted lets that resize propagate correctly so the sheet rises above the keyboard.
    if (appScreen) appScreen.style.overflowY = 'hidden';
  }

  function closeSheet(el) {
    overlay.classList.remove('visible');
    el.classList.remove('open');
    if (appScreen) appScreen.style.overflowY = '';
  }

  overlay.addEventListener('click', () => {
    document.querySelectorAll('.bottom-sheet.open').forEach(s => closeSheet(s));
  });

  document.getElementById('closeCartSheet').addEventListener('click', () => {
    closeSheet(document.getElementById('cartSheet'));
  });

  // ====== Load Shop ======
  async function loadShop() {
    document.getElementById('shopLoading').style.display = 'block';
    document.getElementById('itemsGrid').innerHTML = '';

    const { data: cats } = await supabase
      .from('marketplace_categories')
      .select('*')
      .order('sort_order');

    categories = cats || [];
    renderCategories();
    await loadItems(null);
    document.getElementById('shopLoading').style.display = 'none';
  }

  function renderCategories() {
    const scroll = document.getElementById('categoryScroll');
    scroll.innerHTML = categories.map(cat => `
      <button class="cat-chip ${cat.name === 'All' ? 'active' : ''}" data-cat-id="${cat.id}" data-cat-name="${escHtml(cat.name)}">
        <div class="cat-chip-icon" style="background:${cat.color || '#388E3C'}">
          <span class="material-icons-outlined">${cat.icon || 'grid_view'}</span>
        </div>
        <span class="cat-chip-label">${escHtml(cat.name)}</span>
      </button>`).join('');

    scroll.querySelectorAll('.cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        scroll.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const catId = chip.dataset.catId;
        const catName = chip.dataset.catName;
        selectedCategoryId = catName === 'All' ? null : catId;
        document.getElementById('itemsSectionTitle').textContent = catName === 'All' ? 'All Products' : catName;
        loadItems(selectedCategoryId);
      });
    });
  }

  async function loadItems(categoryId) {
    let query = supabase
      .from('marketplace_items')
      .select('*, marketplace_categories(name,icon,color)')
      .eq('active', true);
    if (categoryId) query = query.eq('category_id', categoryId);
    query = query.order('featured', { ascending: false }).order('sort_order');

    const { data } = await query;
    items = data || [];

    const searchTerm = document.getElementById('shopSearch').value.toLowerCase();
    const filtered = searchTerm
      ? items.filter(i => i.name.toLowerCase().includes(searchTerm) || (i.description || '').toLowerCase().includes(searchTerm))
      : items;

    renderItems(filtered);
  }

  function renderItems(itemList) {
    const grid = document.getElementById('itemsGrid');
    if (itemList.length === 0) {
      grid.innerHTML = `
        <div style="grid-column:span 2;text-align:center;padding:40px 20px;color:var(--text-hint);font-size:13px">
          <span class="material-icons-outlined" style="font-size:40px;color:var(--border);display:block;margin-bottom:8px">search_off</span>
          No products found
        </div>`;
      return;
    }

    grid.innerHTML = itemList.map(item => {
      const catColor = (item.marketplace_categories && item.marketplace_categories.color) || '#388E3C';
      const catIcon  = (item.marketplace_categories && item.marketplace_categories.icon) || 'medical_services';
      const inCart   = cart.some(c => c.id === item.id);
      const cartItem = cart.find(c => c.id === item.id);

      return `
        <div class="item-card" data-item-id="${item.id}">
          ${item.featured ? `<span class="item-featured-badge">⭐ Featured</span>` : ''}
          <div class="item-icon-wrap" style="background:linear-gradient(135deg,${catColor},${catColor}cc)">
            <span class="material-icons-outlined">${catIcon}</span>
          </div>
          <div class="item-name">${escHtml(item.name)}</div>
          ${item.manufacturer ? `<div class="item-manufacturer">${escHtml(item.manufacturer)}</div>` : ''}
          ${item.description ? `<div style="font-size:11px;color:var(--text-hint);margin-bottom:4px;line-height:1.4">${escHtml(item.description.substring(0,80))}${item.description.length>80?'…':''}</div>` : ''}
          <div class="item-price">UGX ${Number(item.price).toLocaleString()} <small>/ ${item.unit || 'piece'}</small></div>
          <span class="item-stock-badge ${item.in_stock !== false ? 'in' : 'out'}">${item.in_stock !== false ? '✓ In Stock' : '✗ Out of Stock'}</span>
          ${inCart ? `
            <div class="cart-qty-control" style="margin-top:8px;justify-content:center;width:100%">
              <button class="cart-qty-btn" data-action="dec" data-item-id="${item.id}">−</button>
              <span class="cart-qty-val">${cartItem.qty}</span>
              <button class="cart-qty-btn" data-action="inc" data-item-id="${item.id}">+</button>
            </div>
          ` : `
            <button class="add-to-cart-btn" data-item-id="${item.id}" ${item.in_stock === false ? 'disabled' : ''}>
              <span class="material-icons-outlined">add_shopping_cart</span>
              Add to Cart
            </button>
          `}
        </div>`;
    }).join('');

    grid.querySelectorAll('.add-to-cart-btn').forEach(btn => {
      btn.addEventListener('click', () => addToCart(btn.dataset.itemId));
    });

    grid.querySelectorAll('.cart-qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.itemId;
        const action = btn.dataset.action;
        const idx = cart.findIndex(c => c.id === id);
        if (idx === -1) return;
        if (action === 'inc') {
          cart[idx].qty++;
        } else {
          cart[idx].qty--;
          if (cart[idx].qty <= 0) cart.splice(idx, 1);
        }
        localStorage.setItem('homatt_cart', JSON.stringify(cart));
        updateCartBadge();
        const term = document.getElementById('shopSearch').value.toLowerCase();
        const filtered = term
          ? items.filter(i => i.name.toLowerCase().includes(term) || (i.description || '').toLowerCase().includes(term))
          : items;
        renderItems(filtered);
      });
    });
  }

  // ====== Cart ======
  function addToCart(itemId) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const existing = cart.find(c => c.id === itemId);
    if (existing) {
      existing.qty++;
    } else {
      cart.push({
        id: item.id,
        name: item.name,
        price: item.price,
        qty: 1,
        unit: item.unit,
        icon: (item.marketplace_categories && item.marketplace_categories.icon) || 'medical_services',
        color: (item.marketplace_categories && item.marketplace_categories.color) || '#388E3C'
      });
    }

    localStorage.setItem('homatt_cart', JSON.stringify(cart));
    updateCartBadge();
    const term = document.getElementById('shopSearch').value.toLowerCase();
    const filtered = term
      ? items.filter(i => i.name.toLowerCase().includes(term) || (i.description || '').toLowerCase().includes(term))
      : items;
    renderItems(filtered);
    showToast(`${item.name} added to cart`);
  }

  // Cart FAB
  document.getElementById('cartFab').addEventListener('click', openCartSheet);

  // Render cart contents in place — does NOT reopen the sheet (fixes recursive call + listener pile-up)
  function renderCartContents() {
    const listEl       = document.getElementById('cartItemsList');
    const totalRow     = document.getElementById('cartTotalRow');
    const checkoutArea = document.getElementById('cartCheckoutArea');

    if (cart.length === 0) {
      listEl.innerHTML = `<div class="cart-empty"><span class="material-icons-outlined">shopping_cart</span>Your cart is empty</div>`;
      totalRow.style.display = 'none';
      checkoutArea.style.display = 'none';
      return;
    }

    listEl.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-icon" style="background:${item.color}">
          <span class="material-icons-outlined">${item.icon}</span>
        </div>
        <div class="cart-item-body">
          <div class="cart-item-name">${escHtml(item.name)}</div>
          <div class="cart-item-price">UGX ${Number(item.price).toLocaleString()} / ${item.unit || 'piece'}</div>
        </div>
        <div class="cart-qty-control">
          <button class="cart-qty-btn" data-cart-id="${item.id}" data-action="dec">−</button>
          <span class="cart-qty-val">${item.qty}</span>
          <button class="cart-qty-btn" data-cart-id="${item.id}" data-action="inc">+</button>
        </div>
      </div>`).join('');

    // Single delegated listener on parent — avoids listener accumulation on every re-render
    listEl.onclick = (e) => {
      const btn = e.target.closest('.cart-qty-btn');
      if (!btn) return;
      const id  = btn.dataset.cartId;
      const idx = cart.findIndex(c => c.id === id);
      if (idx === -1) return;
      if (btn.dataset.action === 'inc') {
        cart[idx].qty++;
      } else {
        cart[idx].qty--;
        if (cart[idx].qty <= 0) cart.splice(idx, 1);
      }
      localStorage.setItem('homatt_cart', JSON.stringify(cart));
      updateCartBadge();
      renderCartContents(); // re-render cart contents only, sheet stays open
    };

    const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
    const curDeliveryFee = _nearestPharmacy ? calcDeliveryFee(_nearestPharmacy.distanceKm) : 2000;
    document.getElementById('cartSubtotal').textContent = subtotal.toLocaleString();
    document.getElementById('cartDeliveryFee').textContent = curDeliveryFee.toLocaleString();
    document.getElementById('cartTotal').textContent = (subtotal + curDeliveryFee).toLocaleString();

    const pharmInfo = document.getElementById('cartPharmacyInfo');
    if (_nearestPharmacy) {
      pharmInfo.style.display = 'block';
      pharmInfo.innerHTML = `<span class="material-icons-outlined" style="font-size:13px;vertical-align:middle;margin-right:3px">local_pharmacy</span>
        Routed to: <strong>${escHtml(_nearestPharmacy.name)}</strong> — ${_nearestPharmacy.distanceKm.toFixed(1)} km away`;
    } else {
      pharmInfo.style.display = 'none';
      getUserCoords().then(coords => {
        if (coords) findNearestPharmacy(coords[0], coords[1]);
      });
    }

    totalRow.style.display = 'block';
    checkoutArea.style.display = 'block';
  }

  function openCartSheet() {
    renderCartContents();
    openSheet(document.getElementById('cartSheet'));
  }

  // ====== Pharmacy Routing ======
  const DISTRICT_COORDS = {
    'kampala':    [0.3163, 32.5822], 'wakiso':     [0.4000, 32.4500],
    'mukono':     [0.3540, 32.7550], 'jinja':      [0.4244, 33.2041],
    'mbale':      [1.0800, 34.1750], 'gulu':       [2.7747, 32.2990],
    'mbarara':   [-0.6167, 30.6500], 'fort portal':[0.6710, 30.2750],
    'arua':       [3.0200, 30.9100], 'lira':       [2.2499, 32.8999],
    'soroti':     [1.7150, 33.6110], 'kabale':    [-1.2480, 29.9890],
    'masaka':    [-0.3350, 31.7350], 'tororo':     [0.6920, 34.1810],
    'entebbe':    [0.0600, 32.4600], 'ntinda':     [0.3600, 32.6200],
    'nansana':    [0.3700, 32.5100], 'kireka':     [0.3500, 32.6500],
    'kyanja':     [0.3900, 32.6300], 'namugongo':  [0.3700, 32.6600],
    'najjera':    [0.3500, 32.6400], 'kira':       [0.4100, 32.6400],
    'bweyogerere':[0.3300, 32.6700], 'namasuba':   [0.2800, 32.5400],
    'makindye':   [0.2900, 32.6000], 'rubaga':     [0.3100, 32.5500],
    'kawempe':    [0.3700, 32.5500], 'nakawa':     [0.3200, 32.6200],
  };

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function calcDeliveryFee(distanceKm) {
    const fee = 2000 + Math.round(distanceKm) * 500;
    return Math.max(2000, Math.round(fee / 500) * 500);
  }

  async function findNearestPharmacy(userLat, userLon) {
    if (_nearestPharmacy) return _nearestPharmacy;
    try {
      const { data: pharmacies } = await supabase
        .from('pharmacies')
        .select('id, name, latitude, longitude, delivery_fee, delivery_radius_km')
        .eq('active', true)
        .not('latitude', 'is', null);
      if (!pharmacies?.length) return null;
      let best = null, bestDist = Infinity;
      for (const p of pharmacies) {
        const dist = haversineKm(userLat, userLon, parseFloat(p.latitude), parseFloat(p.longitude));
        if (dist < bestDist) { bestDist = dist; best = { ...p, distanceKm: dist }; }
      }
      _nearestPharmacy = best;
      return best;
    } catch(e) { return null; }
  }

  function getUserCoords() {
    return new Promise(resolve => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => resolve([pos.coords.latitude, pos.coords.longitude]),
          () => resolve(null),
          { timeout: 4000 }
        );
      } else resolve(null);
    });
  }

  // ====== Checkout ======
  document.getElementById('cartCheckoutBtn').addEventListener('click', submitOrder);

  async function submitOrder() {
    const addr = (document.getElementById('cartDeliveryAddress').value || '').trim();
    if (!addr) {
      showToast('Please enter your delivery address', 'error');
      document.getElementById('cartDeliveryAddress').focus();
      return;
    }
    if (cart.length === 0) return;

    // Self-medication frequency guard
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentOrders } = await supabase
      .from('marketplace_orders')
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', sevenDaysAgo);
    const recentCount = (recentOrders || []).length;

    if (recentCount >= 5) {
      closeSheet(document.getElementById('cartSheet'));
      showToast('You have ordered medicine 5+ times this week. Please visit a clinic.', 'error');
      const go = await showConfirm(
        'You have placed ' + recentCount + ' medicine orders in the last 7 days.\n\n' +
        'Frequent self-medication can be harmful.\n\n' +
        'We strongly recommend visiting a clinic. Press OK to book a clinic visit.',
        'Book Clinic'
      );
      if (go) window.location.href = 'clinic-booking.html';
      return;
    }

    if (recentCount >= 3) {
      const proceed = await showConfirm(
        'You have ordered medicine ' + recentCount + ' times in the last 7 days.\n\n' +
        'Repeated self-medication without diagnosis can be dangerous.\n\n' +
        'We recommend visiting a clinic. Do you still want to place this order?',
        'Place Order'
      );
      if (!proceed) return;
    }

    const btn = document.getElementById('cartCheckoutBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined">hourglass_empty</span> Placing order…';

    const itemsTotal   = cart.reduce((s, c) => s + c.price * c.qty, 0);
    const itemsPayload = cart.map(c => ({ id: c.id, name: c.name, price: c.price, qty: c.qty, unit: c.unit || '' }));

    // Fetch profile and GPS in parallel to speed up order placement
    let patientName = 'Customer', patientPhone = null, userDistrict = null;
    let userLat = null, userLon = null;

    const [profResult, gpsCoords] = await Promise.all([
      supabase.from('profiles').select('first_name,last_name,phone,district').eq('id', userId).single().catch(() => ({ data: null })),
      getUserCoords()
    ]);

    if (profResult && profResult.data) {
      const prof = profResult.data;
      patientName  = ((prof.first_name || '') + ' ' + (prof.last_name || '')).trim() || 'Customer';
      patientPhone = prof.phone || null;
      userDistrict = prof.district || null;
    }

    if (gpsCoords) {
      [userLat, userLon] = gpsCoords;
    } else if (userDistrict) {
      const key = userDistrict.toLowerCase();
      const dc  = DISTRICT_COORDS[key] || DISTRICT_COORDS[addr.toLowerCase().split(',')[0].trim()];
      if (dc) [userLat, userLon] = dc;
    }

    let pharmacyId = null, deliveryFee = 2000;
    if (userLat && userLon) {
      const nearest = await findNearestPharmacy(userLat, userLon);
      if (nearest) {
        pharmacyId  = nearest.id;
        deliveryFee = calcDeliveryFee(nearest.distanceKm);
      }
    }

    const total = itemsTotal + deliveryFee;

    const { error: orderErr } = await supabase.from('marketplace_orders').insert({
      user_id:          userId,
      patient_name:     patientName,
      patient_phone:    patientPhone,
      delivery_address: addr,
      items:            itemsPayload,
      total_amount:     total,
      status:           'pending',
      payment_method:   'cash_on_delivery',
      pharmacy_id:      pharmacyId,
      delivery_fee:     deliveryFee,
      user_latitude:    userLat,
      user_longitude:   userLon,
    });

    if (orderErr) {
      showToast('Order failed: ' + orderErr.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined">shopping_bag</span> Place Order';
      return;
    }

    // Deduct stock (best-effort)
    try {
      for (const item of cart) {
        await supabase.rpc('deduct_stock', { item_id: item.id, qty: item.qty });
      }
    } catch(e) {}

    cart = [];
    localStorage.removeItem('homatt_cart');
    updateCartBadge();
    closeSheet(document.getElementById('cartSheet'));
    ordersLoaded = false; // force reload next time My Orders tab is opened
    showToast(`Order placed! Delivery fee: UGX ${deliveryFee.toLocaleString()}. We will call to confirm.`);

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">shopping_bag</span> Place Order';

    // Refresh product grid to clear "in cart" buttons
    const term     = document.getElementById('shopSearch').value.toLowerCase();
    const filtered = term
      ? items.filter(i => i.name.toLowerCase().includes(term) || (i.description || '').toLowerCase().includes(term))
      : items;
    renderItems(filtered);
  }

  // ====== Search ======
  document.getElementById('shopSearch').addEventListener('input', () => {
    const term     = document.getElementById('shopSearch').value.toLowerCase();
    const filtered = term
      ? items.filter(i => i.name.toLowerCase().includes(term) || (i.description || '').toLowerCase().includes(term))
      : items;
    renderItems(filtered);
  });

  // ====== My Orders ======
  const STATUS_LABELS = {
    pending:    { label: 'Pending',    color: '#E65100', bg: '#FFF3E0', icon: 'schedule' },
    confirmed:  { label: 'Confirmed',  color: '#1565C0', bg: '#E3F2FD', icon: 'check_circle' },
    dispatched: { label: 'On the way', color: '#6A1B9A', bg: '#F3E5F5', icon: 'local_shipping' },
    delivered:  { label: 'Delivered',  color: '#2E7D32', bg: '#E8F5E9', icon: 'done_all' },
    cancelled:  { label: 'Cancelled',  color: '#B71C1C', bg: '#FFEBEE', icon: 'cancel' },
  };

  async function loadMyOrders() {
    const loadingEl = document.getElementById('ordersLoading');
    const listEl    = document.getElementById('ordersList');
    loadingEl.style.display = 'block';
    listEl.innerHTML = '';

    const { data: orders, error } = await supabase
      .from('marketplace_orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    loadingEl.style.display = 'none';
    ordersLoaded = true;

    if (error) {
      listEl.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-hint);font-size:13px">
        <span class="material-icons-outlined" style="font-size:36px;display:block;margin-bottom:8px;color:var(--border)">error_outline</span>
        Could not load orders
      </div>`;
      return;
    }

    if (!orders || orders.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-hint);font-size:13px">
        <span class="material-icons-outlined" style="font-size:48px;display:block;margin-bottom:10px;color:var(--border)">receipt_long</span>
        No orders yet.<br>Browse products and place your first order!
        <br><br>
        <button onclick="document.querySelector('[data-tab=products]').click()" style="background:var(--primary);color:white;border:none;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer">
          Browse Products
        </button>
      </div>`;
      return;
    }

    listEl.innerHTML = orders.map(order => {
      const st   = STATUS_LABELS[order.status] || { label: order.status, color: '#666', bg: '#f0f0f0', icon: 'info' };
      const date = new Date(order.created_at).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' });
      const time = new Date(order.created_at).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' });
      const itemsArr = Array.isArray(order.items) ? order.items : [];

      // Build timeline steps
      const steps = [
        { key: 'pending',    label: 'Order Placed',  time: order.created_at },
        { key: 'confirmed',  label: 'Confirmed',     time: order.confirmed_at },
        { key: 'dispatched', label: 'Dispatched',    time: order.dispatched_at },
        { key: 'delivered',  label: 'Delivered',     time: order.delivered_at },
      ];
      const statusOrder = ['pending', 'confirmed', 'dispatched', 'delivered'];
      const currentIdx  = statusOrder.indexOf(order.status);
      const isCancelled = order.status === 'cancelled';

      return `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden">
          <!-- Order header -->
          <div style="padding:12px 14px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:11px;color:var(--text-hint);margin-bottom:2px">${date} · ${time}</div>
              <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${itemsArr.length} item${itemsArr.length !== 1 ? 's' : ''}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span style="background:${st.bg};color:${st.color};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:4px">
                <span class="material-icons-outlined" style="font-size:13px">${st.icon}</span>
                ${st.label}
              </span>
              <div style="font-size:13px;font-weight:700;color:var(--primary)">UGX ${Number(order.total_amount || 0).toLocaleString()}</div>
            </div>
          </div>

          <!-- Items list -->
          <div style="padding:10px 14px;border-bottom:1px solid var(--border)">
            ${itemsArr.map(i => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;color:var(--text-secondary)">
                <span>${escHtml(i.name || '?')}</span>
                <span>×${i.qty} &nbsp;<strong style="color:var(--text-primary)">UGX ${Number((i.price||0)*i.qty).toLocaleString()}</strong></span>
              </div>`).join('')}
            ${order.delivery_fee ? `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px;color:var(--text-hint)">
                <span><span class="material-icons-outlined" style="font-size:12px;vertical-align:middle">local_shipping</span> Delivery</span>
                <span>UGX ${Number(order.delivery_fee).toLocaleString()}</span>
              </div>` : ''}
          </div>

          <!-- Delivery address -->
          ${order.delivery_address ? `
          <div style="padding:8px 14px;font-size:12px;color:var(--text-secondary);border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:flex-start">
            <span class="material-icons-outlined" style="font-size:14px;color:var(--primary);flex-shrink:0;margin-top:1px">location_on</span>
            <span>${escHtml(order.delivery_address)}</span>
          </div>` : ''}

          <!-- Tracking timeline (not shown for cancelled) -->
          ${!isCancelled ? `
          <div style="padding:12px 14px">
            <div style="font-size:11px;font-weight:600;color:var(--text-hint);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Tracking</div>
            <div style="display:flex;align-items:flex-start;gap:0">
              ${steps.map((step, i) => {
                const done    = currentIdx >= i;
                const current = currentIdx === i;
                const stepTime = step.time ? new Date(step.time).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' }) : '';
                const stepDate = step.time ? new Date(step.time).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' }) : '';
                return `
                  <div style="flex:1;display:flex;flex-direction:column;align-items:center;position:relative">
                    ${i < steps.length - 1 ? `
                      <div style="position:absolute;top:10px;left:50%;width:100%;height:2px;background:${done && currentIdx > i ? 'var(--primary)' : 'var(--border)'}"></div>
                    ` : ''}
                    <div style="width:20px;height:20px;border-radius:50%;background:${done ? 'var(--primary)' : 'var(--border)'};display:flex;align-items:center;justify-content:center;z-index:1;flex-shrink:0">
                      <span class="material-icons-outlined" style="font-size:12px;color:${done ? 'white' : 'var(--text-hint)'}">check</span>
                    </div>
                    <div style="font-size:10px;font-weight:${current ? '700' : '500'};color:${done ? 'var(--text-primary)' : 'var(--text-hint)'};margin-top:4px;text-align:center;line-height:1.3">${step.label}</div>
                    ${stepTime ? `<div style="font-size:9px;color:var(--text-hint);text-align:center">${stepDate}<br>${stepTime}</div>` : ''}
                  </div>`;
              }).join('')}
            </div>
          </div>` : `
          <div style="padding:10px 14px">
            <div style="background:#FFEBEE;border-radius:8px;padding:8px 12px;font-size:12px;color:#B71C1C;display:flex;gap:6px;align-items:center">
              <span class="material-icons-outlined" style="font-size:15px">cancel</span>
              This order was cancelled.
            </div>
          </div>`}
        </div>`;
    }).join('');
  }

  // ====== Init ======
  loadShop();

  // Start pharmacy lookup in background
  getUserCoords().then(coords => {
    if (coords) findNearestPharmacy(coords[0], coords[1]);
  });
});
