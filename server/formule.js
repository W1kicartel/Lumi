// Formule dei campi calcolati e delle automazioni: un linguaggio piccolo, alla Excel, valutato senza eval.
//   quantita * prezzo · SOMMA(righe.totale) · SE(giacenza <= soglia; "riordina"; "") · GIORNI(OGGI(); scadenza)
// Separatore degli argomenti «;» (come Excel in italiano) oppure «,». Decimali con il punto. Testo fra virgolette.
// Operatori: + - * / % ^, & (concatena), = <> < <= > >=, E O NON (anche AND OR NOT). Nomi: id dei campi, «righe.campo»
// per le sotto-tabelle (diventano liste), «@utente», «@oggi». Errori: lancia ErroreFormula con la posizione.

export class ErroreFormula extends Error {
  constructor(messaggio, pos) { super(messaggio); this.pos = pos; }
}

const PAROLE = { E: 'and', AND: 'and', O: 'or', OR: 'or', NON: 'not', NOT: 'not', VERO: true, TRUE: true, FALSO: false, FALSE: false };

function tokenizza(s) {
  const t = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1]))) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      t.push({ k: 'num', v: Number(s.slice(i, j)), pos: i }); i = j; continue;
    }
    if (c === '"' || c === '“' || c === '”') {
      let j = i + 1, v = '';
      while (j < s.length && !['"', '”'].includes(s[j])) { if (s[j] === '\\' && j + 1 < s.length) j++; v += s[j]; j++; }
      if (j >= s.length) throw new ErroreFormula('Virgolette non chiuse', i);
      t.push({ k: 'str', v, pos: i }); i = j + 1; continue;
    }
    if (/[\p{L}_@]/u.test(c)) {
      let j = i; while (j < s.length && /[\p{L}\p{N}_.@]/u.test(s[j])) j++;
      const w = s.slice(i, j), W = w.toUpperCase();
      if (W in PAROLE) {
        const v = PAROLE[W];
        t.push(typeof v === 'boolean' ? { k: 'bool', v, pos: i } : { k: 'op', v, pos: i });
      } else t.push({ k: 'nome', v: w, pos: i });
      i = j; continue;
    }
    const due = s.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '=='].includes(due)) { t.push({ k: 'op', v: due === '!=' ? '<>' : due === '==' ? '=' : due, pos: i }); i += 2; continue; }
    if ('+-*/%^&=<>'.includes(c)) { t.push({ k: 'op', v: c, pos: i }); i++; continue; }
    if (c === '(' || c === ')') { t.push({ k: c, pos: i }); i++; continue; }
    if (c === ';' || c === ',') { t.push({ k: 'sep', pos: i }); i++; continue; }
    throw new ErroreFormula(`Carattere non valido «${c}»`, i);
  }
  t.push({ k: 'fine', pos: s.length });
  return t;
}

// precedenze (Pratt): più alto = lega di più
const BIN = { or: 1, and: 2, '=': 3, '<>': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '&': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 8 };

export function analizza(sorgente) {
  const t = tokenizza(String(sorgente)); let p = 0;
  const vedi = () => t[p], prendi = () => t[p++];
  function atteso(k) { const x = prendi(); if (x.k !== k) throw new ErroreFormula(k === ')' ? 'Manca una parentesi chiusa' : `Atteso ${k}`, x.pos); return x; }
  function primario() {
    const x = prendi();
    if (x.k === 'num' || x.k === 'str' || x.k === 'bool') return { t: 'val', v: x.v };
    if (x.k === '(') { const e = espr(0); atteso(')'); return e; }
    if (x.k === 'op' && (x.v === '-' || x.v === '+')) return { t: 'un', op: x.v, e: espr(7) };
    if (x.k === 'op' && x.v === 'not') return { t: 'un', op: 'not', e: espr(3) };
    if (x.k === 'nome') {
      if (vedi().k === '(') {
        prendi(); const arg = [];
        if (vedi().k !== ')') { do { arg.push(espr(0)); } while (vedi().k === 'sep' && prendi()); }
        atteso(')');
        const f = x.v.toUpperCase(); if (!(f in FUNZIONI)) throw new ErroreFormula(`Funzione sconosciuta ${x.v}`, x.pos);
        return { t: 'fn', f, arg, pos: x.pos };
      }
      return { t: 'nome', v: x.v, pos: x.pos };
    }
    throw new ErroreFormula(x.k === 'fine' ? 'Formula incompleta' : 'Simbolo inatteso', x.pos);
  }
  function espr(min) {
    let s = primario();
    for (;;) {
      const x = vedi(); if (x.k !== 'op' || !(x.v in BIN) || BIN[x.v] <= min) break;
      prendi(); const destra = x.v === '^' ? espr(BIN[x.v] - 1) : espr(BIN[x.v]);
      s = { t: 'bin', op: x.v, a: s, b: destra };
    }
    return s;
  }
  const albero = espr(0);
  if (vedi().k !== 'fine') throw new ErroreFormula('Simbolo inatteso', vedi().pos);
  return albero;
}

// nomi usati da una formula (per sapere da quali campi dipende e per validarla contro lo schema)
export function nomi(albero, out = new Set()) {
  if (!albero) return out;
  if (albero.t === 'nome') out.add(albero.v);
  for (const k of ['e', 'a', 'b']) if (albero[k]) nomi(albero[k], out);
  for (const a of albero.arg || []) nomi(a, out);
  return out;
}

const num = v => (v == null || v === '' ? 0 : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v));
const lista = v => (Array.isArray(v) ? v : [v]).flat(Infinity).filter(x => x != null && x !== '');
const giorno = v => { if (v == null || v === '') return null; const d = new Date(String(v).length === 10 ? v + 'T00:00:00Z' : v); return isNaN(d) ? null : d; };
const isoGiorno = d => d.toISOString().slice(0, 10);

