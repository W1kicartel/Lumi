// API pubblica e webhook.
// Token personali: ogni persona ne crea per sé (nome, scadenza); il token si vede una volta sola, nel database c'è solo
// l'impronta SHA-256. Con «Authorization: Bearer kubo_…» si usano tutte le /api/* con gli stessi permessi del ruolo di chi
// l'ha creato. Un token non può creare altri token né gestire i webhook.
// Webhook (solo il titolare): su crea / modifica / elimina / ripristina di una sezione, POST JSON a un indirizzo scelto,
// firmato con HMAC-SHA256 («X-Kubo-Firma: sha256=…» su «<X-Kubo-Tempo>.<corpo>»). Le consegne si scrivono nella stessa
// transazione della modifica (se la modifica si annulla, non parte niente), poi si spediscono fuori; se il server non
// risponde 2xx si riprova con attese crescenti (ATTESE). Il registro delle consegne resta consultabile.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { nuovoId } from '../db.js';
import { controllaUrl, invia } from './sicurezza-rete.js';

export const ATTESE = [30, 120, 600, 1800, 7200];   // secondi prima dei tentativi 2, 3, 4…; poi la consegna è «fallita»
const impronta = t => createHash('sha256').update(String(t)).digest('hex');
export const firma = (segreto, tempo, corpo) => 'sha256=' + createHmac('sha256', segreto).update(`${tempo}.${corpo}`).digest('hex');
const EVENTI = ['crea', 'modifica', 'elimina', 'ripristina'];
let verificatoreAggiunto = false;

