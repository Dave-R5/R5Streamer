// R5 StreamerHub desktop-app: een venster dat de live site laadt (zelfde opzet als R5 ModHub).
// Updates van de site komen dus vanzelf mee; de app zelf werkt zich bij via GitHub-releases.
const { app, BrowserWindow, WebContentsView, shell, Menu, ipcMain, session, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const START_URL = 'https://streamerhub.r5mod.nl/';
// Oud adres: stuurt door naar START_URL en geeft daarbij de instellingen mee (zie oud-adres/ in de repo).
const OLD_URL = 'https://r5streamer.daver5.nl/';
const inApp = (url) => url.startsWith(START_URL) || url.startsWith(OLD_URL);
// Na de verhuizing eerst het oude adres openen, zodat de instellingen van de app meeverhuizen.
// Pas als het nieuwe adres bereikt is, wordt dat onthouden (zie did-navigate in createWindow).
const movedMark = () => path.join(app.getPath('userData'), 'verhuisd-naar-r5mod.nl');
const firstUrl = () => (fs.existsSync(movedMark()) ? START_URL : OLD_URL);

// Updates: de app werkt zichzelf bij vanaf de openbare GitHub-releases (electron-updater),
// op dezelfde manier als PointPlay: zoeken, downloaden met voortgang en daarna in-place
// installeren. De installer draait dan stil op de plek waar de app al staat en start
// R5 StreamerHub daarna vanzelf opnieuw (geen installatiewizard).
// Bij het starten (en elke 4 uur) wordt stilletjes gezocht; downloaden doe je in
// Instellingen > Windows-app. Is een update gedownload maar niet geïnstalleerd, dan gebeurt
// dat bij het afsluiten.
const RELEASES_URL = 'https://github.com/Dave-R5/R5Streamer/releases';
const fromSite = (e) => inApp(e.senderFrame?.url || '');

let upd = app.isPackaged
  ? { status: 'idle', currentVersion: app.getVersion() }
  : { status: 'disabled', currentVersion: app.getVersion(), message: 'Updates werken alleen in de geïnstalleerde versie.' };
const setUpd = (patch) => {
  upd = { ...upd, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('r5:update-state', upd);
};
const friendly = (err) => {
  const msg = String(err?.message || err);
  if (/ENOTFOUND|ETIMEDOUT|ECONNRE|net::/i.test(msg)) return 'Geen verbinding met de updateserver. Controleer je internet.';
  if (/404|Unable to find latest version|No published versions/i.test(msg)) return 'Er zijn nog geen updates gepubliceerd.';
  return 'Update mislukt: ' + msg.split('\n')[0];
};
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => { if (upd.status !== 'downloading' && upd.status !== 'ready') setUpd({ status: 'checking', message: null }); });
autoUpdater.on('update-available', (i) => {
  if (upd.status === 'downloading' || upd.status === 'ready') return;
  setUpd({ status: 'available', version: i.version });
});
autoUpdater.on('update-not-available', () => setUpd({ status: 'latest', checkedAt: Date.now() }));
autoUpdater.on('download-progress', (p) => setUpd({ status: 'downloading', percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (i) => setUpd({ status: 'ready', version: i.version }));
autoUpdater.on('error', (err) => setUpd({ status: 'error', message: friendly(err) }));

async function checkForUpdates() {
  if (upd.status === 'disabled' || upd.status === 'downloading' || upd.status === 'ready') return upd;
  try { await autoUpdater.checkForUpdates(); } catch (err) { setUpd({ status: 'error', message: friendly(err) }); }
  return upd;
}
function downloadUpdate() {
  if (upd.status !== 'available') return upd;
  setUpd({ status: 'downloading', percent: 0 });
  autoUpdater.downloadUpdate().catch((err) => setUpd({ status: 'error', message: friendly(err) }));
  return upd;
}
function installUpdate() {
  if (upd.status !== 'ready') return upd;
  // Sluit de app, installeert de update stil op dezelfde plek en start R5 StreamerHub opnieuw.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return upd;
}

ipcMain.handle('r5:update', async (e, action) => {
  if (!fromSite(e)) return null;
  if (action === 'check') return checkForUpdates();
  if (action === 'download') return downloadUpdate();
  if (action === 'install') return installUpdate();
  return upd;
});


// Vervanging voor window.prompt(): een klein invoervenster bovenop de app.
// De site wacht (synchroon) tot je op OK of Annuleren klikt, net als bij een gewone prompt.
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
ipcMain.on('r5:prompt', (e, message, value) => {
  if (!fromSite(e) || !win) { e.returnValue = null; return; }
  let answered = false;
  const answer = (v) => { if (!answered) { answered = true; e.returnValue = v; } };
  const w = new BrowserWindow({
    width: 420, height: 190, parent: win, modal: true, resizable: false, minimizable: false, maximizable: false,
    title: 'R5 StreamerHub', autoHideMenuBar: true, backgroundColor: '#18181b', show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, javascript: true },
  });
  w.setMenu(null);
  // Het venster geeft zijn antwoord door via de titel ("__r5:" + JSON).
  w.on('page-title-updated', (ev, title) => {
    if (!title.startsWith('__r5:')) return;
    ev.preventDefault();
    answer(JSON.parse(title.slice(5)));
    w.close();
  });
  w.on('closed', () => answer(null));
  w.once('ready-to-show', () => w.show());
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8">
<title>R5 StreamerHub</title>
<style>
  body { margin: 0; padding: 18px; background: #18181b; color: #efeff1; font: 14px system-ui, sans-serif; }
  label { display: block; margin-bottom: 8px; }
  input { box-sizing: border-box; width: 100%; padding: 7px 9px; font: inherit; color: #efeff1; background: #0e0e10;
    border: 1px solid #2e2e35; border-radius: 6px; outline: none; }
  input:focus { border-color: #9147ff; }
  .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  button { font: inherit; color: #efeff1; background: #1f1f23; border: 1px solid #2e2e35; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
  button.ok { background: #9147ff; border-color: #9147ff; }
</style>
<label for="v">${esc(message)}</label>
<input id="v" value="${esc(value)}">
<div class="row"><button id="no">Annuleren</button><button class="ok" id="ok">OK</button></div>
<script>
  const v = document.getElementById('v');
  const done = (x) => { document.title = '__r5:' + JSON.stringify(x); };
  document.getElementById('ok').onclick = () => done(v.value);
  document.getElementById('no').onclick = () => done(null);
  v.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(v.value); if (e.key === 'Escape') done(null); });
  v.focus(); v.select();
</script>`));
});

// Eén login voor alles, in een klein venster van de app zelf:
// 1. eerst inloggen bij twitch.tv (alleen de eerste keer), zodat de minispeler je herkent;
// 2. daarna autoriseren. Twitch stuurt terug naar een tijdelijk adres op deze pc, en de app
//    geeft de token door aan de site (via #access_token=).
// Zelfde Twitch-app als de site (R5 StreamerHub); omleidings-URL http://localhost:17564 (precies zo, zonder /).
const DESKTOP_CLIENT_ID = 'rjm1bqkmvmfpbqwn8wxvon05v8mu3d';
const LOGIN_PORT = 17564;
const LOGIN_REDIRECT = `http://localhost:${LOGIN_PORT}`;
let login = null; // { state, servers, timer, win, onCookie }

const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>R5 StreamerHub</title>
<body style="background:#0e0e10;color:#efeff1;font-family:sans-serif;padding:40px;text-align:center">
<h2 id="t">${title}</h2><p id="m">${text}</p>`;

const CALLBACK_PAGE = page('Bezig met inloggen…', '') + `<script>
  const p = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  history.replaceState(null, '', '/');
  fetch('/token', { method: 'POST', body: p.toString() }).then((r) => r.text()).then((msg) => {
    const ok = p.has('access_token') && msg === 'ok';
    document.getElementById('t').textContent = ok ? 'Ingelogd bij R5 StreamerHub' : 'Inloggen mislukt';
    document.getElementById('m').textContent = ok ? 'Dit venster sluit vanzelf.' : msg;
  }).catch(() => { document.getElementById('t').textContent = 'De app reageert niet meer. Probeer opnieuw in te loggen.'; });
</script>`;

function stopLogin() {
  if (!login) return;
  const l = login;
  login = null;
  clearTimeout(l.timer);
  l.servers.forEach((s) => s.close());
  if (l.onCookie) session.defaultSession.cookies.removeListener('changed', l.onCookie);
  if (l.win && !l.win.isDestroyed()) l.win.close();
}

function handleLogin(req, res) {
  if (req.method === 'GET' && req.url.split('?')[0] === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(CALLBACK_PAGE);
  }
  if (req.method === 'POST' && req.url === '/token') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      const p = new URLSearchParams(body);
      const reply = (msg) => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); };
      if (!login || p.get('state') !== login.state) return reply('Deze inlogpoging is verlopen. Klik in de app opnieuw op Inloggen met Twitch.');
      if (!p.get('access_token')) { reply(p.get('error_description') || 'Je hebt geen toestemming gegeven.'); return setTimeout(stopLogin, 3000); }
      reply('ok');
      setTimeout(stopLogin, 800);
      session.defaultSession.cookies.flushStore();
      if (win) {
        // Eerst leeg laden: alleen de #-hash wijzigen zou de site niet opnieuw laten starten.
        const token = p.get('access_token');
        win.loadURL('about:blank').finally(() => win.loadURL(START_URL + '#access_token=' + encodeURIComponent(token)));
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
    return;
  }
  res.writeHead(404); res.end();
}

const hasTwitchLogin = async () =>
  (await session.defaultSession.cookies.get({ domain: 'twitch.tv', name: 'auth-token' })).length > 0;

async function startLogin(authorizeUrl) {
  stopLogin();
  const state = crypto.randomBytes(16).toString('hex');
  // Zowel IPv4 als IPv6, want "localhost" kan naar allebei wijzen. Nooit op het netwerk.
  const servers = ['127.0.0.1', '::1'].map((host) => {
    const s = http.createServer(handleLogin);
    s.on('error', () => {});
    s.listen(LOGIN_PORT, host);
    return s;
  });
  const u = new URL(authorizeUrl);
  u.searchParams.set('client_id', DESKTOP_CLIENT_ID);
  u.searchParams.set('redirect_uri', LOGIN_REDIRECT);
  u.searchParams.set('state', state);

  const w = new BrowserWindow({
    width: 500, height: 800, parent: win, title: 'Inloggen bij Twitch',
    autoHideMenuBar: true, backgroundColor: '#0e0e10',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.webContents.setUserAgent(chromeUA(w));
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  login = { state, servers, win: w, timer: setTimeout(stopLogin, 15 * 60 * 1000) };
  w.on('closed', () => { if (login && login.win === w) stopLogin(); });

  // Eerste keer: inloggen bij twitch.tv, daarna meteen door naar autoriseren.
  // Twitch stuurt na het inloggen soms gewoon naar de startpagina; daarom drie signalen:
  // het auth-token-cookie, een pagina buiten het inlogscherm, of een korte controle elke seconde.
  // Komt het venster na het autoriseren tóch weer op twitch.tv terecht (Twitch was nog niet klaar
  // met inloggen en stuurde door naar de startpagina), dan opnieuw autoriseren: maximaal 4 keer.
  let tries = 0, last = 0;
  const goAuthorize = () => {
    if (w.isDestroyed() || tries >= 4 || Date.now() - last < 1500) return;
    tries++; last = Date.now();
    if (login && login.onCookie) session.defaultSession.cookies.removeListener('changed', login.onCookie);
    if (login) login.onCookie = null;
    clearInterval(poll);
    setTimeout(() => { if (!w.isDestroyed()) w.loadURL(u.toString()); }, tries > 1 ? 800 : 0);
  };
  login.onCookie = (_e, cookie, _cause, removed) => {
    if (!removed && cookie.name === 'auth-token' && /twitch\.tv$/.test(cookie.domain)) goAuthorize();
  };
  session.defaultSession.cookies.on('changed', login.onCookie);
  const poll = setInterval(() => { if (!tries) hasTwitchLogin().then((ok) => ok && goAuthorize()).catch(() => {}); }, 1000);
  w.on('closed', () => clearInterval(poll));
  const onNav = (_e, url) => {
    let h;
    try { h = new URL(url); } catch { return; }
    if (/(^|\.)twitch\.tv$/.test(h.hostname) && h.hostname !== 'id.twitch.tv' && h.hostname !== 'passport.twitch.tv'
        && !/^\/(login|signup|passport|two_factor|verify)/.test(h.pathname)) setTimeout(goAuthorize, Math.max(300, last + 1600 - Date.now()));
  };
  w.webContents.on('did-navigate', onNav);
  w.webContents.on('did-navigate-in-page', onNav);
  if (await hasTwitchLogin()) goAuthorize();
  else w.loadURL('https://www.twitch.tv/login');
}

if (!app.requestSingleInstanceLock()) app.quit();

// Chrome-UA zonder "Electron", zodat Twitch het inlogscherm en de speler normaal toont.
// "R5StreamerHubApp" (alleen hoofdvenster) laat de site weten dat hij al als app draait.
const chromeUA = (w) => w.webContents.getUserAgent().replace(/ (r5-streamerhub|Electron)\/\S+/gi, '');

// Volledig uitloggen: de token van de site én de twitch.tv-login van de speler wissen.
async function logoutAll() {
  if (win) await win.webContents.executeJavaScript("localStorage.removeItem('r5s.token')").catch(() => {});
  const jar = session.defaultSession.cookies;
  const all = await jar.get({ domain: 'twitch.tv' });
  await Promise.all(all.map((c) => jar.remove(`https://${c.domain.replace(/^\./, '')}${c.path}`, c.name)));
  await jar.flushStore();
  if (win) win.webContents.reloadIgnoringCache();
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 360, minHeight: 400,
    title: 'R5 StreamerHub', backgroundColor: '#0e0e10', autoHideMenuBar: true,
    // backgroundThrottling uit: chat, cijfers en de kijkersgrafiek lopen door als de app achter een ander venster staat
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') },
  });
  win.webContents.setUserAgent(chromeUA(win) + ' R5StreamerHubApp');

  // Linkjes als "open op Twitch" en de hulp-links gaan naar de gewone browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (inApp(url)) return;
    e.preventDefault();
    if (url.startsWith('https://id.twitch.tv/oauth2/authorize')) startLogin(url);
    else shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="background:#0e0e10;color:#efeff1;font-family:sans-serif;padding:40px">
       <h2>Kan ${new URL(url || START_URL).host} niet laden</h2><p>${desc}. Controleer je internetverbinding.</p>
       <button onclick="location.href='${START_URL}'">Opnieuw proberen</button></body>`));
  });
  win.webContents.on('did-navigate', (_e, url, code) => {
    if (url.startsWith(START_URL)) { if (!fs.existsSync(movedMark())) try { fs.writeFileSync(movedMark(), new Date().toISOString()); } catch {} }
    else if (url.startsWith(OLD_URL) && code >= 400) win.loadURL(START_URL);
  });
  win.loadURL(firstUrl());
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'Weergave', submenu: [
    { label: 'Herladen', accelerator: 'F5', click: () => win && win.loadURL(START_URL) },
    { role: 'reload', accelerator: 'CmdOrCtrl+R' },
    { label: 'Herladen zonder cache', accelerator: 'CmdOrCtrl+F5', click: () => win && win.webContents.reloadIgnoringCache() },
    { role: 'togglefullscreen', accelerator: 'F11' },
    { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
    { role: 'toggleDevTools', accelerator: 'F12' },
  ] },
  { label: 'Account', submenu: [
    { label: 'Volledig uitloggen bij Twitch (ook de speler)', click: logoutAll },
  ] },
]));

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
// Eigen emotes: opgeslagen in de app-map en voor OBS te zien via http://127.0.0.1:17565/emotes/<bestand>
// (alleen op deze pc, alleen zolang de app draait).
const EMOTE_PORT = 17565;
const EMOTE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const emoteDir = () => path.join(app.getPath('userData'), 'emotes');
const emoteUrl = (f) => `http://127.0.0.1:${EMOTE_PORT}/emotes/${encodeURIComponent(f)}`;
function emoteList() {
  try {
    return fs.readdirSync(emoteDir()).map((f) => { const m = /^(\w{2,25})\.(png|jpe?g|gif|webp)$/i.exec(f); return m && { name: m[1], file: f, url: emoteUrl(f) }; }).filter(Boolean);
  } catch { return []; }
}
// Vaste overlay-links (bijv. overlay.html?dave_r5/alerts): de site bewaart de instellingen hier,
// de overlay in OBS haalt ze op via http://127.0.0.1:17565/o/<naam>/<soort>. Alleen op deze pc.
const overlayFile = () => path.join(app.getPath('userData'), 'overlays.json');
let overlays = null;
const loadOverlays = () => { if (!overlays) { try { overlays = JSON.parse(fs.readFileSync(overlayFile(), 'utf8')) || {}; } catch { overlays = {}; } } return overlays; };
ipcMain.handle('r5:overlay', async (e, user, kind, query) => {
  if (!fromSite(e)) return false;
  user = String(user || '').toLowerCase(); kind = String(kind || '').toLowerCase(); query = String(query || '');
  if (!/^\w{2,25}$/.test(user) || !/^\w{2,20}$/.test(kind) || query.length > 30000) return false;
  const o = loadOverlays();
  if (o[user + '/' + kind] === query) return true;
  o[user + '/' + kind] = query;
  fs.writeFileSync(overlayFile(), JSON.stringify(o));
  return true;
});
// Donaties voor de donatie-melding: de site geeft nieuwe donaties door, de overlay haalt ze op via /ev/<naam>.
// Elke donatie krijgt een oplopend nummer (n), zodat de overlay alleen nieuwe laat zien.
const donations = {}; // naam -> [{id, n, name, amount, cur, msg}]
let donN = Date.now();
ipcMain.handle('r5:donations', async (e, user, list) => {
  if (!fromSite(e)) return false;
  user = String(user || '').toLowerCase();
  if (!/^\w{2,25}$/.test(user) || !Array.isArray(list)) return false;
  const have = donations[user] || (donations[user] = []);
  list.slice(0, 50).forEach((d) => {
    if (!d || !d.id || have.some((x) => x.id === String(d.id))) return;
    have.push({ id: String(d.id), n: donN = Math.max(Date.now(), donN + 1), name: String(d.name || 'iemand').slice(0, 40), amount: +d.amount || 0, cur: String(d.cur || 'EUR').slice(0, 3), msg: String(d.msg || '').slice(0, 300) });
  });
  if (have.length > 50) have.splice(0, have.length - 50);
  return true;
});
// Opdrachten voor de overlays in OBS (📡 Test live, ▶ opnieuw afspelen); de overlays halen ze op via /cmd/<naam>.
const cmds = {}; // naam -> [{n, t, kind, type, data}]
let cmdN = Date.now();
ipcMain.handle('r5:cmd', async (e, user, cmd) => {
  if (!fromSite(e)) return false;
  user = String(user || '').toLowerCase();
  if (!/^\w{2,25}$/.test(user) || !cmd || !['test', 'replay'].includes(cmd.kind) || !/^\w{2,20}$/.test(cmd.type || '')) return false;
  const data = JSON.stringify(cmd.data || {});
  if (data.length > 4000) return false;
  const list = (cmds[user] = (cmds[user] || []).filter((c) => Date.now() - c.t < 60000));
  list.push({ n: cmdN = Math.max(Date.now(), cmdN + 1), t: Date.now(), kind: cmd.kind, type: cmd.type, data: JSON.parse(data) });
  return true;
});
function startEmoteServer() {
  const srv = http.createServer((req, res) => {
    // https-pagina (OBS) die deze pc vraagt: Chrome wil daar een extra toestemming voor (Private Network Access)
    const head = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Methods': 'GET', 'Cache-Control': 'no-store' };
    if (req.method === 'OPTIONS') { res.writeHead(204, head); return res.end(); }
    const om = /^\/o\/(\w{2,25})\/(\w{2,20})$/.exec((req.url || '').split('?')[0].toLowerCase());
    if (om) {
      const q = loadOverlays()[om[1] + '/' + om[2]];
      res.writeHead(q == null ? 404 : 200, { ...head, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(q == null ? '' : q);
    }
    const cm = /^\/cmd\/(\w{2,25})$/.exec((req.url || '').split('?')[0].toLowerCase());
    if (cm) { res.writeHead(200, { ...head, 'Content-Type': 'application/json' }); return res.end(JSON.stringify((cmds[cm[1]] || []).filter((c) => Date.now() - c.t < 60000))); }
    const em = /^\/ev\/(\w{2,25})$/.exec((req.url || '').split('?')[0].toLowerCase());
    if (em) { res.writeHead(200, { ...head, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(donations[em[1]] || [])); }
    const m = /^\/emotes\/([^/?]+)/.exec(req.url || '');
    const f = m && decodeURIComponent(m[1]), ext = f && (/\.(\w+)$/.exec(f) || [])[1];
    if (!f || !/^\w{2,25}\.(png|jpe?g|gif|webp)$/i.test(f)) { res.writeHead(404); return res.end(); }
    fs.readFile(path.join(emoteDir(), f), (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { ...head, 'Content-Type': EMOTE_TYPES[ext.toLowerCase()] });
      res.end(data);
    });
  });
  srv.on('error', () => {});
  srv.listen(EMOTE_PORT, '127.0.0.1');
}
ipcMain.handle('r5:emotes', async (e, action, name, data, ext) => {
  if (!fromSite(e)) return [];
  const dir = emoteDir();
  if (action === 'add') {
    name = String(name || ''); ext = String(ext || '').toLowerCase();
    if (!/^\w{2,25}$/.test(name) || !EMOTE_TYPES[ext]) throw new Error('Ongeldige naam of bestandstype.');
    const buf = Buffer.from(String(data || ''), 'base64');
    if (!buf.length || buf.length > 3 * 1024 * 1024) throw new Error('Het plaatje mag maximaal 3 MB zijn.');
    fs.mkdirSync(dir, { recursive: true });
    emoteList().filter((x) => x.name.toLowerCase() === name.toLowerCase()).forEach((x) => fs.rmSync(path.join(dir, x.file), { force: true }));
    fs.writeFileSync(path.join(dir, name + '.' + ext), buf);
  }
  if (action === 'remove') emoteList().filter((x) => x.name === String(name)).forEach((x) => fs.rmSync(path.join(dir, x.file), { force: true }));
  if (action === 'folder') { fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); }
  return emoteList();
});

app.whenReady().then(() => {
  startEmoteServer();
  createWindow();
  setTimeout(checkForUpdates, 10_000);
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
});
app.on('window-all-closed', () => app.quit());
