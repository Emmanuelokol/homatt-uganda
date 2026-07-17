/* Homatt Clinic — desktop app (Windows/Linux/Mac)
 *
 * Same philosophy as the Android APK: the ENTIRE portal ships inside the
 * installer and loads from local files, so the app is offline by
 * construction — no first-online-visit, no cache to lose. Supabase sync and
 * the offline outbox in the pages work exactly as they do on phones
 * (localStorage/IndexedDB persist in the app's user-data folder).
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// One window only — a second launch focuses the existing one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#0B110D',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // The clinic portal, straight from the bundled files.
  win.loadFile(path.join(__dirname, 'app', 'clinic', 'index.html'));

  // External links (WhatsApp handoffs, APK link, etc.) open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    // Keep navigation inside the bundled app; anything else goes external.
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
