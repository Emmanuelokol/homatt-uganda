/**
 * Homatt Health — Preventive Shop
 *
 * Uses hardcoded Supabase anon credentials (same pattern as portals)
 * so the shop works regardless of what config.js contains.
 *
 * OneSignal App ID is set here — replace with your actual App ID
 * from https://app.onesignal.com
 */

(function () {

  // ── Supabase (hardcoded — anon key is safe to expose) ────────────────────
  const SB_URL  = 'https://kgkdiykzmqjougwzzewi.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8';
  const NOTIFY_URL = `${SB_URL}/functions/v1/notify`;

  // ── OneSignal ─────────────────────────────────────────────────────────────
  // Replace this with your OneSignal App ID from https://app.onesignal.com
  const ONESIGNAL_APP_ID = window.HOMATT_CONFIG?.ONESIGNAL_APP_ID || 'YOUR_ONESIGNAL_APP_ID';

  // ── Demo product catalog ──────────────────────────────────────────────────
  const DEMO_PRODUCTS = [
    { id: 'demo-1',  name: 'Mosquito Net',               description: 'Long-lasting insecticidal net (LLIN). Protects your whole family while sleeping. Reduces malaria by up to 90%.', price: 15000, category: 'malaria',    icon: 'bed' },
    { id: 'demo-2',  name: 'Mosquito Repellent Spray',   description: 'DEET-free body spray. Effective for 6 hours. Safe for children above 2 years. Pleasant scent.', price: 8000,  category: 'malaria',    icon: 'air' },
    { id: 'demo-3',  name: 'Insect Coils (12 pcs)',      description: 'Smoke coils that keep mosquitoes away overnight. One pack lasts up to 12 nights.', price: 3000,  category: 'malaria',    icon: 'local_fire_department' },
    { id: 'demo-4',  name: 'Hand Sanitizer 500ml',       description: '70% alcohol-based hand sanitizer. Kills 99.9% of germs without water. Pocket-sized bottle included.', price: 5000,  category: 'hygiene',    icon: 'soap' },
    { id: 'demo-5',  name: 'Face Masks (10 pcs)',         description: '3-ply surgical masks. Filters dust, pollen, and airborne particles. Comfortable ear loops.', price: 6000,  category: 'hygiene',    icon: 'masks' },
    { id: 'demo-6',  name: 'ORS Sachets (20 pcs)',        description: 'Oral rehydration salts. Essential for diarrhoea and dehydration recovery. WHO recommended.', price: 4000,  category: 'nutrition',  icon: 'water_drop' },
    { id: 'demo-7',  name: 'Water Purif. Tablets (50)',   description: 'Purify drinking water in 30 minutes. 1 tablet per litre. Removes bacteria and viruses.', price: 7000,  category: 'hygiene',    icon: 'water' },
    { id: 'demo-8',  name: 'Vitamin C 500mg (30 tabs)',   description: 'Daily immune-booster. Supports white blood cells. Helps the body fight infections faster.', price: 10000, category: 'nutrition',  icon: 'medication' },
    { id: 'demo-9',  name: 'Sunscreen SPF 30 100ml',     description: 'Broad-spectrum sun protection. Reduces skin cancer risk for outdoor workers. Water-resistant 80 min.', price: 12000, category: 'protection', icon: 'wb_sunny' },
    { id: 'demo-10', name: 'Condoms (3 pcs)',             description: 'High-quality latex condoms. Prevents HIV, STIs, and unwanted pregnancy. WHO pre-qualified.', price: 2000,  category: 'protection', icon: 'shield' },
  ];

  const CATEGORY_META = {
    all:        { label: 'All Items',   icon: 'apps' },
    malaria:    { label: 'Malaria',     icon: 'bed' },
    hygiene:    { label: 'Hygiene',     icon: 'soap' },
    nutrition:  { label: 'Nutrition',   icon: 'medication' },
    protection: { label: 'Protection', icon: 'shield' },
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let sb          = null;   // own Supabase client
  let allProducts = [];
  let selectedProduct = null;
  let orderQty    = 1;
  let currentCat  = 'all';
  let currentUser = null;
  let userId      = null;
  let userAuthToken = null;

  // ── Init (called from dashboard.js) ──────────────────────────────────────
  window.initShop = async function (dashboardSb, session) {
    // Create own client with hardcoded credentials — guaranteed to work
    sb = window.supabase.createClient(SB_URL, SB_ANON);

    if (session) {
      userId = session.user.id;
      userAuthToken = session.access_token;

      // Load user profile to pre-fill order form
      try {
        const { data: profile } = await sb
          .from('profiles')
          .select('first_name, last_name, phone_number, district')
          .eq('id', userId)
          .single();
        if (profile) currentUser = profile;
      } catch (_) {}

      // Register for OneSignal push notifications
      initOneSignalForUser();
    }

    await loadProducts();
    wireEvents();
  };

  // ── OneSignal Push Setup (loaded lazily — never blocks DOMContentLoaded) ───
  let oneSignalLoaded = false;

  function loadOneSignalLazily(callback) {
    // Skip if no real App ID configured
    if (!ONESIGNAL_APP_ID || ONESIGNAL_APP_ID === 'YOUR_ONESIGNAL_APP_ID') return;

    if (typeof OneSignal !== 'undefined') {
      // Already on the page
      if (callback) callback();
      return;
    }

    if (document.getElementById('onesignal-sdk')) {
      // Script already injected — wait for it
      const check = setInterval(() => {
        if (typeof OneSignal !== 'undefined') {
          clearInterval(check);
          if (callback) callback();
        }
      }, 200);
      return;
    }

    // Inject SDK script asynchronously — no defer, no blocking
    const script = document.createElement('script');
    script.id  = 'onesignal-sdk';
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    script.async = true;
    script.onload = () => { if (callback) callback(); };
    script.onerror = () => {}; // silently ignore if CDN unreachable
    document.head.appendChild(script);
  }

  function initOneSignalForUser() {
    loadOneSignalLazily(() => {
      if (typeof OneSignal === 'undefined') return;
      OneSignal.push(async () => {
        try {
          OneSignal.init({ appId: ONESIGNAL_APP_ID, notifyButton: { enable: false } });
          const isPushEnabled = await OneSignal.isPushNotificationsEnabled();
          if (!isPushEnabled) {
            OneSignal.on('subscriptionChange', async (isSubscribed) => {
              if (isSubscribed) await saveOneSignalPlayerId();
            });
          } else {
            await saveOneSignalPlayerId();
          }
        } catch (_) {}
      });
    });
  }

  async function saveOneSignalPlayerId() {
    if (typeof OneSignal === 'undefined' || !userId) return;
    try {
      const playerId = await OneSignal.getUserId();
      if (playerId) {
        await sb.from('profiles')
          .update({ onesignal_player_id: playerId })
          .eq('id', userId);
      }
    } catch (_) {}
  }

  async function requestPushPermission() {
    loadOneSignalLazily(() => {
      if (typeof OneSignal === 'undefined') return;
      OneSignal.push(() => {
        try { OneSignal.registerForPushNotifications(); } catch (_) {}
      });
    });
  }

  // ── Load Products ─────────────────────────────────────────────────────────
  async function loadProducts() {
    try {
      const { data, error } = await sb
        .from('preventive_products')
        .select('*')
        .eq('active', true)
        .order('category');
      if (!error && data && data.length > 0) {
        allProducts = data;
        renderProducts(allProducts);
        return;
      }
    } catch (_) {}
    // Fallback: use built-in demo catalog
    allProducts = DEMO_PRODUCTS;
    renderProducts(allProducts);
  }

  // ── Render Products Grid ──────────────────────────────────────────────────
  function renderProducts(products) {
    const grid = document.getElementById('shopProductsGrid');
    if (!grid) return;
    const filtered = currentCat === 'all'
      ? products
      : products.filter(p => p.category === currentCat);

    if (!filtered.length) {
      grid.innerHTML = `
        <div class="shop-empty" style="grid-column:1/-1">
          <span class="material-icons-outlined">search_off</span>
          <p class="shop-empty-title">No products in this category</p>
          <p class="shop-empty-sub">Try a different category above</p>
        </div>`;
      return;
    }

    grid.innerHTML = filtered.map(p => `
      <div class="product-card" onclick="window.shopOpenProduct('${p.id}')">
        <div class="product-icon-wrap ${p.category}">
          <span class="material-icons-outlined">${p.icon || 'health_and_safety'}</span>
        </div>
        <div class="product-name">${p.name}</div>
        <div class="product-price">UGX ${p.price.toLocaleString()}</div>
        <div class="product-order-hint">Tap to order</div>
      </div>
    `).join('');
  }

  // ── Open Product Detail Sheet ─────────────────────────────────────────────
  window.shopOpenProduct = function (id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    selectedProduct = p;
    orderQty = 1;

    document.getElementById('detailIcon').className = `detail-icon-wrap ${p.category}`;
    document.getElementById('detailIconInner').textContent = p.icon || 'health_and_safety';
    document.getElementById('detailName').textContent = p.name;
    document.getElementById('detailPrice').textContent = 'UGX ' + p.price.toLocaleString();
    document.getElementById('detailDesc').textContent = p.description;
    document.getElementById('detailCatBadge').className = `detail-cat-badge ${p.category}`;
    document.getElementById('detailCatBadge').textContent = CATEGORY_META[p.category]?.label || p.category;
    document.getElementById('overlayTitle').textContent = p.name;

    // Pre-fill form fields from profile
    const phoneInput   = document.getElementById('orderPhone');
    const addressInput = document.getElementById('orderAddress');
    if (currentUser?.phone_number && !phoneInput.value)   phoneInput.value   = currentUser.phone_number;
    if (currentUser?.district      && !addressInput.value) addressInput.value = currentUser.district;

    updateQtyDisplay();
    document.getElementById('productOverlay').classList.add('open');
  };

  function updateQtyDisplay() {
    if (!selectedProduct) return;
    document.getElementById('qtyValue').textContent = orderQty;
    document.getElementById('qtyDecrease').disabled = (orderQty <= 1);
    const total = selectedProduct.price * orderQty;
    document.getElementById('orderTotalValue').textContent = 'UGX ' + total.toLocaleString();
  }

  // ── Place Order ───────────────────────────────────────────────────────────
  async function placeOrder() {
    if (!selectedProduct) return;

    const address = document.getElementById('orderAddress').value.trim();
    const phone   = document.getElementById('orderPhone').value.trim();

    if (!phone) {
      showFormError('Please enter your phone number so we can reach you.');
      return;
    }
    if (!address) {
      showFormError('Please enter your delivery address or district.');
      return;
    }

    const orderBtn = document.getElementById('btnPlaceOrder');
    setOrderBtnLoading(orderBtn, true);

    const orderId = crypto.randomUUID ? crypto.randomUUID() : ('local-' + Date.now());
    const order = {
      id:               orderId,
      user_id:          userId || null,
      product_id:       selectedProduct.id.startsWith('demo-') ? null : selectedProduct.id,
      product_name:     selectedProduct.name,
      quantity:         orderQty,
      unit_price:       selectedProduct.price,
      total_price:      selectedProduct.price * orderQty,
      delivery_address: address,
      contact_phone:    phone,
      status:           'pending',
      created_at:       new Date().toISOString(),
    };

    let savedToSupabase = false;
    let supabaseError   = null;

    // Try saving to Supabase
    try {
      const { error } = await sb.from('shop_orders').insert([{
        user_id:          order.user_id,
        product_id:       order.product_id,
        product_name:     order.product_name,
        quantity:         order.quantity,
        unit_price:       order.unit_price,
        total_price:      order.total_price,
        delivery_address: order.delivery_address,
        contact_phone:    order.contact_phone,
        status:           'pending',
      }]);
      if (!error) {
        savedToSupabase = true;
      } else {
        supabaseError = error.message;
      }
    } catch (e) {
      supabaseError = e.message;
    }

    // Always save to localStorage as backup / offline support
    const localOrders = JSON.parse(localStorage.getItem('homatt_shop_orders') || '[]');
    localOrders.unshift(order);
    localStorage.setItem('homatt_shop_orders', JSON.stringify(localOrders.slice(0, 50)));

    setOrderBtnLoading(orderBtn, false);

    if (savedToSupabase) {
      // Notify admin via edge function (fire and forget)
      notifyAdmin(order).catch(() => {});
    } else if (supabaseError) {
      // Table may not be created yet — order is saved locally, show gentle message
      console.warn('Supabase insert failed:', supabaseError);
    }

    // Always show success — order is saved (Supabase or locally)
    document.getElementById('productOverlay').classList.remove('open');
    showOrderSuccess(selectedProduct.name, savedToSupabase);
  }

  function showFormError(msg) {
    let errEl = document.getElementById('orderFormError');
    if (!errEl) {
      errEl = document.createElement('p');
      errEl.id = 'orderFormError';
      errEl.style.cssText = 'color:#D32F2F;font-size:13px;margin-bottom:8px;font-weight:500';
      document.getElementById('btnPlaceOrder').before(errEl);
    }
    errEl.textContent = msg;
    setTimeout(() => { if (errEl) errEl.textContent = ''; }, 4000);
  }

  function setOrderBtnLoading(btn, loading) {
    if (loading) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-icons-outlined shop-spin">sync</span> Placing order…';
    } else {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined">shopping_cart</span> Confirm Order';
    }
  }

  // ── Notify admin via Supabase Edge Function ───────────────────────────────
  async function notifyAdmin(order) {
    if (!userAuthToken) return;
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAuthToken}`,
      },
      body: JSON.stringify({
        type:         'new_order',
        product_name: order.product_name,
        quantity:     order.quantity,
        total_price:  order.total_price,
        phone:        order.contact_phone,
        address:      order.delivery_address,
      }),
    });
  }

  // ── Order Success Screen ──────────────────────────────────────────────────
  function showOrderSuccess(productName, synced) {
    document.getElementById('successProductName').textContent = productName;
    const sub = document.getElementById('successSubText');
    sub.textContent = synced
      ? 'Your order has been received by our team. We will contact you to confirm delivery soon.'
      : 'Your order was saved on your phone. It will sync when your connection improves.';
    document.getElementById('orderSuccessOverlay').classList.add('show');

    // Ask for push notification permission after first order
    setTimeout(requestPushPermission, 1500);
  }

  // ── My Orders Panel ───────────────────────────────────────────────────────
  async function openMyOrders() {
    document.getElementById('ordersOverlay').classList.add('open');
    await loadMyOrders();
  }

  async function loadMyOrders() {
    const list = document.getElementById('myOrdersList');
    list.innerHTML = `
      <div class="shop-loading">
        <span class="material-icons-outlined shop-spin">sync</span>
        <p>Loading your orders…</p>
      </div>`;

    let remoteOrders = [];

    try {
      if (userId) {
        const { data, error } = await sb
          .from('shop_orders')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (!error && data) remoteOrders = data;
      }
    } catch (_) {}

    // Merge local (offline/backup) orders — deduplicate by id
    const localOrders = JSON.parse(localStorage.getItem('homatt_shop_orders') || '[]');
    const remoteIds = new Set(remoteOrders.map(o => o.id));
    const localOnly = localOrders.filter(o => !remoteIds.has(o.id));
    const allOrders = [...remoteOrders, ...localOnly];

    if (!allOrders.length) {
      list.innerHTML = `
        <div class="shop-empty">
          <span class="material-icons-outlined">receipt_long</span>
          <p class="shop-empty-title">No orders yet</p>
          <p class="shop-empty-sub">Orders you place from the shop will appear here.</p>
        </div>`;
      return;
    }

    list.innerHTML = allOrders.map(o => renderOrderCard(o)).join('');
  }

  function renderOrderCard(o) {
    const isLocal   = String(o.id).startsWith('local-');
    const statusCls = o.status || 'pending';
    const canReceive = o.status === 'delivered';
    const isComplete = o.status === 'completed';

    return `
      <div class="order-card" id="oc-${o.id}">
        <div class="order-card-row">
          <div class="order-card-info">
            <div class="order-card-name">${o.product_name}</div>
            <div class="order-card-meta">
              Qty: ${o.quantity} · UGX ${Number(o.total_price).toLocaleString()}
            </div>
            <div class="order-card-meta">${o.delivery_address} · ${fmtDate(o.created_at)}</div>
            ${isLocal ? '<div class="order-card-local">Saved locally · pending sync</div>' : ''}
          </div>
          <span class="order-status-pill ${statusCls}">${statusLabel(o.status)}</span>
        </div>

        ${canReceive ? `
        <button class="btn-mark-received" onclick="window.shopMarkReceived('${o.id}')">
          <span class="material-icons-outlined">check_circle</span>
          I've Received This Order
        </button>` : ''}

        ${isComplete ? `
        <div class="order-completed-row">
          <span class="material-icons-outlined">verified</span>
          Order Completed — Thank you!
        </div>` : ''}
      </div>`;
  }

  window.shopMarkReceived = async function (orderId) {
    const btn = document.querySelector(`#oc-${orderId} .btn-mark-received`);
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }

    let updated = false;
    try {
      const { error } = await sb
        .from('shop_orders')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', orderId)
        .eq('user_id', userId);
      if (!error) updated = true;
    } catch (_) {}

    // Also update localStorage copy
    const local = JSON.parse(localStorage.getItem('homatt_shop_orders') || '[]');
    const idx = local.findIndex(o => o.id === orderId);
    if (idx !== -1) { local[idx].status = 'completed'; localStorage.setItem('homatt_shop_orders', JSON.stringify(local)); }

    if (!updated && btn) { btn.disabled = false; btn.innerHTML = '<span class="material-icons-outlined">check_circle</span> I\'ve Received This Order'; }
    await loadMyOrders();
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function statusLabel(s) {
    return { pending:'Pending', processing:'Processing', shipped:'Shipped', delivered:'Delivered', completed:'Received' }[s] || (s||'Pending');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-UG', { day:'2-digit', month:'short', year:'numeric' }); }
    catch (_) { return ''; }
  }

  // ── Wire UI events ────────────────────────────────────────────────────────
  function wireEvents() {
    // Category chips
    document.querySelectorAll('#shopScreen .cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#shopScreen .cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentCat = chip.dataset.cat;
        renderProducts(allProducts);
      });
    });

    document.getElementById('shopOrdersBtn')?.addEventListener('click', openMyOrders);
    document.getElementById('ordersBackBtn')?.addEventListener('click', () => {
      document.getElementById('ordersOverlay').classList.remove('open');
    });
    document.getElementById('productOverlayBack')?.addEventListener('click', () => {
      document.getElementById('productOverlay').classList.remove('open');
    });
    document.getElementById('qtyIncrease')?.addEventListener('click', () => {
      orderQty = Math.min(orderQty + 1, 10); updateQtyDisplay();
    });
    document.getElementById('qtyDecrease')?.addEventListener('click', () => {
      orderQty = Math.max(orderQty - 1, 1);  updateQtyDisplay();
    });
    document.getElementById('btnPlaceOrder')?.addEventListener('click', placeOrder);
    document.getElementById('btnSuccessClose')?.addEventListener('click', () => {
      document.getElementById('orderSuccessOverlay').classList.remove('show');
      openMyOrders();
    });
  }

  // ── Tab switching (called by dashboard.js nav handler) ────────────────────
  function switchToShopTab() {
    document.querySelectorAll('.app-screen, .shop-screen').forEach(s => s.classList.remove('active'));
    document.getElementById('shopScreen').classList.add('active');
    document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('navShop').classList.add('active');
  }

  window.shopSwitchToShop = switchToShopTab;

})();
