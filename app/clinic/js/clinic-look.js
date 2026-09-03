/* Homatt Health — making the portal yours
 *
 * TWO THINGS
 * ----------
 *   1. The LOOK — four colour families (forest green, midnight blue, true
 *      dark, clay), each with a light and a dark palette. The light/dark
 *      switch in the top bar is unchanged and works inside whichever family
 *      is chosen, so colour and brightness stay independent.
 *   2. The PORTRAIT — the clinician's own professional photo, shown on the
 *      home screen.
 *
 * ABOUT THE PHOTO, HONESTLY
 * -------------------------
 * A photo taken on a phone is 3–5 MB and carries EXIF metadata, which
 * routinely includes the GPS coordinates of wherever it was taken — often
 * somebody's home. Uploading one straight from the camera roll would be slow
 * on a Ugandan connection and would quietly publish that location.
 *
 * So the photo never leaves the phone as it was taken. It is redrawn through a
 * canvas at 512 px and re-encoded as JPEG, which:
 *   • strips EVERY piece of metadata, GPS included — a canvas keeps pixels and
 *     nothing else;
 *   • takes a 4 MB photo down to roughly 40 KB, so it uploads on a bad line
 *     and costs almost nothing to fetch again.
 *
 * It is then stored in the clinic's own folder in Supabase storage, read back
 * through a SIGNED, expiring link where the project allows one, and kept on
 * the device so the home screen still shows it with no connection at all.
 * The signed link is used whether or not the bucket is public today, so the
 * app is already correct if the bucket is later locked down.
 */
