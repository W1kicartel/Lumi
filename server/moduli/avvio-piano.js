// Il cuore dell'avvio guidato, senza rotte (le rotte stanno in avvio.js): le domande, il «piano» che ne viene fuori
// (quali modelli, quali sezioni e campi spenti, quali ruoli e persone), l'installazione del piano, i dati d'esempio
// (si mettono e si tolgono con un clic) e il cruscotto predefinito dei modelli.
// I modelli dicono da soli cosa spegnere: «interruttori» = { magazzino: { entita: [...], campi: ["articoli.giacenza"] }, … }
// vale quando la risposta è no. Un campo spento è archiviato (si riaccende da Personalizza → Ripristina), una sezione
// spenta non si crea proprio (si aggiunge poi installando di nuovo il modello).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import * as S from '../schema.js';
import * as D from '../dati.js';
import * as A from '../automazioni.js';
import * as M from '../modelli.js';
import * as P from '../permessi.js';
import * as U from '../auth.js';
import { analizza, nomi } from '../formule.js';
import { transazione, meta } from '../db.js';
import { predefinito } from './agenda.js';
import { mezzanotte, piuGiorni, giornoDi } from './agenda-aggregati.js';

const CARTELLA_ESEMPI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'modelli', 'esempi');

// ---------- settori e domande ----------
// «tipico»: le risposte già scelte quando si sceglie il settore (si cambiano con un clic)
export const SETTORI = [
  { id: 'negozio', nome: 'Negozio e bottega', descrizione: 'Vendo al banco, ho articoli e magazzino', modello: 'negozio', tipico: { offerta: 'prodotti', magazzino: true, su_misura: false, appuntamenti: false, fornitori: true, fatture: false } },
  { id: 'ristorante', nome: 'Ristorante e bar', descrizione: 'Tavoli, comande, menù con allergeni, prenotazioni', modello: 'ristorante', tipico: { offerta: 'entrambi', magazzino: true, su_misura: false, appuntamenti: true, fornitori: true, fatture: false } },
  { id: 'laboratorio', nome: 'Laboratorio e artigiano', descrizione: 'Preventivi, commesse a fasi, materiali', modello: 'laboratorio', tipico: { offerta: 'entrambi', magazzino: true, su_misura: true, appuntamenti: false, fornitori: false, fatture: true } },
  { id: 'officina', nome: 'Officina e assistenza', descrizione: 'Veicoli o apparecchi, interventi, ricambi, garanzie', modello: 'officina', tipico: { offerta: 'entrambi', magazzino: true, su_misura: false, appuntamenti: true, fornitori: true, fatture: true } },
  { id: 'studio', nome: 'Studio e servizi', descrizione: 'Agenda, schede cliente, pacchetti di sedute', modello: 'studio', tipico: { offerta: 'servizi', magazzino: false, su_misura: false, appuntamenti: true, fornitori: false, fatture: true } },
  { id: 'beauty', nome: 'Beauty ed estetica', descrizione: 'Agenda per cabina, trattamenti, pacchetti, prodotti', modello: 'beauty', tipico: { offerta: 'entrambi', magazzino: true, su_misura: false, appuntamenti: true, fornitori: false, fatture: false } },
  { id: 'palestra', nome: 'Palestra e associazione', descrizione: 'Soci, abbonamenti e rinnovi, corsi e presenze', modello: 'palestra', tipico: { offerta: 'servizi', magazzino: false, su_misura: false, appuntamenti: true, fornitori: false, fatture: false } },
  { id: 'professionista', nome: 'Professionista e agenzia', descrizione: 'Clienti, progetti, ore, scadenze, preventivi', modello: 'professionista', tipico: { offerta: 'servizi', magazzino: false, su_misura: true, appuntamenti: false, fornitori: false, fatture: true } },
  { id: 'noleggio', nome: 'Noleggio', descrizione: 'Beni, disponibilità, contratti dal/al, cauzioni', modello: 'noleggio', tipico: { offerta: 'servizi', magazzino: false, su_misura: false, appuntamenti: false, fornitori: false, fatture: true } },
  { id: 'altro', nome: 'Altro, parto da zero', descrizione: 'Un gestionale vuoto: le sezioni le crei tu', modello: 'vuoto', tipico: { offerta: 'entrambi', magazzino: false, su_misura: false, appuntamenti: false, fornitori: false, fatture: false } },
];
const SI_NO = [{ id: true, nome: 'Sì' }, { id: false, nome: 'No' }];
export const DOMANDE = [
  { id: 'settore', testo: 'Che lavoro fai?', aiuto: 'Scegli il più vicino. Dopo si cambia tutto.', tipo: 'settore', opzioni: SETTORI.map(({ id, nome, descrizione }) => ({ id, nome, descrizione })) },
  { id: 'offerta', testo: 'Vendi prodotti, servizi o tutti e due?', tipo: 'scelta', opzioni: [{ id: 'prodotti', nome: 'Prodotti' }, { id: 'servizi', nome: 'Servizi' }, { id: 'entrambi', nome: 'Tutti e due' }] },
  { id: 'magazzino', testo: 'Tieni un magazzino?', aiuto: 'Giacenze, scorte minime, cosa riordinare.', tipo: 'si_no', opzioni: SI_NO },
  { id: 'su_misura', testo: 'Lavori su misura, con i preventivi?', aiuto: 'Il preventivo con le voci; quando il cliente accetta si apre il lavoro.', tipo: 'si_no', opzioni: SI_NO },
  { id: 'appuntamenti', testo: 'Prendi appuntamenti o prenotazioni?', aiuto: 'Un\'agenda per persona o per risorsa.', tipo: 'si_no', opzioni: SI_NO },
  { id: 'fornitori', testo: 'Compri da fornitori?', aiuto: 'Anagrafica dei fornitori e, se hai un magazzino, gli ordini con il carico.', tipo: 'si_no', opzioni: SI_NO },
  { id: 'fatture', testo: 'Emetti fatture?', aiuto: 'Numerate per anno, con IVA, scadenze e il file della fattura elettronica.', tipo: 'si_no', opzioni: SI_NO },
  { id: 'persone', testo: 'Quante persone useranno Kubo?', tipo: 'scelta', opzioni: [{ id: 'solo', nome: 'Solo io' }, { id: 'poche', nome: 'Da 2 a 5' }, { id: 'molte', nome: 'Più di 5' }] },
  { id: 'squadra', testo: 'Chi lavora con te?', aiuto: 'Ognuno entra con la sua email e vede quello che serve al suo ruolo. Si può fare anche dopo.', tipo: 'persone', se: { persone: ['poche', 'molte'] } },
  { id: 'lumi', testo: 'Vuoi Lumi, l\'assistente?', aiuto: 'Gli chiedi le cose a parole: «quanto ho incassato questa settimana?», «aggiungi la taglia agli articoli». Lui propone, tu confermi.', tipo: 'si_no', opzioni: SI_NO },
  { id: 'esempi', testo: 'Vuoi vedere Kubo con dei dati d\'esempio?', aiuto: 'Clienti, vendite e appuntamenti finti ma credibili, per provare tutto. Si cancellano con un clic.', tipo: 'si_no', opzioni: SI_NO },
];
// le risposte predefinite per un settore (per l'interfaccia e per chi salta le domande)
export const tipiche = settore => ({ settore, persone: 'solo', lumi: true, esempi: true, ...(SETTORI.find(s => s.id === settore) || SETTORI.at(-1)).tipico });

