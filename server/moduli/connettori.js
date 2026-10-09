// Il nucleo dei connettori: collegare un servizio a Lumi con una cartella e un manifesto (docs/CONNETTORI.md).
// Un connettore è connettori/<id>/connettore.js (quelli ufficiali, nel repository) o <dati>/connettori/<id>/connettore.js
// (quelli dell'azienda o di terzi: il titolare li attiva vedendo la somma SHA-256, e se il file cambia si fermano finché
// non li riapprova). Il connettore dichiara; il nucleo fa: segreti cifrati, impostazioni, identità di servizio con
// permessi limitati, webhook in entrata con firma, client HTTP con protezione SSRF, coda con tentativi, giri pianificati,
// mappature verso lo schema, OAuth 2, registro, strumenti di Lumi. Rotte (tutte del titolare, tranne quelle pubbliche):
//   GET  /api/connettori                     catalogo: installati e disponibili, con lo stato
//   GET  /api/connettori/catalogo            la libreria: ?q=&categoria=&costo=&difficolta=&zona= → { voci, categorie, totale }
//   GET  /api/connettori/:id                 la pagina del connettore: impostazioni, segreti (solo «c'è»), mappe, giri, registro
//   PUT  /api/connettori/:id                 { attivo?, somma?, impostazioni?, segreti?: { nome: valore | null }, interni?, mappe? }
//   POST /api/connettori/:id/prova           «prova la connessione»
//   POST /api/connettori/:id/giri/:giro      un giro pianificato subito («sincronizza ora»)
//   POST /api/connettori/:id/coda/riprova    rimette in coda le consegne fallite
//   GET  /api/connettori/azioni              le azioni dei connettori attivi che l'utente può usare (bottoni nelle schede)
//   POST /api/connettori/:id/azioni/:azione  { args, anteprima? }: con i permessi di chi la chiede
//   POST /api/connettori/:id/in[/:nome]      PUBBLICA: il webhook del servizio, con il corpo grezzo e la firma verificata
//   GET  /api/connettori/:id/pub/:nome       PUBBLICA: uscite in sola lettura del connettore (es. il feed .ics dell'agenda)
//   POST /api/connettori/:id/oauth/inizio · GET …/oauth/ritorno (pubblica) · POST …/oauth/dispositivo[/controlla]
import { readdirSync, readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { nuovoId, transazione } from '../db.js';
import { controllaUrl } from './sicurezza-rete.js';
import { client, firmaStripe, firmaHmac, stessoSegreto, leggiMultipart } from './connettori-rete.js';
import { ATTESE } from './import-api.js';
import { mezzanotte, giornoDi, piuGiorni, FUSO } from './agenda-aggregati.js';
import { TESTI, testo } from './connettori-lingue.js';
import { vistaCatalogo, testoRicerca } from './connettori-catalogo.js';
import { filtra, conta } from '../../web/libreria.js';

export const CARTELLA_UFFICIALI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'connettori');
const somma = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const ID = /^[a-z][a-z0-9-]{1,40}$/;

// legge le cartelle dei connettori: { man, file, somma, origine }. Un manifesto rotto non ferma Lumi (si segna l'errore).
// «approvata(id, somma)»: un connettore di terzi si importa (cioè il suo codice gira) solo se il titolare ha approvato
// QUELLA somma; altrimenti resta { inattesa: true } con la sola somma da mostrare, e il file non viene eseguito.
export async function carica(cartella, origine, approvata = () => true, solo = null) {
  let nomi = []; try { nomi = readdirSync(cartella).filter(n => ID.test(n) && (!solo || n === solo)).sort(); } catch { return []; }
  const out = [];
  for (const n of nomi) {
    const file = join(cartella, n, 'connettore.js');
    if (!existsSync(file) || !resolve(file).startsWith(resolve(cartella) + sep)) continue;
    try {
      const s = somma(file); if (!approvata(n, s)) { out.push({ id: n, file, somma: s, origine, inattesa: true }); continue; }
      const man = (await import(pathToFileURL(file).href + `?s=${s.slice(0, 12)}`)).default;
      if (!man || man.id !== n) { out.push({ id: n, file, somma: s, origine, rotto: 'id' }); continue; }
      out.push({ id: n, man, file, somma: s, origine });
    } catch (e) { out.push({ id: n, file, origine, rotto: String(e.message).slice(0, 200) }); }
  }
  return out;
}
const UFFICIALI = await carica(CARTELLA_UFFICIALI, 'ufficiale');

// l'origine della scrittura in corso: le chiamate a D.* sono sincrone, quindi chi ascolta (automazioni, code in uscita)
// sa che la modifica viene da «stripe» e non la rimanda indietro (anti-eco)
let origine = null;
export const origineAttuale = () => origine;
export const conOrigine = (id, f) => { const prima = origine; origine = id; try { return f(); } finally { origine = prima; } };

