/* Homatt Health — the clinical camera on a patient's file.
 *
 * A photograph of a wound, a rash, a swelling or a lab slip is part of the
 * record. Taking one with the phone's own camera app is not: that writes a
 * full-resolution file into shared storage, registers it with MediaStore, and
 * from that moment a patient's ulcer is in the gallery, in the photo backup,
 * and in whatever gallery app the clinic's phone came with. Nothing in this
 * app can reach in and take it back.
 *
 * So this module never hands the picture to the operating system at all.
 *
 *   1. THE VIEWPORT IS OURS. getUserMedia gives a live stream straight into a
 *      <video> in the page. There is no Intent, no file picker, no
 *      ACTION_IMAGE_CAPTURE — so no MediaStore row is ever created, because no
 *      other process ever sees the frame. `<input type="file" capture>` (which
 *      Messages uses for a chat photo, correctly) would do the opposite: on
 *      most Android builds it launches the camera app, which saves to the
 *      gallery first and hands us a copy.
 *
 *   2. THE FRAME IS RE-DRAWN, NOT COPIED. The pixels go through a <canvas>
 *      and come back out as a fresh JPEG. This is why there is no EXIF strip
 *      step anywhere below: a canvas holds raster data and nothing else, so
 *      the encoder has no GPS tag, no timestamp, no device name and no
 *      orientation flag to write. Metadata is not filtered out — it has no
 *      route in. A filter can miss a tag it has never heard of; this cannot.
 *
 *      Measured rather than assumed. The file the encoder produces holds
 *      exactly two blocks: the JFIF header, and a 472-byte generic sRGB
 *      ICC_PROFILE that says how to read the colours. No Exif, no XMP, no
 *      IPTC, no comment — the three places a location could live are all
 *      absent. The colour profile is deliberately KEPT: judging how red a
 *      cellulitis is, or how yellow a sclera, is exactly the sort of thing
 *      that goes wrong when a phone's colours are interpreted as some other
 *      phone's, and it costs half a kilobyte of the fifty.
 *
 *   3. IT IS STORED INSIDE THE APP. Capacitor's Directory.Data is the app's
 *      own internal files directory, which no media scanner walks and no other
 *      app can read. A `.nomedia` marker goes in beside it anyway — asked for,
 *      cheap, and belt-and-braces for the day somebody changes the directory.
 *      In a browser, and in an APK built before the Filesystem plugin was
 *      added, the bytes live in IndexedDB instead, which is per-origin private
 *      storage in the app's own data directory and equally invisible to a
 *      gallery.
 *
 *   4. IT NEVER LEAVES THE PHONE. Nothing here uploads. A photograph that
 *      syncs is a photograph in somebody's bucket, and that was not asked for
 *      and is not free to give away.
 *
 * Everything is capped under 50 KB, because a clinic on Ugandan mobile data
 * with a 32 GB phone cannot carry full-resolution photographs and does not
 * need to: what a clinician looks at is the colour, the margin and the size.
 */
