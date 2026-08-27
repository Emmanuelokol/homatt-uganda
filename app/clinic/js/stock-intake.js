/* Homatt Health — Stock intake
 *
 * Adding stock has to take seconds, not minutes, and it has to be arithmetic
 * the owner can check in their head.
 *
 * The name comes from the national list (EMHSLU 2023), so nothing has to be
 * typed twice and nothing has to be spelt right. Picking a name settles what
 * kind of thing it is and what it is counted in — a clinic should never have to
 * tell the app that Amoxicillin is a medicine counted in capsules.
 *
 * Then it asks how much arrived, in the words on the carton:
 *
 *     How many boxes did you receive?     5
 *     How many strips in one box?        10   ← remembered after the first time
 *     How many caps in one strip?        10   ← remembered after the first time
 *                                        ─────────────────
 *                                        5 x 10 x 10 = 500 caps
 *
 * The pack shape does not change between deliveries, so it is kept against the
 * item. The next delivery asks ONE question — how many boxes? — and the total
 * is already worked out. A first-time item starts from the standard pack for
 * that kind of medicine (see stock-blueprints.js), shown in full so a wrong
 * guess is obvious before it is saved.
 *
 * Nothing is ever refused. A name the national list has never heard of — a
 * brand, pampers, a trade pack — is added exactly as typed.
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
  var done = null;                      // where to go back to once it is saved

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m, k) { try { showToast(m, k || 'info'); } catch (e) {} }
  function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function fmt(n) { return (Math.round(n * 100) / 100).toLocaleString('en-UG'); }
  function money(n) { return 'UGX ' + Math.round(Number(n) || 0).toLocaleString('en-UG'); }

  // "boxes" → "box", "packets" → "packet". Only ever used on our own words.
  function one(w) {
    w = String(w || '');
    if (/xes$/.test(w)) return w.slice(0, -2);
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/s$/.test(w))   return w.slice(0, -1);
    return w;
  }
  function bp() { return window.StockBlueprint; }

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
  // pack shape and can be topped up in one question), then the national list —
  // medicines and supplies both — then the counter items the national list does
  // not carry at all (pampers, retail condoms, pads).
  function suggest(q) {
    q = String(q || '').trim();
    if (q.length < 2) return [];
    var out = [], seen = {};
    var ql = q.toLowerCase();
    function take(k) { if (seen[k]) return false; seen[k] = 1; return true; }

    (window._stockItems || []).forEach(function (it) {
      var n = String(it.item_name || '');
      if (n.toLowerCase().indexOf(ql) < 0) return;
      if (!take(n.toLowerCase())) return;
      out.push({ name: n, existing: it, itemType: it.item_type || 'medicine', tag: 'in your stock' });
    });

    try {
      // The national list keeps the strength in its own column, but the name
      // shown — and therefore the name typed — is the two joined: "Amoxicillin
      // 250 mg". Matching the name column alone found nothing the moment
      // anybody typed the strength, so the search matches what it displays.
      var FULL = "(name || CASE WHEN strength IS NULL OR strength='' " +
                 "THEN '' ELSE ' ' || strength END)";
      var COLS = "SELECT name, dosage_form, strength, specification FROM emhslu_items ";
      // Starts-with first (that is what a half-typed name means), then anywhere.
      ['medicine', 'health_supply'].forEach(function (kind) {
        emRows(COLS + "WHERE item_type=? AND " + FULL + " LIKE ? " +
               "ORDER BY length(name), name LIMIT 10", [kind, q + '%'])
          .concat(emRows(COLS + "WHERE item_type=? AND " + FULL + " LIKE ? " +
               "ORDER BY length(name), name LIMIT 10", [kind, '%' + q + '%']))
          .forEach(function (r) {
            var full = r.name + (r.strength ? ' ' + r.strength : '');
            if (!take(full.toLowerCase())) return;
            out.push({
              name: full, form: r.dosage_form || '', spec: r.specification || '',
              itemType: (bp() ? bp().typeFor(kind) : (kind === 'medicine' ? 'medicine' : 'consumable')),
              tag: kind === 'medicine' ? 'EMHSLU medicine' : 'EMHSLU supply',
            });
          });
      });
    } catch (e) {}

    try {
      (bp() ? bp().commodities(q) : []).forEach(function (c) {
        if (!take(c.name.toLowerCase())) return;
        out.push({ name: c.name, itemType: 'consumable', tag: 'counter item' });
      });
    } catch (e) {}

    // Medicines lead — a clinic searching "amox" wants the drug, not a folder.
    out.sort(function (a, b) {
      var ra = a.existing ? 0 : (a.itemType === 'medicine' ? 1 : 2);
      var rb = b.existing ? 0 : (b.itemType === 'medicine' ? 1 : 2);
      if (ra !== rb) return ra - rb;
      return 0;
    });
    return out.slice(0, 10);
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
      '.stk-batches{margin-top:7px;border:1px solid var(--border,#E8EAED);border-radius:12px;overflow:hidden}',
      'html[data-theme="dark"] .stk-batches{border-color:#243029}',
      '.stk-batch{display:flex;align-items:center;gap:10px;padding:10px 13px;font-size:13.5px;border-bottom:1px solid var(--border,#EEF1EE)}',
      'html[data-theme="dark"] .stk-batch{border-bottom-color:#1E2822}',
      '.stk-batch:last-child{border-bottom:none}',
      '.stk-batch .q{font-weight:800;color:var(--text,#111);min-width:78px}',
      'html[data-theme="dark"] .stk-batch .q{color:#E8F0EA}',
      '.stk-batch .e{flex:1;color:var(--text-lt,#5F6368)}',
      'html[data-theme="dark"] .stk-batch .e{color:#A9BCAE}',
      '.stk-batch .lead{font-size:9.5px;font-weight:800;letter-spacing:.4px;background:var(--brand-tint,#DBF4EA);color:#0A5C43;padding:2px 8px;border-radius:20px}',
      'html[data-theme="dark"] .stk-batch .lead{background:rgba(18,163,116,.22);color:#8FE3BC}',
      '.stk-batch.soon .e{color:#B26A00;font-weight:700}',
      '.stk-batch.exp{background:#FDECEC}.stk-batch.exp .e{color:#B3261E;font-weight:800}',
      'html[data-theme="dark"] .stk-batch.exp{background:rgba(229,72,77,.14)}',
      // What kind of thing is it — asked ONLY for a name nothing has heard of.
      '.stk-kind{display:flex;gap:10px;margin-top:14px}',
      '.stk-kind button{flex:1;padding:16px 12px;border-radius:16px;border:1.5px solid var(--border,#E0E0E0);background:var(--surface,#fff);font:inherit;cursor:pointer;text-align:left;color:var(--text,#111)}',
      '.stk-kind button b{display:block;font-size:14.5px;font-weight:800;margin-bottom:2px}',
      '.stk-kind button span{font-size:11.5px;color:var(--text-lt,#5F6368);line-height:1.35;display:block}',
      '.stk-kind button:active{border-color:#0E7C5A}',
      // Price block
      '.stk-price{margin-top:18px;padding:14px;border-radius:16px;border:1.5px solid var(--brand-tint,#DBF4EA);background:var(--surface,#fff)}',
      'html[data-theme="dark"] .stk-price{border-color:#22503F;background:#101A15}',
      '.stk-price .cap{font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#0E7C5A;margin-bottom:10px}',
      'html[data-theme="dark"] .stk-price .cap{color:#7BC98A}',
      '.stk-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.stk-mini{font-size:11px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;color:var(--text-lt,#5F6368);display:block;margin-bottom:5px}',
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
    done = null;
    var o = document.getElementById('stkOverlay');
    if (o) o.style.display = 'none';
  }

  // ── Step 1: which item ───────────────────────────────────────────────────
  function renderPick() {
    document.getElementById('stkTitle').textContent = 'Add stock';
    document.getElementById('stkSub').textContent =
      'Type the first few letters — for example “amox” for Amoxicillin, or “pamp” for pampers.';
    document.getElementById('stkBody').innerHTML =
      '<label class="stk-lbl" for="stkSearch">Medicine or item</label>' +
      '<input id="stkSearch" class="stk-in" autocomplete="off" placeholder="amox…">' +
      '<div id="stkRes"></div>';
    document.getElementById('stkSave').style.display = 'none';

    var inp = document.getElementById('stkSearch');
    var box = document.getElementById('stkRes');
    var t;
    function paint() {
      var hits = suggest(inp.value);
      var typed = inp.value.trim();
      if (!hits.length && typed.length < 2) { box.style.display = 'none'; return; }
      var exact = hits.some(function (h) { return h.name.toLowerCase() === typed.toLowerCase(); });
      var html = hits.map(function (h, i) {
        return '<div data-i="' + i + '"><b>' + esc(h.name) + '</b>' +
          '<span class="t">' + esc(h.tag) + '</span></div>';
      }).join('');
      // NOTHING is ever refused. A brand, a trade pack, a name the national
      // list has never carried — it goes in exactly as typed.
      if (typed.length >= 2 && !exact) {
        html += '<div data-new="1"><b>Add “' + esc(typed) + '”</b>' +
                '<span class="t">not on the list — add it anyway</span></div>';
      }
      box.innerHTML = html;
      box.style.display = 'block';
      box.querySelectorAll('[data-i]').forEach(function (el) {
        el.onclick = function () { pick(hits[Number(el.dataset.i)]); };
      });
      var nw = box.querySelector('[data-new]');
      if (nw) nw.onclick = function () { renderKind(typed); };
    }
    inp.oninput = function () {
      clearTimeout(t);
      openEm().catch(function () {});      // warm it; never blocks typing
      t = setTimeout(paint, 120);
    };
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 120);
  }

  // ── Step 1b: only for a name nothing has heard of ────────────────────────
  // The one thing that genuinely cannot be worked out. Two taps, plain words.
  function renderKind(name) {
    document.getElementById('stkTitle').textContent = name;
    document.getElementById('stkSub').textContent =
      'This one is not on the national list — that is fine, it is being added now. Which is it?';
    document.getElementById('stkSave').style.display = 'none';
    document.getElementById('stkBody').innerHTML =
      '<div class="stk-kind">' +
        '<button data-k="medicine"><b>A medicine</b><span>Tablets, capsules, syrup, an injection — anything you dispense.</span></button>' +
        '<button data-k="consumable"><b>Something else you sell</b><span>Pampers, condoms, pads, gloves, a test kit.</span></button>' +
      '</div>';
    document.getElementById('stkBody').querySelectorAll('[data-k]').forEach(function (b) {
      b.onclick = function () { pick({ name: name, itemType: b.getAttribute('data-k') }); };
    });
  }

  // ── Remembered pack shapes ───────────────────────────────────────────────
  // The shape MUST survive without the database migration. Storing it only in
  // the strips_per_box / units_per_strip columns meant that on a clinic that
  // has not run 20260825_stock_packs.sql, the first save silently dropped those
  // columns and the second delivery asked all the questions again. So it is
  // kept locally too, keyed by clinic + item name, and read back whenever the
  // database row does not carry one.
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
  function rememberTemplate(name, strips, units, boxes, extra) {
    if (!(num(strips) > 0 && num(units) > 0)) return;
    try {
      var all = allTemplates();
      all[nameKey(name)] = Object.assign({
        strips_per_box: num(strips), units_per_strip: num(units),
        last_boxes: num(boxes) || undefined, updated: new Date().toISOString(),
      }, extra || {});
      localStorage.setItem(tmplKey(), JSON.stringify(all));
    } catch (e) {}
  }

  // What the clinic already knows beats any blueprint; the blueprint only fills
  // the gaps on something stocked for the very first time.
  function pick(hit) {
    var ex = hit.existing || matchExisting(hit.name);
    var tmpl = getTemplate(hit.name) || {};
    var kind = hit.itemType || (ex && ex.item_type) || 'medicine';
    var plan = (bp() ? bp().blueprintFor({
      name: hit.name, form: hit.form, spec: hit.spec, itemType: kind,
    }) : { kind: 'medicine', unit: 'tabs', outer: 'boxes', inner: 'strips', strips: 10, units: 10, sure: false, note: '' });

    // An item already on the shelf knows what it is counted in, and that is
    // better evidence than a dosage form we no longer have: a restock of
    // something measured in vials must never be asked about strips.
    if (ex && ex.unit && bp()) {
      var byUnit = bp().shapeForUnit(ex.unit);
      if (byUnit && byUnit.unit !== plan.unit) {
        plan = { kind: plan.kind, unit: byUnit.unit, outer: byUnit.outer, inner: byUnit.inner,
                 strips: byUnit.strips, units: byUnit.units, note: '', sure: false };
      }
    }

    function firstNum() {
      for (var i = 0; i < arguments.length; i++) if (num(arguments[i]) > 0) return num(arguments[i]);
      return '';
    }
    st = {
      name: hit.name,
      // The national list files condoms under contraceptives — a medicine. To
      // the clinic selling them over the counter they are a counter item, and
      // that is how they should be counted and sold. Where the two disagree the
      // clinic's view wins; everything else keeps the list's classification.
      itemType: kind === 'material' ? 'material'
              : (plan.kind === 'commodity' ? 'consumable'
              : (kind === 'consumable' ? 'consumable' : 'medicine')),
      unit:   (ex && ex.unit) || tmpl.unit || plan.unit || 'tabs',
      outer:  tmpl.outer || plan.outer || 'boxes',
      inner:  (tmpl.inner != null ? tmpl.inner : plan.inner) || '',
      existing: ex || null,
      boxes:  firstNum(ex && ex.last_boxes, tmpl.last_boxes),
      strips: firstNum(ex && ex.strips_per_box, ex && ex.packs_per_box, tmpl.strips_per_box),
      units:  firstNum(ex && ex.units_per_strip, ex && ex.tabs_per_pack, tmpl.units_per_strip),
      // The suggestion, kept apart so the sheet can say where a number came from.
      suggest: { strips: plan.strips, units: plan.units, sure: plan.sure, note: plan.note || '' },
      unitPrice: (ex && num(ex.selling_price_ugx)) || '',
      packPrice: (ex && num(ex.pack_selling_price_ugx)) || '',
      threshold: (ex && num(ex.min_threshold)) || 10,
      expiry: '',
      forceAsk: false,
    };
    // No middle layer for this kind of thing → one multiplier only.
    if (!st.inner) st.strips = 1;
    renderCount();
  }

  function matchExisting(name) {
    var n = String(name || '').toLowerCase().trim();
    return (window._stockItems || []).find(function (it) {
      return String(it.item_name || '').toLowerCase().trim() === n;
    }) || null;
  }

  // ── Step 2: how much arrived ─────────────────────────────────────────────
  function known() { return !st.forceAsk && num(st.strips) > 0 && num(st.units) > 0; }
  // A brand new item always asks for its price; an existing one only if it has
  // never had one set (otherwise Quick Sale can't sell it).
  function needsPrice() { return st.itemType !== 'material' && !num(st.unitPrice); }

  function renderCount() {
    var isKnown = known();
    var cur = st.existing ? Number(st.existing.quantity) : null;
    var outerOne = one(st.outer), innerOne = one(st.inner);
    var single = !st.inner && num(st.units) === 1;   // bought one bottle at a time

    document.getElementById('stkTitle').textContent = st.name;
    document.getElementById('stkSub').textContent = st.existing
      ? (isKnown ? 'Stocked before — just say how many ' + st.outer + ' arrived.'
                 : 'Tell us the pack size once and it is remembered.')
      : 'New item. ' + (st.itemType === 'medicine' ? 'Medicine' : 'Counter item') +
        ', counted in ' + st.unit + '.';
    document.getElementById('stkSave').style.display = '';

    var h = '';
    if (cur !== null) {
      h += '<div class="stk-known">On the shelf now: <b>' +
        (cur < 0 ? 'short by ' + fmt(-cur) + ' ' + esc(st.unit) : fmt(cur) + ' ' + esc(st.unit)) +
        '</b></div>';
      // The batches already on the shelf, soonest-expiring first, so the owner
      // can see exactly which stock leaves next. Filled in once loaded.
      h += '<div id="stkBatches"></div>';
    }

    // Q1 — always asked. When there is no pack at all, this IS the count.
    h += '<div class="stk-q"><label class="stk-lbl" for="stkBoxes">How many ' +
         esc(single ? st.unit : st.outer) + ' did you receive?</label>' +
         '<input id="stkBoxes" class="stk-in" type="number" inputmode="numeric" min="1" step="1" ' +
         'value="' + (st.boxes || '') + '" placeholder="e.g. 5"></div>';

    if (isKnown) {
      if (!single) {
        h += '<div class="stk-known">One ' + esc(outerOne) + ' = ' +
             (st.inner ? '<b>' + fmt(st.strips) + ' ' + esc(num(st.strips) === 1 ? innerOne : st.inner) + '</b>, one ' +
                         esc(innerOne) + ' = ' : '') +
             '<b>' + fmt(st.units) + ' ' + esc(st.unit) + '</b>' +
             '<br><button class="stk-edit" id="stkChange">Change the pack size</button></div>';
      } else {
        h += '<div class="stk-known">Counted one ' + esc(one(st.unit)) + ' at a time.' +
             '<br><button class="stk-edit" id="stkChange">They come in a pack</button></div>';
      }
    } else {
      if (st.inner) {
        h += '<div class="stk-q"><label class="stk-lbl" for="stkStrips">How many ' + esc(st.inner) +
             ' are in one ' + esc(outerOne) + '?</label>' +
             '<input id="stkStrips" class="stk-in" type="number" inputmode="numeric" min="1" step="1" ' +
             'value="' + (st.strips || st.suggest.strips || '') + '" placeholder="e.g. 10">' +
             '<div class="hint">If it comes as a tin or a bottle rather than ' + esc(st.inner) + ', put 1.</div></div>';
      }
      h += '<div class="stk-q"><label class="stk-lbl" for="stkUnits">How many ' + esc(st.unit) +
           ' are in one ' + esc(st.inner ? innerOne : outerOne) + '?</label>' +
           '<input id="stkUnits" class="stk-in" type="number" inputmode="numeric" min="1" step="1" ' +
           'value="' + (st.units || st.suggest.units || '') + '" placeholder="e.g. 10">' +
           (st.suggest.note
             ? '<div class="hint">' + esc(st.suggest.note) + '</div>'
             : (st.suggest.units
                 ? '<div class="hint">' + (st.suggest.sure ? 'This is the pack size we have on record.'
                     : 'That is the usual pack — check your carton and change it if yours is different.') +
                   ' It is remembered after this.</div>'
                 : '')) +
           '</div>';
    }

    // Price — what Quick Sale needs. Asked once, on the way in, rather than
    // leaving an item on the shelf that cannot be sold.
    if (needsPrice()) {
      h += '<div class="stk-price"><div class="cap">Selling price</div>' +
           '<div class="stk-two">' +
             '<div><label class="stk-mini" for="stkUnitPrice">One ' + esc(one(st.unit)) + '</label>' +
               '<input id="stkUnitPrice" class="stk-in" type="number" inputmode="numeric" min="0" step="50" ' +
               'value="' + (st.unitPrice || '') + '" placeholder="e.g. 500"></div>' +
             '<div><label class="stk-mini" for="stkPackPrice">One ' +
               esc(st.inner ? innerOne : outerOne) + ' <span style="text-transform:none;letter-spacing:0;font-weight:600;color:#9AA0A6">— optional</span></label>' +
               '<input id="stkPackPrice" class="stk-in" type="number" inputmode="numeric" min="0" step="100" ' +
               'value="' + (st.packPrice || '') + '" placeholder="worked out"></div>' +
           '</div>' +
           '<div class="hint" id="stkPriceHint" style="font-size:12px;color:#5F6368;margin-top:7px;line-height:1.4"></div></div>';
    }

    // Each delivery is its own batch with its own expiry — different boxes,
    // different dates. Asked here, on the batch being added.
    h += '<div class="stk-q"><label class="stk-lbl" for="stkExpiry">Expiry date of this batch ' +
         '<span style="text-transform:none;letter-spacing:0;font-weight:600;color:#9AA0A6">— optional</span></label>' +
         '<input id="stkExpiry" class="stk-in" type="date" value="' + esc(st.expiry || '') + '">' +
         '<div class="hint">If this delivery expires sooner than what is already on the shelf, the app tracks the earlier date.</div></div>';

    // Low-stock warning level. Starts at 10 and is only touched if the owner
    // wants it different — never a question they have to answer.
    if (!st.existing) {
      h += '<div class="stk-q"><label class="stk-lbl" for="stkThreshold">Warn me when fewer than…</label>' +
           '<input id="stkThreshold" class="stk-in" type="number" inputmode="numeric" min="0" step="1" ' +
           'value="' + (st.threshold || 10) + '">' +
           '<div class="hint">' + esc(st.unit) + ' left on the shelf. Leave it at 10 if you are not sure.</div></div>';
    }

    h += '<div class="stk-sum" id="stkSum"></div>';
    document.getElementById('stkBody').innerHTML = h;

    ['stkBoxes', 'stkStrips', 'stkUnits', 'stkUnitPrice', 'stkPackPrice'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.oninput = recalc;
    });
    var th = document.getElementById('stkThreshold');
    if (th) th.oninput = function () { st.threshold = num(th.value); };
    var xp = document.getElementById('stkExpiry');
    if (xp) xp.onchange = function () { st.expiry = xp.value || ''; };
    var ch = document.getElementById('stkChange');
    if (ch) ch.onclick = function () { st.forceAsk = true; renderCount(); };
    recalc();
    setTimeout(function () { try { document.getElementById('stkBoxes').focus(); } catch (e) {} }, 120);
    loadBatches();
  }

  // Show the existing batches (soonest expiry first) so the owner sees exactly
  // which stock will be dispensed next. Best-effort — nothing if unavailable.
  function loadBatches() {
    var host = document.getElementById('stkBatches');
    if (!host || !st.existing || !st.existing.id || typeof window.stockBatchesFor !== 'function') return;
    window.stockBatchesFor(st.existing.id).then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) return;
      // The soonest live batch is the one FEFO empties first.
      var live = rows.filter(function (r) { return Number(r.quantity) > 0; });
      if (!live.length) return;
      var html = '<div class="stk-lbl" style="margin-top:14px">On the shelf — dispensed soonest-expiry first</div>' +
        '<div class="stk-batches">' +
        live.map(function (r, i) {
          var exp = r.expiry_date ? _shortDate(r.expiry_date) : 'no expiry';
          var cls = r.expired ? 'exp' : (r.expiring_soon ? 'soon' : '');
          var lead = i === 0 ? '<span class="lead">NEXT OUT</span>' : '';
          return '<div class="stk-batch ' + cls + '">' +
            '<span class="q">' + fmt(r.quantity) + ' ' + esc(st.unit) + '</span>' +
            '<span class="e">' + esc(exp) + '</span>' + lead + '</div>';
        }).join('') + '</div>';
      host.innerHTML = html;
    }).catch(function () {});
  }
  function _shortDate(d) {
    try {
      return new Date(String(d).slice(0, 10) + 'T00:00:00')
        .toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return String(d); }
  }

  function current() {
    var isKnown = known();
    var boxes  = num((document.getElementById('stkBoxes') || {}).value);
    var strips = isKnown ? num(st.strips)
               : (st.inner ? num((document.getElementById('stkStrips') || {}).value) : 1);
    var units  = isKnown ? num(st.units)  : num((document.getElementById('stkUnits')  || {}).value);
    return { boxes: boxes, strips: strips, units: units, total: boxes * strips * units };
  }

  function prices(c) {
    var up = num((document.getElementById('stkUnitPrice') || {}).value) || num(st.unitPrice);
    var pp = num((document.getElementById('stkPackPrice') || {}).value) || num(st.packPrice);
    // The pack price is optional exactly as asked — if it is left blank it is
    // worked out from the price of one, so a strip or a packet can still be
    // sold whole in Quick Sale.
    if (!pp && up && c.units > 1) pp = up * c.units;
    return { unit: up, pack: pp };
  }

  function recalc() {
    var c = current();
    var sum = document.getElementById('stkSum');
    var btn = document.getElementById('stkSave');
    var hint = document.getElementById('stkPriceHint');
    if (hint) {
      var p = prices(c);
      hint.textContent = !p.unit
        ? 'Quick Sale needs the price of one ' + one(st.unit) + '. You can still save without it and set it later.'
        : (c.units > 1
            ? 'One ' + one(st.inner || st.outer) + ' of ' + fmt(c.units) + ' ' + st.unit + ' sells for ' + money(p.pack) + '.'
            : 'Sells at ' + money(p.unit) + ' each.');
    }
    if (!c.boxes || !c.strips || !c.units) {
      sum.innerHTML = '<div class="note">Fill in the numbers above and the total appears here.</div>';
      btn.disabled = true;
      return;
    }
    var cur = st.existing ? Number(st.existing.quantity) : 0;
    var after = cur + c.total;
    var innerOne = one(st.inner), outerOne = one(st.outer);
    // The multiplication is shown in full so the owner can check it at a glance.
    var line = c.strips > 1
      ? fmt(c.boxes) + ' ' + st.outer + ' × ' + fmt(c.strips) + ' ' + (st.inner || 'packs') +
        ' × ' + fmt(c.units) + ' ' + st.unit
      : (c.units > 1
          ? fmt(c.boxes) + ' ' + st.outer + ' × ' + fmt(c.units) + ' ' + st.unit
          : fmt(c.boxes) + ' ' + st.unit);
    sum.innerHTML =
      '<div class="calc">' + esc(line) + '</div>' +
      '<div class="tot">' + fmt(c.total) + ' ' + esc(st.unit) + '</div>' +
      (st.existing
        ? '<div class="note">' +
            (cur < 0
              ? 'Clears a shortfall of ' + fmt(-cur) + ' and leaves <b>' + fmt(after) + ' ' + esc(st.unit) + '</b> on the shelf.'
              : 'Shelf goes from ' + fmt(cur) + ' to <b>' + fmt(after) + ' ' + esc(st.unit) + '</b>.') +
          '</div>'
        : '<div class="note">A new ' + (st.itemType === 'medicine' ? 'medicine' : 'item') +
          ' will be created with this amount' +
          (num(st.threshold) ? ', warning you below ' + fmt(st.threshold) + ' ' + esc(st.unit) : '') + '.</div>');
    btn.disabled = false;
    // Deliberately does NOT write c.strips / c.units back onto st: doing so
    // would make known() true mid-typing, and current() would then read the
    // remembered number instead of the box the owner had just cleared. The
    // save takes its numbers from current(), which always reads the fields.
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function save() {
    var c = current();
    if (!c.total) return;
    var p = prices(c);
    var btn = document.getElementById('stkSave');
    btn.disabled = true;
    var wasLabel = btn.textContent;
    btn.textContent = 'Adding…';
    // Remember the pack shape on THIS device, whatever the database can store.
    // Next delivery of the same item then asks only for the outer count.
    rememberTemplate(st.name, c.strips, c.units, c.boxes, {
      unit: st.unit, outer: st.outer, inner: st.inner, item_type: st.itemType,
    });
    try {
      var xp = document.getElementById('stkExpiry');
      var ok = await window.stockIntakeCommit({
        name: st.name, unit: st.unit, itemType: st.itemType, existing: st.existing,
        boxes: c.boxes, strips: c.strips, units: c.units, total: c.total,
        expiry: (xp && xp.value) || st.expiry || '',
        unitPrice: p.unit || null, packPrice: p.pack || null,
        threshold: num(st.threshold) || 10,
      });
      if (ok === false) { btn.disabled = false; btn.textContent = wasLabel; return; }
      // Taken before close(), which clears it so a cancelled sheet never fires
      // a stale callback later.
      var savedName = st.name, savedUnit = st.unit, back = done;
      close();
      toast(fmt(c.total) + ' ' + savedUnit + ' of ' + savedName + ' added to stock', 'success');
      // Hand control back to whoever opened this — a sale waiting to be
      // finished, most likely.
      if (back) { try { back(savedName); } catch (e) {} }
    } catch (e) {
      btn.disabled = false; btn.textContent = wasLabel;
      toast('Could not add the stock: ' + (e && e.message ? e.message : 'please try again'), 'error');
    }
  }

  // ── Public ───────────────────────────────────────────────────────────────
  // start()               — the owner taps "Add stock" or "+ New Item"
  // start(item)           — the owner taps "Restock" on a row already there
  // start(null, {query})  — opened from a search box, carrying what was typed
  // start(null, {onDone}) — called back once the item is on the shelf, so the
  //                         caller can return to whatever it was doing
  function start(item, opts) {
    opts = opts || {};
    done = typeof opts.onDone === 'function' ? opts.onDone : null;
    ensure();
    document.getElementById('stkOverlay').style.display = 'flex';
    openEm().catch(function () {});
    if (item) { pick({ name: item.item_name, existing: item, itemType: item.item_type }); }
    else {
      st = null;
      renderPick();
      // Whatever was typed in the search that sent us here is already the name
      // being looked for — type it once, not twice.
      var q = String(opts.query || '').trim();
      if (q) {
        var inp = document.getElementById('stkSearch');
        if (inp) {
          inp.value = q;
          openEm().then(function () {
            var el = document.getElementById('stkSearch');
            if (el && el.value === q) el.dispatchEvent(new Event('input', { bubbles: true }));
          }).catch(function () {});
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  }

  window.StockIntake = { start: start, close: close, suggest: suggest };
})();