export default function registra({ r, db, S, D, P, U, meta, serve, ErroreHttp }) {
  // verso la rete interna solo se il titolare l'ha permesso (server/moduli/sicurezza-rete.js)
  const interni = () => process.env.KUBO_WEBHOOK_INTERNI === '1' || meta?.leggi(db, 'sicurezza.webhook_interni') === '1';
  db.exec(`CREATE TABLE IF NOT EXISTS _import_token (id TEXT PRIMARY KEY, utente TEXT NOT NULL, nome TEXT NOT NULL, impronta TEXT NOT NULL UNIQUE,
      inizio TEXT NOT NULL, creato TEXT NOT NULL, scade TEXT, usato TEXT, revocato INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS _import_webhook (id TEXT PRIMARY KEY, def TEXT NOT NULL, segreto TEXT NOT NULL, creato TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _import_consegne (id INTEGER PRIMARY KEY AUTOINCREMENT, webhook TEXT NOT NULL, evento TEXT NOT NULL, corpo TEXT NOT NULL,
      stato TEXT NOT NULL DEFAULT 'attesa', tentativi INTEGER NOT NULL DEFAULT 0, prossimo TEXT NOT NULL, codice INTEGER, risposta TEXT, creato TEXT NOT NULL, aggiornato TEXT);
    CREATE INDEX IF NOT EXISTS _import_consegne_coda ON _import_consegne(stato, prossimo);`);

  // ---------- token ----------
  if (!verificatoreAggiunto) {
    verificatoreAggiunto = true;
    U.aggiungiVerificatore((dbT, token) => {
      if (!token.startsWith('kubo_')) return null;
      let u; try { u = dbT.prepare(`SELECT t.usato AS t_usato, u.* FROM _import_token t JOIN _utenti u ON u.id = t.utente WHERE t.impronta = ? AND t.revocato = 0 AND u.attivo = 1 AND (t.scade IS NULL OR t.scade > ?)`).get(impronta(token), new Date().toISOString()); } catch { return null; }
      if (!u) return null;
      if (!u.t_usato || Date.now() - Date.parse(u.t_usato) > 6e4) dbT.prepare('UPDATE _import_token SET usato = ? WHERE impronta = ?').run(new Date().toISOString(), impronta(token));
      return { utente: U.pubblico(u), r: P.ruolo(dbT, u.ruolo), viaToken: true };
    });
  }
  const daSessione = ctx => { serve(ctx); if (ctx.viaToken) throw new ErroreHttp(403, 'Con un token non si gestiscono i token né i webhook: entra dall\'interfaccia'); return ctx; };
  const pubblicoToken = t => ({ id: t.id, nome: t.nome, inizio: t.inizio, creato: t.creato, scade: t.scade, usato: t.usato, revocato: !!t.revocato });

  r('GET', '/api/token', ({ ctx }) => db.prepare('SELECT * FROM _import_token WHERE utente = ? ORDER BY creato DESC').all(daSessione(ctx).utente.id).map(pubblicoToken));
  r('POST', '/api/token', ({ ctx, corpo }) => {
    daSessione(ctx);
    const nome = String(corpo.nome || '').trim().slice(0, 80); if (!nome) throw new ErroreHttp(400, 'Dai un nome al token (es. «Sito», «Contabilità»)');
    const giorni = corpo.giorni == null || corpo.giorni === '' ? 90 : Number(corpo.giorni);
    if (!Number.isFinite(giorni) || giorni < 0 || giorni > 3650) throw new ErroreHttp(400, 'Scadenza non valida');
    const token = 'kubo_' + randomBytes(24).toString('base64url'), id = nuovoId(), ora = new Date();
    const scade = giorni ? new Date(ora.getTime() + giorni * 864e5).toISOString() : null;
    db.prepare('INSERT INTO _import_token (id, utente, nome, impronta, inizio, creato, scade) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, ctx.utente.id, nome, impronta(token), token.slice(0, 9), ora.toISOString(), scade);
    return { ...pubblicoToken(db.prepare('SELECT * FROM _import_token WHERE id = ?').get(id)), token };
  });
  r('DELETE', '/api/token/:id', ({ ctx, p }) => {
    daSessione(ctx);
    const n = db.prepare('UPDATE _import_token SET revocato = 1 WHERE id = ? AND (utente = ? OR ?)').run(p.id, ctx.utente.id, ctx.r.id === 'titolare' ? 1 : 0).changes;
    if (!n) throw new ErroreHttp(404, 'Token sconosciuto'); return { ok: true };
  });

  // ---------- OpenAPI 3, generato dallo schema visto da chi chiede (per Postman, Swagger, generatori di client) ----------
  const TIPO_JSON = { numero: { type: 'number' }, valuta: { type: 'number', description: 'euro' }, percentuale: { type: 'number' }, durata: { type: 'integer', description: 'minuti' },
    si_no: { type: 'boolean' }, data: { type: 'string', format: 'date' }, data_ora: { type: 'string', format: 'date-time' }, email: { type: 'string', format: 'email' }, url: { type: 'string', format: 'uri' },
    scelta_multipla: { type: 'array', items: { type: 'string' } }, file: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, nome: { type: 'string' } } } } };
  r('GET', '/api/openapi.json', ({ ctx, req }) => {
    serve(ctx);
    const entita = S.elenco(db).filter(e => P.puo(ctx, e.id, 'leggi')), paths = {}, schemas = {};
    const errore = { description: 'Errore', content: { 'application/json': { schema: { type: 'object', properties: { errore: { type: 'string' } } } } } };
    for (const e of entita) {
      const props = {};
      for (const c of S.campiAttivi(e).filter(c => P.statoCampo(ctx, e.id, c.id) !== 'nascosto')) {
        let t = TIPO_JSON[c.tipo === 'immagine' ? 'file' : c.tipo] || { type: 'string' };
        if (['scelta', 'stato'].includes(c.tipo)) t = { type: 'string', enum: c.opzioni.map(o => o.id) };
        if (c.tipo === 'relazione') t = c.molti ? { type: 'array', items: { type: 'string' } } : { type: 'string', description: `id di ${c.entita}` };
        if (c.tipo === 'righe') t = { type: 'array', items: { type: 'object' }, description: `righe di ${c.entita}` };
        props[c.id] = { ...t, title: c.nome, ...(['calcolato', 'contatore'].includes(c.tipo) || P.statoCampo(ctx, e.id, c.id) === 'lettura' ? { readOnly: true } : {}) };
      }
      schemas[e.id] = { type: 'object', title: e.nome, properties: { id: { type: 'string', readOnly: true }, creato: { type: 'string', format: 'date-time', readOnly: true }, ...props },
        required: S.campiAttivi(e).filter(c => c.obbligatorio && props[c.id]).map(c => c.id) };
      const rif = { $ref: `#/components/schemas/${e.id}` }, corpo = { required: true, content: { 'application/json': { schema: rif } } }, una = { description: 'OK', content: { 'application/json': { schema: rif } } };
      const par = (name, descrizione, inn = 'query') => ({ name, in: inn, required: inn === 'path', schema: { type: 'string' }, description: descrizione });
      paths[`/api/dati/${e.id}`] = {
        get: { tags: [e.nome], summary: `Elenco di ${e.nome}`, parameters: [par('q', 'cerca nel testo'), par('f', 'filtri JSON: [{"campo":"…","op":"=","valore":…}]'), par('o', 'ordina: campo:desc'), par('p', 'pagina'), par('n', 'per pagina (max 500)')],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { righe: { type: 'array', items: rif }, totale: { type: 'integer' } } } } } }, default: errore } },
        ...(P.puo(ctx, e.id, 'crea') ? { post: { tags: [e.nome], summary: `Crea in ${e.nome}`, requestBody: corpo, responses: { 200: una, default: errore } } } : {}),
      };
      paths[`/api/dati/${e.id}/{id}`] = {
        parameters: [par('id', 'id della riga', 'path')],
        get: { tags: [e.nome], summary: 'Una riga', responses: { 200: una, default: errore } },
        ...(P.puo(ctx, e.id, 'modifica') ? { patch: { tags: [e.nome], summary: 'Modifica (solo i campi mandati)', requestBody: corpo, responses: { 200: una, default: errore } } } : {}),
        ...(P.puo(ctx, e.id, 'elimina') ? { delete: { tags: [e.nome], summary: 'Archivia (si ripristina)', responses: { 200: { description: 'OK' }, default: errore } } } : {}),
      };
    }
    return { openapi: '3.0.3', info: { title: 'Kubo', version: '1', description: 'API del gestionale, generate dallo schema. Autenticazione: Authorization: Bearer <token personale>.' },
      servers: [{ url: `http://${String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, '')}` }], security: [{ token: [] }],
      components: { securitySchemes: { token: { type: 'http', scheme: 'bearer' } }, schemas }, paths };
  });

  // ---------- webhook ----------
  const soloTitolare = ctx => { daSessione(ctx); if (ctx.r.id !== 'titolare') throw new P.ErrorePermesso('Solo il titolare gestisce i webhook'); return ctx; };
  const leggiWebhook = () => db.prepare('SELECT * FROM _import_webhook ORDER BY creato').all().map(w => ({ id: w.id, ...JSON.parse(w.def), segreto: w.segreto, creato: w.creato }));
  function pulito(c) {
    let u; try { u = new URL(String(c.url || '')); } catch { throw new ErroreHttp(400, 'Indirizzo non valido'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new ErroreHttp(400, 'L\'indirizzo deve iniziare con http:// o https://');
    const no = controllaUrl(u.href, { interni: interni() }); if (no) throw new ErroreHttp(400, no);
    const eventi = (Array.isArray(c.eventi) ? c.eventi : EVENTI).filter(e => EVENTI.includes(e));
    const entita = c.entita === '*' || !Array.isArray(c.entita) ? '*' : c.entita.map(String);
    return { nome: String(c.nome || u.host).slice(0, 80), url: u.href, entita, eventi: eventi.length ? eventi : EVENTI, attivo: c.attivo !== false };
  }
  r('GET', '/api/webhook', ({ ctx }) => {
    soloTitolare(ctx);
    const conta = db.prepare(`SELECT stato, COUNT(*) n FROM _import_consegne WHERE webhook = ? GROUP BY stato`);
    return leggiWebhook().map(w => ({ ...w, consegne: Object.fromEntries(conta.all(w.id).map(x => [x.stato, x.n])) }));
  });
  r('PUT', '/api/webhook/:id', ({ ctx, p, corpo }) => {
    soloTitolare(ctx);
    const def = pulito(corpo), ora = new Date().toISOString();
    if (p.id === 'nuovo') { const id = nuovoId(); db.prepare('INSERT INTO _import_webhook (id, def, segreto, creato) VALUES (?, ?, ?, ?)').run(id, JSON.stringify(def), 'whsec_' + randomBytes(24).toString('base64url'), ora); return leggiWebhook().find(w => w.id === id); }
    if (!db.prepare('UPDATE _import_webhook SET def = ? WHERE id = ?').run(JSON.stringify(def), p.id).changes) throw new ErroreHttp(404, 'Webhook sconosciuto');
    if (corpo.nuovoSegreto) db.prepare('UPDATE _import_webhook SET segreto = ? WHERE id = ?').run('whsec_' + randomBytes(24).toString('base64url'), p.id);
    return leggiWebhook().find(w => w.id === p.id);
  });
  r('DELETE', '/api/webhook/:id', ({ ctx, p }) => { soloTitolare(ctx); db.prepare('DELETE FROM _import_webhook WHERE id = ?').run(p.id); db.prepare('DELETE FROM _import_consegne WHERE webhook = ?').run(p.id); return { ok: true }; });
  r('GET', '/api/webhook/:id/consegne', ({ ctx, p }) => {
    soloTitolare(ctx);
    return db.prepare('SELECT id, evento, stato, tentativi, prossimo, codice, risposta, creato, aggiornato FROM _import_consegne WHERE webhook = ? ORDER BY id DESC LIMIT 100').all(p.id);
  });
  r('POST', '/api/webhook/:id/prova', ({ ctx, p }) => {
    soloTitolare(ctx); const w = leggiWebhook().find(w => w.id === p.id); if (!w) throw new ErroreHttp(404, 'Webhook sconosciuto');
    accoda(w, 'prova', { evento: 'prova', quando: new Date().toISOString(), messaggio: 'Prova da Kubo' }); spedisciPresto(); return { ok: true };
  });
  r('POST', '/api/webhook/consegne/:n/riprova', ({ ctx, p }) => {
    soloTitolare(ctx); db.prepare(`UPDATE _import_consegne SET stato = 'attesa', prossimo = ? WHERE id = ?`).run(new Date().toISOString(), Number(p.n)); spedisciPresto(); return { ok: true };
  });

  const accoda = (w, evento, corpo) => db.prepare('INSERT INTO _import_consegne (webhook, evento, corpo, prossimo, creato) VALUES (?, ?, ?, ?, ?)')
    .run(w.id, evento, JSON.stringify({ consegna: null, ...corpo }), new Date().toISOString(), new Date().toISOString());
  // ogni modifica ai dati: una consegna per ogni webhook interessato, nella stessa transazione
  D.ascolta((ev, dbEv, ctx) => {
    if (dbEv !== db || !EVENTI.includes(ev.tipo)) return;
    const interessati = leggiWebhook().filter(w => w.attivo && w.eventi.includes(ev.tipo) && (w.entita === '*' || w.entita.includes(ev.entita)));
    if (!interessati.length) return;
    const corpo = { evento: `${ev.entita}.${ev.tipo}`, entita: ev.entita, id: ev.id, tipo: ev.tipo, quando: new Date().toISOString(), da: ctx?.utente?.id ?? null,
      dati: ev.dopo ?? null, ...(ev.tipo === 'modifica' || ev.tipo === 'elimina' ? { prima: ev.prima ?? null } : {}) };
    for (const w of interessati) accoda(w, corpo.evento, corpo);
    spedisciPresto();
  });

  // ---------- la spedizione: fuori dalle transazioni, una consegna alla volta, mai due volte ----------
  let occupato = false, presto = null;
  function spedisciPresto() { if (!presto) presto = setTimeout(() => { presto = null; spedisci(); }, 30); presto.unref?.(); }
  async function spedisci() {
    if (occupato) return; occupato = true;
    try {
      for (let giro = 0; giro < 50; giro++) {
        const c = db.prepare(`SELECT c.*, w.def, w.segreto FROM _import_consegne c JOIN _import_webhook w ON w.id = c.webhook WHERE c.stato = 'attesa' AND c.prossimo <= ? ORDER BY c.id LIMIT 1`).get(new Date().toISOString());
        if (!c) break;
        db.prepare(`UPDATE _import_consegne SET stato = 'invio' WHERE id = ?`).run(c.id);
        const corpo = JSON.stringify({ ...JSON.parse(c.corpo), consegna: c.id }), tempo = String(Math.floor(Date.now() / 1000)), def = JSON.parse(c.def);
        let codice = null, risposta = '';
        try {
          const rr = await invia(def.url, { corpo, interni: interni(), ms: 10000,   // niente redirect seguiti, niente rete interna
            intestazioni: { 'Content-Type': 'application/json', 'User-Agent': 'Kubo-Webhook/1', 'X-Kubo-Evento': c.evento, 'X-Kubo-Consegna': String(c.id), 'X-Kubo-Tempo': tempo, 'X-Kubo-Firma': firma(c.segreto, tempo, corpo) } });
          codice = rr.status; risposta = rr.testo.slice(0, 500);
        } catch (e) { risposta = String(e?.code === 'INDIRIZZO_INTERNO' ? e.message : e?.cause?.code || e?.code || e?.name || e?.message || e).slice(0, 500); }
        const ok = codice >= 200 && codice < 300, tentativi = c.tentativi + 1, fine = ok || tentativi > ATTESE.length;
        db.prepare('UPDATE _import_consegne SET stato = ?, tentativi = ?, codice = ?, risposta = ?, prossimo = ?, aggiornato = ? WHERE id = ?')
          .run(ok ? 'ok' : fine ? 'fallita' : 'attesa', tentativi, codice, risposta, new Date(Date.now() + (fine ? 0 : ATTESE[tentativi - 1] * 1000)).toISOString(), new Date().toISOString(), c.id);
      }
    } catch (e) { console.error('webhook', e); }
    finally { occupato = false; }
    // il prossimo tentativo vicino non aspetta il giro dei 5 secondi
    const dopo = db.prepare(`SELECT MIN(prossimo) p FROM _import_consegne WHERE stato = 'attesa'`).get()?.p;
    if (dopo && Date.parse(dopo) - Date.now() < 5000) setTimeout(spedisci, Math.max(10, Date.parse(dopo) - Date.now())).unref();
  }
  // le consegne rimaste a metà (server spento durante l'invio) ripartono; poi un giro ogni 5 secondi per i nuovi tentativi
  db.prepare(`UPDATE _import_consegne SET stato = 'attesa' WHERE stato = 'invio'`).run();
  setInterval(spedisci, 5000).unref();
}