// ---------- il piano ----------
const entitaDi = m => (m.entita ? M.leggi(m.id).entita.filter(e => m.entita.includes(e.id)) : M.leggi(m.id).entita);
export function piano(risposte = {}) {
  const st = SETTORI.find(s => s.id === risposte.settore) || SETTORI.at(-1);
  const r = { ...tipiche(st.id), ...Object.fromEntries(Object.entries(risposte).filter(([, v]) => v !== undefined && v !== null)) };
  const si = k => r[k] === true || r[k] === 'si';
  const modelli = [{ id: st.modello }];
  const presenti = () => new Set(modelli.flatMap(m => entitaDi(m).map(e => e.id)));
  // quello che il settore non ha ma le risposte chiedono, preso dai modelli che lo sanno fare
  if (si('su_misura') && !presenti().has('preventivi')) modelli.push({ id: 'laboratorio' });
  if (si('appuntamenti') && !['appuntamenti', 'prenotazioni', 'lezioni', 'interventi'].some(e => presenti().has(e))) modelli.push({ id: 'studio', entita: ['clienti', 'servizi', 'appuntamenti'] });
  if (si('fornitori') && !presenti().has('fornitori')) modelli.push({ id: 'negozio', entita: ['fornitori'] });
  if (si('fatture')) modelli.push({ id: 'fatture' });
  // gli interruttori: per ogni risposta «no», quello che ogni modello dice di spegnere
  const spenti = { entita: [], campi: [] };
  const no = { magazzino: !si('magazzino'), su_misura: !si('su_misura'), appuntamenti: !si('appuntamenti'), fornitori: !si('fornitori'),
    prodotti: r.offerta === 'servizi', servizi: r.offerta === 'prodotti' };
  for (const m of modelli) for (const [k, x] of Object.entries(M.leggi(m.id).interruttori || {})) if (no[k]) { spenti.entita.push(...(x.entita || [])); spenti.campi.push(...(x.campi || [])); }
  // ruoli: quelli del settore e quelli di base; le persone con un ruolo che non c'è diventano collaboratori
  const ruoli = M.leggi(st.modello).ruoli || [];
  const idRuoli = new Set([...P.RUOLI_BASE.map(x => x.id), ...ruoli.map(x => x.id)]); idRuoli.delete('titolare');
  const persone = r.persone === 'solo' ? [] : (Array.isArray(r.squadra) ? r.squadra : []).slice(0, 30)
    .map(p => ({ nome: String(p?.nome || '').trim().slice(0, 80), email: String(p?.email || '').trim().toLowerCase().slice(0, 120), ruolo: idRuoli.has(p?.ruolo) ? p.ruolo : 'collaboratore' }))
    .filter(p => p.nome && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email));
  const pl = { settore: st.id, modelli, spenti: { entita: [...new Set(spenti.entita)], campi: [...new Set(spenti.campi)] }, ruoli, persone, lumi: si('lumi'), esempi: si('esempi') };
  return { ...pl, sezioni: costruisci(pl).defs.filter(e => !e.nascosta).map(e => e.nome) };
}

