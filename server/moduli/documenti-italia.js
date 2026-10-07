// I controlli dei dati fiscali italiani: partita IVA (cifra di controllo), codice fiscale delle persone (carattere di
// controllo, omocodia compresa) e delle società (11 cifre, come la partita IVA), IBAN (modulo 97). Ogni validatore
// riceve il testo e restituisce { valore } normalizzato (maiuscole, senza spazi) oppure { errore }. Si registrano nel
// motore (D.validatore): un campo testo con «valida»: "piva" | "codice_fiscale" | "iban" viene controllato a ogni salvataggio.
import * as D from '../dati.js';

const pulisci = s => String(s ?? '').replace(/[\s.-]/g, '').toUpperCase();

export function pivaValida(s) {
  let v = pulisci(s); if (v.startsWith('IT')) v = v.slice(2);
  if (!/^\d{11}$/.test(v)) return { errore: 'la partita IVA ha 11 cifre' };
  if (/^0{11}$/.test(v)) return { errore: 'partita IVA non valida' };
  let somma = 0;
  for (let i = 0; i < 10; i++) { let n = Number(v[i]); if (i % 2) { n *= 2; if (n > 9) n -= 9; } somma += n; }
  return (10 - somma % 10) % 10 === Number(v[10]) ? { valore: v } : { errore: 'la partita IVA non torna (cifra di controllo sbagliata)' };
}

// carattere di controllo del codice fiscale: posizioni dispari (1ª, 3ª…) con la tabella, pari con il valore semplice
const DISPARI = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
const valoreCar = c => (c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 65);
const CF_PERSONA = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
export function cfValido(s) {
  const v = pulisci(s);
  if (/^\d{11}$/.test(v)) return pivaValida(v).errore ? { errore: 'il codice fiscale numerico (società) non torna' } : { valore: v };
  if (v.length !== 16) return { errore: 'il codice fiscale ha 16 caratteri (11 cifre per le società)' };
  if (!CF_PERSONA.test(v)) return { errore: 'codice fiscale scritto male' };
  let somma = 0;
  for (let i = 0; i < 15; i++) somma += i % 2 ? valoreCar(v[i]) : DISPARI[valoreCar(v[i])];
  return String.fromCharCode(65 + somma % 26) === v[15] ? { valore: v } : { errore: 'il codice fiscale non torna (ultima lettera sbagliata)' };
}

const LUNGHEZZE_IBAN = { IT: 27, SM: 27, DE: 22, FR: 27, ES: 24, AT: 20, CH: 21, BE: 16, NL: 18, PT: 25, IE: 22, LU: 20, GB: 22, MC: 27, SI: 19, HR: 21, GR: 27, PL: 28 };
export function ibanValido(s) {
  const v = pulisci(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return { errore: 'IBAN scritto male' };
  if (LUNGHEZZE_IBAN[v.slice(0, 2)] && v.length !== LUNGHEZZE_IBAN[v.slice(0, 2)]) return { errore: `un IBAN ${v.slice(0, 2)} ha ${LUNGHEZZE_IBAN[v.slice(0, 2)]} caratteri` };
  let resto = 0;
  for (const c of v.slice(4) + v.slice(0, 4)) { const n = c >= 'A' ? String(c.charCodeAt(0) - 55) : c; for (const d of n) resto = (resto * 10 + Number(d)) % 97; }
  return resto === 1 ? { valore: v } : { errore: 'l\'IBAN non torna (cifre di controllo sbagliate)' };
}

export const VALIDATORI = { piva: pivaValida, codice_fiscale: cfValido, iban: ibanValido };
for (const [nome, f] of Object.entries(VALIDATORI)) D.validatore(nome, f);
