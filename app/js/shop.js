/**
 * Homatt Health — Preventive Shop
 * Loads products from Supabase, handles orders, and syncs with admin.
 */

(function () {
  // ── Demo product catalog (used when Supabase returns nothing) ─────────────
  const DEMO_PRODUCTS = [
    { id: 'demo-1', name: 'Mosquito Net',              description: 'Long-lasting insecticidal net (LLIN). Protects the whole family while sleeping. Reduces malaria transmission by up to 90%.', price: 15000, category: 'malaria',    icon: 'bed' },
    { id: 'demo-2', name: 'Mosquito Repellent Spray',  description: 'DEET-free body spray. Effective for 6 hours. Safe for children above 2 years. Pleasant scent.', price: 8000,  category: 'malaria',    icon: 'air' },
    { id: 'demo-3', name: 'Insect Coils (12 pcs)',     description: 'Smoke coils that keep mosquitoes away indoors overnight. One pack lasts up to 12 nights.', price: 3000,  category: 'malaria',    icon: 'local_fire_department' },
    { id: 'demo-4', name: 'Hand Sanitizer 500ml',      description: '70% alcohol-based hand sanitizer. Kills 99.9% of germs without water. Pocket-sized bottle included.', price: 5000,  category: 'hygiene',    icon: 'soap' },
    { id: 'demo-5', name: 'Face Masks (10 pcs)',        description: '3-ply surgical masks. Protection against dust, pollen, and airborne particles. Comfortable ear loops.', price: 6000,  category: 'hygiene',    icon: 'masks' },
    { id: 'demo-6', name: 'ORS Sachets (20 pcs)',       description: 'Oral rehydration salts. Essential for diarrhoea and dehydration recovery. Recommended by WHO.', price: 4000,  category: 'nutrition',  icon: 'water_drop' },
    { id: 'demo-7', name: 'Water Purif. Tablets (50)',  description: 'Purify drinking water in 30 minutes. 1 tablet treats 1 litre of water. Removes bacteria and viruses.', price: 7000,  category: 'hygiene',    icon: 'water' },
    { id: 'demo-8', name: 'Vitamin C 500mg (30 tabs)',  description: 'Daily immune-booster. Supports white blood cell production and helps the body fight off infections.', price: 10000, category: 'nutrition',  icon: 'medication' },
    { id: 'demo-9', name: 'Sunscreen SPF 30 100ml',    description: 'Broad-spectrum sun protection. Reduces skin cancer risk for outdoor workers. Water-resistant for 80 min.', price: 12000, category: 'protection', icon: 'wb_sunny' },
    { id: 'demo-10', name: 'Condoms (3 pcs)',           description: 'High-quality latex condoms. Prevents HIV, STIs, and unwanted pregnancy. WHO pre-qualified.',  price: 2000,  category: 'protection', icon: 'shield' },
  ];

  const CATEGORY_LABELS = {
    all:        { label: 'All Items',    icon: 'apps' },
    malaria:    { label: 'Malaria',      icon: 'bed' },
    hygiene:    { label: 'Hygiene',      icon: 'soap' },
    nutrition:  { label: 'Nutrition',    icon: 'medication' },
    protection: { label: 'Protection',  icon: 'shield' },
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let supabase   = null;
  let allProducts = [];
  let selectedProduct = null;
  let orderQty  = 1;
  let currentCat = 'all';
  let currentUser = null;
  let userId   = null;

  // ── Init (called from dashboard.js after supabase is set up) ──────────────
  window.initShop = async function (sb, session) {
    supabase = sb;
    if (session) {
      userId = session.user.id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone_number, district')
        .eq('id', userId)
        .single();
      if (profile) currentUser = profile;
    }
    await loadProducts();
    wireEvents();
  };

  // ── Load Products ─────────────────────────────────────────────────────────
  async function loadProducts() {
    if (supabase) {
      const { data, error } = await supabase
        .from('preventive_products')
        .select('*')
        .eq('active', true)
        .order('category');
      if (!error && data && data.length > 0) {
        allProducts = data;
        renderProducts(allProducts);
        return;
      }
    }
    // Fallback to demo data
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
          <div class="shop-empty-title">No products found</div>
          <div class="shop-empty-sub">Try a different category</div>
        </div>`;
      return;
    }

    grid.innerHTML = filtered.map(p => `
      <div class="product-card" onclick="window.shopOpenProduct('${p.id}')">
        <div class="product-icon-wrap ${p.category}">
          <span class="material-icons-outlined">${p.icon || 'health_and_safety'}</span>
        </div>
        <div class="product-name">${p.name}</div>
        <div class="product-price">
          UGX ${p.price.toLocaleString()}
          <span class="product-price-label">per unit</span>
        </div>
      </div>
    `).join('');
  }

  // ── Open Product Detail ───────────────────────────────────────────────────
  window.shopOpenProduct = function (id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    selectedProduct = p;
    orderQty = 1;

    const overlay = document.getElementById('productOverlay');
    document.getElementById('detailIcon').className   = `detail-icon-wrap ${p.category}`;
    document.getElementById('detailIconInner').textContent = p.icon || 'health_and_safety';
    document.getElementById('detailName').textContent  = p.name;
    document.getElementById('detailPrice').textContent = 'UGX ' + p.price.toLocaleString();
    document.getElementById('detailDesc').textContent  = p.description;
    document.getElementById('detailCatBadge').className     = `detail-cat-badge ${p.category}`;
    document.getElementById('detailCatBadge').textContent   = CATEGORY_LABELS[p.category]?.label || p.category;
    document.getElementById('overlayTitle').textContent     = p.name;

    // Pre-fill phone from profile
    const phoneInput = document.getElementById('orderPhone');
    if (currentUser?.phone_number && !phoneInput.value) {
      phoneInput.value = currentUser.phone_number;
    }
    const addressInput = document.getElementById('orderAddress');
    if (currentUser?.district && !addressInput.value) {
      addressInput.value = currentUser.district;
    }

    updateQtyDisplay();
    overlay.classList.add('open');
  };

  function updateQtyDisplay() {
    if (!selectedProduct) return;
    document.getElementById('qtyValue').textContent = orderQty;
    document.getElementById('qtyDecrease').disabled = orderQty <= 1;
    const total = selectedProduct.price * orderQty;
    document.getElementById('orderTotalValue').textContent = 'UGX ' + total.toLocaleString();
  }

  // ── Place Order ───────────────────────────────────────────────────────────
  async function placeOrder() {
    if (!selectedProduct) return;

    const address = document.getElementById('orderAddress').value.trim();
    const phone   = document.getElementById('orderPhone').value.trim();

    if (!address || !phone) {
      alert('Please fill in your phone number and delivery address.');
      return;
    }

    const orderBtn = document.getElementById('btnPlaceOrder');
    orderBtn.disabled = true;
    orderBtn.innerHTML = '<span class="material-icons-outlined" style="font-size:18px;animation:spin 1s linear infinite">sync</span> Placing order...';

    const order = {
      user_id:          userId,
      product_id:       selectedProduct.id.startsWith('demo-') ? null : selectedProduct.id,
      product_name:     selectedProduct.name,
      quantity:         orderQty,
      unit_price:       selectedProduct.price,
      total_price:      selectedProduct.price * orderQty,
      delivery_address: address,
      contact_phone:    phone,
      status:           'pending',
    };

    if (supabase && userId) {
      const { error } = await supabase.from('shop_orders').insert([order]);
      if (error) {
        alert('Could not place order. Please try again.');
        orderBtn.disabled = false;
        orderBtn.innerHTML = '<span class="material-icons-outlined">shopping_cart</span> Confirm Order';
        return;
      }
    } else {
      // Offline: save to localStorage
      const localOrders = JSON.parse(localStorage.getItem('homatt_shop_orders') || '[]');
      localOrders.unshift({ ...order, id: 'local-' + Date.now(), created_at: new Date().toISOString() });
      localStorage.setItem('homatt_shop_orders', JSON.stringify(localOrders));
    }

    orderBtn.disabled = false;
    orderBtn.innerHTML = '<span class="material-icons-outlined">shopping_cart</span> Confirm Order';

    // Close detail overlay and show success
    document.getElementById('productOverlay').classList.remove('open');
    showOrderSuccess(selectedProduct.name);
  }

  function showOrderSuccess(productName) {
    const el = document.getElementById('orderSuccessOverlay');
    document.getElementById('successProductName').textContent = productName;
    el.classList.add('show');
  }

  // ── My Orders ─────────────────────────────────────────────────────────────
  async function openMyOrders() {
    const overlay = document.getElementById('ordersOverlay');
    overlay.classList.add('open');
    await loadMyOrders();
  }

  async function loadMyOrders() {
    const list = document.getElementById('myOrdersList');
    list.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-hint)"><span class="material-icons-outlined" style="font-size:36px">sync</span><br>Loading orders...</div>';

    let orders = [];

    if (supabase && userId) {
      const { data, error } = await supabase
        .from('shop_orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (!error && data) orders = data;
    }

    // Merge with any local (offline) orders
    const localOrders = JSON.parse(localStorage.getItem('homatt_shop_orders') || '[]');
    orders = [...localOrders, ...orders];

    if (!orders.length) {
      list.innerHTML = `
        <div class="shop-empty">
          <span class="material-icons-outlined">receipt_long</span>
          <div class="shop-empty-title">No orders yet</div>
          <div class="shop-empty-sub">Your preventive product orders will appear here once you place one.</div>
        </div>`;
      return;
    }

    list.innerHTML = orders.map(o => `
      <div class="order-card" id="order-card-${o.id}">
        <div class="order-card-top">
          <div>
            <div class="order-card-name">${o.product_name}</div>
            <div class="order-card-id">#${String(o.id).slice(0, 8).toUpperCase()}</div>
          </div>
          <span class="order-status-badge ${o.status}">${statusLabel(o.status)}</span>
        </div>
        <div class="order-card-details">
          Qty: ${o.quantity} · Address: ${o.delivery_address}<br>
          Phone: ${o.contact_phone || '—'} · ${fmtDate(o.created_at)}
        </div>
        <div class="order-card-total">UGX ${o.total_price.toLocaleString()}</div>
        ${o.status === 'delivered'
          ? `<button class="btn-mark-received" onclick="window.shopMarkReceived('${o.id}')">
               <span class="material-icons-outlined" style="font-size:16px">check_circle</span>
               Mark as Received
             </button>`
          : ''}
        ${o.status === 'completed'
          ? `<div style="display:flex;align-items:center;gap:6px;margin-top:8px;color:#2E7D32;font-size:12px;font-weight:600">
               <span class="material-icons-outlined" style="font-size:16px">verified</span> Order Completed
             </div>`
          : ''}
      </div>
    `).join('');
  }

  window.shopMarkReceived = async function (orderId) {
    if (!confirm('Confirm you have received this order?')) return;

    if (supabase && userId) {
      const { error } = await supabase
        .from('shop_orders')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', orderId)
        .eq('user_id', userId);
      if (error) { alert('Could not update. Please try again.'); return; }
    } else {
      const localOrders = JSON.parse(localStorage.getItem('homatt_shop_orders') || '[]');
      const idx = localOrders.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        localOrders[idx].status = 'completed';
        localStorage.setItem('homatt_shop_orders', JSON.stringify(localOrders));
      }
    }
    await loadMyOrders();
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function statusLabel(s) {
    const map = {
      pending: 'Pending', processing: 'Processing',
      shipped: 'Shipped', delivered: 'Delivered', completed: 'Received',
    };
    return map[s] || s;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-UG', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── Wire all events ───────────────────────────────────────────────────────
  function wireEvents() {
    // Category chips
    document.querySelectorAll('.cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentCat = chip.dataset.cat;
        renderProducts(allProducts);
      });
    });

    // My orders button
    document.getElementById('shopOrdersBtn')?.addEventListener('click', openMyOrders);

    // Orders overlay back
    document.getElementById('ordersBackBtn')?.addEventListener('click', () => {
      document.getElementById('ordersOverlay').classList.remove('open');
    });

    // Product overlay back
    document.getElementById('productOverlayBack')?.addEventListener('click', () => {
      document.getElementById('productOverlay').classList.remove('open');
    });

    // Qty controls
    document.getElementById('qtyIncrease')?.addEventListener('click', () => {
      orderQty = Math.min(orderQty + 1, 10);
      updateQtyDisplay();
    });
    document.getElementById('qtyDecrease')?.addEventListener('click', () => {
      orderQty = Math.max(orderQty - 1, 1);
      updateQtyDisplay();
    });

    // Place order
    document.getElementById('btnPlaceOrder')?.addEventListener('click', placeOrder);

    // Success overlay close
    document.getElementById('btnSuccessClose')?.addEventListener('click', () => {
      document.getElementById('orderSuccessOverlay').classList.remove('show');
      openMyOrders();
    });

    // Malaria alert → shop
    document.getElementById('malariaAlert')?.addEventListener('click', () => {
      switchToShopTab();
      // Pre-select malaria category
      document.querySelectorAll('.cat-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.cat === 'malaria');
      });
      currentCat = 'malaria';
      renderProducts(allProducts);
    });
  }

  // ── Tab switching helper (used internally) ────────────────────────────────
  function switchToShopTab() {
    document.querySelectorAll('.app-screen, .shop-screen').forEach(s => s.classList.remove('active'));
    document.getElementById('shopScreen').classList.add('active');
    document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('navShop').classList.add('active');
  }

  // Expose for dashboard.js nav handler
  window.shopSwitchToShop = switchToShopTab;
})();