// ---------- dal piano alle definizioni: unione dei modelli, sezioni spente, campi archiviati ----------
function costruisci(pl, db = null) {
  const spente = new Set(pl.spenti.entita), spenti = new Set(pl.spenti.campi);
  const tutte = new Map(), automazioni = [];
  for (const m of pl.modelli) {
    const mod = M.leggi(m.id);
    for (const e of entitaDi(m)) {
      if (spente.has(e.id) || (db && S.leggi(db, e.id))) continue;
      const g = tutte.get(e.id);
      if (!g) tutte.set(e.id, structuredClone(e));
      else for (const c of e.campi) if (!g.campi.some(x => x.id === c.id)) g.campi.push(structuredClone(c));   // la stessa sezione in due modelli: si uniscono i campi
    }
    automazioni.push(...(mod.automazioni || []));
  }
  const esiste = id => tutte.has(id) || (db && !!S.leggi(db, id));
  // togli quello che punta a sezioni che non ci sono; le righe nascoste senza più un padre se ne vanno con lui
  for (let giro = 0; giro < 6; giro++) {
    let cambiato = false;
    for (const d of tutte.values()) {
      const prima = d.campi.length;
      d.campi = d.campi.filter(c => !['relazione', 'righe'].includes(c.tipo) || esiste(c.entita));
      d.campi = d.campi.filter(c => c.tipo !== 'calcolato' || usaSolo(c.formula, d, tutte));
      if (d.campi.length !== prima) cambiato = true;
    }
    for (const d of [...tutte.values()]) if (d.nascosta && ![...tutte.values()].some(p => p.campi.some(c => c.tipo === 'righe' && c.entita === d.id))) { tutte.delete(d.id); cambiato = true; }
    if (!cambiato) break;
  }
  // i campi spenti si archiviano, con i calcolati che ne dipendono
  for (const d of tutte.values()) for (const c of d.campi) if (spenti.has(`${d.id}.${c.id}`)) c.archiviato = true;
  for (let giro = 0; giro < 4; giro++) for (const d of tutte.values()) for (const c of d.campi) if (c.tipo === 'calcolato' && !c.archiviato && !usaSolo(c.formula, d, tutte, true)) c.archiviato = true;
  for (const d of tutte.values()) if (d.titolo && !d.campi.some(c => c.id === d.titolo)) delete d.titolo;
  return { defs: [...tutte.values()], automazioni };
}
// la formula usa solo campi che ci sono (e, con «attivi», non archiviati)? «righe.campo» e «relazione.campo» guardano l'altra sezione
function usaSolo(formula, def, tutte, attivi = false) {
  let n; try { n = nomi(analizza(formula || '')); } catch { return false; }
  const ok = (d, id) => { const c = d?.campi.find(x => x.id === id); return !!c && !(attivi && c.archiviato); };
  for (const x of n) {
    if (x.startsWith('@')) continue;
    const [a, b] = x.split('.'); if (!ok(def, a)) return false;
    if (b) { const c = def.campi.find(k => k.id === a); if (!ok(tutte.get(c.entita), b)) return false; }
  }
  return true;
}
// un'automazione si installa solo se tutto quello che tocca è acceso: altrimenti farebbe fallire i salvataggi
function automazioneUsabile(db, a) {
  const def = S.leggi(db, a.entita); if (!def) return false;
  const attivo = (d, id) => { const c = d && S.campo(d, id); return !!c && !c.archiviato; };
  const formule = [a.se, ...a.azioni.flatMap(x => [x.formula, x.aggiungi, x.testo, ...Object.values(x.valori || {})])].filter(f => f != null).map(String);
  let figlia = null;
  for (const x of a.azioni) {
    if (x.tipo === 'imposta' && !attivo(def, x.campo)) return false;
    if (x.tipo === 'aggiorna_collegato') {
      const base = x.perOgniRiga ? (attivo(def, x.perOgniRiga) ? S.leggi(db, S.campo(def, x.perOgniRiga).entita) : null) : def; if (!base) return false;
      if (x.perOgniRiga) figlia = base;
      const rel = S.campo(base, x.relazione); if (!rel || rel.archiviato || !attivo(S.leggi(db, rel.entita), x.campo)) return false;
    }
    if (x.tipo === 'crea') { const d = S.leggi(db, x.entita); if (!d || Object.keys(x.valori || {}).some(k => !attivo(d, k))) return false; }
  }
  if (a.quando === 'campo_cambia' && !attivo(def, a.campo)) return false;
  for (const f of formule) {
    let n; try { n = nomi(analizza(f)); } catch { return false; }
    for (const x of n) { const k = x.split('.')[0]; if (x.startsWith('@') || k === 'prima' || k === 'id' || attivo(def, k) || (figlia && attivo(figlia, k))) continue; return false; }
  }
  return A.valida(db, a).length === 0;
}

