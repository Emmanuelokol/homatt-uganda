/* Homatt Health — correcting what was already recorded
 *
 * A clinic asked to be able to fix what they had already saved: a quick sale
 * with the wrong quantity, a treatment where the lab test or the money was
 * forgotten, a patient whose name was typed wrong — and to have all of that
 * be the main account's job, "not sub accounts".
 *
 * WHY THIS FILE DOES NOT DECIDE WHO MAY DO IT
 * -------------------------------------------
 * It hides the buttons, and hiding a button decides nothing. Every correction
 * here goes through a security-definer RPC that checks
 * `is_clinic_main_account()` in the database, and the direct UPDATE and DELETE
 * that used to be open to every member of staff have been closed
 * (supabase/migrations/20260912_owner_corrections.sql). A receptionist who
 * opens the console gets the same "only the main account" refusal as one who
 * taps a button that is not there.
 *
 * So `clinicCan('corrections')` below is about tidiness, not safety: an owner
 * sees the controls, everybody else is not shown something they cannot use.
 *
 * WHAT A CORRECTION IS ALLOWED TO CHANGE
 * --------------------------------------
 * Numbers and names. Not the diagnosis, not who recorded it, not the date —
 * changing what somebody was treated for, after the fact, is not a correction,
 * it is a different record, and it would rewrite the clinic's clinical history
 * with no trace on the screen that it had happened.
 *
 * Every change writes an audit row in the database: who, when, from, to.
 *
 * IT NEEDS A CONNECTION, and says so. A correction cannot be queued in the
 * offline outbox the way a new sale can: the outbox replays inserts, and
 * replaying "set the quantity to 6" against a row somebody has since changed
 * again would quietly undo their work. Better to say "this needs a connection"
 * than to take a correction the clinic believes has happened.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ugx(n) { return 'UGX ' + (Number(n) || 0).toLocaleString('en-UG'); }

  function mayCorrect() {
    try { return typeof clinicCan === 'function' ? clinicCan('corrections') : false; }
    catch (e) { return false; }
  }

  function clinicId() {
    try { return (JSON.parse(localStorage.getItem('clinic_session') || '{}') || {}).clinicId || null; }
    catch (e) { return null; }
  }

  // ── The look ────────────────────────────────────────────────────────────
  // A fill colour and the words on it are defined as a PAIR here, for both
  // themes. Four separate unreadable-text faults in this app came from a fill
  // token borrowed for words, and this panel is injected at runtime so a page
  // sweep walks straight past it.
  function ensureCss() {
    if ($('cxCss')) return;
    var s = document.createElement('style');
    s.id = 'cxCss';
    s.textContent = [
      ':root{--cx-warn-bg:#FFF4E5;--cx-danger-bg:#FFEBEE}',
      'html[data-theme="dark"]{--cx-warn-bg:rgba(255,184,112,.16);--cx-danger-bg:rgba(255,138,128,.16)}',
      '.cx-wrap{padding:10px 16px 4px;flex-shrink:0}',
      '.cx-h{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;' +
        'color:var(--text-lt);margin-bottom:7px}',
      '.cx-h .material-icons-outlined{font-size:17px}',
      '.cx-row{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:12px;' +
        'background:var(--bg);border:1px solid var(--border);margin-bottom:6px}',
      '.cx-row .nm{flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--text);' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cx-row .sub{font-size:11.5px;color:var(--text-lt);font-weight:600;margin-top:1px;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cx-btn{border:1px solid var(--border);background:var(--surface);color:var(--text);' +
        'border-radius:9px;padding:6px 10px;font:inherit;font-size:12px;font-weight:700;' +
        'cursor:pointer;white-space:nowrap;touch-action:manipulation}',
      '.cx-btn.danger{color:var(--danger-ink);border-color:var(--danger)}',
      '.cx-empty{font-size:12px;color:var(--text-lt);padding:6px 2px 10px;line-height:1.5}',

      '.cx-ov{display:none;position:fixed;inset:0;background:rgba(10,20,16,.6);z-index:980;' +
        'align-items:center;justify-content:center;padding:18px}',
      '.cx-card{background:var(--surface);color:var(--text);border-radius:18px;width:100%;' +
        'max-width:440px;max-height:90vh;overflow-y:auto;padding:18px;box-shadow:var(--shadow-lg)}',
      '.cx-card h4{font-size:16.5px;font-weight:800;margin:0 0 4px;color:var(--text)}',
      '.cx-card .why{font-size:12.5px;line-height:1.55;color:var(--text-lt);margin-bottom:13px}',
      '.cx-f{margin-bottom:11px}',
      '.cx-f label{display:block;font-size:11.5px;font-weight:800;color:var(--text-lt);' +
        'margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}',
      '.cx-f input,.cx-f textarea{width:100%;border:1.5px solid var(--border);border-radius:11px;' +
        'padding:10px 12px;font:inherit;font-size:15px;background:var(--bg);color:var(--text)}',
      '.cx-tot{font-size:13px;font-weight:700;color:var(--text);background:var(--brand-tint);' +
        'color:var(--brand-ink);border-radius:11px;padding:10px 12px;margin-bottom:11px;line-height:1.5}',
      '.cx-msg{font-size:12.5px;line-height:1.55;border-radius:11px;padding:10px 12px;' +
        'margin-bottom:11px;display:none}',
      '.cx-msg.bad{background:var(--cx-danger-bg);color:var(--danger-ink)}',
      '.cx-msg.warn{background:var(--cx-warn-bg);color:var(--warning-ink)}',
      '.cx-acts{display:flex;gap:8px;margin-top:4px}',
      '.cx-acts button{flex:1;border:none;border-radius:12px;padding:12px;font:inherit;' +
        'font-size:14px;font-weight:800;cursor:pointer;touch-action:manipulation}',
      '.cx-acts .go{background:var(--primary);color:var(--on-primary,#fff)}',
      '.cx-acts .off{background:var(--bg);color:var(--text-lt);border:1px solid var(--border)}',
      '.cx-acts .rm{background:var(--danger);color:#fff}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function ensureDialog() {
    ensureCss();
    if ($('cxOverlay')) return;
    var d = document.createElement('div');
    d.id = 'cxOverlay';
    d.className = 'cx-ov';
    d.innerHTML = '<div class="cx-card" id="cxCard"></div>';
    d.addEventListener('click', function (e) { if (e.target === d) closeDialog(); });
    document.body.appendChild(d);
  }
  function openDialog(html) {
    ensureDialog();
    $('cxCard').innerHTML = html;
    $('cxOverlay').style.display = 'flex';
  }
  function closeDialog() {
    var o = $('cxOverlay');
    if (o) o.style.display = 'none';
  }

  function say(kind, text) {
    var m = $('cxMsg');
    if (!m) return;
    m.className = 'cx-msg ' + (kind || 'bad');
    m.textContent = text;
    m.style.display = 'block';
  }

  // Every correction goes to the server. There is no offline path on purpose —
  // see the note at the top of this file.
  async function callRpc(name, args) {
    if (navigator.onLine === false) {
      return { ok: false, error: 'A correction needs a connection — it has to reach the records. ' +
                                'Nothing has been changed.' };
    }
    try {
      var r = await supabase.rpc(name, args);
      if (r.error) return { ok: false, error: r.error.message || 'The server refused the change.' };
      var d = r.data || {};
      if (d.ok === false) return { ok: false, error: d.error || 'The change was refused.' };
      return { ok: true, data: d };
    } catch (e) {
      return { ok: false, error: 'Could not reach the records: ' + (e.message || e) };
    }
  }

  function toast(msg, kind) {
    try { if (typeof showToast === 'function') { showToast(msg, kind || 'success'); return; } } catch (e) {}
  }

  /* ── Quick sales: today's, and correcting one ──────────────────────────
   *
   * Only today's. A correction is something you make minutes after the sale,
   * having miscounted or mis-tapped; a list going back weeks turns a repair
   * tool into a way to quietly rewrite last month's takings.
   */
  async function loadTodaySales() {
    var cid = clinicId();
    if (!cid) return [];
    var since = new Date();
    since.setHours(0, 0, 0, 0);
    try {
      var r = await supabase.from('clinic_quick_sales')
        .select('id,drug_name,unit,quantity,unit_price_ugx,total_ugx,payment_method,created_at')
        .eq('clinic_id', cid)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(40);
      return (r && r.data) || [];
    } catch (e) { return []; }
  }

  async function renderSaleList(hostId) {
    var host = $(hostId);
    if (!host) return;
    if (!mayCorrect()) { host.innerHTML = ''; return; }
    ensureCss();
    host.innerHTML = '<div class="cx-wrap"><div class="cx-h">' +
      '<span class="material-icons-outlined">history</span>Sales today — tap to correct</div>' +
      '<div class="cx-empty">Loading…</div></div>';
    var rows = await loadTodaySales();
    var body = rows.length
      ? rows.map(function (s) {
          var t = new Date(s.created_at);
          var hh = isNaN(t) ? '' : t.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' });
          return '<div class="cx-row">' +
            '<div style="flex:1;min-width:0">' +
              '<div class="nm">' + esc(s.drug_name) + '</div>' +
              '<div class="sub">' + esc(String(s.quantity)) + ' × ' + ugx(s.unit_price_ugx) +
                ' = ' + ugx(s.total_ugx) + (hh ? ' · ' + hh : '') + '</div>' +
            '</div>' +
            '<button class="cx-btn" data-cxsale="' + esc(s.id) + '">Correct</button>' +
            '<button class="cx-btn danger" data-cxsaledel="' + esc(s.id) + '">Remove</button>' +
          '</div>';
        }).join('')
      : '<div class="cx-empty">No sales recorded today.</div>';
    host.innerHTML = '<div class="cx-wrap"><div class="cx-h">' +
      '<span class="material-icons-outlined">history</span>Sales today — tap to correct</div>' +
      body + '</div>';

    host.querySelectorAll('[data-cxsale]').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = rows.find(function (x) { return String(x.id) === b.getAttribute('data-cxsale'); });
        if (s) editSaleDialog(s, hostId);
      });
    });
    host.querySelectorAll('[data-cxsaledel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = rows.find(function (x) { return String(x.id) === b.getAttribute('data-cxsaledel'); });
        if (s) deleteSaleDialog(s, hostId);
      });
    });
  }

  function editSaleDialog(sale, hostId) {
    openDialog(
      '<h4>Correct this sale</h4>' +
      '<div class="why">' + esc(sale.drug_name) + ' — recorded as ' + esc(String(sale.quantity)) +
        ' × ' + ugx(sale.unit_price_ugx) + '. Changing the quantity moves the stock by the ' +
        'difference, so the shelf stays right.</div>' +
      '<div class="cx-msg" id="cxMsg"></div>' +
      '<div class="cx-f"><label>How many were actually sold</label>' +
        '<input id="cxQty" type="number" inputmode="numeric" min="1" value="' + esc(String(sale.quantity)) + '"></div>' +
      '<div class="cx-f"><label>Price each (UGX)</label>' +
        '<input id="cxPrice" type="number" inputmode="numeric" min="0" value="' + esc(String(Number(sale.unit_price_ugx) || 0)) + '"></div>' +
      '<div class="cx-tot" id="cxTot"></div>' +
      '<div class="cx-f"><label>Why (kept with the record)</label>' +
        '<input id="cxWhy" type="text" placeholder="e.g. counted wrong"></div>' +
      '<div class="cx-acts">' +
        '<button class="off" id="cxCancel">Leave it</button>' +
        '<button class="go" id="cxSave">Save the correction</button>' +
      '</div>');

    function paint() {
      var q = Math.max(0, Number($('cxQty').value) || 0);
      var p = Math.max(0, Number($('cxPrice').value) || 0);
      var back = Number(sale.quantity) - q;
      $('cxTot').innerHTML = 'New total <b>' + ugx(q * p) + '</b>' +
        (back > 0 ? ' · ' + back + ' going back on the shelf'
                  : back < 0 ? ' · ' + (-back) + ' more coming off the shelf' : '');
    }
    $('cxQty').addEventListener('input', paint);
    $('cxPrice').addEventListener('input', paint);
    paint();

    $('cxCancel').addEventListener('click', closeDialog);
    $('cxSave').addEventListener('click', async function () {
      var q = Number($('cxQty').value) || 0;
      var p = Number($('cxPrice').value);
      if (q < 1) { say('bad', 'A sale of nothing is a removal — use Remove instead.'); return; }
      if (!(p >= 0)) { say('bad', 'A price cannot be negative.'); return; }
      this.disabled = true; this.textContent = 'Saving…';
      var r = await callRpc('edit_quick_sale', {
        p_sale_id: sale.id, p_quantity: q, p_unit_price_ugx: p,
        p_payment_method: null, p_reason: ($('cxWhy').value || '').trim() || null,
      });
      this.disabled = false; this.textContent = 'Save the correction';
      if (!r.ok) { say('bad', r.error); return; }
      closeDialog();
      toast('Sale corrected' + (r.data.stock_returned ? ' · ' + r.data.stock_returned + ' back in stock' : ''));
      renderSaleList(hostId);
      refreshAfterMoneyChange();
    });
  }

  function deleteSaleDialog(sale, hostId) {
    openDialog(
      '<h4>Remove this sale?</h4>' +
      '<div class="why">' + esc(sale.drug_name) + ' — ' + esc(String(sale.quantity)) + ' × ' +
        ugx(sale.unit_price_ugx) + ' = <b>' + ugx(sale.total_ugx) + '</b>.<br><br>' +
        'It comes off the day\'s takings, and <b>' + esc(String(sale.quantity)) +
        '</b> goes back on the shelf. The record of the removal is kept.</div>' +
      '<div class="cx-msg" id="cxMsg"></div>' +
      '<div class="cx-f"><label>Why (kept with the record)</label>' +
        '<input id="cxWhy" type="text" placeholder="e.g. rang it up twice"></div>' +
      '<div class="cx-acts">' +
        '<button class="off" id="cxCancel">Keep it</button>' +
        '<button class="rm" id="cxDel">Remove the sale</button>' +
      '</div>');
    $('cxCancel').addEventListener('click', closeDialog);
    $('cxDel').addEventListener('click', async function () {
      this.disabled = true; this.textContent = 'Removing…';
      var r = await callRpc('delete_quick_sale', {
        p_sale_id: sale.id, p_reason: ($('cxWhy').value || '').trim() || null });
      this.disabled = false; this.textContent = 'Remove the sale';
      if (!r.ok) { say('bad', r.error); return; }
      closeDialog();
      toast((r.data.stock_returned || 0) + ' back in stock · sale removed');
      renderSaleList(hostId);
      refreshAfterMoneyChange();
    });
  }

  /* ── A visit: the drug, the test or the money that was forgotten ──────── */
  function editVisitDialog(visit, onDone) {
    var cons = Number(visit.consultation_fee_ugx) || 0;
    var lab  = Number(visit.lab_fee_ugx) || 0;
    var meds = Number(visit.meds_fee_ugx) || 0;
    var paid = Number(visit.amount_paid) || 0;
    var tests = (visit.lab_tests_ordered || []).join(', ');

    openDialog(
      '<h4>Correct this treatment</h4>' +
      '<div class="why">' + esc(visit.confirmed_diagnosis || 'This visit') +
        '. Add the lab test, the medicine or the money that was missed. ' +
        'The diagnosis, who recorded it and the date are not changed here — ' +
        'that would be a different record, not a correction.</div>' +
      '<div class="cx-msg" id="cxMsg"></div>' +
      '<div class="cx-f"><label>Lab tests (separate with a comma)</label>' +
        '<input id="cxTests" type="text" value="' + esc(tests) + '" placeholder="e.g. Malaria RDT, Blood slide"></div>' +
      '<div class="cx-f"><label>Treatment / medicines given</label>' +
        '<textarea id="cxPlan" rows="3" placeholder="what was actually given">' +
        esc(visit.treatment_plan || '') + '</textarea></div>' +
      '<div class="cx-f"><label>Consultation fee (UGX)</label>' +
        '<input id="cxCons" type="number" inputmode="numeric" min="0" value="' + cons + '"></div>' +
      '<div class="cx-f"><label>Lab fee (UGX)</label>' +
        '<input id="cxLab" type="number" inputmode="numeric" min="0" value="' + lab + '"></div>' +
      '<div class="cx-f"><label>Medicines fee (UGX)</label>' +
        '<input id="cxMeds" type="number" inputmode="numeric" min="0" value="' + meds + '"></div>' +
      '<div class="cx-f"><label>Paid so far (UGX)</label>' +
        '<input id="cxPaid" type="number" inputmode="numeric" min="0" value="' + paid + '"></div>' +
      '<div class="cx-tot" id="cxTot"></div>' +
      '<div class="cx-f"><label>Why (kept with the record)</label>' +
        '<input id="cxWhy" type="text" placeholder="e.g. forgot the lab test"></div>' +
      '<div class="cx-acts">' +
        '<button class="off" id="cxCancel">Leave it</button>' +
        '<button class="go" id="cxSave">Save the correction</button>' +
      '</div>');

    function paint() {
      var t = (Number($('cxCons').value) || 0) + (Number($('cxLab').value) || 0) +
              (Number($('cxMeds').value) || 0);
      var p = Math.min(Math.max(0, Number($('cxPaid').value) || 0), t);
      // The AMOUNT decides the status, not a chip — the same rule the
      // treatment screen follows, so a correction cannot settle a debt by
      // mistyping.
      var status = t <= 0 ? '—' : p <= 0 ? 'Pending' : p >= t ? 'Paid' : 'Part payment';
      $('cxTot').innerHTML = 'Bill <b>' + ugx(t) + '</b> · paid <b>' + ugx(p) + '</b>' +
        (t > p ? ' · <b>' + ugx(t - p) + '</b> still owing' : '') + ' — ' + status;
    }
    ['cxCons', 'cxLab', 'cxMeds', 'cxPaid'].forEach(function (id) {
      $(id).addEventListener('input', paint);
    });
    paint();

    $('cxCancel').addEventListener('click', closeDialog);
    $('cxSave').addEventListener('click', async function () {
      this.disabled = true; this.textContent = 'Saving…';
      var list = ($('cxTests').value || '').split(',')
        .map(function (x) { return x.trim(); }).filter(Boolean);
      var r = await callRpc('edit_visit_record', {
        p_visit_id: visit.id,
        p_prescription_items: null,
        p_lab_tests_ordered: list,
        p_consultation_fee: Number($('cxCons').value) || 0,
        p_lab_fee: Number($('cxLab').value) || 0,
        p_meds_fee: Number($('cxMeds').value) || 0,
        p_amount_paid: Number($('cxPaid').value) || 0,
        p_treatment_plan: ($('cxPlan').value || '').trim() || null,
        p_reason: ($('cxWhy').value || '').trim() || null,
      });
      this.disabled = false; this.textContent = 'Save the correction';
      if (!r.ok) { say('bad', r.error); return; }
      closeDialog();
      toast('Treatment corrected · ' + ugx(r.data.total_charged_ugx) + ' ' + r.data.payment_status);
      if (typeof onDone === 'function') onDone(r.data);
      refreshAfterMoneyChange();
    });
  }

  /* ── A patient ─────────────────────────────────────────────────────────── */
  function editPatientDialog(p, onDone) {
    openDialog(
      '<h4>Correct this patient</h4>' +
      '<div class="why">A name or a number typed wrong is the usual reason there ' +
        'are two records for one person.</div>' +
      '<div class="cx-msg" id="cxMsg"></div>' +
      '<div class="cx-f"><label>Full name</label>' +
        '<input id="cxName" type="text" value="' + esc(p.full_name || '') + '"></div>' +
      '<div class="cx-f"><label>Phone</label>' +
        '<input id="cxPhone" type="tel" inputmode="tel" value="' + esc(p.phone || '') + '"></div>' +
      '<div class="cx-f"><label>Why (kept with the record)</label>' +
        '<input id="cxWhy" type="text" placeholder="e.g. spelt wrong at registration"></div>' +
      '<div class="cx-acts">' +
        '<button class="off" id="cxCancel">Leave it</button>' +
        '<button class="go" id="cxSave">Save</button>' +
      '</div>');
    $('cxCancel').addEventListener('click', closeDialog);
    $('cxSave').addEventListener('click', async function () {
      var name = ($('cxName').value || '').trim();
      var phone = ($('cxPhone').value || '').trim();
      if (!name) { say('bad', 'A patient needs a name.'); return; }
      if (!phone) { say('bad', 'A patient needs a phone number.'); return; }
      this.disabled = true; this.textContent = 'Saving…';
      var r = await callRpc('edit_clinic_patient', {
        p_patient_id: p.id, p_full_name: name, p_phone: phone, p_notes: null,
        p_reason: ($('cxWhy').value || '').trim() || null });
      this.disabled = false; this.textContent = 'Save';
      if (!r.ok) { say('bad', r.error); return; }
      closeDialog();
      toast('Patient record corrected');
      if (typeof onDone === 'function') onDone();
    });
  }

  function deletePatientDialog(p, onDone) {
    openDialog(
      '<h4>Remove ' + esc(p.full_name || 'this patient') + '?</h4>' +
      '<div class="why">If this person has ever been treated here, the record is ' +
        '<b>archived, not destroyed</b> — their treatments are a medical record and ' +
        'deleting them to tidy a list is not a trade worth making. A duplicate with ' +
        'no history is removed outright.</div>' +
      '<div class="cx-msg" id="cxMsg"></div>' +
      '<div class="cx-f"><label>Why (kept with the record)</label>' +
        '<input id="cxWhy" type="text" placeholder="e.g. duplicate of the same person"></div>' +
      '<div class="cx-acts">' +
        '<button class="off" id="cxCancel">Keep it</button>' +
        '<button class="rm" id="cxDel">Remove</button>' +
      '</div>');
    $('cxCancel').addEventListener('click', closeDialog);
    $('cxDel').addEventListener('click', async function () {
      this.disabled = true; this.textContent = 'Removing…';
      var r = await callRpc('delete_clinic_patient', {
        p_patient_id: p.id, p_reason: ($('cxWhy').value || '').trim() || null });
      this.disabled = false; this.textContent = 'Remove';
      if (!r.ok) { say('bad', r.error); return; }
      closeDialog();
      toast(r.data.archived
        ? 'Archived — they have ' + r.data.visits + ' treatment' +
          (r.data.visits === 1 ? '' : 's') + ' on record, which are kept'
        : 'Patient record removed');
      if (typeof onDone === 'function') onDone(r.data);
    });
  }

  // The takings on the dashboard are now wrong by however much just changed.
  function refreshAfterMoneyChange() {
    try { if (typeof loadFinancials === 'function') loadFinancials(); } catch (e) {}
    try { if (typeof refreshDashboard === 'function') refreshDashboard(); } catch (e) {}
    try { if (typeof loadQsDrugs === 'function') loadQsDrugs(); } catch (e) {}
  }

  window.HomattCorrect = {
    may: mayCorrect,
    renderSaleList: renderSaleList,
    editVisit: editVisitDialog,
    editPatient: editPatientDialog,
    deletePatient: deletePatientDialog,
    close: closeDialog,
  };
})();
