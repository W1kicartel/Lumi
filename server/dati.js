// Lettura e scrittura generica dei dati di qualsiasi entità, guidate dallo schema.
// Nelle API i valori sono «naturali»: valuta in euro (numero, salvata in centesimi), si_no booleano, scelta_multipla e
// relazioni «molti» come liste, relazione come id (in lettura { id, titolo }), righe come lista di righe figlie (in
// scrittura si possono passare insieme al padre: con id = modifica, senza = nuova, quelle che mancano = archiviate).
// Ogni scrittura: permessi, validazione, numeratori, registro (prima/dopo), poi gli «ascoltatori» (automazioni, eventi).
import { transazione, registra, nuovoId } from './db.js';
import * as S from './schema.js';
import * as P from './permessi.js';
import { calcola, analizza, nomi } from './formule.js';

export class ErroreDati extends Error { constructor(messaggio, campi = {}) { super(messaggio); this.campi = campi; } }

const ascoltatori = [];
export const ascolta = f => { ascoltatori.push(f); return () => ascoltatori.splice(ascoltatori.indexOf(f), 1); };

const defDi = (db, id) => { const d = S.leggi(db, id); if (!d || d.archiviata) throw new ErroreDati(`Entità sconosciuta «${id}»`); return d; };
const ora = () => new Date().toISOString();
const DATA = /^\d{4}-\d{2}-\d{2}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- numeratori ----------
export function prossimoNumero(db, serie, formato, quando = new Date()) {
  const annuale = /\{AAAA\}|\{AA\}|\{YYYY\}|\{YY\}/.test(formato), anno = annuale ? quando.getFullYear() : 0;
  const r = db.prepare('INSERT INTO _numeratori (serie, anno, ultimo) VALUES (?, ?, 1) ON CONFLICT(serie, anno) DO UPDATE SET ultimo = ultimo + 1 RETURNING ultimo').get(serie, anno);
  const y = String(quando.getFullYear());
  return formato.replace(/\{(AAAA|YYYY)\}/g, y).replace(/\{(AA|YY)\}/g, y.slice(2))
    .replace(/\{N(?::(\d+))?\}/g, (_, k) => String(r.ultimo).padStart(Number(k || 1), '0'));
}

// ---------- validatori dei campi testo ----------
// Un campo testo con «valida»: "<nome>" passa dal validatore registrato con quel nome (i moduli ne aggiungono, per esempio
// piva, codice_fiscale e iban in moduli/documenti-italia.js). Il validatore riceve il testo e restituisce { valore } o { errore }.
const VALIDATORI = {};
export const validatore = (nome, f) => { VALIDATORI[nome] = f; };

