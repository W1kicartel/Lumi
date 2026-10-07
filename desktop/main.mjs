// Kubo sul desktop (Electron). Al primo avvio si sceglie una delle due strade:
//  • «Questo PC tiene i dati»: Kubo si accende qui dentro (gli stessi file di server/), con i dati nella cartella utente
//    dell'app (Mac ~/Library/Application Support/Kubo/dati, Windows %APPDATA%\Kubo\dati, Linux ~/.config/Kubo/dati).
//    Gli altri PC e i telefoni si collegano dall'indirizzo in rete o dal QR («Collega dispositivi»). Chiudendo la finestra
//    Kubo resta acceso nel vassoio (o nella barra dei menu del Mac), così gli altri continuano a lavorare.
//  • «Collegati a un Kubo in rete»: la finestra apre il Kubo di un altro PC, dal suo indirizzo o dal suo codice.
// La scelta sta in <cartella utente>/kubo-desktop.json. Opzioni: --nascosto (avvio con il sistema: niente finestra),
// --prova (accende il server in una cartella temporanea senza finestre, controlla che risponda, stampa ed esce).
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } from 'electron';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accendi } from './kubo.mjs';
import { disegna } from './icona.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = app.isPackaged ? join(process.resourcesPath, 'kubo') : join(QUI, '..');   // server/, web/, modelli/
const MAC = process.platform === 'darwin', PROVA = process.argv.includes('--prova');
const opzione = nome => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : null; };
// --cartella-utente <dir>: impostazioni e dati altrove (installazioni portatili, prove); --foto <prefisso>: per le prove,
// fotografa la prima scelta, sceglie «Questo PC tiene i dati», fotografa il gestionale ed esce
if (opzione('--cartella-utente')) app.setPath('userData', opzione('--cartella-utente'));
const FOTO = opzione('--foto');
const { indirizzoDa } = await import(pathToFileURL(join(RADICE, 'server', 'moduli', 'desktop-rete.js')).href);

// ---------- impostazioni ----------
const FILE_CONF = () => join(app.getPath('userData'), 'kubo-desktop.json');
function leggiConf() { try { return JSON.parse(readFileSync(FILE_CONF(), 'utf8')); } catch { return null; } }
function scriviConf(c) { writeFileSync(FILE_CONF(), JSON.stringify(c, null, 2)); conf = c; }
let conf = null, kubo = null, finestra = null, scelta = null, vassoio = null, uscendo = false;

// ---------- modalità di prova: niente finestre ----------
if (PROVA) {
  app.whenReady().then(async () => {
    const cartella = mkdtempSync(join(tmpdir(), 'kubo-prova-'));
    try {
      const k = await accendi({ radice: RADICE, cartella, porta: 0, rete: false });
      const s = await (await fetch(k.url + 'api/stato')).json();
      console.log(`PROVA OK: Kubo ${s.versione} risponde su ${k.url} (Electron ${process.versions.electron}, Node ${process.versions.node})`);
      await k.chiudi(); rmSync(cartella, { recursive: true, force: true }); app.exit(0);
    } catch (e) { console.error('PROVA FALLITA:', e); app.exit(1); }
  });
} else avvia();

function avvia() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => mostra());
  app.whenReady().then(async () => {
    conf = leggiConf();
    if (!conf?.modo) return chiediModo();
    await parti();
  });
  app.on('activate', () => mostra());   // Mac: clic sull'icona nel Dock
  app.on('window-all-closed', () => { if (conf?.modo !== 'server' && !MAC) app.quit(); });
  app.on('before-quit', () => { uscendo = true; });
  // all'uscita il server si spegne pulito (il database chiude il WAL); se qualcosa resta appeso, si esce lo stesso dopo 4 s
  app.on('will-quit', ev => { if (!kubo) return; ev.preventDefault(); const k = kubo; kubo = null;
    Promise.race([k.chiudi(), new Promise(r => setTimeout(r, 4000))]).finally(() => app.exit(0)); });
  // dopo un ripristino dal gestionale (server/moduli/desktop.js) la finestra si ricarica
  process.on('kubo:ripristinato', () => finestra?.webContents.reload());
}

