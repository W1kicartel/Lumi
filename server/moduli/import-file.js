// Gli allegati dei campi «file» e «immagine». Il valore del campo è una lista [{ id, nome, tipo, dimensione }] (vedi
// dati.js); i file veri stanno in <dati>/file/<entità>/<riga>/<id>, con l'id come nome (mai il nome dato dall'utente).
//   1. POST /api/file/carica { nome, tipo, dimensione } → { id }   si annuncia il file (limite MAX_FILE)
//   2. POST /api/file/carica/:id { da, pezzo (base64) }             i pezzi in fila, finché arrivano tutti i byte
//   3. si salva la riga con il campo che contiene { id, … }: qui un ascoltatore copia il file nella cartella della riga
//      (dentro la stessa transazione: se il file non c'è o è di un altro utente, il salvataggio si annulla)
//   4. GET /api/file/:entita/:riga/:campo/:id                       con i permessi della riga (e dei campi nascosti)
// I caricamenti servono anche all'import (import.js) e si cancellano da soli dopo un giorno.
import { mkdirSync, existsSync, copyFileSync, appendFileSync, statSync, rmSync, createReadStream, readdirSync } from 'node:fs';
import { join, dirname, resolve, sep, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { nuovoId } from '../db.js';

export const MAX_FILE = 25 * 1024 * 1024, PEZZO = 1024 * 1024, MAX_PER_UTENTE = 1024 * 1024 * 1024;
const ID_FILE = /^[0-9A-Z]{17}$/, ID_ENT = /^[a-z][a-z0-9_]{0,39}$/, ID_RIGA = /^[\w-]{1,64}$/;
const IN_LINEA = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1, 'image/avif': 1, 'application/pdf': 1 };
const PER_ESTENSIONE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.pdf': 'application/pdf',
  '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.txt': 'text/plain', '.zip': 'application/zip' };

// la cartella dei file accanto al database (per un database in memoria, nei test, una cartella temporanea)
const cartelle = new WeakMap();
export function cartellaFile(db) {
  if (!cartelle.has(db)) {
    const f = db.prepare('PRAGMA database_list').all().find(x => x.name === 'main')?.file;
    cartelle.set(db, resolve(f ? join(dirname(f), 'file') : join(tmpdir(), `kubo-file-${process.pid}-${randomBytes(4).toString('hex')}`)));
  }
  return cartelle.get(db);
}
// un percorso dentro la cartella dei file, mai fuori (niente «../»)
export function percorso(db, ...parti) {
  const base = cartellaFile(db), p = resolve(base, ...parti.map(String));
  if (!p.startsWith(base + sep)) throw new Error('Percorso non valido');
  return p;
}
export const nomeSicuro = n => String(n ?? '').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f"<>:|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 200) || 'file';
export const tipoDi = (tipo, nome) => (/^[\w.+-]+\/[\w.+-]+$/.test(String(tipo || '')) ? String(tipo).toLowerCase() : PER_ESTENSIONE[extname(nome).toLowerCase()] || 'application/octet-stream');
export const intestazioneNome = (nome, modo = 'attachment') => `${modo}; filename="${nome.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nome)}`;

// ---------- caricamenti a pezzi ----------
export function caricamento(db, id, ctx) {
  const c = ID_FILE.test(String(id)) && db.prepare('SELECT * FROM _import_caricamenti WHERE id = ?').get(String(id));
  if (!c || (ctx && c.utente !== ctx.utente.id)) return null;
  return { ...c, completo: c.ricevuti >= c.dimensione, percorso: percorso(db, '_tmp', c.id) };
}
function pulisci(db) {
  const prima = new Date(Date.now() - 864e5).toISOString();
  for (const c of db.prepare('SELECT id FROM _import_caricamenti WHERE creato < ?').all(prima)) { try { rmSync(percorso(db, '_tmp', c.id), { force: true }); } catch {} }
  db.prepare('DELETE FROM _import_caricamenti WHERE creato < ?').run(prima);
}

