/**
 * Homatt Health — Family Health Hub
 * Manages: Members, Prescriptions, Prevention Marketplace
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
  let user = JSON.parse(localStorage.getItem('homatt_user') || '{}');
  let familyMembers = [];
  let prescriptions = [];
  let categories = [];
  let items = [];
  let cart = JSON.parse(localStorage.getItem('homatt_cart') || '[]');
  let selectedCategoryId = null;
  let activeSheetMemberId = null;
  let logEventForMemberId = null;
  let noSmartphoneOn = false;
  let selectedRelationship = '';
  let selectedSex = '';
  let selectedChronicConditions = [];
  let selectedDrugForm = '';
  let selectedReminderTimes = [];
  let selectedEventType = '';

  // ====== Render from cache immediately (no waiting) ======
  function renderPrimaryCard(u) {
    const initial = (u.firstName || 'U').charAt(0).toUpperCase();
    const avatarEl = document.getElementById('primaryMemberAvatar');
    if (u.avatarUrl) {
      avatarEl.innerHTML = `<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      avatarEl.textContent = initial;
    }
    document.getElementById('primaryMemberName').textContent =
      `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'You';
    const loc = [u.district, u.city].filter(Boolean).join(', ') || 'Uganda';
    document.getElementById('primaryLocText').textContent = loc;
  }
  renderPrimaryCard(user);

  // Show skeleton while data loads
  document.getElementById('familyMembersList').innerHTML =
    '<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div>';
  document.getElementById('prescriptionsList').innerHTML =
    '<div class="skeleton skeleton-card"></div>';
  document.getElementById('familyHeaderSub').textContent = 'Loading...';

  // ====== Tab Navigation ======
  const tabs = document.querySelectorAll('.tracker-tab');
  const panes = document.querySelectorAll('.family-pane');

  function activateTab(target) {
    tabs.forEach(t => t.classList.remove('active'));
    panes.forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`.tracker-tab[data-tab="${target}"]`);
    if (tab) tab.classList.add('active');
    const pane = document.getElementById('pane-' + target);
    if (pane) pane.classList.add('active');
    // Close any open sheets and health log panel when switching tabs
    const overlayEl = document.getElementById('sheetOverlay');
    if (overlayEl) overlayEl.classList.remove('visible');
    document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
    closeMemberDetail();

    // Cart FAB only on shop tab
    const cartFab = document.getElementById('cartFab');
    if (target === 'shop') {
      cartFab.classList.add('visible');
      if (categories.length === 0) loadShop();
      // Bottom nav: Shop active
      document.getElementById('bottomNavFamily').classList.remove('active');
      document.getElementById('bottomNavShop').classList.add('active');
    } else {
      cartFab.classList.remove('visible');
      // Bottom nav: Family active
      document.getElementById('bottomNavFamily').classList.add('active');
      document.getElementById('bottomNavShop').classList.remove('active');
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  // Bottom nav clicks
  document.getElementById('bottomNavFamily').addEventListener('click', () => activateTab('members'));
  document.getElementById('bottomNavShop').addEventListener('click', () => activateTab('shop'));

  // Auto-activate shop tab if #shop hash in URL
  const startTab = window.location.hash === '#shop' ? 'shop' : 'members';
  activateTab(startTab);

  // ====== Load family members ======
  async function loadMembers() {
    const { data } = await supabase
      .from('family_members')
      .select('*')
      .eq('primary_user_id', userId)
      .order('created_at', { ascending: true });

    familyMembers = data || [];
    renderMembers();

    // Update header subtitle
    const count = familyMembers.length;
    document.getElementById('familyHeaderSub').textContent =
      count === 0 ? 'No family members added yet' : `${count} member${count > 1 ? 's' : ''} in your family`;

    // Update Rx member selector
    updateRxMemberSelector();
  }

  function renderMembers() {
    const listEl = document.getElementById('familyMembersList');
    if (familyMembers.length === 0) {
      listEl.innerHTML = `
        <div class="members-empty">
          <span class="material-icons-outlined">family_restroom</span>
          No family members added yet.<br>Add members to manage their health together.
        </div>`;
      return;
    }

    listEl.innerHTML = familyMembers.map(m => buildMemberCard(m)).join('');

    // Bind events on cards
    familyMembers.forEach(m => {
      const card = document.getElementById(`mc-${m.id}`);
      if (!card) return;

      card.querySelector('.fmc-view-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openMemberDetail(m);
      });

      card.querySelector('.fmc-act-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openActionSheet(m);
      });

      // Avatar photo upload on tap
      const avatarEl = document.getElementById(`fmc-avatar-${m.id}`);
      if (avatarEl) {
        avatarEl.addEventListener('click', (e) => {
          e.stopPropagation();
          uploadMemberAvatar(m);
        });
      }
    });
  }

  function buildMemberCard(m) {
    const dobAge = m.dob ? calcAge(m.dob) : null;
    const isChild = dobAge !== null && dobAge < 15;
    const relClass = { spouse:'rel-spouse', child:'rel-child', parent:'rel-parent', sibling:'rel-sibling', other:'rel-other' }[m.relationship] || 'rel-other';
    const relLabel = m.relationship ? m.relationship.charAt(0).toUpperCase() + m.relationship.slice(1) : 'Member';
    const initial = m.name ? m.name.charAt(0).toUpperCase() : '?';
    const avatarContent = m.avatar_url
      ? `<img src="${m.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : initial;
    const ageText = dobAge !== null ? `${dobAge} yrs` : '';

    // Medication adherence (placeholder — real data from prescription_doses)
    const adherencePct = getAdherancePct(m.id);

    return `
      <div class="family-member-card" id="mc-${m.id}">
        <div class="fmc-top">
          <div class="fmc-avatar" style="overflow:hidden;cursor:pointer" id="fmc-avatar-${m.id}">${avatarContent}</div>
          <div style="flex:1">
            <div class="fmc-name">${escHtml(m.name)}${ageText ? ` <span style="font-size:12px;font-weight:400;color:var(--text-hint)">${ageText}</span>` : ''}</div>
            <span class="fmc-rel-chip ${relClass}">${relLabel}</span>
          </div>
        </div>
        <div class="fmc-meta">
          ${m.location ? `<span class="fmc-meta-chip"><span class="material-icons-outlined">location_on</span>${escHtml(m.location)}</span>` : ''}
          ${m.sex ? `<span class="fmc-meta-chip">${m.sex === 'male' ? '♂' : '♀'} ${m.sex.charAt(0).toUpperCase() + m.sex.slice(1)}</span>` : ''}
          ${isChild ? `<span class="vaccination-alert-chip"><span class="material-icons-outlined">vaccines</span>Check vaccines</span>` : ''}
          ${m.no_smartphone ? `<span class="no-smartphone-chip"><span class="material-icons-outlined">smartphone</span>No Smartphone</span>` : ''}
        </div>
        ${m.chronic_conditions && m.chronic_conditions.filter(c => c !== 'none').length > 0 ?
          `<div style="font-size:11px;color:var(--text-hint);margin-bottom:8px">
            <span class="material-icons-outlined" style="font-size:13px;vertical-align:middle">medical_information</span>
            ${m.chronic_conditions.filter(c => c !== 'none').join(', ')}
          </div>` : ''}
        <div class="adherence-row">
          <div class="adherence-label">
            <span>Medication Adherence</span>
            <span>${adherencePct}%</span>
          </div>
          <div class="adherence-bar-wrap">
            <div class="adherence-bar-fill" style="width:${adherencePct}%"></div>
          </div>
        </div>
        <div class="fmc-actions">
          <button class="fmc-view-btn">
            <span class="material-icons-outlined">history</span>
            Health Log
          </button>
          <button class="fmc-act-btn">
            <span class="material-icons-outlined">bolt</span>
            Act
          </button>
        </div>
      </div>`;
  }

  // ====== Member Photo Upload ======
  async function uploadMemberAvatar(member) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB'); return; }

      showToast('Uploading photo...');
      const ext = file.name.split('.').pop();
      const path = `${userId}/${member.id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('member-avatars')
        .upload(path, file, { upsert: true });

      if (uploadError) { showToast('Upload failed: ' + uploadError.message); return; }

      const { data: { publicUrl } } = supabase.storage.from('member-avatars').getPublicUrl(path);

      await supabase.from('family_members').update({ avatar_url: publicUrl }).eq('id', member.id);

      // Update local data and re-render
      const idx = familyMembers.findIndex(m => m.id === member.id);
      if (idx !== -1) familyMembers[idx].avatar_url = publicUrl;
      renderMembers();
      showToast('Photo updated!');
    };
    input.click();
  }

  function calcAge(dob) {
    const today = new Date();
    const birth = new Date(dob);
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    return age;
  }

  function getAdherancePct(memberId) {
    // Returns adherence from prescription_doses data (stored in localStorage per member as cache)
    const cache = JSON.parse(localStorage.getItem('homatt_adherence') || '{}');
    return cache[memberId] !== undefined ? cache[memberId] : 0;
  }

  // ====== Load profile + members + prescriptions in PARALLEL ======
  const [profileResult] = await Promise.all([
    supabase.from('profiles').select('first_name,last_name,district,city,avatar_url').eq('id', userId).single(),
    loadMembers(),
    loadPrescriptions(),
  ]);
  if (profileResult.data) {
    const p = profileResult.data;
    user = { ...user, firstName: p.first_name, lastName: p.last_name,
      district: p.district, city: p.city, avatarUrl: p.avatar_url };
    localStorage.setItem('homatt_user', JSON.stringify(user));
    renderPrimaryCard(user);
  }

  // ====== Prescriptions ======
  async function loadPrescriptions() {
    const { data } = await supabase
      .from('prescriptions')
      .select('*, family_members(name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    prescriptions = data || [];
    renderPrescriptions();
  }

  function renderPrescriptions() {
    const listEl = document.getElementById('prescriptionsList');
    if (prescriptions.length === 0) {
      listEl.innerHTML = `
        <div class="members-empty" style="padding:32px 0">
          <span class="material-icons-outlined">medication</span>
          No prescriptions yet.<br>Add a doctor-prescribed medication to track adherence.
        </div>`;
      return;
    }

    listEl.innerHTML = prescriptions.map(rx => buildRxCard(rx)).join('');

    // Bind mark-taken buttons
    prescriptions.forEach(rx => {
      const btn = document.getElementById(`rx-taken-${rx.id}`);
      if (btn) btn.addEventListener('click', () => markDoseTaken(rx));
    });
  }

  function buildRxCard(rx) {
    const statusClass = { active:'rx-status-active', completed:'rx-status-completed', paused:'rx-status-paused', cancelled:'rx-status-cancelled' }[rx.status] || 'rx-status-active';
    const statusIcon = { active:'check_circle', completed:'task_alt', paused:'pause_circle', cancelled:'cancel' }[rx.status] || 'check_circle';

    const startDate = rx.start_date ? new Date(rx.start_date).toLocaleDateString('en-UG',{month:'short',day:'numeric'}) : '—';
    const endDate = rx.end_date ? new Date(rx.end_date).toLocaleDateString('en-UG',{month:'short',day:'numeric'}) : '—';

    const daysLeft = rx.end_date ? Math.ceil((new Date(rx.end_date) - new Date()) / 86400000) : null;
    const daysUrgent = daysLeft !== null && daysLeft <= 3;

    const forName = rx.family_members ? rx.family_members.name : 'Self';
    const reminders = (rx.reminder_times || []).map(t => {
      const labels = { morning:'7AM', midday:'12PM', afternoon:'3PM', evening:'7PM', bedtime:'10PM' };
      return `<span class="rx-reminder-chip">${labels[t] || t}</span>`;
    }).join('');

    return `
      <div class="rx-card">
        <div class="rx-card-header">
          <div>
            <div class="rx-drug-name">${escHtml(rx.drug_name)}${rx.dosage ? ` <span style="font-size:12px;font-weight:400;color:var(--text-hint)">${rx.dosage}</span>` : ''}</div>
            <div class="rx-manufacturer">${rx.manufacturer || ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <span class="rx-status-badge ${statusClass}">
              <span class="material-icons-outlined" style="font-size:13px">${statusIcon}</span>
              ${rx.status.charAt(0).toUpperCase() + rx.status.slice(1)}
            </span>
            ${rx.admin_verified
              ? `<span class="verified-badge"><span class="material-icons-outlined">verified</span>Verified</span>`
              : `<span class="unverified-badge"><span class="material-icons-outlined">pending</span>Pending Review</span>`}
          </div>
        </div>
        <div class="rx-body">
          <div class="rx-for-row">
            <span class="material-icons-outlined">person</span>
            <span>For: <strong>${escHtml(forName)}</strong></span>
            ${rx.prescribing_doctor ? `<span style="margin-left:auto;font-size:11px;color:var(--text-hint)">Dr. ${escHtml(rx.prescribing_doctor)}</span>` : ''}
          </div>
          <div class="rx-detail-grid">
            <div class="rx-detail-item">
              <div class="rx-detail-label">Drug Form</div>
              <div class="rx-detail-value">${rx.drug_form ? rx.drug_form.charAt(0).toUpperCase()+rx.drug_form.slice(1) : '—'}</div>
            </div>
            <div class="rx-detail-item">
              <div class="rx-detail-label">Frequency</div>
              <div class="rx-detail-value">${formatFrequency(rx.frequency)}</div>
            </div>
            <div class="rx-detail-item">
              <div class="rx-detail-label">Start</div>
              <div class="rx-detail-value">${startDate}</div>
            </div>
            <div class="rx-detail-item">
              <div class="rx-detail-label">End</div>
              <div class="rx-detail-value">${endDate}</div>
            </div>
          </div>
          ${rx.quantity ? `
          <div class="rx-detail-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:10px">
            <div class="rx-detail-item">
              <div class="rx-detail-label">Total</div>
              <div class="rx-detail-value">${rx.quantity}</div>
            </div>
            <div class="rx-detail-item">
              <div class="rx-detail-label">Remaining</div>
              <div class="rx-detail-value">${rx.quantity_remaining ?? rx.quantity}</div>
            </div>
            <div class="rx-detail-item">
              <div class="rx-detail-label">Unit</div>
              <div class="rx-detail-value">${rx.drug_form || 'units'}</div>
            </div>
          </div>` : ''}
          ${daysLeft !== null ? `
          <div class="rx-days-remaining ${daysUrgent ? 'urgent' : ''}">
            ${daysLeft <= 0
              ? `<strong>Prescription expired</strong>`
              : `<strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining</strong>`}
            ${daysUrgent && daysLeft > 0 ? ' — Refill soon' : ''}
          </div>` : ''}
          ${reminders ? `<div class="rx-reminder-row"><span class="material-icons-outlined" style="font-size:16px;color:var(--text-hint)">alarm</span>${reminders}</div>` : ''}
          ${rx.notes ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;padding:8px;background:var(--background);border-radius:6px">${escHtml(rx.notes)}</div>` : ''}
          ${rx.status === 'active' ? `
          <button class="mark-taken-btn" id="rx-taken-${rx.id}">
            <span class="material-icons-outlined">check_circle</span>
            Mark Dose Taken Now
          </button>` : ''}
        </div>
      </div>`;
  }

  function formatFrequency(freq) {
    const map = { once_daily:'Once daily', twice_daily:'Twice daily', three_times:'3× daily', four_times:'4× daily', as_needed:'As needed', weekly:'Weekly' };
    return map[freq] || (freq || '—');
  }

  async function markDoseTaken(rx) {
    const btn = document.getElementById(`rx-taken-${rx.id}`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-icons-outlined">hourglass_empty</span> Saving...'; }

    await supabase.from('prescription_doses').insert({
      prescription_id: rx.id,
      user_id: userId,
      taken: true,
      taken_at: new Date().toISOString(),
    });

    // Decrement quantity_remaining if tracked
    if (rx.quantity_remaining !== null && rx.quantity_remaining > 0) {
      await supabase.from('prescriptions')
        .update({ quantity_remaining: rx.quantity_remaining - 1 })
        .eq('id', rx.id);
    }

    await loadPrescriptions();
    showToast('Dose marked as taken!');
  }

  // ====== Shop / Marketplace ======
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
    let query = supabase.from('marketplace_items').select('*, marketplace_categories(name,icon,color)').eq('active', true);
    if (categoryId) query = query.eq('category_id', categoryId);
    query = query.order('featured', { ascending: false }).order('sort_order');

    const { data } = await query;
    items = data || [];

    // Apply search filter
    const searchTerm = document.getElementById('shopSearch').value.toLowerCase();
    const filtered = searchTerm ? items.filter(i => i.name.toLowerCase().includes(searchTerm) || (i.description || '').toLowerCase().includes(searchTerm)) : items;

    renderItems(filtered);
  }

  function renderItems(itemList) {
    const grid = document.getElementById('itemsGrid');
    if (itemList.length === 0) {
      grid.innerHTML = `
        <div style="grid-column:span 2;text-align:center;padding:32px 20px;color:var(--text-hint);font-size:13px">
          <span class="material-icons-outlined" style="font-size:40px;color:var(--border);display:block;margin-bottom:8px">search_off</span>
          No products found
        </div>`;
      return;
    }

    grid.innerHTML = itemList.map(item => {
      const catColor = (item.marketplace_categories && item.marketplace_categories.color) || '#388E3C';
      const catIcon = (item.marketplace_categories && item.marketplace_categories.icon) || 'medical_services';
      const inCart = cart.some(c => c.id === item.id);

      return `
        <div class="item-card" data-item-id="${item.id}">
          ${item.featured ? `<span class="item-featured-badge">⭐ Featured</span>` : ''}
          <div class="item-icon-wrap" style="background:linear-gradient(135deg,${catColor},${catColor}cc)">
            <span class="material-icons-outlined">${catIcon}</span>
          </div>
          <div class="item-name">${escHtml(item.name)}</div>
          ${item.manufacturer ? `<div class="item-manufacturer">${escHtml(item.manufacturer)}</div>` : ''}
          <div class="item-price">UGX ${Number(item.price).toLocaleString()} <small>/ ${item.unit || 'piece'}</small></div>
          <span class="item-stock-badge ${item.in_stock ? 'in' : 'out'}">${item.in_stock ? '✓ In Stock' : '✗ Out of Stock'}</span>
          <button class="add-to-cart-btn" data-item-id="${item.id}" ${!item.in_stock ? 'disabled' : ''}>
            <span class="material-icons-outlined">${inCart ? 'shopping_cart' : 'add_shopping_cart'}</span>
            ${inCart ? 'In Cart' : 'Add to Cart'}
          </button>
        </div>`;
    }).join('');

    grid.querySelectorAll('.add-to-cart-btn').forEach(btn => {
      btn.addEventListener('click', () => addToCart(btn.dataset.itemId));
    });
  }

  // Cart
  function addToCart(itemId) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const existing = cart.find(c => c.id === itemId);
    if (existing) {
      existing.qty++;
    } else {
      cart.push({ id: item.id, name: item.name, price: item.price, qty: 1,
        unit: item.unit, icon: (item.marketplace_categories && item.marketplace_categories.icon) || 'medical_services',
        color: (item.marketplace_categories && item.marketplace_categories.color) || '#388E3C' });
    }

    localStorage.setItem('homatt_cart', JSON.stringify(cart));
    updateCartBadge();
    // Re-render from cached items only — no DB fetch on every tap (prevents slowness)
    const searchTerm = (document.getElementById('shopSearch') || {}).value || '';
    const term = searchTerm.toLowerCase();
    const filtered = term ? items.filter(i => i.name.toLowerCase().includes(term) || (i.description || '').toLowerCase().includes(term)) : items;
    renderItems(filtered);
    showToast(`${item.name} added to cart`);
  }

  function updateCartBadge() {
    const total = cart.reduce((s, c) => s + c.qty, 0);
    const badge = document.getElementById('cartBadgeDot');
    badge.textContent = total;
    badge.classList.toggle('visible', total > 0);
  }

  updateCartBadge();

  // Cart sheet
  document.getElementById('cartFab').addEventListener('click', openCartSheet);

  function openCartSheet() {
    const listEl = document.getElementById('cartItemsList');
    const totalRow = document.getElementById('cartTotalRow');
    const checkoutArea = document.getElementById('cartCheckoutArea');

    if (cart.length === 0) {
      listEl.innerHTML = `<div class="cart-empty"><span class="material-icons-outlined">shopping_cart</span>Your cart is empty</div>`;
      totalRow.style.display = 'none';
      checkoutArea.style.display = 'none';
    } else {
      listEl.innerHTML = cart.map(item => `
        <div class="cart-item">
          <div class="cart-item-icon" style="background:${item.color}">
            <span class="material-icons-outlined">${item.icon}</span>
          </div>
          <div class="cart-item-body">
            <div class="cart-item-name">${escHtml(item.name)}</div>
            <div class="cart-item-price">UGX ${Number(item.price).toLocaleString()} / ${item.unit}</div>
          </div>
          <div class="cart-qty-control">
            <button class="cart-qty-btn" data-cart-id="${item.id}" data-action="dec">−</button>
            <span class="cart-qty-val">${item.qty}</span>
            <button class="cart-qty-btn" data-cart-id="${item.id}" data-action="inc">+</button>
          </div>
        </div>`).join('');

      const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
      const curDeliveryFee = _nearestPharmacy ? calcDeliveryFee(_nearestPharmacy.distanceKm) : 2000;
      document.getElementById('cartSubtotal').textContent = subtotal.toLocaleString();
      document.getElementById('cartDeliveryFee').textContent = curDeliveryFee.toLocaleString();
      document.getElementById('cartTotal').textContent = (subtotal + curDeliveryFee).toLocaleString();

      // Show nearest pharmacy info
      const pharmInfo = document.getElementById('cartPharmacyInfo');
      if (_nearestPharmacy && pharmInfo) {
        pharmInfo.style.display = 'block';
        pharmInfo.innerHTML = `<span class="material-icons-outlined" style="font-size:13px;vertical-align:middle;margin-right:3px">local_pharmacy</span>
          Routed to: <strong>${_nearestPharmacy.name}</strong> — ${_nearestPharmacy.distanceKm.toFixed(1)} km away`;
      } else if (pharmInfo) {
        pharmInfo.style.display = 'none';
        // Trigger async pharmacy lookup in background (updates on next cart open)
        getUserCoords().then(coords => {
          if (coords) findNearestPharmacy(coords[0], coords[1]);
        });
      }

      totalRow.style.display = 'block';
      checkoutArea.style.display = 'block';

      listEl.querySelectorAll('.cart-qty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.cartId;
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
          openCartSheet();
        });
      });
    }

    openSheet(document.getElementById('cartSheet'));
  }

  // ====== Pharmacy Routing Helpers ======

  // Uganda district approximate coordinates (lat, lon)
  const DISTRICT_COORDS = {
    'kampala':       [0.3163, 32.5822], 'wakiso':        [0.4000, 32.4500],
    'mukono':        [0.3540, 32.7550], 'jinja':         [0.4244, 33.2041],
    'mbale':         [1.0800, 34.1750], 'gulu':          [2.7747, 32.2990],
    'mbarara':      [-0.6167, 30.6500], 'fort portal':   [0.6710, 30.2750],
    'arua':          [3.0200, 30.9100], 'lira':          [2.2499, 32.8999],
    'soroti':        [1.7150, 33.6110], 'kabale':       [-1.2480, 29.9890],
    'masaka':       [-0.3350, 31.7350], 'tororo':        [0.6920, 34.1810],
    'entebbe':       [0.0600, 32.4600], 'ntinda':        [0.3600, 32.6200],
    'nansana':       [0.3700, 32.5100], 'kireka':        [0.3500, 32.6500],
    'kyanja':        [0.3900, 32.6300], 'namugongo':     [0.3700, 32.6600],
    'najjera':       [0.3500, 32.6400], 'kira':          [0.4100, 32.6400],
    'bweyogerere':   [0.3300, 32.6700], 'namasuba':      [0.2800, 32.5400],
    'makindye':      [0.2900, 32.6000], 'rubaga':        [0.3100, 32.5500],
    'kawempe':       [0.3700, 32.5500], 'nakawa':        [0.3200, 32.6200],
  };

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // Compute delivery fee: 2000 UGX base + 500/km, rounded to nearest 500
  function calcDeliveryFee(distanceKm) {
    const fee = 2000 + Math.round(distanceKm) * 500;
    return Math.max(2000, Math.round(fee / 500) * 500);
  }

  // Cache for nearest pharmacy result
  let _nearestPharmacy = null;

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

  // ====== Checkout — Place Order ======
  window.submitOrder = async function() {
    const addr = (document.getElementById('cartDeliveryAddress')?.value || '').trim();
    if (!addr) {
      showToast('Please enter your delivery address');
      document.getElementById('cartDeliveryAddress')?.focus();
      return;
    }
    if (cart.length === 0) return;

    // ── Self-medication frequency guard ─────────────────────────
    // Check how many orders this user has placed in the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentOrders } = await supabase
      .from('marketplace_orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', sevenDaysAgo);
    const recentCount = (recentOrders || []).length;

    if (recentCount >= 5) {
      // Hard block — too many orders, must see clinic
      closeAllSheets();
      document.getElementById('clinicReferralBanner') &&
        (document.getElementById('clinicReferralBanner').style.display = 'block');
      showToast('You have ordered medicine 5+ times this week. Please visit a clinic for a proper check-up.');
      // Also show a modal-like warning
      const blocked = confirm(
        'You have placed ' + recentCount + ' medicine orders in the last 7 days.\n\n' +
        'Frequent self-medication can be harmful.\n\n' +
        'We strongly recommend visiting a clinic for a proper diagnosis before ordering more medicine.\n\n' +
        'Press OK to go to clinic booking, or Cancel to go back.'
      );
      if (blocked) window.location.href = 'clinic-booking.html';
      return;
    }

    if (recentCount >= 3) {
      // Soft warning — require confirmation
      const proceed = confirm(
        'You have ordered medicine ' + recentCount + ' times in the last 7 days.\n\n' +
        'Repeated self-medication without a proper diagnosis can be dangerous.\n\n' +
        'We recommend visiting a clinic for a check-up. Do you still want to place this order?'
      );
      if (!proceed) return;
    }
    // ────────────────────────────────────────────────────────────

    const btn = document.getElementById('cartCheckoutBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }

    const itemsTotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
    const itemsPayload = cart.map(c => ({ id: c.id, name: c.name, price: c.price, qty: c.qty, unit: c.unit || '' }));

    // Get user profile for name/phone/location
    let patientName = 'Customer', patientPhone = null, userDistrict = null;
    try {
      const { data: prof } = await supabase.from('profiles').select('first_name,last_name,phone,district').eq('id', userId).single();
      if (prof) {
        patientName = ((prof.first_name || '') + ' ' + (prof.last_name || '')).trim() || 'Customer';
        patientPhone = prof.phone || null;
        userDistrict = prof.district || null;
      }
    } catch(e) {}

    // Determine user coordinates for pharmacy routing
    let userLat = null, userLon = null;
    const gpsCoords = await getUserCoords();
    if (gpsCoords) {
      [userLat, userLon] = gpsCoords;
    } else if (userDistrict) {
      const key = userDistrict.toLowerCase();
      const dc = DISTRICT_COORDS[key] || DISTRICT_COORDS[addr.toLowerCase().split(',')[0].trim()];
      if (dc) [userLat, userLon] = dc;
    }

    // Find nearest pharmacy and compute delivery fee
    let pharmacyId = null, deliveryFee = 2000;
    if (userLat && userLon) {
      const nearest = await findNearestPharmacy(userLat, userLon);
      if (nearest) {
        pharmacyId = nearest.id;
        deliveryFee = calcDeliveryFee(nearest.distanceKm);
      }
    }

    const total = itemsTotal + deliveryFee;

    // Save order to marketplace_orders
    const orderPayload = {
      user_id: userId,
      patient_name: patientName,
      patient_phone: patientPhone,
      delivery_address: addr,
      items: itemsPayload,
      total_amount: total,
      status: 'pending',
      payment_method: 'cash_on_delivery',
      pharmacy_id: pharmacyId,
      delivery_fee: deliveryFee,
      user_latitude: userLat,
      user_longitude: userLon,
    };

    const { error: orderErr } = await supabase.from('marketplace_orders').insert(orderPayload);

    if (orderErr) {
      showToast('Order failed: ' + orderErr.message);
      if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-icons-outlined">shopping_bag</span> Place Order'; }
      return;
    }

    // Deduct stock for each item (best-effort, ignore errors)
    try {
      for (const item of cart) {
        await supabase.rpc('deduct_stock', { item_id: item.id, qty: item.qty });
      }
    } catch(e) {}

    // Clear cart and close ALL panels including health log
    cart = [];
    localStorage.removeItem('homatt_cart');
    updateCartBadge();
    closeAllSheets(); // also calls closeMemberDetail() internally
    showToast(`Order placed! Delivery fee: UGX ${deliveryFee.toLocaleString()}. We will call to confirm.`);
  };

  // ====== Sheet / Overlay Management ======
  const overlay = document.getElementById('sheetOverlay');

  function openSheet(sheet) {
    document.querySelectorAll('.bottom-sheet').forEach(s => {
      if (s !== sheet) s.classList.remove('open');
    });
    // Immediately hide the member-detail panel — no transition delay so it
    // cannot bleed through the top of the cart/action sheet.
    const detailPanel = document.getElementById('memberDetailPanel');
    if (detailPanel) {
      detailPanel.classList.remove('open');
      detailPanel.style.display = 'none';
    }
    overlay.classList.add('visible');
    sheet.classList.add('open');
  }

  function closeAllSheets() {
    overlay.classList.remove('visible');
    document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
    // Always close the health-log panel (not a .bottom-sheet, but must be hidden)
    closeMemberDetail();
  }

  overlay.addEventListener('click', closeAllSheets);

  // Close buttons
  ['closeAddMemberSheet','closeActionSheet','closeAddRxSheet','closeLogEventSheet','closeCartSheet'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', closeAllSheets);
  });

  // ====== Add Member Sheet ======
  ['addMemberBtn','addMemberHeaderBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => {
      resetAddMemberForm();
      openSheet(document.getElementById('addMemberSheet'));
    });
  });

  function resetAddMemberForm() {
    document.getElementById('memberName').value = '';
    document.getElementById('memberRelationship').value = '';
    document.getElementById('memberDobDay').value = '';
    document.getElementById('memberDobMonth').value = '';
    document.getElementById('memberDobYear').value = '';
    document.getElementById('memberSex').value = '';
    document.getElementById('memberLocation').value = '';
    document.getElementById('memberMedications').value = '';
    document.getElementById('memberAllergies').value = '';
    selectedRelationship = '';
    selectedSex = '';
    selectedChronicConditions = [];
    noSmartphoneOn = false;
    document.getElementById('noSmartphoneToggle').classList.remove('on');
    document.querySelectorAll('#relChipGroup .sheet-chip').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('#chronicGroup .sheet-chip').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.sheet-sex-btn').forEach(b => b.classList.remove('selected'));
  }

  // Relationship chips
  document.querySelectorAll('#relChipGroup .sheet-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#relChipGroup .sheet-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedRelationship = chip.dataset.val;
      document.getElementById('memberRelationship').value = selectedRelationship;
    });
  });

  // Sex buttons
  document.getElementById('memberSexMale').addEventListener('click', () => {
    selectedSex = 'male';
    document.getElementById('memberSexMale').classList.add('selected');
    document.getElementById('memberSexFemale').classList.remove('selected');
    document.getElementById('memberSex').value = 'male';
  });
  document.getElementById('memberSexFemale').addEventListener('click', () => {
    selectedSex = 'female';
    document.getElementById('memberSexFemale').classList.add('selected');
    document.getElementById('memberSexMale').classList.remove('selected');
    document.getElementById('memberSex').value = 'female';
  });

  // Chronic conditions chips (multi-select)
  document.querySelectorAll('#chronicGroup .sheet-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.dataset.val;
      if (val === 'none') {
        // deselect all others
        document.querySelectorAll('#chronicGroup .sheet-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedChronicConditions = ['none'];
        return;
      }
      // remove 'none' if selected
      const noneChip = document.querySelector('#chronicGroup .sheet-chip[data-val="none"]');
      if (noneChip) noneChip.classList.remove('selected');
      selectedChronicConditions = selectedChronicConditions.filter(c => c !== 'none');

      chip.classList.toggle('selected');
      if (chip.classList.contains('selected')) {
        selectedChronicConditions.push(val);
      } else {
        selectedChronicConditions = selectedChronicConditions.filter(c => c !== val);
      }
    });
  });

  // No smartphone toggle
  document.getElementById('noSmartphoneToggle').addEventListener('click', () => {
    noSmartphoneOn = !noSmartphoneOn;
    document.getElementById('noSmartphoneToggle').classList.toggle('on', noSmartphoneOn);
  });

  // Save member
  document.getElementById('saveMemberBtn').addEventListener('click', async () => {
    const name = document.getElementById('memberName').value.trim();
    if (!name) { showToast('Member name is required'); return; }
    if (!selectedRelationship) { showToast('Select a relationship'); return; }

    const dobDay = document.getElementById('memberDobDay').value.trim().padStart(2,'0');
    const dobMonth = document.getElementById('memberDobMonth').value.trim().padStart(2,'0');
    const dobYear = document.getElementById('memberDobYear').value.trim();
    const dob = (dobDay && dobMonth && dobYear) ? `${dobYear}-${dobMonth}-${dobDay}` : null;
    const location = document.getElementById('memberLocation').value || null;
    const medicationsRaw = document.getElementById('memberMedications').value.trim();
    const allergiesRaw = document.getElementById('memberAllergies').value.trim();

    const medications = medicationsRaw ? medicationsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const allergies = allergiesRaw ? allergiesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

    const btn = document.getElementById('saveMemberBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 1s linear infinite">refresh</span> Adding...';

    const { error } = await supabase.from('family_members').insert({
      primary_user_id: userId,
      name,
      relationship: selectedRelationship,
      dob,
      sex: selectedSex || null,
      location,
      chronic_conditions: selectedChronicConditions,
      medications,
      allergies,
      no_smartphone: noSmartphoneOn,
    });

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">person_add</span> Add Member';

    if (error) { showToast('Failed to add member'); return; }

    await loadMembers();
    closeAllSheets();
    showToast(`${name} added to your family!`);
  });

  // ====== Action Sheet ======
  function openActionSheet(member) {
    activeSheetMemberId = member.id;
    document.getElementById('actionSheetMemberName').textContent = member.name;

    // Booking location notice
    const bookingCard = document.getElementById('bookingLocationCard');
    if (member.location) {
      bookingCard.innerHTML = `
        <div class="book-location-card">
          <div class="book-location-title">
            <span class="material-icons-outlined">location_on</span>
            Located in ${escHtml(member.location)}
          </div>
          <div class="book-location-text">
            Nearest clinics and pharmacies will be recommended based on this location via the Homatt Health portals.
          </div>
        </div>`;
    } else {
      bookingCard.innerHTML = '';
    }

    openSheet(document.getElementById('memberActionSheet'));
  }

  document.getElementById('actionViewLog').addEventListener('click', () => {
    const member = familyMembers.find(m => m.id === activeSheetMemberId);
    if (member) {
      closeAllSheets();
      openMemberDetail(member);
    }
  });

  document.getElementById('actionLogEvent').addEventListener('click', () => {
    const member = familyMembers.find(m => m.id === activeSheetMemberId);
    if (member) {
      logEventForMemberId = member.id;
      closeAllSheets();
      resetLogEventForm();
      openSheet(document.getElementById('logEventSheet'));
    }
  });

  document.getElementById('actionAddRxForMember').addEventListener('click', () => {
    closeAllSheets();
    // Pre-select the member in the Rx form
    const rxForSelect = document.getElementById('rxForMember');
    if (rxForSelect) rxForSelect.value = activeSheetMemberId || '';
    resetRxForm();
    openSheet(document.getElementById('addRxSheet'));
  });

  document.getElementById('actionBookAppt').addEventListener('click', () => {
    const member = familyMembers.find(m => m.id === activeSheetMemberId);
    showToast(`Finding clinics near ${member ? member.location || 'their location' : '...'} — portal integration coming soon!`);
    closeAllSheets();
  });

  document.getElementById('actionRemoveMember').addEventListener('click', async () => {
    const member = familyMembers.find(m => m.id === activeSheetMemberId);
    if (!member) return;
    if (!confirm(`Remove ${member.name} from your family? This cannot be undone.`)) return;

    await supabase.from('family_members').delete().eq('id', activeSheetMemberId);
    await loadMembers();
    closeAllSheets();
    showToast(`${member.name} removed`);
  });

  // ====== Member Detail Panel ======
  function closeMemberDetail() {
    const panel = document.getElementById('memberDetailPanel');
    panel.classList.remove('open');
    // Wait for slide-out transition (300ms), then fully remove from layout
    setTimeout(() => {
      if (!panel.classList.contains('open')) panel.style.display = 'none';
    }, 320);
    logEventForMemberId = null;
  }

  function openMemberDetail(member) {
    const panel = document.getElementById('memberDetailPanel');
    panel.style.display = 'flex';
    panel.offsetHeight; // force reflow so CSS transition fires
    logEventForMemberId = member.id;

    // Header — name
    document.getElementById('memberDetailName').textContent = member.name;

    // Header — avatar
    const avatarEl = document.getElementById('memberDetailAvatar');
    if (member.avatar_url) {
      avatarEl.innerHTML = `<img src="${member.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      avatarEl.textContent = member.name ? member.name.charAt(0).toUpperCase() : '?';
    }

    // Header — meta line (relationship · age · sex)
    const metaParts = [];
    if (member.relationship) metaParts.push(member.relationship.charAt(0).toUpperCase() + member.relationship.slice(1));
    if (member.dob) { const age = calcAge(member.dob); if (age !== null) metaParts.push(age + ' yrs'); }
    if (member.sex) metaParts.push(member.sex === 'male' ? '♂ Male' : '♀ Female');
    if (member.location) metaParts.push(member.location);
    document.getElementById('memberDetailMeta').textContent = metaParts.join(' · ') || '—';

    // Summary strip — conditions
    const summaryEl = document.getElementById('memberDetailSummary');
    const conditions = (member.chronic_conditions || []).filter(c => c !== 'none');
    const meds = member.medications || [];
    const allergies = member.allergies || [];
    const hasSummary = conditions.length || meds.length || allergies.length;

    if (hasSummary) {
      summaryEl.style.display = 'block';
      document.getElementById('memberDetailConditions').innerHTML = conditions.length
        ? `<div class="mdp-summary-row"><span class="material-icons-outlined mdp-summary-icon" style="color:#6A1B9A">medical_information</span><div><div class="mdp-summary-label">Conditions</div><div class="mdp-chips">${conditions.map(c => `<span class="mdp-chip mdp-chip-purple">${escHtml(c.replace(/_/g,' '))}</span>`).join('')}</div></div></div>` : '';
      document.getElementById('memberDetailMeds').innerHTML = meds.length
        ? `<div class="mdp-summary-row"><span class="material-icons-outlined mdp-summary-icon" style="color:#1565C0">medication</span><div><div class="mdp-summary-label">Medications</div><div class="mdp-chips">${meds.map(m => `<span class="mdp-chip mdp-chip-blue">${escHtml(m)}</span>`).join('')}</div></div></div>` : '';
      document.getElementById('memberDetailAllergies').innerHTML = allergies.length
        ? `<div class="mdp-summary-row"><span class="material-icons-outlined mdp-summary-icon" style="color:#E65100">warning_amber</span><div><div class="mdp-summary-label">Allergies</div><div class="mdp-chips">${allergies.map(a => `<span class="mdp-chip mdp-chip-orange">${escHtml(a)}</span>`).join('')}</div></div></div>` : '';
    } else {
      summaryEl.style.display = 'none';
    }

    // Reset event count badge
    const countBadge = document.getElementById('memberEventCount');
    countBadge.style.display = 'none';

    panel.classList.add('open');
    loadMemberHealthLog(member.id);
  }

  document.getElementById('memberDetailBack').addEventListener('click', () => {
    closeMemberDetail();
    logEventForMemberId = null;
  });

  document.getElementById('logEventForMemberBtn').addEventListener('click', () => {
    resetLogEventForm();
    openSheet(document.getElementById('logEventSheet'));
  });

  async function loadMemberHealthLog(memberId) {
    const timelineEl = document.getElementById('memberTimeline');
    timelineEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-hint);font-size:13px">Loading events...</div>';

    // Load health events
    const { data: events } = await supabase
      .from('health_events')
      .select('*')
      .eq('user_id', userId)
      .eq('family_member_id', memberId)
      .order('created_at', { ascending: false });

    // Load prescription doses for this member's prescriptions
    const memberRxIds = prescriptions
      .filter(rx => rx.family_member_id === memberId)
      .map(rx => rx.id);

    let doseEvents = [];
    if (memberRxIds.length > 0) {
      const { data: doses } = await supabase
        .from('prescription_doses')
        .select('*, prescriptions(drug_name)')
        .in('prescription_id', memberRxIds)
        .order('taken_at', { ascending: false });

      doseEvents = (doses || []).map(d => ({
        id: d.id,
        event_type: 'medication',
        title: `Dose taken: ${d.prescriptions ? d.prescriptions.drug_name : 'Medication'}`,
        description: '',
        created_at: d.taken_at,
      }));
    }

    const allEvents = [...(events || []), ...doseEvents]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Update event count badge
    const countBadge = document.getElementById('memberEventCount');
    if (allEvents.length > 0) {
      countBadge.textContent = allEvents.length;
      countBadge.style.display = 'inline-flex';
    } else {
      countBadge.style.display = 'none';
    }

    if (allEvents.length === 0) {
      timelineEl.innerHTML = `
        <div class="timeline-empty">
          <span class="material-icons-outlined">favorite_border</span>
          No health events yet.<br>Tap "Log Health Event" to start the timeline.
        </div>`;
      return;
    }

    timelineEl.innerHTML = allEvents.map(ev => buildTimelineEvent(ev)).join('');
  }

  function buildTimelineEvent(ev) {
    const typeConfig = {
      symptom_check: { cls:'dot-symptom', typeCls:'type-symptom', label:'Symptom Check', icon:'sick' },
      diagnosis:     { cls:'dot-diagnosis', typeCls:'type-diagnosis', label:'Diagnosis', icon:'biotech' },
      treatment:     { cls:'dot-treatment', typeCls:'type-treatment', label:'Treatment', icon:'medical_services' },
      medication:    { cls:'dot-medication', typeCls:'type-medication', label:'Medication', icon:'medication' },
      vaccination:   { cls:'dot-vaccination', typeCls:'type-vaccination', label:'Vaccination', icon:'vaccines' },
      outcome:       { cls:'dot-outcome', typeCls:'type-outcome', label:'Outcome', icon:'thumb_up' },
    };

    const cfg = typeConfig[ev.event_type] || typeConfig['outcome'];
    const dateStr = new Date(ev.created_at).toLocaleDateString('en-UG', { year:'numeric', month:'short', day:'numeric' });

    return `
      <div class="timeline-event">
        <div class="timeline-dot ${cfg.cls}"></div>
        <span class="timeline-event-type ${cfg.typeCls}">
          <span class="material-icons-outlined" style="font-size:12px">${cfg.icon}</span>
          ${cfg.label}
        </span>
        <div class="timeline-event-title">${escHtml(ev.title)}</div>
        ${ev.description ? `<div class="timeline-event-desc">${escHtml(ev.description)}</div>` : ''}
        <div class="timeline-event-date">${dateStr}</div>
      </div>`;
  }

  // ====== Log Health Event ======
  // Event type buttons
  document.querySelectorAll('#eventTypeGrid .event-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#eventTypeGrid .event-type-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedEventType = btn.dataset.val;
      document.getElementById('eventType').value = selectedEventType;
    });
  });

  function resetLogEventForm() {
    selectedEventType = '';
    document.getElementById('eventTitle').value = '';
    document.getElementById('eventDescription').value = '';
    document.querySelectorAll('#eventTypeGrid .event-type-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('eventType').value = '';
  }

  document.getElementById('saveEventBtn').addEventListener('click', async () => {
    const title = document.getElementById('eventTitle').value.trim();
    const description = document.getElementById('eventDescription').value.trim();

    if (!selectedEventType) { showToast('Select an event type'); return; }
    if (!title) { showToast('Enter a title/summary'); return; }
    if (!logEventForMemberId) { showToast('No member selected'); return; }

    const btn = document.getElementById('saveEventBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 1s linear infinite">refresh</span> Saving...';

    const { error } = await supabase.from('health_events').insert({
      user_id: userId,
      family_member_id: logEventForMemberId,
      event_type: selectedEventType,
      title,
      description,
    });

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">save</span> Save Event';

    if (error) { showToast('Failed to save event'); return; }

    closeAllSheets();
    showToast('Health event logged!');

    // Refresh timeline if detail panel is open
    if (document.getElementById('memberDetailPanel').classList.contains('open')) {
      loadMemberHealthLog(logEventForMemberId);
    }
  });

  // ====== Add Prescription Sheet ======
  document.getElementById('addRxBtn').addEventListener('click', () => {
    resetRxForm();
    openSheet(document.getElementById('addRxSheet'));
  });

  function resetRxForm() {
    document.getElementById('rxDrugName').value = '';
    document.getElementById('rxManufacturer').value = '';
    document.getElementById('rxDosage').value = '';
    document.getElementById('rxFrequency').value = '';
    document.getElementById('rxStartDate').value = '';
    document.getElementById('rxEndDate').value = '';
    document.getElementById('rxQuantity').value = '';
    document.getElementById('rxDoctor').value = '';
    document.getElementById('rxNotes').value = '';
    selectedDrugForm = '';
    selectedReminderTimes = [];
    document.querySelectorAll('#drugFormGroup .sheet-chip').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('#reminderTimesGroup .sheet-chip').forEach(c => c.classList.remove('selected'));
  }

  // Drug form chips (single select)
  document.querySelectorAll('#drugFormGroup .sheet-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#drugFormGroup .sheet-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedDrugForm = chip.dataset.val;
      document.getElementById('rxDrugForm').value = selectedDrugForm;
    });
  });

  // Reminder times chips (multi-select)
  document.querySelectorAll('#reminderTimesGroup .sheet-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      const val = chip.dataset.val;
      if (chip.classList.contains('selected')) {
        selectedReminderTimes.push(val);
      } else {
        selectedReminderTimes = selectedReminderTimes.filter(t => t !== val);
      }
    });
  });

  function updateRxMemberSelector() {
    const sel = document.getElementById('rxForMember');
    if (!sel) return;
    sel.innerHTML = '<option value="">Self</option>' +
      familyMembers.map(m => `<option value="${m.id}">${escHtml(m.name)}</option>`).join('');
  }

  document.getElementById('saveRxBtn').addEventListener('click', async () => {
    const drugName = document.getElementById('rxDrugName').value.trim();
    if (!drugName) { showToast('Drug name is required'); return; }

    const freq = document.getElementById('rxFrequency').value;
    if (!freq) { showToast('Select a frequency'); return; }

    const startDate = document.getElementById('rxStartDate').value;
    const endDate = document.getElementById('rxEndDate').value;
    if (!startDate || !endDate) { showToast('Start and end dates are required'); return; }

    const quantity = parseInt(document.getElementById('rxQuantity').value) || null;
    const forMemberId = document.getElementById('rxForMember').value || null;

    const btn = document.getElementById('saveRxBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 1s linear infinite">refresh</span> Submitting...';

    const { error } = await supabase.from('prescriptions').insert({
      user_id: userId,
      family_member_id: forMemberId,
      drug_name: drugName,
      manufacturer: document.getElementById('rxManufacturer').value.trim() || null,
      dosage: document.getElementById('rxDosage').value.trim() || null,
      drug_form: selectedDrugForm || null,
      frequency: freq,
      start_date: startDate,
      end_date: endDate,
      quantity,
      quantity_remaining: quantity,
      reminder_times: selectedReminderTimes,
      prescribing_doctor: document.getElementById('rxDoctor').value.trim() || null,
      notes: document.getElementById('rxNotes').value.trim() || null,
      status: 'active',
      admin_verified: false,
    });

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">save</span> Submit Prescription';

    if (error) { showToast('Failed to save prescription'); return; }

    await loadPrescriptions();
    closeAllSheets();
    showToast('Prescription submitted — pending admin review');
  });

  // ====== Search ======
  document.getElementById('shopSearch').addEventListener('input', () => {
    loadItems(selectedCategoryId);
  });

  // ====== Toast ======
  function showToast(msg) {
    const t = document.getElementById('familyToast');
    t.textContent = msg;
    t.classList.add('visible');
    setTimeout(() => t.classList.remove('visible'), 2800);
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
});
