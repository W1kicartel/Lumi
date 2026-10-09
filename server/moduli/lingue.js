// Le lingue nel server: la lingua di ogni utente (salvata qui), la lingua e la valuta dell'azienda, i messaggi di errore
// tradotti e i modelli installati nella lingua dell'azienda. Rotte:
//   GET /api/lingua → { lingua (dell'utente, o null), proposta (da Accept-Language), azienda: { lingua, valuta }, lingue, valute }
//   PUT /api/lingua { lingua } · PUT /api/lingua/azienda { lingua?, valuta? } (chi personalizza; prima del primo avvio, chiunque)
//   GET /api/lingua/modelli?l=en → i modelli del primo avvio con nomi e descrizioni tradotti
// Gli errori: il motore lancia i suoi messaggi in italiano, come sempre; prima che la risposta parta, il testo si riconosce
// nel catalogo italiano (server/moduli/lingue/it.js: chiave → modello con i {parametri}), se ne prendono i parametri e si
// riscrive con la stessa chiave nella lingua dell'utente. Nessun punto del motore cambia: un messaggio che non è nel
// catalogo resta in italiano (test/lingue.test.mjs controlla che quelli del motore ci siano tutti).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { meta } from '../db.js';
import it from './lingue/it.js';
import en from './lingue/en.js';
import es from './lingue/es.js';
import fr from './lingue/fr.js';
import de from './lingue/de.js';
import pt from './lingue/pt.js';

export const LINGUE = ['it', 'en', 'es', 'fr', 'de', 'pt'];
export const VALUTE = ['EUR', 'USD', 'GBP', 'CHF', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'CAD', 'AUD', 'JPY', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'MAD', 'INR'];
export const CATALOGHI = { it, en, es, fr, de, pt };
const CARTELLA_MODELLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'modelli', 'lingue');

