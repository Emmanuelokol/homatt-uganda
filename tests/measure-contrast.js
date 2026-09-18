// Can every word in the app actually be read, in every colour it ships in?
//
// Four skins × two themes = eight combinations, and a colour written as a
// literal instead of a token is readable in the one the author was looking at
// and invisible in the other seven. Eyes cannot check eight combinations of
// every screen; a number can.
//
// This measures the real WCAG contrast ratio of every visible piece of text
// against its REAL background — composited through however many translucent
// layers sit between it and the first opaque one, because a dark-mode input is
// a 6% white wash over a dark card and reading that wash as opaque white
// reports a perfectly readable box as 1.16:1.
//
//   node measure-contrast.js            every screen, all eight combinations
//   node measure-contrast.js new-order  just the screens whose name matches
//
// Threshold is WCAG AA: 4.5:1 for body text, 3:1 for large text (>=24px, or
// >=18.66px when bold), which is the same standard the rest of the app is
// held to.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.db':'application/octet-stream'};
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const PORT = 8939, ORIGIN = 'http://localhost:' + PORT;

const SKINS = ['forest', 'midnight', 'dark', 'clay'];
const THEMES = ['light', 'dark'];
const PAGES = ['index.html', 'dashboard.html', 'new-order.html', 'messages.html',
               'settings.html', 'guidelines.html'];
const pick = process.argv.slice(2);
const pages = PAGES.filter(p => !pick.length || pick.some(q => p.includes(q)));

// Reveal what a clinician reaches by tapping. A panel that is display:none on
// load is still a screen people read, and a colour fault inside it is exactly
// the kind that survives review.
const REVEAL = {
  'new-order.html': () => {
    document.querySelectorAll('.wiz-step, .wiz-pane, [data-step]').forEach(function (el) {
      if (getComputedStyle(el).display === 'none') el.style.display = 'block';
    });
    ['itPane1','itPane2','itPane3','itCheck','payPartWrap'].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.style.display = 'block';
    });
  },
  'settings.html': () => {
    document.querySelectorAll('.set-body, .set-pane, details').forEach(function (el) {
      if (el.tagName === 'DETAILS') el.open = true;
      else if (getComputedStyle(el).display === 'none') el.style.display = 'block';
    });
  },
};

const MEASURE = () => {
  function parse(c) {
    var m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function over(fg, bg) {           // alpha-composite fg onto bg
    var a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a),
             b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function rel(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function ratio(a, b) {
    var l1 = rel(a), l2 = rel(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  // The real background: walk up compositing every translucent layer until an
  // opaque one is reached. Taking the element's own rgba at face value is how
  // a readable box gets reported as 1.16:1 — and how a real fault hides behind
  // a passing number.
  function bgOf(el) {
    var stack = [], node = el, gradient = false;
    while (node && node.nodeType === 1) {
      var cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') gradient = true;
      var c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
      node = node.parentElement;
    }
    var base = { r: 255, g: 255, b: 255, a: 1 };
    var last = stack[stack.length - 1];
    if (last && last.a >= 0.999) { base = last; stack.pop(); }
    for (var i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return { bg: base, gradient: gradient };
  }
  function ownText(el) {
    var t = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].nodeValue;
    }
    return t.trim();
  }
  function pathOf(el) {
    var bits = [];
    for (var n = el; n && n.nodeType === 1 && bits.length < 3; n = n.parentElement) {
      bits.unshift(n.tagName.toLowerCase() +
        (n.id ? '#' + n.id : '') +
        (n.className && typeof n.className === 'string' && n.className.trim()
          ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    }
    return bits.join('>');
  }

  var out = [], seen = {}, checked = 0;
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var text = ownText(el);
    if (!text || text.length < 2) continue;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (parseFloat(cs.opacity) < 0.25) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    var fg = parse(cs.color);
    if (!fg) continue;
    var b = bgOf(el);
    if (b.gradient) continue;                 // a photo or gradient behind it
    if (fg.a < 1) fg = over(fg, b.bg);
    var size = parseFloat(cs.fontSize) || 14;
    var weight = parseInt(cs.fontWeight, 10) || 400;
    var large = size >= 24 || (size >= 18.66 && weight >= 700);
    var need = large ? 3 : 4.5;
    var got = ratio(fg, b.bg);
    checked++;
    if (got >= need) continue;
    var key = pathOf(el) + '|' + cs.color + '|' + Math.round(got * 10);
    if (seen[key]) continue;
    seen[key] = 1;
    out.push({ where: pathOf(el), text: text.slice(0, 40).replace(/\s+/g, ' '),
               fg: cs.color, ratio: Math.round(got * 100) / 100, need: need,
               size: size, weight: weight });
  }
  return { checked: checked, bad: out };
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1400 } })).newPage();
  page.on('pageerror', () => {});
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
    return r.abort();
  });
  await page.goto(ORIGIN + '/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);

  const worst = new Map();
  let totalChecked = 0, combos = 0;

  for (const p of pages) {
    for (const skin of SKINS) {
      for (const theme of THEMES) {
        await page.evaluate(([s,t]) => {
          localStorage.setItem('homatt_skin', s);
          localStorage.setItem('homatt_theme', t);
        }, [skin, theme]);
        await page.goto(ORIGIN + '/clinic/' + p, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.evaluate(([s,t]) => {
          document.documentElement.setAttribute('data-skin', s);
          document.documentElement.setAttribute('data-theme', t);
        }, [skin, theme]);
        if (REVEAL[p]) { try { await page.evaluate(REVEAL[p]); } catch (e) {} }
        await page.waitForTimeout(350);
        const res = await page.evaluate(MEASURE);
        totalChecked += res.checked; combos++;
        res.bad.forEach(x => {
          const key = p + ' :: ' + x.where + ' :: ' + x.text;
          const prev = worst.get(key);
          if (!prev || x.ratio < prev.ratio) {
            worst.set(key, Object.assign({}, x, { page: p, skin: skin, theme: theme }));
          }
        });
      }
    }
  }

  const rows = [...worst.values()].sort((a, b) => a.ratio - b.ratio);
  console.log('can every word be read, in all eight colour combinations?\n');
  console.log('  screens        : ' + pages.length + ' (' + combos + ' skin/theme passes)');
  console.log('  text measured  : ' + totalChecked + ' elements');
  console.log('  unreadable     : ' + rows.length + '\n');
  if (!rows.length) { console.log('  nothing below the WCAG AA threshold.'); }
  rows.slice(0, 60).forEach(x => {
    console.log('  ' + String(x.ratio).padStart(5) + ':1  (needs ' + x.need + ')  ' +
      x.page + '  [' + x.skin + '/' + x.theme + ']');
    console.log('           ' + x.where);
    console.log('           "' + x.text + '"   colour ' + x.fg);
  });
  if (rows.length > 60) console.log('\n  …and ' + (rows.length - 60) + ' more');
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
