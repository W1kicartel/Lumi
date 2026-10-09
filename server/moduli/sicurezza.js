// Sicurezza: sessioni, password, tentativi di accesso, poteri espliciti e impostazioni che valgono per tutta l'azienda.
// Tutto passa da k.controllo (gira prima di ogni rotta /api/*) e da queste rotte:
//   GET    /api/sicurezza/io                     { deveCambiare }: la password va cambiata prima di continuare?
//   POST   /api/sicurezza/password               { attuale, nuova }: cambia la propria password (serve quella attuale)
//   GET    /api/sicurezza/sessioni               i propri dispositivi collegati (mai il token: un'impronta)
//   DELETE /api/sicurezza/sessioni/:id           chiude un dispositivo
//   POST   /api/sicurezza/esci-ovunque           chiude tutte le proprie sessioni tranne questa
//   GET|PUT /api/sicurezza/impostazioni          (titolare) inattività, allegati, webhook interni, fuso, budget di Lumi
//   GET    /api/sicurezza/ruoli · PUT /api/sicurezza/ruoli/:id   (titolare) i poteri «fatturapa» e «lumi» di ogni ruolo
//   POST   /api/sicurezza/utenti/:id             (chi gestisce le persone) { cambioObbligatorio?, esciOvunque? }
//   GET    /api/sicurezza/lumi                   (titolare) i token di Lumi usati questo mese, per persona
// Regole: una sessione ferma da più di «sicurezza.inattivita» minuti (predefinito 720) si chiude; dopo 5 accessi sbagliati
// in 15 minuti lo stesso account (o lo stesso PIN) aspetta 15 minuti; le password deboli si rifiutano (vedi robustezza).
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { impostaFuso } from './agenda-aggregati.js';
import { orologio } from '../formule.js';
import { installaSql } from './sicurezza-sql.js';

const MINUTI_INATTIVITA = 720, TENTATIVI = 5, FINESTRA = 15 * 6e4;
// estensioni che il browser o il sistema eseguirebbero: come allegato non servono a un gestionale
const VIETATE = new Set(['.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.vbs', '.vbe', '.js', '.jse', '.mjs', '.wsf', '.wsh', '.ps1', '.psm1',
  '.hta', '.html', '.htm', '.xhtml', '.shtml', '.svg', '.svgz', '.xml', '.php', '.jsp', '.asp', '.aspx', '.sh', '.bash', '.command', '.app', '.dll', '.jar', '.lnk', '.reg', '.dmg', '.pkg', '.deb', '.rpm', '.apk']);
const PAROLE_COMUNI = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop', 'qwerty123', 'iloveyou', 'abc12345', 'admin123',
  'administrator', 'benvenuto', 'benvenuto1', 'ciao1234', 'cambiami', 'passw0rd', 'letmein1', 'lumi1234', 'lumilumi', 'gestionale', '11111111', '00000000', 'juventus', 'forzainter', 'forzamilan']);
const decodifica = x => { try { return decodeURIComponent(x); } catch { return ''; } };
export const impronta = t => createHash('sha256').update(String(t)).digest('hex').slice(0, 24);

// una password robusta: almeno 8 caratteri, non fra le più usate, non il proprio nome o la propria email, non tutta uguale,
// e sotto i 12 caratteri almeno due tipi di caratteri (lettere, cifre, simboli). → messaggio d'errore o null
export function robustezza(pw, { nome = '', email = '' } = {}) {
  const p = String(pw ?? ''), l = p.toLowerCase();
  if (p.length < 8) return 'La password deve avere almeno 8 caratteri';
  if (p.length > 200) return 'La password è troppo lunga';
  if (PAROLE_COMUNI.has(l) || PAROLE_COMUNI.has(l.replace(/\d+$/, ''))) return 'Questa password è fra le più usate: scegline un\'altra';
  if (/^(.)\1+$/.test(p) || /^(?:0123456789|1234567890|abcdefgh)/.test(l)) return 'Questa password è troppo facile da indovinare';
  const pezzi = [String(email).split('@')[0], ...String(nome).split(/\s+/)].map(x => x.toLowerCase()).filter(x => x.length >= 4);
  if (pezzi.some(x => l === x || l.replace(/[^a-z]/g, '') === x)) return 'La password non può essere il tuo nome o la tua email';
  const tipi = [/[a-zA-Z]/, /\d/, /[^a-zA-Z\d]/].filter(r => r.test(p)).length;
  if (p.length < 12 && tipi < 2) return 'Sotto i 12 caratteri mescola lettere con cifre o simboli';
  return null;
}
// i poteri espliciti di un ruolo: «fatturapa» (esportare l'XML, che consuma un progressivo d'invio) e «lumi» (usare l'AI)
export function puoFatturaPA(ctx, P) { if (!ctx) return false; if (ctx.r.id === 'titolare') return true; return ctx.r.fatturapa ?? P.puo(ctx, 'fatture', 'modifica'); }
export const puoLumi = ctx => !!ctx && (ctx.r.id === 'titolare' || ctx.r.lumi !== false);