// ---------- da valore API a valore del database ----------
function normalizza(db, def, c, v, { prima } = {}) {
  if (v === undefined) return undefined;
  if (v == null || v === '' || (Array.isArray(v) && !v.length && c.tipo !== 'scelta_multipla')) return null;
  const no = m => { throw new ErroreDati(m, { [c.id]: m }); };
  switch (c.tipo) {
    case 'numero': case 'percentuale': case 'durata': { const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.')); if (!Number.isFinite(n)) no(`«${c.nome}» deve essere un numero`); return c.tipo === 'durata' ? Math.round(n) : n; }
    case 'valuta': { const n = typeof v === 'number' ? v : Number(String(v).replace(/[€\s]/g, '').replace(',', '.')); if (!Number.isFinite(n)) no(`«${c.nome}» deve essere un importo`); return Math.round(n * 100); }
    case 'si_no': return v === true || v === 1 || ['1', 'true', 'si', 'sì', 'vero'].includes(String(v).toLowerCase()) ? 1 : 0;
    case 'data': if (!DATA.test(String(v)) || isNaN(new Date(v))) no(`«${c.nome}»: data non valida (AAAA-MM-GG)`); return String(v);
    case 'data_ora': { const d = new Date(v); if (isNaN(d)) no(`«${c.nome}»: data e ora non valide`); return d.toISOString(); }
    case 'email': if (!EMAIL.test(String(v).trim())) no(`«${c.nome}»: email non valida`); return String(v).trim().toLowerCase();
    case 'scelta': if (!c.opzioni.some(o => o.id === v)) no(`«${c.nome}»: opzione sconosciuta «${v}»`); return v;
    case 'scelta_multipla': { const l = Array.isArray(v) ? v : [v]; for (const x of l) if (!c.opzioni.some(o => o.id === x)) no(`«${c.nome}»: opzione sconosciuta «${x}»`); return JSON.stringify([...new Set(l)]); }
    case 'stato': {
      if (!c.opzioni.some(o => o.id === v)) no(`«${c.nome}»: stato sconosciuto «${v}»`);
      if (prima != null && prima !== v && c.transizioni && !(c.transizioni[prima] || []).includes(v)) no(`«${c.nome}»: da «${prima}» non si può passare a «${v}»`);
      return v;
    }
    case 'relazione': {
      const l = c.molti ? (Array.isArray(v) ? v : [v]) : [v];
      const ids = l.map(x => (typeof x === 'object' ? x.id : x));
      const q = db.prepare(`SELECT id FROM ${S.tabella(c.entita)} WHERE id = ? AND archiviato = 0`);
      for (const id of ids) if (!q.get(String(id))) no(`«${c.nome}»: non trovo «${id}»`);
      return c.molti ? ids.map(String) : String(ids[0]);
    }
    case 'utente': if (!db.prepare('SELECT 1 FROM _utenti WHERE id = ?').get(String(v))) no(`«${c.nome}»: utente sconosciuto`); return String(v);
    case 'file': case 'immagine': {   // [{ id, nome, tipo, dimensione }]: il file vero lo salva e lo serve server/moduli/import-file.js
      const l = (Array.isArray(v) ? v : [v]).map(x => (typeof x === 'string' ? { id: x } : x));
      if (l.length > 50 || l.some(x => !x || !/^[0-9A-Z]{17}$/.test(String(x.id)))) no(`«${c.nome}»: allegato non valido`);
      return JSON.stringify(l.map(x => ({ id: String(x.id), nome: String(x.nome ?? 'file').slice(0, 200), tipo: String(x.tipo ?? '').slice(0, 100), dimensione: Number(x.dimensione) || 0 })));
    }
    default: {
      const t = String(v).trim();
      if (c.valida && VALIDATORI[c.valida]) { const r = VALIDATORI[c.valida](t); if (r.errore) no(`«${c.nome}»: ${r.errore}`); return r.valore; }
      return t;
    }
  }
}

// ---------- da riga del database a oggetto API ----------
function grezzo(def, r) {
  const o = { id: r.id, creato: r.creato, modificato: r.modificato, creato_da: r.creato_da, modificato_da: r.modificato_da };
  if (r.archiviato) o.archiviato = true;
  for (const c of S.campiAttivi(def)) {
    if (!S.haColonna(c)) continue;
    let v = r[S.colonna(c.id)];
    if (v != null) {
      // la colonna può avere l'affinità del tipo di prima (cambio di tipo): si riporta al tipo del campo
      if (['numero', 'percentuale', 'durata', 'valuta'].includes(c.tipo)) v = Number(v);
      else if (S.TIPI[c.tipo].sql === 'TEXT' && typeof v !== 'string') v = String(v);
      if (c.tipo === 'valuta') v = v / 100;
      else if (c.tipo === 'si_no') v = !!v;
      else if (['scelta_multipla', 'file', 'immagine'].includes(c.tipo)) { try { v = JSON.parse(v); } catch { v = []; } }
      if (['file', 'immagine'].includes(c.tipo) && Array.isArray(v)) v = v.filter(x => x && typeof x === 'object').map(x => ({ ...x, url: `/api/file/${def.id}/${r.id}/${c.id}/${x.id}` }));
    } else if (c.tipo === 'si_no') v = false;
    else if (c.tipo === 'scelta_multipla') v = [];
    o[c.id] = v ?? null;
  }
  return o;
}

let profTitoli = 0;
function titoli(db, entita, ids) {
  if (!ids.length) return new Map();
  const d = S.leggi(db, entita), t = d && S.campoTitolo(d);
  const col = t && S.haColonna(t) ? S.colonna(t.id) : 'id';
  const out = new Map(); const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 500) {
    const pezzo = uniq.slice(i, i + 500);
    for (const r of db.prepare(`SELECT id, ${col} AS t FROM ${S.tabella(entita)} WHERE id IN (${pezzo.map(() => '?').join(',')})`).all(...pezzo)) out.set(r.id, r.t ?? r.id);
  }
  // il titolo è a sua volta una relazione (es. una riga d'ordine si chiama come il suo articolo)
  if (t?.tipo === 'relazione' && !t.molti && profTitoli < 3) {
    profTitoli++;
    try { const sotto = titoli(db, t.entita, [...out.values()].filter(Boolean)); for (const [k, v] of out) out.set(k, sotto.get(v) ?? v); }
    finally { profTitoli--; }
  }
  return out;
}

