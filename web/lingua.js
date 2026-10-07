// Le lingue di Kubo. Ogni testo dell'interfaccia sta in un catalogo (web/lingue/<codice>/<area>.js): il codice chiama
// t('area.chiave', { parametri }) e mai una frase scritta a mano. L'italiano è la lingua di partenza e di riserva: ogni
// chiave c'è sempre in italiano; se una traduzione manca si vede l'italiano (e test/lingue.test.mjs lo segnala).
// La lingua si legge PRIMA di tutto il resto (await in cima al modulo): chi importa lingua.js (ui.js, quindi tutti) trova
// il catalogo pronto. Cambiare lingua = salvarla sul server (per l'utente) e ricaricare la pagina. Regole: docs/LINGUE.md.
//   parametri {nome} · plurali { one, other } (few/many dove servono) scelti con Intl.PluralRules sul parametro n ·
//   t() NON fa l'escape: il testo va negli elementi con h() (textContent), mai in innerHTML.
import { AREE } from './lingue/indice.js';

export const LINGUE = {
  it: { nome: 'Italiano', locale: 'it-IT' },
  en: { nome: 'English', locale: 'en-GB' },
  es: { nome: 'Español', locale: 'es-ES' },
  fr: { nome: 'Français', locale: 'fr-FR' },
  de: { nome: 'Deutsch', locale: 'de-DE' },
  // portoghese del Brasile: per Intl.PluralRules('pt-BR') lo 0 è «one», ma si dice «0 itens» (zeroPlurale)
  pt: { nome: 'Português (Brasil)', locale: 'pt-BR', zeroPlurale: true },
};
export const VALUTE = ['EUR', 'USD', 'GBP', 'CHF', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'CAD', 'AUD', 'JPY', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'MAD', 'INR'];
const CHIAVE = 'kubo.lingua';
const nodo = typeof window === 'undefined';

// La lingua all'avvio, senza window (per le prove): quella dell'utente (sul server), poi l'ultima usata in questo browser
// (serve prima dell'accesso), poi la prima lingua del browser che Kubo conosce, poi l'italiano.
export function iniziale({ utente = null, salvata = null, browser = [] } = {}) {
  for (const c of [utente, salvata]) if (typeof c === 'string' && Object.hasOwn(LINGUE, c)) return c;
  for (const b of browser) { const c = String(b || '').slice(0, 2).toLowerCase(); if (Object.hasOwn(LINGUE, c)) return c; }
  return 'it';
}
// il locale dei formati: quello del browser se è della stessa lingua (en-US → date all'americana), se no quello della lingua
export function localeDi(cod, browser = []) {
  const b = browser.find(x => String(x || '').slice(0, 2).toLowerCase() === cod && String(x).length > 2);
  return b && cod !== 'pt' ? b : LINGUE[cod].locale;
}

let info = { lingua: null, azienda: { lingua: 'it', valuta: 'EUR' } };
if (!nodo) { try { info = await fetch('/api/lingua', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : info)); } catch { } }
const browser = nodo ? [] : [...(navigator.languages || []), navigator.language].filter(Boolean);
let salvata = null; if (!nodo) try { salvata = localStorage.getItem(CHIAVE); } catch { }
export let lingua = nodo ? (LINGUE[globalThis.process?.env?.KUBO_LINGUA] ? globalThis.process.env.KUBO_LINGUA : 'it') : iniziale({ utente: info.lingua, salvata, browser });
export let valuta = VALUTE.includes(info.azienda?.valuta) ? info.azienda.valuta : 'EUR';
export const linguaAzienda = () => info.azienda?.lingua || 'it';
// la valuta da proporre al primo avvio, dal paese del browser (en-US → USD, pt-BR → BRL, de-CH → CHF…); se no l'euro
const VALUTA_PAESE = { US: 'USD', GB: 'GBP', CH: 'CHF', BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', CA: 'CAD', AU: 'AUD', JP: 'JPY', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', TR: 'TRY', MA: 'MAD', IN: 'INR' };
export const valutaProposta = (l = browser) => { for (const x of l) { const v = VALUTA_PAESE[String(x).split('-')[1]?.toUpperCase()]; if (v) return v; } return 'EUR'; };
let loc = localeDi(lingua, browser);
export const locale = () => loc;
if (!nodo) { try { localStorage.setItem(CHIAVE, lingua); } catch { } document.documentElement.lang = lingua; }
// chi entra la prima volta senza una lingua salvata: si salva quella scelta adesso (dal browser o dalla pagina d'accesso)
if (!nodo && info.accesso && !info.lingua) fetch('/api/lingua', { method: 'PUT', credentials: 'same-origin', headers: { 'X-Kubo': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ lingua }) }).catch(() => null);

const CAT = {};
async function carica(cod) {
  const parti = await Promise.all(AREE.map(a => import(`./lingue/${cod}/${a}.js`).then(m => m.default).catch(() => ({}))));
  return Object.assign({}, ...parti);
}
CAT.it = await carica('it');
if (lingua !== 'it') CAT[lingua] = await carica(lingua);

// per le prove: usa un'altra lingua (e un'altra valuta) senza ricaricare
export async function usa(cod, { valuta: v } = {}) {
  if (!Object.hasOwn(LINGUE, cod)) throw new Error('lingua sconosciuta: ' + cod);
  CAT[cod] ||= await carica(cod); lingua = cod; loc = LINGUE[cod].locale; if (v) valuta = v; formati = null;
}
// salva la scelta dell'utente sul server e ricarica: i moduli rileggono i testi
export async function imposta(cod) {
  if (!Object.hasOwn(LINGUE, cod)) return false;
  try { localStorage.setItem(CHIAVE, cod); } catch { }
  await fetch('/api/lingua', { method: 'PUT', credentials: 'same-origin', headers: { 'X-Kubo': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ lingua: cod }) }).catch(() => null);
  location.reload(); return true;
}

