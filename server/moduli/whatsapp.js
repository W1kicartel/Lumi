// WhatsApp in Kubo: la posta in arrivo per cliente, il registro dei consensi, i modelli, le automazioni pronte, i costi
// e gli strumenti di Lumi. Solo la WhatsApp Business Platform ufficiale, attraverso uno dei tre connettori (uno acceso alla
// volta): «whatsapp» (Meta Cloud API), «twilio-whatsapp», «dialog360» (360dialog). Il modulo non sa quale c'è sotto: usa
// l'interfaccia comune man.whatsapp (testo, modello, documento, modelli, creaModello). Guida: docs/WHATSAPP.md.
// Le regole prima di ogni invio: numero E.164, STOP rispettato ovunque, consenso della categoria, finestra di 24 ore per
// il testo libero (fuori serve un modello approvato), ore di silenzio, limiti al giorno e per cliente. Rotte:
//   GET  /api/whatsapp/stato                        servizio attivo, impostazioni, non letti, costi del mese
//   PUT  /api/whatsapp/impostazioni                 (titolare) silenzio, limiti, prefisso, sconosciuti, orari, tariffe
//   GET  /api/whatsapp/conversazioni                le conversazioni, con i non letti e la finestra
//   GET  /api/whatsapp/conversazioni/:numero        i messaggi, la finestra, il consenso, il cliente; POST …/letti
//   POST /api/whatsapp/invia                        { numero | cliente, testo | modello: { nome, lingua }, variabili?, documento?, anteprima? }
//   GET  /api/whatsapp/cliente/:id                  la storia per la scheda del cliente
//   POST /api/whatsapp/consensi                     { numero | cliente, categoria, stato: 'si'|'no', fonte, testo }
//   POST /api/whatsapp/collega                      { numero, cliente } o { numero, crea: 'cliente' | 'lead' }
//   GET  /api/whatsapp/modelli · POST …/sincronizza · POST /api/whatsapp/modelli · PUT …/modelli/:nome/:lingua/mappa
//   GET  /api/whatsapp/ricette · PUT /api/whatsapp/ricette/:id · POST /api/whatsapp/ricette/:id/anteprima
//   GET  /api/whatsapp/registro                     i messaggi fermati o falliti, con il motivo
//   GET  /api/connettori/whatsapp/in                PUBBLICA: la verifica del webhook di Meta (hub.challenge)
//   GET  /api/whatsapp/file/:codice                 PUBBLICA: il PDF per Twilio, con un codice casuale, per 7 giorni
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { bus, PROVIDER } from './whatsapp-bus.js';
import * as R from './whatsapp-regole.js';
import { testo as testoWa } from './whatsapp-lingue.js';
import { istanze } from './connettori.js';
import { stampa, azienda as datiAzienda } from './documenti.js';
import { pdfTesto } from './fisco-file.js';
import { FUSO } from './agenda-aggregati.js';

// le automazioni pronte: il titolare le accende con un clic, sceglie il modello e i tempi. «evento»: girano sul motore
// delle automazioni (server/automazioni.js, azione «whatsapp»); «giro»: sul giro di ogni minuto di questo modulo;
// «entrata»: quando arriva un messaggio. «mappa»: le variabili proposte; «esempio»: il testo del modello da far approvare.
export const RICETTE = [
  { id: 'promemoria', categoria: 'utility', tipo: 'giro', opzioni: { ore: [24, 2] }, mappa: { 1: 'cliente.nome', 2: 'riga.quando', 3: 'azienda.nome' },
    esempio: 'Ciao {{1}}, ti ricordiamo l\'appuntamento di {{2}} da {{3}}. Se non puoi venire, rispondi a questo messaggio.' },
  { id: 'conferma', categoria: 'utility', tipo: 'evento', opzioni: {}, mappa: { 1: 'cliente.nome', 2: 'riga.quando', 3: 'azienda.nome' },
    esempio: 'Ciao {{1}}, la tua prenotazione per {{2}} da {{3}} è confermata. A presto!' },
  { id: 'pronto', categoria: 'utility', tipo: 'evento', opzioni: { valore: null }, mappa: { 1: 'cliente.nome', 2: 'riga._titolo', 3: 'riga.tracking|riga.spedizione|fisso:Ti aspettiamo!' },
    esempio: 'Ciao {{1}}, il tuo ordine {{2}} è pronto. {{3}}' },
  { id: 'documento', categoria: 'utility', tipo: 'evento', opzioni: { entita: null }, intestazione: 'DOCUMENT', mappa: { 1: 'cliente.nome', 2: 'riga._titolo', 3: 'riga.totale' },
    esempio: 'Ciao {{1}}, ti mandiamo {{2}}, totale {{3}} €. Grazie!' },
  { id: 'sollecito', categoria: 'utility', tipo: 'giro', opzioni: { giorni: 7 }, mappa: { 1: 'cliente.nome', 2: 'riga._titolo', 3: 'riga.scadenza' },
    esempio: 'Ciao {{1}}, risulta ancora da saldare {{2}}, scaduta il {{3}}. Se hai già pagato, ignora pure questo messaggio.' },
  { id: 'recensione', categoria: 'marketing', tipo: 'giro', opzioni: { giorni: 1, link: '' }, mappa: { 1: 'cliente.nome', 2: 'ricetta.link' },
    esempio: 'Ciao {{1}}, grazie per essere passato da noi! Ci lasci una recensione? {{2}}' },
  { id: 'compleanno', categoria: 'marketing', tipo: 'giro', opzioni: {}, mappa: { 1: 'cliente.nome', 2: 'azienda.nome' },
    esempio: 'Tanti auguri {{1}}! Da tutti noi di {{2}} una bellissima giornata.' },
  { id: 'riattivazione', categoria: 'marketing', tipo: 'giro', opzioni: { mesi: 6 }, mappa: { 1: 'cliente.nome', 2: 'azienda.nome' },
    esempio: 'Ciao {{1}}, è da un po\' che non ci vediamo! Ti aspettiamo da {{2}}.' },
  { id: 'fuori_orario', categoria: 'servizio', tipo: 'entrata', opzioni: { testo: 'Grazie del messaggio! Adesso siamo chiusi: ti rispondiamo appena riapriamo.' }, mappa: {} },
];
const PREDEFINITE = { prefisso: '+39', silenzio: { da: '21:00', a: '09:00' }, silenzioTutti: false, limiteGiorno: 250, maxClienteGiorno: 3, marketingOgniGiorni: 7,
  sconosciuti: 'chiedi', orari: { apre: '09:00', chiude: '19:00', giorni: [1, 2, 3, 4, 5, 6] }, lingua: 'it', tariffe: {} };
const ORDINE = { coda: 0, inviato: 1, consegnato: 2, letto: 3 };
const uguali = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); };

export const istanzeWa = new WeakMap();

