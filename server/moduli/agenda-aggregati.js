// Aggregati per il cruscotto e per i totali delle liste: conta, somma, media, minimo, massimo, raggruppati per periodo
// (giorno, settimana, mese, anno, nel fuso dell'azienda) o per un campo (stato, scelta, relazione, utente, sì/no).
// Si legge sempre attraverso dati.js con il ctx dell'utente: permessi, «solo i propri», campi nascosti e calcolati
// valgono da soli. Le valute si sommano in centesimi interi, così 0,10 + 0,20 fa 0,30 e non 0,30000000000000004.
// Nei filtri si possono usare date relative: «@oggi», «@oggi-7», «@oggi+30», «@inizio_mese», «@inizio_settimana», «@ora».
// Questo file non registra rotte (le rotte stanno in agenda.js): esporta solo funzioni.
import * as S from '../schema.js';
import * as D from '../dati.js';
import * as P from '../permessi.js';
import { analizza, nomi } from '../formule.js';

export const FUSO = 'Europe/Rome';
const SISTEMA = { creato: 'data_ora', modificato: 'data_ora' };
const MAX_RIGHE = 20000;

// ---------- date nel fuso ----------
const fmt = new Map();
function parti(ms, fuso = FUSO) {
  if (!fmt.has(fuso)) fmt.set(fuso, new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  const o = Object.fromEntries(fmt.get(fuso).formatToParts(new Date(ms)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  return o;
}
// «2026-10-07» (giorno locale) di un istante
export function giornoDi(istante, fuso = FUSO) { const p = parti(new Date(istante).getTime(), fuso); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }
// l'istante (ISO, UTC) della mezzanotte locale di un giorno: gestisce l'ora legale
export function mezzanotte(giorno, fuso = FUSO) {
  const [y, m, d] = giorno.split('-').map(Number), base = Date.UTC(y, m - 1, d);
  let t = base;
  for (let i = 0; i < 2; i++) { const p = parti(t, fuso); const visto = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second); t = base - (visto - t); }
  return new Date(t).toISOString();
}
export function piuGiorni(giorno, n) { const [y, m, d] = giorno.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
const lunedi = g => { const [y, m, d] = g.split('-').map(Number); const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; return piuGiorni(g, -dow); };
// la chiave del gruppo per un giorno: giorno → 2026-10-07, settimana → il lunedì, mese → 2026-10, anno → 2026
export function chiavePeriodo(giorno, per) { return per === 'settimana' ? lunedi(giorno) : per === 'mese' ? giorno.slice(0, 7) : per === 'anno' ? giorno.slice(0, 4) : giorno; }
// tutte le chiavi fra due giorni (così il grafico ha anche i giorni a zero)
export function chiaviFra(da, a, per) {
  const out = []; let g = da;
  for (let i = 0; i < 1000 && g <= a; i++) { const k = chiavePeriodo(g, per); if (out[out.length - 1] !== k) out.push(k); g = piuGiorni(g, 1); }
  return out;
}

// ---------- periodi con nome: { da, a } giorni locali inclusi, e quello prima della stessa lunghezza ----------
export function periodo(nome, { adesso = new Date(), fuso = FUSO } = {}) {
  const oggi = giornoDi(adesso, fuso), mese = oggi.slice(0, 8) + '01';
  const fineMese = g => piuGiorni(chiavePeriodo(piuGiorni(g.slice(0, 8) + '28', 4), 'mese') + '-01', -1);
  const m = /^ultimi_(\d+)$/.exec(nome || '');
  if (m) { const n = Math.min(3660, Number(m[1])); return { da: piuGiorni(oggi, -(n - 1)), a: oggi, prima: { da: piuGiorni(oggi, -(2 * n - 1)), a: piuGiorni(oggi, -n) } }; }
  switch (nome) {
    case 'oggi': return { da: oggi, a: oggi, prima: { da: piuGiorni(oggi, -1), a: piuGiorni(oggi, -1) } };
    case 'settimana': { const l = lunedi(oggi); return { da: l, a: piuGiorni(l, 6), prima: { da: piuGiorni(l, -7), a: piuGiorni(l, -1) } }; }
    case 'mese': { const pm = chiavePeriodo(piuGiorni(mese, -1), 'mese') + '-01'; return { da: mese, a: fineMese(mese), prima: { da: pm, a: fineMese(pm) } }; }
    case 'anno': { const y = Number(oggi.slice(0, 4)); return { da: `${y}-01-01`, a: `${y}-12-31`, prima: { da: `${y - 1}-01-01`, a: `${y - 1}-12-31` } }; }
    case 'sempre': case undefined: case null: case '': return null;
    default: throw new D.ErroreDati(`Periodo sconosciuto «${nome}»`);
  }
}

// ---------- date relative nei filtri ----------
const tipoDi = (def, id) => SISTEMA[id] || S.campo(def, id)?.tipo;
function risolviData(v, tipo, { adesso, fuso }) {
  if (typeof v !== 'string' || !v.startsWith('@')) return v;
  if (v === '@ora') return new Date(adesso).toISOString();
  const m = /^@(oggi|inizio_settimana|inizio_mese)([+-]\d+)?$/.exec(v); if (!m) return v;
  const oggi = giornoDi(adesso, fuso);
  let g = m[1] === 'oggi' ? oggi : m[1] === 'inizio_settimana' ? lunedi(oggi) : oggi.slice(0, 8) + '01';
  g = piuGiorni(g, Number(m[2] || 0));
  return tipo === 'data_ora' ? mezzanotte(g, fuso) : g;
}
export function risolviFiltri(def, filtri = [], opz = {}) {
  const o = { adesso: opz.adesso || new Date(), fuso: opz.fuso || FUSO };
  return (Array.isArray(filtri) ? filtri : []).map(f => {
    const tipo = tipoDi(def, f.campo);
    if (!['data', 'data_ora'].includes(tipo) && !(tipo === 'calcolato')) return f;
    // «periodo»: oggi, settimana, mese, anno, ultimi_N → due filtri >= e <
    return { ...f, valore: Array.isArray(f.valore) ? f.valore.map(x => risolviData(x, tipo, o)) : risolviData(f.valore, tipo, o) };
  }).flatMap(f => {
    if (f.op !== 'periodo') return [f];
    const pr = periodo(f.valore, o); if (!pr) return [];
    return filtriFra(def, f.campo, pr.da, pr.a, o.fuso);
  });
}
// i filtri per «campo fra il giorno da e il giorno a» (inclusi), giusti per data e per data_ora
export function filtriFra(def, campo, da, a, fuso = FUSO) {
  const tipo = tipoDi(def, campo);
  if (tipo === 'data') return [{ campo, op: '>=', valore: da }, { campo, op: '<=', valore: a }];
  return [{ campo, op: '>=', valore: mezzanotte(da, fuso) }, { campo, op: '<', valore: mezzanotte(piuGiorni(a, 1), fuso) }];
}

// ---------- lettura completa (a pagine) con i permessi dell'utente ----------
export function tutte(db, entita, filtri, ctx, { limite = MAX_RIGHE } = {}) {
  const out = []; let pagina = 1, totale = 0;
  for (;;) {
    const r = D.elenca(db, entita, { filtri, pagina, perPagina: 500 }, ctx);
    totale = r.totale; out.push(...r.righe);
    if (r.righe.length < 500 || out.length >= limite || out.length >= totale) break;
    pagina++;
  }
  return { righe: out.slice(0, limite), troncato: totale > limite };
}

// ---------- l'aggregato ----------
// richiesta: { entita, misure: [{ misura: 'conta'|'somma'|'media'|'min'|'max', campo? }] (o misura+campo singoli),
//   filtri, per: 'giorno'|'settimana'|'mese'|'anno'|<id campo>|null, campoData, periodo | da+a, confronta }
// → { gruppi: [{ chiave, etichetta, valori: [..] }], totali: [..], prima?: [..], valuta: [bool..], da, a }
export function aggrega(db, rich, ctx, opz = {}) {
  const fuso = opz.fuso || FUSO, adesso = opz.adesso || new Date();
  const def = S.leggi(db, rich.entita); if (!def || def.archiviata) throw new D.ErroreDati(`Entità sconosciuta «${rich.entita}»`);
  P.verifica(ctx, def.id, 'leggi');
  const nascosto = id => !SISTEMA[id] && id !== 'id' && (!S.campo(def, id) || S.campo(def, id).archiviato || P.statoCampo(ctx, def.id, id) === 'nascosto');
  const misure = (rich.misure || [{ misura: rich.misura || 'conta', campo: rich.campo }]).slice(0, 8).map(m => ({ misura: m.misura || 'conta', campo: m.campo || null }));
  for (const m of misure) {
    if (!['conta', 'somma', 'media', 'min', 'max'].includes(m.misura)) throw new D.ErroreDati(`Misura sconosciuta «${m.misura}»`);
    if (m.misura !== 'conta' && (!m.campo || nascosto(m.campo))) throw new D.ErroreDati(`Campo sconosciuto «${m.campo}»`);
  }
  const per = rich.per || null, perTempo = ['giorno', 'settimana', 'mese', 'anno'].includes(per);
  const campoData = rich.campoData || (perTempo || rich.periodo || rich.da ? primoCampoData(def) : null);
  if (campoData && nascosto(campoData)) throw new D.ErroreDati(`Campo sconosciuto «${campoData}»`);
  if (per && !perTempo && nascosto(per)) throw new D.ErroreDati(`Campo sconosciuto «${per}»`);
  let filtri = risolviFiltri(def, rich.filtri, { adesso, fuso });
  for (const f of filtri) if (nascosto(f.campo)) throw new D.ErroreDati(`Filtro su un campo sconosciuto «${f.campo}»`);
  const pr = rich.da && rich.a ? { da: String(rich.da), a: String(rich.a) } : periodo(rich.periodo, { adesso, fuso });
  const giorno = /^\d{4}-\d{2}-\d{2}$/;
  if (pr && (!giorno.test(pr.da) || !giorno.test(pr.a))) throw new D.ErroreDati('Periodo non valido (AAAA-MM-GG)');
  if (pr && !campoData) throw new D.ErroreDati('Serve un campo data per il periodo');
  const leggi = (da, a) => tutte(db, def.id, [...filtri, ...(da ? filtriFra(def, campoData, da, a, fuso) : [])], ctx);
  const { righe, troncato } = leggi(pr?.da, pr?.a);

  const valuta = misure.map(m => isValuta(db, def, m.campo));
  const calcolaMisure = elenco => misure.map((m, i) => misura(elenco, m, valuta[i]));
  const out = { totali: calcolaMisure(righe), valuta, troncato, campoData, da: pr?.da ?? null, a: pr?.a ?? null };
  if (rich.confronta && pr?.prima) out.prima = calcolaMisure(leggi(pr.prima.da, pr.prima.a).righe);
  else if (rich.confronta && pr && rich.da) {   // periodo libero: quello subito prima, della stessa lunghezza
    const n = Math.round((Date.parse(pr.a) - Date.parse(pr.da)) / 864e5) + 1;
    out.prima = calcolaMisure(leggi(piuGiorni(pr.da, -n), piuGiorni(pr.da, -1)).righe);
  }
  if (!per) return out;
  const gruppi = new Map();
  const metti = (k, etichetta, r) => { if (!gruppi.has(k)) gruppi.set(k, { chiave: k, etichetta, righe: [] }); if (r) gruppi.get(k).righe.push(r); };
  if (perTempo) {
    if (pr) for (const k of chiaviFra(pr.da, pr.a, per)) metti(k, k);
    for (const r of righe) {
      const v = r[campoData]; if (!v) continue;
      const g = tipoDi(def, campoData) === 'data' ? String(v).slice(0, 10) : giornoDi(v, fuso);
      metti(chiavePeriodo(g, per), chiavePeriodo(g, per), r);
    }
  } else {
    const c = S.campo(def, per), opzioni = c.opzioni || [];
    if (['scelta', 'stato'].includes(c.tipo)) for (const o of opzioni) metti(o.id, o.nome);
    const nomiUtenti = c.tipo === 'utente' ? new Map(db.prepare('SELECT id, nome FROM _utenti').all().map(u => [u.id, u.nome])) : null;
    for (const r of righe) {
      let v = r[per], k, et;
      if (v && typeof v === 'object' && !Array.isArray(v)) { k = v.id; et = v.titolo; }
      else if (c.tipo === 'utente') { k = v ?? ''; et = nomiUtenti.get(v) || (v ? v : 'Nessuno'); }
      else if (c.tipo === 'si_no' || typeof v === 'boolean') { k = v ? 'si' : 'no'; et = v ? 'Sì' : 'No'; }
      else { k = v ?? ''; et = opzioni.find(o => o.id === v)?.nome ?? (v == null || v === '' ? 'Nessuno' : String(v)); }
      metti(String(k), et, r);
    }
  }
  let elenco = [...gruppi.values()];
  if (perTempo) elenco.sort((a, b) => (a.chiave < b.chiave ? -1 : 1));
  out.gruppi = elenco.map(g => ({ chiave: g.chiave, etichetta: g.etichetta, conta: g.righe.length, valori: calcolaMisure(g.righe) }));
  return out;
}
export function primoCampoData(def) { const c = S.campiAttivi(def); return (c.find(x => x.tipo === 'data_ora') || c.find(x => x.tipo === 'data'))?.id || 'creato'; }
// una misura è in euro se il campo è una valuta, o un calcolato che usa valute (anche nelle righe figlie: SOMMA(righe.totale))
export function isValuta(db, def, id, prof = 0) {
  const c = id && S.campo(def, id); if (!c || prof > 3) return false;
  if (c.tipo === 'valuta') return true;
  if (c.tipo !== 'calcolato') return false;
  if (c.formato) return c.formato === 'valuta';
  let usati; try { usati = [...nomi(analizza(c.formula || ''))]; } catch { return false; }
  return usati.some(n => {
    const [a, b] = n.split('.'), k = S.campo(def, a); if (!k || k.id === c.id) return false;
    if (b && ['righe', 'relazione'].includes(k.tipo)) { const altra = S.leggi(db, k.entita); return !!altra && isValuta(db, altra, b, prof + 1); }
    return isValuta(db, def, a, prof + 1);
  });
}
function misura(righe, m, valuta) {
  if (m.misura === 'conta') return m.campo ? righe.filter(r => r[m.campo] != null && r[m.campo] !== '' && r[m.campo] !== false).length : righe.length;
  const nums = righe.map(r => r[m.campo]).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return m.misura === 'somma' ? 0 : null;
  if (m.misura === 'min') return Math.min(...nums);
  if (m.misura === 'max') return Math.max(...nums);
  // somma intera: centesimi per le valute, così gli euro non accumulano errori di arrotondamento
  const s = valuta ? nums.reduce((t, v) => t + Math.round(v * 100), 0) / 100 : nums.reduce((t, v) => t + v, 0);
  if (m.misura === 'somma') return valuta ? s : Math.round(s * 1e6) / 1e6;
  const media = s / nums.length;
  return valuta ? Math.round(media * 100) / 100 : Math.round(media * 1e4) / 1e4;
}