function cerca(chiave) {
  const v = CAT[lingua]?.[chiave] ?? CAT.it[chiave];
  if (v == null) { console.warn('testo mancante: ' + chiave); return chiave; }
  return v;
}
const metti = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (x, k) => (k in p ? String(p[k]) : x)) : String(s));
const regole = {};
export function forma(v, n, cod = lingua) {
  if (typeof v !== 'object' || Array.isArray(v)) return v;
  if (n === 0 && 'zero' in v) return v.zero;
  const r = regole[cod] ||= new Intl.PluralRules(LINGUE[cod].locale);
  return v[n === 0 && LINGUE[cod].zeroPlurale ? 'other' : r.select(n)] ?? v.other;
}
// il testo della chiave, con i parametri; se il valore è un plurale sceglie la forma con p.n
export function t(chiave, p) { return metti(forma(cerca(chiave), Number(p?.n ?? 1)), p); }
// un elenco dal catalogo (es. i giorni della settimana): sempre un array
export function elenco(chiave) { const v = cerca(chiave); return Array.isArray(v) ? v : [v]; }
// i nomi delle sezioni dentro una frase: minuscoli («Cerca in clienti…»), salvo in tedesco, dove i nomi restano maiuscoli
export const minuscole = s => (lingua === 'de' ? String(s) : String(s).toLowerCase());
export const esiste = chiave => (CAT[lingua]?.[chiave] ?? CAT.it[chiave]) != null;

// ---------- formati: numeri, valuta dell'azienda, date, primo giorno della settimana ----------
let formati = null;
const F = () => (formati ||= {
  num: new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }),
  val: new Intl.NumberFormat(loc, { style: 'currency', currency: valuta }),
  valCorto: new Intl.NumberFormat(loc, { style: 'currency', currency: valuta, notation: 'compact', maximumFractionDigits: 1 }),
  numCorto: new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 }),
});
export const numero = (x, dec) => (dec == null ? F().num : new Intl.NumberFormat(loc, { maximumFractionDigits: dec })).format(Number(x));
export const soldi = x => F().val.format(Number(x));
export const soldiCorto = x => F().valCorto.format(Number(x));
export const numeroCorto = x => F().numCorto.format(Number(x));
// il simbolo della valuta (€, $, £, CHF, R$…) e il separatore dei decimali della lingua
export const simbolo = () => F().val.formatToParts(0).find(p => p.type === 'currency')?.value || valuta;
export const virgola = () => F().num.formatToParts(1.5).find(p => p.type === 'decimal')?.value || ',';
// legge un numero scritto nel formato della lingua («1.234,5» in italiano, «1,234.5» in inglese); null se non è un numero
export function leggiNumero(s) {
  let x = String(s ?? '').trim().replace(/[\s  ']/g, ''); if (!x) return null;
  const v = virgola(), altro = v === ',' ? '.' : ',';
  // con il separatore dei decimali della lingua, l'altro è delle migliaia; senza, l'altro è dei decimali se è uno solo e
  // non è seguito da tre cifre esatte («12.5» in italiano = 12,5; «1.250» = 1250)
  if (x.includes(v)) x = x.split(altro).join('').replace(v, '.');
  else if (x.split(altro).length === 2 && !new RegExp(`\\${altro}\\d{3}$`).test(x)) x = x.replace(altro, '.');
  else x = x.split(altro).join('');
  const n = Number(x); return Number.isFinite(n) ? n : null;
}
const giornoDi = s => (s instanceof Date ? s : new Date(String(s).length === 10 ? s + 'T00:00:00' : s));
export const data = (s, opz) => giornoDi(s).toLocaleDateString(loc, opz);
// le date e ore si mostrano nel fuso dell'azienda (/api/stato → fuso; lo imposta web/moduli/sicurezza.js), se c'è
export const fusoUi = { fuso: undefined };
export const dataOra = s => { try { return giornoDi(s).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short', timeZone: fusoUi.fuso }); } catch { return giornoDi(s).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' }); } };
// 1 = lunedì … 7 = domenica, come Intl.Locale.getWeekInfo; dove manca (Firefox) una piccola tabella dei paesi
const DOMENICA = ['US', 'CA', 'BR', 'MX', 'JP', 'KR', 'IL', 'PH', 'IN', 'CO', 'PE', 'VE', 'GT', 'HN', 'ZA', 'AR'];
export function primoGiorno(l = loc) {
  try { const i = new Intl.Locale(l), w = i.getWeekInfo?.() ?? i.weekInfo; if (w?.firstDay) return w.firstDay; } catch { }
  return DOMENICA.includes(String(l).split('-')[1]?.toUpperCase()) ? 7 : 1;
}
// i nomi brevi dei giorni nell'ordine della settimana della lingua (Lun… oppure Sun…): [{ nome, dow }] con dow = getDay()
export function giorniSettimana(l = loc) {
  const p = primoGiorno(l) % 7, f = new Intl.DateTimeFormat(l, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => { const dow = (p + i) % 7; return { dow, nome: f.format(new Date(2024, 0, 7 + dow)) }; });
}
// quanti giorni dall'inizio della settimana (0…6) per una data
export const daInizioSettimana = d => (giornoDi(d).getDay() - primoGiorno() % 7 + 7) % 7;
