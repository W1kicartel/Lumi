// Le regole di WhatsApp senza database e senza rete: numeri E.164, finestra di 24 ore, ore di silenzio, parole di stop,
// variabili dei modelli, costi stimati e scelta del modello più adatto. Si provano in Node (test/whatsapp.test.mjs).
// Le regole vengono dalla documentazione di Meta (docs/WHATSAPP.md, «Fonti»).

// la finestra del servizio clienti: 24 ore dall'ultimo messaggio del cliente; dentro si scrive libero, fuori serve un modello
export const FINESTRA = 24 * 36e5;
export const CATEGORIE = ['servizio', 'utility', 'marketing', 'authentication'];
// il consenso che serve per categoria: i messaggi di servizio e i modelli utility/authentication vogliono il consenso
// «servizio», i modelli marketing quello «marketing» (Meta, Business Messaging Policy: opt-in per i messaggi che l'azienda avvia)
export const CONSENSO_DI = { servizio: 'servizio', utility: 'servizio', authentication: 'servizio', marketing: 'marketing' };

// le tariffe stimate per l'Italia, in euro a messaggio consegnato (modello a messaggio dal 1° luglio 2025).
// Meta pubblica il listino per valuta: https://developers.facebook.com/docs/whatsapp/pricing (nessun importo nella pagina);
// importi dell'Italia dal listino EUR riportato da terzi (ottobre 2026, da ricontrollare: docs/WHATSAPP.md, «Costi»).
// Il titolare li cambia dal pannello quando Meta aggiorna il listino.
export const TARIFFE = {
  valuta: 'EUR', marketing: 0.0658, utility: 0.0248, authentication: 0.0248, servizio: 0,
  utilityInFinestraGratis: true,   // Meta: «Utility templates delivered within an open customer service window are free»
  servizioGratisMese: null,        // null = sempre gratis (pagina di Meta); alcuni rivenditori parlano di 1000 gratis al mese da ottobre 2026
  twilio: 0.0043,                  // il sovrapprezzo di Twilio, 0,005 $ a messaggio (twilio.com/whatsapp/pricing), in euro circa
  aggiornate: '2026-10',
};

// ---------- numeri: sempre E.164 («+393331234567») ----------
export function e164(numero, prefisso = '+39') {
  const s = String(numero ?? '').trim().replace(/^whatsapp:/i, ''); if (!s) return null;
  const cifre = s.replace(/\D/g, ''), pref = String(prefisso || '+39').replace(/\D/g, '');
  let n;
  if (s.startsWith('+')) n = cifre;
  else if (cifre.startsWith('00')) n = cifre.slice(2);
  // già con il prefisso del paese, senza «+» (come il wa_id di Meta): 39 + almeno 9 cifre
  else if (pref && cifre.startsWith(pref) && cifre.length >= pref.length + 9) n = cifre;
  else n = pref + cifre;
  return /^[1-9]\d{7,14}$/.test(n) ? `+${n}` : null;
}

// ---------- finestra di 24 ore ----------
export function finestra(ultimoIngresso, ora = Date.now()) {
  const t = ultimoIngresso ? Date.parse(ultimoIngresso) : NaN;
  if (!Number.isFinite(t)) return { aperta: false, scade: null };
  const scade = t + FINESTRA;
  return { aperta: ora < scade, scade: new Date(scade).toISOString() };
}

// ---------- ore di silenzio (es. 21:00–09:00, anche a cavallo della mezzanotte) nel fuso dell'azienda ----------
const minuti = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export function minutiLocali(ora, fuso = 'Europe/Rome') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ora)).map(x => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}
export function inSilenzio(ora, silenzio, fuso) {
  const da = minuti(silenzio?.da), a = minuti(silenzio?.a); if (da == null || a == null || da === a) return false;
  const m = minutiLocali(ora, fuso);
  return da < a ? m >= da && m < a : m >= da || m < a;
}
// quando finisce il silenzio (l'istante, al minuto): per rimandare un invio automatico invece di perderlo
export function fineSilenzio(ora, silenzio, fuso) {
  if (!inSilenzio(ora, silenzio, fuso)) return ora;
  const m = minutiLocali(ora, fuso), a = minuti(silenzio.a);
  return ora - (ora % 6e4) + (((a - m) + 1440) % 1440 || 1440) * 6e4;
}
// aperti adesso? orari { apre: '09:00', chiude: '19:00', giorni: [1..6] } (0 = domenica)
export function aperto(ora, orari, fuso = 'Europe/Rome') {
  const g = new Date(new Date(ora).toLocaleString('en-US', { timeZone: fuso })).getDay();
  if (orari?.giorni && !orari.giorni.includes(g)) return false;
  const m = minutiLocali(ora, fuso), da = minuti(orari?.apre), a = minuti(orari?.chiude);
  return da == null || a == null ? true : m >= da && m < a;
}