// arricchisce le righe lette: relazioni con il titolo, «molti», righe figlie, calcolati; toglie i campi nascosti
function completa(db, def, oggetti, ctx, { conRighe = false, profondita = 0 } = {}) {
  if (!oggetti.length) return oggetti;
  const attivi = S.campiAttivi(def);
  const calcolati = attivi.filter(c => c.tipo === 'calcolato');
  const servono = new Set(calcolati.flatMap(c => [...nomi(analizza(c.formula))].map(n => n.split('.')[0])));
  for (const c of attivi) {
    if (c.tipo === 'relazione' && !c.molti) {
      const t = titoli(db, c.entita, oggetti.map(o => o[c.id]).filter(Boolean));
      // per le formule che leggono «relazione.campo» servono i valori della riga collegata
      const usaValori = calcolati.some(k => [...nomi(analizza(k.formula))].some(n => n.startsWith(c.id + '.')));
      const collegati = usaValori ? new Map(leggiMolte(db, c.entita, oggetti.map(o => o[c.id]).filter(Boolean)).map(x => [x.id, x])) : null;
      for (const o of oggetti) if (o[c.id]) o[c.id] = { id: o[c.id], titolo: t.get(o[c.id]) ?? o[c.id], ...(collegati ? { valori: collegati.get(o[c.id]) } : {}) };
    }
    if (c.tipo === 'relazione' && c.molti) {
      const T = S.tabellaMolti(def.id, c.id), per = new Map(oggetti.map(o => [o.id, []]));
      const ids = oggetti.map(o => o.id);
      for (const r of db.prepare(`SELECT da, a FROM ${T} WHERE da IN (${ids.map(() => '?').join(',')}) ORDER BY ordine`).all(...ids)) per.get(r.da).push(r.a);
      const t = titoli(db, c.entita, [...per.values()].flat());
      for (const o of oggetti) o[c.id] = per.get(o.id).map(id => ({ id, titolo: t.get(id) ?? id }));
    }
    if (c.tipo === 'righe' && (conRighe || servono.has(c.id)) && profondita < 2) {
      const figlia = defDi(db, c.entita), ids = oggetti.map(o => o.id), per = new Map(ids.map(id => [id, []]));
      const righe = db.prepare(`SELECT * FROM ${S.tabella(c.entita)} WHERE archiviato = 0 AND ${S.colonna(c.campo)} IN (${ids.map(() => '?').join(',')}) ORDER BY creato, id`).all(...ids).map(r => grezzo(figlia, r));
      completa(db, figlia, righe, ctx, { profondita: profondita + 1 });
      for (const r of righe) per.get(typeof r[c.campo] === 'object' ? r[c.campo]?.id : r[c.campo])?.push(r);
      for (const o of oggetti) o[c.id] = per.get(o.id);
    }
  }
  for (const o of oggetti) {
    const valori = { ...o };
    for (const c of attivi) if (c.tipo === 'relazione' && !c.molti && o[c.id]?.valori) valori[c.id] = o[c.id].valori;
    for (const c of calcolati) {
      try { const v = calcola(c.formula, { valori, utente: ctx?.utente?.id }); o[c.id] = typeof v === 'number' && !Number.isFinite(v) ? null : v; valori[c.id] = o[c.id]; }
      catch { o[c.id] = null; }
    }
    for (const c of attivi) if (c.tipo === 'relazione' && !c.molti && o[c.id]?.valori) delete o[c.id].valori;
    for (const c of attivi) if (c.tipo === 'righe' && !conRighe && profondita === 0) delete o[c.id];
    for (const c of attivi) if (P.statoCampo(ctx, def.id, c.id) === 'nascosto') delete o[c.id];
  }
  return oggetti;
}