// ---------- installare il piano ----------
export function installaPiano(db, pl, { utente = null } = {}) {
  return transazione(db, () => {
    const { defs, automazioni } = costruisci(pl, db);
    if (defs.length) S.applicaTutte(db, defs, { utente });
    const automazioniMesse = [];
    for (const a of automazioni) if (!A.elenco(db).some(x => x.id === a.id) && automazioneUsabile(db, a)) { A.salva(db, a, { utente }); automazioniMesse.push(a.id); }
    const installati = JSON.parse(meta.leggi(db, 'modelli') || '[]');
    for (const m of pl.modelli) if (!installati.includes(m.id)) installati.push(m.id);
    meta.scrivi(db, 'modelli', JSON.stringify(installati));
    for (const r of pl.ruoli || []) P.salvaRuolo(db, r);
    const persone = [];
    for (const p of pl.persone || []) {
      const password = 'kubo-' + randomBytes(6).toString('base64url');   // provvisoria: il titolare la vede una volta sola, alla fine dell'avvio
      try { persone.push({ ...U.creaUtente(db, { ...p, password }, { utente }), password }); }
      catch (e) { if (e instanceof U.ErroreAccesso) persone.push({ ...p, errore: e.message }); else throw e; }
    }
    if (pl.lumi === false) meta.scrivi(db, 'lumi.attivo', '0');
    meta.scrivi(db, 'avvio.spenti', JSON.stringify(pl.spenti));
    scriviCruscotto(db);
    return { entita: defs.map(d => d.id), automazioni: automazioniMesse, persone };
  });
}