(function (root) {
  'use strict';

  // Under 50 KB, as a hard ceiling rather than a target.
  var LIMIT = 50 * 1024;

  var DB_NAME = 'homatt_clinical_media', DB_VER = 1, STORE = 'photos';

  // Inside Directory.Data — the app's private internal files directory.
  var FOLDER = 'homatt_clinical';
  var NOMEDIA = FOLDER + '/.nomedia';

  var _stream = null, _facing = 'environment', _built = false;
  var _visit = null, _shot = null, _editing = null, _onClose = null;
  var _url = null;             // the object URL currently on screen, to revoke

  /* ── who may ───────────────────────────────────────────────────────────
   * A photograph of a patient is clinical work. The people who do clinical
   * work here are the owner, the clinic's clinicians and nurses, and a
   * visiting clinician — all of whom hold 'consultations'. A receptionist and
   * a drug-shop salesperson do not, and have no reason to photograph anybody. */
  function may() {
    try { return typeof clinicCan === 'function' ? clinicCan('consultations') : true; }
    catch (e) { return false; }
  }

  // Removing a saved photograph follows the same rule as removing a sale or a
  // patient: the main account only. A blurry one can be retaken and both kept;
  // letting any member of staff erase what was recorded is a different thing.
  function mayDelete() {
    try { return !!(root.HomattCorrect && root.HomattCorrect.may()); } catch (e) { return false; }
  }

  // ── the sandbox ───────────────────────────────────────────────────────

  function fsPlugin() {
    try {
      if (!root.Capacitor || !root.Capacitor.Plugins) return null;
      if (root.Capacitor.isNativePlatform && !root.Capacitor.isNativePlatform()) return null;
      return root.Capacitor.Plugins.Filesystem || null;
    } catch (e) { return null; }
  }

  /* The folder is prepared BEFORE the first photograph is written into it, and
   * the order is the point: a JPEG that lands in an unmarked folder can be
   * indexed in the seconds before the marker arrives, and once a scanner has
   * it, deleting the marker's absence does not un-index it. */
  var _folderReady = null;
  function ensureFolder(fs) {
    if (_folderReady) return _folderReady;
    _folderReady = (async function () {
      try { await fs.mkdir({ path: FOLDER, directory: 'DATA', recursive: true }); }
      catch (e) { /* already there is the usual reason */ }
      try {
        await fs.writeFile({ path: NOMEDIA, directory: 'DATA', data: '', encoding: 'utf8' });
      } catch (e) { /* a marker we could not write is not worth failing over */ }
      return true;
    })();
    return _folderReady;
  }

  function b64of(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1] || ''); };
      fr.onerror = function () { rej(fr.error || new Error('read failed')); };
      fr.readAsDataURL(blob);
    });
  }

  function idb() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('visit', 'visit_id', { unique: false });
        }
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('no local store')); };
    });
  }

  function tx(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), s = t.objectStore(STORE), out;
        try { out = fn(s); } catch (e) { rej(e); return; }
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('aborted')); };
      });
    });
  }

  function newId() {
    // Not Math.random alone: two photographs taken in the same millisecond on
    // the same phone must not collide into one record.
    var r = new Uint8Array(8);
    (root.crypto && root.crypto.getRandomValues) ? root.crypto.getRandomValues(r)
      : r.forEach(function (_, i) { r[i] = (Date.now() >> i) & 255; });
    return Date.now().toString(36) + '-' +
      Array.prototype.map.call(r, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  // ── the encoder ───────────────────────────────────────────────────────

  function toBlob(cv, q) {
    return new Promise(function (res) {
      if (cv.toBlob) { cv.toBlob(function (b) { res(b); }, 'image/jpeg', q); return; }
      // An old WebView with no toBlob still has toDataURL, and the bytes it
      // produces are the same JPEG.
      try {
        var bin = atob(cv.toDataURL('image/jpeg', q).split(',')[1]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        res(new Blob([arr], { type: 'image/jpeg' }));
      } catch (e) { res(null); }
    });
  }

  /* Medium quality first, and only step down when the size demands it.
   *
   * Size is stepped BEFORE quality is pushed low, because a 1024px picture at
   * q0.45 is easier to read a wound margin off than a 1280px one at q0.25 —
   * JPEG spends its worst artefacts exactly on the edges that matter here. */
  var LADDER = [
    { max: 1280, q: 0.60 },
    { max: 1280, q: 0.50 },
    { max: 1024, q: 0.55 },
    { max: 1024, q: 0.45 },
    { max: 900,  q: 0.45 },
    { max: 800,  q: 0.45 },
    { max: 800,  q: 0.35 },
    { max: 640,  q: 0.35 },
    { max: 512,  q: 0.30 }
  ];

  async function encode(source, sw, sh) {
    var best = null;
    for (var i = 0; i < LADDER.length; i++) {
      var step = LADDER[i];
      var scale = Math.min(1, step.max / Math.max(sw, sh));
      var w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      // White underneath: a JPEG has no transparency, and an undrawn edge on a
      // stream that ended mid-frame comes out black rather than blank.
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
      cx.drawImage(source, 0, 0, w, h);
      var blob = await toBlob(cv, step.q);
      if (!blob) continue;
      if (!best || blob.size < best.bytes) best = { blob: blob, w: w, h: h, q: step.q, bytes: blob.size };
      if (blob.size <= LIMIT) return { blob: blob, w: w, h: h, q: step.q, bytes: blob.size, under: true };
    }
    if (!best) return null;
    best.under = best.bytes <= LIMIT;
    return best;
  }

  // ── reading and writing a record ──────────────────────────────────────

  async function put(rec) {
    var fs = fsPlugin();
    if (rec.blob && fs) {
      try {
        await ensureFolder(fs);
        var path = FOLDER + '/' + rec.id + '.jpg';
        await fs.writeFile({ path: path, directory: 'DATA', data: await b64of(rec.blob) });
        rec = Object.assign({}, rec, { store: 'fs', path: path });
        delete rec.blob;
      } catch (e) {
        // The private database is a perfectly good sandbox; fall into it
        // rather than losing the photograph.
        rec = Object.assign({}, rec, { store: 'idb' });
      }
    } else if (rec.blob) {
      rec = Object.assign({}, rec, { store: 'idb' });
    }
    await tx('readwrite', function (s) { s.put(rec); });
    return rec;
  }

  function listFor(visitId) {
    return tx('readonly', function (s) { return s.index('visit').getAll(visitId); })
      .then(function (rows) {
        rows = rows || [];
        rows.sort(function (a, b) { return String(a.taken_at) < String(b.taken_at) ? 1 : -1; });
        return rows;
      })
      .catch(function () { return []; });
  }

  function countFor(visitId) {
    return listFor(visitId).then(function (r) { return r.length; });
  }

  async function bytesOf(rec) {
    if (rec.blob) return rec.blob;
    var fs = fsPlugin();
    if (rec.store === 'fs' && fs) {
      var r = await fs.readFile({ path: rec.path, directory: 'DATA' });
      var bin = atob(String(r.data || ''));
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'image/jpeg' });
    }
    return null;
  }

  async function remove(rec) {
    var fs = fsPlugin();
    if (rec.store === 'fs' && fs) {
      try { await fs.deleteFile({ path: rec.path, directory: 'DATA' }); } catch (e) {}
    }
    await tx('readwrite', function (s) { s.delete(rec.id); });
  }

  // ── the camera ────────────────────────────────────────────────────────

  function stopCamera() {
    if (_stream) {
      try { _stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      _stream = null;
    }
  }

  async function startCamera() {
    stopCamera();
    var v = document.getElementById('cpVideo');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return say('This phone will not give the app a camera. Nothing has been saved.', true);
    }
    try {
      /* `ideal`, never `exact`. A hard constraint a phone cannot meet fails
       * the whole call with OverconstrainedError and leaves a clinician
       * looking at a dead rectangle — the same trap the microphone fell into.
       * audio:false is deliberate and not a default: a clinical photograph
       * must not also record what was being said in the room. */
      _stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: _facing },
          width: { ideal: 1280 }, height: { ideal: 960 }
        }
      });
    } catch (e) {
      try {
        _stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (e2) {
        return say(camFault(e2), true);
      }
    }
    if (v) {
      v.srcObject = _stream;
      v.play().catch(function () {});
    }
    say('');
    show('live');
  }

  function camFault(e) {
    var n = String((e && e.name) || '');
    if (/NotAllowed|Security/i.test(n)) return 'The camera is blocked. Allow the camera for this app in the phone’s settings, then try again.';
    if (/NotFound|Overconstrained/i.test(n)) return 'No camera was found on this phone.';
    if (/NotReadable|Track/i.test(n)) return 'Another app is using the camera. Close it and try again.';
    return 'The camera could not be opened.';
  }

  // ── the screen ────────────────────────────────────────────────────────

  var CSS = [
    '#cpSheet{position:fixed;inset:0;z-index:1400;background:var(--surface);color:var(--text);',
      'display:none;flex-direction:column;font-family:inherit}',
    '#cpSheet.on{display:flex}',
    '.cp-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0}',
    '.cp-who{min-width:0;flex:1}',
    '.cp-who b{display:block;font-size:15px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.cp-who span{display:block;font-size:11.5px;color:var(--text-lt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.cp-x{background:var(--tint-2);color:var(--text);border:1px solid var(--border);border-radius:50%;',
      'width:34px;height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:pointer}',
    /* The viewport is black in every skin and both themes, on purpose: it is a
       camera, and a pale frame around a dark scene makes the picture hard to
       judge. The only words over it sit on their own opaque plate. */
    '.cp-view{position:relative;flex:1 1 46%;min-height:150px;background:#000;overflow:hidden;',
      'display:flex;align-items:center;justify-content:center}',
    '.cp-view video,.cp-view img{width:100%;height:100%;object-fit:contain;display:none}',
    '.cp-view.live video{display:block}',
    '.cp-view.shot img{display:block}',
    '.cp-msg{position:absolute;left:10px;right:10px;bottom:10px;background:rgba(0,0,0,.78);color:#fff;',
      'border-radius:9px;padding:8px 10px;font-size:12.5px;line-height:1.35;display:none}',
    '.cp-msg.on{display:block}',
    '.cp-msg.bad{background:rgba(150,20,20,.92)}',
    '.cp-bar{display:flex;align-items:center;justify-content:center;gap:14px;padding:9px 14px;flex-shrink:0;',
      'border-bottom:1px solid var(--border)}',
    '.cp-round{width:40px;height:40px;border-radius:50%;border:1px solid var(--border);background:var(--tint-2);',
      'color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;padding:0}',
    '.cp-shoot{width:56px;height:56px;border-radius:50%;border:3px solid var(--deep);background:var(--deep);',
      'color:var(--on-deep);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;padding:0}',
    '.cp-shoot[disabled]{opacity:.45}',
    '.cp-notes{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 14px 4px;display:flex;flex-direction:column;gap:6px}',
    '.cp-lab{font-size:12px;font-weight:700;color:var(--text-lt)}',
    '.cp-ta{width:100%;box-sizing:border-box;min-height:64px;flex:1 1 auto;resize:none;padding:9px 10px;',
      'border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);',
      'font-family:inherit;font-size:14px;line-height:1.4}',
    '.cp-strip{display:flex;gap:7px;overflow-x:auto;padding:2px 0 4px;min-height:0}',
    '.cp-thumb{width:48px;height:48px;border-radius:8px;border:1px solid var(--border);object-fit:cover;',
      'flex-shrink:0;cursor:pointer;background:var(--tint-2)}',
    '.cp-thumb.sel{border:2px solid var(--deep)}',
    '.cp-foot{flex-shrink:0;padding:8px 14px 12px;border-top:1px solid var(--border);background:var(--surface)}',
    '.cp-facts{font-size:11.5px;color:var(--text-lt);line-height:1.35;margin-bottom:7px}',
    '.cp-row{display:flex;gap:8px}',
    '.cp-save{flex:1 1 auto;min-width:0;padding:12px;background:var(--deep);color:var(--on-deep);border:none;',
      'border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;',
      'display:flex;align-items:center;justify-content:center;gap:7px}',
    '.cp-save[disabled]{opacity:.5}',
    '.cp-del{flex:0 0 auto;padding:12px 13px;background:transparent;color:var(--danger-ink);',
      'border:1.5px solid var(--danger-ink);border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;',
      'font-family:inherit;display:none;align-items:center;justify-content:center}',
    '.cp-del.on{display:flex}'
  ].join('');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function build() {
    if (_built) return;
    var st = document.createElement('style');
    st.id = 'cpStyle'; st.textContent = CSS;
    document.head.appendChild(st);

    var el = document.createElement('div');
    el.id = 'cpSheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Clinical photograph');
    el.innerHTML =
      '<div class="cp-head">'
        + '<div class="cp-who"><b id="cpWho">Patient</b><span id="cpWhat"></span></div>'
        + '<button class="cp-x" id="cpClose" aria-label="Close">'
          + '<span class="material-icons-outlined" style="font-size:19px">close</span></button>'
      + '</div>'
      + '<div class="cp-view" id="cpView">'
        + '<video id="cpVideo" playsinline muted autoplay></video>'
        + '<img id="cpShot" alt="The photograph just taken">'
        + '<div class="cp-msg" id="cpMsg"></div>'
      + '</div>'
      + '<div class="cp-bar">'
        + '<button class="cp-round" id="cpFlip" aria-label="Switch camera" title="Switch camera">'
          + '<span class="material-icons-outlined" style="font-size:19px">cameraswitch</span></button>'
        + '<button class="cp-shoot" id="cpShoot" aria-label="Take the photograph" title="Take the photograph">'
          + '<span class="material-icons-outlined" style="font-size:26px">photo_camera</span></button>'
        + '<button class="cp-round" id="cpRetake" aria-label="Take it again" title="Take it again">'
          + '<span class="material-icons-outlined" style="font-size:19px">replay</span></button>'
      + '</div>'
      + '<div class="cp-notes">'
        + '<div class="cp-strip" id="cpStrip"></div>'
        + '<label class="cp-lab" for="clinical_findings_notes">What this photograph shows</label>'
        + '<textarea id="clinical_findings_notes" name="clinical_findings_notes" class="cp-ta"'
          + ' placeholder="Where it is, how big, how long it has been there…"></textarea>'
      + '</div>'
      + '<div class="cp-foot">'
        + '<div class="cp-facts" id="cpFacts"></div>'
        + '<div class="cp-row">'
          + '<button class="cp-save" id="cpSave" disabled>'
            + '<span class="material-icons-outlined" style="font-size:18px">save</span>'
            + '<span id="cpSaveTxt">Save to this file</span></button>'
          + '<button class="cp-del" id="cpDel">Delete</button>'
        + '</div>'
      + '</div>';
    document.body.appendChild(el);

    document.getElementById('cpClose').onclick = close;
    document.getElementById('cpFlip').onclick = function () {
      _facing = _facing === 'environment' ? 'user' : 'environment';
      _shot = null; _editing = null;
      startCamera();
      refreshFoot();
    };
    document.getElementById('cpShoot').onclick = shoot;
    document.getElementById('cpRetake').onclick = function () {
      _shot = null; _editing = null;
      document.getElementById('clinical_findings_notes').value = '';
      startCamera(); refreshFoot(); paintStrip();
    };
    document.getElementById('cpSave').onclick = save;
    document.getElementById('cpDel').onclick = del;
    _built = true;
  }

  function say(msg, bad) {
    var m = document.getElementById('cpMsg');
    if (!m) return;
    m.textContent = msg || '';
    m.className = 'cp-msg' + (msg ? ' on' : '') + (bad ? ' bad' : '');
  }

  function show(mode) {
    var v = document.getElementById('cpView');
    if (v) v.className = 'cp-view' + (mode ? ' ' + mode : '');
    var sh = document.getElementById('cpShoot');
    if (sh) sh.disabled = mode !== 'live';
  }

  function setPreview(blob) {
    var img = document.getElementById('cpShot');
    if (_url) { try { URL.revokeObjectURL(_url); } catch (e) {} _url = null; }
    if (!blob) { if (img) img.removeAttribute('src'); return; }
    _url = URL.createObjectURL(blob);
    if (img) img.src = _url;
  }

  async function shoot() {
    var v = document.getElementById('cpVideo');
    if (!v || !_stream) return;
    var sw = v.videoWidth || 1280, sh = v.videoHeight || 960;
    show('shot');
    say('Squeezing it down…');
    var out = await encode(v, sw, sh);
    if (!out) { say('The photograph could not be prepared.', true); show('live'); return; }
    stopCamera();                       // the frame is taken; let go of the camera
    _shot = out; _editing = null;
    setPreview(out.blob);
    say(out.under ? '' : 'This one would not go under 50 KB and was kept at its smallest.', !out.under);
    refreshFoot();
  }

  function kb(n) { return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; }

  function refreshFoot() {
    var facts = document.getElementById('cpFacts');
    var save = document.getElementById('cpSave');
    var txt = document.getElementById('cpSaveTxt');
    var del = document.getElementById('cpDel');
    var where = fsPlugin()
      ? 'the app’s own private folder, marked so gallery apps skip it'
      : 'the app’s own private storage on this phone';
    if (_editing) {
      if (facts) facts.textContent = kb(_editing.bytes || 0) + ' · ' + (_editing.w || '?') + '×' + (_editing.h || '?')
        + ' · saved in ' + where + '. It is not in the gallery and it is not sent anywhere.';
      if (txt) txt.textContent = 'Save the note';
      if (save) save.disabled = false;
      if (del) del.className = 'cp-del' + (mayDelete() ? ' on' : '');
    } else if (_shot) {
      if (facts) facts.textContent = kb(_shot.bytes) + ' · ' + _shot.w + '×' + _shot.h
        + ' · no location or device details in the file · will be kept in ' + where + '.';
      if (txt) txt.textContent = 'Save to this file';
      if (save) save.disabled = false;
      if (del) del.className = 'cp-del';
    } else {
      if (facts) facts.textContent = 'The picture is taken inside this app. It never goes to the gallery and it is never uploaded.';
      if (txt) txt.textContent = 'Save to this file';
      if (save) save.disabled = true;
      if (del) del.className = 'cp-del';
    }
  }

  async function paintStrip() {
    var strip = document.getElementById('cpStrip');
    if (!strip || !_visit) return;
    var rows = await listFor(_visit.id);
    strip.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      (function (rec) {
        var img = document.createElement('img');
        img.className = 'cp-thumb' + (_editing && _editing.id === rec.id ? ' sel' : '');
        img.alt = 'Saved photograph';
        img.title = new Date(rec.taken_at).toLocaleString('en-UG');
        img.setAttribute('data-id', rec.id);
        bytesOf(rec).then(function (b) { if (b) img.src = URL.createObjectURL(b); }).catch(function () {});
        img.onclick = function () { openSaved(rec); };
        strip.appendChild(img);
      })(rows[i]);
    }
  }

  async function openSaved(rec) {
    stopCamera();
    var b = await bytesOf(rec).catch(function () { return null; });
    _editing = Object.assign({}, rec);
    _shot = null;
    setPreview(b);
    show('shot');
    say('');
    var ta = document.getElementById('clinical_findings_notes');
    if (ta) ta.value = rec.clinical_findings_notes || '';
    refreshFoot();
    paintStrip();
  }

  async function save() {
    var ta = document.getElementById('clinical_findings_notes');
    var notes = ta ? String(ta.value || '').trim() : '';
    var btn = document.getElementById('cpSave');
    if (btn) btn.disabled = true;
    try {
      if (_editing) {
        var upd = Object.assign({}, _editing, { clinical_findings_notes: notes });
        await tx('readwrite', function (s) { s.put(upd); });
        _editing = upd;
        say('The note is saved.');
      } else if (_shot) {
        var s = {};
        try { s = JSON.parse(localStorage.getItem('clinic_session') || '{}'); } catch (e) {}
        await put({
          id: newId(),
          visit_id: _visit.id,
          clinic_id: s.clinicId || null,
          patient_name: _visit.patient_name || '',
          taken_at: new Date().toISOString(),
          taken_by: s.staffName || '',
          bytes: _shot.bytes, w: _shot.w, h: _shot.h, quality: _shot.q,
          blob: _shot.blob,
          clinical_findings_notes: notes
        });
        _shot = null; _editing = null;
        if (ta) ta.value = '';
        setPreview(null);
        say('Saved to this patient’s file, on this phone only.');
        await startCamera();
      }
      await paintStrip();
      if (typeof _onClose === 'function') _onClose();
    } catch (e) {
      say('It could not be saved on this phone. Nothing has been changed.', true);
    }
    refreshFoot();
  }

  async function del() {
    if (!_editing || !mayDelete()) return;
    if (!confirm('Delete this photograph and its note? This cannot be undone.')) return;
    try { await remove(_editing); } catch (e) {}
    _editing = null; _shot = null;
    var ta = document.getElementById('clinical_findings_notes');
    if (ta) ta.value = '';
    setPreview(null);
    await paintStrip();
    await startCamera();
    refreshFoot();
    if (typeof _onClose === 'function') _onClose();
  }

  function open(visit, onClose) {
    if (!visit || !visit.id) return;
    if (!may()) return;
    build();
    _visit = visit; _shot = null; _editing = null; _onClose = onClose || null;
    document.getElementById('cpWho').textContent = visit.patient_name || 'Patient';
    document.getElementById('cpWhat').textContent =
      (visit.confirmed_diagnosis || 'Diagnosis pending')
      + (visit.created_at ? ' · ' + new Date(visit.created_at).toLocaleDateString('en-UG') : '');
    document.getElementById('clinical_findings_notes').value = '';
    document.getElementById('cpSheet').className = 'on';
    setPreview(null);
    show('live');
    refreshFoot();
    paintStrip();
    startCamera();
  }

  function close() {
    stopCamera();
    setPreview(null);
    var el = document.getElementById('cpSheet');
    if (el) el.className = '';
    _shot = null; _editing = null;
    if (typeof _onClose === 'function') _onClose();
  }

  // A page thrown into the background must not keep the camera lit.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopCamera();
  });

  root.HomattPhoto = {
    may: may, mayDelete: mayDelete,
    open: open, close: close,
    listFor: listFor, countFor: countFor, bytesOf: bytesOf, remove: remove,
    LIMIT: LIMIT, FOLDER: FOLDER, NOMEDIA: NOMEDIA,
    // for the measurements
    _encode: encode, _put: put, _fs: fsPlugin
  };
})(window);
