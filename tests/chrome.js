/* Where is Chromium?
 *
 * Playwright's own browser download is 130 MB and these tests are often run on
 * a machine that already has one (a CI image, a dev container). So look for a
 * browser rather than insisting on a particular copy of it, and say plainly
 * what to do when there is none — a test suite that fails with
 * "ENOENT: /opt/pw-browsers/..." teaches nobody anything.
 *
 * Override with HOMATT_CHROME=/path/to/chrome.
 */
const fs = require('fs');
const path = require('path');

function first(paths) {
  for (const p of paths) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return null;
}

// Playwright installs into a versioned directory (chromium-1194, chromium-1201…),
// so glob the parent rather than pinning a build number that will move.
function inPlaywrightDir(dir) {
  let kids;
  try { kids = fs.readdirSync(dir); } catch (e) { return null; }
  const found = [];
  kids.filter((k) => /^chromium(_headless_shell)?-/.test(k)).forEach((k) => {
    found.push(path.join(dir, k, 'chrome-linux', 'chrome'));
    found.push(path.join(dir, k, 'chrome-linux', 'headless_shell'));
    found.push(path.join(dir, k, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
  });
  return first(found);
}

function find() {
  const home = process.env.HOME || '';
  const hit =
    first([process.env.HOMATT_CHROME].filter(Boolean)) ||
    inPlaywrightDir(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers') ||
    inPlaywrightDir(path.join(home, '.cache', 'ms-playwright')) ||
    inPlaywrightDir(path.join(home, 'Library', 'Caches', 'ms-playwright')) ||
    first([
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
  if (hit) return hit;
  throw new Error(
    'No Chromium found. Either install one (npx playwright install chromium) ' +
    'or point HOMATT_CHROME at a Chrome/Chromium binary.');
}

module.exports = { find };