// ---------- la prima scelta ----------
function chiediModo() {
  if (scelta) return scelta.focus();
  scelta = new BrowserWindow({ width: 760, height: 560, resizable: false, title: 'Kubo', backgroundColor: '#fafafa', show: false,
    webPreferences: { preload: join(QUI, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, additionalArguments: ['--kubo-pagina=scelta'] } });
  proteggi(scelta, () => false);
  scelta.once('ready-to-show', () => { if (!FOTO) scelta.show(); });
  if (FOTO) scelta.webContents.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 400)); writeFileSync(FOTO + '-scelta.png', (await scelta.webContents.capturePage()).toPNG());
    scelta.webContents.executeJavaScript("document.getElementById('server').click()");
  });
  scelta.on('closed', () => { scelta = null; if (!conf?.modo) app.quit(); });
  scelta.loadFile(join(QUI, 'scelta.html'));
}
ipcMain.handle('kubo:scegli', async (e, richiesta) => {
  if (!scelta || e.sender !== scelta.webContents) return { errore: 'Non permesso' };
  const { modo, indirizzo } = richiesta || {};
  if (modo === 'server') { scriviConf({ modo: 'server', rete: true, porta: 4380 }); }
  else if (modo === 'cliente') {
    let url; try { url = indirizzoDa(indirizzo); } catch (err) { return { errore: err.message }; }
    try {
      const s = await (await fetch(url + '/api/stato', { signal: AbortSignal.timeout(5000) })).json();
      if (!s || typeof s.versione !== 'string') throw new Error();
    } catch { return { errore: `Non trovo Kubo a ${url}. Controlla che l'altro computer sia acceso, con Kubo aperto, e sulla stessa rete.` }; }
    scriviConf({ modo: 'cliente', indirizzo: url });
  } else return { errore: 'Scelta sconosciuta' };
  await parti(); scelta?.close();
  return { ok: true };
});

async function parti() {
  if (conf.modo === 'server') {
    try { kubo = await accendi({ radice: RADICE, cartella: join(app.getPath('userData'), 'dati'), porta: conf.porta || 4380, rete: conf.rete !== false }); }
    catch (e) { dialog.showErrorBox('Kubo non riesce ad accendersi', String(e.message || e)); app.quit(); return; }
  }
  creaVassoio();
  const nascosto = process.argv.includes('--nascosto') || (MAC && app.getLoginItemSettings().wasOpenedAtLogin);
  creaFinestra(!nascosto || conf.modo !== 'server');
}
const indirizzo = () => (conf.modo === 'server' ? kubo.url : conf.indirizzo + '/');
const origine = () => new URL(indirizzo()).origin;

// ---------- sicurezza delle finestre: solo la pagina di Kubo dentro, il resto nel browser (solo https e mail) ----------
async function apriFuori(url) { let u; try { u = new URL(url); } catch { return; } if (['https:', 'mailto:'].includes(u.protocol)) await shell.openExternal(u.href); }
function proteggi(w, permesso = url => { try { return new URL(url).origin === origine(); } catch { return false; } }) {
  w.webContents.setWindowOpenHandler(({ url }) => { if (permesso(url)) return { action: 'allow' }; apriFuori(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!permesso(url)) { e.preventDefault(); apriFuori(url); } });
  w.webContents.on('will-attach-webview', e => e.preventDefault());
  w.webContents.session.setPermissionRequestHandler((_wc, permesso, ok) => ok(['clipboard-sanitized-write', 'notifications', 'media'].includes(permesso)));
}

function creaFinestra(mostrala = true) {
  finestra = new BrowserWindow({ width: 1280, height: 820, minWidth: 380, minHeight: 500, title: 'Kubo', show: false, backgroundColor: '#fafafa',
    webPreferences: { preload: join(QUI, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, additionalArguments: ['--kubo-pagina=gestionale'] } });
  proteggi(finestra);
  if (mostrala && !FOTO) finestra.once('ready-to-show', () => finestra.show());
  if (FOTO) finestra.webContents.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 1500)); writeFileSync(FOTO + '-finestra.png', (await finestra.webContents.capturePage()).toPNG());
    console.log('FOTO OK', finestra.webContents.getURL()); uscendo = true; app.quit();
  });
  // modo server: chiudere la finestra non spegne Kubo (gli altri dispositivi lavorano ancora); si esce dal menu
  finestra.on('close', e => { if (conf.modo === 'server' && !uscendo) { e.preventDefault(); finestra.hide(); avvisaUnaVolta(); } });
  finestra.on('closed', () => { finestra = null; });
  finestra.webContents.on('did-fail-load', (_e, codice, _d, url) => { if (codice !== -3 && conf.modo === 'cliente') mostraNonRaggiungibile(url); });
  finestra.loadURL(indirizzo());
}
function mostra(hash) {
  if (!conf?.modo) return chiediModo();
  if (!finestra) creaFinestra();
  if (hash) finestra.loadURL(indirizzo() + hash);
  finestra.show(); finestra.focus();
}
function avvisaUnaVolta() {
  if (conf.avvisato) return; scriviConf({ ...conf, avvisato: true });
  vassoio?.displayBalloon?.({ title: 'Kubo resta acceso', content: 'Gli altri dispositivi possono continuare a lavorare. Per spegnerlo: menu di Kubo → Esci.' });
}
async function mostraNonRaggiungibile(url) {
  const r = await dialog.showMessageBox({ type: 'warning', buttons: ['Riprova', 'Cambia indirizzo', 'Esci'], defaultId: 0, cancelId: 2, title: 'Kubo',
    message: 'Non riesco a raggiungere il Kubo dell\'ufficio', detail: `${url}\n\nControlla che il computer con i dati sia acceso, con Kubo aperto, e che questo dispositivo sia sulla stessa rete.` });
  if (r.response === 0) finestra?.loadURL(indirizzo());
  else if (r.response === 1) cambiaModo();
  else app.quit();
}