export const FUNZIONI = {
  SOMMA: a => lista(a).reduce((s, x) => s + num(x), 0),
  MEDIA: a => { const l = lista(a); return l.length ? l.reduce((s, x) => s + num(x), 0) / l.length : 0; },
  MIN: a => { const l = lista(a).map(num); return l.length ? Math.min(...l) : 0; },
  MAX: a => { const l = lista(a).map(num); return l.length ? Math.max(...l) : 0; },
  CONTA: a => lista(a).length,
  SE: (a, ctx, pigro) => (verita(pigro(0)) ? pigro(1) : a.length > 2 ? pigro(2) : ''),
  VUOTO: a => a[0] == null || a[0] === '' || (Array.isArray(a[0]) && !a[0].length),
  ARROTONDA: a => { const k = 10 ** num(a[1] ?? 0); return Math.round(num(a[0]) * k) / k; },
  ASS: a => Math.abs(num(a[0])),
  CONCATENA: a => lista(a).join(''),
  MAIUSCOLO: a => String(a[0] ?? '').toUpperCase(),
  MINUSCOLO: a => String(a[0] ?? '').toLowerCase(),
  LUNGHEZZA: a => String(a[0] ?? '').length,
  OGGI: (a, ctx) => isoGiorno(ctx.adesso ? new Date(ctx.adesso) : new Date()),
  ADESSO: (a, ctx) => (ctx.adesso ? new Date(ctx.adesso) : new Date()).toISOString(),
  GIORNI: a => { const x = giorno(a[0]), y = giorno(a[1]); return x && y ? Math.round((y - x) / 864e5) : null; },
  AGGIUNGIGIORNI: a => { const d = giorno(a[0]); if (!d) return null; d.setUTCDate(d.getUTCDate() + num(a[1])); return isoGiorno(d); },
  ANNO: a => { const d = giorno(a[0]); return d ? d.getUTCFullYear() : null; },
  MESE: a => { const d = giorno(a[0]); return d ? d.getUTCMonth() + 1 : null; },
};
// in italiano e in inglese
Object.assign(FUNZIONI, { SUM: FUNZIONI.SOMMA, AVERAGE: FUNZIONI.MEDIA, COUNT: FUNZIONI.CONTA, IF: FUNZIONI.SE, ISBLANK: FUNZIONI.VUOTO,
  ROUND: FUNZIONI.ARROTONDA, ABS: FUNZIONI.ASS, CONCAT: FUNZIONI.CONCATENA, UPPER: FUNZIONI.MAIUSCOLO, LOWER: FUNZIONI.MINUSCOLO,
  LEN: FUNZIONI.LUNGHEZZA, TODAY: FUNZIONI.OGGI, NOW: FUNZIONI.ADESSO, DAYS: FUNZIONI.GIORNI, ADDDAYS: FUNZIONI.AGGIUNGIGIORNI,
  YEAR: FUNZIONI.ANNO, MONTH: FUNZIONI.MESE });

const verita = v => (Array.isArray(v) ? v.length > 0 : !!v && v !== '0');
function confronta(a, b) {
  if (typeof a === 'number' || typeof b === 'number') return num(a) - num(b);
  const x = String(a ?? ''), y = String(b ?? ''); return x < y ? -1 : x > y ? 1 : 0;
}

// ctx: { valori: {campo: valore, righe: [{...}, …]}, adesso?, utente? }
export function valuta(albero, ctx) {
  const V = ctx.valori || {};
  function risolvi(nome) {
    if (nome === '@oggi') return FUNZIONI.OGGI([], ctx);
    if (nome === '@utente') return ctx.utente ?? null;
    if (nome in V) return V[nome];
    const [a, b] = nome.split('.');
    if (b && Array.isArray(V[a])) return V[a].map(r => r?.[b]);
    if (b && V[a] && typeof V[a] === 'object') return V[a][b];
    throw new ErroreFormula(`Campo sconosciuto «${nome}»`);
  }
  function ev(n) {
    switch (n.t) {
      case 'val': return n.v;
      case 'nome': return risolvi(n.v);
      case 'un': { const x = ev(n.e); return n.op === 'not' ? !verita(x) : n.op === '-' ? -num(x) : num(x); }
      case 'fn': {
        if (n.f === 'SE' || n.f === 'IF') return FUNZIONI.SE(n.arg, ctx, i => ev(n.arg[i]));
        return FUNZIONI[n.f](n.arg.map(ev), ctx);
      }
      case 'bin': {
        if (n.op === 'and') return verita(ev(n.a)) && verita(ev(n.b));
        if (n.op === 'or') return verita(ev(n.a)) || verita(ev(n.b));
        const a = ev(n.a), b = ev(n.b);
        switch (n.op) {
          case '+': return num(a) + num(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': return num(b) === 0 ? null : num(a) / num(b);
          case '%': return num(b) === 0 ? null : num(a) % num(b);
          case '^': return num(a) ** num(b);
          case '&': return String(a ?? '') + String(b ?? '');
          case '=': return confronta(a, b) === 0;
          case '<>': return confronta(a, b) !== 0;
          case '<': return confronta(a, b) < 0;
          case '<=': return confronta(a, b) <= 0;
          case '>': return confronta(a, b) > 0;
          case '>=': return confronta(a, b) >= 0;
        }
      }
    }
    throw new ErroreFormula('Formula non valida');
  }
  return ev(albero);
}

const cache = new Map();
export function calcola(sorgente, ctx) {
  let a = cache.get(sorgente); if (!a) { a = analizza(sorgente); if (cache.size > 2000) cache.clear(); cache.set(sorgente, a); }
  return valuta(a, ctx);
}