// Accept-Language → la prima lingua che Lumi conosce (con il peso q), altrimenti null
export function daIntestazione(s) {
  const l = String(s || '').split(',').map((x, i) => { const [t, ...p] = x.trim().split(';'); const q = Number((p.find(y => y.trim().startsWith('q=')) || 'q=1').trim().slice(2)); return { c: t.slice(0, 2).toLowerCase(), q: Number.isFinite(q) ? q : 0, i }; })
    .filter(x => x.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  return l.find(x => LINGUE.includes(x.c))?.c || null;
}

// ---------- i messaggi ----------
// ogni modello italiano diventa un'espressione: «Entità sconosciuta «{id}»» → /^Entità sconosciuta «(.+?)»$/. Prima i più
// lunghi (i più precisi). I parametri con «_» davanti sono a loro volta messaggi, e si traducono anche loro.
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MODELLI = Object.entries(it).filter(([, v]) => typeof v === 'string').map(([chiave, testo]) => {
  const nomi = [...testo.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
  // un parametro semplice non contiene virgolette « » (così «campo «{id}»» non si mangia un messaggio composto); uno con «_» sì
  const pezzi = testo.split(/\{\w+\}/).map(escape);
  const re = new RegExp('^' + pezzi.map((p, i) => (i ? (nomi[i - 1].startsWith('_') ? '([\\s\\S]+?)' : '([^«»]+?)') : '') + p).join('') + '$');
  return { chiave, re, nomi, fissi: testo.replace(/\{\w+\}/g, '').length };
}).sort((a, b) => b.fissi - a.fissi);

export function riconosci(testo) {
  for (const m of MODELLI) { const x = m.re.exec(testo); if (x) return { chiave: m.chiave, parametri: Object.fromEntries(m.nomi.map((n, i) => [n, x[i + 1]])) }; }
  return null;
}
export function testo(lingua, chiave, p = {}) {
  const v = CATALOGHI[lingua]?.[chiave] ?? it[chiave] ?? chiave;
  return String(v).replace(/\{(\w+)\}/g, (x, k) => (k in p ? String(p[k]) : x));
}
// un messaggio italiano del motore nella lingua chiesta (se non lo riconosce, resta com'è)
export function traduci(messaggio, lingua, profondita = 0) {
  if (typeof messaggio !== 'string' || lingua === 'it' || !CATALOGHI[lingua] || profondita > 3) return messaggio;
  const r = riconosci(messaggio); if (!r) return messaggio;
  for (const k of Object.keys(r.parametri)) if (k.startsWith('_')) r.parametri[k] = traduci(r.parametri[k], lingua, profondita + 1);
  return testo(lingua, r.chiave, r.parametri);
}
// il corpo di un errore: il messaggio, gli errori per campo ({ campi }) e l'elenco dei dettagli
export function traduciCorpo(corpo, lingua) {
  if (!corpo || lingua === 'it') return corpo;
  const out = { ...corpo, errore: traduci(corpo.errore, lingua) };
  if (corpo.campi && typeof corpo.campi === 'object') out.campi = Object.fromEntries(Object.entries(corpo.campi).map(([k, v]) => [k, traduci(v, lingua)]));
  if (Array.isArray(corpo.dettagli)) out.dettagli = corpo.dettagli.map(d => traduci(d, lingua));
  return out;
}

// ---------- i modelli di settore nella lingua dell'azienda ----------
// modelli/lingue/<lingua>.json: { <modello>: { nome, descrizione, entita: { <id>: { nome, campi: { <id>: nome | { nome, opzioni: { <id>: nome } } } } },
//   automazioni: { <id>: nome } } }. Gli id non cambiano mai: si traducono solo i nomi.
const cacheNomi = {};
export function nomiModelli(lingua) {
  if (!LINGUE.includes(lingua) || lingua === 'it') return {};
  if (!cacheNomi[lingua]) { const f = join(CARTELLA_MODELLI, lingua + '.json'); cacheNomi[lingua] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; }
  return cacheNomi[lingua];
}
export function traduciModello(m, lingua) {
  const n = nomiModelli(lingua)[m.id]; if (!n) return m;
  const nomeDi = x => (typeof x === 'string' ? x : x?.nome);
  return { ...m, nome: n.nome ?? m.nome, descrizione: n.descrizione ?? m.descrizione,
    entita: m.entita.map(e => { const te = n.entita?.[e.id]; if (!te) return e;
      return { ...e, nome: te.nome ?? e.nome, campi: e.campi.map(c => { const tc = te.campi?.[c.id]; if (!tc) return c;
        return { ...c, nome: nomeDi(tc) ?? c.nome, ...(c.opzioni && tc.opzioni ? { opzioni: c.opzioni.map(o => ({ ...o, nome: tc.opzioni[o.id] ?? o.nome })) } : {}) }; }) }; }),
    automazioni: (m.automazioni || []).map(a => ({ ...a, nome: n.automazioni?.[a.id] ?? a.nome })),
    // i ruoli per id; i titoli del cruscotto (widget e «cosa richiede attenzione») per il titolo italiano
    ...(m.ruoli ? { ruoli: m.ruoli.map(r => ({ ...r, nome: n.ruoli?.[r.id] ?? r.nome })) } : {}),
    ...(m.cruscotto ? { cruscotto: { ...m.cruscotto, ...Object.fromEntries(['widget', 'attenzione'].filter(k => Array.isArray(m.cruscotto[k]))
      .map(k => [k, m.cruscotto[k].map(w => ({ ...w, titolo: n.cruscotto?.[w.titolo] ?? w.titolo }))])) } } : {}) };
}

const ritoccoModelli = (m, db) => traduciModello(m, meta.leggi(db, 'lingue.azienda') || 'it');

export default function registra({ r, db, M, U, P, serve, ErroreHttp, suErrore, primoAvvio }) {
  db.exec('CREATE TABLE IF NOT EXISTS _lingue_utenti (utente TEXT PRIMARY KEY, lingua TEXT NOT NULL)');
  const diUtente = id => db.prepare('SELECT lingua FROM _lingue_utenti WHERE utente = ?').get(String(id))?.lingua || null;
  const azienda = () => ({ lingua: meta.leggi(db, 'lingue.azienda') || 'it', valuta: meta.leggi(db, 'lingue.valuta') || 'EUR' });
  // la lingua di una richiesta: quella dell'utente, poi quella del browser, poi quella dell'azienda
  const linguaDi = (req, ctx) => (ctx?.utente && diUtente(ctx.utente.id)) || daIntestazione(req?.headers?.['accept-language']) || azienda().lingua;

  r('GET', '/api/lingua', ({ req, ctx }) => ({ accesso: !!ctx?.utente, lingua: ctx?.utente ? diUtente(ctx.utente.id) : null, proposta: daIntestazione(req.headers['accept-language']),
    azienda: azienda(), lingue: LINGUE, valute: VALUTE }));
  r('PUT', '/api/lingua', ({ ctx, corpo }) => {
    serve(ctx); const l = String(corpo?.lingua || '');
    if (!LINGUE.includes(l)) throw new ErroreHttp(400, 'Lingua sconosciuta');
    db.prepare('INSERT INTO _lingue_utenti (utente, lingua) VALUES (?, ?) ON CONFLICT(utente) DO UPDATE SET lingua = excluded.lingua').run(ctx.utente.id, l);
    return { lingua: l };
  });
  r('PUT', '/api/lingua/azienda', ({ ctx, corpo, ip }) => {
    // prima del primo avvio non c'è nessuno: la lingua e la valuta scelte nella prima pagina valgono per i modelli da installare
    // (da un altro computer serve il codice di avvio, come per /api/configura)
    if (U.quanti(db) === 0) primoAvvio?.(ip, corpo?.codice);
    else if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso('Non puoi personalizzare il gestionale');
    if (corpo?.lingua != null && !LINGUE.includes(String(corpo.lingua))) throw new ErroreHttp(400, 'Lingua sconosciuta');
    if (corpo?.valuta != null && !VALUTE.includes(String(corpo.valuta))) throw new ErroreHttp(400, 'Valuta sconosciuta');
    if (corpo?.lingua != null) meta.scrivi(db, 'lingue.azienda', String(corpo.lingua));
    if (corpo?.valuta != null) meta.scrivi(db, 'lingue.valuta', String(corpo.valuta));
    return azienda();
  });
  r('GET', '/api/lingua/modelli', ({ q, req, ctx }) => {
    const l = LINGUE.includes(q.get('l')) ? q.get('l') : linguaDi(req, ctx);
    return M.elenco().map(m => { const n = nomiModelli(l)[m.id]; if (!n) return m;
      const entita = M.leggi(m.id).entita.filter(e => !e.nascosta).map(e => n.entita?.[e.id]?.nome ?? e.nome);
      return { ...m, nome: n.nome ?? m.nome, descrizione: n.descrizione ?? m.descrizione, entita }; });
  });

  if (!M.ritocchi.includes(ritoccoModelli)) M.ritocchi.push(ritoccoModelli);
  suErrore?.((corpo, { req, ctx }) => traduciCorpo(corpo, linguaDi(req, ctx)));
}