export default function registra({ r, prima, db, S, D, P, A, meta, serve, ErroreHttp, manda, suErrore, lumi }) {
  db.exec(`CREATE TABLE IF NOT EXISTS _whatsapp_messaggi (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT NOT NULL, cliente TEXT, nome TEXT, verso TEXT NOT NULL,
      tipo TEXT NOT NULL, testo TEXT, modello TEXT, categoria TEXT, stato TEXT NOT NULL, motivo TEXT, id_remoto TEXT, provider TEXT, costo REAL NOT NULL DEFAULT 0,
      ricetta TEXT, chiave TEXT, chi TEXT, quando TEXT NOT NULL, letto INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS _whatsapp_messaggi_n ON _whatsapp_messaggi(numero, id);
    CREATE INDEX IF NOT EXISTS _whatsapp_messaggi_r ON _whatsapp_messaggi(id_remoto);
    CREATE TABLE IF NOT EXISTS _whatsapp_consensi (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT NOT NULL, cliente TEXT, categoria TEXT NOT NULL, stato TEXT NOT NULL,
      fonte TEXT, testo TEXT, chi TEXT, quando TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS _whatsapp_consensi_n ON _whatsapp_consensi(numero, id);
    CREATE TABLE IF NOT EXISTS _whatsapp_modelli (provider TEXT NOT NULL, nome TEXT NOT NULL, lingua TEXT NOT NULL, stato TEXT NOT NULL, categoria TEXT, corpo TEXT,
      intestazione TEXT, id_remoto TEXT, motivo TEXT, mappa TEXT, aggiornato TEXT, PRIMARY KEY (provider, nome, lingua));
    CREATE TABLE IF NOT EXISTS _whatsapp_ricette (id TEXT PRIMARY KEY, attiva INTEGER NOT NULL DEFAULT 0, modello TEXT, lingua TEXT, opzioni TEXT, aggiornato TEXT);
    CREATE TABLE IF NOT EXISTS _whatsapp_fatti (chiave TEXT PRIMARY KEY, quando TEXT NOT NULL);`);

  // ---------- lingue degli errori (whatsapp-lingue.js) ----------
  const linguaDi = ctx => { try { return (ctx?.utente && db.prepare('SELECT lingua FROM _lingue_utenti WHERE utente = ?').get(ctx.utente.id)?.lingua) || meta.leggi(db, 'lingue.azienda') || 'it'; } catch { return 'it'; } };
  const errore = (stato, chiave, p = {}) => new ErroreHttp(stato, testoWa('it', chiave, p), { _wa: chiave, _p: p });
  suErrore?.((corpo, { ctx }) => { if (!corpo?._wa) return corpo; const { _wa, _p, ...resto } = corpo; return { ...resto, motivo: _wa, errore: testoWa(linguaDi(ctx), _wa, _p) }; });
  const ora = () => new Date().toISOString();
  const fuso = () => meta.leggi(db, 'fuso') || FUSO;

  // ---------- il servizio attivo (uno solo) ----------
  const nucleo = () => istanze.get(db);
  const attivoId = () => PROVIDER.find(id => { try { return !!nucleo()?.attivo(id); } catch { return false; } }) || null;
  function prov() { const id = attivoId(); if (!id) throw errore(409, 'nessun-provider'); const k = nucleo().k(id); return { id, k, w: k.man.whatsapp, nome: k.man.nome }; }
  // un secondo servizio WhatsApp non si accende finché il primo è acceso: lo dice la pagina del connettore
  prima?.('PUT', '/api/connettori/:id', ({ percorso, corpo }) => {
    const id = decodeURIComponent(percorso.split('/')[3] || '');
    if (corpo?.attivo !== true || !PROVIDER.includes(id)) return;
    const altro = PROVIDER.find(x => x !== id && nucleo()?.attivo(x));
    if (altro) throw errore(409, 'un-provider', { attivo: nucleo().tutti().get(altro)?.man?.nome || altro });
  });

  // ---------- impostazioni ----------
  function imp() {
    let x = {}; try { x = JSON.parse(meta.leggi(db, 'whatsapp.impostazioni') || '{}'); } catch { x = {}; }
    return { ...PREDEFINITE, ...x, silenzio: { ...PREDEFINITE.silenzio, ...(x.silenzio || {}) }, orari: { ...PREDEFINITE.orari, ...(x.orari || {}) }, tariffe: { ...R.TARIFFE, ...(x.tariffe || {}) } };
  }

  // ---------- la rubrica: la sezione dei clienti con il telefono (clienti, soci…) ----------
  function rubrica() {
    const el = S.elenco(db).filter(e => !e.archiviata), cand = [...['clienti', 'soci'].map(id => el.find(e => e.id === id)).filter(Boolean), ...el];
    for (const def of cand) {
      const c = S.campiAttivi(def), tel = c.find(x => x.tipo === 'telefono'); if (!tel) continue;
      return { e: def.id, def, telefono: tel.id, titolo: S.campoTitolo(def)?.id || 'nome', nascita: c.find(x => ['data'].includes(x.tipo) && /nascit|compleann|birth/i.test(`${x.id} ${x.nome}`))?.id || null,
        note: c.find(x => x.tipo === 'testo_lungo' && /note/i.test(x.id))?.id || null };
    }
    return null;
  }
  let indice = null;
  D.ascolta((ev, dbEv) => { if (dbEv === db && indice && ev.entita === indice.e) indice = null; });
  function indiceNumeri() {
    const rb = rubrica(); if (!rb) return null; if (indice?.e === rb.e) return indice;
    const m = new Map(), pref = imp().prefisso;
    for (const x of db.prepare(`SELECT id, ${S.colonna(rb.telefono)} AS t FROM ${S.tabella(rb.e)} WHERE archiviato = 0 ORDER BY creato`).all()) { const n = R.e164(x.t, pref); if (n && !m.has(n)) m.set(n, x.id); }
    return (indice = { e: rb.e, m });
  }
  const clienteDi = numero => indiceNumeri()?.m.get(numero) || null;
  const leggiCliente = (id, ctx = null) => { const rb = rubrica(); if (!rb || !id) return null; try { return D.leggi(db, rb.e, String(id), ctx, { conRighe: false }); } catch { return null; } };
  const nomeDi = c => { const rb = rubrica(); return c && rb ? String(c[rb.titolo] ?? '') : ''; };

  // ---------- consensi: lo storico per numero, l'ultimo per categoria vale ----------
  function consenso(numero) {
    const righe = db.prepare('SELECT * FROM _whatsapp_consensi WHERE numero = ? ORDER BY id DESC').all(numero);
    // lo STOP lo toglie solo il cliente (START, RIPRENDI): conta l'ultima parola scritta da lui, non un «sì» segnato a mano dopo
    const parola = righe.find(x => /^parola/.test(x.fonte || '')) || null;
    return { servizio: righe.find(x => x.categoria === 'servizio') || null, marketing: righe.find(x => x.categoria === 'marketing') || null, stop: parola?.stato === 'no' ? parola : null, storia: righe.slice(0, 50) };
  }
  const scriviConsenso = ({ numero, cliente = null, categoria, stato, fonte = null, testo = null, chi = null }) => db.prepare('INSERT INTO _whatsapp_consensi (numero, cliente, categoria, stato, fonte, testo, chi, quando) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(numero, cliente, categoria, stato, fonte ? String(fonte).slice(0, 200) : null, testo ? String(testo).slice(0, 2000) : null, chi, ora());
  const ultimoIn = numero => db.prepare("SELECT MAX(quando) q FROM _whatsapp_messaggi WHERE numero = ? AND verso = 'in'").get(numero)?.q || null;
  const dataBreve = iso => { try { return new Intl.DateTimeFormat('it-IT', { timeZone: fuso(), day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)); } catch { return String(iso).slice(0, 10); } };

  // ---------- le regole prima di ogni invio: null se si può, altrimenti { motivo, p, riprova? } ----------
  function controlla({ numero, categoria, tipo, automatico = false, adesso = Date.now() }) {
    const i = imp(), c = consenso(numero), f = R.finestra(ultimoIn(numero), adesso), quale = R.CONSENSO_DI[categoria] || 'servizio', cs = c[quale];
    if (c.stop) return { motivo: 'stop', p: { quando: dataBreve(c.stop.quando) } };
    const manca = { motivo: quale === 'marketing' ? 'consenso-marketing' : 'consenso-servizio', p: {} };
    if (tipo === 'testo') { if (!f.aperta) return { motivo: 'finestra-chiusa', p: {} }; if (cs?.stato === 'no') return manca; }
    else if (cs?.stato !== 'si') return manca;
    if ((categoria === 'marketing' || (automatico && i.silenzioTutti)) && R.inSilenzio(adesso, i.silenzio, fuso())) return { motivo: 'silenzio', p: { da: i.silenzio.da, a: i.silenzio.a }, riprova: R.fineSilenzio(adesso, i.silenzio, fuso()) };
    if (tipo !== 'testo') {
      const ieri = new Date(adesso - 864e5).toISOString(), conta = (sql, ...a) => db.prepare(`SELECT COUNT(*) n FROM _whatsapp_messaggi WHERE verso = 'out' AND tipo = 'modello' AND stato NOT IN ('bloccato', 'fallito') AND quando > ? ${sql}`).get(...a).n;
      if (conta('', ieri) >= i.limiteGiorno) return { motivo: 'limite-giorno', p: { n: i.limiteGiorno } };
      if (conta('AND numero = ?', ieri, numero) >= i.maxClienteGiorno) return { motivo: 'limite-cliente', p: { n: i.maxClienteGiorno } };
      if (categoria === 'marketing' && conta("AND numero = ? AND categoria = 'marketing'", new Date(adesso - i.marketingOgniGiorni * 864e5).toISOString(), numero) > 0) return { motivo: 'limite-marketing', p: { giorni: i.marketingOgniGiorni } };
    }
    return null;
  }

  // ---------- modelli ----------
  const modelloDa = x => (x ? { ...x, idRemoto: x.id_remoto, mappa: JSON.parse(x.mappa || '{}'), variabili: R.variabiliDi(x.corpo) } : null);
  const modelli = (pid = attivoId()) => db.prepare('SELECT * FROM _whatsapp_modelli WHERE provider = ? ORDER BY nome, lingua').all(pid || '').map(modelloDa);
  const modelloDi = (nome, lingua) => modelloDa(db.prepare('SELECT * FROM _whatsapp_modelli WHERE provider = ? AND nome = ? AND (lingua = ? OR ? IS NULL) ORDER BY lingua = ? DESC LIMIT 1')
    .get(attivoId() || '', String(nome || ''), lingua || null, lingua || null, imp().lingua));
  function salvaModello(pid, m) {
    const vecchio = db.prepare('SELECT mappa FROM _whatsapp_modelli WHERE provider = ? AND nome = ? AND lingua = ?').get(pid, m.nome, m.lingua);
    db.prepare(`INSERT INTO _whatsapp_modelli (provider, nome, lingua, stato, categoria, corpo, intestazione, id_remoto, motivo, mappa, aggiornato) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, nome, lingua) DO UPDATE SET stato = excluded.stato, categoria = excluded.categoria, corpo = excluded.corpo, intestazione = excluded.intestazione,
      id_remoto = excluded.id_remoto, motivo = excluded.motivo, mappa = COALESCE(excluded.mappa, _whatsapp_modelli.mappa), aggiornato = excluded.aggiornato`)
      .run(pid, m.nome, m.lingua || 'it', m.stato || 'in_attesa', m.categoria || 'utility', m.corpo || '', m.intestazione || null, m.idRemoto || null, m.motivo || null,
        m.mappa ? JSON.stringify(m.mappa) : vecchio?.mappa ?? null, ora());
  }

  // ---------- i documenti: il PDF di una fattura o di un preventivo, e il link temporaneo per chi lo scarica (Twilio) ----------
  const eur = n => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
  function pdfDi(entita, id) {
    let s; try { s = stampa(db, { S, D, meta }, entita, String(id), null); } catch { throw errore(404, 'documento'); }
    const az = datiAzienda(db, meta), righe = [{ testo: s.titolo, grande: true }, az.ragione_sociale || meta.leggi(db, 'azienda') || '', [az.via, az.cap, az.comune].filter(Boolean).join(' '), az.piva ? `P.IVA ${az.piva}` : '', ' '];
    for (const l of s.totali?.linee || []) righe.push(`${l.descrizione || ''} — ${l.quantita} × ${eur(l.prezzo)} = ${eur(l.totale)}`);
    righe.push(' ', { testo: `Totale ${eur(s.totali?.totale)}`, grassetto: true });
    return { nome: `${s.titolo}.pdf`.replace(/[\\/:*?"<>|]+/g, '-'), tipo: 'application/pdf', dati: pdfTesto(righe.filter(x => x !== ''), { titolo: s.titolo }) };
  }
  const file = new Map();   // codice → { dati, tipo, nome, scade }: in memoria, per 7 giorni
  function linkDi(d, base) {
    const codice = randomBytes(24).toString('base64url'), adesso = Date.now();
    for (const [c, x] of file) if (x.scade < adesso) file.delete(c);
    file.set(codice, { ...d, scade: adesso + 7 * 864e5 }); return `${base}/api/whatsapp/file/${codice}`;
  }

  // ---------- il piano di un invio: chi, cosa, quanto costa, e se si può ----------
  const azienda = () => ({ nome: datiAzienda(db, meta).ragione_sociale || meta.leggi(db, 'azienda') || '' });
  function contestoRiga(e, riga) {
    if (!riga) return null; const def = S.leggi(db, e), t = def && S.campoTitolo(def);
    return { ...riga, _titolo: t ? (typeof riga[t.id] === 'object' ? riga[t.id]?.titolo : riga[t.id]) : riga.id };
  }
  function prepara(rich, { adesso = Date.now() } = {}) {
    const i = imp(), rb = rubrica();
    let cli = rich.cliente ? leggiCliente(rich.cliente) : null;
    const numero = rich.numero ? R.e164(rich.numero, i.prefisso) : cli && rb ? R.e164(cli[rb.telefono], i.prefisso) : null;
    if (!numero) return { no: rich.numero ? { motivo: 'numero', p: { numero: rich.numero } } : { motivo: 'senza-numero', p: {} } };
    if (!cli) cli = leggiCliente(clienteDi(numero));
    const fin = R.finestra(ultimoIn(numero), adesso);
    let tipo = 'testo', categoria = 'servizio', mod = null, valori = [], testo = String(rich.testo ?? '').trim();
    if (rich.modello) {
      mod = modelloDi(rich.modello.nome, rich.modello.lingua);
      if (!mod || mod.stato !== 'approvato') return { numero, no: { motivo: 'modello-sconosciuto', p: { nome: rich.modello.nome } } };
      tipo = 'modello'; categoria = mod.categoria || 'utility';
      const ric = RICETTE.find(x => x.id === rich.ricetta), mappa = Object.keys(mod.mappa || {}).length ? mod.mappa : ric?.mappa || { 1: 'cliente.nome' };
      const x = R.valoriModello(mod, mappa, { cliente: cli, azienda: azienda(), ...(rich.contesto || {}) }, { lingua: mod.lingua, fuso: fuso() });
      valori = x.valori; let mancano = x.mancano;
      if (Array.isArray(rich.variabili)) { rich.variabili.forEach((v, n) => { if (v != null && v !== '') valori[n] = String(v); }); mancano = mancano.filter(n => !valori[n - 1]); }
      if (mancano.length) return { numero, cliente: cli?.id || null, modello: mod, no: { motivo: 'variabili', p: { n: mancano.join(', ') } } };
      valori = valori.map(R.pulisciValore); testo = R.riempi(mod.corpo, valori);
    } else if (!testo) return { numero, no: { motivo: 'vuoto', p: {} } };
    const mese = new Date(adesso); mese.setUTCDate(1); mese.setUTCHours(0, 0, 0, 0);
    const servizi = db.prepare("SELECT COUNT(*) n FROM _whatsapp_messaggi WHERE verso = 'out' AND categoria = 'servizio' AND quando >= ?").get(mese.toISOString()).n;
    return { numero, cliente: cli?.id || null, nomeCliente: nomeDi(cli) || null, tipo, categoria, modello: mod, valori, testo, finestra: fin, documento: rich.documento || null,
      ricetta: rich.ricetta || null, costo: R.costo(categoria, { tariffe: i.tariffe, inFinestra: fin.aperta, provider: attivoId(), servizioGiaNelMese: servizi }),
      no: controlla({ numero, categoria, tipo, automatico: !!rich.automatico, adesso }) };
  }
  const motivo = (no, l = 'it') => testoWa(l, no.motivo, no.p);

  // ---------- i messaggi nel registro ----------
  function scriviUscita(pl, pid, { chi = null, chiave = null, stato = 'coda', motivoNo = null } = {}) {
    if (chiave) { const x = db.prepare("SELECT id FROM _whatsapp_messaggi WHERE chiave = ? AND verso = 'out'").get(chiave); if (x) { db.prepare('UPDATE _whatsapp_messaggi SET stato = ?, motivo = ?, quando = ? WHERE id = ?').run(stato, motivoNo, ora(), x.id); return x.id; } }
    return db.prepare(`INSERT INTO _whatsapp_messaggi (numero, cliente, nome, verso, tipo, testo, modello, categoria, stato, motivo, provider, costo, ricetta, chiave, chi, quando, letto)
      VALUES (?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(pl.numero, pl.cliente || null, pl.nomeCliente || null, pl.tipo || 'testo', pl.testo || null, pl.modello?.nome || null,
      pl.categoria || null, stato, motivoNo, pid, stato === 'bloccato' ? 0 : pl.costo || 0, pl.ricetta || null, chiave, chi, ora()).lastInsertRowid;
  }
  // l'evento va solo a chi legge la rubrica (senza rubrica, a nessuno: il numero non deve arrivare a tutti)
  const avvisa = numero => { try { const e = rubrica()?.e; if (e) manda?.({ tipo: 'whatsapp', numero, entita: e }); } catch { /* nessun browser collegato */ } };

  // ---------- l'invio vero, attraverso il servizio attivo ----------
  async function esegui(pl, { chi = null, chiave = null } = {}) {
    const pv = prov(), idRiga = scriviUscita(pl, pv.id, { chi, chiave });
    let doc = null, conIntestazione = false, x;
    try {
      if (pl.documento) { doc = pdfDi(pl.documento.entita, pl.documento.id); if (pv.w.linkPubblico) { const b = pv.w.linkPubblico(pv.k); if (!b) throw errore(409, 'indirizzo'); doc.link = linkDi(doc, b); } }
      conIntestazione = !!(doc && pl.modello?.intestazione === 'DOCUMENT');
      x = pl.tipo === 'modello'
        ? await pv.w.modello(pv.k, pl.numero, { nome: pl.modello.nome, lingua: pl.modello.lingua, valori: pl.valori, idRemoto: pl.modello.idRemoto, documento: conIntestazione ? doc : null })
        : await pv.w.testo(pv.k, pl.numero, pl.testo);
      db.prepare("UPDATE _whatsapp_messaggi SET stato = 'inviato', id_remoto = ?, motivo = NULL WHERE id = ?").run(x?.id || null, idRiga);
    } catch (e) {
      db.prepare("UPDATE _whatsapp_messaggi SET stato = 'fallito', motivo = ? WHERE id = ?").run(String(e.message).slice(0, 300), idRiga); avvisa(pl.numero);
      if (e instanceof ErroreHttp) throw e;
      throw errore(502, 'invio-fallito', { dettaglio: String(e.message).slice(0, 200) });
    }
    // il messaggio è partito: da qui in poi un errore resta sul PDF e non fa rimandare (né ripagare) il messaggio dalla coda
    // il PDF come messaggio a parte: solo dentro la finestra (fuori, un file libero non è permesso: serve il modello con l'intestazione)
    if (doc && !conIntestazione && R.finestra(ultimoIn(pl.numero)).aperta) {
      let y = null, sbaglio = null; try { y = await pv.w.documento(pv.k, pl.numero, { ...doc, didascalia: doc.nome }); } catch (e) { sbaglio = String(e.message).slice(0, 300); }
      db.prepare(`INSERT INTO _whatsapp_messaggi (numero, cliente, verso, tipo, testo, categoria, stato, motivo, id_remoto, provider, costo, ricetta, chi, quando, letto) VALUES (?, ?, 'out', 'documento', ?, 'servizio', ?, ?, ?, ?, 0, ?, ?, ?, 1)`)
        .run(pl.numero, pl.cliente || null, doc.nome, sbaglio ? 'fallito' : 'inviato', sbaglio, y?.id || null, pv.id, pl.ricetta || null, chi, ora());
    }
    avvisa(pl.numero);
    return { id: idRiga, idRemoto: x?.id || null, costo: pl.costo };
  }
  // un invio automatico va nella coda dei connettori (tentativi crescenti); al momento giusto si rifanno i controlli
  function accoda(rich, chiave, fra = 0) { const pid = attivoId(); if (!pid) return null; return nucleo().accoda(pid, 'whatsapp:invia', chiave, { rich, chiave }, { fra }); }
  async function lavora(corpo) {
    // un nuovo tentativo dopo un invio riuscito (un errore dopo, un riavvio a metà) non lo rimanda: una volta sola per chiave
    if (corpo.chiave && db.prepare("SELECT 1 FROM _whatsapp_messaggi WHERE chiave = ? AND verso = 'out' AND stato IN ('inviato', 'consegnato', 'letto')").get(corpo.chiave)) return 'già';
    const pl = prepara(corpo.rich || {});
    if (pl.no) {
      if (pl.no.riprova && pl.no.riprova > Date.now()) { accoda(corpo.rich, corpo.chiave, pl.no.riprova - Date.now()); return 'rimandato'; }
      if (pl.numero) scriviUscita(pl, attivoId(), { chiave: corpo.chiave, stato: 'bloccato', motivoNo: motivo(pl.no) });
      return 'bloccato';
    }
    await esegui(pl, { chi: corpo.rich?.ricetta ? `ricetta:${corpo.rich.ricetta}` : 'automazione', chiave: corpo.chiave });
    return 'inviato';
  }

  // ---------- in arrivo: messaggi, stati, modelli approvati o rifiutati ----------
  function creaCliente(numero, nome, modo) {
    const rb = rubrica(); if (!rb) return null;
    const v = { [rb.titolo]: nome || numero, [rb.telefono]: numero };
    if (modo === 'lead' && rb.note) v[rb.note] = 'Contatto arrivato da WhatsApp: da qualificare';
    try { return D.crea(db, rb.e, v, null).id; } catch { return null; }
  }
  async function ricevi(pid, lista) {
    let n = 0; const i = imp();
    for (const ev of lista) {
      if (ev.tipo === 'stato') {
        const x = db.prepare("SELECT id, stato, numero FROM _whatsapp_messaggi WHERE id_remoto = ? AND verso = 'out'").get(ev.id); if (!x) continue;
        if (ev.stato === 'fallito' || (ORDINE[ev.stato] ?? -1) > (ORDINE[x.stato] ?? -1)) db.prepare('UPDATE _whatsapp_messaggi SET stato = ?, motivo = COALESCE(?, motivo) WHERE id = ?').run(ev.stato, ev.errore || null, x.id);
        avvisa(x.numero); n++;
      } else if (ev.tipo === 'modello') {
        db.prepare('UPDATE _whatsapp_modelli SET stato = ?, motivo = ?, aggiornato = ? WHERE provider = ? AND nome = ? AND (lingua = ? OR ? IS NULL)').run(ev.stato, ev.motivo || null, ora(), pid, ev.nome, ev.lingua || null, ev.lingua || null); n++;
      } else if (ev.tipo === 'messaggio') {
        const numero = R.e164(ev.da, i.prefisso); if (!numero) continue;
        if (ev.id && db.prepare("SELECT 1 FROM _whatsapp_messaggi WHERE id_remoto = ? AND verso = 'in'").get(ev.id)) continue;
        let cliente = clienteDi(numero);
        if (!cliente && ['cliente', 'lead'].includes(i.sconosciuti)) cliente = creaCliente(numero, ev.nome, i.sconosciuti);
        db.prepare(`INSERT INTO _whatsapp_messaggi (numero, cliente, nome, verso, tipo, testo, categoria, stato, id_remoto, provider, quando, letto) VALUES (?, ?, ?, 'in', ?, ?, 'servizio', 'ricevuto', ?, ?, ?, 0)`)
          .run(numero, cliente, ev.nome || null, ev.media ? 'media' : 'testo', ev.testo ?? (ev.media ? `[${ev.media}]` : ''), ev.id || null, pid, ev.quando || ora());
        const parola = R.parolaChiave(ev.testo);
        if (parola === 'stop') for (const c of ['servizio', 'marketing']) scriviConsenso({ numero, cliente, categoria: c, stato: 'no', fonte: `parola:${String(ev.testo).trim().slice(0, 30)}`, testo: ev.testo, chi: 'cliente' });
        if (parola === 'ripresa') scriviConsenso({ numero, cliente, categoria: 'servizio', stato: 'si', fonte: `parola:${String(ev.testo).trim().slice(0, 30)}`, testo: ev.testo, chi: 'cliente' });
        avvisa(numero); n++;
        // la risposta fuori orario non fa aspettare il webhook (Meta vuole il 200 in pochi secondi): la riga si scrive subito, l'invio dopo
        if (!parola) fuoriOrario(numero, cliente).catch(e => nucleo()?.annota(pid, 'uscita', 'errore', 'fuori_orario', String(e.message).slice(0, 200)));
      }
    }
    return n ? `${n} eventi` : 'ignorato';
  }
  // la risposta automatica fuori orario: testo libero (la finestra si è appena aperta), al massimo una ogni 12 ore per numero
  async function fuoriOrario(numero, cliente, adesso = Date.now()) {
    const st = statoRicetta('fuori_orario'); if (!st.attiva || R.aperto(adesso, imp().orari, fuso())) return null;
    if (db.prepare("SELECT 1 FROM _whatsapp_messaggi WHERE numero = ? AND ricetta = 'fuori_orario' AND quando > ?").get(numero, new Date(adesso - 12 * 36e5).toISOString())) return null;
    const pl = prepara({ numero, cliente, testo: st.opzioni.testo, ricetta: 'fuori_orario' }); if (pl.no) return null;
    return esegui(pl, { chi: 'ricetta:fuori_orario' });
  }

  // ---------- ricette ----------
  function statoRicetta(id) {
    const def = RICETTE.find(x => x.id === id), x = db.prepare('SELECT * FROM _whatsapp_ricette WHERE id = ?').get(id);
    let o = {}; try { o = JSON.parse(x?.opzioni || '{}'); } catch { o = {}; }
    return { id, attiva: !!x?.attiva, modello: x?.modello || null, lingua: x?.lingua || null, opzioni: { ...(def?.opzioni || {}), ...o } };
  }
  // dove guarda una ricetta: la sezione, il campo data, il collegamento al cliente o il telefono sulla riga
  function bersaglio(ric, opz = {}) {
    const rb = rubrica(), el = S.elenco(db).filter(e => !e.archiviata);
    const collega = def => S.campiAttivi(def).find(c => c.tipo === 'relazione' && !c.molti && c.entita === rb?.e)?.id || null;
    const tel = def => S.campiAttivi(def).find(c => c.tipo === 'telefono')?.id || null;
    const stato = def => S.campiAttivi(def).find(c => c.tipo === 'stato');
    const con = (def, extra) => ({ e: def.id, cliente: collega(def), telefono: collega(def) ? null : tel(def), ...extra });
    const prima = (ids, ok) => [...ids.map(id => el.find(e => e.id === id)).filter(Boolean), ...el].find(d => d.id !== rb?.e && ok(d));
    if (!rb) return null;
    if (ric.id === 'promemoria' || ric.id === 'conferma') {
      const d = prima(['appuntamenti', 'prenotazioni'], d => S.campiAttivi(d).some(c => c.tipo === 'data_ora') && (collega(d) || tel(d))); if (!d) return null;
      return con(d, { quando: S.campiAttivi(d).find(c => c.tipo === 'data_ora').id, stato: stato(d)?.id || null });
    }
    if (ric.id === 'pronto') {
      const ok = d => collega(d) && stato(d)?.opzioni?.some(o => /pront|spedit|evas/i.test(o.id ?? o));
      const d = (opz.entita && el.find(e => e.id === opz.entita && ok(e))) || prima(['interventi', 'commesse', 'ordini_clienti', 'vendite'], ok); if (!d) return null;
      const s = stato(d), valore = opz.valore || (s.opzioni.map(o => o.id ?? o).find(o => /pront|spedit|evas/i.test(o)));
      return con(d, { stato: s.id, valore });
    }
    if (ric.id === 'documento') {
      const val = { fatture: 'emessa', preventivi: 'inviato' }, d = (opz.entita && el.find(e => e.id === opz.entita)) || prima(['fatture', 'preventivi'], d => val[d.id] && collega(d)); if (!d || !collega(d)) return null;
      return con(d, { stato: stato(d)?.id || 'stato', valore: opz.valore || val[d.id] || 'emessa' });
    }
    if (ric.id === 'sollecito') { const d = el.find(e => e.id === 'fatture'); return d && collega(d) && S.campo(d, 'scadenza') ? con(d, { scadenza: 'scadenza' }) : null; }
    if (ric.id === 'recensione' || ric.id === 'riattivazione') {
      const d = prima(['vendite', 'appuntamenti', 'interventi', 'commesse', 'contratti'], d => collega(d) && S.campiAttivi(d).some(c => ['data', 'data_ora'].includes(c.tipo))); if (!d) return null;
      return con(d, { data: S.campiAttivi(d).find(c => ['data', 'data_ora'].includes(c.tipo)).id, stato: stato(d)?.id || null });
    }
    if (ric.id === 'compleanno') return rb.nascita ? { e: rb.e, nascita: rb.nascita, rubrica: true } : null;
    if (ric.id === 'fuori_orario') return { e: rb.e, rubrica: true };
    return null;
  }
  const destinatario = (b, riga) => (b.rubrica ? { cliente: riga.id } : b.cliente ? { cliente: riga[b.cliente]?.id ?? riga[b.cliente] ?? null } : { numero: riga[b.telefono] || null });
  // una ricetta su una riga: una volta sola per chiave (riga + momento), poi in coda
  function lancia(ric, b, riga, chiave) {
    const st = statoRicetta(ric.id); if (!st.attiva || !st.modello) return 'spenta';
    const dest = destinatario(b, riga); if (!dest.cliente && !dest.numero) return 'senza-destinatario';
    if (db.prepare('SELECT 1 FROM _whatsapp_fatti WHERE chiave = ?').get(chiave)) return 'già';
    db.prepare('INSERT INTO _whatsapp_fatti (chiave, quando) VALUES (?, ?)').run(chiave, ora());
    const rich = { ...dest, modello: { nome: st.modello, lingua: st.lingua }, contesto: { riga: contestoRiga(b.e, riga), ricetta: st.opzioni }, automatico: true, ricetta: ric.id,
      documento: ric.id === 'documento' ? { entita: b.e, id: riga.id } : null };
    return accoda(rich, chiave) ? 'in-coda' : 'spenta';
  }
  // le ricette «evento» diventano automazioni del motore (server/automazioni.js), con l'azione «whatsapp»
  function sincronizzaAutomazione(ric) {
    if (ric.tipo !== 'evento') return;
    const st = statoRicetta(ric.id), b = bersaglio(ric, st.opzioni), id = `whatsapp-${ric.id}`;
    if (!b) { try { A.elimina(db, id); } catch { /* non c'era */ } return; }
    const quando = ric.id === 'conferma' ? (b.stato && st.opzioni.valore ? { quando: 'campo_cambia', campo: b.stato, a: st.opzioni.valore } : { quando: 'creato' }) : { quando: 'campo_cambia', campo: b.stato, a: b.valore };
    A.salva(db, { id, nome: `WhatsApp: ${ric.id}`, entita: b.e, ...quando, azioni: [{ tipo: 'whatsapp', ricetta: ric.id }], attiva: st.attiva && !!st.modello });
  }
  // l'azione «whatsapp» del motore: una ricetta, oppure un modello con le variabili già calcolate dalle formule
  A.suWhatsapp?.(({ db: dbA, azione, variabili, testo, ev }) => {
    if (dbA !== db) return;
    const riga = ev.dopo || ev.prima; if (!riga) return;
    if (azione.ricetta) { const ric = RICETTE.find(x => x.id === azione.ricetta), b = ric && bersaglio(ric, statoRicetta(ric.id).opzioni); if (b) lancia(ric, b, { ...riga, id: ev.id }, `${ric.id}:${ev.id}:${ev.tipo === 'crea' ? 'nuovo' : String(riga[b.stato] ?? '')}`); return; }
    const rb = rubrica(); if (!rb) return;
    const def = S.leggi(db, ev.entita), campo = azione.cliente || (ev.entita === rb.e ? null : S.campiAttivi(def).find(c => c.tipo === 'relazione' && c.entita === rb.e)?.id);
    const cliente = ev.entita === rb.e ? ev.id : riga[campo]?.id ?? riga[campo] ?? null; if (!cliente) return;
    const rich = { cliente, automatico: true, ...(azione.modello ? { modello: { nome: azione.modello, lingua: azione.lingua || null }, variabili: Object.keys(variabili || {}).sort((a, b) => a - b).map(n => variabili[n]) } : { testo }),
      contesto: { riga: contestoRiga(ev.entita, { ...riga, id: ev.id }) } };
    accoda(rich, `auto:${ev.entita}:${ev.id}:${Date.now()}`);
  });

  // il giro di ogni minuto: promemoria (sempre), e una volta al giorno dopo le 10 solleciti, recensioni, compleanni, riattivazioni
  const giornoLocale = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: fuso() });
  function giro(adesso = Date.now()) {
    if (!attivoId()) return { fatti: 0 };
    let fatti = 0; const tutte = righe => righe, el = (e, opz) => { try { return D.elenca(db, e, { perPagina: 1000, ...opz }, null).righe; } catch { return []; } };
    const ric = id => RICETTE.find(x => x.id === id);
    const p = statoRicetta('promemoria'), bp = p.attiva && bersaglio(ric('promemoria'));
    if (bp) {
      const ore = [...new Set((p.opzioni.ore || [24]).map(Number).filter(x => x > 0))].sort((a, b) => b - a);
      const righe = el(bp.e, { filtri: [{ campo: bp.quando, op: '>', valore: new Date(adesso).toISOString() }, { campo: bp.quando, op: '<=', valore: new Date(adesso + ore[0] * 36e5).toISOString() }] });
      for (const riga of tutte(righe)) {
        if (bp.stato && /annull|non_venut|disdett/i.test(String(riga[bp.stato] ?? ''))) continue;
        const manca = (Date.parse(riga[bp.quando]) - adesso) / 36e5;
        // ogni promemoria nella sua fascia: il 24 h fra 24 e 2 ore prima, il 2 h nelle ultime 2 ore (niente doppioni ravvicinati)
        ore.forEach((h, j) => { const sotto = ore[j + 1] || 0; if (manca <= h && manca > sotto && lancia(ric('promemoria'), bp, riga, `promemoria:${riga.id}:${h}:${riga[bp.quando]}`) === 'in-coda') fatti++; });
      }
    }
    const oggi = giornoLocale(adesso);
    if (R.minutiLocali(adesso, fuso()) >= 600 && meta.leggi(db, 'whatsapp.giorno') !== oggi) {
      meta.scrivi(db, 'whatsapp.giorno', oggi);
      const s = statoRicetta('sollecito'), bs = s.attiva && bersaglio(ric('sollecito'));
      if (bs) { const limite = new Date(Date.parse(oggi) - Number(s.opzioni.giorni || 7) * 864e5).toISOString().slice(0, 10);
        for (const f of el(bs.e, { filtri: [{ campo: 'scadenza', op: '<=', valore: limite }] })) if (['emessa', 'inviata'].includes(f.stato) && lancia(ric('sollecito'), bs, f, `sollecito:${f.id}`) === 'in-coda') fatti++; }
      const rc = statoRicetta('recensione'), br = rc.attiva && bersaglio(ric('recensione'));
      if (br) { const giorno = new Date(Date.parse(oggi) - Number(rc.opzioni.giorni || 1) * 864e5).toISOString().slice(0, 10);
        for (const v of el(br.e, {})) if (String(v[br.data] || '').slice(0, 10) === giorno && !/annull|bozza|aperta|rifiut/i.test(String(v[br.stato] ?? '')) && lancia(ric('recensione'), br, v, `recensione:${v.id}`) === 'in-coda') fatti++; }
      const cp = statoRicetta('compleanno'), bc = cp.attiva && bersaglio(ric('compleanno'));
      if (bc) for (const c of el(bc.e, {})) if (String(c[bc.nascita] || '').slice(5, 10) === oggi.slice(5, 10) && lancia(ric('compleanno'), bc, c, `compleanno:${c.id}:${oggi.slice(0, 4)}`) === 'in-coda') fatti++;
      const ra = statoRicetta('riattivazione'), bra = ra.attiva && bersaglio(ric('riattivazione'));
      if (bra) {
        const soglia = new Date(Date.parse(oggi) - Number(ra.opzioni.mesi || 6) * 30 * 864e5).toISOString().slice(0, 10), ultimo = new Map();
        for (const v of el(bra.e, {})) { const c = v[bra.cliente]?.id ?? v[bra.cliente]; const d = String(v[bra.data] || '').slice(0, 10); if (c && d > (ultimo.get(c) || '')) ultimo.set(c, d); }
        for (const [c, d] of ultimo) if (d < soglia && lancia(ric('riattivazione'), { e: rubrica().e, rubrica: true }, { id: c }, `riattivazione:${c}:${d}`) === 'in-coda') fatti++;
      }
    }
    return { fatti };
  }
  const battito = setInterval(() => { try { giro(); } catch (e) { console.error('whatsapp', e); } }, 60000); battito.unref?.();

  // ---------- Lumi: whatsapp_scrivi (scheda di conferma) e whatsapp_leggi ----------
  function trovaCliente(chi, ctx) {
    const rb = rubrica(); if (!rb) throw errore(409, 'senza-rubrica');
    const t = String(chi || '').trim(); let c = null; try { c = D.leggi(db, rb.e, t, ctx, { conRighe: false }); } catch { c = null; } if (c) return c;
    const righe = D.elenca(db, rb.e, { cerca: t, perPagina: 8 }, ctx).righe, esatto = righe.filter(x => String(x[rb.titolo] || '').toLowerCase() === t.toLowerCase());
    if (esatto.length === 1 || righe.length === 1) return esatto[0] || righe[0];
    if (!righe.length) throw errore(404, 'cliente-sconosciuto', { nome: t });
    throw errore(409, 'clienti-ambigui', { nomi: righe.map(x => x[rb.titolo]).join(', ') });
  }
  function pianoLumi(ctx, args) {
    const c = trovaCliente(args.cliente, ctx), rb = rubrica(), i = imp(), numero = R.e164(c[rb.telefono], i.prefisso);
    if (!numero) return { no: { motivo: 'senza-numero', p: {} }, cliente: c };
    const fin = R.finestra(ultimoIn(numero));
    if (fin.aperta && !args.marketing) return { piano: prepara({ cliente: c.id, testo: args.messaggio }), cliente: c };
    const m = R.scegliModello(args.messaggio, modelli(), args.marketing ? { categoria: 'marketing' } : {}) || (args.marketing ? null : R.scegliModello(args.messaggio, modelli()));
    if (!m) return { no: { motivo: 'nessun-modello', p: {} }, cliente: c };
    return { piano: prepara({ cliente: c.id, modello: { nome: m.nome, lingua: m.lingua }, variabili: args.variabili }), cliente: c, scelto: m };
  }
  const oraLocale = (iso, l) => { try { return new Intl.DateTimeFormat(l, { timeZone: fuso(), hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date(iso)); } catch { return iso; } };
  // quello che la scheda di conferma ha mostrato: se all'esecuzione il piano è diverso (la finestra si è chiusa o aperta, un
  // altro modello), non parte niente che l'utente non abbia visto
  const visti = new Map(), firma = pl => JSON.stringify([pl.numero, pl.tipo, pl.modello?.nome || null, pl.modello?.lingua || null, pl.testo]);
  const chiaveVista = (ctx, args) => `${ctx?.utente?.id ?? ''}|${JSON.stringify(args)}`;
  const puoScrivere = ctx => { const rb = rubrica(); return !!attivoId() && !!rb && P.puo(ctx, rb.e, 'modifica'); };
  const puoLeggere = ctx => { const rb = rubrica(); return !!rb && P.puo(ctx, rb.e, 'leggi'); };
  lumi?.strumento({
    nome: 'whatsapp_scrivi', tipo: 'scrivi', permesso: puoScrivere,
    descrizione: 'Scrive a un cliente su WhatsApp (solo con il servizio ufficiale collegato). Controlla da solo il consenso, lo STOP e la finestra di 24 ore: dentro manda il testo così com\'è, fuori sceglie il modello approvato più adatto e ne riempie le variabili. Scrivi «messaggio» già pronto per il cliente, breve e cortese. Se la scheda risponde con un errore, riferiscilo: non aggirarlo.',
    schema: { type: 'object', properties: { cliente: { type: 'string', description: 'nome (anche solo il cognome) o id del cliente' }, messaggio: { type: 'string', maxLength: 1000, description: 'il testo da mandare, come lo leggerà il cliente' },
      marketing: { type: 'boolean', description: 'true se è un messaggio promozionale (serve il consenso marketing)' }, variabili: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'i valori per {{1}}, {{2}}… del modello, se la scheda dice che mancano' } }, required: ['cliente', 'messaggio'] },
    anteprima: async ({ ctx, args, lingua = 'it' }) => {
      let x; try { x = pianoLumi(ctx, args); } catch (e) { if (e?.extra?._wa) return { errore: testoWa(lingua, e.extra._wa, e.extra._p) }; throw e; }
      const pl = x.piano, no = x.no || pl?.no; if (no) return { errore: motivo(no, lingua) };
      if (visti.size > 500) visti.delete(visti.keys().next().value);
      visti.set(chiaveVista(ctx, args), firma(pl));
      const T = k => testoWa(lingua, k);
      return { titolo: T('lumi.titolo'), righe: [[T('lumi.a'), `${nomeDi(x.cliente)} · ${pl.numero}`],
        [T('lumi.finestra'), pl.finestra.aperta ? testoWa(lingua, 'lumi.aperta', { ora: oraLocale(pl.finestra.scade, lingua) }) : T('lumi.chiusa')],
        ...(pl.modello ? [[T('lumi.modello'), `${pl.modello.nome} (${pl.modello.categoria}, ${pl.modello.lingua})`]] : []), [T('lumi.messaggio'), pl.testo],
        [T('lumi.costo'), new Intl.NumberFormat(lingua, { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 }).format(pl.costo)]], avvisi: [] };
    },
    esegui: async ({ ctx, args }) => {
      const x = pianoLumi(ctx, args), no = x.no || x.piano?.no; if (no) throw errore(409, no.motivo, no.p);
      const k = chiaveVista(ctx, args), visto = visti.get(k); visti.delete(k);
      if (visto !== firma(x.piano)) throw errore(409, 'cambiato');
      const r = await esegui(x.piano, { chi: ctx?.utente?.nome || null });
      return { inviato: true, a: nomeDi(x.cliente), numero: x.piano.numero, modello: x.piano.modello?.nome || null, testo: x.piano.testo, costo: r.costo };
    },
  });
  lumi?.strumento({
    nome: 'whatsapp_leggi', tipo: 'leggi', permesso: puoLeggere,
    descrizione: 'WhatsApp: senza cliente, le conversazioni con messaggi non letti; con un cliente, gli ultimi messaggi, la finestra di 24 ore e i consensi. Usalo per riassumere una conversazione.',
    schema: { type: 'object', properties: { cliente: { type: 'string', description: 'nome o id del cliente (facoltativo)' } } },
    esegui: async ({ ctx, args }) => {
      if (!args.cliente) return { non_letti: conversazioni(ctx).filter(c => c.nonLetti > 0).map(c => ({ cliente: c.nome, numero: c.numero, non_letti: c.nonLetti, ultimo: c.testo, quando: c.quando })) };
      const c = trovaCliente(args.cliente, ctx), numero = R.e164(c[rubrica().telefono], imp().prefisso); if (!numero) throw errore(409, 'senza-numero');
      const cs = consenso(numero);
      return { cliente: nomeDi(c), numero, finestra: R.finestra(ultimoIn(numero)), consenso: { servizio: cs.servizio?.stato || null, marketing: cs.marketing?.stato || null },
        messaggi: db.prepare('SELECT verso, quando, testo, stato, modello FROM _whatsapp_messaggi WHERE numero = ? ORDER BY id DESC LIMIT 20').all(numero).reverse() };
    },
  });
  lumi?.istruzioni('WhatsApp: per scrivere a un cliente usa whatsapp_scrivi (mai inventare un invio); per leggere o riassumere le chat usa whatsapp_leggi. Se manca il consenso o il cliente ha scritto STOP, spiega il motivo e non insistere.');

  // ---------- le conversazioni ----------
  // chi vede solo i clienti che ha creato lui («soloPropri») vede solo le loro conversazioni (non quelle dei numeri sconosciuti)
  const vede = (ctx, numero, cid = clienteDi(numero)) => { const rb = rubrica(); return !rb || !P.soloPropri(ctx, rb.e) || !!(cid && leggiCliente(cid, ctx)); };
  const vedeONo = (ctx, numero) => { if (!vede(ctx, numero)) throw new P.ErrorePermesso(); return numero; };
  function conversazioni(ctx = null) {
    const rb = rubrica();
    return db.prepare(`SELECT numero, MAX(id) ultimo, SUM(CASE WHEN verso = 'in' AND letto = 0 THEN 1 ELSE 0 END) nonLetti, MAX(CASE WHEN verso = 'in' THEN quando END) ultimoIn,
        MAX(cliente) cliente, MAX(CASE WHEN verso = 'in' THEN nome END) profilo FROM _whatsapp_messaggi WHERE stato <> 'bloccato' GROUP BY numero ORDER BY ultimo DESC LIMIT 300`).all()
      .filter(x => vede(ctx, x.numero, clienteDi(x.numero) || x.cliente)).map(x => {
      const u = db.prepare('SELECT testo, quando, verso FROM _whatsapp_messaggi WHERE id = ?').get(x.ultimo), cid = clienteDi(x.numero) || x.cliente, c = rb && cid ? leggiCliente(cid) : null;
      return { numero: x.numero, cliente: c?.id || null, nome: nomeDi(c) || x.profilo || x.numero, nonLetti: x.nonLetti, testo: u?.testo || '', quando: u?.quando, verso: u?.verso, finestra: R.finestra(x.ultimoIn) };
    });
  }
  function conversazione(numero) {
    const c = leggiCliente(clienteDi(numero)), cs = consenso(numero);
    const profilo = db.prepare("SELECT nome FROM _whatsapp_messaggi WHERE numero = ? AND verso = 'in' AND nome IS NOT NULL ORDER BY id DESC LIMIT 1").get(numero)?.nome || null;
    return { numero, cliente: c ? { id: c.id, nome: nomeDi(c), entita: rubrica()?.e } : null, profilo, finestra: R.finestra(ultimoIn(numero)), consenso: cs,
      messaggi: db.prepare('SELECT * FROM _whatsapp_messaggi WHERE numero = ? ORDER BY id DESC LIMIT 200').all(numero).reverse() };
  }
  const costiMese = (adesso = Date.now()) => {
    const d = new Date(adesso); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    return db.prepare("SELECT categoria, COUNT(*) n, ROUND(SUM(costo), 4) euro FROM _whatsapp_messaggi WHERE verso = 'out' AND stato NOT IN ('bloccato', 'fallito') AND quando >= ? GROUP BY categoria").all(d.toISOString());
  };

  // ---------- rotte ----------
  const leggi = ctx => { serve(ctx); if (!puoLeggere(ctx)) throw new P.ErrorePermesso(); return ctx; };
  const scrive = ctx => { serve(ctx); const rb = rubrica(); if (!rb || !P.puo(ctx, rb.e, 'modifica')) throw new P.ErrorePermesso(); return ctx; };
  const titolare = ctx => { serve(ctx); if (ctx.r.id !== 'titolare' || ctx.viaToken) throw errore(403, 'solo-titolare'); return ctx; };
  const numeroDa = s => { const n = R.e164(s, imp().prefisso); if (!n) throw errore(400, 'numero', { numero: s }); return n; };

  r('GET', '/api/whatsapp/stato', ({ ctx }) => {
    leggi(ctx); const id = attivoId(), k = id ? nucleo().k(id) : null;
    return { provider: id, nome: k?.man.nome || null, disponibili: PROVIDER.filter(x => nucleo()?.tutti().get(x)?.man).map(x => ({ id: x, nome: nucleo().tutti().get(x).man.nome, attivo: x === id })),
      webhook: k?.man.whatsapp.webhook?.(k) || null, creaModelli: !!k?.man.whatsapp.creaModelli, rubrica: rubrica()?.e || null,
      nonLetti: db.prepare("SELECT COUNT(*) n FROM _whatsapp_messaggi WHERE verso = 'in' AND letto = 0").get().n, costi: costiMese(), impostazioni: imp(), titolare: ctx.r.id === 'titolare' };
  });
  r('PUT', '/api/whatsapp/impostazioni', ({ ctx, corpo }) => {
    titolare(ctx); const v = imp(), x = {};
    if (corpo.prefisso != null) { if (!/^\+\d{1,4}$/.test(String(corpo.prefisso))) throw errore(400, 'numero', { numero: corpo.prefisso }); x.prefisso = String(corpo.prefisso); }
    for (const n of ['limiteGiorno', 'maxClienteGiorno', 'marketingOgniGiorni']) if (corpo[n] != null) x[n] = Math.max(0, Math.min(100000, Math.round(Number(corpo[n]) || 0)));
    if (corpo.silenzio) x.silenzio = { da: /^\d{2}:\d{2}$/.test(corpo.silenzio.da) ? corpo.silenzio.da : v.silenzio.da, a: /^\d{2}:\d{2}$/.test(corpo.silenzio.a) ? corpo.silenzio.a : v.silenzio.a };
    if (corpo.silenzioTutti != null) x.silenzioTutti = !!corpo.silenzioTutti;
    if (['chiedi', 'cliente', 'lead'].includes(corpo.sconosciuti)) x.sconosciuti = corpo.sconosciuti;
    if (corpo.orari) x.orari = { apre: /^\d{2}:\d{2}$/.test(corpo.orari.apre) ? corpo.orari.apre : v.orari.apre, chiude: /^\d{2}:\d{2}$/.test(corpo.orari.chiude) ? corpo.orari.chiude : v.orari.chiude,
      giorni: Array.isArray(corpo.orari.giorni) ? corpo.orari.giorni.map(Number).filter(g => g >= 0 && g <= 6) : v.orari.giorni };
    if (/^[a-z]{2}(_[A-Z]{2})?$/.test(corpo.lingua || '')) x.lingua = corpo.lingua;
    if (corpo.tariffe) { x.tariffe = {}; for (const [k, n] of Object.entries(corpo.tariffe)) if (k in R.TARIFFE && k !== 'valuta' && k !== 'aggiornate') x.tariffe[k] = typeof R.TARIFFE[k] === 'boolean' ? !!n : n == null || n === '' ? null : Math.max(0, Number(n) || 0); }
    let salvate = {}; try { salvate = JSON.parse(meta.leggi(db, 'whatsapp.impostazioni') || '{}'); } catch { salvate = {}; }
    meta.scrivi(db, 'whatsapp.impostazioni', JSON.stringify({ ...salvate, ...x, tariffe: { ...(salvate.tariffe || {}), ...(x.tariffe || {}) } })); indice = null;
    return imp();
  });
  r('GET', '/api/whatsapp/conversazioni', ({ ctx }) => { leggi(ctx); return conversazioni(ctx); });
  r('GET', '/api/whatsapp/conversazioni/:numero', ({ ctx, p }) => { leggi(ctx); return conversazione(vedeONo(ctx, numeroDa(p.numero))); });
  r('POST', '/api/whatsapp/conversazioni/:numero/letti', ({ ctx, p }) => { leggi(ctx); const n = vedeONo(ctx, numeroDa(p.numero)); db.prepare("UPDATE _whatsapp_messaggi SET letto = 1 WHERE numero = ? AND verso = 'in'").run(n); avvisa(n); return { ok: true }; });
  r('GET', '/api/whatsapp/cliente/:id', ({ ctx, p }) => {
    leggi(ctx); const c = leggiCliente(p.id, ctx), rb = rubrica(); if (!c) throw errore(404, 'cliente-sconosciuto', { nome: p.id });
    const numero = R.e164(c[rb.telefono], imp().prefisso); return numero ? conversazione(numero) : { numero: null, messaggi: [], consenso: { storia: [] }, finestra: { aperta: false } };
  });
  r('POST', '/api/whatsapp/invia', async ({ ctx, corpo }) => {
    scrive(ctx);
    if (corpo.cliente && leggiCliente(corpo.cliente) && !leggiCliente(corpo.cliente, ctx)) throw new P.ErrorePermesso();   // esiste ma non è suo («soloPropri»)
    if (corpo.numero) vedeONo(ctx, numeroDa(corpo.numero));
    if (corpo.documento) { const def = S.leggi(db, String(corpo.documento.entita || '')); if (!def || !P.puo(ctx, def.id, 'leggi')) throw new P.ErrorePermesso(); D.leggi(db, def.id, String(corpo.documento.id), ctx); }
    const pl = prepara({ numero: corpo.numero, cliente: corpo.cliente, testo: corpo.testo, modello: corpo.modello, variabili: corpo.variabili, documento: corpo.documento || null });
    if (corpo.anteprima) return { ...pl, modello: pl.modello ? { nome: pl.modello.nome, lingua: pl.modello.lingua, categoria: pl.modello.categoria } : null, no: pl.no ? { ...pl.no, messaggio: motivo(pl.no, linguaDi(ctx)) } : null };
    if (pl.no) throw errore(409, pl.no.motivo, pl.no.p);
    return esegui(pl, { chi: ctx.utente.nome });
  });
  r('POST', '/api/whatsapp/consensi', ({ ctx, corpo }) => {
    scrive(ctx); const c = corpo.cliente ? leggiCliente(corpo.cliente, ctx) : null, numero = numeroDa(corpo.numero || (c && c[rubrica().telefono]) || '');
    if (!['servizio', 'marketing'].includes(corpo.categoria) || !['si', 'no'].includes(corpo.stato)) throw errore(400, 'vuoto');
    const stop = consenso(numero).stop; if (stop && corpo.stato === 'si') throw errore(409, 'stop', { quando: dataBreve(stop.quando) });
    scriviConsenso({ numero, cliente: c?.id || clienteDi(numero), categoria: corpo.categoria, stato: corpo.stato, fonte: corpo.fonte || 'a voce', testo: corpo.testo || null, chi: ctx.utente.nome });
    return consenso(numero);
  });
  r('POST', '/api/whatsapp/collega', ({ ctx, corpo }) => {
    scrive(ctx); const numero = numeroDa(corpo.numero), rb = rubrica(); if (!rb) throw errore(409, 'senza-rubrica');
    let id = corpo.cliente || null;
    if (id) { const c = leggiCliente(id, ctx); if (!c) throw errore(404, 'cliente-sconosciuto', { nome: id }); D.modifica(db, rb.e, c.id, { [rb.telefono]: numero }, ctx); }
    else { const nome = db.prepare("SELECT nome FROM _whatsapp_messaggi WHERE numero = ? AND nome IS NOT NULL ORDER BY id DESC").get(numero)?.nome;
      const v = { [rb.titolo]: corpo.nome || nome || numero, [rb.telefono]: numero }; if (corpo.crea === 'lead' && rb.note) v[rb.note] = 'Contatto arrivato da WhatsApp: da qualificare'; id = D.crea(db, rb.e, v, ctx).id; }
    indice = null; db.prepare('UPDATE _whatsapp_messaggi SET cliente = ? WHERE numero = ?').run(id, numero); db.prepare('UPDATE _whatsapp_consensi SET cliente = ? WHERE numero = ? AND cliente IS NULL').run(id, numero);
    return { cliente: id };
  });
  r('GET', '/api/whatsapp/modelli', ({ ctx }) => { leggi(ctx); return modelli(); });
  r('POST', '/api/whatsapp/modelli/sincronizza', async ({ ctx }) => {
    titolare(ctx); const pv = prov(); let lista;
    try { lista = await pv.w.modelli(pv.k); } catch (e) { throw errore(502, 'invio-fallito', { dettaglio: String(e.message).slice(0, 200) }); }
    const visti = new Set();
    for (const m of lista) { if (!m.nome) continue; salvaModello(pv.id, m); visti.add(`${m.nome}|${m.lingua}`); }
    for (const x of db.prepare('SELECT nome, lingua FROM _whatsapp_modelli WHERE provider = ?').all(pv.id)) if (!visti.has(`${x.nome}|${x.lingua}`)) db.prepare('DELETE FROM _whatsapp_modelli WHERE provider = ? AND nome = ? AND lingua = ?').run(pv.id, x.nome, x.lingua);
    return modelli();
  });
  r('POST', '/api/whatsapp/modelli', async ({ ctx, corpo }) => {
    titolare(ctx); const pv = prov(); if (!pv.w.creaModello) throw errore(400, 'non-supportato');
    const nome = String(corpo.nome || ''), corpoT = String(corpo.corpo || '').trim(), categoria = String(corpo.categoria || 'utility');
    if (!/^[a-z0-9_]{1,512}$/.test(nome)) throw errore(400, 'modello-nome'); if (!corpoT) throw errore(400, 'vuoto');
    if (!['utility', 'marketing', 'authentication'].includes(categoria)) throw errore(400, 'non-supportato');
    const vars = R.variabiliDi(corpoT), esempi = vars.map((n, j) => String(corpo.esempi?.[j] ?? corpo.esempi?.[n] ?? `esempio ${n}`));
    let x; try { x = await pv.w.creaModello(pv.k, { nome, lingua: corpo.lingua || imp().lingua, categoria, corpo: corpoT, esempi, intestazione: corpo.intestazione || null }); }
    catch (e) { throw errore(502, 'invio-fallito', { dettaglio: String(e.message).slice(0, 200) }); }
    salvaModello(pv.id, { nome, lingua: corpo.lingua || imp().lingua, stato: x.stato, categoria: x.categoria || categoria, corpo: corpoT, intestazione: corpo.intestazione || null, idRemoto: x.idRemoto, mappa: corpo.mappa || null });
    return modelloDi(nome, corpo.lingua || imp().lingua);
  });
  r('PUT', '/api/whatsapp/modelli/:nome/:lingua/mappa', ({ ctx, p, corpo }) => {
    titolare(ctx); const m = modelloDi(p.nome, p.lingua); if (!m) throw errore(404, 'modello-sconosciuto', { nome: p.nome });
    const mappa = Object.fromEntries(Object.entries(corpo.mappa || {}).filter(([n, v]) => /^\d+$/.test(n) && typeof v === 'string' && v.length < 300));
    db.prepare('UPDATE _whatsapp_modelli SET mappa = ? WHERE provider = ? AND nome = ? AND lingua = ?').run(JSON.stringify(mappa), attivoId(), m.nome, m.lingua);
    return modelloDi(m.nome, m.lingua);
  });
  r('GET', '/api/whatsapp/ricette', ({ ctx }) => {
    leggi(ctx);
    return RICETTE.map(x => { const st = statoRicetta(x.id), b = bersaglio(x, st.opzioni); return { ...x, ...st, sezione: b?.e || null, possibile: !!b }; });
  });
  r('PUT', '/api/whatsapp/ricette/:id', ({ ctx, p, corpo }) => {
    titolare(ctx); const ric = RICETTE.find(x => x.id === p.id); if (!ric) throw errore(404, 'ricetta-sconosciuta');
    const st = statoRicetta(ric.id), opz = { ...st.opzioni };
    for (const [k, v] of Object.entries(corpo.opzioni || {})) if (k in (ric.opzioni || {}) || k === 'entita' || k === 'valore') opz[k] = Array.isArray(v) ? v.map(Number).filter(n => n > 0 && n <= 720).slice(0, 4) : typeof v === 'number' ? Math.max(0, Math.min(3650, v)) : v == null ? null : String(v).slice(0, 1000);
    const modello = corpo.modello !== undefined ? corpo.modello || null : st.modello, lingua = corpo.lingua !== undefined ? corpo.lingua || null : st.lingua;
    if (modello && ric.tipo !== 'entrata') { const m = modelloDi(modello, lingua); if (!m) throw errore(404, 'modello-sconosciuto', { nome: modello }); }
    db.prepare('INSERT INTO _whatsapp_ricette (id, attiva, modello, lingua, opzioni, aggiornato) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET attiva = excluded.attiva, modello = excluded.modello, lingua = excluded.lingua, opzioni = excluded.opzioni, aggiornato = excluded.aggiornato')
      .run(ric.id, (corpo.attiva ?? st.attiva) ? 1 : 0, ric.tipo === 'entrata' ? 'testo' : modello, lingua, JSON.stringify(opz), ora());
    sincronizzaAutomazione(ric);
    return { ...ric, ...statoRicetta(ric.id), sezione: bersaglio(ric, opz)?.e || null };
  });
  // l'anteprima di una ricetta su una riga d'esempio (la più recente della sezione), con i controlli
  r('POST', '/api/whatsapp/ricette/:id/anteprima', ({ ctx, corpo, p }) => {
    leggi(ctx); const ric = RICETTE.find(x => x.id === p.id); if (!ric) throw errore(404, 'ricetta-sconosciuta');
    const st = statoRicetta(ric.id), b = bersaglio(ric, { ...st.opzioni, ...(corpo.opzioni || {}) }), l = linguaDi(ctx);
    if (ric.tipo === 'entrata') return { testo: corpo.opzioni?.testo ?? st.opzioni.testo, categoria: 'servizio' };
    const nome = corpo.modello ?? st.modello, m = nome && modelloDi(nome, corpo.lingua ?? st.lingua); if (!m) return { testo: ric.esempio, esempio: true, categoria: ric.categoria };
    const riga = b ? D.elenca(db, b.e, { perPagina: 1, ordina: [{ campo: 'creato', dir: 'desc' }] }, ctx).righe[0] : null, dest = riga && b ? destinatario(b, riga) : {};
    const cli = leggiCliente(dest.cliente, ctx), mappa = Object.keys(m.mappa || {}).length ? m.mappa : ric.mappa;
    const x = R.valoriModello(m, mappa, { cliente: cli, azienda: azienda(), riga: contestoRiga(b?.e, riga), ricetta: { ...st.opzioni, ...(corpo.opzioni || {}) } }, { lingua: m.lingua, fuso: fuso() });
    return { testo: R.riempi(m.corpo, x.valori.map((v, j) => v || `{{${j + 1}}}`)), mancano: x.mancano, categoria: m.categoria, cliente: nomeDi(cli) || null,
      costo: R.costo(m.categoria, { tariffe: imp().tariffe, provider: attivoId() }), nota: m.categoria === 'marketing' ? testoWa(l, 'consenso-marketing') : null };
  });
  r('GET', '/api/whatsapp/registro', ({ ctx }) => { titolare(ctx); return db.prepare("SELECT id, numero, nome, tipo, modello, categoria, stato, motivo, ricetta, chi, quando FROM _whatsapp_messaggi WHERE verso = 'out' AND stato IN ('bloccato', 'fallito') ORDER BY id DESC LIMIT 100").all(); });
  // la verifica del webhook di Meta: GET con hub.mode=subscribe, hub.verify_token (il token generato da Kubo) e hub.challenge
  r('GET', '/api/connettori/whatsapp/in', ({ q, res }) => {
    let ok = false; try { ok = q.get('hub.mode') === 'subscribe' && !!nucleo()?.attivo('whatsapp') && uguali(q.get('hub.verify_token'), nucleo().segreto('whatsapp', 'verifica')); } catch { ok = false; }
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(ok ? String(q.get('hub.challenge') || '').replace(/[^\w.-]/g, '').slice(0, 200) : '');
  }, { pubblica: true });
  r('GET', '/api/whatsapp/file/:codice', ({ p, res }) => {
    const x = file.get(p.codice); if (!x || x.scade < Date.now()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end(''); return; }
    res.writeHead(200, { 'Content-Type': x.tipo, 'Content-Disposition': `inline; filename="${x.nome.replace(/[^\w. -]/g, '_')}"`, 'Cache-Control': 'no-store' }).end(x.dati);
  }, { pubblica: true });

  const istanza = { prepara, esegui, ricevi, lavora, giro, fuoriOrario, controlla, consenso, scriviConsenso, conversazioni, conversazione, attivoId, rubrica, statoRicetta, bersaglio, imp, pdfDi, sincronizzaAutomazione };
  bus.set(db, { ricevi, lavora });
  istanzeWa.set(db, istanza);
  return istanza;
}
