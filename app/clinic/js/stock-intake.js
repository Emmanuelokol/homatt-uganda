/* Homatt Health — Stock intake
 *
 * Restocking has to take seconds, not minutes, and it has to be arithmetic the
 * owner can check in their head.
 *
 * Medicines arrive in boxes of strips of tablets. So the app asks three plain
 * questions the first time an item is stocked:
 *
 *     How many boxes did you buy?        5
 *     How many strips in one box?        4
 *     How many tablets in one strip?     6
 *                                        ─────────────────
 *                                        5 × 4 × 6 = 120 tablets
 *
 * The strips-per-box and tablets-per-strip do not change between deliveries, so
 * they are kept against the item as a template. The next delivery asks ONE
 * question — how many boxes? — and the total is already worked out.
 *
 * Nobody counts pills. Dispensing during a consultation deducts automatically,
 * and stock is allowed to go NEGATIVE: a clinician who has run out still treats
 * the patient, and the shortfall shows as "short by 20" until the owner adds
 * stock, at which point it clears itself.
 */
(function () {
  'use strict';

  var EM_URL = 'data/emhslu_2023.db';   // the national medicines list
  var emdb = null, emLoading = null;
  var st = null;                        // the intake being built

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m, k) { try { showToast(m, k || 'info'); } catch (e) {} }
  function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function fmt(n) { return (Math.round(n * 100) / 100).toLocaleString('en-UG'); }

  // ── The national list, for the name suggestions ──────────────────────────
  function openEm() {
    if (emdb) return Promise.resolve(emdb);
    if (emLoading) return emLoading;
    emLoading = (async function () {
      if (typeof initSqlJs !== 'function') throw new Error('SQLite engine not loaded');
      var SQL = await initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } });
      var res = await fetch(EM_URL);
      if (!res.ok) throw new Error('EMHSLU database not found');
      emdb = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
      return emdb;
    })();
    return emLoading;
  }
  function emRows(sql, params) {
    if (!emdb) return [];
    var s = emdb.prepare(sql), out = [];
    try { s.bind(params || []); while (s.step()) out.push(s.getAsObject()); }
    finally { s.free(); }
    return out;
  }

  // Suggestions come from what the clinic ALREADY stocks first (those carry a
  // pack template and can be topped up in one question), then the national list.
  function suggest(q) {
    q = String(q || '').trim();
    if (q.length < 2) return [];
    var out = [], seen = {};
    var ql = q.toLowerCase();

    (window._stockItems || []).forEach(function (it) {
      var n = String(it.item_name || '');
      if (n.toLowerCase().indexOf(ql) < 0) return;
      var k = n.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ name: n, existing: it, tag: 'in your stock' });
    });

    try {
      emRows("SELECT name, dosage_form, strength FROM emhslu_items " +
             "WHERE item_type='medicine' AND name LIKE ? " +
             "ORDER BY length(name), name LIMIT 12", [q + '%'])
        .concat(emRows("SELECT name, dosage_form, strength FROM emhslu_items " +
             "WHERE item_type='medicine' AND name LIKE ? " +
             "ORDER BY length(name), name LIMIT 12", ['%' + q + '%']))
        .forEach(function (r) {
          var full = r.name + (r.strength ? ' ' + r.strength : '');
          var k = full.toLowerCase();
          if (seen[k]) return;
          seen[k] = 1;
          out.push({ name: full, form: r.dosage_form || '', tag: 'EMHSLU' });
        });
    } catch (e) {}
    return out.slice(0, 8);
  }

  // ── The sheet ────────────────────────────────────────────────────────────
  function ensure() {
    if (document.getElementById('stkOverlay')) return;
    var css = document.createElement('style');
    css.textContent = [
      '#stkOverlay{position:fixed;inset:0;background:rgba(10,20,16,.62);z-index:980;display:none;align-items:flex-end;justify-content:center}',
      '#stkSheet{background:var(--surface,#fff);width:100%;max-width:560px;border-radius:24px 24px 0 0;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 -10px 40px rgba(0,0,0,.3)}',
      '@media(min-width:620px){#stkOverlay{align-items:center}#stkSheet{border-radius:24px}}',
      '.stk-top{padding:18px 20px 12px;border-bottom:1px solid var(--border,#E8EAED)}',
      '.stk-top h3{margin:0;font-size:19px;font-weight:800;color:var(--text,#111)}',
      '.stk-top p{margin:3px 0 0;font-size:13px;color:var(--text-lt,#5F6368);line-height:1.45}',
      '.stk-body{padding:16px 20px;overflow-y:auto;flex:1}',
      '.stk-lbl{display:block;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--text-lt,#5F6368);margin:0 0 6px}',
      '.stk-in{width:100%;box-sizing:border-box;padding:13px 14px;border:1.5px solid var(--border,#E0E0E0);border-radius:13px;font:inherit;font-size:16px;background:var(--surface,#fff);color:var(--text,#111)}',
      '.stk-in:focus{outline:none;border-color:#0E7C5A;box-shadow:0 0 0 3px rgba(14,124,90,.12)}',
      '#stkRes{margin-top:8px;border:1.5px solid var(--brand-tint,#DBF4EA);border-radius:12px;overflow:hidden;display:none;max-height:250px;overflow-y:auto}',
      '#stkRes div{padding:12px 14px;font-size:14px;cursor:pointer;border-bottom:1px solid var(--border,#EEF1EE);display:flex;justify-content:space-between;gap:8px;align-items:center}',
      '#stkRes div:last-child{border-bottom:none}',
      '#stkRes b{font-weight:700;color:var(--text,#111)}',
      '#stkRes .t{font-size:10.5px;font-weight:800;color:var(--text-lt,#9AA0A6);letter-spacing:.3px;white-space:nowrap}',
      '.stk-q{margin-top:16px}',
      '.stk-q .hint{font-size:12px;color:var(--text-lt,#5F6368);margin-top:5px;line-height:1.4}',
      '.stk-sum{margin-top:18px;padding:16px;border-radius:16px;background:var(--brand-tint,#DBF4EA);color:#0A5C43}',
      'html[data-theme="dark"] .stk-sum{background:rgba(18,163,116,.18);color:#8FE3BC}',
      '.stk-sum .calc{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}',
      '.stk-sum .tot{font-size:27px;font-weight:800;margin-top:5px;font-variant-numeric:tabular-nums}',
      '.stk-sum .note{font-size:12.5px;margin-top:7px;opacity:.9;line-height:1.45}',
      '.stk-foot{padding:14px 20px 18px;border-top:1px solid var(--border,#E8EAED);display:flex;gap:10px}',
      '.stk-btn{flex:1;padding:15px;border-radius:14px;border:none;font:inherit;font-size:15px;font-weight:800;cursor:pointer}',
      '.stk-btn.ghost{flex:0 0 34%;background:transparent;border:1.5px solid var(--border,#E0E0E0);color:var(--text,#111)}',
      '.stk-btn.go{background:linear-gradient(135deg,#0E7C5A,#12A374);color:#fff}',
      '.stk-btn:disabled{opacity:.5}',
      '.stk-known{margin-top:14px;padding:12px 14px;border-radius:13px;background:var(--bg,#F5F7F5);font-size:13px;color:var(--text-lt,#5F6368);line-height:1.5}',
      'html[data-theme="dark"] .stk-known{background:#151E18;color:#A9BCAE}',
      '.stk-known b{color:var(--text,#111)}',
      'html[data-theme="dark"] .stk-known b{color:#E8F0EA}',
      '.stk-edit{background:none;border:none;color:#0E7C5A;font:inherit;font-size:12.5px;font-weight:800;cursor:pointer;padding:0;margin-top:4px}',
      'html[data-theme="dark"] .stk-edit{color:#7BC98A}',
    ].join('\n');
    document.head.appendChild(css);

    var ov = document.createElement('div');
    ov.id = 'stkOverlay';
    ov.innerHTML =
      '<div id="stkSheet">' +
        '<div class="stk-top"><h3 id="stkTitle">Add stock</h3><p id="stkSub"></p></div>' +
        '<div class="stk-body" id="stkBody"></div>' +
        '<div class="stk-foot">' +
          '<button class="stk-btn ghost" id="stkCancel">Cancel</button>' +
          '<button class="stk-btn go" id="stkSave" disabled>Add to stock</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('stkCancel').onclick = close;
    document.getElementById('stkSave').onclick = save;
  }

  function close() {
    var o = document.getElementById('stkOverlay');
    if (o) o.style.display = 'none';
  }

  // ── Step 1: which medicine ───────────────────────────────────────────────
  function renderPick() {
    document.getElementById('stkTitle').textContent = 'Add stock';
    document.getElementById('stkSub').textContent =
      'Type the first few letters — for example “coar” for Coartem.';
    document.getElementById('stkBody').innerHTML =
      '<label class="stk-lbl" for="stkSearch">Medicine or item</label>' +
      '<input id="stkSearch" class="stk-in" autocomplete="off" placeholder="coar…">' +
      '<div id="stkRes"></div>';
    document.getElementById('stkSave').style.display = 'none';

    var inp = document.getElementById('stkSearch');
    var box = document.getElementById('stkRes');
    var t;
    function paint() {
      var hits = suggest(inp.value);
      var typed = inp.value.trim();
      if (!hits.length && typed.length < 2) { box.style.display = 'none'; return; }
      var html = hits.map(function (h, i) {
        return '<div data-i="' + i + '"><b>' + esc(h.name) + '</b>' +
          '<span class="t">' + esc(h.tag) + '</span></div>';
      }).join('');
      // Anything not on the list can still be stocked — gloves, syringes, a
      // brand the national list does not carry.
      if (typed.length >= 2) {
        html += '<div data-new="1"><b>Use “' + esc(typed) + '”</b>' +
                '<span class="t">as typed</span></div>';
      }
      box.innerHTML = html;
      box.style.display = 'block';
      box.querySelectorAll('[data-i]').forEach(function (el) {
        el.onclick = function () { pick(hits[Number(el.dataset.i)]); };
      });
      var nw = box.querySelector('[data-new]');
      if (nw) nw.onclick = function () { pick({ name: typed }); };
    }
    inp.oninput = function () {
      clearTimeout(t);
      openEm().catch(function () {});      // warm it; never blocks typing
      t = setTimeout(paint, 120);
    };
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 120);
  }

  // ── Remembered pack templates ────────────────────────────────────────────
  // The template MUST survive without the database migration. Storing it only
  // in the strips_per_box / units_per_strip columns meant that on a clinic that
  // has not run 20260825_stock_packs.sql, the first save silently dropped those
  // columns and the second delivery asked all three questions again. So the
  // template is kept locally too, keyed by clinic + item name, and read back
  // whenever the database row does not carry one.
  function clinicId() {
    try { return (JSON.parse(localStorage.getItem('clinic_session') || '{}').clinicId) || 'local'; }
    catch (e) { return 'local'; }
  }
  function tmplKey() { return 'stock_packs_' + clinicId(); }
  function allTemplates() {
    try { return JSON.parse(localStorage.getItem(tmplKey()) || '{}'); } catch (e) { return {}; }
  }
  function nameKey(name) { return String(name || '').toLowerCase().trim(); }
  function getTemplate(name) { return allTemplates()[nameKey(name)] || null; }
  function rememberTemplate(name, strips, units, boxes) {
    if (!(num(strips) > 0 && num(units) > 0)) return;
    try {
      var all = allTemplates();
      all[nameKey(name)] = {
        strips_per_box: num(strips), units_per_strip: num(units),
        last_boxes: num(boxes) || undefined, updated: new Date().toISOString(),
      };
      localStorage.setItem(tmplKey(), JSON.stringify(all));
    } catch (e) {}
  }

  function pick(hit) {
    var ex = hit.existing || matchExisting(hit.name);
    // The database row first, then whatever the clinic saved on this device.
    var tmpl = getTemplate(hit.name) || {};
    var strips = ex && Number(ex.strips_per_box) > 0 ? Number(ex.strips_per_box)
               : (Number(tmpl.strips_per_box) > 0 ? Number(tmpl.strips_per_box) : '');
    var units  = ex && Number(ex.units_per_strip) > 0 ? Number(ex.units_per_strip)
               : (Number(tmpl.units_per_strip) > 0 ? Number(tmpl.units_per_strip) : '');
    var boxes  = (ex && Number(ex.last_boxes)) || Number(tmpl.last_boxes) || '';
    st = {
      name: hit.name,
      unit: (ex && ex.unit) || 'tabs',
      existing: ex || null,
      boxes: boxes,
      strips: strips,
      units: units,
      expiry: '',
      forceAsk: false,
    };
    renderCount();
  }

  function matchExisting(name) {
    var n = String(name || '').toLowerCase().trim();
    return (window._stockItems || []).find(function (it) {
      return String(it.item_name || '').toLowerCase().trim() === n;
    }) || null;
  }

  // ── Step 2: the three questions (or just one, if we already know) ────────
  function renderCount() {
    var known = !st.forceAsk && num(st.strips) > 0 && num(st.units) > 0;
    var cur = st.existing ? Number(st.existing.quantity) : null;

    document.getElementById('stkTitle').textContent = st.name;
    document.getElementById('stkSub').textContent = known
      ? 'You have stocked this before — just tell us how many boxes.'
      : 'Three quick questions. The app works out the rest.';
    document.getElementById('stkSave').style.display = '';

    var h = '';
    if (cur !== null) {
      h += '<div class="stk-known">On the shelf now: <b>' +
        (cur < 0 ? 'short by ' + fmt(-cur) + ' ' + esc(st.unit) : fmt(cur) + ' ' + esc(st.unit)) +
        '</b></div>';
    }
    h += '<div class="stk-q"><label class="stk-lbl" for="stkBoxes">How many boxes did you buy?</label>' +
         '<input id="stkBoxes" class="stk-in" type="number" inputmode="numeric" min="1" step="1" ' +
         'value="' + (st.boxes || '') + '" placeholder="e.g. 5"></div>';

    if (known) {
      h += '<div class="stk-known">One box = <b>' + fmt(st.strips) + ' strips</b>, ' +
           'one strip = <b>' + fmt(st.units) + ' ' + esc(st.unit) + '</b>' +
           '<br><button class="stk-edit" id="stkChange">Change the pack size</button></div>';
    } else {
      h += '<div class="stk-q"><label class="stk-lbl" for="stkStrips">How many strips are in one box?</label>' +
           '<input id="stkStrips" class="stk-in" type="number" inputmode="numeric" min="1" step="1" ' +
           'value="' + (st.strips || '') + '" placeholder="e.g. 4">' +
           '<div class="hint">If it comes as a tin or a bottle rather than strips, put 1.</div></div>' +
           '<div class="stk-q"><label class="stk-lbl" for="stkUnits">How many ' + esc(st.unit) +
           ' are in one strip?</label>' +
           '<input id="stkUnits" class="stk-in" type="number" inputmode="numeric" min="1" step="1" ' +
           'value="' + (st.units || '') + '" placeholder="e.g. 6"></div>';
    }
    // Each delivery is its own batch with its own expiry — different boxes,
    // different dates. Asked here, on the batch being added.
    h += '<div class="stk-q"><label class="stk-lbl" for="stkExpiry">Expiry date of this batch ' +
         '<span style="text-transform:none;letter-spacing:0;font-weight:600;color:#9AA0A6">— optional</span></label>' +
         '<input id="stkExpiry" class="stk-in" type="date" value="' + esc(st.expiry || '') + '">' +
         '<div class="hint">If this delivery expires sooner than what is already on the shelf, the app tracks the earlier date.</div></div>';

    h += '<div class="stk-sum" id="stkSum"></div>';
    document.getElementById('stkBody').innerHTML = h;

    ['stkBoxes', 'stkStrips', 'stkUnits'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.oninput = recalc;
    });
    var xp = document.getElementById('stkExpiry');
    if (xp) xp.onchange = function () { st.expiry = xp.value || ''; };
    var ch = document.getElementById('stkChange');
    if (ch) ch.onclick = function () { st.forceAsk = true; renderCount(); };
    recalc();
    setTimeout(function () { try { document.getElementById('stkBoxes').focus(); } catch (e) {} }, 120);
  }

  function current() {
    var known = !st.forceAsk && num(st.strips) > 0 && num(st.units) > 0;
    var boxes  = num((document.getElementById('stkBoxes') || {}).value);
    var strips = known ? num(st.strips) : num((document.getElementById('stkStrips') || {}).value);
    var units  = known ? num(st.units)  : num((document.getElementById('stkUnits')  || {}).value);
    return { boxes: boxes, strips: strips, units: units, total: boxes * strips * units };
  }

  function recalc() {
    var c = current();
    var sum = document.getElementById('stkSum');
    var btn = document.getElementById('stkSave');
    if (!c.boxes || !c.strips || !c.units) {
      sum.innerHTML = '<div class="note">Fill the boxes in above and the total appears here.</div>';
      btn.disabled = true;
      return;
    }
    var cur = st.existing ? Number(st.existing.quantity) : 0;
    var after = cur + c.total;
    // The multiplication is shown in full so the owner can check it at a glance.
    sum.innerHTML =
      '<div class="calc">' + fmt(c.boxes) + ' boxes × ' + fmt(c.strips) + ' strips × ' +
        fmt(c.units) + ' ' + esc(st.unit) + '</div>' +
      '<div class="tot">' + fmt(c.total) + ' ' + esc(st.unit) + '</div>' +
      (st.existing
        ? '<div class="note">' +
            (cur < 0
              ? 'Clears a shortfall of ' + fmt(-cur) + ' and leaves <b>' + fmt(after) + ' ' + esc(st.unit) + '</b> on the shelf.'
              : 'Shelf goes from ' + fmt(cur) + ' to <b>' + fmt(after) + ' ' + esc(st.unit) + '</b>.') +
          '</div>'
        : '<div class="note">A new stock item will be created with this amount.</div>');
    btn.disabled = false;
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function save() {
    var c = current();
    if (!c.total) return;
    var btn = document.getElementById('stkSave');
    btn.disabled = true;
    var wasLabel = btn.textContent;
    btn.textContent = 'Adding…';
    // Remember the pack size on THIS device, whatever the database can store.
    // Next delivery of the same medicine then asks only for boxes.
    rememberTemplate(st.name, c.strips, c.units, c.boxes);
    try {
      var xp = document.getElementById('stkExpiry');
      var ok = await window.stockIntakeCommit({
        name: st.name, unit: st.unit, existing: st.existing,
        boxes: c.boxes, strips: c.strips, units: c.units, total: c.total,
        expiry: (xp && xp.value) || st.expiry || '',
      });
      if (ok === false) { btn.disabled = false; btn.textContent = wasLabel; return; }
      close();
      toast(fmt(c.total) + ' ' + st.unit + ' of ' + st.name + ' added to stock', 'success');
    } catch (e) {
      btn.disabled = false; btn.textContent = wasLabel;
      toast('Could not add the stock: ' + (e && e.message ? e.message : 'please try again'), 'error');
    }
  }

  // ── Public ───────────────────────────────────────────────────────────────
  // start()          — the owner taps "Add stock"
  // start(item)      — the owner taps "Restock" on a row that is already there
  function start(item) {
    ensure();
    document.getElementById('stkOverlay').style.display = 'flex';
    openEm().catch(function () {});
    if (item) { pick({ name: item.item_name, existing: item }); }
    else { st = null; renderPick(); }
  }

  window.StockIntake = { start: start, close: close, suggest: suggest };
})();
