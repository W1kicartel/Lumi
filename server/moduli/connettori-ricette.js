// Le ricette: collegare un servizio REST qualunque dall'interfaccia, senza scrivere codice. Un solo motore per il connettore
// «HTTP / API REST» (connettori/http) e per i ponti verso le piattaforme di automazione (zapier, make, n8n, pipedream, webhook).
// Il titolare scrive le ricette nella pagina del connettore; il nucleo (connettori.js) le custodisce come un'impostazione
// «ricette», le passa a controllaRicette() quando si salvano, e ne ricava azioni e permessi (azioni/permessi come funzioni
// delle impostazioni). Tre tipi:
//   uscita   su crea/modifica/elimina/ripristina di una riga della sezione: una richiesta in coda (tentativi del nucleo)
//   azione   un bottone nella scheda e uno strumento di Lumi, con l'anteprima della richiesta prima di scrivere
//   entrata  POST /api/connettori/<id>/in/<codice>[?ricetta=<id>]: i campi del JSON (per percorso: «cliente.email»)
//            diventano campi della sezione; con un campo chiave si aggiorna la riga che c'è già, altrimenti si crea
// Segnaposto: {campo} (id o nome del campo), {cliente.titolo} (percorso), {id}, {evento}, {sezione}, {quando}.
// Nel percorso i valori si codificano per l'indirizzo; nel corpo JSON "{campo}" da solo tiene il tipo (numero, sì/no, oggetto).
// Tutto passa da k.http (protezione SSRF), i segreti restano cifrati, le scritture risultano fatte dall'identità del connettore.
import { stessoSegreto, firmaHmac } from './connettori-rete.js';
import { firma as firmaWebhook } from './import-api.js';
import { transazione } from '../db.js';
import { controllaUrl } from './sicurezza-rete.js';
import { normalizza } from '../../web/libreria.js';
import { testo as messaggio } from './connettori-lingue.js';

// un errore con la chiave dei messaggi dei connettori (connettori-lingue.js): il nucleo lo traduce nella lingua di chi chiede
export class ErroreRicetta extends Error { constructor(chiave, p = {}, stato = 400) { super(messaggio('it', chiave, p)); Object.assign(this, { chiave, p, stato }); } }
const sbaglia = (chiave, p = {}, stato = 400) => { throw new ErroreRicetta(chiave, p, stato); };

export const TIPI = ['uscita', 'azione', 'entrata'];
export const METODI = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const EVENTI = ['crea', 'modifica', 'elimina', 'ripristina'];
export const MODI = ['crea-o-aggiorna', 'crea', 'aggiorna'];
export const ACCESSI = ['nessuno', 'intestazione', 'query', 'bearer', 'basic', 'oauth2'];
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/, PERCORSO = /^[\w.$-]+(\.[\w$-]+)*$/;

