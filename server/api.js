// Il server HTTP: API JSON + i file dell'interfaccia (web/) + eventi in tempo reale (SSE), senza dipendenze.
// Sicurezza: sessione in un cookie HttpOnly SameSite=Strict, e ogni richiesta che modifica deve avere l'intestazione
// «X-Kubo: 1» (una pagina di un altro sito non può aggiungerla). In alternativa «Authorization: Bearer <token>».
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './schema.js';
import * as D from './dati.js';
import * as P from './permessi.js';
import * as A from './automazioni.js';
import * as M from './modelli.js';
import * as U from './auth.js';
import { meta } from './db.js';
import { readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// I moduli (server/moduli/*.js): ognuno esporta di default registra(k) e aggiunge le sue rotte e i suoi ascoltatori.
// k = { r, db, S, D, P, A, M, U, meta, serve, ErroreHttp, manda }. Si caricano in ordine alfabetico. Una rotta riceve anche
// «res»: se risponde da sé (un file da scaricare), il server non aggiunge il JSON.
const CARTELLA_MODULI = join(dirname(fileURLToPath(import.meta.url)), 'moduli');
const MODULI_SERVER = await Promise.all(readdirSync(CARTELLA_MODULI).filter(f => f.endsWith('.js')).sort()
  .map(f => import(join(CARTELLA_MODULI, f)).then(m => ({ nome: f.replace(/\.js$/, ''), registra: m.default }))));
export const moduliWeb = () => readdirSync(join(WEB, 'moduli')).filter(f => f.endsWith('.js')).sort().map(f => `/moduli/${f}`);

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const VERSIONE = '0.1.0';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// l'indirizzo di chi chiama: dietro un proxy fidato (KUBO_PROXY=1, es. Caddy) quello di X-Forwarded-For
const indirizzo = req => (process.env.KUBO_PROXY === '1' && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress);
const locale = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

class ErroreHttp extends Error { constructor(stato, m, extra = {}) { super(m); this.stato = stato; this.extra = extra; } }

export function creaServer(db) {
  // codice di avvio: finché non c'è un titolare, chi si collega da un altro computer deve conoscerlo
  const codiceAvvio = randomBytes(4).toString('hex').toUpperCase();
  if (U.quanti(db) === 0 && process.env.NODE_ENV !== 'test') console.log(`Primo avvio da un altro computer: codice ${codiceAvvio}`);
  const primoAvvio = (ip, codice) => { if (!locale(ip) && String(codice || '').trim().toUpperCase() !== codiceAvvio) throw new ErroreHttp(403, 'Serve il codice di avvio: lo trovi nel terminale o nel log di Kubo'); };
  const clienti = new Set();   // connessioni SSE: { res, ctx }
  const manda = (ev) => { for (const c of clienti) if (!ev.entita || P.puo(c.ctx, ev.entita, 'leggi')) c.res.write(`data: ${JSON.stringify(ev)}\n\n`); };
  D.ascolta((ev, _db, ctx) => { if (!ev.interno) manda({ tipo: ev.tipo, entita: ev.entita, id: ev.id, da: ctx?.utente?.id ?? null }); });
  A.suAvviso(a => manda({ tipo: 'avviso', ...a }));
  const tentativi = new Map();   // ip → [orari] degli accessi falliti

  function ctxDi(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('kubo='))?.slice(5);
    return { token, ctx: U.contesto(db, token) };
  }
  const serve = ctx => { if (!ctx) throw new ErroreHttp(401, 'Accedi per continuare'); return ctx; };
  const cookie = (token, durata = 30 * 86400) => `kubo=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${durata}`;

  // schema visto da un utente: niente entità che non può leggere, niente campi nascosti
  function schemaPer(ctx) {
    return S.elenco(db).filter(e => P.puo(ctx, e.id, 'leggi')).map(e => ({
      ...e, campi: e.campi.filter(c => !c.archiviato && P.statoCampo(ctx, e.id, c.id) !== 'nascosto').map(c => ({ ...c, sola_lettura: P.statoCampo(ctx, e.id, c.id) === 'lettura' || undefined })),
      puo: { crea: P.puo(ctx, e.id, 'crea'), modifica: P.puo(ctx, e.id, 'modifica'), elimina: P.puo(ctx, e.id, 'elimina') },
    }));
  }

  const rotte = [];
  const r = (metodo, percorso, f) => rotte.push({ metodo, re: new RegExp('^' + percorso.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), f });
  // «prima»: un modulo può agire prima di una rotta di un altro (es. il backup prima di cambiare lo schema o di un import)
  const ganci = [], prima = (metodo, percorso, f) => ganci.push({ metodo, re: new RegExp('^' + percorso.replace(/:(\w+)/g, '[^/]+') + '$'), f });

  r('GET', '/api/stato', ({ ctx, ip }) => ({ versione: VERSIONE, configurato: U.quanti(db) > 0, serveCodice: U.quanti(db) === 0 && !locale(ip), azienda: meta.leggi(db, 'azienda'), utente: ctx?.utente ?? null,
    poteri: ctx ? { schema: P.puoSchema(ctx), utenti: P.puoUtenti(ctx) } : null, modelli: JSON.parse(meta.leggi(db, 'modelli') || '[]') }));
  r('GET', '/api/modelli', () => M.elenco());
  r('POST', '/api/configura', ({ corpo, risposta, ip }) => {
    if (U.quanti(db) > 0) throw new ErroreHttp(409, 'Già configurato');
    // il primo avvio (chi lo fa diventa titolare): da questo computer, oppure da fuori con il codice stampato nel log (Docker, VPS)
    primoAvvio(ip, corpo.codice);
    const { azienda, nome, email, password, modelli = [] } = corpo;
    if (!azienda) throw new ErroreHttp(400, 'Manca il nome dell\'azienda');
    U.creaUtente(db, { nome, email, password, ruolo: 'titolare' });
    meta.scrivi(db, 'azienda', String(azienda));
    for (const m of modelli) M.installa(db, m);
    const s = U.accedi(db, { email, password });
    risposta.intestazioni['Set-Cookie'] = cookie(s.token);
    return { utente: s.utente };
  });
  r('POST', '/api/accedi', ({ corpo, risposta, ip, req }) => {
    const ora = Date.now(), l = (tentativi.get(ip) || []).filter(t => ora - t < 5 * 6e4);
    if (l.length >= 10) throw new ErroreHttp(429, 'Troppi tentativi: riprova fra qualche minuto');
    try { const s = corpo.pin != null ? U.accediPin(db, corpo, req.headers['user-agent']) : U.accedi(db, corpo, req.headers['user-agent']); tentativi.delete(ip); risposta.intestazioni['Set-Cookie'] = cookie(s.token); return { utente: s.utente }; }
    catch (e) { l.push(ora); tentativi.set(ip, l); throw e; }
  });
  r('GET', '/api/banco', () => db.prepare('SELECT id, nome FROM _utenti WHERE attivo = 1 AND pin IS NOT NULL ORDER BY nome').all());
  r('POST', '/api/esci', ({ token, risposta }) => { U.esci(db, token); risposta.intestazioni['Set-Cookie'] = cookie('', 0); return { ok: true }; });

  r('GET', '/api/schema', ({ ctx }) => schemaPer(serve(ctx)));
  r('PUT', '/api/schema/:id', ({ ctx, p, corpo }) => {
    if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso('Non puoi personalizzare il gestionale');
    if (corpo.id !== p.id) throw new ErroreHttp(400, 'id diverso');
    // chi non vede un campo (nascosto al suo ruolo) non può archiviarlo senza saperlo: i campi nascosti tornano com'erano
    const prima = S.leggi(db, p.id), def = { ...corpo, campi: [...(corpo.campi || [])] };
    for (const c of prima?.campi || []) if (P.statoCampo(ctx, p.id, c.id) === 'nascosto' && !def.campi.some(x => x.id === c.id)) def.campi.push(c);
    delete def.__forza; delete def.puo;
    return S.applica(db, def, { utente: ctx.utente.id, forza: !!corpo.__forza });
  });
  r('DELETE', '/api/schema/:id', ({ ctx, p }) => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso(); S.archiviaEntita(db, p.id, { utente: ctx.utente.id }); return { ok: true }; });
  r('POST', '/api/modelli/:id', ({ ctx, p }) => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso(); return M.installa(db, p.id, { utente: ctx.utente.id }); });

  r('GET', '/api/dati/:e', ({ ctx, p, q }) => D.elenca(db, p.e, {
    cerca: q.get('q') || '', filtri: q.get('f') ? JSON.parse(q.get('f')) : [], pagina: q.get('p'), perPagina: q.get('n'), archiviati: q.get('arch') === '1',
    ordina: (q.get('o') || '').split(',').filter(Boolean).map(x => { const [campo, dir] = x.split(':'); return { campo, dir }; }),
  }, serve(ctx)));
  r('POST', '/api/dati/:e', ({ ctx, p, corpo }) => D.crea(db, p.e, corpo, serve(ctx)));
  r('GET', '/api/dati/:e/:id', ({ ctx, p }) => D.leggi(db, p.e, p.id, serve(ctx)));
  r('PATCH', '/api/dati/:e/:id', ({ ctx, p, corpo }) => D.modifica(db, p.e, p.id, corpo, serve(ctx)));
  r('DELETE', '/api/dati/:e/:id', ({ ctx, p }) => ({ ok: D.elimina(db, p.e, p.id, serve(ctx)) }));
  r('POST', '/api/dati/:e/:id/ripristina', ({ ctx, p }) => D.ripristina(db, p.e, p.id, serve(ctx)));
  r('GET', '/api/dati/:e/:id/storia', ({ ctx, p }) => D.storia(db, p.e, p.id, serve(ctx)));

  r('GET', '/api/automazioni', ({ ctx }) => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso(); return A.elenco(db); });
  r('PUT', '/api/automazioni/:id', ({ ctx, p, corpo }) => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso(); return A.salva(db, { ...corpo, id: p.id }, { utente: ctx.utente.id }); });
  r('DELETE', '/api/automazioni/:id', ({ ctx, p }) => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso(); A.elimina(db, p.id); return { ok: true }; });

  r('GET', '/api/utenti', ({ ctx }) => { if (!P.puoUtenti(serve(ctx))) throw new P.ErrorePermesso(); return U.utenti(db); });
  r('POST', '/api/utenti', ({ ctx, corpo }) => { if (!P.puoUtenti(serve(ctx))) throw new P.ErrorePermesso(); if (corpo.ruolo === 'titolare' && ctx.r.id !== 'titolare') throw new P.ErrorePermesso(); return U.creaUtente(db, corpo, { utente: ctx.utente.id }); });
  r('PATCH', '/api/utenti/:id', ({ ctx, p, corpo }) => {
    serve(ctx); const se = p.id === ctx.utente.id;
    if (ctx.viaToken && (corpo.password != null || corpo.pin != null)) throw new P.ErrorePermesso('Con un token non si cambiano password e PIN');
    if (!se && !P.puoUtenti(ctx)) throw new P.ErrorePermesso();
    if (se && !P.puoUtenti(ctx)) { const { nome, password, pin } = corpo; return U.modificaUtente(db, p.id, { nome, password, pin }, { utente: ctx.utente.id }); }
    if (corpo.ruolo === 'titolare' && ctx.r.id !== 'titolare') throw new P.ErrorePermesso();
    return U.modificaUtente(db, p.id, corpo, { utente: ctx.utente.id });
  });
  r('GET', '/api/ruoli', ({ ctx }) => { serve(ctx); return P.ruoli(db); });
  r('PUT', '/api/ruoli/:id', ({ ctx, p, corpo }) => { if (!P.puoUtenti(serve(ctx))) throw new P.ErrorePermesso(); P.salvaRuolo(db, { ...corpo, id: p.id }); return P.ruolo(db, p.id); });

  r('GET', '/api/moduli', () => moduliWeb());
  for (const m of MODULI_SERVER) if (typeof m.registra === 'function') m.registra({ r, prima, db, S, D, P, A, M, U, meta, serve, ErroreHttp, manda, primoAvvio });

  async function statico(req, res, percorso) {
    // il motore delle formule è lo stesso nel server e nel browser
    if (percorso === '/motore/formule.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' }).end(await readFile(join(WEB, '..', 'server', 'formule.js'))); return; }
    let f = normalize(join(WEB, decodeURIComponent(percorso === '/' ? '/index.html' : percorso)));
    if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
    try { if ((await stat(f)).isDirectory()) f = join(f, 'index.html'); const b = await readFile(f);
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }).end(b);
    } catch {   // le rotte dell'interfaccia (#…) stanno tutte in index.html
      if (!extname(f)) { const b = await readFile(join(WEB, 'index.html')); res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(b); }
      else res.writeHead(404).end('non trovato');
    }
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), percorso = url.pathname;
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (!percorso.startsWith('/api/')) return statico(req, res, percorso);
    const { token, ctx } = ctxDi(req);
    if (percorso === '/api/eventi') {
      if (!ctx) { res.writeHead(401).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write(': ciao\n\n');
      const c = { res, ctx }; clienti.add(c); const batti = setInterval(() => res.write(': .\n\n'), 25000);
      req.on('close', () => { clearInterval(batti); clienti.delete(c); }); return;
    }
    const risposta = { intestazioni: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } };
    try {
      if (req.method !== 'GET' && req.headers['x-kubo'] !== '1' && !String(req.headers.authorization || '').startsWith('Bearer ')) throw new ErroreHttp(403, 'Richiesta senza intestazione X-Kubo');
      let corpo = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        let n = 0; const pezzi = [];
        for await (const x of req) { n += x.length; if (n > 5e6) throw new ErroreHttp(413, 'Troppo grande'); pezzi.push(x); }
        const t = Buffer.concat(pezzi).toString('utf8'); if (t) { try { corpo = JSON.parse(t); } catch { throw new ErroreHttp(400, 'JSON non valido'); } }
      }
      const rotta = rotte.find(x => x.metodo === req.method && x.re.test(percorso));
      if (!rotta) throw new ErroreHttp(404, 'Non trovato');
      const p = Object.fromEntries(Object.entries(percorso.match(rotta.re).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      for (const g of ganci) if (g.metodo === req.method && g.re.test(percorso)) await g.f({ ctx, percorso, corpo });
      const out = await rotta.f({ req, res, ctx, token, p, q: url.searchParams, corpo, risposta, ip: indirizzo(req) });
      if (res.headersSent) return;   // la rotta ha già risposto da sé (streaming di Lumi, file, scaricamenti)
      res.writeHead(200, risposta.intestazioni).end(JSON.stringify(out ?? null));
    } catch (e) {
      const [stato, extra] = e instanceof ErroreHttp ? [e.stato, e.extra] : e instanceof D.ErroreDati ? [422, { campi: e.campi }] : e instanceof S.ErroreSchema ? [422, { dettagli: e.dettagli }]
        : e instanceof P.ErrorePermesso ? [403, {}] : e instanceof U.ErroreAccesso ? [ctx ? 400 : 401, {}] : e instanceof SyntaxError ? [400, {}] : [500, {}];
      if (stato === 500) console.error(e);
      if (res.headersSent) { res.end(); return; }
      res.writeHead(stato, risposta.intestazioni).end(JSON.stringify({ errore: stato === 500 ? 'Errore interno' : e.message, ...extra }));
    }
  });
}