// ---------- cruscotto: quello di agenda.js per i modelli che conosce, più i widget che ogni modello dichiara ----------
export function cruscotto(db) {
  const attivo = (d, id) => ['creato', 'modificato'].includes(id) || (S.campo(d, id) && !S.campo(d, id).archiviato);
  const usabile = x => { const d = S.leggi(db, x.entita); return !!d && !d.archiviata && [x.campo, x.campoData, ...(x.filtri || []).map(f => f.campo)].filter(Boolean).every(id => attivo(d, id)); };
  const propri = [], voci = [];
  for (const id of JSON.parse(meta.leggi(db, 'modelli') || '[]')) {
    let m; try { m = M.leggi(id); } catch { continue; }
    propri.push(...(m.cruscotto?.widget || []).filter(usabile)); voci.push(...(m.cruscotto?.attenzione || []).filter(usabile));
  }
  let base = predefinito(db, S);
  if (propri.length) base = base.filter(w => !String(w.titolo).endsWith(': nuovi questo mese'));   // la riserva di agenda.js serve solo senza widget dei modelli
  const att = base.find(w => w.tipo === 'attenzione');
  if (att) att.voci.push(...voci.filter(v => !att.voci.some(x => x.titolo === v.titolo)));
  const numeri = base.filter(w => !['attenzione', 'ultime'].includes(w.tipo)).concat(propri);
  // prima i numeri, poi i grafici larghi, poi «cosa richiede attenzione» e le ultime modifiche
  const w = [...numeri.filter(x => x.tipo === 'numero').slice(0, 8), ...numeri.filter(x => x.tipo === 'grafico').slice(0, 3),
    att || (voci.length ? { tipo: 'attenzione', titolo: 'Cosa richiede attenzione', voci } : null), base.find(x => x.tipo === 'ultime')].filter(Boolean);
  return w.map((x, i) => ({ ...structuredClone(x), id: `w${i + 1}` }));
}
export function scriviCruscotto(db) {
  try { db.prepare('SELECT 1 FROM _agenda_cruscotti LIMIT 1').get(); } catch { return null; }   // senza il modulo dell'agenda non c'è cruscotto
  const def = { nome: 'Cruscotto', widget: cruscotto(db) };
  db.prepare("INSERT INTO _agenda_cruscotti (id, utente, def, modificato) VALUES ('casa', NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET def = excluded.def, modificato = excluded.modificato").run(JSON.stringify(def), new Date().toISOString());
  return def;
}

