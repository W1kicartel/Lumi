// Schermo condiviso: in negozio, allo sportello, in reception, lo schermo lo vedono anche i clienti. In questa modalità
// quello che Lumi dice a voce e quello che compare nella pillola non contiene mai nomi di persone, importi, telefoni,
// email né indirizzi IBAN: si sostituiscono con parole neutre PRIMA di parlare o di scrivere nella pillola.
// I nomi da nascondere vengono da due parti: quelli che l'host dichiara (privacy.nomi) e quelli che passano nei risultati
// degli strumenti di lettura, sotto campi che di solito contengono un nome (nome, cognome, cliente, contatto…).
// Nessuna dipendenza e niente DOM: le prove lo usano in node.

const CAMPI_NOME = /^(nome|cognome|nominativo|cliente|contatto|referente|persona|intestatario|ragione_?sociale|name|first_?name|last_?name|full_?name|customer|contact|client|person|company)$/i;
const PAROLE_COMUNI = new Set(['della', 'delle', 'degli', 'dello', 'srl', 'spa', 'snc', 'sas', 'the', 'and', 'ltd', 'inc', 'llc']);

// raccoglie i nomi dai dati (anche annidati): stringhe sotto campi «da nome», intere e parola per parola
export function raccogliNomi(dati, insieme = new Set(), profondita = 0) {
  if (dati == null || profondita > 6) return insieme;
  if (Array.isArray(dati)) { for (const x of dati.slice(0, 500)) raccogliNomi(x, insieme, profondita + 1); return insieme; }
  if (typeof dati !== 'object') return insieme;
  for (const [k, v] of Object.entries(dati)) {
    if (typeof v === 'string' && CAMPI_NOME.test(k)) aggiungiNome(insieme, v);
    else if (v && typeof v === 'object') raccogliNomi(v, insieme, profondita + 1);
  }
  return insieme;
}
export function aggiungiNome(insieme, nome) {
  const s = String(nome || '').trim();
  if (s.length < 2 || s.length > 80) return insieme;
  insieme.add(s);
  for (const p of s.split(/[\s,.'’-]+/)) if (p.length >= 3 && !PAROLE_COMUNI.has(p.toLowerCase())) insieme.add(p);
  return insieme;
}

const sfuggi = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEUTRO = {
  it: { nome: 'una persona', importo: 'un importo', telefono: 'un numero', email: 'un indirizzo', iban: 'un conto' },
  en: { nome: 'someone', importo: 'an amount', telefono: 'a number', email: 'an address', iban: 'an account' },
};
// importi: simbolo o sigla della valuta prima o dopo una cifra (anche 1.250,50 o 1,250.50), e «12 euro»
const VALUTA = '(?:€|\\$|£|EUR|USD|GBP|CHF|euro|dollari|dollars?|sterline|pounds?)';
const NUMERO = '\\d{1,3}(?:[.,\\s\']\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
const IMPORTO = new RegExp(`(?:${VALUTA}\\s?(?:${NUMERO}))|(?:(?:${NUMERO})\\s?(?:k|mila|mln)?\\s?${VALUTA}(?![A-Za-z]))`, 'gi');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g;
// telefoni: almeno 8 cifre, con prefisso internazionale facoltativo e separatori (spazi, punti, trattini, parentesi)
const TELEFONO = /(?:\+|00)?\d[\d\s().-]{6,}\d/g;

// toglie da un testo nomi, importi, telefoni, email e IBAN. Il grassetto (**…**) resta grassetto.
export function oscura(testo, { nomi = [], lingua = 'it' } = {}) {
  const N = NEUTRO[lingua] || NEUTRO.it;
  let s = String(testo ?? '');
  s = s.replace(EMAIL, N.email).replace(IBAN, N.iban).replace(IMPORTO, N.importo);
  // una data scritta in cifre (2026-10-07, 07.10.2026) non è un telefono
  s = s.replace(TELEFONO, m => (m.replace(/\D/g, '').length >= 8 && !/^\s*(\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}[-.]\d{1,2}[-.]\d{4})\s*$/.test(m) ? N.telefono : m));
  // i nomi più lunghi prima: «Marta Ferri» diventa una persona sola, non «una persona una persona»
  const elenco = [...new Set([...nomi].map(String).filter(n => n.trim().length >= 2))].sort((a, b) => b.length - a.length);
  if (elenco.length) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${elenco.map(sfuggi).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    s = s.replace(re, N.nome);
    // due o più «una persona» di fila (nome e cognome separati) diventano uno
    const r = new RegExp(`${sfuggi(N.nome)}(?:\\s+${sfuggi(N.nome)})+`, 'g'); s = s.replace(r, N.nome);
  }
  return s;
}
