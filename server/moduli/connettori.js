// Il nucleo dei connettori: collegare un servizio a Kubo con una cartella e un manifesto (docs/CONNETTORI.md).
// Un connettore è connettori/<id>/connettore.js (quelli ufficiali, nel repository) o <dati>/connettori/<id>/connettore.js
// (quelli dell'azienda o di terzi: il titolare li attiva vedendo la somma SHA-256, e se il file cambia si fermano finché
// non li riapprova). Il connettore dichiara; il nucleo fa: segreti cifrati, impostazioni, identità di servizio con
// permessi limitati, webhook in entrata con firma, client HTTP con protezione SSRF, coda con tentativi, giri pianificati,
// mappature verso lo schema, OAuth 2, registro, strumenti di Lumi. Rotte (tutte del titolare, tranne quelle pubbliche):
//   GET  /api/connettori                     catalogo: installati e disponibili, con lo stato
//   GET  /api/connettori/:id                 la pagina del connettore: impostazioni, segreti (solo «c'è»), mappe, giri, registro
//   PUT  /api/connettori/:id                 { attivo?, somma?, impostazioni?, segreti?: { nome: valore | null }, interni?, mappe? }
//   POST /api/connettori/:id/prova           «prova la connessione»
//   POST /api/connettori/:id/giri/:giro      un giro pianificato subito («sincronizza ora»)
//   POST /api/connettori/:id/coda/riprova    rimette in coda le consegne fallite
//   GET  /api/connettori/azioni              le azioni dei connettori attivi che l'utente può usare (bottoni nelle schede)
//   POST /api/connettori/:id/azioni/:azione  { args, anteprima? }: con i permessi di chi la chiede
//   POST /api/connettori/:id/in[/:nome]      PUBBLICA: il webhook del servizio, con il corpo grezzo e la firma verificata
//   GET  /api/connettori/:id/pub/:nome       PUBBLICA: uscite in sola lettura del connettore (es. il feed .ics dell'agenda)
//   GET  /api/connettori/:id/oauth/inizio · GET …/oauth/ritorno (pubblica) · POST …/oauth/dispositivo[/controlla]
import { readdirSync, readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { nuovoId, transazione } from '../db.js';
import { controllaUrl } from './sicurezza-rete.js';
import { client, firmaStripe, firmaHmac, stessoSegreto } from './connettori-rete.js';
import { ATTESE } from './import-api.js';
import { mezzanotte, giornoDi, piuGiorni, FUSO } from './agenda-aggregati.js';
import { TESTI, testo } from './connettori-lingue.js';

export const CARTELLA_UFFICIALI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'connettori');
const somma = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const ID = /^[a-z][a-z0-9-]{1,40}$/;