// ---------- dati d'esempio ----------
// modelli/esempi/<modello>.json = { entità: [ { "#": "chiave", campo: valore, … } ], dopo?: { entità: [ { "#": "chiave", campo: valore } ] } }. Valori speciali: "#chiave" (una riga
// d'esempio dello stesso file), "@oggi", "@oggi-3", "@oggi+2 10:30" (date e ore nel fuso dell'azienda), "@utente".
// Si scrive con dati.js e il ctx del titolare: formule, numeratori e automazioni funzionano come sempre. Ogni riga creata
// (anche quelle create dalle automazioni e le righe figlie) finisce in _avvio_esempi, così si toglie tutto con un clic.
export function tabelle(db) { db.exec('CREATE TABLE IF NOT EXISTS _avvio_esempi (entita TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (entita, id))'); }
export const quantiEsempi = db => { tabelle(db); return db.prepare('SELECT COUNT(*) n FROM _avvio_esempi').get().n; };

function data(v, tipo, adesso) {
  const m = /^@oggi([+-]\d+)?(?:\s+(\d{1,2}):(\d{2}))?$/.exec(v); if (!m) return v;
  const g = piuGiorni(giornoDi(adesso), Number(m[1] || 0));
  if (tipo !== 'data_ora') return g;
  return new Date(new Date(mezzanotte(g)).getTime() + (Number(m[2] || 9) * 60 + Number(m[3] || 0)) * 6e4).toISOString();
}
function valoriPer(db, def, riga, chiavi, ctx, adesso) {
  const out = {};
  for (const [k, v] of Object.entries(riga)) {
    if (k === '#') continue;
    const c = S.campo(def, k); if (!c || c.archiviato || ['calcolato', 'contatore'].includes(c.tipo)) continue;
    const uno = x => {
      if (typeof x !== 'string') return x;
      if (x.startsWith('#')) return chiavi.get(x.slice(1)) ?? undefined;
      if (x === '@utente') return ctx?.utente?.id ?? null;
      if (x.startsWith('@oggi')) return data(x, c.tipo, adesso);
      return x;
    };
    if (c.tipo === 'righe') { const figlia = S.leggi(db, c.entita); if (figlia && Array.isArray(v)) out[k] = v.map(r => valoriPer(db, figlia, r, chiavi, ctx, adesso)); continue; }
    const x = Array.isArray(v) && c.tipo !== 'scelta_multipla' ? v.map(uno).filter(y => y !== undefined) : uno(v);
    if (x === undefined) continue;
    if (c.tipo === 'scelta' && !c.opzioni.some(o => o.id === x)) continue;
    out[k] = x;
  }
  return out;
}
export function mettiEsempi(db, ctx, { adesso = new Date() } = {}) {
  tabelle(db);
  if (!meta.leggi(db, 'avvio.numeratori')) meta.scrivi(db, 'avvio.numeratori', JSON.stringify(db.prepare('SELECT serie, anno, ultimo FROM _numeratori').all()));
  const creati = [], saltati = [];
  const via = D.ascolta(ev => { if (ev.tipo === 'crea') creati.push([ev.entita, ev.id]); });
  try {
    for (const id of JSON.parse(meta.leggi(db, 'modelli') || '[]')) {
      const f = join(CARTELLA_ESEMPI, `${id}.json`); if (!/^[a-z0-9_-]+$/.test(id) || !existsSync(f)) continue;
      const esempi = JSON.parse(readFileSync(f, 'utf8')), chiavi = new Map();
      for (const [entita, righe] of Object.entries(esempi)) {
        if (entita === 'dopo') continue;
        const def = S.leggi(db, entita); if (!def || def.archiviata) continue;
        for (const riga of righe) {
          // ogni riga nella sua transazione: una che non va (es. un'email già usata) non ferma le altre
          try { const x = transazione(db, () => D.crea(db, entita, valoriPer(db, def, riga, chiavi, ctx, adesso), ctx)); if (riga['#']) chiavi.set(riga['#'], x.id); }
          catch (e) { if (e instanceof D.ErroreDati || e instanceof P.ErrorePermesso) saltati.push({ entita, errore: e.message }); else throw e; }
        }
      }
      // «dopo»: ritocchi alle righe già create, quando le automazioni le hanno cambiate (es. i tavoli del giorno prima di nuovo liberi)
      for (const [entita, righe] of Object.entries(esempi.dopo || {})) {
        const def = S.leggi(db, entita); if (!def || def.archiviata) continue;
        for (const riga of righe) {
          const id = chiavi.get(riga['#']); if (!id) continue;
          try { transazione(db, () => D.modifica(db, entita, id, valoriPer(db, def, riga, chiavi, ctx, adesso), ctx)); }
          catch (e) { if (e instanceof D.ErroreDati || e instanceof P.ErrorePermesso) saltati.push({ entita, errore: e.message }); else throw e; }
        }
      }
    }
  } finally { via(); }
  const ins = db.prepare('INSERT OR IGNORE INTO _avvio_esempi (entita, id) VALUES (?, ?)');
  for (const [e, id] of creati) ins.run(e, id);
  return { creati: creati.length, saltati };
}
export function togliEsempi(db) {
  tabelle(db);
  return transazione(db, () => {
    const per = new Map(); for (const x of db.prepare('SELECT entita, id FROM _avvio_esempi').all()) { if (!per.has(x.entita)) per.set(x.entita, []); per.get(x.entita).push(x.id); }
    const tutte = S.elenco(db, { anche_archiviate: true });
    let tolti = 0;
    for (const [entita, ids] of per) {
      const def = S.leggi(db, entita); if (!def) continue;
      for (let i = 0; i < ids.length; i += 400) {
        const pezzo = ids.slice(i, i + 400), q = pezzo.map(() => '?').join(',');
        // chi punta a una riga d'esempio (una riga vera aggiunta dopo) resta, senza il collegamento
        for (const d of tutte) for (const c of d.campi) if (c.tipo === 'relazione' && c.entita === entita) {
          if (c.molti) db.prepare(`DELETE FROM ${S.tabellaMolti(d.id, c.id)} WHERE a IN (${q})`).run(...pezzo);
          else db.prepare(`UPDATE ${S.tabella(d.id)} SET ${S.colonna(c.id)} = NULL WHERE ${S.colonna(c.id)} IN (${q})`).run(...pezzo);
        }
        for (const c of def.campi) if (c.tipo === 'relazione' && c.molti) db.prepare(`DELETE FROM ${S.tabellaMolti(entita, c.id)} WHERE da IN (${q})`).run(...pezzo);
        tolti += Number(db.prepare(`DELETE FROM ${S.tabella(entita)} WHERE id IN (${q})`).run(...pezzo).changes);
        db.prepare(`DELETE FROM _registro WHERE entita = ? AND riga IN (${q})`).run(entita, ...pezzo);
      }
    }
    db.exec('DELETE FROM _avvio_esempi');
    // la numerazione torna com'era, dove non c'è ancora niente di vero (la prima fattura vera deve essere la numero 1)
    const prima = JSON.parse(meta.leggi(db, 'avvio.numeratori') || '[]');
    for (const d of tutte) for (const c of d.campi) if (c.tipo === 'contatore') {
      const serie = c.serie || `${d.id}.${c.id}`;
      if (db.prepare(`SELECT COUNT(*) n FROM ${S.tabella(d.id)}`).get().n) continue;
      db.prepare('DELETE FROM _numeratori WHERE serie = ?').run(serie);
      for (const x of prima.filter(x => x.serie === serie)) db.prepare('INSERT INTO _numeratori (serie, anno, ultimo) VALUES (?, ?, ?)').run(x.serie, x.anno, x.ultimo);
    }
    db.prepare("DELETE FROM _meta WHERE chiave = 'avvio.numeratori'").run();
    return { tolti };
  });
}