// il gestionale chiede una cartella per i backup: la finestra del sistema, solo dalla pagina di Kubo
ipcMain.handle('kubo:scegli-cartella', async e => {
  if (!finestra || e.sender !== finestra.webContents || new URL(e.senderFrame?.url || 'about:blank').origin !== origine()) return null;
  const r = await dialog.showOpenDialog(finestra, { title: 'Dove salvare i backup di Kubo', buttonLabel: 'Usa questa cartella', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- vassoio / barra dei menu ----------
function iconaVassoio() {
  const lato = MAC ? 32 : 32, px = disegna(lato, { sfondo: !MAC });
  for (let i = 0; i < px.length; i += 4) [px[i], px[i + 2]] = [px[i + 2], px[i]];   // RGBA → BGRA
  const img = nativeImage.createFromBitmap(px, { width: lato, height: lato, scaleFactor: 2 });
  if (MAC) img.setTemplateImage(true);
  return img;
}
function creaVassoio() {
  if (!vassoio) { vassoio = new Tray(iconaVassoio()); vassoio.on('click', () => { if (!MAC) mostra(); }); }
  vassoio.setToolTip(conf.modo === 'server' ? `Kubo è acceso${kubo?.rete ? ' per la rete dell\'ufficio' : ''}` : `Kubo · ${conf.indirizzo}`);
  const server = conf.modo === 'server';
  vassoio.setContextMenu(Menu.buildFromTemplate([
    { label: 'Apri Kubo', click: () => mostra() },
    server ? { label: 'Collega altri dispositivi…', click: () => mostra('#/rete') } : null,
    server ? { label: 'Backup…', click: () => mostra('#/backup') } : null,
    { type: 'separator' },
    server ? { label: 'Aperto alla rete locale', type: 'checkbox', checked: conf.rete !== false, click: m => cambiaRete(m.checked) } : null,
    { label: 'Avvia con il computer', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: m => app.setLoginItemSettings({ openAtLogin: m.checked, openAsHidden: true, args: ['--nascosto'] }) },
    server ? { label: 'Apri la cartella dei dati', click: () => shell.openPath(join(app.getPath('userData'), 'dati')) } : null,
    { label: server ? 'Usa invece un Kubo in rete…' : 'Cambia indirizzo o modo…', click: () => cambiaModo() },
    { type: 'separator' },
    { label: server ? 'Esci (spegne Kubo per tutti)' : 'Esci', click: () => { uscendo = true; app.quit(); } },
  ].filter(Boolean)));
}
async function cambiaRete(rete) {
  scriviConf({ ...conf, rete });
  const vecchio = kubo; kubo = null; await vecchio?.chiudi();
  kubo = await accendi({ radice: RADICE, cartella: join(app.getPath('userData'), 'dati'), porta: conf.porta || 4380, rete });
  creaVassoio(); finestra?.loadURL(indirizzo() + '#/rete');
}
async function cambiaModo() {
  if (conf?.modo === 'server') {
    const r = await dialog.showMessageBox({ type: 'question', buttons: ['Annulla', 'Continua'], defaultId: 0, cancelId: 0, title: 'Kubo', message: 'Usare un Kubo in rete invece di questo?',
      detail: 'Kubo su questo computer si spegne, ma i dati restano qui: puoi tornare indietro quando vuoi scegliendo di nuovo «Questo PC tiene i dati».' });
    if (r.response !== 1) return;
  }
  const vecchio = kubo; kubo = null; await vecchio?.chiudi();
  uscendo = true; finestra?.destroy(); finestra = null; uscendo = false;
  scriviConf({ ...(conf || {}), modo: null }); chiediModo();
}
