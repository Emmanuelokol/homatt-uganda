// The home-screen widget, checked the only way it can be checked from here.
//
// THIS MACHINE HAS NO ANDROID SDK, so no APK is built and nothing below
// proves the widget renders on a phone. What it does prove is the class of
// fault that makes a widget fail SILENTLY, which is worth more than it sounds:
// a RemoteViews that references a resource which does not exist inflates to
// nothing, on every phone, with no error a clinic could report. So every
// `@drawable/…`, `@string/…`, `@layout/…`, `@color/…`, `@mipmap/…` and
// `@id/…` the widget mentions is resolved against the files that are actually
// in the tree.
//
// It also checks the two things that are wrong in most hand-written widgets
// and cannot be seen by reading one file at a time:
//
//   • a layout class RemoteViews cannot inflate (ConstraintLayout being the
//     one everybody reaches for);
//   • three PendingIntents built with the same request code, which the system
//     treats as ONE — so every button opens whichever was created last. That
//     reads as a routing bug and is not one.
//
// The APK build itself is verified by .github/workflows/build-android-apk.yml.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
const RES = path.join(ROOT, 'res');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  — ' + got)); }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }
function exists(p) { return fs.existsSync(p); }

// ── The files that have to be there at all ───────────────────────────────
const FILES = {
  layout:   path.join(RES, 'layout', 'widget_homatt.xml'),
  info:     path.join(RES, 'xml', 'widget_homatt_info.xml'),
  shortcuts:path.join(RES, 'xml', 'shortcuts.xml'),
  provider: path.join(ROOT, 'java', 'ug', 'homatt', 'health', 'HomattWidgetProvider.java'),
  manifest: path.join(ROOT, 'AndroidManifest.xml'),
};
Object.keys(FILES).forEach((k) => ok('the ' + k + ' file exists', exists(FILES[k]), FILES[k]));
if (Object.keys(FILES).some((k) => !exists(FILES[k]))) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

const layout = read(FILES.layout);
const info = read(FILES.info);
const shortcuts = read(FILES.shortcuts);
const provider = read(FILES.provider);
const manifest = read(FILES.manifest);

// ── 1. EVERY RESOURCE REFERENCE RESOLVES ─────────────────────────────────
//
// A `@drawable/widget_bg` with no widget_bg.xml is a build failure at best
// and a blank widget at worst. Resolved against the tree, per resource kind,
// including the qualified folders (values-night and the density mipmaps) that
// a naive check would miss.
function resourceExists(kind, name) {
  if (kind === 'id') return true;        // ids are declared by @+id in layouts
  if (kind === 'string' || kind === 'color' || kind === 'style' || kind === 'dimen') {
    // Declared inside a values/*.xml file, in any qualified values folder.
    const dirs = fs.readdirSync(RES).filter((d) => d === 'values' || d.indexOf('values-') === 0);
    const tag = kind === 'dimen' ? 'dimen' : kind;
    for (const d of dirs) {
      const dir = path.join(RES, d);
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.xml')) continue;
        const body = read(path.join(dir, f));
        const re = new RegExp('<' + tag + '\\s[^>]*name\\s*=\\s*"' + name + '"');
        if (re.test(body)) return true;
      }
    }
    return false;
  }
  // A file resource: drawable/, layout/, xml/, mipmap/, in any qualifier.
  const dirs = fs.readdirSync(RES).filter((d) => d === kind || d.indexOf(kind + '-') === 0);
  for (const d of dirs) {
    const dir = path.join(RES, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const base = f.replace(/\.(xml|png|jpg|webp|9\.png)$/i, '');
      if (base === name) return true;
    }
  }
  return false;
}