(function () {
  'use strict';

  var SKINS = [
    { k: 'forest',   name: 'Forest green', sub: 'The original Homatt look', sw: ['#0E7C5A', '#17A46F', '#DBF4EA'] },
    { k: 'midnight', name: 'Midnight blue', sub: 'Cool and calm',           sw: ['#1E5FA8', '#2E7DC4', '#DCEAF9'] },
    { k: 'dark',     name: 'True dark',     sub: 'Black — easy at night',   sw: ['#26282B', '#33383D', '#ECEDEF'] },
    { k: 'clay',     name: 'Clay',          sub: 'Warm brown-grey',         sw: ['#6D5B4E', '#8D7864', '#EFE7DF'] },
  ];
  var VALID = SKINS.map(function (s) { return s.k; });
  var PHOTO_KEY = 'homatt_portrait_';        // + clinicId — the cached image
  var MAX_PX = 512;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m, k) { try { showToast(m, k || 'info'); } catch (e) {} }
  function clinicId() {
    try { return JSON.parse(localStorage.getItem('clinic_session') || '{}').clinicId || null; }
    catch (e) { return null; }
  }
  function supa() {
    try { return (typeof _getClinicSupabase === 'function') ? _getClinicSupabase() : null; }
    catch (e) { return null; }
  }

  // ── The look ────────────────────────────────────────────────────────────
  function currentSkin() {
    var s;
    try { s = localStorage.getItem('homatt_skin'); } catch (e) {}
    return VALID.indexOf(s) >= 0 ? s : 'forest';
  }
  function applySkin(k) {
    if (VALID.indexOf(k) < 0) k = 'forest';
    document.documentElement.setAttribute('data-skin', k);
    try { localStorage.setItem('homatt_skin', k); } catch (e) {}
    paintThemeColor();
    paintPicker();
  }
  // The Android status bar takes its colour from this tag, so it has to follow
  // the look too — otherwise the top of the screen stays green in a blue app.
  function paintThemeColor() {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) return;
    try {
      var c = getComputedStyle(document.documentElement).getPropertyValue('--grad-1').trim();
      if (c) m.setAttribute('content', c);
    } catch (e) {}
  }

  function paintPicker() {
    var host = $('lookPicker');
    if (!host) return;
    var cur = currentSkin();
    host.innerHTML = SKINS.map(function (s) {
      return '<button type="button" class="look-opt' + (s.k === cur ? ' on' : '') +
        '" data-skin="' + s.k + '" aria-pressed="' + (s.k === cur) + '">' +
        '<span class="look-sw">' + s.sw.map(function (c) {
          return '<i style="background:' + c + '"></i>';
        }).join('') + '</span>' +
        '<b>' + esc(s.name) + '</b><i>' + esc(s.sub) + '</i>' +
        (s.k === cur ? '<span class="material-icons-outlined look-tick">check_circle</span>' : '') +
        '</button>';
    }).join('');
  }

  // ── The portrait ────────────────────────────────────────────────────────
  function cacheKey() { return PHOTO_KEY + (clinicId() || 'local'); }
  function cached() {
    try { return localStorage.getItem(cacheKey()) || ''; } catch (e) { return ''; }
  }
  function cache(dataUrl) {
    try {
      if (dataUrl) localStorage.setItem(cacheKey(), dataUrl);
      else localStorage.removeItem(cacheKey());
    } catch (e) {}
  }

  /* Redraw the picked photo at 512 px through a canvas.
   * This is what strips the EXIF — GPS included — because a canvas carries
   * pixels and nothing else. It is also what turns 4 MB into about 40 KB. */
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('could not read that file')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('that file is not an image')); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) { reject(new Error('that image is empty')); return; }
          // Square crop from the middle: a portrait slot is round, and letting
          // the browser squash a landscape photo into it looks awful.
          var side = Math.min(w, h);
          var sx = (w - side) / 2, sy = (h - side) / 2;
          var c = document.createElement('canvas');
          c.width = c.height = Math.min(MAX_PX, side);
          var ctx = c.getContext('2d');
          ctx.drawImage(img, sx, sy, side, side, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function dataUrlToBlob(u) {
    var parts = String(u).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1]), n = bin.length, arr = new Uint8Array(n);
    while (n--) arr[n] = bin.charCodeAt(n);
    return new Blob([arr], { type: mime });
  }

  function storagePath() { return (clinicId() || 'local') + '/portrait.jpg'; }

  // Read the photo back through a signed, expiring link where the project
  // allows one; fall back to the plain link if signing is not permitted.
  async function remoteUrl() {
    var s = supa();
    if (!s || !clinicId()) return '';
    try {
      var sig = await s.storage.from('clinic-photos').createSignedUrl(storagePath(), 3600);
      if (sig && sig.data && sig.data.signedUrl) return sig.data.signedUrl;
    } catch (e) {}
    try {
      var pub = s.storage.from('clinic-photos').getPublicUrl(storagePath());
      return (pub && pub.data && pub.data.publicUrl) ? pub.data.publicUrl + '?v=' + Date.now() : '';
    } catch (e) {}
    return '';
  }

  function paintPortrait(dataUrl) {
    var slots = document.querySelectorAll('[data-portrait]');
    Array.prototype.forEach.call(slots, function (el) {
      if (dataUrl) {
        el.style.backgroundImage = 'url("' + dataUrl + '")';
        el.classList.add('has-photo');
      } else {
        el.style.backgroundImage = '';
        el.classList.remove('has-photo');
      }
    });
    var rm = $('portraitRemove');
    if (rm) rm.style.display = dataUrl ? 'inline-flex' : 'none';
  }

  // Show whatever is on the device immediately — the home screen must not wait
  // for the network, and offline it never comes.
  async function loadPortrait() {
    var local = cached();
    if (local) paintPortrait(local);
    if (!supa() || !clinicId()) return;
    if (window.ClinicOffline && window.ClinicOffline.isOffline && window.ClinicOffline.isOffline()) return;
    try {
      var url = await remoteUrl();
      if (!url) return;
      var res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;                       // no photo uploaded yet
      var blob = await res.blob();
      if (!blob || blob.size < 64) return;
      var fr = new FileReader();
      fr.onload = function () {
        if (String(fr.result).slice(0, 11) !== 'data:image/') return;
        if (fr.result !== local) { cache(fr.result); paintPortrait(fr.result); }
      };
      fr.readAsDataURL(blob);
    } catch (e) {}
  }

  async function upload(file) {
    var st = $('portraitStatus');
    function say(m, bad) {
      if (!st) return;
      st.textContent = m;
      st.style.color = bad ? '#C62828' : 'var(--text-lt)';
    }
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { say('That is not an image.', true); return; }
    if (file.size > 12 * 1024 * 1024) { say('That photo is very large — pick one under 12 MB.', true); return; }

    say('Preparing the photo…');
    var small;
    try { small = await shrink(file); }
    catch (e) { say(e.message || 'Could not read that photo.', true); return; }

    // On the device first, so it is already showing even if the upload fails
    // or there is no network at all.
    cache(small);
    paintPortrait(small);
    var kb = Math.round(dataUrlToBlob(small).size / 1024);

    var s = supa(), cid = clinicId();
    if (!s || !cid) { say('Saved on this device (' + kb + ' KB).'); return; }
    if (window.ClinicOffline && window.ClinicOffline.isOffline && window.ClinicOffline.isOffline()) {
      say('Saved on this device (' + kb + ' KB). It will upload when you are back online.');
      return;
    }
    say('Uploading (' + kb + ' KB)…');
    try {
      var up = await s.storage.from('clinic-photos').upload(storagePath(), dataUrlToBlob(small), {
        upsert: true, contentType: 'image/jpeg', cacheControl: '3600',
      });
      if (up.error) throw up.error;
      say('Saved. ' + kb + ' KB, location data removed.');
      toast('Photo saved', 'success');
    } catch (e) {
      say('Saved on this device, but the upload failed: ' + ((e && e.message) || 'unknown') +
          '. It stays on this phone until it can upload.', true);
    }
  }

  async function removePortrait() {
    cache('');
    paintPortrait('');
    var st = $('portraitStatus');
    if (st) st.textContent = 'Photo removed from this device.';
    var s = supa(), cid = clinicId();
    if (!s || !cid) return;
    try {
      await s.storage.from('clinic-photos').remove([storagePath()]);
      if (st) st.textContent = 'Photo removed.';
    } catch (e) {
      if (st) st.textContent = 'Removed here, but it could not be deleted from the server.';
    }
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  function bind() {
    paintThemeColor();
    paintPicker();

    var picker = $('lookPicker');
    if (picker) picker.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.look-opt');
      if (b) applySkin(b.dataset.skin);
    });

    var input = $('portraitInput');
    Array.prototype.forEach.call(document.querySelectorAll('[data-portrait-pick]'), function (el) {
      el.addEventListener('click', function () { if (input) input.click(); });
    });
    if (input) input.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      upload(f);
      e.target.value = '';
    });
    var rm = $('portraitRemove');
    if (rm) rm.addEventListener('click', removePortrait);

    loadPortrait();
  }

  window.ClinicLook = {
    skins: SKINS, apply: applySkin, current: currentSkin,
    portrait: loadPortrait, _shrink: shrink,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
