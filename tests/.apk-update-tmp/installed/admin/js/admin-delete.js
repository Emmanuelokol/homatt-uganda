/* Homatt Health — permanently delete a facility
 *
 * WHY THIS EXISTS
 * ---------------
 * Every facility page had its own delete, and none of them worked properly:
 *
 *   • Pharmacies and riders asked with window.confirm(). Android WebViews
 *     block that dialog — it returns false without showing anything — so the
 *     delete button did nothing at all. To the admin, the option simply was
 *     not there.
 *   • And what those pages called "remove" was only a status flag. The row,
 *     its records and its logins all stayed in the database for ever, with no
 *     way to actually get rid of a facility.
 *
 * So the confirmation is an in-page modal (never a native dialog), and the
 * delete goes as deep as the database will allow, in three steps:
 *
 *   1. The admin_delete_<kind> RPC — a full wipe including staff logins.
 *   2. If that RPC is not installed: delete the dependent rows from the
 *      client, then the facility row itself.
 *   3. If even that is refused: mark it removed so it leaves the live list,
 *      and SAY SO, rather than claiming a permanent delete that did not happen.
 *
 * Typing the facility's name is required. This is not undoable.
 */
(function () {
  'use strict';

  var st = null;   // the delete being confirmed

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m, k) { try { showAdminToast(m, k || 'default'); } catch (e) {} }

  function ensure() {
    if (document.getElementById('adDelOverlay')) return;
    var css = document.createElement('style');
    css.textContent = [
      '#adDelOverlay{position:fixed;inset:0;background:rgba(10,15,20,.62);z-index:9000;display:none;align-items:center;justify-content:center;padding:18px}',
      '#adDelBox{background:#fff;border-radius:18px;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden}',
      '.ad-del-h{padding:16px 20px;border-bottom:1px solid #EEE;font-size:16px;font-weight:800;color:#C62828}',
      '.ad-del-b{padding:18px 20px}',
      '.ad-del-b p{font-size:14px;color:#333;margin:0 0 10px;line-height:1.55}',
      '.ad-del-warn{font-size:13px;color:#C62828;font-weight:700;margin-bottom:14px}',
      '.ad-del-lbl{display:block;font-size:12px;font-weight:700;color:#5F6368;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}',
      '#adDelInput{width:100%;padding:12px 14px;border:1.5px solid #E0E0E0;border-radius:12px;font-size:15px;font-family:inherit;outline:none;box-sizing:border-box}',
      '#adDelInput:focus{border-color:#C62828}',
      '#adDelErr{display:none;background:#FFEBEE;color:#C62828;border-radius:10px;padding:10px 12px;font-size:12.5px;margin-top:10px;line-height:1.5}',
      '.ad-del-f{display:flex;gap:10px;margin-top:16px}',
      '.ad-del-f button{flex:1;padding:12px;border-radius:12px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}',
      '#adDelCancel{background:#fff;border:1.5px solid #E0E0E0;color:#333}',
      '#adDelGo{background:#C62828;border:none;color:#fff}',
      '#adDelGo:disabled{opacity:.45;cursor:not-allowed}',
    ].join('\n');
    document.head.appendChild(css);

    var ov = document.createElement('div');
    ov.id = 'adDelOverlay';
    ov.innerHTML =
      '<div id="adDelBox">' +
        '<div class="ad-del-h" id="adDelTitle">Delete permanently</div>' +
        '<div class="ad-del-b">' +
          '<p id="adDelText"></p>' +
          '<div class="ad-del-warn">This cannot be undone. To take it offline temporarily, use Suspend instead.</div>' +
          '<label class="ad-del-lbl" for="adDelInput">Type the name to confirm</label>' +
          '<input id="adDelInput" type="text" autocomplete="off">' +
          '<div id="adDelErr"></div>' +
          '<div class="ad-del-f">' +
            '<button id="adDelCancel" type="button">Cancel</button>' +
            '<button id="adDelGo" type="button" disabled>Delete permanently</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('adDelCancel').onclick = close;
    document.getElementById('adDelInput').addEventListener('input', function () {
      var want = String((st && st.name) || '').trim().toLowerCase();
      var got  = this.value.trim().toLowerCase();
      document.getElementById('adDelGo').disabled = !want || got !== want;
    });
    document.getElementById('adDelGo').onclick = run;
  }

  function close() {
    var o = document.getElementById('adDelOverlay');
    if (o) o.style.display = 'none';
    st = null;
  }
  function fail(msg) {
    var e = document.getElementById('adDelErr');
    if (e) { e.textContent = msg; e.style.display = 'block'; }
    var b = document.getElementById('adDelGo');
    if (b) { b.disabled = false; b.textContent = 'Delete permanently'; }
  }

  async function run() {
    if (!st) return;
    // close() clears st, so everything needed afterwards is taken first.
    var me = st;
    var btn = document.getElementById('adDelGo');
    btn.disabled = true; btn.textContent = 'Deleting…';
    document.getElementById('adDelErr').style.display = 'none';

    var supa = (typeof adminSupa === 'function') ? adminSupa() : null;
    if (!supa) { fail('Demo mode — nothing was deleted.'); return; }

    // 1. The proper wipe.
    var err = null;
    try {
      var r = await supa.rpc(me.rpc, me.rpcArg);
      err = r.error ? r.error.message
          : (r.data && r.data.ok === false ? r.data.error : null);
      if (!err) {
        close();
        if (me.onDone) { try { await me.onDone(); } catch (e) {} }
        toast('"' + me.name + '" permanently deleted' +
          (r.data && r.data.staff_logins_removed
            ? ' (' + r.data.staff_logins_removed + ' staff login' +
              (r.data.staff_logins_removed !== 1 ? 's' : '') + ' removed)' : ''));
        return;
      }
    } catch (e) { err = (e && e.message) || 'rpc failed'; }

    // 2. The RPC is not installed on this database — do what the client can.
    if (!/could not find the function|does not exist|schema cache/i.test(err || '')) {
      fail('Delete failed: ' + err);
      return;
    }
    var blocked = [];
    for (var i = 0; i < (me.cascade || []).length; i++) {
      var t = me.cascade[i];
      try {
        var d = await supa.from(t.table).delete().eq(t.column, me.id);
        if (d.error && !/does not exist|schema cache/i.test(d.error.message || '')) blocked.push(t.table);
      } catch (e2) { blocked.push(t.table); }
    }
    var dc = await supa.from(me.table).delete().eq('id', me.id);
    if (!dc.error) {
      close();
      if (me.onDone) { try { await me.onDone(); } catch (e) {} }
      toast('"' + me.name + '" deleted' +
        (blocked.length ? ' — some linked records were protected; run the delete SQL for a full wipe' : ''));
      return;
    }

    // 3. Even the row itself is protected. Take it out of the live list and be
    //    honest that this is not the permanent delete that was asked for.
    var soft = { status: 'removed' };
    if (me.softExtra) Object.keys(me.softExtra).forEach(function (k) { soft[k] = me.softExtra[k]; });
    var sd = await supa.from(me.table).update(soft).eq('id', me.id);
    if (!sd.error) {
      close();
      if (me.onDone) { try { await me.onDone(); } catch (e) {} }
      toast('"' + me.name + '" removed from the live list — NOT permanently deleted. ' +
            'Run ' + (me.sqlFile || 'the admin-delete SQL') + ' in Supabase for a full wipe.', 'error');
      return;
    }
    fail('Could not delete: ' + (dc.error.message || sd.error.message) +
         ' — run ' + (me.sqlFile || 'the admin-delete SQL') + ' in Supabase, then try again.');
  }

  /* start({ kind, id, name, table, rpc, rpcArg, cascade, softExtra, sqlFile, onDone })
   *   kind      — the word shown to the admin ("pharmacy", "rider")
   *   cascade   — [{table, column}] rows to remove when the RPC is missing
   *   softExtra — extra columns for the last-resort soft delete
   */
  function start(opts) {
    ensure();
    st = opts || {};
    document.getElementById('adDelTitle').textContent =
      'Delete ' + (st.kind || 'facility') + ' permanently';
    document.getElementById('adDelText').innerHTML =
      'This permanently deletes <strong>' + esc(st.name) + '</strong>, all of its records' +
      (st.alsoText ? ' ' + esc(st.alsoText) : '') +
      '. Patients keep their own history.';
    var inp = document.getElementById('adDelInput');
    inp.value = '';
    document.getElementById('adDelErr').style.display = 'none';
    var go = document.getElementById('adDelGo');
    go.disabled = true; go.textContent = 'Delete permanently';
    document.getElementById('adDelOverlay').style.display = 'flex';
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 120);
  }

  window.AdminDelete = { start: start, close: close };
})();