const missing = [];
const seen = new Set();
[['widget layout', layout], ['widget info', info], ['shortcuts', shortcuts]].forEach(([where, body]) => {
  const re = /@(drawable|layout|xml|mipmap|string|color|style|dimen|id)\/([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = where + '|' + m[1] + '/' + m[2];
    if (seen.has(key)) continue;
    seen.add(key);
    if (!resourceExists(m[1], m[2])) missing.push(where + ' → @' + m[1] + '/' + m[2]);
  }
});
ok('every resource the widget references actually exists',
  missing.length === 0, missing.join(', '));
ok('...and there were references to check', seen.size >= 15, seen.size + ' references');

/* THE CONTROL. "Nothing is missing" is also what this reports if the resolver
 * says yes to everything. A name that is definitely not in the tree must come
 * back false, for every kind. */
ok('CONTROL: the resolver says NO to something that does not exist',
  !resourceExists('drawable', 'no_such_drawable_xyz') &&
  !resourceExists('string', 'no_such_string_xyz') &&
  !resourceExists('color', 'no_such_colour_xyz') &&
  !resourceExists('layout', 'no_such_layout_xyz'));
ok('...and YES to things that do', resourceExists('drawable', 'widget_bg') &&
  resourceExists('string', 'widget_title') && resourceExists('color', 'widgetInk') &&
  resourceExists('mipmap', 'ic_launcher'));

// ── 2. RemoteViews can actually inflate this ─────────────────────────────
//
// It runs in the LAUNCHER's process and supports a fixed list of view classes.
// Anything else inflates to nothing, on every phone, with no error.
const ALLOWED = ['LinearLayout', 'RelativeLayout', 'FrameLayout', 'GridLayout',
  'TextView', 'ImageView', 'Button', 'ImageButton', 'ProgressBar', 'Chronometer',
  'AnalogClock', 'ViewFlipper', 'ListView', 'GridView', 'StackView', 'AdapterViewFlipper',
  'ViewStub', 'View', 'Space'];
const used = [...layout.matchAll(/<\s*([A-Za-z][A-Za-z0-9_.]*)/g)]
  .map((m) => m[1]).filter((t) => t !== 'xml' && !t.startsWith('!'));
const banned = [...new Set(used)].filter((t) => ALLOWED.indexOf(t) < 0);
ok('every view in the layout is one RemoteViews can inflate',
  banned.length === 0, banned.join(', '));
/* The TAGS, not the text. The first version of this read
 * `/ConstraintLayout/.test(layout)` and failed on the layout's own comment
 * explaining why ConstraintLayout is not used — a string test matching the
 * explanation of the thing rather than the thing, which is the second time
 * that exact shape has caught me this week. */
ok('...ConstraintLayout in particular is not among the tags',
  used.every((t) => t.indexOf('ConstraintLayout') < 0), used.join(','));

// ── 3. The three buttons must be three separate taps ─────────────────────
//
// PendingIntents that differ only in their extras are EQUAL to the system, so
// three built with one request code collapse into one and every tap opens
// whichever was created last. The classic widget bug; it reads as routing.
const codes = [...provider.matchAll(/RC_[A-Z]+\s*=\s*(\d+)/g)].map((m) => m[1]);
ok('every button has its own PendingIntent request code',
  codes.length >= 4 && new Set(codes).size === codes.length,
  codes.join(','));

// FLAG_IMMUTABLE is API 23 and this app's minSdk is 22 — it has to be added
// conditionally, or the app crashes on Android 12 or fails to compile.
ok('FLAG_IMMUTABLE is set, because Android 12 requires it',
  /FLAG_IMMUTABLE/.test(provider));
ok('...and only from API 23, because minSdk is 22',
  /SDK_INT\s*>=\s*Build\.VERSION_CODES\.M/.test(provider), 'no version guard');
const minSdk = (read(path.join(__dirname, '..', 'android', 'variables.gradle'))
  .match(/minSdkVersion\s*=\s*(\d+)/) || [])[1];
ok('...and minSdk really is below 23, so that guard is not theatre',
  Number(minSdk) < 23, 'minSdk ' + minSdk);

// ── 4. The manifest declares it ──────────────────────────────────────────
ok('the widget receiver is declared',
  /<receiver[\s\S]*?HomattWidgetProvider[\s\S]*?<\/receiver>/.test(manifest));
ok('...listening for APPWIDGET_UPDATE',
  /HomattWidgetProvider[\s\S]*?android\.appwidget\.action\.APPWIDGET_UPDATE/.test(manifest));
ok('...and pointing at its provider info',
  /HomattWidgetProvider[\s\S]*?@xml\/widget_homatt_info/.test(manifest));
ok('the long-press shortcuts are declared on the launcher activity',
  /android\.app\.shortcuts[\s\S]*?@xml\/shortcuts/.test(manifest));

// The deep link the whole thing rides on. It was already there — and nothing
// listened for it, which is the fault this round started from.
ok('the manifest still declares the homatt:// deep link',
  /android:scheme="homatt"[\s\S]*?android:host="app"/.test(manifest));
ok('MainActivity is singleTask, so a tap reaches the RUNNING app',
  /android:launchMode="singleTask"/.test(manifest));

// ── 5. The two halves agree on the target names ──────────────────────────
//
// The widget, the shortcuts and the web router each name the same three
// targets. If they drift, a button opens the app and does nothing — which is
// indistinguishable from the widget being broken.
const web = read(path.join(__dirname, '..', 'app', 'clinic', 'js', 'clinic-open.js'));
['new-treatment', 'active', 'quick-sale'].forEach((t) => {
  ok('"' + t + '" is named by the widget provider', provider.indexOf('"' + t + '"') >= 0);
  ok('...by the shortcuts', shortcuts.indexOf('homatt://app/' + t) >= 0);
  ok('...and understood by the web router', web.indexOf("'" + t + "'") >= 0);
});

// ── 6. The provider info is the shape a launcher will accept ─────────────
ok('the widget declares its old-style minimum size',
  /android:minWidth="\d+dp"/.test(info) && /android:minHeight="\d+dp"/.test(info));
ok('...and its API 31 cell size, or a modern launcher picks one nobody chose',
  /android:targetCellWidth="\d+"/.test(info) && /android:targetCellHeight="\d+"/.test(info));
ok('it does not poll for updates it has no use for',
  /android:updatePeriodMillis="0"/.test(info));
ok('it has an initial layout to show before anything runs',
  /android:initialLayout="@layout\/widget_homatt"/.test(info));
ok('and it is a home-screen widget, resizable',
  /android:widgetCategory="home_screen"/.test(info) && /android:resizeMode=/.test(info));

// ── 7. Every XML parses ──────────────────────────────────────────────────
// A stray ampersand in a label is a build failure with a line number nobody
// reads; catching it here is cheaper.
const { execFileSync } = require('child_process');
let parsed = [];
[FILES.layout, FILES.info, FILES.shortcuts, FILES.manifest,
 path.join(RES, 'values', 'strings.xml'), path.join(RES, 'values', 'colors.xml'),
 path.join(RES, 'values-night', 'colors.xml'),
 path.join(RES, 'drawable', 'widget_bg.xml'),
 path.join(RES, 'drawable', 'widget_btn.xml'),
 path.join(RES, 'drawable', 'widget_btn_primary.xml')].forEach((f) => {
  try {
    execFileSync('python3', ['-c', 'import sys,xml.dom.minidom as m; m.parse(sys.argv[1])', f],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    parsed.push(path.basename(f));
  } catch (e) { fail++; console.log('FAIL  ' + path.basename(f) + ' does not parse'); }
});
ok('every widget XML file parses', parsed.length === 10, parsed.length + ' of 10');

// ── 8. Light and dark are defined as PAIRS ───────────────────────────────
//
// The rule this project has been caught by four times: a fill and the text on
// it must be defined together, for every theme. A widget sits on somebody's
// wallpaper, so it carries its own surface — and if values-night redefines the
// surface without the ink, the labels vanish on half the phones in the country.
const lightColours = read(path.join(RES, 'values', 'colors.xml'));
const nightColours = read(path.join(RES, 'values-night', 'colors.xml'));
const names = (body) => new Set([...body.matchAll(/<color\s+name="(widget[A-Za-z]+)"/g)].map((m) => m[1]));
const L = names(lightColours), N = names(nightColours);
const onlyLight = [...L].filter((x) => !N.has(x));
const onlyNight = [...N].filter((x) => !L.has(x));
ok('every widget colour defined for light is also defined for dark',
  onlyLight.length === 0, onlyLight.join(','));
ok('...and the other way round, so neither theme has an orphan',
  onlyNight.length === 0, onlyNight.join(','));
ok('...and there are colours to compare', L.size >= 8, L.size + ' colours');

// And they are readable. A widget's ink is stated, not inherited, so it can be
// measured straight from the file rather than from a rendered page.
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function colourOf(body, name) {
  const m = body.match(new RegExp('<color\\s+name="' + name + '">(#[0-9A-Fa-f]{6})<'));
  return m ? m[1] : null;
}
[['light', lightColours], ['dark', nightColours]].forEach(([which, body]) => {
  const pairs = [
    ['widgetInk', 'widgetSurface', 'the title on the card'],
    ['widgetInk', 'widgetBtn', 'a button label'],
    ['widgetOnPrimary', 'widgetPrimary', 'the main button'],
    ['widgetInkSoft', 'widgetSurface', 'the small line'],
  ];
  pairs.forEach(([ink, fill, what]) => {
    const a = colourOf(body, ink), bg = colourOf(body, fill);
    if (!a || !bg) { fail++; console.log('FAIL  ' + which + ': ' + ink + '/' + fill + ' missing'); return; }
    const r = Math.round(ratio(a, bg) * 100) / 100;
    ok(which + ': ' + what + ' is readable (' + r + ':1)', r >= 4.5, r + ':1');
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