// legge le cartelle dei connettori: { man, file, somma, origine }. Un manifesto rotto non ferma Kubo (si segna l'errore).
export async function carica(cartella, origine) {
  let nomi = []; try { nomi = readdirSync(cartella).filter(n => ID.test(n)).sort(); } catch { return []; }
  const out = [];
  for (const n of nomi) {
    const file = join(cartella, n, 'connettore.js');
    if (!existsSync(file) || !resolve(file).startsWith(resolve(cartella) + sep)) continue;
    try {
      const s = somma(file), man = (await import(pathToFileURL(file).href + `?s=${s.slice(0, 12)}`)).default;
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
  for (let i = 0; i < 3; i++) { const t = Date.parse(mezzanotte(piuGiorni(g, i), fuso)) + (hh * 60 + mm) * 6e4; if (t > dopo) return t; }
  return dopo + 864e5;
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
    CREATE TABLE IF NOT EXISTS _connettori_oauth (state TEXT PRIMARY KEY, connettore TEXT NOT NULL, verificatore TEXT NOT NULL, ritorno TEXT NOT NULL, scade INTEGER NOT NULL);`);

  // ---------- messaggi nelle sei lingue (server/moduli/connettori-lingue.js) ----------
  const linguaDi = (req, ctx) => { try { return (ctx?.utente && db.prepare('SELECT lingua FROM _lingue_utenti WHERE utente = ?').get(ctx.utente.id)?.lingua) || meta.leggi(db, 'lingue.azienda') || 'it'; } catch { return 'it'; } };
  const errore = (stato, chiave, p = {}) => new ErroreHttp(stato, testo('it', chiave, p), { _conn: chiave, _p: p });
  suErrore?.((corpo, { req, ctx }) => {
    if (!corpo?._conn) return corpo;
    const { _conn, _p, ...resto } = corpo; return { ...resto, errore: testo(linguaDi(req, ctx), _conn, _p) };
  });

  // ---------- i connettori di questo database ----------
  const cartellaDati = () => { const l = db.location?.(); return l ? join(dirname(l), 'connettori') : null; };
  let tutti = new Map(UFFICIALI.map(c => [c.id, c]));
  const pronti = (async () => { const c = cartellaDati(); if (!c) return; for (const x of await carica(c, 'locale')) if (!tutti.has(x.id)) tutti.set(x.id, x); })().catch(e => console.error('connettori', e));
  const riga = id => db.prepare('SELECT * FROM _connettori WHERE id = ?').get(id);
  const conn = id => { const c = tutti.get(id); if (!c || c.rotto) throw errore(404, 'sconosciuto'); return c; };
  // attivo davvero: acceso dal titolare e, per quelli locali, con la stessa somma approvata
  const attivo = id => { const c = tutti.get(id), x = riga(id); return !!(c && !c.rotto && x?.attivo && (c.origine === 'ufficiale' || x.somma === c.somma)); };
  const leggiJson = (s, d = {}) => { try { return JSON.parse(s || '') ?? d; } catch { return d; } };
  const impDi = id => leggiJson(riga(id)?.impostazioni);
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
      db.prepare("INSERT INTO _utenti (id, nome, email, hash, ruolo, attivo, creato) VALUES (?, ?, ?, '!', ?, 0, ?)").run(uid, man.nome, `${id}@connettori.kubo.invalid`, uid, new Date().toISOString());
    const entita = {}; for (const [sem, p] of Object.entries(man.permessi || {})) entita[entitaDi(id, sem)] = { leggi: !!p.leggi, crea: !!p.crea, modifica: !!p.modifica, elimina: !!p.elimina };
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
  const mancanti = id => statoMappe(id).flatMap(m => !m.entita ? [m.sem] : m.campi.filter(c => !c.campo && !c.facoltativo).map(c => `${m.sem}.${c.sem}`));
  const prendi = (o, via) => String(via).split('.').reduce((x, k) => x?.[k], o);

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
      id, man, db, S, D, P, ctx, dati, valore, fuso: () => FUSO,
      get imp() { const x = impDi(id); for (const i of man.impostazioni || []) if (!i.segreto && x[i.id] == null && i.predefinito != null) x[i.id] = i.predefinito; return x; },
      get segreti() { return Object.fromEntries((man.impostazioni || []).filter(i => i.segreto).map(i => [i.id, segreto(id, i.id)]).concat([['_feed', segreto(id, '_feed')]])); },
      get base() { return impDi(id)._base || man.base || ''; },
      http: client({ interni: () => process.env.KUBO_CONNETTORI_INTERNI === '1' || !!riga(id)?.interni }),
      campo: (sem, c) => campoDi(id, sem, c), entita: vero,
      annota: (verso, esito, titolo, dett) => annota(id, verso, esito, titolo, dett),
      avvisa: t => { annota(id, 'sistema', 'avviso', t); manda?.({ tipo: 'avviso', testo: `${man.nome}: ${t}` }); return t; },
      stato: { leggi: c => leggiJson(riga(id)?.stato)[c], scrivi: (c, v) => { const s = leggiJson(riga(id)?.stato); s[c] = v; scriviRiga(id, { stato: JSON.stringify(s) }); } },
      salvaSegreto: (nome, v) => salvaSegreto(id, nome, v),
      accoda: (tipo, chiaveC, corpo, opz) => accoda(id, tipo, chiaveC, corpo, opz),
      euro: n => `${Number(n || 0).toFixed(2).replace('.', ',')} €`,
      oauth: { token: () => tokenOAuth(id) },
      sincro: {
        // gli oggetti del servizio entrano in Kubo: abbinati per id remoto o per la chiave, solo i campi con comanda ≠ 'kubo'
        async daRemoto(nome, oggetti) {
          const mp = man.mappe[nome], sem = mp.entita || nome, e = vero(sem), conti = { creati: 0, aggiornati: 0, uguali: 0 };
          for (const o of [].concat(oggetti || [])) {
            const rid = String(prendi(o, mp.id || 'id')), noto = db.prepare('SELECT riga, impronta FROM _connettori_mappa WHERE connettore = ? AND entita = ? AND remoto = ?').get(id, e, rid);
            let rigaId = noto?.riga && db.prepare(`SELECT id FROM ${S.tabella(e)} WHERE id = ? AND archiviato = 0`).get(noto.riga) ? noto.riga : null;
            if (!rigaId && mp.chiave) { const v = prendi(o, mp.chiave[1]); if (v != null && v !== '') rigaId = dati.trova(sem, mp.chiave[0], String(v))?.id || null; }
            const valori = {};
            for (const c of mp.campi) { if (rigaId && c.comanda === 'kubo') continue; const v = prendi(o, c.remoto); if (v !== undefined) valori[c.kubo] = c.da ? c.da(v) : v; }
            if (!rigaId && mp.chiave) valori[mp.chiave[0]] ??= prendi(o, mp.chiave[1]);
            const impronta = createHash('sha256').update(JSON.stringify(valori)).digest('hex').slice(0, 32);
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
      },
    };
    return k;
  }
  const kPer = id => { if (!kCache.has(id)) kCache.set(id, kDi(id)); return kCache.get(id); };

  // ---------- coda comune: tentativi crescenti (ATTESE di import-api.js), «unisci: 'ultimo'» tiene solo l'ultimo valore ----------
  function accoda(id, tipo, chiaveC, corpo, { unisci = null, fra = 0 } = {}) {
    const ora = Date.now(), c = JSON.stringify(corpo ?? {});
    if (unisci === 'ultimo' && chiaveC != null) {
      const x = db.prepare("SELECT id FROM _connettori_coda WHERE connettore = ? AND tipo = ? AND chiave = ? AND stato = 'attesa'").get(id, tipo, String(chiaveC));
      if (x) { db.prepare('UPDATE _connettori_coda SET corpo = ?, aggiornato = ? WHERE id = ?').run(c, new Date().toISOString(), x.id); return x.id; }
    }
    const n = db.prepare('INSERT INTO _connettori_coda (connettore, tipo, chiave, corpo, prossimo, creato) VALUES (?, ?, ?, ?, ?, ?)').run(id, tipo, chiaveC == null ? null : String(chiaveC), c, ora + fra, new Date().toISOString()).lastInsertRowid;
    setImmediate(() => lavora().catch(e => console.error('connettori coda', e)));   // dopo la transazione di chi accoda
    return n;
  }
  let lavorando = false;
  async function lavora() {
    if (lavorando) return 0; lavorando = true; let n = 0;
    try {
      for (const x of db.prepare("SELECT * FROM _connettori_coda WHERE stato = 'attesa' AND prossimo <= ? ORDER BY id LIMIT 50").all(Date.now())) {
        if (!attivo(x.connettore)) continue;
        const k = kPer(x.connettore), t0 = Date.now(); n++;
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
        }
      }
    } finally { lavorando = false; }
    return n;
  }
  // le modifiche ai campi dichiarati in «uscita» vanno in coda, ma non quelle che arrivano dal connettore stesso
  D.ascolta((ev, dbEv) => {
    if (dbEv !== db || !['crea', 'modifica'].includes(ev.tipo)) return;
    for (const [id, c] of tutti) {
      if (c.rotto || !c.man.uscita || origine === id || !attivo(id)) continue;
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
  async function gira(id, nome, { forza = false } = {}) {
    const def = conn(id).man.pianificati?.[nome]; if (!def) throw errore(404, 'giro-sconosciuto');
    const chiaveG = `${id}/${nome}`; if (inCorso.has(chiaveG)) return { esito: 'in-corso' };
    if (!forza && !attivo(id)) return { esito: 'spento' };
    inCorso.add(chiaveG); const t0 = Date.now(); let esito = 'ok', ris = null;
    try { ris = await def.giro(kPer(id)); annota(id, 'giro', 'ok', nome, ris, Date.now() - t0); }
    catch (e) { esito = 'errore'; ris = String(e.message).slice(0, 500); annota(id, 'giro', 'errore', nome, ris, Date.now() - t0); }
    finally {
      inCorso.delete(chiaveG);
      db.prepare('INSERT INTO _connettori_giri (connettore, giro, ultimo, prossimo, esito, durata) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(connettore, giro) DO UPDATE SET ultimo = excluded.ultimo, prossimo = excluded.prossimo, esito = excluded.esito, durata = excluded.durata')
        .run(id, nome, new Date().toISOString(), prossimo(def, Date.now()), esito, Date.now() - t0);
    }
    return { esito, risultato: ris };
  }
  async function pianificatore(adesso = Date.now()) {
    for (const [id, c] of tutti) {
      if (c.rotto || !c.man.pianificati || !attivo(id)) continue;
      for (const [nome, def] of Object.entries(c.man.pianificati)) {
        const x = db.prepare('SELECT prossimo FROM _connettori_giri WHERE connettore = ? AND giro = ?').get(id, nome);
        if (!x) { db.prepare('INSERT INTO _connettori_giri (connettore, giro, prossimo) VALUES (?, ?, ?)').run(id, nome, def.ogni ? adesso : prossimo(def, adesso)); if (!def.ogni) continue; }
        if ((x?.prossimo ?? adesso) <= adesso) await gira(id, nome);   // anche un giro perso a computer spento: uno solo, poi si riparte da adesso
      }
    }
  }
  const battito = setInterval(() => { pianificatore().then(lavora).catch(e => console.error('connettori', e)); }, 30000); battito.unref?.();

  // ---------- OAuth 2: codice con PKCE, device code, client credentials; rinnovo dei token ----------
  const urlDi = (v, k) => (typeof v === 'function' ? v(k) : v);
  const tokenSalvato = id => leggiJson(segreto(id, '_oauth'), null);
  async function chiediToken(id, form) {
    const { man } = conn(id), k = kPer(id), o = man.oauth, s = k.segreti;
    const r = await k.http.post(urlDi(o.token, k), { form: { client_id: s[o.client || 'client_id'], client_secret: s[o.segreto || 'client_secret'] || undefined, ...form } });
    if (!r.ok || !r.json?.access_token) throw Object.assign(errore(502, 'oauth-rifiutato', { stato: r.stato }), { risposta: r.json });
    const vecchio = tokenSalvato(id) || {}, t = { access_token: r.json.access_token, refresh_token: r.json.refresh_token || vecchio.refresh_token || null,
      scade: r.json.expires_in ? Date.now() + Number(r.json.expires_in) * 1000 : null, scope: r.json.scope || null };
    salvaSegreto(id, '_oauth', JSON.stringify(t)); return t;
  }
  const rinnovi = new Map();
  async function tokenOAuth(id) {
    const o = conn(id).man.oauth; if (!o) return null;
    let t = tokenSalvato(id);
    if (t?.access_token && (!t.scade || t.scade - Date.now() > 60000)) return t.access_token;
    if (!rinnovi.has(id)) rinnovi.set(id, (async () => {
      if (o.tipo === 'client') return chiediToken(id, { grant_type: 'client_credentials', scope: o.scope || undefined });
      if (t?.refresh_token) return chiediToken(id, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
      throw errore(409, 'oauth-scollegato');
    })().finally(() => rinnovi.delete(id)));
    t = await rinnovi.get(id); annota(id, 'oauth', 'ok', 'token');
    return t.access_token;
  }

  // ---------- strumenti di Lumi (contratto k.lumi.strumento, se c'è) ----------
  for (const [id, c] of tutti) for (const [nome, a] of Object.entries(c.man?.azioni || {})) {
    if (!a.lumi) continue;
    lumi?.strumento?.({ nome: `connettore_${id}_${nome}`.replace(/-/g, '_'), descrizione: `${c.man.nome}: ${a.descrizione || a.nome}`, schema: schemaArgs(a), tipo: a.scrive ? 'scrivi' : 'leggi',
      permesso: ctx => attivo(id) && (!a.su || P.puo(ctx, entitaDi(id, a.su), a.scrive ? 'modifica' : 'leggi')),
      esegui: ({ ctx, args }) => azione(id, nome, args, ctx), anteprima: ({ ctx, args }) => azione(id, nome, args, ctx, { anteprima: true }) });
  }
  function schemaArgs(a) {
    return { type: 'object', properties: Object.fromEntries(Object.entries(a.input || {}).map(([k, x]) => [k, { type: x.tipo === 'numero' ? 'number' : 'string', description: x.nome || k }])), required: Object.keys(a.input || {}) };
  }
  // un'azione chiesta da una persona (o da Lumi per lei): le righe si leggono con i SUOI permessi, il servizio fa il resto
  async function azione(id, nome, args = {}, ctx, { anteprima = false } = {}) {
    if (!attivo(id)) throw errore(404, 'spento');
    const a = conn(id).man.azioni?.[nome]; if (!a) throw errore(404, 'azione-sconosciuta');
    if (a.su && !P.puo(ctx, entitaDi(id, a.su), a.scrive ? 'modifica' : 'leggi')) throw new P.ErrorePermesso();
    const k = kPer(id), x = {};
    for (const [n, def] of Object.entries(a.input || {})) x[n] = def.tipo === 'relazione' ? D.leggi(db, entitaDi(id, def.entita), String(args[n]?.id ?? args[n] ?? ''), ctx) : args[n];
    if (anteprima) return a.proponi ? a.proponi(x, k) : { titolo: a.nome, righe: [], avvisi: [] };
    const t0 = Date.now();
    try { const r = await a.esegui(x, k, { ctx }); annota(id, 'azione', 'ok', nome, { chi: ctx?.utente?.nome }, Date.now() - t0); return r; }
    catch (e) { annota(id, 'azione', 'errore', nome, String(e.message).slice(0, 500), Date.now() - t0); throw e; }
  }

  // ---------- la vista di un connettore per la pagina (nella lingua di chi guarda) ----------
  const tr = (man, l, c, d) => man.testi?.[l]?.[c] ?? d;
  function scheda(id, l, completa = false) {
    const c = tutti.get(id), x = riga(id);
    if (!c || c.rotto) return { id, rotto: c?.rotto || true, origine: c?.origine, somma: c?.somma };
    const { man } = c, salvati = segretiSalvati(id), imp = impDi(id), tok = tokenSalvato(id);
    const base = { id, nome: man.nome, descrizione: tr(man, l, 'descrizione', man.descrizione), icona: man.icona || 'cartella', versione: man.versione || 1, origine: c.origine,
      somma: c.somma, attivo: attivo(id), acceso: !!x?.attivo, cambiato: c.origine === 'locale' && !!x?.attivo && x.somma !== c.somma,
      mancano: [...(man.impostazioni || []).filter(i => i.obbligatorio !== false && i.segreto && !salvati.has(i.id)).map(i => tr(man, l, `imp.${i.id}`, i.nome)), ...mancanti(id)] };
    if (!completa) return base;
    return { ...base, interni: !!x?.interni,
      permessi: Object.entries(man.permessi || {}).map(([sem, p]) => ({ entita: S.leggi(db, entitaDi(id, sem))?.nome || sem, ...p })),
      impostazioni: (man.impostazioni || []).map(i => ({ id: i.id, nome: tr(man, l, `imp.${i.id}`, i.nome), aiuto: tr(man, l, `aiuto.${i.id}`, i.aiuto) || null, tipo: i.tipo || 'testo', segreto: !!i.segreto,
        opzioni: i.opzioni || null, ...(i.segreto ? { salvato: salvati.has(i.id) } : { valore: imp[i.id] ?? i.predefinito ?? null }) })),
      webhook: man.entrata ? { percorso: `/api/connettori/${id}/in${man.entrata.firma?.tipo === 'token' ? '/' + (salvati.has(man.entrata.firma.segreto) ? '…' : '') : ''}`, firma: man.entrata.firma?.tipo || 'nessuna' } : null,
      oauth: man.oauth ? { tipo: man.oauth.tipo || 'codice', collegato: !!tok?.access_token, scade: tok?.scade || null, rinnovo: !!tok?.refresh_token } : null,
      pubbliche: Object.keys(man.pubbliche || {}),
      giri: Object.entries(man.pianificati || {}).map(([g, d]) => ({ id: g, nome: tr(man, l, `giro.${g}`, d.nome || g), ogni: d.ogni || null, alle: d.alle || null,
        ...(db.prepare('SELECT ultimo, prossimo, esito, durata FROM _connettori_giri WHERE connettore = ? AND giro = ?').get(id, g) || {}) })),
      azioni: Object.entries(man.azioni || {}).map(([a, d]) => ({ id: a, nome: tr(man, l, `az.${a}`, d.nome), su: d.su ? entitaDi(id, d.su) : null, scrive: !!d.scrive, lumi: !!d.lumi })),
      mappe: statoMappe(id),
      coda: Object.fromEntries(db.prepare("SELECT stato, COUNT(*) n FROM _connettori_coda WHERE connettore = ? AND stato <> 'fatto' GROUP BY stato").all(id).map(z => [z.stato, z.n])),
      registro: db.prepare('SELECT quando, verso, esito, titolo, dettagli, durata FROM _connettori_registro WHERE connettore = ? ORDER BY id DESC LIMIT 60').all(id) };
  }

  // ---------- rotte di gestione: solo il titolare, solo dall'interfaccia (non con un token) ----------
  const titolare = ctx => { if (serve(ctx).r.id !== 'titolare' || ctx.viaToken) throw errore(403, 'solo-titolare'); return ctx; };
  r('GET', '/api/connettori', async ({ ctx, req }) => { titolare(ctx); await pronti; return [...tutti.keys()].sort().map(id => scheda(id, linguaDi(req, ctx))); });
  r('GET', '/api/connettori/azioni', async ({ ctx, req }) => {
    serve(ctx); await pronti; const l = linguaDi(req, ctx), out = [];
    for (const [id, c] of tutti) if (attivo(id)) for (const [a, d] of Object.entries(c.man.azioni || {}))
      if (d.su && P.puo(ctx, entitaDi(id, d.su), d.scrive ? 'modifica' : 'leggi')) out.push({ connettore: id, nomeConnettore: c.man.nome, azione: a, nome: tr(c.man, l, `az.${a}`, d.nome), su: entitaDi(id, d.su), scrive: !!d.scrive });
    return out;
  });
  r('GET', '/api/connettori/:id', async ({ ctx, p, req }) => { titolare(ctx); await pronti; conn(p.id); return scheda(p.id, linguaDi(req, ctx), true); });
  r('PUT', '/api/connettori/:id', async ({ ctx, p, corpo, req }) => {
    titolare(ctx); await pronti; const c = conn(p.id), { man } = c;
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
      }
      if (corpo.attivo === false) scriviRiga(p.id, { attivo: 0 });
    });
    kCache.delete(p.id);
    if (corpo.attivo != null) annota(p.id, 'sistema', 'ok', corpo.attivo ? 'acceso' : 'spento', { chi: ctx.utente.nome });
    if (corpo.attivo === true) await man.attiva?.(kPer(p.id));
    return scheda(p.id, linguaDi(req, ctx), true);
  });
  function convalida(id, def, v) {
    if (v == null || v === '') return null;
    if (def.tipo === 'numero') { const n = Number(v); if (!Number.isFinite(n)) throw errore(400, 'valore-non-valido', { nome: def.nome }); return n; }
    if (def.tipo === 'si_no') return !!v;
    const t = String(v).trim().slice(0, 4000);
    if (def.tipo === 'scelta' && !(def.opzioni || []).some(o => (o.id ?? o) === t)) throw errore(400, 'valore-non-valido', { nome: def.nome });
    if (def.tipo === 'url') { const no = controllaUrl(t, { interni: process.env.KUBO_CONNETTORI_INTERNI === '1' || !!riga(id)?.interni }); if (no) throw errore(400, 'indirizzo-non-valido', { nome: def.nome }); }
    if (def.schema && !def.schema.test(t)) throw errore(400, 'valore-non-valido', { nome: def.nome });
    return t;
  }
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
    const k = kPer(p.id), base = String(corpo.base || ''); if (!/^https?:\/\/[^/]+$/.test(base)) throw errore(400, 'indirizzo-non-valido', { nome: 'base' });
    const state = randomBytes(24).toString('base64url'), ver = randomBytes(32).toString('base64url'), ritorno = `${base}/api/connettori/${p.id}/oauth/ritorno`;
    db.prepare('DELETE FROM _connettori_oauth WHERE scade < ?').run(Date.now());
    db.prepare('INSERT INTO _connettori_oauth (state, connettore, verificatore, ritorno, scade) VALUES (?, ?, ?, ?, ?)').run(state, p.id, ver, ritorno, Date.now() + 6e5);
    const u = new URL(urlDi(o.autorizza, k));
    for (const [a, b] of Object.entries({ response_type: 'code', client_id: k.segreti[o.client || 'client_id'], redirect_uri: ritorno, scope: o.scope, state,
      code_challenge: createHash('sha256').update(ver).digest('base64url'), code_challenge_method: 'S256', ...(o.extra || {}) })) if (b != null) u.searchParams.set(a, b);
    return { url: u.href };
  });
  r('GET', '/api/connettori/:id/oauth/ritorno', async ({ p, q, res }) => {
    await pronti; const s = db.prepare('SELECT * FROM _connettori_oauth WHERE state = ? AND connettore = ?').get(String(q.get('state') || ''), p.id);
    if (s) db.prepare('DELETE FROM _connettori_oauth WHERE state = ?').run(s.state);   // una volta sola
    let esito = 'ok';
    if (!s || s.scade < Date.now() || !q.get('code')) esito = 'scaduto';
    else try { await chiediToken(p.id, { grant_type: 'authorization_code', code: q.get('code'), redirect_uri: s.ritorno, code_verifier: s.verificatore }); kCache.delete(p.id); annota(p.id, 'oauth', 'ok', 'collegato'); }
    catch (e) { esito = 'errore'; annota(p.id, 'oauth', 'errore', 'collegamento', String(e.message).slice(0, 300)); }
    res.writeHead(302, { Location: `/#/connettori/${encodeURIComponent(p.id)}?oauth=${esito}`, 'Cache-Control': 'no-store' }).end();
  });
  r('POST', '/api/connettori/:id/oauth/dispositivo', async ({ ctx, p }) => {
    titolare(ctx); await pronti; const o = conn(p.id).man.oauth, k = kPer(p.id); if (!o?.dispositivo) throw errore(400, 'oauth-no');
    const x = await k.http.post(urlDi(o.dispositivo, k), { form: { client_id: k.segreti[o.client || 'client_id'], scope: o.scope } });
    if (!x.ok || !x.json?.device_code) throw errore(502, 'oauth-rifiutato', { stato: x.stato });
    salvaSegreto(p.id, '_dispositivo', x.json.device_code);
    return { codice: x.json.user_code, indirizzo: x.json.verification_uri_complete || x.json.verification_uri, intervallo: x.json.interval || 5, scade: x.json.expires_in || 600 };
  });
  r('POST', '/api/connettori/:id/oauth/dispositivo/controlla', async ({ ctx, p }) => {
    titolare(ctx); const dc = segreto(p.id, '_dispositivo'); if (!dc) throw errore(409, 'oauth-scollegato');
    try { await chiediToken(p.id, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc }); }
    catch (e) { if (['authorization_pending', 'slow_down'].includes(e.risposta?.error)) return { attesa: true }; throw e; }
    salvaSegreto(p.id, '_dispositivo', null); annota(p.id, 'oauth', 'ok', 'collegato'); return { collegato: true };
  });

  // ---------- webhook in entrata: pubblico, corpo grezzo, firma, idempotenza, 1 MB, 120 al minuto per indirizzo ----------
  const frequenza = new Map();
  async function entrata({ req, p, grezzo, ip }) {
    await pronti;
    if (!attivo(p.id)) throw errore(404, 'spento');
    const { man } = conn(p.id), en = man.entrata; if (!en) throw errore(404, 'spento');
    const ora = Date.now(), l = (frequenza.get(ip) || []).filter(t => ora - t < 6e4); l.push(ora); frequenza.set(ip, l);
    if (l.length > 120) throw errore(429, 'troppe');
    const b = grezzo || Buffer.alloc(0); if (b.length > 1e6) throw errore(413, 'troppo-grande');
    const k = kPer(p.id), f = en.firma || { tipo: 'nessuna' }, s = f.segreto ? segreto(p.id, f.segreto) : null;
    if (f.segreto && !s) throw errore(503, 'non-configurato');
    const ok = f.tipo === 'stripe' ? firmaStripe(req.headers[f.intestazione || 'stripe-signature'], b, s)
      : f.tipo === 'hmac' ? firmaHmac(req.headers[f.intestazione], b, s, f.formato || 'base64')
      : f.tipo === 'token' ? !!p.nome && stessoSegreto(p.nome, s)
      : f.tipo === 'nessuna' ? true : typeof f.verifica === 'function' ? !!(await f.verifica({ req, grezzo: b, segreto: s, k })) : false;
    if (!ok) { annota(p.id, 'entrata', 'errore', 'firma'); throw errore(401, 'firma'); }
    const t = b.toString('utf8'), tipoC = req.headers['content-type'] || '';
    let ev; try { ev = /json/i.test(tipoC) || /^\s*[[{]/.test(t) ? JSON.parse(t || '{}') : /x-www-form-urlencoded/i.test(tipoC) ? Object.fromEntries(new URLSearchParams(t)) : t; }
    catch { throw errore(400, 'corpo'); }
    const chiaveE = en.idempotenza ? String(en.idempotenza(ev, req) ?? '') : '';
    if (chiaveE && db.prepare('SELECT 1 FROM _connettori_eventi WHERE connettore = ? AND chiave = ?').get(p.id, chiaveE)) return { ok: true, doppione: true };
    const t0 = Date.now(); let esito;
    try { esito = await en.gestisci(ev, k, { req }); }
    catch (e) { annota(p.id, 'entrata', 'errore', chiaveE || 'evento', String(e.message).slice(0, 500), Date.now() - t0); throw e; }
    if (chiaveE) db.prepare('INSERT OR IGNORE INTO _connettori_eventi (connettore, chiave, quando) VALUES (?, ?, ?)').run(p.id, chiaveE, new Date().toISOString());
    annota(p.id, 'entrata', /^(ignorato|doppione)/.test(String(esito)) ? 'ignorato' : 'ok', chiaveE || 'evento', esito, Date.now() - t0);
    return { ok: true, esito: typeof esito === 'string' ? esito : undefined };
  }
  r('POST', '/api/connettori/:id/in', entrata, { pubblica: true, grezzo: true });
  r('POST', '/api/connettori/:id/in/:nome', entrata, { pubblica: true, grezzo: true });
  r('GET', '/api/connettori/:id/pub/:nome', async ({ p, q, req, res }) => {
    await pronti; if (!attivo(p.id)) throw errore(404, 'spento');
    const f = conn(p.id).man.pubbliche?.[p.nome]; if (!f) throw errore(404, 'spento');
    const x = await f({ q, req, k: kPer(p.id) }); if (!x) throw errore(404, 'spento');
    res.writeHead(200, { 'Content-Type': x.tipo || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...(x.intestazioni || {}) }).end(x.corpo);
  });

  // per i test e per gli altri moduli (es. una scheda che vuole sapere se Stripe è attivo)
  const istanza = { pronti, attivo, k: kPer, gira, lavora, pianificatore, accoda, segreto, annota, tutti: () => tutti, ctxServizio,
    perProva: (id, { base } = {}) => { const imp = impDi(id); imp._base = base; scriviRiga(id, { impostazioni: JSON.stringify(imp) }); kCache.delete(id); } };
  istanze.set(db, istanza);
  return istanza;
}
export { TESTI };
