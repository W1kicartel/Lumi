// App desktop, rete, backup e aggiornamenti (lato server). La logica sta in desktop-backup.js, desktop-rete.js,
// desktop-qr.js e desktop-aggiorna.js; qui le rotte e gli orari.
//   GET  /api/desktop/rete                 gli indirizzi in rete, con il codice da dettare e il QR (chi ha l'accesso)
//   GET  /api/backup                       cartella, elenco, ultimo errore                       (solo il titolare, da qui in giù)
//   POST /api/backup                       un backup adesso
//   PUT  /api/backup/cartella { cartella } una cartella esterna ('' = quella accanto ai dati)
//   GET  /api/backup/file/:nome            scarica un backup
//   POST /api/backup/ripristina { nome, conferma: true }
//   POST /api/backup/carica { nome, dimensione } → { id } · POST /api/backup/carica/:id { da, pezzo }   carica un backup da fuori
//   GET/PUT /api/aggiornamenti { attivo } · POST /api/aggiornamenti/controlla
// Ogni giorno un backup «giornaliero» con la rotazione; prima di cambiare lo schema o di un import, un backup «modifica».
// KUBO_BACKUP=0 spegne i backup automatici (per chi li fa già con altri strumenti).
import { createReadStream, mkdirSync, appendFileSync, rmSync, renameSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as B from './desktop-backup.js';
import { indirizziLocali, codiceDa } from './desktop-rete.js';
import { codiceQR } from './desktop-qr.js';
import { controlla, VERSIONE } from './desktop-aggiorna.js';

const MAX_CARICATO = 4 * 1024 ** 3, PEZZO = 2 * 1024 * 1024, PAUSA_MODIFICA = 2 * 6e4;

export default function registra({ r, prima, db, P, meta, serve, ErroreHttp, manda }) {
  const titolare = ctx => { serve(ctx); if (ctx.r.id !== 'titolare' || ctx.viaToken) throw new P.ErrorePermesso('Solo il titolare gestisce backup e aggiornamenti'); return ctx; };
  const cartella = () => B.cartellaBackup(db, meta);
  let ultimaModifica = 0, ripristinando = false;
  const caricamenti = new Map();   // id → { utente, percorso, dimensione, ricevuti, nome }

  // un backup con la rotazione; se la cartella esterna non risponde (disco staccato) si salva accanto ai dati e si avvisa
  function fai(tipo) {
    const c = cartella();
    try { const b = B.copia(db, c, tipo); B.ruota(c); meta.scrivi(db, 'backup.errore', ''); meta.scrivi(db, 'backup.ultimo', b.quando); return b; }
    catch (e) {
      const def = B.cartellaPredefinita(db);
      meta.scrivi(db, 'backup.errore', JSON.stringify({ quando: new Date().toISOString(), testo: `Il backup in «${c}» non è riuscito (${e.code || e.message}).${c !== def ? ' Intanto è stato salvato accanto ai dati.' : ''}` }));
      if (c === def) throw e;
      const b = B.copia(db, def, tipo); B.ruota(def); return b;
    }
  }
  function quotidiano() {
    if (!B.fileDb(db) || ripristinando) return;
    const oggi = B.nomePer(new Date(), 'x').slice(5, 15);
    if (process.env.KUBO_BACKUP !== '0' && !B.elenco(cartella()).some(b => b.tipo === 'giornaliero' && b.nome.slice(5, 15) === oggi)) {
      try { fai('giornaliero'); } catch (e) { console.error('backup:', e.message); }
    }
    if (meta.leggi(db, 'aggiornamenti.attivo') === '1' && Date.now() - Date.parse(meta.leggi(db, 'aggiornamenti.controllato') || 0) > 864e5) cercaVersioni().catch(() => {});
  }
  setTimeout(() => { try { quotidiano(); } catch {} }, 20e3).unref();
  setInterval(() => { try { quotidiano(); } catch {} }, 30 * 6e4).unref();

  // prima di una modifica allo schema, di un modello nuovo o di un import: una copia (al massimo una ogni due minuti,
  // perché in «Personalizza» ogni campo salvato è una richiesta)
  const primaDi = ({ ctx }) => {
    if (!ctx || !B.fileDb(db) || ripristinando || Date.now() - ultimaModifica < PAUSA_MODIFICA) return;
    ultimaModifica = Date.now();
    try { fai('modifica'); } catch (e) { console.error('backup prima della modifica:', e.message); }
  };
  if (prima) for (const [m, p] of [['PUT', '/api/schema/:id'], ['DELETE', '/api/schema/:id'], ['POST', '/api/modelli/:id'], ['POST', '/api/import/esegui']]) prima(m, p, primaDi);

  // ---------- rete ----------
  r('GET', '/api/desktop/rete', ({ ctx, req }) => {
    serve(ctx);
    const porta = req.socket.localPort, ascolta = req.socket.server?.address?.()?.address, inRete = ascolta === '0.0.0.0' || ascolta === '::';
    const voce = (url, codice) => ({ url, codice, qr: codiceQR(url).righe });
    const out = inRete ? indirizziLocali().map(ip => voce(`http://${ip}:${porta}/`, codiceDa(ip, porta))) : [];
    // dietro un proxy (Docker + Caddy) l'indirizzo giusto è quello con cui si è arrivati
    const host = String(req.headers.host || ''), proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    if (/^[\w.-]+(:\d+)?$/.test(host) && !/^(localhost|127\.0\.0\.1)(:|$)/.test(host) && !out.some(x => x.url === `${proto}://${host}/`)) out.unshift(voce(`${proto}://${host}/`, null));
    return { inRete, porta, indirizzi: out };
  });

  // ---------- backup ----------
  const stato = () => ({ cartella: cartella(), predefinita: B.cartellaPredefinita(db), esterna: !!meta.leggi(db, 'backup.cartella'), automatici: process.env.KUBO_BACKUP !== '0',
    elenco: B.elenco(cartella()), errore: JSON.parse(meta.leggi(db, 'backup.errore') || 'null'), limiti: B.TIENI, inMemoria: !B.fileDb(db) });
  const daNome = nome => { if (!B.NOME.test(String(nome))) throw new ErroreHttp(404, 'Backup sconosciuto'); const f = join(cartella(), String(nome)); try { statSync(f); } catch { throw new ErroreHttp(404, 'Backup sconosciuto'); } return f; };
  const occupato = () => { if (ripristinando) throw new ErroreHttp(409, 'C\'è un ripristino in corso'); };

  r('GET', '/api/backup', ({ ctx }) => { titolare(ctx); return stato(); });
  r('POST', '/api/backup', ({ ctx }) => { titolare(ctx); occupato(); if (!B.fileDb(db)) throw new ErroreHttp(400, 'Il database è in memoria'); return { backup: fai('manuale'), ...stato() }; });
  r('PUT', '/api/backup/cartella', ({ ctx, corpo }) => {
    titolare(ctx); occupato();
    let c; try { c = B.validaCartella(db, corpo.cartella); } catch (e) { throw new ErroreHttp(400, e.message); }
    meta.scrivi(db, 'backup.cartella', c === B.cartellaPredefinita(db) ? '' : c);
    if (B.fileDb(db)) fai('manuale');   // la prima copia nella cartella nuova, subito
    return stato();
  });
  r('GET', '/api/backup/file/:nome', ({ ctx, p, res }) => {
    titolare(ctx); const f = daNome(p.nome);
    res.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Length': statSync(f).size, 'Content-Disposition': `attachment; filename="${p.nome}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    createReadStream(f).on('error', () => res.destroy()).pipe(res);
  });
  r('POST', '/api/backup/ripristina', async ({ ctx, corpo, token }) => {
    titolare(ctx); occupato();
    if (corpo.conferma !== true) throw new ErroreHttp(400, 'Serve la conferma');
    const f = daNome(corpo.nome); ripristinando = true;
    try {
      const esito = await B.ripristina(db, f, { cartella: cartella(), token });
      meta.scrivi(db, 'backup.ultimo_ripristino', JSON.stringify({ quando: new Date().toISOString(), da: corpo.nome, sicurezza: esito.sicurezza }));
      manda({ tipo: 'ripristinato', da: ctx.utente.id });
      process.emit('kubo:ripristinato', { nome: corpo.nome, ...esito });   // l'app desktop ricarica le finestre
      return esito;
    } catch (e) { throw e instanceof ErroreHttp ? e : new ErroreHttp(400, e.message); }
    finally { ripristinando = false; }
  });
  r('POST', '/api/backup/carica', ({ ctx, corpo }) => {
    titolare(ctx); occupato();
    const dimensione = Math.floor(Number(corpo.dimensione));
    if (!Number.isFinite(dimensione) || dimensione < 512) throw new ErroreHttp(400, 'Il file è vuoto o troppo piccolo per essere un backup');
    if (dimensione > MAX_CARICATO) throw new ErroreHttp(413, 'Il file è troppo grande');
    for (const [k, c] of caricamenti) if (c.utente === ctx.utente.id) { rmSync(c.percorso, { force: true }); caricamenti.delete(k); }
    const id = randomBytes(12).toString('hex'), c = cartella();
    caricamenti.set(id, { utente: ctx.utente.id, percorso: join(c, `.caricamento-${id}.tmp`), cartella: c, dimensione, ricevuti: 0 });
    try { mkdirSync(c, { recursive: true }); appendFileSync(caricamenti.get(id).percorso, Buffer.alloc(0)); } catch { caricamenti.delete(id); throw new ErroreHttp(500, 'Non riesco a scrivere nella cartella dei backup'); }
    return { id, pezzo: PEZZO };
  });
  r('POST', '/api/backup/carica/:id', ({ ctx, p, corpo }) => {
    titolare(ctx); const c = caricamenti.get(p.id);
    if (!c || c.utente !== ctx.utente.id) throw new ErroreHttp(404, 'Caricamento sconosciuto');
    if (Number(corpo.da) !== c.ricevuti) throw new ErroreHttp(409, 'Pezzo fuori ordine', { ricevuti: c.ricevuti });
    const b = Buffer.from(String(corpo.pezzo || ''), 'base64');
    if (!b.length || b.length > PEZZO || c.ricevuti + b.length > c.dimensione) throw new ErroreHttp(400, 'Pezzo non valido');
    appendFileSync(c.percorso, b); c.ricevuti += b.length;
    if (c.ricevuti < c.dimensione) return { ricevuti: c.ricevuti, completo: false };
    caricamenti.delete(p.id);
    try {
      const h = Buffer.alloc(16), fd = openSync(c.percorso, 'r'); readSync(fd, h, 0, 16, 0); closeSync(fd);
      if (h.toString('latin1') !== 'SQLite format 3\0') throw new Error('Il file non è un backup di Kubo (serve un file .db)');
      const info = B.verifica(c.percorso, { versioneMax: db.prepare('PRAGMA user_version').get().user_version });
      const nome = B.nomePer(new Date(), 'caricato'); renameSync(c.percorso, join(c.cartella, nome)); B.ruota(c.cartella);
      return { ricevuti: c.ricevuti, completo: true, nome, info };
    } catch (e) { rmSync(c.percorso, { force: true }); throw new ErroreHttp(400, e.message); }
  });

  // ---------- aggiornamenti ----------
  async function cercaVersioni() {
    meta.scrivi(db, 'aggiornamenti.controllato', new Date().toISOString());
    try { const x = await controlla(); meta.scrivi(db, 'aggiornamenti.esito', JSON.stringify({ ...x, errore: null })); if (x.nuova) manda({ tipo: 'versione', versione: x.ultima.versione }); return x; }
    catch (e) { const x = { attuale: VERSIONE, errore: 'Non riesco a controllare adesso: ' + (e.name === 'TimeoutError' ? 'nessuna risposta' : e.message) }; meta.scrivi(db, 'aggiornamenti.esito', JSON.stringify(x)); return x; }
  }
  const statoVersioni = () => ({ versione: VERSIONE, attivo: meta.leggi(db, 'aggiornamenti.attivo') === '1', controllato: meta.leggi(db, 'aggiornamenti.controllato'),
    esito: JSON.parse(meta.leggi(db, 'aggiornamenti.esito') || 'null') });
  r('GET', '/api/aggiornamenti', ({ ctx }) => { serve(ctx); return ctx.r.id === 'titolare' ? statoVersioni() : { versione: VERSIONE }; });
  r('PUT', '/api/aggiornamenti', async ({ ctx, corpo }) => {
    titolare(ctx); meta.scrivi(db, 'aggiornamenti.attivo', corpo.attivo ? '1' : '0');
    if (corpo.attivo) await cercaVersioni();
    return statoVersioni();
  });
  r('POST', '/api/aggiornamenti/controlla', async ({ ctx }) => { titolare(ctx); await cercaVersioni(); return statoVersioni(); });
}