// «https://{x}.esempio.it/…»: un segnaposto prima del percorso (nel nome del sito, nella porta)
const origineConSegnaposto = u => /\{/.test(/^[a-z][a-z0-9+.-]*:\/*[^/?#]*/i.exec(String(u))?.[0] || '');
export const prendi = (o, via) => String(via ?? '').split('.').filter(Boolean).reduce((x, k) => (x == null ? undefined : x[k]), o);
const testo = (v, max) => String(v ?? '').trim().slice(0, max);

// ---------- controllo delle ricette salvate (lancia un Error con un messaggio per il titolare) ----------
export function controllaRicette(lista, { S, db, interni = false, tipi = TIPI, assoluti = false } = {}) {
  if (!Array.isArray(lista)) sbaglia('ricette-elenco');
  if (lista.length > 100) sbaglia('ricette-troppe');
  const visti = new Set();
  return lista.map((r, i) => {
    const n = i + 1, id = testo(r?.id, 40).toLowerCase() || `r${n}`;
    if (!ID.test(id) || visti.has(id)) sbaglia('ricetta-id', { n, id }); visti.add(id);
    const tipo = r.tipo; if (!tipi.includes(tipo)) sbaglia('ricetta-tipo', { n, tipo: String(tipo), tipi: tipi.join(', ') });
    const sezione = testo(r.sezione, 60), def = S && db ? S.leggi(db, sezione) : { campi: [] };
    if (!sezione || !def || def.archiviata) sbaglia('ricetta-sezione', { n, sezione });
    const campiOk = new Set((S && db ? S.campiAttivi(def) : []).map(c => c.id));
    const base = { id, nome: testo(r.nome, 80) || `Ricetta ${n}`, tipo, sezione, attiva: r.attiva !== false };
    if (tipo === 'entrata') {
      const modo = MODI.includes(r.modo) ? r.modo : 'crea-o-aggiorna', chiave = testo(r.chiave, 60) || null;
      if (chiave && S && !campiOk.has(chiave)) sbaglia('ricetta-campo', { n, campo: chiave });
      if (modo !== 'crea' && !chiave) sbaglia('ricetta-serve-chiave', { n });
      const campi = (Array.isArray(r.campi) ? r.campi : []).slice(0, 100).map(c => ({ da: testo(c?.da, 200), a: testo(c?.a, 60) })).filter(c => c.da || c.a);
      for (const c of campi) {
        if (!PERCORSO.test(c.da)) sbaglia('ricetta-percorso-json', { n, percorso: c.da });
        if (S && !campiOk.has(c.a)) sbaglia('ricetta-campo', { n, campo: c.a });
      }
      for (const [k, v] of [['elenco', r.elenco], ['idEvento', r.idEvento]]) if (v && !PERCORSO.test(String(v))) sbaglia('ricetta-percorso-json', { n, percorso: String(v) });
      return { ...base, modo, chiave, campi, elenco: testo(r.elenco, 200) || null, idEvento: testo(r.idEvento, 200) || null };
    }
    const metodo = METODI.includes(String(r.metodo || '').toUpperCase()) ? String(r.metodo).toUpperCase() : 'POST';
    const percorso = testo(r.percorso, 2000); if (!percorso) sbaglia('ricetta-manca-percorso', { n });
    if (/^[a-z][a-z0-9+.-]*:/i.test(percorso)) {
      const prova = percorso.replace(/\{[^{}]*\}/g, 'x');
      if (!/^https?:\/\//i.test(prova)) sbaglia('ricetta-http', { n });
      // il sito lo sceglie il titolare, non i dati: «https://{dominio}.com/» manderebbe chiavi e righe dove dice una riga
      if (origineConSegnaposto(percorso)) sbaglia('ricetta-host', { n });
      if (controllaUrl(prova, { interni })) sbaglia('ricetta-rete', { n });
    } else if (assoluti) sbaglia('ricetta-assoluto', { n });
    else if (!percorso.startsWith('/')) sbaglia('ricetta-barra', { n });
    const corpo = String(r.corpo ?? '').slice(0, 20000);
    const out = { ...base, metodo, percorso, corpo };
    // un indirizzo completo riceve l'accesso del connettore (chiave, token) solo se il titolare lo dice per quella ricetta
    if (/^https?:\/\//i.test(percorso) && r.conAccesso === true) out.conAccesso = true;
    if (tipo === 'uscita') { const ev = (Array.isArray(r.eventi) ? r.eventi : ['crea', 'modifica']).filter(e => EVENTI.includes(e)); out.eventi = ev.length ? ev : ['crea', 'modifica']; }
    else out.scrive = r.scrive !== false;
    return out;
  });
}
export const attive = (imp, tipo) => (Array.isArray(imp?.ricette) ? imp.ricette : []).filter(r => r.attiva !== false && (!tipo || r.tipo === tipo));

// i permessi dell'identità del connettore: leggere quello che manda, creare/modificare dove le ricette in entrata scrivono
export function permessiRicette(imp) {
  const p = {};
  for (const r of attive(imp)) {
    const x = p[r.sezione] ||= { leggi: true };
    if (r.tipo === 'entrata') { if (r.modo !== 'aggiorna') x.crea = true; if (r.modo !== 'crea') x.modifica = true; }
  }
  return p;
}

// ---------- segnaposto ----------
// un valore della riga per id o per nome del campo («{Ragione sociale}» come «{ragione_sociale}»); i percorsi scendono negli oggetti
function valore(v, chiave, campi) {
  let x = prendi(v, chiave); if (x !== undefined) return x;
  const [primo, ...resto] = String(chiave).split('.'), c = campi.find(c => normalizza(c.nome) === normalizza(primo));
  return c ? prendi(v[c.id], resto.join('.')) ?? (resto.length ? undefined : v[c.id]) : undefined;
}
const comeTesto = x => (x == null ? '' : typeof x === 'object' ? (x.titolo ?? x.id ?? JSON.stringify(x)) : String(x));
export function riempi(modello, v, campi = [], codifica = false) {
  return String(modello).replace(/\{([^{}"\s][^{}"]*)\}/g, (_, c) => { const t = comeTesto(valore(v, c.trim(), campi)); return codifica ? encodeURIComponent(t) : t; });
}
// il corpo: vuoto = tutto l'evento; JSON = struttura con i segnaposto; altrimenti testo
export function corpoDi(modello, v, campi = []) {
  const m = String(modello ?? '').trim();
  if (!m) return { json: v };
  let j; try { j = JSON.parse(m); } catch { return { testo: riempi(m, v, campi) }; }
  const giro = x => {
    if (typeof x === 'string') { const solo = /^\{([^{}"]+)\}$/.exec(x); return solo ? (valore(v, solo[1].trim(), campi) ?? null) : riempi(x, v, campi); }
    if (Array.isArray(x)) return x.map(giro);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([a, b]) => [a, giro(b)]));
    return x;
  };
  return { json: giro(j) };
}

// ---------- la richiesta: indirizzo, accesso, intestazioni, firma; la stessa per l'anteprima e per l'invio ----------
function intestazioniExtra(imp) {
  let x = imp?.intestazioni; if (typeof x === 'string') { try { x = JSON.parse(x); } catch { x = null; } }
  return x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([a, b]) => /^[A-Za-z0-9-]{1,64}$/.test(a) && !/[\r\n\0]/.test(String(b))).map(([a, b]) => [a, String(b)])) : {};
}
export async function prepara(k, r, v, { anteprima = false } = {}) {
  const def = k.S.leggi(k.db, r.sezione), campi = def ? k.S.campiAttivi(def) : [];
  const assoluto = /^https?:\/\//i.test(r.percorso), base = String(k.imp.base || k.base || '').replace(/\/+$/, '');
  if (!assoluto && !base) sbaglia('ricette-base');
  if (assoluto && origineConSegnaposto(r.percorso)) sbaglia('ricetta-host', { n: r.nome || r.id });
  const u = new URL(assoluto ? riempi(r.percorso, v, campi, true) : base + riempi(r.percorso, v, campi, true));
  // un indirizzo completo su un altro sito (o senza indirizzo base): niente chiave né token, salvo «conAccesso» nella ricetta
  const altroSito = assoluto && (!base || new URL(base).host !== u.host);
  const opz = { intestazioni: intestazioniExtra(k.imp) }, a = altroSito && !r.conAccesso ? 'nessuno' : k.imp.accesso || 'nessuno', s = k.segreti, nome = k.imp.accesso_nome;
  let visibile = u.href;
  if (a === 'intestazione') opz.intestazioni[nome || 'X-API-Key'] = s.chiave || '';
  else if (a === 'query') { u.searchParams.set(nome || 'api_key', s.chiave || ''); const w = new URL(u); w.searchParams.set(nome || 'api_key', '••••'); visibile = w.href; }
  else if (a === 'bearer') opz.bearer = s.chiave || '';
  else if (a === 'basic') opz.basic = [k.imp.utente || '', s.chiave || ''];
  else if (a === 'oauth2' && !anteprima) opz.bearer = await k.oauth.token();
  let corpoTesto = '';
  if (!['GET', 'DELETE'].includes(r.metodo) || String(r.corpo || '').trim()) {
    const c = corpoDi(r.corpo, v, campi);
    if (c.json !== undefined) { corpoTesto = JSON.stringify(c.json); opz.intestazioni['Content-Type'] ||= 'application/json'; }
    else { corpoTesto = c.testo; opz.intestazioni['Content-Type'] ||= 'text/plain; charset=utf-8'; }
    opz.testo = corpoTesto;
  }
  // la firma come i webhook di Lumi (X-Lumi-Firma: sha256=HMAC(segreto, "<tempo>.<corpo>")), se c'è il segreto
  if (s.firma_uscita) { const t = String(Math.floor(Date.now() / 1000)); opz.intestazioni['X-Lumi-Tempo'] = t; opz.intestazioni['X-Lumi-Firma'] = firmaWebhook(s.firma_uscita, t, corpoTesto); }
  return { metodo: r.metodo, url: u.href, visibile, opz, corpoTesto };
}
export async function chiama(k, r, v) {
  const q = await prepara(k, r, v);
  return k.http.richiesta(q.metodo, q.url, q.opz);
}

// i valori per i segnaposto: la riga com'è adesso (letta con l'identità del connettore), o quella dell'evento se non c'è più
function valoriDi(k, r, riga, extra = {}) { return { ...(riga || {}), id: riga?.id ?? extra.id, sezione: r.sezione, quando: new Date().toISOString(), ...extra }; }

// ---------- i pezzi del manifesto ----------
// opz: accesso (indirizzo base e autenticazione: il connettore HTTP); senza, le ricette usano indirizzi completi (i ponti)
export function manifestoRicette({ accesso = true } = {}) {
  const imp = [
    ...(accesso ? [
      { id: 'base', nome: 'Indirizzo base dell\'API (es. https://api.esempio.it/v1)', tipo: 'url' },
      { id: 'accesso', nome: 'Autenticazione', tipo: 'scelta', opzioni: ACCESSI, predefinito: 'nessuno' },
      { id: 'accesso_nome', nome: 'Nome dell\'intestazione o del parametro (es. X-API-Key)', schema: /^[A-Za-z0-9_-]{1,64}$/ },
      { id: 'utente', nome: 'Utente (Basic)' },
      { id: 'chiave', nome: 'Chiave, token o password', segreto: true, obbligatorio: false },
      { id: 'token_url', nome: 'OAuth2: indirizzo del token', tipo: 'url' },
      { id: 'scope', nome: 'OAuth2: scope (facoltativo)' },
      { id: 'client_id', nome: 'OAuth2: client ID', segreto: true, obbligatorio: false },
      { id: 'client_secret', nome: 'OAuth2: client secret', segreto: true, obbligatorio: false },
      // relativo all'indirizzo base, come le ricette: «.altro.it/» o un indirizzo completo porterebbero la chiave altrove
      { id: 'prova_percorso', nome: 'Percorso per provare la connessione (es. /me)', schema: /^\/[^\s{}]{0,500}$/ },
    ] : []),
    { id: 'intestazioni', nome: 'Intestazioni in più (JSON, es. {"Accept-Language":"it"})', tipo: 'json', controlla: v => { if (v == null || v === '') return null; if (typeof v !== 'object' || Array.isArray(v)) sbaglia('ricette-intestazioni'); return Object.fromEntries(Object.entries(v).slice(0, 30).map(([a, b]) => { if (!/^[A-Za-z0-9-]{1,64}$/.test(a) || /[\r\n\0]/.test(String(b))) sbaglia('ricette-intestazioni'); return [a, String(b).slice(0, 2000)]; })); } },
    { id: 'ricette', nome: 'Ricette', tipo: 'ricette', predefinito: [], assoluti: !accesso, controlla: (v, x) => controllaRicette(v, { ...x, assoluti: !accesso }) },
    { id: 'codice', nome: 'Codice segreto delle ricette in entrata (va in fondo all\'indirizzo)', segreto: true, generato: true },
    { id: 'firma_entrata', nome: 'Segreto HMAC delle richieste in entrata (facoltativo)', segreto: true, obbligatorio: false },
    { id: 'intestazione_firma', nome: 'Intestazione con la firma HMAC in entrata', predefinito: 'X-Signature', schema: /^[A-Za-z0-9-]{1,64}$/ },
    { id: 'firma_uscita', nome: 'Segreto per firmare le richieste in uscita (X-Lumi-Firma, facoltativo)', segreto: true, obbligatorio: false },
  ];
  const scegli = (k, q) => { const e = attive(k.imp, 'entrata'), x = q?.get?.('ricetta'); return x ? e.find(r => r.id === x) : e.length === 1 ? e[0] : null; };
  return {
    impostazioni: imp,
    permessi: permessiRicette,
    ...(accesso ? {
      oauth: { tipo: 'client', token: k => k.imp.token_url, scope: k => k.imp.scope || undefined, usato: i => i.accesso === 'oauth2' },
      prova: async k => {
        if (!k.imp.base) return { ok: true, messaggio: null };
        const x = await chiama(k, { metodo: 'GET', percorso: k.imp.prova_percorso || '/', corpo: '', sezione: '' }, {});
        return { ok: x.ok, messaggio: x.ok ? null : `HTTP ${x.stato}` };
      },
    } : {}),
    // in uscita: ogni scrittura della sezione (che non viene da questo connettore) mette in coda le ricette che la riguardano
    eventi(ev, k) {
      for (const r of attive(k.imp, 'uscita')) if (r.sezione === ev.entita && r.eventi.includes(ev.tipo))
        // la riga si rilegge quando parte: in coda (che resta nel database) solo l'id, e la riga intera solo per «elimina»
        k.accoda('ricetta', `${r.id}:${ev.id}`, { ricetta: r.id, evento: ev.tipo, id: ev.id, dati: ev.tipo === 'elimina' ? ev.dopo ?? ev.prima ?? null : null });
    },
    lavori: {
      async ricetta(c, k) {
        const r = attive(k.imp, 'uscita').find(x => x.id === c.ricetta); if (!r) return;   // tolta o spenta nel frattempo: niente
        let riga = c.dati; if (c.evento !== 'elimina') { try { riga = k.dati.leggi(r.sezione, c.id); } catch { /* sparita: si manda quella dell'evento */ } }
        if (!riga) return;   // tolta prima della partenza (o un evento vecchio senza riga): ci pensa la ricetta di «elimina»
        const x = await chiama(k, r, valoriDi(k, r, riga, { id: c.id, evento: c.evento }));
        if (!x.ok) sbaglia('ricette-risposta', { stato: x.stato, dettaglio: `${r.nome}${x.testo ? ` · ${x.testo.slice(0, 200)}` : ''}` }, 502);
      },
    },
    // le azioni: una per ricetta «azione», nella scheda della sua sezione e come strumento di Lumi
    azioni: impo => Object.fromEntries(attive(impo, 'azione').map(r => [r.id, {
      nome: r.nome, descrizione: `${r.nome} (${r.metodo} ${r.percorso})`, su: r.sezione, scrive: r.scrive !== false, lumi: true,
      input: { riga: { tipo: 'relazione', entita: r.sezione, nome: 'La riga' } },
      async proponi({ riga }, k, { ctx } = {}) {
        const q = await prepara(k, r, valoriDi(k, r, riga, { evento: 'azione' }), { anteprima: true });
        // l'indirizzo completo di un ponte (hooks.zapier.com/…, il webhook di Make o n8n) vale come un segreto: solo il titolare lo vede
        const visibile = ctx?.r?.id === 'titolare' || !/^https?:\/\//i.test(r.percorso) ? q.visibile : `${new URL(q.url).origin}/…`;
        return { titolo: r.nome, righe: [['Metodo', q.metodo], ['Indirizzo', visibile], ...(q.corpoTesto ? [['Corpo', q.corpoTesto.slice(0, 1500)]] : [])], avvisi: [] };
      },
      async esegui({ riga }, k) {
        const x = await chiama(k, r, valoriDi(k, r, riga, { evento: 'azione' }));
        if (!x.ok) sbaglia('ricette-risposta', { stato: x.stato, dettaglio: r.nome }, 502);
        const url = typeof x.json?.url === 'string' && /^https:\/\//.test(x.json.url) ? x.json.url : undefined;   // un link (pagamento, documento) si mostra da copiare
        return { ok: true, stato: x.stato, ...(url ? { url } : {}) };
      },
    }])),
    // in entrata: /in/<codice>[?ricetta=<id>], firma HMAC facoltativa, idempotenza per id dell'evento o Idempotency-Key
    entrata: {
      firma: { tipo: 'verifica', segreto: 'codice', nelPercorso: true, verifica: ({ req, grezzo, segreto, nome, k }) => {
        if (!nome || !stessoSegreto(nome, segreto)) return false;
        const s = k.segreti.firma_entrata; if (!s) return true;
        const v = req.headers[String(k.imp.intestazione_firma || 'X-Signature').toLowerCase()];
        return firmaHmac(v, grezzo, s, 'hex') || firmaHmac(v, grezzo, s, 'base64');
      } },
      idempotenza: (ev, req, { k, q } = {}) => {
        const r = k && scegli(k, q); if (!r) return '';
        const x = r.idEvento ? prendi(ev, r.idEvento) : req.headers['idempotency-key'];
        return x == null || x === '' ? '' : `${r.id}:${String(x).slice(0, 200)}`;
      },
      async gestisci(ev, k, { q } = {}) {
        const r = scegli(k, q); if (!r) return 'ignorato: nessuna ricetta in entrata (aggiungi ?ricetta=<id>)';
        const voci = r.elenco ? [].concat(prendi(ev, r.elenco) ?? []) : Array.isArray(ev) ? ev : [ev];
        if (voci.length > 500) sbaglia('ricette-righe', {}, 413);
        const def = k.S.leggi(k.db, k.entita(r.sezione)), campi = def ? k.S.campiAttivi(def) : [];
        // senza abbinamenti: le chiavi del JSON che sono id o nomi di campi della sezione
        const diretti = o => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([a, b]) => [campi.find(c => c.id === a || normalizza(c.nome) === normalizza(a))?.id, b]).filter(([a]) => a));
        const conti = { creati: 0, aggiornati: 0, saltati: 0 };
        transazione(k.db, () => {
          for (const o of voci) {
            const valori = r.campi.length ? Object.fromEntries(r.campi.map(c => [c.a, prendi(o, c.da)]).filter(([, b]) => b !== undefined)) : diretti(o);
            const kv = r.chiave ? valori[r.chiave] : undefined;
            // la chiave è un valore semplice: un oggetto finirebbe nella query come parametri con nome (errore interno)
            if (kv != null && typeof kv === 'object') sbaglia('valore-non-valido', { nome: r.chiave }, 422);
            const c = r.chiave && kv != null && kv !== '' ? k.dati.trova(r.sezione, r.chiave, kv) : null;
            if (c) { if (r.modo === 'crea') { conti.saltati++; continue; } k.dati.modifica(r.sezione, c.id, valori); conti.aggiornati++; }
            else { if (r.modo === 'aggiorna') { conti.saltati++; continue; } k.dati.crea(r.sezione, valori); conti.creati++; }
          }
        });
        return `creati ${conti.creati}, aggiornati ${conti.aggiornati}${conti.saltati ? `, saltati ${conti.saltati}` : ''}`;
      },
    },
  };
}

// le etichette delle impostazioni del motore nelle altre cinque lingue (l'italiano è nel manifesto)
const L = (en, es, fr, de, pt) => ({ en, es, fr, de, pt });
const ETICHETTE = {
  'imp.base': L('API base address (e.g. https://api.example.com/v1)', 'Dirección base de la API (p. ej. https://api.ejemplo.com/v1)', 'Adresse de base de l\'API (ex. https://api.exemple.com/v1)', 'Basisadresse der API (z. B. https://api.beispiel.de/v1)', 'Endereço base da API (ex. https://api.exemplo.com/v1)'),
  'imp.accesso': L('Authentication', 'Autenticación', 'Authentification', 'Authentifizierung', 'Autenticação'),
  'imp.accesso_nome': L('Header or parameter name (e.g. X-API-Key)', 'Nombre de la cabecera o del parámetro (p. ej. X-API-Key)', 'Nom de l\'en-tête ou du paramètre (ex. X-API-Key)', 'Name des Headers oder Parameters (z. B. X-API-Key)', 'Nome do cabeçalho ou parâmetro (ex. X-API-Key)'),
  'imp.utente': L('User (Basic)', 'Usuario (Basic)', 'Utilisateur (Basic)', 'Benutzer (Basic)', 'Usuário (Basic)'),
  'imp.chiave': L('Key, token or password', 'Clave, token o contraseña', 'Clé, jeton ou mot de passe', 'Schlüssel, Token oder Passwort', 'Chave, token ou senha'),
  'imp.token_url': L('OAuth2: token address', 'OAuth2: dirección del token', 'OAuth2 : adresse du jeton', 'OAuth2: Token-Adresse', 'OAuth2: endereço do token'),
  'imp.scope': L('OAuth2: scope (optional)', 'OAuth2: scope (opcional)', 'OAuth2 : scope (facultatif)', 'OAuth2: Scope (optional)', 'OAuth2: scope (opcional)'),
  'imp.client_id': L('OAuth2: client ID', 'OAuth2: client ID', 'OAuth2 : client ID', 'OAuth2: Client-ID', 'OAuth2: client ID'),
  'imp.client_secret': L('OAuth2: client secret', 'OAuth2: client secret', 'OAuth2 : client secret', 'OAuth2: Client-Secret', 'OAuth2: client secret'),
  'imp.prova_percorso': L('Path to test the connection (e.g. /me)', 'Ruta para probar la conexión (p. ej. /me)', 'Chemin pour tester la connexion (ex. /me)', 'Pfad zum Testen der Verbindung (z. B. /me)', 'Caminho para testar a conexão (ex. /me)'),
  'imp.intestazioni': L('Extra headers (JSON, e.g. {"Accept-Language":"en"})', 'Cabeceras extra (JSON, p. ej. {"Accept-Language":"es"})', 'En-têtes en plus (JSON, ex. {"Accept-Language":"fr"})', 'Zusätzliche Header (JSON, z. B. {"Accept-Language":"de"})', 'Cabeçalhos extras (JSON, ex. {"Accept-Language":"pt"})'),
  'imp.ricette': L('Recipes', 'Recetas', 'Recettes', 'Rezepte', 'Receitas'),
  'imp.codice': L('Secret code for incoming recipes (goes at the end of the address)', 'Código secreto de las recetas de entrada (va al final de la dirección)', 'Code secret des recettes entrantes (à la fin de l\'adresse)', 'Geheimcode der eingehenden Rezepte (am Ende der Adresse)', 'Código secreto das receitas de entrada (vai no fim do endereço)'),
  'imp.firma_entrata': L('HMAC secret of incoming requests (optional)', 'Secreto HMAC de las peticiones entrantes (opcional)', 'Secret HMAC des requêtes entrantes (facultatif)', 'HMAC-Geheimnis eingehender Anfragen (optional)', 'Segredo HMAC das requisições de entrada (opcional)'),
  'imp.intestazione_firma': L('Header with the incoming HMAC signature', 'Cabecera con la firma HMAC de entrada', 'En-tête avec la signature HMAC entrante', 'Header mit der eingehenden HMAC-Signatur', 'Cabeçalho com a assinatura HMAC de entrada'),
  'imp.firma_uscita': L('Secret to sign outgoing requests (X-Lumi-Firma, optional)', 'Secreto para firmar las peticiones salientes (X-Lumi-Firma, opcional)', 'Secret pour signer les requêtes sortantes (X-Lumi-Firma, facultatif)', 'Geheimnis zum Signieren ausgehender Anfragen (X-Lumi-Firma, optional)', 'Segredo para assinar as requisições de saída (X-Lumi-Firma, opcional)'),
};
// unisce le etichette del motore ai testi del connettore (quelli del connettore vincono)
export function testiRicette(testi = {}) {
  const out = {};
  for (const l of ['en', 'es', 'fr', 'de', 'pt']) out[l] = { ...Object.fromEntries(Object.entries(ETICHETTE).map(([c, v]) => [c, v[l]])), ...(testi[l] || {}) };
  return out;
}