function leggiMolte(db, entita, ids) {
  const d = defDi(db, entita); if (!ids.length) return [];
  const u = [...new Set(ids)];
  return db.prepare(`SELECT * FROM ${S.tabella(entita)} WHERE id IN (${u.map(() => '?').join(',')})`).all(...u).map(r => grezzo(d, r));
}

// ---------- leggere ----------
const OP = { '=': '=', '!=': '<>', '<>': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
export function elenca(db, entita, { filtri = [], cerca = '', ordina = [], pagina = 1, perPagina = 50, archiviati = false } = {}, ctx = null) {
  const def = defDi(db, entita); P.verifica(ctx, entita, 'leggi');
  const where = [archiviati ? 'archiviato = 1' : 'archiviato = 0'], par = [];
  if (P.soloPropri(ctx, entita)) { where.push('creato_da = ?'); par.push(ctx.utente.id); }
  const dopo = [];   // filtri sui calcolati: si applicano dopo il calcolo
  for (const f of filtri) {
    const c = S.campo(def, f.campo);
    if (!c && !['id', 'creato', 'modificato', 'creato_da'].includes(f.campo)) throw new ErroreDati(`Filtro su un campo sconosciuto «${f.campo}»`);
    if (c && P.statoCampo(ctx, entita, c.id) === 'nascosto') throw new ErroreDati(`Filtro su un campo sconosciuto «${f.campo}»`);
    if (c && !S.haColonna(c)) { dopo.push(f); continue; }
    const col = c ? S.colonna(c.id) : f.campo;
    const val = x => (c?.tipo === 'valuta' && x != null && x !== '' ? Math.round(Number(x) * 100) : c?.tipo === 'si_no' ? (x === true || x === 'true' || x === 1 ? 1 : 0) : x);
    switch (f.op) {
      case 'vuoto': where.push(`(${col} IS NULL OR ${col} = '')`); break;
      case 'nonvuoto': where.push(`(${col} IS NOT NULL AND ${col} <> '')`); break;
      case 'contiene': where.push(`${col} LIKE ? ESCAPE '\\'`); par.push(`%${String(f.valore).replace(/[\\%_]/g, m => '\\' + m)}%`); break;
      case 'inizia': where.push(`${col} LIKE ? ESCAPE '\\'`); par.push(`${String(f.valore).replace(/[\\%_]/g, m => '\\' + m)}%`); break;
      case 'tra': where.push(`${col} BETWEEN ? AND ?`); par.push(val(f.valore?.[0]), val(f.valore?.[1])); break;
      case 'in': { const l = Array.isArray(f.valore) ? f.valore : [f.valore]; where.push(`${col} IN (${l.map(() => '?').join(',') || 'NULL'})`); par.push(...l.map(val)); break; }
      default:
        if (!OP[f.op || '=']) throw new ErroreDati(`Operatore sconosciuto «${f.op}»`);
        if ((f.op || '=') === '=' && f.valore == null) where.push(`${col} IS NULL`);
        else if ((f.op || '=') === '=' && c?.tipo === 'si_no' && !val(f.valore)) where.push(`(${col} = 0 OR ${col} IS NULL)`);   // «no» = falso o mai impostato
        else { where.push(`${col} ${OP[f.op || '=']} ?`); par.push(val(f.valore)); }
    }
  }
  if (cerca && String(cerca).trim()) {
    const testuali = S.campiAttivi(def).filter(c => S.haColonna(c) && ['testo', 'testo_lungo', 'email', 'telefono', 'codice_a_barre', 'contatore', 'indirizzo', 'url'].includes(c.tipo) && P.statoCampo(ctx, entita, c.id) !== 'nascosto');
    for (const parola of String(cerca).trim().split(/\s+/).slice(0, 6)) {
      if (!testuali.length) break;
      where.push(`(${testuali.map(c => `${S.colonna(c.id)} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      const p = `%${parola.replace(/[\\%_]/g, m => '\\' + m)}%`; par.push(...testuali.map(() => p));
    }
  }
  const ord = []; let ordDopo = null;
  for (const o of ordina) {
    const c = S.campo(def, o.campo), dir = o.dir === 'disc' || o.dir === 'desc' ? 'DESC' : 'ASC';
    if (c && !S.haColonna(c)) { ordDopo = { campo: c.id, dir }; continue; }
    if (c) ord.push(`${S.colonna(c.id)} ${dir}`); else if (['creato', 'modificato', 'id'].includes(o.campo)) ord.push(`${o.campo} ${dir}`);
  }
  ord.push('creato DESC', 'id DESC');
  const per = Math.max(1, Math.min(500, Number(perPagina) || 50)), pag = Math.max(1, Number(pagina) || 1);
  const W = `WHERE ${where.join(' AND ')}`, T = S.tabella(entita);
  let righe, totale;
  if (dopo.length || ordDopo) {   // servono i calcolati: si legge tutto (fino a 5000), si filtra e si ordina qui
    righe = completa(db, def, db.prepare(`SELECT * FROM ${T} ${W} ORDER BY ${ord.join(', ')} LIMIT 5000`).all(...par).map(r => grezzo(def, r)), ctx);
    righe = righe.filter(r => dopo.every(f => confrontaFiltro(r[f.campo], f)));
    if (ordDopo) righe.sort((a, b) => (a[ordDopo.campo] > b[ordDopo.campo] ? 1 : a[ordDopo.campo] < b[ordDopo.campo] ? -1 : 0) * (ordDopo.dir === 'DESC' ? -1 : 1));
    totale = righe.length; righe = righe.slice((pag - 1) * per, pag * per);
  } else {
    totale = db.prepare(`SELECT COUNT(*) n FROM ${T} ${W}`).get(...par).n;
    righe = completa(db, def, db.prepare(`SELECT * FROM ${T} ${W} ORDER BY ${ord.join(', ')} LIMIT ? OFFSET ?`).all(...par, per, (pag - 1) * per).map(r => grezzo(def, r)), ctx);
  }
  return { righe, totale, pagina: pag, perPagina: per };
}
function confrontaFiltro(v, f) {
  const x = v, y = f.valore;
  switch (f.op || '=') {
    case '=': return y === false ? !x : x == y; case '!=': case '<>': return x != y;
    case '<': return x < y; case '<=': return x <= y; case '>': return x > y; case '>=': return x >= y;
    case 'vuoto': return x == null || x === ''; case 'nonvuoto': return !(x == null || x === '');
    case 'contiene': return String(x ?? '').toLowerCase().includes(String(y).toLowerCase());
    case 'inizia': return String(x ?? '').toLowerCase().startsWith(String(y).toLowerCase());
    case 'tra': return x >= y?.[0] && x <= y?.[1];
    case 'in': return (Array.isArray(y) ? y : [y]).includes(x);
  }
  return true;
}

export function leggi(db, entita, id, ctx = null, { conRighe = true } = {}) {
  const def = defDi(db, entita); P.verifica(ctx, entita, 'leggi');
  const r = db.prepare(`SELECT * FROM ${S.tabella(entita)} WHERE id = ?`).get(String(id));
  if (!r || (P.soloPropri(ctx, entita) && r.creato_da !== ctx.utente.id)) throw new ErroreDati('Non trovato');
  return completa(db, def, [grezzo(def, r)], ctx, { conRighe })[0];
}

// ---------- scrivere ----------
function prepara(db, def, valori, ctx, { prima = null } = {}) {
  const set = {}, molti = {}, righe = {}, errori = {};
  for (const [k, v] of Object.entries(valori || {})) {
    if (['id', 'creato', 'modificato', 'creato_da', 'modificato_da', 'archiviato'].includes(k)) continue;
    const c = S.campo(def, k);
    if (!c || c.archiviato) { errori[k] = `«${k}» non è un campo di ${def.nome}`; continue; }
    const st = P.statoCampo(ctx, def.id, c.id);
    if (st === 'nascosto' || st === 'lettura') { errori[k] = `«${c.nome}» non si può modificare`; continue; }
    if (['calcolato', 'contatore'].includes(c.tipo)) continue;   // si calcolano da soli
    if (c.tipo === 'righe') { if (Array.isArray(v)) righe[k] = v; continue; }
    try {
      const n = normalizza(db, def, c, v, { prima: prima?.[S.colonna(c.id)] });
      if (c.tipo === 'relazione' && c.molti) molti[k] = n || []; else set[k] = n;
    } catch (e) { if (e instanceof ErroreDati) Object.assign(errori, e.campi); else throw e; }
  }
  if (Object.keys(errori).length) throw new ErroreDati(Object.values(errori)[0], errori);
  return { set, molti, righe };
}

function controllaObbligatori(def, riga) {
  const errori = {};
  for (const c of S.campiAttivi(def)) if (c.obbligatorio && S.haColonna(c) && c.tipo !== 'contatore' && (riga[S.colonna(c.id)] == null || riga[S.colonna(c.id)] === '')) errori[c.id] = `«${c.nome}» è obbligatorio`;
  if (Object.keys(errori).length) throw new ErroreDati(Object.values(errori)[0], errori);
}

function scriviMolti(db, def, id, molti) {
  for (const [k, ids] of Object.entries(molti)) {
    const T = S.tabellaMolti(def.id, k); db.prepare(`DELETE FROM ${T} WHERE da = ?`).run(id);
    const ins = db.prepare(`INSERT OR IGNORE INTO ${T} (da, a, ordine) VALUES (?, ?, ?)`); ids.forEach((a, i) => ins.run(id, a, i));
  }
}
function scriviRighe(db, def, id, righe, ctx) {
  for (const [k, lista] of Object.entries(righe)) {
    const c = S.campo(def, k), presenti = new Set();
    for (const r of lista) {
      const valori = { ...r, [c.campo]: id };
      if (r.id) { presenti.add(r.id); modifica(db, c.entita, r.id, valori, ctx, { interno: true }); }
      else presenti.add(crea(db, c.entita, valori, ctx, { interno: true }).id);
    }
    for (const x of db.prepare(`SELECT id FROM ${S.tabella(c.entita)} WHERE ${S.colonna(c.campo)} = ? AND archiviato = 0`).all(id)) if (!presenti.has(x.id)) elimina(db, c.entita, x.id, ctx, { interno: true });
  }
}
const notifica = (ev, db, ctx) => { for (const f of ascoltatori) f(ev, db, ctx); };

export function crea(db, entita, valori, ctx = null, { interno = false } = {}) {
  const def = defDi(db, entita); P.verifica(ctx, entita, 'crea');
  return transazione(db, () => {
    const { set, molti, righe } = prepara(db, def, valori, ctx);
    const id = valori?.id && interno ? String(valori.id) : nuovoId(), t = ora(), chi = ctx?.utente?.id ?? null;
    const riga = { id, creato: t, modificato: t, creato_da: chi, modificato_da: chi };
    for (const c of S.campiAttivi(def)) {
      if (c.tipo === 'contatore') riga[S.colonna(c.id)] = prossimoNumero(db, c.serie || `${def.id}.${c.id}`, c.formato);
      else if (S.haColonna(c) && set[c.id] === undefined && c.predefinito !== undefined) riga[S.colonna(c.id)] = normalizza(db, def, c, c.predefinito === '@oggi' ? new Date().toISOString().slice(0, 10) : c.predefinito === '@utente' ? chi : c.predefinito);
      else if (c.tipo === 'stato' && set[c.id] === undefined) riga[S.colonna(c.id)] = c.iniziale || c.opzioni[0].id;
    }
    for (const [k, v] of Object.entries(set)) riga[S.colonna(k)] = v;
    controllaObbligatori(def, riga);
    const cols = Object.keys(riga);
    try { db.prepare(`INSERT INTO ${S.tabella(entita)} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(k => riga[k])); }
    catch (e) { throw unicita(def, e); }
    scriviMolti(db, def, id, molti); scriviRighe(db, def, id, righe, ctx);
    const dopo = leggi(db, entita, id, null);
    registra(db, { utente: chi, tipo: 'crea', entita, riga: id, dopo });
    notifica({ tipo: 'crea', entita, id, prima: null, dopo, interno }, db, ctx);
    return ctx ? leggi(db, entita, id, ctx) : dopo;
  });
}

export function modifica(db, entita, id, valori, ctx = null, { interno = false } = {}) {
  const def = defDi(db, entita); P.verifica(ctx, entita, 'modifica');
  return transazione(db, () => {
    const vecchia = db.prepare(`SELECT * FROM ${S.tabella(entita)} WHERE id = ?`).get(String(id));
    if (!vecchia || (P.soloPropri(ctx, entita) && vecchia.creato_da !== ctx.utente.id)) throw new ErroreDati('Non trovato');
    const prima = leggi(db, entita, id, null);
    const { set, molti, righe } = prepara(db, def, valori, ctx, { prima: vecchia });
    const nuova = { ...vecchia }; for (const [k, v] of Object.entries(set)) nuova[S.colonna(k)] = v;
    controllaObbligatori(def, nuova);
    const cols = Object.keys(set).map(S.colonna);
    nuova.modificato = ora(); nuova.modificato_da = ctx?.utente?.id ?? null;
    try {
      db.prepare(`UPDATE ${S.tabella(entita)} SET ${[...cols, 'modificato', 'modificato_da'].map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map(c => nuova[c]), nuova.modificato, nuova.modificato_da, String(id));
    } catch (e) { throw unicita(def, e); }
    scriviMolti(db, def, id, molti); scriviRighe(db, def, id, righe, ctx);
    const dopo = leggi(db, entita, id, null);
    registra(db, { utente: nuova.modificato_da, tipo: 'modifica', entita, riga: String(id), prima: diff(prima, dopo).prima, dopo: diff(prima, dopo).dopo });
    notifica({ tipo: 'modifica', entita, id: String(id), prima, dopo, interno }, db, ctx);
    return ctx ? leggi(db, entita, id, ctx) : dopo;
  });
}

// eliminare = archiviare (si ripristina); le righe figlie seguono il padre
export function elimina(db, entita, id, ctx = null, { interno = false } = {}) {
  const def = defDi(db, entita); P.verifica(ctx, entita, interno ? 'modifica' : 'elimina');
  return transazione(db, () => {
    const prima = leggi(db, entita, id, ctx);
    db.prepare(`UPDATE ${S.tabella(entita)} SET archiviato = 1, modificato = ?, modificato_da = ? WHERE id = ?`).run(ora(), ctx?.utente?.id ?? null, String(id));
    for (const c of S.campiAttivi(def).filter(c => c.tipo === 'righe')) db.prepare(`UPDATE ${S.tabella(c.entita)} SET archiviato = 1 WHERE ${S.colonna(c.campo)} = ?`).run(String(id));
    registra(db, { utente: ctx?.utente?.id ?? null, tipo: 'elimina', entita, riga: String(id), prima });
    notifica({ tipo: 'elimina', entita, id: String(id), prima, dopo: null, interno }, db, ctx);
    return true;
  });
}
export function ripristina(db, entita, id, ctx = null) {
  const def = defDi(db, entita); P.verifica(ctx, entita, 'elimina');
  return transazione(db, () => {
    db.prepare(`UPDATE ${S.tabella(entita)} SET archiviato = 0, modificato = ? WHERE id = ?`).run(ora(), String(id));
    for (const c of S.campiAttivi(def).filter(c => c.tipo === 'righe')) db.prepare(`UPDATE ${S.tabella(c.entita)} SET archiviato = 0 WHERE ${S.colonna(c.campo)} = ?`).run(String(id));
    const dopo = leggi(db, entita, id, ctx);
    registra(db, { utente: ctx?.utente?.id ?? null, tipo: 'ripristina', entita, riga: String(id), dopo });
    notifica({ tipo: 'ripristina', entita, id: String(id), prima: null, dopo }, db, ctx);
    return dopo;
  });
}

function unicita(def, e) {
  const m = String(e.message).match(/UNIQUE constraint failed: d_\w+\.c_(\w+)/) || String(e.message).match(/u_\w+?_(\w+)/);
  if (m) { const c = S.campo(def, m[1]); const t = `«${c?.nome || m[1]}» deve essere unico: c'è già questo valore`; return new ErroreDati(t, { [m[1]]: t }); }
  return e;
}
function diff(a, b) {
  const prima = {}, dopo = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (['modificato', 'modificato_da'].includes(k)) continue;
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) { prima[k] = a?.[k] ?? null; dopo[k] = b?.[k] ?? null; }
  }
  return { prima, dopo };
}

export function storia(db, entita, id, ctx = null) {
  P.verifica(ctx, entita, 'leggi');
  return db.prepare('SELECT r.quando, r.tipo, r.prima, r.dopo, u.nome AS chi FROM _registro r LEFT JOIN _utenti u ON u.id = r.utente WHERE r.entita = ? AND r.riga = ? ORDER BY r.id DESC LIMIT 200')
    .all(entita, String(id)).map(r => ({ ...r, prima: r.prima && JSON.parse(r.prima), dopo: r.dopo && JSON.parse(r.dopo) }));
}