export default function registra({ r, db, S, D, P, U, meta, serve, ErroreHttp, controllo }) {
  db.exec(`CREATE TABLE IF NOT EXISTS _sicurezza_utenti (utente TEXT PRIMARY KEY, cambia_hash TEXT);
    CREATE TABLE IF NOT EXISTS _sicurezza_tentativi (chiave TEXT NOT NULL, quando INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS _sicurezza_tentativi_k ON _sicurezza_tentativi(chiave, quando);
    CREATE TABLE IF NOT EXISTS _sicurezza_lumi (mese TEXT NOT NULL, utente TEXT NOT NULL, token INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (mese, utente));`);
  const colonne = new Set(db.prepare('PRAGMA table_info(_sessioni)').all().map(c => c.name));
  for (const c of ['inizio', 'ultimo', 'ip']) if (!colonne.has(c)) db.exec(`ALTER TABLE _sessioni ADD COLUMN ${c} TEXT`);
  installaSql(db, { D, meta });
  const imp = {
    inattivita: () => Math.max(5, Number(meta.leggi(db, 'sicurezza.inattivita')) || MINUTI_INATTIVITA),
    allegatoMb: () => Math.min(25, Math.max(1, Number(meta.leggi(db, 'sicurezza.allegato_mb')) || 25)),
    webhookInterni: () => meta.leggi(db, 'sicurezza.webhook_interni') === '1',
    fuso: () => meta.leggi(db, 'fuso') || 'Europe/Rome',
    lumiBudget: () => Math.max(0, Number(meta.leggi(db, 'lumi.budget_mese')) || 0),
  };
  // le sessioni ferme si chiudono anche senza richieste: così chi ha solo la scheda aperta smette di ricevere gli eventi (SSE)
  const chiudiFerme = () => { try { db.prepare('DELETE FROM _sessioni WHERE COALESCE(ultimo, inizio) < ?').run(new Date(Date.now() - imp.inattivita() * 6e4).toISOString()); } catch {} };
  setInterval(chiudiFerme, 6e4).unref();
  const usaFuso = () => { impostaFuso(imp.fuso()); orologio.fuso = imp.fuso(); };
  usaFuso();
  const titolare = ctx => { if (serve(ctx).r.id !== 'titolare' || ctx.viaToken) throw new P.ErrorePermesso('Solo il titolare cambia le impostazioni di sicurezza'); return ctx; };
  const mese = () => new Date().toISOString().slice(0, 7);
  const usatiLumi = () => db.prepare('SELECT COALESCE(SUM(token), 0) n FROM _sicurezza_lumi WHERE mese = ?').get(mese()).n;
  // la password va cambiata finché l'impronta salvata è ancora quella di quando il titolare l'ha chiesto
  const deveCambiare = id => { const x = db.prepare('SELECT s.cambia_hash h, u.hash FROM _sicurezza_utenti s JOIN _utenti u ON u.id = s.utente WHERE s.utente = ?').get(id); return !!x?.h && x.h === x.hash; };
  // la password attuale, con lo stesso limite dei tentativi di accesso: chi ha in mano una sessione non la indovina a forza
  function attualeGiusta(utente, pw) {
    const chiave = `attuale:${utente}`, ora = Date.now();
    if (db.prepare('SELECT COUNT(*) n FROM _sicurezza_tentativi WHERE chiave = ? AND quando > ?').get(chiave, ora - FINESTRA).n >= TENTATIVI) throw new ErroreHttp(429, 'Troppi tentativi sbagliati: riprova fra 15 minuti');
    if (U.verificaPassword(db, utente, pw)) { db.prepare('DELETE FROM _sicurezza_tentativi WHERE chiave = ?').run(chiave); return true; }
    db.prepare('INSERT INTO _sicurezza_tentativi (chiave, quando) VALUES (?, ?)').run(chiave, ora); return false;
  }
  const LIBERE_CAMBIO = [/^GET \/api\/(stato|schema|moduli|sicurezza\/io|ruoli)$/, /^POST \/api\/(esci|sicurezza\/password)$/];

  // ---------- i controlli prima di ogni rotta ----------
  controllo(({ req, res, ctx, token, metodo, percorso, corpo, ip }) => {
    // 1. sessione: scade se ferma da troppo; altrimenti si segna l'ultimo uso (al massimo una scrittura al minuto)
    let nuovoCtx;
    if (token && ctx && !ctx.viaToken) {
      const s = db.prepare('SELECT inizio, ultimo, ip, agente FROM _sessioni WHERE token = ?').get(String(token));
      if (s) {
        const ora = Date.now(), ultimo = Date.parse(s.ultimo || s.inizio || '') || ora;
        if (ora - ultimo > imp.inattivita() * 6e4) { U.esci(db, token); nuovoCtx = { ctx: null }; ctx = null; }
        else if (!s.ultimo || ora - ultimo > 6e4 || s.ip !== ip || !s.agente) db.prepare("UPDATE _sessioni SET inizio = COALESCE(inizio, ?), ultimo = ?, ip = ?, agente = COALESCE(NULLIF(agente, ''), ?) WHERE token = ?")
          .run(new Date(ora).toISOString(), new Date(ora).toISOString(), String(ip || '').slice(0, 60), String(req.headers['user-agent'] || '').slice(0, 200), String(token));
      }
    }
    // 2. password da cambiare: finché non la cambia, solo le rotte per cambiarla
    if (ctx && !ctx.viaToken && deveCambiare(ctx.utente.id) && !LIBERE_CAMBIO.some(x => x.test(`${metodo} ${percorso}`)))
      throw new ErroreHttp(403, 'Prima di continuare cambia la password che ti hanno dato', { cambiaPassword: true });
    // 3. password robuste ovunque se ne sceglie una
    // (anche il PIN del banco: chi lo imposta per un altro entra al suo posto)
    const proprio = /^\/api\/utenti\/([^/]+)$/.exec(percorso);
    if (metodo === 'PATCH' && proprio && ctx && !ctx.viaToken && corpo?.pin != null && corpo.pin !== '' && decodifica(proprio[1]) === ctx.utente.id && !attualeGiusta(ctx.utente.id, corpo.attuale))
      throw new ErroreHttp(400, 'Per cambiare il PIN serve la password attuale');
    if (metodo !== 'GET' && corpo && corpo.password != null && corpo.password !== '' && (/^\/api\/(configura|utenti)$/.test(percorso) || /^\/api\/utenti\/[^/]+$/.test(percorso))) {
      let nome = corpo.nome, email = corpo.email;
      const m = /^\/api\/utenti\/([^/]+)$/.exec(percorso); if (m) { const u = db.prepare('SELECT nome, email FROM _utenti WHERE id = ?').get(decodifica(m[1])); nome ??= u?.nome; email ??= u?.email; }
      const no = robustezza(corpo.password, { nome, email }); if (no) throw new ErroreHttp(400, no);
      // la propria password si cambia solo conoscendo quella attuale (chi trova il PC acceso non se la prende)
      if (m && ctx && !ctx.viaToken && decodifica(m[1]) === ctx.utente.id && !attualeGiusta(ctx.utente.id, corpo.attuale)) throw new ErroreHttp(400, 'La password attuale non è giusta');
    }
    // 4. tentativi di accesso per account (o per PIN), oltre a quelli per indirizzo che conta già il server
    if (metodo === 'POST' && percorso === '/api/accedi') {
      const chiave = corpo?.pin != null ? `pin:${corpo.id}` : `email:${String(corpo?.email || '').trim().toLowerCase()}`, ora = Date.now();
      db.prepare('DELETE FROM _sicurezza_tentativi WHERE quando < ?').run(ora - FINESTRA);
      const l = db.prepare('SELECT quando FROM _sicurezza_tentativi WHERE chiave = ? ORDER BY quando').all(chiave);
      if (l.length >= TENTATIVI) throw new ErroreHttp(429, `Troppi tentativi sbagliati per questo account: riprova fra ${Math.max(1, Math.ceil((l[0].quando + FINESTRA - ora) / 6e4))} minuti`);
      res.once('finish', () => {
        try { if (res.statusCode === 200) db.prepare('DELETE FROM _sicurezza_tentativi WHERE chiave = ?').run(chiave);
          else if (res.statusCode === 401 || res.statusCode === 400) db.prepare('INSERT INTO _sicurezza_tentativi (chiave, quando) VALUES (?, ?)').run(chiave, Date.now()); } catch {}
      });
    }
    // 5. l'XML della FatturaPA è un potere esplicito (consuma un progressivo d'invio): il ruolo «lettura» non ce l'ha
    if (metodo === 'POST' && /^\/api\/documenti\/fatturapa\/[^/]+$/.test(percorso) && ctx && !puoFatturaPA(ctx, P)) throw new P.ErrorePermesso('Il tuo ruolo non esporta la fattura elettronica');
    // 6. Lumi: acceso per ruolo e con un budget mensile di token per tutta l'azienda
    if (metodo === 'POST' && percorso === '/api/lumi' && ctx) {
      if (!puoLumi(ctx)) throw new ErroreHttp(403, 'Lumi non è attivo per il tuo ruolo');
      const az = corpo?.azione;
      if (!['stato', 'elimina-file'].includes(az) && imp.lumiBudget() && usatiLumi() >= imp.lumiBudget()) throw new ErroreHttp(429, 'Lumi ha usato tutti i token di questo mese: il titolare può alzare il limite in Sicurezza');
      contaToken(res, ctx.utente.id);
    }
    // 7. allegati: mai file eseguibili o pagine web, e non oltre il limite scelto dal titolare (gli import hanno il loro)
    if (metodo === 'POST' && percorso === '/api/file/carica' && ctx) {
      if (VIETATE.has(extname(String(corpo?.nome || '')).toLowerCase())) throw new ErroreHttp(415, 'Questo tipo di file non si può allegare (programmi, script e pagine web)');
      if (Number(corpo?.max) !== 50 && Number(corpo?.dimensione) > imp.allegatoMb() * 1048576) throw new ErroreHttp(413, `Il file è troppo grande: al massimo ${imp.allegatoMb()} MB`);
    }
    return nuovoCtx;
  });
  // 7 bis. anche salvando la riga: il nome del file nel campo lo sceglie il browser (un «.txt» caricato non diventa «.html») e
  // l'annuncio { max: 50 } dell'import non porta un allegato oltre il limite del titolare
  D.ascolta((ev, dbEv, ctx) => {
    if (dbEv !== db || !ctx || !['crea', 'modifica'].includes(ev.tipo) || !ev.dopo) return;
    const def = S.leggi(db, ev.entita); if (!def) return;
    for (const c of S.campiAttivi(def).filter(c => ['file', 'immagine'].includes(c.tipo))) {
      const prima = new Set((Array.isArray(ev.prima?.[c.id]) ? ev.prima[c.id] : []).map(x => x?.id));
      for (const x of Array.isArray(ev.dopo[c.id]) ? ev.dopo[c.id] : []) {
        if (!x || prima.has(x.id)) continue;
        if (VIETATE.has(extname(String(x.nome || '')).toLowerCase())) { const m = `«${c.nome}»: questo tipo di file non si può allegare (programmi, script e pagine web)`; throw new D.ErroreDati(m, { [c.id]: m }); }
        const k = db.prepare('SELECT dimensione FROM _import_caricamenti WHERE id = ?').get(String(x.id));
        if (k && k.dimensione > imp.allegatoMb() * 1048576) { const m = `«${c.nome}»: il file è troppo grande, al massimo ${imp.allegatoMb()} MB`; throw new D.ErroreDati(m, { [c.id]: m }); }
      }
    }
  });
  // i token che Claude dice di aver usato arrivano nell'evento «fine» dello streaming: si sommano mentre passano
  function contaToken(res, utente) {
    const scrivi = res.write.bind(res); let coda = '';
    res.write = (x, ...a) => {
      try {
        coda = (coda + (typeof x === 'string' ? x : Buffer.from(x).toString('utf8'))).slice(-200000);
        let i; while ((i = coda.indexOf('\n\n')) >= 0) {
          const pezzo = coda.slice(0, i); coda = coda.slice(i + 2);
          if (!pezzo.includes('"fine"')) continue;
          const ev = JSON.parse(pezzo.replace(/^data:\s*/, '')), u = ev.uso || {};
          const n = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          if (ev.t === 'fine' && n > 0) db.prepare('INSERT INTO _sicurezza_lumi (mese, utente, token) VALUES (?, ?, ?) ON CONFLICT(mese, utente) DO UPDATE SET token = token + excluded.token').run(mese(), utente, Math.round(n));
        }
      } catch { /* un pezzo che non si legge non ferma la risposta */ }
      return scrivi(x, ...a);
    };
  }

  // ---------- la propria sicurezza ----------
  r('GET', '/api/sicurezza/io', ({ ctx }) => ({ deveCambiare: deveCambiare(serve(ctx).utente.id), inattivita: imp.inattivita() }));
  r('POST', '/api/sicurezza/password', ({ ctx, corpo, risposta }) => {
    if (serve(ctx).viaToken) throw new P.ErrorePermesso('Con un token non si cambia la password');
    if (!attualeGiusta(ctx.utente.id, corpo.attuale)) throw new ErroreHttp(400, 'La password attuale non è giusta');
    const no = robustezza(corpo.nuova, ctx.utente); if (no) throw new ErroreHttp(400, no);
    if (corpo.nuova === corpo.attuale) throw new ErroreHttp(400, 'La nuova password deve essere diversa da quella di prima');
    U.modificaUtente(db, ctx.utente.id, { password: corpo.nuova }, { utente: ctx.utente.id });   // chiude tutte le sessioni
    db.prepare('DELETE FROM _sicurezza_utenti WHERE utente = ?').run(ctx.utente.id);
    const s = U.accedi(db, { email: ctx.utente.email, password: corpo.nuova }, 'cambio password');   // questa resta aperta
    risposta.intestazioni['Set-Cookie'] = `lumi=${s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}`;
    return { ok: true };
  });
  const sessioniDi = (utente, token) => db.prepare('SELECT token, agente, inizio, ultimo, ip, scade FROM _sessioni WHERE utente = ? AND scade > ? ORDER BY COALESCE(ultimo, inizio) DESC')
    .all(utente, new Date().toISOString()).map(s => ({ id: impronta(s.token), agente: s.agente || '', inizio: s.inizio, ultimo: s.ultimo, ip: s.ip, scade: s.scade, questa: s.token === token }));
  r('GET', '/api/sicurezza/sessioni', ({ ctx, token }) => sessioniDi(serve(ctx).utente.id, token));
  r('DELETE', '/api/sicurezza/sessioni/:id', ({ ctx, p }) => {
    const s = db.prepare('SELECT token FROM _sessioni WHERE utente = ?').all(serve(ctx).utente.id).find(x => impronta(x.token) === p.id);
    if (!s) throw new ErroreHttp(404, 'Sessione sconosciuta'); U.esci(db, s.token); return { ok: true };
  });
  r('POST', '/api/sicurezza/esci-ovunque', ({ ctx, token }) => {
    const n = db.prepare('DELETE FROM _sessioni WHERE utente = ? AND token <> ?').run(serve(ctx).utente.id, String(token || '')).changes;
    return { chiuse: n };
  });

  // ---------- per chi gestisce le persone ----------
  r('POST', '/api/sicurezza/utenti/:id', ({ ctx, p, corpo }) => {
    if (!P.puoUtenti(serve(ctx)) || ctx.viaToken) throw new P.ErrorePermesso();
    const u = db.prepare('SELECT id, ruolo, hash FROM _utenti WHERE id = ?').get(p.id); if (!u) throw new ErroreHttp(404, 'Persona sconosciuta');
    if (u.ruolo === 'titolare' && ctx.r.id !== 'titolare') throw new P.ErrorePermesso();
    if (corpo.cambioObbligatorio != null) {
      if (corpo.cambioObbligatorio) db.prepare('INSERT INTO _sicurezza_utenti (utente, cambia_hash) VALUES (?, ?) ON CONFLICT(utente) DO UPDATE SET cambia_hash = excluded.cambia_hash').run(u.id, u.hash);
      else db.prepare('DELETE FROM _sicurezza_utenti WHERE utente = ?').run(u.id);
    }
    if (corpo.esciOvunque) db.prepare('DELETE FROM _sessioni WHERE utente = ?').run(u.id);
    return { deveCambiare: deveCambiare(u.id), sessioni: db.prepare('SELECT COUNT(*) n FROM _sessioni WHERE utente = ? AND scade > ?').get(u.id, new Date().toISOString()).n };
  });

  // ---------- impostazioni del titolare ----------
  const leggiImp = () => ({ inattivita: imp.inattivita(), allegatoMb: imp.allegatoMb(), webhookInterni: imp.webhookInterni(), fuso: imp.fuso(), lumiBudget: imp.lumiBudget(), lumiUsati: usatiLumi() });
  r('GET', '/api/sicurezza/impostazioni', ({ ctx }) => (titolare(ctx), leggiImp()));
  r('PUT', '/api/sicurezza/impostazioni', ({ ctx, corpo }) => {
    titolare(ctx);
    const intero = (v, min, max, m) => { const n = Math.round(Number(v)); if (!(n >= min && n <= max)) throw new ErroreHttp(400, m); return String(n); };
    if (corpo.inattivita != null) meta.scrivi(db, 'sicurezza.inattivita', intero(corpo.inattivita, 5, 43200, 'L\'inattività va da 5 minuti a 30 giorni'));
    if (corpo.allegatoMb != null) meta.scrivi(db, 'sicurezza.allegato_mb', intero(corpo.allegatoMb, 1, 25, 'Gli allegati vanno da 1 a 25 MB'));
    if (corpo.webhookInterni != null) meta.scrivi(db, 'sicurezza.webhook_interni', corpo.webhookInterni ? '1' : '0');
    if (corpo.lumiBudget != null) meta.scrivi(db, 'lumi.budget_mese', intero(corpo.lumiBudget, 0, 1e10, 'Budget di token non valido'));
    if (corpo.fuso != null) {
      try { new Intl.DateTimeFormat('it-IT', { timeZone: String(corpo.fuso) }); } catch { throw new ErroreHttp(400, 'Fuso orario sconosciuto (es. Europe/Rome)'); }
      meta.scrivi(db, 'fuso', String(corpo.fuso)); usaFuso();
    }
    return leggiImp();
  });
  r('GET', '/api/sicurezza/ruoli', ({ ctx }) => (titolare(ctx), P.ruoli(db).map(x => ({ id: x.id, nome: x.nome, fatturapa: x.id === 'titolare' || (x.fatturapa ?? (x.entita?.fatture?.modifica ?? x.entita?.['*']?.modifica ?? false)), lumi: x.id === 'titolare' || x.lumi !== false }))));
  r('PUT', '/api/sicurezza/ruoli/:id', ({ ctx, p, corpo }) => {
    titolare(ctx); if (p.id === 'titolare') throw new ErroreHttp(400, 'Il titolare può sempre tutto');
    const x = P.ruoli(db).find(x => x.id === p.id); if (!x) throw new ErroreHttp(404, 'Ruolo sconosciuto');
    const def = { ...x }; if (corpo.fatturapa != null) def.fatturapa = !!corpo.fatturapa; if (corpo.lumi != null) def.lumi = !!corpo.lumi;
    P.salvaRuolo(db, def); return { id: def.id, fatturapa: def.fatturapa, lumi: def.lumi !== false };
  });
  r('GET', '/api/sicurezza/lumi', ({ ctx }) => {
    titolare(ctx);
    return { mese: mese(), budget: imp.lumiBudget(), usati: usatiLumi(),
      persone: db.prepare('SELECT l.utente, u.nome, l.token FROM _sicurezza_lumi l LEFT JOIN _utenti u ON u.id = l.utente WHERE l.mese = ? ORDER BY l.token DESC').all(mese()) };
  });
}