// ---------- tempo: «15m», «2h», «1g»; «alle: 03:00» nel fuso dell'azienda ----------
export function durata(s) { const m = /^(\d+)\s*(s|m|h|g|d)$/.exec(String(s || '').trim()); if (!m) return null; return Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, g: 864e5, d: 864e5 }[m[2]]; }
export function prossimo(def, dopo = Date.now(), fuso = FUSO) {
  if (def.ogni) return dopo + Math.max(6e4, durata(def.ogni) || 36e5);
  const [hh, mm] = String(def.alle || '03:00').split(':').map(Number), g = giornoDi(dopo, fuso);
  for (let i = 0; i < 3; i++) { const t = alleOre(piuGiorni(g, i), hh, mm, fuso); if (t > dopo) return t; }
  return dopo + 864e5;
}
// l'istante di «giorno alle hh:mm» nel fuso, anche nel giorno del cambio dell'ora (mezzanotte + ore sbaglierebbe di un'ora)
const orologi = new Map();
function alleOre(giorno, hh, mm, fuso) {
  if (!orologi.has(fuso)) orologi.set(fuso, new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const [y, m, d] = giorno.split('-').map(Number), voluto = Date.UTC(y, m - 1, d, hh, mm); let t = Date.parse(mezzanotte(giorno, fuso)) + (hh * 60 + mm) * 6e4;
  for (let i = 0; i < 2; i++) { const p = Object.fromEntries(orologi.get(fuso).formatToParts(new Date(t)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
    t += voluto - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); }
  return t;
}

export const istanze = new WeakMap();   // db → il nucleo di quel database (per i test e per gli altri moduli)

export default function registra({ r, db, S, D, P, U, meta, serve, ErroreHttp, manda, suErrore, lumi }) {
  db.exec(`CREATE TABLE IF NOT EXISTS _connettori (id TEXT PRIMARY KEY, attivo INTEGER NOT NULL DEFAULT 0, somma TEXT, versione INTEGER,
      impostazioni TEXT NOT NULL DEFAULT '{}', stato TEXT NOT NULL DEFAULT '{}', interni INTEGER NOT NULL DEFAULT 0, aggiornato TEXT);
    CREATE TABLE IF NOT EXISTS _connettori_segreti (connettore TEXT NOT NULL, nome TEXT NOT NULL, cifrato TEXT NOT NULL, aggiornato TEXT NOT NULL, PRIMARY KEY (connettore, nome));
    CREATE TABLE IF NOT EXISTS _connettori_registro (id INTEGER PRIMARY KEY AUTOINCREMENT, connettore TEXT NOT NULL, quando TEXT NOT NULL, verso TEXT NOT NULL,
      esito TEXT NOT NULL, titolo TEXT, dettagli TEXT, durata INTEGER);
    CREATE INDEX IF NOT EXISTS _connettori_registro_c ON _connettori_registro(connettore, id);
    CREATE TABLE IF NOT EXISTS _connettori_giri (connettore TEXT NOT NULL, giro TEXT NOT NULL, ultimo TEXT, prossimo INTEGER, esito TEXT, durata INTEGER, PRIMARY KEY (connettore, giro));
    CREATE TABLE IF NOT EXISTS _connettori_coda (id INTEGER PRIMARY KEY AUTOINCREMENT, connettore TEXT NOT NULL, tipo TEXT NOT NULL, chiave TEXT, corpo TEXT NOT NULL,
      stato TEXT NOT NULL DEFAULT 'attesa', tentativi INTEGER NOT NULL DEFAULT 0, prossimo INTEGER NOT NULL, errore TEXT, creato TEXT NOT NULL, aggiornato TEXT);
    CREATE INDEX IF NOT EXISTS _connettori_coda_s ON _connettori_coda(stato, prossimo);
    CREATE TABLE IF NOT EXISTS _connettori_eventi (connettore TEXT NOT NULL, chiave TEXT NOT NULL, quando TEXT NOT NULL, PRIMARY KEY (connettore, chiave));
    CREATE TABLE IF NOT EXISTS _connettori_mappa (connettore TEXT NOT NULL, entita TEXT NOT NULL, riga TEXT NOT NULL, remoto TEXT NOT NULL, impronta TEXT, aggiornato TEXT,
      PRIMARY KEY (connettore, entita, remoto));
    CREATE INDEX IF NOT EXISTS _connettori_mappa_r ON _connettori_mappa(connettore, entita, riga);
    CREATE TABLE IF NOT EXISTS _connettori_oauth (state TEXT PRIMARY KEY, connettore TEXT NOT NULL, verificatore TEXT NOT NULL, ritorno TEXT NOT NULL, scade INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS _connettori_copie (id TEXT PRIMARY KEY, base TEXT NOT NULL, nome TEXT NOT NULL, creato TEXT NOT NULL);`);

  // ---------- messaggi nelle sei lingue (server/moduli/connettori-lingue.js) ----------
  const linguaDi = (req, ctx) => { try { return (ctx?.utente && db.prepare('SELECT lingua FROM _lingue_utenti WHERE utente = ?').get(ctx.utente.id)?.lingua) || meta.leggi(db, 'lingue.azienda') || 'it'; } catch { return 'it'; } };
  const errore = (stato, chiave, p = {}) => new ErroreHttp(stato, testo('it', chiave, p), { _conn: chiave, _p: p });
  // un errore con una chiave dei messaggi dei connettori (es. ErroreRicetta) diventa un errore HTTP tradotto
  const tradotto = (e, stato = 400) => (e?.chiave && TESTI.it[e.chiave] && !(e instanceof ErroreHttp) ? errore(e.stato || stato, e.chiave, e.p) : e);
  suErrore?.((corpo, { req, ctx }) => {
    if (!corpo?._conn) return corpo;
    const { _conn, _p, ...resto } = corpo; return { ...resto, errore: testo(linguaDi(req, ctx), _conn, _p) };
  });

  // ---------- i connettori di questo database ----------
  const cartellaDati = () => { const l = db.location?.(); return l ? join(dirname(l), 'connettori') : null; };
  let tutti = new Map(UFFICIALI.map(c => [c.id, c]));
  // le copie di un connettore con «copie: true» (HTTP, webhook): un secondo servizio REST con il suo indirizzo, la sua
  // autenticazione, i suoi segreti e le sue ricette. Stesso codice, id suo («http-crm»): segreti, identità e registro sono per id.
  const copia = x => { const b = tutti.get(x.base); if (!b?.man?.copie || b.copiaDi) return null;
    const testi = Object.fromEntries(Object.entries(b.man.testi || {}).map(([l, t]) => [l, { ...t, nome: undefined }]));
    return { ...b, id: x.id, man: { ...b.man, id: x.id, nome: x.nome, testi }, copiaDi: b.id }; };
  for (const x of db.prepare('SELECT * FROM _connettori_copie ORDER BY creato').all()) { const c = copia(x); if (c && !tutti.has(x.id)) tutti.set(x.id, c); }
  const approvata = (id, s) => { try { const x = db.prepare('SELECT attivo, somma FROM _connettori WHERE id = ?').get(id); return !!x?.attivo && x.somma === s; } catch { return false; } };
  const pronti = (async () => { const c = cartellaDati(); if (!c) return; for (const x of await carica(c, 'locale', approvata)) if (!tutti.has(x.id)) tutti.set(x.id, x); })().catch(e => console.error('connettori', e));
  const riga = id => db.prepare('SELECT * FROM _connettori WHERE id = ?').get(id);
  const conn = id => { const c = tutti.get(id); if (!c || c.rotto || !c.man) throw errore(404, 'sconosciuto'); return c; };
  // attivo davvero: acceso dal titolare e, per quelli locali, con la stessa somma approvata
  const attivo = id => { const c = tutti.get(id), x = riga(id); return !!(c?.man && !c.rotto && x?.attivo && (c.origine === 'ufficiale' || x.somma === c.somma)); };
  const leggiJson = (s, d = {}) => { try { return JSON.parse(s || '') ?? d; } catch { return d; } };
  const impDi = id => leggiJson(riga(id)?.impostazioni);
  // le impostazioni con i predefiniti: quelle che vedono i pezzi del manifesto che dipendono dalla configurazione
  const impPiene = id => { const x = impDi(id); for (const i of tutti.get(id)?.man?.impostazioni || []) if (!i.segreto && x[i.id] == null && i.predefinito != null) x[i.id] = i.predefinito; return x; };
  // «azioni» e «permessi» possono essere funzioni delle impostazioni (le ricette del connettore HTTP): una funzione rotta vale «niente»
  const perImp = (id, nome) => { const v = tutti.get(id)?.man?.[nome]; if (typeof v !== 'function') return v || {}; try { return v(impPiene(id)) || {}; } catch { return {}; } };
  const azioniDi = id => perImp(id, 'azioni'), permessiDi = id => perImp(id, 'permessi');
  const scriviRiga = (id, campi) => {
    if (!riga(id)) db.prepare('INSERT INTO _connettori (id, aggiornato) VALUES (?, ?)').run(id, new Date().toISOString());
    for (const [k, v] of Object.entries(campi)) db.prepare(`UPDATE _connettori SET ${k} = ?, aggiornato = ? WHERE id = ?`).run(v, new Date().toISOString(), id);
  };

  // ---------- segreti: AES-256-GCM, chiave in <dati>/connettori-chiave (600), mai al browser né in chiaro nel backup ----------
  let chiaveMem = null;
  function chiave() {
    const l = db.location?.(); if (!l) return (chiaveMem ||= randomBytes(32));
    const f = join(dirname(l), 'connettori-chiave');
    if (!existsSync(f)) { writeFileSync(f, randomBytes(32).toString('base64'), { mode: 0o600 }); chmodSync(f, 0o600); }
    return Buffer.from(readFileSync(f, 'utf8').trim(), 'base64');
  }
  const cifra = (id, nome, v) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', chiave(), iv); c.setAAD(Buffer.from(`${id}.${nome}`));
    const x = Buffer.concat([c.update(String(v), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), x]).toString('base64'); };
  const decifra = (id, nome, s) => { try { const b = Buffer.from(s, 'base64'), d = createDecipheriv('aes-256-gcm', chiave(), b.subarray(0, 12)); d.setAAD(Buffer.from(`${id}.${nome}`));
    d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } catch { return null; } };
  const segreto = (id, nome) => { const x = db.prepare('SELECT cifrato FROM _connettori_segreti WHERE connettore = ? AND nome = ?').get(id, nome); return x ? decifra(id, nome, x.cifrato) : null; };
  const salvaSegreto = (id, nome, v) => v == null || v === '' ? db.prepare('DELETE FROM _connettori_segreti WHERE connettore = ? AND nome = ?').run(id, nome)
    : db.prepare('INSERT INTO _connettori_segreti (connettore, nome, cifrato, aggiornato) VALUES (?, ?, ?, ?) ON CONFLICT(connettore, nome) DO UPDATE SET cifrato = excluded.cifrato, aggiornato = excluded.aggiornato')
      .run(id, nome, cifra(id, nome, v), new Date().toISOString());
  const segretiSalvati = id => new Set(db.prepare('SELECT nome FROM _connettori_segreti WHERE connettore = ?').all(id).map(x => x.nome));
  // i codici «generato» che un connettore già acceso non ha ancora (una versione nuova ne ha aggiunto uno, come la verifica
  // di Meta Lead Ads): si creano all'avvio, senza chiedere di spegnerlo e riaccenderlo
  const generaMancanti = id => { for (const i of tutti.get(id)?.man?.impostazioni || []) if (i.generato && !segreto(id, i.id)) salvaSegreto(id, i.id, randomBytes(24).toString('base64url')); };
  pronti.then(() => { for (const id of tutti.keys()) { try { if (attivo(id)) generaMancanti(id); } catch (e) { console.error('connettori codici', id, e.message); } } });

  // ---------- registro (90 giorni) ----------
  let pulito = 0;
  function annota(id, verso, esito, titolo, dettagli = null, ms = null) {
    db.prepare('INSERT INTO _connettori_registro (connettore, quando, verso, esito, titolo, dettagli, durata) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, new Date().toISOString(), verso, esito, String(titolo ?? '').slice(0, 300), dettagli == null ? null : String(typeof dettagli === 'string' ? dettagli : JSON.stringify(dettagli)).slice(0, 2000), ms);
    if (Date.now() - pulito > 36e5) { pulito = Date.now(); db.prepare('DELETE FROM _connettori_registro WHERE quando < ?').run(new Date(Date.now() - 90 * 864e5).toISOString()); }
  }

  // ---------- identità di servizio: «servizio:<id>», un utente spento (non entra mai) con il ruolo dichiarato in «permessi» ----------
  function ctxServizio(id) {
    const { man } = conn(id), uid = `servizio:${id}`;
    if (!db.prepare('SELECT 1 FROM _utenti WHERE id = ?').get(uid))
      db.prepare("INSERT INTO _utenti (id, nome, email, hash, ruolo, attivo, creato) VALUES (?, ?, ?, '!', ?, 0, ?)").run(uid, man.nome, `${id}@connettori.lumi.invalid`, uid, new Date().toISOString());
    const entita = {};
    for (const [sem, p] of Object.entries(permessiDi(id))) {
      const e = entitaDi(id, sem), regola = { leggi: !!p.leggi, crea: !!p.crea, modifica: !!p.modifica, elimina: !!p.elimina }; entita[e] = regola;
      // le righe figlie (righe di una vendita) seguono il padre: chi crea una vendita crea anche le sue righe
      for (const c of S.leggi(db, e)?.campi || []) if (c.tipo === 'righe' && !c.archiviato) entita[c.entita] = { ...regola, modifica: regola.modifica || regola.crea };
    }
    return { utente: { id: uid, nome: man.nome, ruolo: uid }, r: { id: uid, nome: man.nome, schema: false, utenti: false, entita: { '*': {}, ...entita } }, servizio: id };
  }

  // ---------- mappe: i nomi del connettore («articoli.giacenza») verso gli id dello schema, che non cambiano con le rinomine ----------
  const mappeSalvate = id => impDi(id)._mappe || {};
  function entitaDi(id, sem) {
    const m = mappeSalvate(id).entita?.[sem]; if (m && S.leggi(db, m) && !S.leggi(db, m).archiviata) return m;
    const d = S.leggi(db, sem); if (d && !d.archiviata) return sem;
    const pernome = S.elenco(db).find(e => e.nome.toLowerCase() === sem.toLowerCase()); return pernome?.id || sem;
  }
  function propostaCampo(def, sem, req = {}) {
    const attivi = S.campiAttivi(def), ok = c => !req.tipo || [].concat(req.tipo).includes(c.tipo);
    return (attivi.find(c => c.id === sem && ok(c)) || attivi.find(c => c.nome.toLowerCase() === sem.toLowerCase() && ok(c))
      || attivi.find(c => (req.alias || []).includes(c.id) && ok(c)))?.id || null;
  }
  function campoDi(id, sem, campo) {
    const e = entitaDi(id, sem), def = S.leggi(db, e); if (!def) return null;
    const m = mappeSalvate(id).campi?.[`${sem}.${campo}`];
    if (m && S.campiAttivi(def).some(c => c.id === m)) return m;
    return propostaCampo(def, campo, conn(id).man.richiede?.[sem]?.[campo]);
  }
  // lo stato delle mappe per la pagina: per ogni campo richiesto, quello scelto e quelli possibili; «mancante» se non c'è
  function statoMappe(id) {
    const { man } = conn(id), out = [];
    for (const [sem, campi] of Object.entries(man.richiede || {})) {
      const e = entitaDi(id, sem), def = S.leggi(db, e);
      out.push({ sem, entita: def ? e : null, nome: def?.nome || sem, campi: Object.entries(campi).map(([c, req]) => ({ sem: c, campo: def ? campoDi(id, sem, c) : null, tipo: req.tipo || null, facoltativo: !!req.facoltativo,
        possibili: def ? S.campiAttivi(def).filter(x => !req.tipo || [].concat(req.tipo).includes(x.tipo)).map(x => ({ id: x.id, nome: x.nome })) : [] })) });
    }
    return out;
  }
  // una sezione con tutti i campi facoltativi è facoltativa anche lei (le fatture per Stripe: ci sono solo con il modello «fatture»)
  const mancanti = id => statoMappe(id).flatMap(m => !m.entita ? (m.campi.every(c => c.facoltativo) ? [] : [m.sem]) : m.campi.filter(c => !c.campo && !c.facoltativo).map(c => `${m.sem}.${c.sem}`));
  const prendi = (o, via) => String(via).split('.').reduce((x, k) => x?.[k], o);

  // ---------- l'indirizzo pubblico di Lumi (uno per tutti): impostazione del titolare, o LUMI_PUBBLICO ----------
  const PUBBLICO = /^https?:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i;
  const pubblico = () => { const v = String(meta.leggi(db, 'connettori.pubblico') || process.env.LUMI_PUBBLICO || '').trim().replace(/\/+$/, ''); return PUBBLICO.test(v) ? v : ''; };

  // ---------- il k di un connettore ----------
  const kCache = new Map();
  function kDi(id) {
    const { man } = conn(id), ctx = ctxServizio(id), dati = {};
    const vero = sem => entitaDi(id, sem);
    // i valori del connettore («giacenza») diventano quelli dello schema (l'id del campo scelto nelle mappe)
    const traduci = (sem, valori) => Object.fromEntries(Object.entries(valori || {}).map(([k, v]) => [campoDi(id, sem, k) || k, v]));
    dati.leggi = (sem, rid) => conOrigine(id, () => D.leggi(db, vero(sem), rid, ctx));
    dati.elenca = (sem, opz = {}) => conOrigine(id, () => D.elenca(db, vero(sem), { ...opz, filtri: (opz.filtri || []).map(f => ({ ...f, campo: campoDi(id, sem, f.campo) || f.campo })) }, ctx));
    dati.crea = (sem, v) => conOrigine(id, () => D.crea(db, vero(sem), traduci(sem, v), ctx));
    dati.modifica = (sem, rid, v) => conOrigine(id, () => D.modifica(db, vero(sem), rid, traduci(sem, v), ctx));
    dati.trova = (sem, campo, valore) => dati.elenca(sem, { filtri: [{ campo, op: '=', valore }], perPagina: 1 }).righe[0] || null;
    // un valore della riga letto con il nome del connettore: k.valore(riga, 'vendite', 'totale')
    const valore = (r, sem, campo) => r?.[campoDi(id, sem, campo) || campo];
    const k = {
      id, man, db, S, D, P, meta, ctx, dati, valore, fuso: () => FUSO,
      get imp() { return impPiene(id); },
      get segreti() { return Object.fromEntries((man.impostazioni || []).filter(i => i.segreto).map(i => [i.id, segreto(id, i.id)])); },
      get base() { return impDi(id)._base || man.base || ''; },
      // l'indirizzo pubblico di Lumi («https://lumi.bottega.it», senza barra finale) o '' se il titolare non l'ha dato
      get pubblico() { return pubblico(); },
      interni: () => process.env.LUMI_CONNETTORI_INTERNI === '1' || !!riga(id)?.interni,
      http: client({ interni: () => process.env.LUMI_CONNETTORI_INTERNI === '1' || !!riga(id)?.interni }),
      campo: (sem, c) => campoDi(id, sem, c), entita: vero,
      annota: (verso, esito, titolo, dett) => annota(id, verso, esito, titolo, dett),
      avvisa: t => { annota(id, 'sistema', 'avviso', t); manda?.({ tipo: 'avviso', testo: `${man.nome}: ${t}` }); return t; },
      stato: { leggi: c => leggiJson(riga(id)?.stato)[c], scrivi: (c, v) => { const s = leggiJson(riga(id)?.stato); s[c] = v; scriviRiga(id, { stato: JSON.stringify(s) }); } },
      salvaSegreto: (nome, v) => salvaSegreto(id, nome, v),
      accoda: (tipo, chiaveC, corpo, opz) => accoda(id, tipo, chiaveC, corpo, opz),
      euro: n => `${Number(n || 0).toFixed(2).replace('.', ',')} €`,
      oauth: { token: () => tokenOAuth(id), collegato: () => !!tokenSalvato(id)?.access_token, extra: () => ({ ...(tokenSalvato(id)?.extra || {}) }) },
      sincro: {
        // gli oggetti del servizio entrano in Lumi: abbinati per id remoto o per la chiave, solo i campi con comanda ≠ 'locale'
        async daRemoto(nome, oggetti) {
          const mp = man.mappe[nome], sem = mp.entita || nome, e = vero(sem), conti = { creati: 0, aggiornati: 0, uguali: 0 };
          for (const o of [].concat(oggetti || [])) {
            const rid = String(prendi(o, mp.id || 'id')), noto = db.prepare('SELECT riga, impronta FROM _connettori_mappa WHERE connettore = ? AND entita = ? AND remoto = ?').get(id, e, rid);
            let rigaId = noto?.riga && db.prepare(`SELECT id FROM ${S.tabella(e)} WHERE id = ? AND archiviato = 0`).get(noto.riga) ? noto.riga : null;
            if (!rigaId && mp.chiave) { const v = prendi(o, mp.chiave[1]); if (v != null && v !== '') rigaId = dati.trova(sem, mp.chiave[0], String(v))?.id || null; }
            const valori = {};
            for (const c of mp.campi) { if (rigaId && c.comanda === 'locale') continue; const v = prendi(o, c.remoto); if (v !== undefined) valori[c.locale] = c.da ? c.da(v) : v; }
            if (!rigaId && mp.chiave) valori[mp.chiave[0]] ??= prendi(o, mp.chiave[1]);
            // l'impronta guarda solo i campi che comanda il servizio: così un giro senza novità non riscrive niente
            const impronta = createHash('sha256').update(JSON.stringify(mp.campi.filter(c => c.comanda !== 'locale').map(c => prendi(o, c.remoto)))).digest('hex').slice(0, 32);
            if (rigaId && noto?.impronta === impronta) { conti.uguali++; continue; }
            if (rigaId) { dati.modifica(sem, rigaId, valori); conti.aggiornati++; } else { rigaId = dati.crea(sem, valori).id; conti.creati++; }
            db.prepare('INSERT INTO _connettori_mappa (connettore, entita, riga, remoto, impronta, aggiornato) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(connettore, entita, remoto) DO UPDATE SET riga = excluded.riga, impronta = excluded.impronta, aggiornato = excluded.aggiornato')
              .run(id, e, rigaId, rid, impronta, new Date().toISOString());
          }
          return conti;
        },
        remoto: (sem, rigaId) => db.prepare('SELECT remoto FROM _connettori_mappa WHERE connettore = ? AND entita = ? AND riga = ?').get(id, vero(sem), String(rigaId))?.remoto ?? null,
        locale: (sem, remoto) => db.prepare('SELECT riga FROM _connettori_mappa WHERE connettore = ? AND entita = ? AND remoto = ?').get(id, vero(sem), String(remoto))?.riga ?? null,
        collega: (sem, rigaId, remoto) => db.prepare('INSERT INTO _connettori_mappa (connettore, entita, riga, remoto, aggiornato) VALUES (?, ?, ?, ?, ?) ON CONFLICT(connettore, entita, remoto) DO UPDATE SET riga = excluded.riga')
          .run(id, vero(sem), String(rigaId), String(remoto), new Date().toISOString()),
        // dimentica il legame (una riga tolta di qua o di là): { riga } o { remoto }, o tutta la sezione con {}. → quanti
        scollega: (sem, { riga: r = null, remoto = null } = {}) => db.prepare(`DELETE FROM _connettori_mappa WHERE connettore = ? AND entita = ?${r != null ? ' AND riga = ?' : ''}${remoto != null ? ' AND remoto = ?' : ''}`)
          .run(id, vero(sem), ...(r != null ? [String(r)] : []), ...(remoto != null ? [String(remoto)] : [])).changes,
      },
    };
    return k;
  }
  const kPer = id => { if (!kCache.has(id)) kCache.set(id, kDi(id)); return kCache.get(id); };

  // ---------- coda comune: tentativi crescenti (ATTESE di import-api.js), «unisci: 'ultimo'» tiene solo l'ultimo valore ----------
  function accoda(id, tipo, chiaveC, corpo, { unisci = null, fra = 0 } = {}) {
    const ora = Date.now(), c = JSON.stringify(corpo ?? {});
    if (unisci === 'ultimo' && chiaveC != null) {
      // non quello che sta partendo adesso: ha già letto la riga, e il valore nuovo andrebbe perso (si mette in fila dopo)
      const x = db.prepare("SELECT id FROM _connettori_coda WHERE connettore = ? AND tipo = ? AND chiave = ? AND stato = 'attesa' ORDER BY id").all(id, tipo, String(chiaveC)).find(r => !inVolo.has(r.id));
      if (x) { db.prepare('UPDATE _connettori_coda SET corpo = ?, aggiornato = ? WHERE id = ?').run(c, new Date().toISOString(), x.id); return x.id; }
    }
    const n = db.prepare('INSERT INTO _connettori_coda (connettore, tipo, chiave, corpo, prossimo, creato) VALUES (?, ?, ?, ?, ?, ?)').run(id, tipo, chiaveC == null ? null : String(chiaveC), c, ora + fra, new Date().toISOString()).lastInsertRowid;
    setImmediate(() => lavora().catch(e => console.error('connettori coda', e)));   // dopo la transazione di chi accoda
    return n;
  }
  // un giro della coda alla volta; chi chiede mentre gira (un accoda, il battito, un test) aspetta lo stesso giro, che
  // ricomincia una volta in più per prendere quello che è arrivato nel frattempo
  const inVolo = new Set();
  let corsa = null, ancora = false;
  function lavora() {
    if (corsa) { ancora = true; return corsa; }
    corsa = (async () => { let n = 0; try { do { ancora = false; n += await giroCoda(); } while (ancora); } finally { corsa = null; } return n; })();
    return corsa;
  }
  async function giroCoda() {
    let n = 0;
    for (const x of db.prepare("SELECT * FROM _connettori_coda WHERE stato = 'attesa' AND prossimo <= ? ORDER BY id LIMIT 50").all(Date.now())) {
      if (!attivo(x.connettore)) continue;
      const k = kPer(x.connettore), t0 = Date.now(); n++; inVolo.add(x.id);
      try {
        const [gen, nome] = x.tipo.split(':'), corpo = leggiJson(x.corpo);
        if (gen === 'uscita') { const u = k.man.uscita[nome]; let r = null; try { r = k.dati.leggi(nome, corpo.id); } catch { r = null; } if (r) await u.invia(r, k); }
        else await k.man.lavori[x.tipo](corpo, k);
        db.prepare("UPDATE _connettori_coda SET stato = 'fatto', tentativi = tentativi + 1, errore = NULL, aggiornato = ? WHERE id = ?").run(new Date().toISOString(), x.id);
        annota(x.connettore, 'uscita', 'ok', x.tipo, x.chiave, Date.now() - t0);
      } catch (e) {
        const t = x.tentativi + 1, fine = t > ATTESE.length;
        db.prepare('UPDATE _connettori_coda SET stato = ?, tentativi = ?, prossimo = ?, errore = ?, aggiornato = ? WHERE id = ?')
          .run(fine ? 'fallito' : 'attesa', t, Date.now() + (ATTESE[t - 1] || 0) * 1000, String(e.message).slice(0, 500), new Date().toISOString(), x.id);
        annota(x.connettore, 'uscita', fine ? 'errore' : 'avviso', x.tipo, String(e.message).slice(0, 500), Date.now() - t0);
      } finally { inVolo.delete(x.id); }
    }
    return n;
  }
  // le modifiche ai campi dichiarati in «uscita» vanno in coda, ma non quelle che arrivano dal connettore stesso
  D.ascolta((ev, dbEv) => {
    if (dbEv !== db || !['crea', 'modifica', 'elimina', 'ripristina'].includes(ev.tipo)) return;
    for (const [id, c] of tutti) {
      if (c.rotto || (!c.man?.uscita && typeof c.man?.eventi !== 'function') || origine === id || !attivo(id)) continue;   // chi non ascolta non costa una query
      // «eventi(ev, k)»: ogni crea/modifica/elimina/ripristina che non viene dal connettore stesso (le ricette in uscita)
      if (typeof c.man.eventi === 'function') { try { c.man.eventi(ev, kPer(id)); } catch (e) { annota(id, 'uscita', 'errore', 'eventi', String(e.message).slice(0, 300)); } }
      if (!c.man.uscita || !['crea', 'modifica'].includes(ev.tipo)) continue;
      for (const [sem, u] of Object.entries(c.man.uscita)) {
        if (entitaDi(id, sem) !== ev.entita) continue;
        const campi = (u.campi || []).map(x => campoDi(id, sem, x)).filter(Boolean);
        if (ev.tipo === 'modifica' && campi.length && !campi.some(f => JSON.stringify(ev.prima?.[f]) !== JSON.stringify(ev.dopo?.[f]))) continue;
        if (u.quando && !u.quando(ev.dopo, kPer(id))) continue;
        accoda(id, `uscita:${sem}`, ev.id, { id: ev.id }, { unisci: u.unisci || 'ultimo' });
      }
    }
  });

  // ---------- giri pianificati: un solo timer, un lucchetto per giro, recupero (uno solo) dopo uno spegnimento ----------
  const inCorso = new Set();
  async function gira(id, nome, { forza = false, adesso = Date.now() } = {}) {
    const def = conn(id).man.pianificati?.[nome]; if (!def) throw errore(404, 'giro-sconosciuto');
    const chiaveG = `${id}/${nome}`; if (inCorso.has(chiaveG)) return { esito: 'in-corso' };
    if (!forza && !attivo(id)) return { esito: 'spento' };
    inCorso.add(chiaveG); const t0 = Date.now(); let esito = 'ok', ris = null;
    try { ris = await def.giro(kPer(id)); annota(id, 'giro', 'ok', nome, ris, Date.now() - t0); }
    catch (e) { esito = 'errore'; ris = String(e.message).slice(0, 500); annota(id, 'giro', 'errore', nome, ris, Date.now() - t0); }
    finally {
      inCorso.delete(chiaveG);
      db.prepare('INSERT INTO _connettori_giri (connettore, giro, ultimo, prossimo, esito, durata) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(connettore, giro) DO UPDATE SET ultimo = excluded.ultimo, prossimo = excluded.prossimo, esito = excluded.esito, durata = excluded.durata')
        .run(id, nome, new Date().toISOString(), prossimo(def, Math.max(Date.now(), adesso)), esito, Date.now() - t0);
    }
    return { esito, risultato: ris };
  }
  async function pianificatore(adesso = Date.now()) {
    for (const [id, c] of tutti) {
      if (c.rotto || !c.man?.pianificati || !attivo(id)) continue;
      for (const [nome, def] of Object.entries(c.man.pianificati)) {
        const x = db.prepare('SELECT prossimo FROM _connettori_giri WHERE connettore = ? AND giro = ?').get(id, nome);
        if (!x) { db.prepare('INSERT INTO _connettori_giri (connettore, giro, prossimo) VALUES (?, ?, ?)').run(id, nome, def.ogni ? adesso : prossimo(def, adesso)); if (!def.ogni) continue; }
        if ((x?.prossimo ?? adesso) <= adesso) await gira(id, nome, { adesso });   // anche un giro perso a computer spento: uno solo, poi si riparte da adesso
      }
    }
  }
  // una volta al giorno: via le consegne finite da più di 30 giorni e gli eventi visti da più di 90 (l'idempotenza non serve oltre)
  let potato = 0;
  function pota(adesso = Date.now()) {
    potato = adesso; const g = n => new Date(adesso - n * 864e5).toISOString();
    return { coda: db.prepare("DELETE FROM _connettori_coda WHERE stato = 'fatto' AND COALESCE(aggiornato, creato) < ?").run(g(30)).changes,
      eventi: db.prepare('DELETE FROM _connettori_eventi WHERE quando < ?').run(g(90)).changes };
  }
  const battito = setInterval(() => {
    if (Date.now() - potato > 864e5) { try { pota(); } catch (e) { console.error('connettori pota', e); } }
    pianificatore().then(lavora).catch(e => console.error('connettori', e));
  }, 30000); battito.unref?.();

  // ---------- OAuth 2: codice con PKCE, device code, client credentials; rinnovo dei token ----------
  // Opzioni del manifesto: basic (client_secret_basic), corpo: 'json' (token e device in JSON), pkce: false, redirect(k)
  // (un redirect_uri su misura, es. il RuName di eBay), conserva: ['realmId', …] (valori del ritorno o del token, in k.oauth.extra())
  const urlDi = (v, k) => (typeof v === 'function' ? v(k) : v);
  const sicuroHttps = u => (/^https:\/\/[^\s"<>]+$/i.test(String(u || '')) ? String(u).slice(0, 500) : null);
  const tokenSalvato = id => leggiJson(segreto(id, '_oauth'), null);
  const pulisci = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));
  function postaOAuth(id, url, campi, { conClient = false } = {}) {
    const { man } = conn(id), k = kPer(id), o = man.oauth, s = k.segreti, cid = s[o.client || 'client_id'], sec = s[o.segreto || 'client_secret'];
    const corpo = pulisci({ ...(o.basic && !conClient ? {} : { client_id: cid }), ...(o.basic || conClient ? {} : { client_secret: sec }), ...campi });
    return k.http.post(url, { ...(o.corpo === 'json' ? { json: corpo } : { form: corpo }), ...(o.basic && !conClient ? { basic: [cid || '', sec || ''] } : {}) });
  }
  const conservati = (o, fonte) => Object.fromEntries([].concat(o.conserva || []).map(c => [c, fonte(c)]).filter(([, v]) => v != null && v !== '').map(([c, v]) => [c, String(v).slice(0, 500)]));
  async function chiediToken(id, form) {
    const { man } = conn(id), k = kPer(id), o = man.oauth;
    const r = await postaOAuth(id, urlDi(o.token, k), form), j = r.json?.access_token ? r.json : r.json?.data?.access_token ? r.json.data : r.json;
    if (!r.ok || !j?.access_token) throw Object.assign(errore(502, 'oauth-rifiutato', { stato: r.stato }), { risposta: r.json });
    const vecchio = tokenSalvato(id) || {}, extra = { ...(vecchio.extra || {}), ...conservati(o, c => j[c]) };
    const t = { access_token: j.access_token, refresh_token: j.refresh_token || vecchio.refresh_token || null,
      scade: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : null, scope: j.scope || null, ...(Object.keys(extra).length ? { extra } : {}) };
    salvaSegreto(id, '_oauth', JSON.stringify(t)); kCache.delete(id); return t;
  }
  const rinnovi = new Map();
  async function tokenOAuth(id) {
    const o = conn(id).man.oauth; if (!o) return null;
    let t = tokenSalvato(id);
    if (t?.access_token && (!t.scade || t.scade - Date.now() > 60000)) return t.access_token;
    if (!rinnovi.has(id)) rinnovi.set(id, (async () => {
      if (o.tipo === 'client') return chiediToken(id, { grant_type: 'client_credentials', scope: urlDi(o.scope, kPer(id)) || undefined });
      if (t?.refresh_token) return chiediToken(id, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
      throw errore(409, 'oauth-scollegato');
    })().finally(() => rinnovi.delete(id)));
    t = await rinnovi.get(id); annota(id, 'oauth', 'ok', 'token');
    return t.access_token;
  }

  // ---------- strumenti di Lumi (contratto k.lumi.strumento, se c'è) ----------
  // le azioni che cambiano con le impostazioni (le ricette) si registrano di nuovo a ogni salvataggio: il permesso guarda
  // l'azione com'è adesso, e una ricetta tolta non si usa più
  // Il nome di uno strumento dipende solo dalla coppia (connettore, azione): «connettore_<id>_<azione>», con il «-» dell'id
  // scritto «__» (così la copia «http-crm» + «link» non diventa «http» + «crm_link»). Se l'azione ha caratteri da cambiare,
  // comincia con «_» o il nome passa 64 caratteri, il nome si accorcia e prende 8 cifre dell'impronta della coppia.
  const nomiLumi = new Map();
  function nomeLumi(id, azione) {
    const coppia = `${id}\0${azione}`, pulita = String(azione).replace(/[^a-zA-Z0-9_]/g, '_'), base = `connettore_${id.replace(/-/g, '__')}_${pulita}`;
    const impronta = n => createHash('sha256').update(coppia).digest('hex').slice(0, n);
    let nome = base.length <= 64 && pulita === String(azione) && !pulita.startsWith('_') ? base : `${base.slice(0, 55)}_${impronta(8)}`;
    if (nomiLumi.has(nome) && nomiLumi.get(nome) !== coppia) nome = `${base.slice(0, 47)}_${impronta(16)}`;   // non succede: ma mai sopra un altro
    nomiLumi.set(nome, coppia); return nome;
  }
  function registraLumi(id) {
    const c = tutti.get(id); if (!c?.man || c.rotto) return;
    for (const [nome, a] of Object.entries(azioniDi(id))) {
      if (!a.lumi) continue;
      const ora = () => azioniDi(id)[nome];
      try {
        lumi?.strumento?.({ nome: nomeLumi(id, nome), descrizione: `${c.man.nome}: ${a.descrizione || a.nome}`, schema: schemaArgs(a), tipo: a.scrive ? 'scrivi' : 'leggi',
          permesso: ctx => { const x = ora(); return !!x && attivo(id) && (x.su ? P.puo(ctx, entitaDi(id, x.su), x.scrive ? 'modifica' : 'leggi') : ctx?.r?.id === 'titolare'); },
          esegui: ({ ctx, args }) => azione(id, nome, args, ctx), anteprima: ({ ctx, args }) => azione(id, nome, args, ctx, { anteprima: true }) });
      } catch (e) { console.error('connettori lumi', id, nome, e.message); }
    }
  }
  for (const id of tutti.keys()) registraLumi(id);
  function schemaArgs(a) {
    return { type: 'object', properties: Object.fromEntries(Object.entries(a.input || {}).map(([k, x]) => [k, { type: x.tipo === 'numero' ? 'number' : 'string', description: x.nome || k }])),
      required: Object.entries(a.input || {}).filter(([, x]) => !x.facoltativo).map(([k]) => k) };
  }
  // un'azione chiesta da una persona (o da Lumi per lei): le righe si leggono con i SUOI permessi, il servizio fa il resto
  async function azione(id, nome, args = {}, ctx, { anteprima = false } = {}) {
    if (!attivo(id)) throw errore(404, 'spento');
    const a = azioniDi(id)[nome]; if (!a) throw errore(404, 'azione-sconosciuta');
    if (a.su && !P.puo(ctx, entitaDi(id, a.su), a.scrive ? 'modifica' : 'leggi')) throw new P.ErrorePermesso();
    if (!a.su && ctx?.r?.id !== 'titolare') throw new P.ErrorePermesso();   // un'azione che non dichiara la sezione: solo il titolare
    const k = kPer(id), x = {};
    for (const [n, def] of Object.entries(a.input || {})) {
      const v = args[n]; if (def.facoltativo && (v == null || v === '')) { x[n] = undefined; continue; }
      x[n] = def.tipo === 'relazione' ? D.leggi(db, entitaDi(id, def.entita), String(v?.id ?? v ?? ''), ctx) : v;
    }
    if (anteprima) return a.proponi ? a.proponi(x, k, { ctx }) : { titolo: a.nome, righe: [], avvisi: [] };
    const t0 = Date.now();
    try { const r = await a.esegui(x, k, { ctx }); annota(id, 'azione', 'ok', nome, { chi: ctx?.utente?.nome }, Date.now() - t0); return r; }
    catch (e) {
      annota(id, 'azione', 'errore', nome, String(e.message).slice(0, 500), Date.now() - t0);
      // l'errore di un servizio (o del connettore) arriva a chi ha chiesto, non come «errore interno»
      if (e instanceof ErroreHttp || e instanceof P.ErrorePermesso || e instanceof D.ErroreDati) throw e;
      if (tradotto(e) !== e) throw tradotto(e, 502);
      throw errore(502, 'servizio', { dettaglio: String(e.message).slice(0, 300) });
    }
  }

  // ---------- la vista di un connettore per la pagina (nella lingua di chi guarda) ----------
  const tr = (man, l, c, d) => man.testi?.[l]?.[c] ?? d;
  function scheda(id, l, completa = false) {
    const c = tutti.get(id), x = riga(id);
    if (!c || c.rotto) return { id, rotto: c?.rotto || true, origine: c?.origine, somma: c?.somma };
    // un connettore di terzi non ancora approvato (o cambiato dopo): solo la somma, il suo codice non è stato eseguito
    if (c.inattesa) return { id, nome: id, descrizione: '', origine: c.origine, somma: c.somma, attivo: false, acceso: !!x?.attivo, cambiato: !!x?.attivo, daApprovare: true, mancano: [], permessi: [] };
    const { man } = c, salvati = segretiSalvati(id), imp = impDi(id), tok = tokenSalvato(id);
    const base = { id, nome: tr(man, l, 'nome', man.nome), descrizione: tr(man, l, 'descrizione', man.descrizione), icona: man.icona || 'cartella', versione: man.versione || 1, origine: c.origine,
      somma: c.somma, attivo: attivo(id), acceso: !!x?.attivo, cambiato: c.origine === 'locale' && !!x?.attivo && x.somma !== c.somma, catalogo: vistaCatalogo(man, l, completa),
      ...(c.copiaDi ? { copiaDi: c.copiaDi } : {}), ...(man.copie && !c.copiaDi ? { copie: true } : {}),
      mancano: [...(man.impostazioni || []).filter(i => i.obbligatorio !== false && i.segreto && !i.generato && !salvati.has(i.id)).map(i => tr(man, l, `imp.${i.id}`, i.nome)), ...mancanti(id)] };
    if (!completa) return base;
    return { ...base, interni: !!x?.interni,
      permessi: Object.entries(permessiDi(id)).map(([sem, p]) => ({ entita: sem === '*' ? '*' : S.leggi(db, entitaDi(id, sem))?.nome || sem, ...(sem === '*' ? { tutte: true } : {}), ...p })),
      impostazioni: (man.impostazioni || []).map(i => ({ id: i.id, nome: tr(man, l, `imp.${i.id}`, i.nome), aiuto: tr(man, l, `aiuto.${i.id}`, i.aiuto) || null, tipo: i.tipo || 'testo', segreto: !!i.segreto,
        opzioni: i.opzioni || null, ...(i.tipo === 'ricette' ? { assoluti: !!i.assoluti } : {}), ...(i.segreto ? { salvato: salvati.has(i.id), ...(i.generato ? { valore: segreto(id, i.id), generato: true } : {}) } : { valore: imp[i.id] ?? i.predefinito ?? null }) })),
      // «nelPercorso»: il codice generato va in fondo all'indirizzo anche con una verifica su misura (le ricette in entrata)
      pubblico: pubblico() || null,
      webhook: man.entrata ? { percorso: `/api/connettori/${id}/in`, url: pubblico() ? `${pubblico()}/api/connettori/${id}/in` : null, firma: man.entrata.firma?.tipo || 'nessuna', nelPercorso: man.entrata.firma?.tipo === 'token' || !!man.entrata.firma?.nelPercorso, verificaGet: typeof man.entrata.verificaGet === 'function' } : null,
      oauth: man.oauth && (typeof man.oauth.usato !== 'function' || man.oauth.usato(impPiene(id))) ? { tipo: man.oauth.tipo || 'codice', dispositivo: !!man.oauth.dispositivo, collegato: !!tok?.access_token, scade: tok?.scade || null, rinnovo: !!tok?.refresh_token,
        ritorno: `/api/connettori/${id}/oauth/ritorno` } : null,
      pubbliche: Object.keys(man.pubbliche || {}),
      giri: Object.entries(man.pianificati || {}).map(([g, d]) => ({ id: g, nome: tr(man, l, `giro.${g}`, d.nome || g), ogni: d.ogni || null, alle: d.alle || null,
        ...(db.prepare('SELECT ultimo, prossimo, esito, durata FROM _connettori_giri WHERE connettore = ? AND giro = ?').get(id, g) || {}) })),
      azioni: Object.entries(azioniDi(id)).map(([a, d]) => ({ id: a, nome: tr(man, l, `az.${a}`, d.nome), su: d.su ? entitaDi(id, d.su) : null, scrive: !!d.scrive, lumi: !!d.lumi })),
      mappe: statoMappe(id),
      coda: Object.fromEntries(db.prepare("SELECT stato, COUNT(*) n FROM _connettori_coda WHERE connettore = ? AND stato <> 'fatto' GROUP BY stato").all(id).map(z => [z.stato, z.n])),
      registro: db.prepare('SELECT quando, verso, esito, titolo, dettagli, durata FROM _connettori_registro WHERE connettore = ? ORDER BY id DESC LIMIT 60').all(id) };
  }

  // ---------- rotte di gestione: solo il titolare, solo dall'interfaccia (non con un token) ----------
  const titolare = ctx => { if (serve(ctx).r.id !== 'titolare' || ctx.viaToken) throw errore(403, 'solo-titolare'); return ctx; };
  r('GET', '/api/connettori', async ({ ctx, req }) => { titolare(ctx); await pronti; return [...tutti.keys()].sort().map(id => scheda(id, linguaDi(req, ctx))); });
  // la libreria: tutto il catalogo in una risposta (le carte non chiedono altro), con i filtri e i conti per categoria.
  // I conti guardano gli altri filtri ma non la categoria, così i bottoni dicono quante voci troveresti scegliendola.
  // Il titolare la sfoglia anche con un token (sola lettura: accendere e configurare restano dall'interfaccia).
  r('GET', '/api/connettori/catalogo', async ({ ctx, req, q }) => {
    if (serve(ctx).r.id !== 'titolare') throw errore(403, 'solo-titolare'); await pronti;
    const l = linguaDi(req, ctx), f = Object.fromEntries(['q', 'categoria', 'costo', 'difficolta', 'zona'].map(x => [x, String(q.get(x) || '').slice(0, 200)]));
    const voci = [...tutti.keys()].map(id => ({ ...scheda(id, l), cerca: testoRicerca(tutti.get(id)?.man, id, l) })).sort((a, b) => String(a.nome || a.id).localeCompare(String(b.nome || b.id), l));
    const senzaCategoria = filtra(voci, { ...f, categoria: '' });
    return { voci: filtra(senzaCategoria, { categoria: f.categoria }), categorie: conta(senzaCategoria), totale: voci.length };
  });
  r('GET', '/api/connettori/azioni', async ({ ctx, req }) => {
    serve(ctx); await pronti; const l = linguaDi(req, ctx), out = [];
    for (const [id, c] of tutti) if (attivo(id)) for (const [a, d] of Object.entries(azioniDi(id)))
      if (d.su && P.puo(ctx, entitaDi(id, d.su), d.scrive ? 'modifica' : 'leggi')) out.push({ connettore: id, nomeConnettore: c.man.nome, azione: a, nome: tr(c.man, l, `az.${a}`, d.nome), su: entitaDi(id, d.su), scrive: !!d.scrive, input: Object.keys(d.input || {}) });
    return out;
  });
  // l'indirizzo pubblico di Lumi, per i webhook e i ritorni: uno solo, del titolare (vuoto = si toglie)
  r('GET', '/api/connettori/impostazioni', ({ ctx }) => { titolare(ctx); return { pubblico: pubblico(), daAmbiente: !meta.leggi(db, 'connettori.pubblico') && !!pubblico() }; });
  r('PUT', '/api/connettori/impostazioni', ({ ctx, corpo }) => {
    titolare(ctx); const v = String(corpo.pubblico ?? '').trim().replace(/\/+$/, '').slice(0, 300);
    if (v && !PUBBLICO.test(v)) throw errore(400, 'indirizzo-non-valido', { nome: 'pubblico' });
    meta.scrivi(db, 'connettori.pubblico', v); kCache.clear(); return { pubblico: pubblico() };
  });
  r('GET', '/api/connettori/:id', async ({ ctx, p, req }) => { titolare(ctx); await pronti; if (!tutti.get(p.id)?.inattesa) conn(p.id); return scheda(p.id, linguaDi(req, ctx), true); });
  r('PUT', '/api/connettori/:id', async ({ ctx, p, corpo, req }) => {
    titolare(ctx); await pronti;
    const pre = tutti.get(p.id);
    if (pre?.inattesa) {
      if (corpo.attivo === false) { scriviRiga(p.id, { attivo: 0 }); return scheda(p.id, linguaDi(req, ctx), true); }
      // il codice di terzi si importa adesso, e solo se il file ha ancora la somma che il titolare ha visto e confermato
      if (corpo.attivo !== true || corpo.somma !== pre.somma) throw errore(409, 'somma-diversa');
      const [x] = await carica(cartellaDati(), 'locale', (id, s) => s === corpo.somma, p.id);
      if (!x || x.inattesa) throw errore(409, 'somma-diversa');
      tutti.set(p.id, x); if (x.rotto) throw errore(404, 'sconosciuto');
    }
    const c = conn(p.id), { man } = c, impPrima = JSON.stringify(impDi(p.id));
    transazione(db, () => {
      if (corpo.interni != null) scriviRiga(p.id, { interni: corpo.interni ? 1 : 0 });
      if (corpo.impostazioni) {
        const imp = impDi(p.id);
        for (const [k, v] of Object.entries(corpo.impostazioni)) {
          const def = (man.impostazioni || []).find(i => i.id === k && !i.segreto); if (!def) throw errore(400, 'impostazione-sconosciuta', { nome: k });
          imp[k] = convalida(p.id, def, v);
        }
        scriviRiga(p.id, { impostazioni: JSON.stringify(imp) });
      }
      for (const [k, v] of Object.entries(corpo.segreti || {})) {
        const def = (man.impostazioni || []).find(i => i.id === k && i.segreto); if (!def) throw errore(400, 'impostazione-sconosciuta', { nome: k });
        salvaSegreto(p.id, k, v == null || v === '' ? null : convalida(p.id, def, String(v).trim()));
      }
      if (corpo.mappe) {
        const imp = impDi(p.id), m = { entita: { ...(imp._mappe?.entita || {}) }, campi: { ...(imp._mappe?.campi || {}) } };
        for (const [sem, e] of Object.entries(corpo.mappe.entita || {})) { if (!S.leggi(db, e)) throw errore(400, 'mappa-non-valida', { nome: sem }); m.entita[sem] = e; }
        for (const [k, f] of Object.entries(corpo.mappe.campi || {})) {
          const [sem] = k.split('.'), def = S.leggi(db, entitaDi(p.id, sem));
          if (!def || (f && !S.campiAttivi(def).some(x => x.id === f))) throw errore(400, 'mappa-non-valida', { nome: k });
          if (f) m.campi[k] = f; else delete m.campi[k];
        }
        imp._mappe = m; scriviRiga(p.id, { impostazioni: JSON.stringify(imp) });
      }
      if (corpo.attivo === true) {
        // un connettore locale si attiva confermando la sua somma: è codice che gira con i permessi del server
        if (c.origine === 'locale' && corpo.somma !== c.somma) throw errore(409, 'somma-diversa');
        scriviRiga(p.id, { attivo: 1, somma: c.somma, versione: man.versione || 1 }); ctxServizio(p.id);
        generaMancanti(p.id);
      }
      if (corpo.attivo === false) scriviRiga(p.id, { attivo: 0 });
      // client credentials: il token in memoria vale per l'indirizzo e le credenziali di prima. Cambiati quelli (un altro
      // servizio, un altro negozio), non deve partire verso il nuovo indirizzo: se ne chiede uno nuovo alla prossima chiamata
      if (man.oauth?.tipo === 'client' && (JSON.stringify(impDi(p.id)) !== impPrima || Object.keys(corpo.segreti || {}).length)) salvaSegreto(p.id, '_oauth', null);
    });
    kCache.delete(p.id); registraLumi(p.id);
    if (corpo.attivo != null) annota(p.id, 'sistema', 'ok', corpo.attivo ? 'acceso' : 'spento', { chi: ctx.utente.nome });
    if (corpo.attivo === true) await man.attiva?.(kPer(p.id));
    return scheda(p.id, linguaDi(req, ctx), true);
  });
  // i codici che un servizio mette in fondo all'indirizzo (o che Lumi genera): se li sceglie il titolare, almeno 16 caratteri
  const minimo = (man, def) => Math.max(def.minimo || 0, def.segreto && (def.generato || (man.entrata?.firma?.segreto === def.id && (man.entrata.firma.tipo === 'token' || man.entrata.firma.nelPercorso))) ? 16 : 0);
  function convalida(id, def, v) {
    if (v == null || v === '') return null;
    const min = minimo(conn(id).man, def); if (min && String(v).trim().length < min) throw errore(400, 'codice-corto', { nome: def.nome, minimo: min });
    if (def.tipo === 'numero') { const n = Number(v); if (!Number.isFinite(n)) throw errore(400, 'valore-non-valido', { nome: def.nome }); return n; }
    if (def.tipo === 'si_no') return !!v;
    // «ricette» (o un altro elenco strutturato): il manifesto le controlla e le ripulisce con controlla(valore) → valore pulito
    if (def.tipo === 'ricette' || def.tipo === 'json') {
      let x = v; if (typeof x === 'string') { try { x = JSON.parse(x); } catch { throw errore(400, 'valore-non-valido', { nome: def.nome }); } }
      if (JSON.stringify(x).length > 200000) throw errore(400, 'valore-non-valido', { nome: def.nome });
      if (typeof def.controlla === 'function') { try { x = def.controlla(x, { interni: process.env.LUMI_CONNETTORI_INTERNI === '1' || !!riga(id)?.interni, S, db }); } catch (e) { const x = tradotto(e); throw x !== e ? x : new ErroreHttp(400, String(e.message).slice(0, 300)); } }
      return x;
    }
    const t = String(v).trim().slice(0, 4000);
    if (def.tipo === 'scelta' && !(def.opzioni || []).some(o => (o.id ?? o) === t)) throw errore(400, 'valore-non-valido', { nome: def.nome });
    if (def.tipo === 'url') { const no = controllaUrl(t, { interni: process.env.LUMI_CONNETTORI_INTERNI === '1' || !!riga(id)?.interni }); if (no) throw errore(400, 'indirizzo-non-valido', { nome: def.nome }); }
    if (def.schema && !def.schema.test(t)) throw errore(400, 'valore-non-valido', { nome: def.nome });
    return t;
  }
  // una copia nuova: { nome } → id «<base>-<nome>»; si toglie solo spenta (con segreti, impostazioni e registro)
  r('POST', '/api/connettori/:id/copie', async ({ ctx, p, corpo, req }) => {
    titolare(ctx); await pronti; const b = conn(p.id); if (!b.man.copie || b.copiaDi) throw errore(400, 'copia-no');
    const nome = String(corpo.nome || '').trim().slice(0, 60), pezzo = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40 - p.id.length);
    const id = `${p.id}-${pezzo}`; if (!nome || !pezzo || !ID.test(id)) throw errore(400, 'copia-nome');
    if (tutti.has(id)) throw errore(409, 'copia-doppia', { nome: id });
    const x = { id, base: p.id, nome, creato: new Date().toISOString() };
    db.prepare('INSERT INTO _connettori_copie (id, base, nome, creato) VALUES (?, ?, ?, ?)').run(x.id, x.base, x.nome, x.creato);
    tutti.set(id, copia(x)); registraLumi(id); annota(id, 'sistema', 'ok', 'copia', { di: p.id, chi: ctx.utente.nome });
    return scheda(id, linguaDi(req, ctx), true);
  });
  r('DELETE', '/api/connettori/:id', async ({ ctx, p }) => {
    titolare(ctx); await pronti; const c = tutti.get(p.id); if (!c?.copiaDi) throw errore(400, 'copia-no');
    if (riga(p.id)?.attivo) throw errore(409, 'copia-accesa');
    transazione(db, () => { for (const t of ['_connettori_copie']) db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(p.id);
      for (const t of ['_connettori_segreti', '_connettori_registro', '_connettori_giri', '_connettori_coda', '_connettori_eventi', '_connettori_mappa']) db.prepare(`DELETE FROM ${t} WHERE connettore = ?`).run(p.id);
      db.prepare('DELETE FROM _connettori WHERE id = ?').run(p.id); });
    tutti.delete(p.id); kCache.delete(p.id); return { ok: true };
  });
  r('POST', '/api/connettori/:id/prova', async ({ ctx, p }) => {
    titolare(ctx); await pronti; const { man } = conn(p.id), t0 = Date.now();
    if (!man.prova) return { ok: true };
    try { const x = await man.prova(kPer(p.id)); const ok = x === true || x?.ok === true; annota(p.id, 'prova', ok ? 'ok' : 'errore', 'prova', x?.messaggio || null, Date.now() - t0); return { ok, messaggio: x?.messaggio || null }; }
    catch (e) { annota(p.id, 'prova', 'errore', 'prova', String(e.message).slice(0, 300), Date.now() - t0); return { ok: false, messaggio: String(e.message).slice(0, 300) }; }
  });
  r('POST', '/api/connettori/:id/giri/:giro', async ({ ctx, p }) => { titolare(ctx); await pronti; if (!attivo(p.id)) throw errore(409, 'spento'); return gira(p.id, p.giro); });
  r('POST', '/api/connettori/:id/coda/riprova', ({ ctx, p }) => {
    titolare(ctx); const n = db.prepare("UPDATE _connettori_coda SET stato = 'attesa', tentativi = 0, prossimo = ? WHERE connettore = ? AND stato = 'fallito'").run(Date.now(), p.id).changes;
    setImmediate(() => lavora().catch(() => {})); return { rimesse: n };
  });
  r('POST', '/api/connettori/:id/azioni/:azione', async ({ ctx, p, corpo }) => { serve(ctx); await pronti; return azione(p.id, p.azione, corpo.args || {}, ctx, { anteprima: !!corpo.anteprima }); });

  // ---------- OAuth: inizio (titolare), ritorno (pubblico: arriva dal servizio), device code ----------
  r('POST', '/api/connettori/:id/oauth/inizio', async ({ ctx, p, corpo }) => {
    titolare(ctx); await pronti; const { man } = conn(p.id), o = man.oauth; if (!o || o.tipo === 'client') throw errore(400, 'oauth-no');
    const k = kPer(p.id), base = String(corpo.base || pubblico() || ''); if (!/^https?:\/\/[^/]+(\/[^\s?#]*[^/])?$/.test(base)) throw errore(400, 'indirizzo-non-valido', { nome: 'base' });
    const state = randomBytes(24).toString('base64url'), ver = randomBytes(32).toString('base64url'), ritorno = String(urlDi(o.redirect, k) || '') || `${base}/api/connettori/${p.id}/oauth/ritorno`;
    db.prepare('DELETE FROM _connettori_oauth WHERE scade < ?').run(Date.now());
    db.prepare('INSERT INTO _connettori_oauth (state, connettore, verificatore, ritorno, scade) VALUES (?, ?, ?, ?, ?)').run(state, p.id, ver, ritorno, Date.now() + 6e5);
    const u = new URL(urlDi(o.autorizza, k));
    for (const [a, b] of Object.entries({ response_type: 'code', client_id: k.segreti[o.client || 'client_id'], redirect_uri: ritorno, scope: o.scope, state,
      ...(o.pkce === false ? {} : { code_challenge: createHash('sha256').update(ver).digest('base64url'), code_challenge_method: 'S256' }), ...(o.extra || {}) })) if (b != null) u.searchParams.set(a, b);
    return { url: u.href };
  });
  r('GET', '/api/connettori/:id/oauth/ritorno', async ({ p, q, res }) => {
    await pronti; const s = db.prepare('SELECT * FROM _connettori_oauth WHERE state = ? AND connettore = ?').get(String(q.get('state') || ''), p.id);
    if (s) db.prepare('DELETE FROM _connettori_oauth WHERE state = ?').run(s.state);   // una volta sola
    let esito = 'ok';
    if (!s || s.scade < Date.now() || !q.get('code')) esito = 'scaduto';
    else try {
      // i valori che il servizio mette nel ritorno (realmId di QuickBooks, hostname di pCloud) servono già per il token
      const o = conn(p.id).man.oauth, x = conservati(o, c => q.get(c));
      if (Object.keys(x).length) { const t = tokenSalvato(p.id) || {}; salvaSegreto(p.id, '_oauth', JSON.stringify({ ...t, extra: { ...(t.extra || {}), ...x } })); kCache.delete(p.id); }
      await chiediToken(p.id, { grant_type: 'authorization_code', code: q.get('code'), redirect_uri: s.ritorno, code_verifier: o.pkce === false ? undefined : s.verificatore }); annota(p.id, 'oauth', 'ok', 'collegato');
    }
    catch (e) { esito = 'errore'; annota(p.id, 'oauth', 'errore', 'collegamento', String(e.message).slice(0, 300)); }
    res.writeHead(302, { Location: `/#/connettori/${encodeURIComponent(p.id)}?oauth=${esito}`, 'Cache-Control': 'no-store' }).end();
  });
  r('POST', '/api/connettori/:id/oauth/dispositivo', async ({ ctx, p }) => {
    titolare(ctx); await pronti; const o = conn(p.id).man.oauth, k = kPer(p.id); if (!o?.dispositivo) throw errore(400, 'oauth-no');
    const x = await postaOAuth(p.id, urlDi(o.dispositivo, k), { scope: urlDi(o.scope, k) }, { conClient: true }), j = x.json?.device_code ? x.json : x.json?.data || {};
    if (!x.ok || !j.device_code) throw errore(502, 'oauth-rifiutato', { stato: x.stato });
    salvaSegreto(p.id, '_dispositivo', j.device_code);
    const indirizzo = sicuroHttps(j.verification_uri_complete) || sicuroHttps(j.verification_uri);
    return { codice: String(j.user_code || '').slice(0, 40), indirizzo, intervallo: Math.min(60, Math.max(2, Number(j.interval) || 5)), scade: Math.min(3600, Number(j.expires_in) || 600) };
  });
  r('POST', '/api/connettori/:id/oauth/dispositivo/controlla', async ({ ctx, p }) => {
    titolare(ctx); const dc = segreto(p.id, '_dispositivo'); if (!dc) throw errore(409, 'oauth-scollegato');
    try { await chiediToken(p.id, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc }); }
    catch (e) { if (['authorization_pending', 'slow_down'].includes(e.risposta?.error || e.risposta?.data?.error)) return { attesa: true }; throw e; }
    salvaSegreto(p.id, '_dispositivo', null); annota(p.id, 'oauth', 'ok', 'collegato'); return { collegato: true };
  });

  // ---------- webhook in entrata: pubblico, corpo grezzo, firma, idempotenza, 1 MB, 120 al minuto per indirizzo ----------
  const frequenza = new Map();
  function limita(ip) {
    const ora = Date.now(), l = (frequenza.get(ip) || []).filter(t => ora - t < 6e4); l.push(ora); frequenza.set(ip, l);
    if (frequenza.size > 5000) for (const [i, x] of frequenza) if (ora - x.at(-1) >= 6e4) frequenza.delete(i);   // gli indirizzi fermi da un minuto non restano in memoria
    if (l.length > 120) throw errore(429, 'troppe');
  }
  // una risposta su misura del manifesto: { stato?, testo? | json?, tipo? } (TwiML vuoto, «Hello API Event Received», un challenge)
  function rispondi(res, x) {
    const stato = Number.isInteger(x?.stato) && x.stato >= 200 && x.stato < 600 ? x.stato : 200, json = x?.json !== undefined;
    const corpo = (json ? JSON.stringify(x.json) : String(x?.testo ?? '')).slice(0, 65536);
    const tipo = /^[\w.+-]+\/[\w.+-]+(\s*;\s*charset=[\w-]+)?$/i.test(String(x?.tipo || '')) ? x.tipo : json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(stato, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(corpo) }).end(corpo);
  }
  const suMisura = (v, arg) => (typeof v === 'function' ? v(arg) : v);
  async function entrata({ req, res, p, q, grezzo, ip }) {
    await pronti;
    if (!attivo(p.id)) throw errore(404, 'spento');
    const { man } = conn(p.id), en = man.entrata; if (!en) throw errore(404, 'spento');
    limita(ip);
    const b = grezzo || Buffer.alloc(0); if (b.length > 1e6) throw errore(413, 'troppo-grande');
    const k = kPer(p.id), f = en.firma || { tipo: 'nessuna' }, s = f.segreto ? segreto(p.id, f.segreto) : null;
    if (f.segreto && !s) throw errore(503, 'non-configurato');
    const ok = f.tipo === 'stripe' ? firmaStripe(req.headers[f.intestazione || 'stripe-signature'], b, s)
      : f.tipo === 'hmac' ? firmaHmac(req.headers[f.intestazione], b, s, f.formato || 'base64')
      : f.tipo === 'token' ? !!p.nome && stessoSegreto(p.nome, s)
      : f.tipo === 'nessuna' ? true : typeof f.verifica === 'function' ? !!(await f.verifica({ req, grezzo: b, segreto: s, k, nome: p.nome ?? null, q })) : false;
    if (!ok) {
      annota(p.id, 'entrata', 'errore', 'firma');
      // lo stato che il servizio si aspetta su una firma sbagliata (es. 403 invece di 401), sempre senza dettagli
      if (en.rispostaFirma) return rispondi(res, { testo: '', ...suMisura(en.rispostaFirma, { k, req, q }) });
      throw errore(401, 'firma');
    }
    const t = b.toString('utf8'), tipoC = req.headers['content-type'] || '';
    let ev; try { ev = /multipart\/form-data/i.test(tipoC) ? leggiMultipart(b, tipoC) ?? {} : /json/i.test(tipoC) || /^\s*[[{]/.test(t) ? JSON.parse(t || '{}') : /x-www-form-urlencoded/i.test(tipoC) ? Object.fromEntries(new URLSearchParams(t)) : t; }
    catch { throw errore(400, 'corpo'); }
    const chiaveE = en.idempotenza ? String(en.idempotenza(ev, req, { k, q }) ?? '') : '';
    const fine = (out, esito) => (en.risposta ? rispondi(res, suMisura(en.risposta, { esito, ev, k, req, q, doppione: !!out.doppione }) || {}) : out);
    if (chiaveE && db.prepare('SELECT 1 FROM _connettori_eventi WHERE connettore = ? AND chiave = ?').get(p.id, chiaveE)) return fine({ ok: true, doppione: true }, 'doppione');
    const t0 = Date.now(); let esito;
    try { esito = await en.gestisci(ev, k, { req, nome: p.nome ?? null, q }); }
    catch (e) { annota(p.id, 'entrata', 'errore', chiaveE || 'evento', String(e.message).slice(0, 500), Date.now() - t0); throw tradotto(e); }
    // un evento ignorato non si segna: se il servizio lo rimanda quando è cambiato qualcosa (SumUp «richiama»), si rilegge
    if (chiaveE && !/^ignorato/.test(String(esito))) db.prepare('INSERT OR IGNORE INTO _connettori_eventi (connettore, chiave, quando) VALUES (?, ?, ?)').run(p.id, chiaveE, new Date().toISOString());
    annota(p.id, 'entrata', /^(ignorato|doppione)/.test(String(esito)) ? 'ignorato' : 'ok', chiaveE || 'evento', esito, Date.now() - t0);
    return fine({ ok: true, esito: typeof esito === 'string' ? esito : undefined }, esito);
  }
  // GET sullo stesso indirizzo: le verifiche dei servizi (Meta hub.challenge, Mailchimp, …) con entrata.verificaGet(q, k, { req, nome })
  // → { stato?, testo? | json?, tipo? }. Con il codice nell'indirizzo, anche la verifica deve averlo giusto.
  async function verificaGet({ req, res, p, q, ip }) {
    await pronti;
    if (!attivo(p.id)) throw errore(404, 'spento');
    const en = conn(p.id).man.entrata; if (typeof en?.verificaGet !== 'function') throw errore(404, 'spento');
    limita(ip);
    const f = en.firma || {}, k = kPer(p.id);
    if (f.segreto && (f.tipo === 'token' || f.nelPercorso)) { const s = segreto(p.id, f.segreto); if (!s || !p.nome || !stessoSegreto(p.nome, s)) { annota(p.id, 'entrata', 'errore', 'verifica'); throw errore(401, 'firma'); } }
    const x = await en.verificaGet(q, k, { req, nome: p.nome ?? null });
    annota(p.id, 'entrata', x && (x.stato ?? 200) < 300 ? 'ok' : 'errore', 'verifica');
    return rispondi(res, x || { stato: 404 });
  }
  r('POST', '/api/connettori/:id/in', entrata, { pubblica: true, grezzo: true });
  r('POST', '/api/connettori/:id/in/:nome', entrata, { pubblica: true, grezzo: true });
  r('GET', '/api/connettori/:id/in', verificaGet, { pubblica: true });
  r('GET', '/api/connettori/:id/in/:nome', verificaGet, { pubblica: true });
  r('GET', '/api/connettori/:id/pub/:nome', async ({ p, q, req, res }) => {
    await pronti; if (!attivo(p.id)) throw errore(404, 'spento');
    const f = conn(p.id).man.pubbliche?.[p.nome]; if (!f) throw errore(404, 'spento');
    const x = await f({ q, req, k: kPer(p.id) }); if (!x) throw errore(404, 'spento');
    res.writeHead(200, { 'Content-Type': x.tipo || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...(x.intestazioni || {}) }).end(x.corpo);
  });

  // per i test e per gli altri moduli (es. una scheda che vuole sapere se Stripe è attivo)
  const istanza = { pronti, attivo, k: kPer, gira, lavora, pianificatore, accoda, segreto, annota, tutti: () => tutti, ctxServizio, pota, nomeLumi,
    perProva: (id, { base } = {}) => { const imp = impDi(id); imp._base = base; scriviRiga(id, { impostazioni: JSON.stringify(imp) }); kCache.delete(id); } };
  istanze.set(db, istanza);
  return istanza;
}
export { TESTI };