// ---------- parole di stop e di ripresa: il cliente le scrive e Kubo smette (o riprende) per tutti gli invii ----------
export const PAROLE_STOP = ['STOP', 'BASTA', 'ANNULLA', 'CANCELLAMI', 'DISISCRIVIMI', 'DISISCRIVI', 'NON SCRIVERMI', 'UNSUBSCRIBE', 'STOPP', 'ALTO', 'ARRET', 'ARRÊT', 'PARAR', 'SAIR'];
export const PAROLE_RIPRESA = ['START', 'RIPRENDI', 'ISCRIVIMI', 'UNSTOP'];
const pulita = s => String(s || '').normalize('NFC').toUpperCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
export function parolaChiave(testo) {
  const t = pulita(testo); if (!t || t.length > 40) return null;
  if (PAROLE_STOP.some(p => t === p || t.startsWith(p + ' '))) return 'stop';
  if (PAROLE_RIPRESA.includes(t)) return 'ripresa';
  return null;
}

// ---------- modelli: variabili {{1}}…, valori presi dalla scheda ----------
export const variabiliDi = corpo => [...new Set([...String(corpo || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
export const riempi = (corpo, valori = []) => String(corpo || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (x, n) => (valori[Number(n) - 1] ?? x));
// un valore per una variabile: «cliente.nome», «riga.quando», «azienda.nome», «ricetta.link», «fisso:testo libero»
export function valoreDa(percorso, contesto, opz = {}) {
  // «riga.tracking|fisso:Ti aspettiamo!»: la prima alternativa che ha un valore
  if (String(percorso || '').includes('|')) { for (const x of String(percorso).split('|')) { const v = valoreDa(x, contesto, opz); if (v != null && v !== '') return v; } return null; }
  const { lingua = 'it', fuso = 'Europe/Rome' } = opz, p = String(percorso || '');
  if (p.startsWith('fisso:')) return p.slice(6);
  const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), contesto);
  if (v == null || v === '') return null;
  if (typeof v === 'object') return v.titolo ?? v.nome ?? v._ ?? null;
  if (typeof v === 'number') return new Intl.NumberFormat(lingua, { maximumFractionDigits: 2 }).format(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return new Intl.DateTimeFormat(lingua, { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Intl.DateTimeFormat(lingua, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v + 'T00:00:00Z'));
  return String(v);
}
// i valori di tutte le variabili di un modello: { valori: [...], mancano: [n…] }
export function valoriModello(modello, mappa, contesto, opz) {
  const valori = [], mancano = [];
  for (const n of variabiliDi(modello.corpo)) { const v = mappa?.[n] ? valoreDa(mappa[n], contesto, opz) : null; valori[n - 1] = v ?? ''; if (v == null) mancano.push(n); }
  return { valori, mancano };
}

// ---------- costi stimati ----------
// categoria: 'servizio' | 'utility' | 'marketing' | 'authentication'; inFinestra: la finestra era aperta all'invio
export function costo(categoria, { tariffe = TARIFFE, inFinestra = false, provider = 'whatsapp', servizioGiaNelMese = 0 } = {}) {
  const t = { ...TARIFFE, ...(tariffe || {}) };
  let c = categoria === 'marketing' ? t.marketing : categoria === 'utility' ? (inFinestra && t.utilityInFinestraGratis ? 0 : t.utility)
    : categoria === 'authentication' ? t.authentication : (t.servizioGratisMese == null || servizioGiaNelMese < t.servizioGratisMese ? 0 : t.servizio);
  if (provider === 'twilio-whatsapp') c += Number(t.twilio || 0);
  return Math.round(Number(c || 0) * 1e5) / 1e5;
}

// ---------- il modello approvato più adatto a una frase («l'ordine è pronto» → ordine_pronto) ----------
const radici = s => new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\{\{\d+\}\}/g, ' ')
  .split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(w => w.slice(0, 5)));
export function scegliModello(frase, modelli, { categoria = null } = {}) {
  const f = radici(frase); let meglio = null, punti = 0;
  for (const m of modelli || []) {
    if (m.stato !== 'approvato' || (categoria && m.categoria !== categoria)) continue;
    const r = radici(`${String(m.nome).replace(/_/g, ' ')} ${m.corpo}`); let p = 0;
    for (const w of f) if (r.has(w)) p += 1;
    if (String(m.nome).replace(/_/g, ' ').split(' ').some(w => w.length >= 4 && f.has(w.slice(0, 5)))) p += 1.5;   // il nome conta di più
    if (p > punti) { punti = p; meglio = m; }
  }
  return meglio;
}