export default function registra({ r, db, S, D, serve, ErroreHttp }) {
  db.exec(`CREATE TABLE IF NOT EXISTS _import_caricamenti (id TEXT PRIMARY KEY, utente TEXT NOT NULL, nome TEXT NOT NULL, tipo TEXT NOT NULL,
    dimensione INTEGER NOT NULL, ricevuti INTEGER NOT NULL DEFAULT 0, creato TEXT NOT NULL)`);
  pulisci(db); setInterval(() => { try { pulisci(db); } catch {} }, 36e5).unref();

  r('POST', '/api/file/carica', ({ ctx, corpo }) => {
    serve(ctx);
    const dimensione = Math.floor(Number(corpo.dimensione)), nome = nomeSicuro(corpo.nome), max = Number(corpo.max) === 50 ? 50 * 1024 * 1024 : MAX_FILE;
    if (!Number.isFinite(dimensione) || dimensione <= 0) throw new ErroreHttp(400, 'Il file è vuoto');
    if (dimensione > max) throw new ErroreHttp(413, `Il file è troppo grande: al massimo ${Math.round(max / 1048576)} MB`);
    const usati = db.prepare('SELECT COALESCE(SUM(dimensione), 0) n FROM _import_caricamenti WHERE utente = ?').get(ctx.utente.id).n;
    if (usati + dimensione > MAX_PER_UTENTE) throw new ErroreHttp(413, 'Troppi file caricati nelle ultime ore: riprova più tardi');
    const id = nuovoId();
    mkdirSync(percorso(db, '_tmp'), { recursive: true });
    db.prepare('INSERT INTO _import_caricamenti (id, utente, nome, tipo, dimensione, ricevuti, creato) VALUES (?, ?, ?, ?, ?, 0, ?)').run(id, ctx.utente.id, nome, tipoDi(corpo.tipo, nome), dimensione, new Date().toISOString());
    return { id, pezzo: PEZZO };
  });
  r('POST', '/api/file/carica/:id', ({ ctx, p, corpo }) => {
    const c = caricamento(db, p.id, serve(ctx)); if (!c) throw new ErroreHttp(404, 'Caricamento sconosciuto');
    const b = Buffer.from(String(corpo.pezzo || ''), 'base64');
    if (Number(corpo.da) !== c.ricevuti) throw new ErroreHttp(409, 'Pezzo fuori ordine', { ricevuti: c.ricevuti });
    if (!b.length || c.ricevuti + b.length > c.dimensione) throw new ErroreHttp(400, 'Pezzo non valido');
    appendFileSync(c.percorso, b);
    db.prepare('UPDATE _import_caricamenti SET ricevuti = ricevuti + ? WHERE id = ?').run(b.length, c.id);
    const ricevuti = c.ricevuti + b.length, completo = ricevuti >= c.dimensione;
    return { ricevuti, completo, file: completo ? { id: c.id, nome: c.nome, tipo: c.tipo, dimensione: c.dimensione } : undefined };
  });

  // salvando una riga: i file nuovi del campo passano dai caricamenti alla cartella della riga
  D.ascolta((ev, dbEv, ctx) => {
    if (dbEv !== db || !['crea', 'modifica', 'ripristina'].includes(ev.tipo) || !ev.dopo) return;
    const def = S.leggi(db, ev.entita); if (!def) return;
    for (const c of S.campiAttivi(def).filter(c => ['file', 'immagine'].includes(c.tipo))) {
      for (const x of Array.isArray(ev.dopo[c.id]) ? ev.dopo[c.id] : []) {
        const dest = percorso(db, ev.entita, ev.id, x.id); if (existsSync(dest)) continue;
        const k = caricamento(db, x.id, ctx);
        if (!k?.completo || !existsSync(k.percorso)) { if (!ctx) continue; const m = `«${c.nome}»: il file «${x.nome}» non è arrivato, caricalo di nuovo`; throw new D.ErroreDati(m, { [c.id]: m }); }
        if (k.dimensione > MAX_FILE) { const m = `«${c.nome}»: «${x.nome}» supera ${MAX_FILE / 1048576} MB`; throw new D.ErroreDati(m, { [c.id]: m }); }
        if (c.tipo === 'immagine' && !k.tipo.startsWith('image/')) { const m = `«${c.nome}»: «${x.nome}» non è un'immagine`; throw new D.ErroreDati(m, { [c.id]: m }); }
        mkdirSync(dirname(dest), { recursive: true }); copyFileSync(k.percorso, dest);
      }
    }
  });

  r('GET', '/api/file/:e/:id/:campo/:f', ({ ctx, p, q, res }) => {
    serve(ctx);
    if (!ID_ENT.test(p.e) || !ID_RIGA.test(p.id) || !ID_FILE.test(p.f)) throw new ErroreHttp(404, 'File non trovato');
    const riga = D.leggi(db, p.e, p.id, ctx, { conRighe: false });   // permessi della riga, «solo i propri», campi nascosti
    const x = (Array.isArray(riga[p.campo]) ? riga[p.campo] : []).find(x => x?.id === p.f);
    const f = x && percorso(db, p.e, p.id, p.f);
    if (!f || !existsSync(f)) throw new ErroreHttp(404, 'File non trovato');
    const nome = nomeSicuro(x.nome), tipo = tipoDi(x.tipo, nome), inLinea = IN_LINEA[tipo] && q.get('scarica') !== '1';
    res.writeHead(200, { 'Content-Type': inLinea ? tipo : 'application/octet-stream', 'Content-Length': statSync(f).size, 'Content-Disposition': intestazioneNome(nome, inLinea ? 'inline' : 'attachment'),
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", 'Cache-Control': 'private, max-age=3600' });
    createReadStream(f).pipe(res);
  });
}

// quanto pesano i file (per il backup)
export function fileDaSalvare(db) {
  const base = cartellaFile(db), out = [];
  const giro = (d, rel) => { let l = []; try { l = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of l) { if (rel === '' && x.name === '_tmp') continue; const p = join(d, x.name); if (x.isDirectory()) giro(p, rel + x.name + '/'); else if (x.isFile()) out.push({ percorso: p, nome: 'file/' + rel + x.name, dimensione: statSync(p).size }); } };
  giro(base, ''); return out;
}
