// Gli strumenti di Lumi che arrivano dai moduli (il contratto deciso per tutte le squadre). Ogni modulo, nel suo registra(k):
//   k.lumi?.strumento({ nome, descrizione, schema, tipo: 'leggi' | 'scrivi', permesso: ctx => bool,
//                       esegui: async ({ ctx, args }) => risultato,
//                       anteprima: async ({ ctx, args, lingua }) => ({ titolo, righe: [[etichetta, valore]…], avvisi: [] }) })
//   k.lumi?.istruzioni(testo)          righe in più per il modello (quando usare gli strumenti del modulo)
//   k.lumi?.scheda(entita, f)          righe e avvisi in più nella scheda di conferma dei crea_/modifica_ generati dallo schema:
//                                      f({ ctx, valori, id, lingua }) (id: la riga che si modifica) → { righe?, avvisi?, errore? }
//   k.lumi?.sostituisce(...nomi)       strumenti generati dallo schema da non offrire più al modello (ci pensa il modulo)
// I 'leggi' rispondono subito; gli 'scrivi' passano dall'anteprima (la scheda Conferma / Annulla) e solo dopo il Conferma
// dalla esegui: il server lo garantisce con un gettone che lega l'esecuzione all'anteprima degli stessi argomenti.
// Il registro nasce in api.js prima dei moduli (così chi si carica prima di lumi.js registra lo stesso); le rotte sono in
// ../lumi-strumenti.js. Nessun DOM e nessuna rete: si prova in Node.
import { randomBytes, createHash } from 'node:crypto';

const NOME = /^[a-zA-Z0-9_-]{1,64}$/;
const DURATA_GETTONE = 15 * 6e4;   // una scheda di conferma lasciata lì per più di un quarto d'ora si rifà

export function registroLumi() {
  const strumenti = new Map(), istruzioni = [], schede = new Map(), sostituiti = new Set(), gettoni = new Map();
  const impronta = (utente, nome, args) => createHash('sha256').update(`${utente}\n${nome}\n${JSON.stringify(args ?? {})}`).digest('hex');
  return {
    strumento(s) {
      if (!s || !NOME.test(s.nome || '')) throw new TypeError(`Lumi: nome di strumento non valido «${s?.nome}»`);
      if (!['leggi', 'scrivi'].includes(s.tipo)) throw new TypeError(`Lumi: «${s.nome}» vuole tipo 'leggi' o 'scrivi'`);
      if (typeof s.esegui !== 'function') throw new TypeError(`Lumi: «${s.nome}» non ha esegui()`);
      if (s.tipo === 'scrivi' && typeof s.anteprima !== 'function') throw new TypeError(`Lumi: «${s.nome}» scrive: serve anteprima() per la scheda di conferma`);
      const schema = s.schema || { type: 'object', properties: {} };
      if (schema.type !== 'object') throw new TypeError(`Lumi: lo schema di «${s.nome}» deve essere un oggetto`);
      strumenti.set(s.nome, { ...s, schema, descrizione: String(s.descrizione || '').slice(0, 2000) });
    },
    istruzioni(testo) { if (testo) istruzioni.push(String(testo).slice(0, 4000)); },
    scheda(entita, f) { if (typeof f === 'function') (schede.get(entita) || schede.set(entita, []).get(entita)).push(f); },
    sostituisce(...nomi) { for (const n of nomi.flat()) sostituiti.add(String(n)); },
    // quello che vede chi è collegato: gli strumenti con il permesso (un permesso che si rompe vale «no»)
    visibili(ctx) {
      return [...strumenti.values()].filter(s => { try { return !s.permesso || !!s.permesso(ctx); } catch { return false; } });
    },
    prendi: nome => strumenti.get(nome),
    tutte: () => ({ istruzioni: [...istruzioni], sostituiti: [...sostituiti] }),
    schedeDi: entita => schede.get(entita) || [],
    // il gettone: nasce con l'anteprima, vale per la stessa persona, lo stesso strumento e gli stessi argomenti, una volta sola
    gettone(utente, nome, args) {
      const g = randomBytes(18).toString('base64url'), ora = Date.now();
      for (const [k, v] of gettoni) if (ora - v.quando > DURATA_GETTONE) gettoni.delete(k);
      if (gettoni.size > 5000) gettoni.clear();
      gettoni.set(g, { impronta: impronta(utente, nome, args), quando: ora });
      return g;
    },
    usaGettone(utente, nome, args, g) {
      const v = gettoni.get(String(g || '')); if (!v) return false;
      gettoni.delete(String(g));
      return v.impronta === impronta(utente, nome, args) && Date.now() - v.quando <= DURATA_GETTONE;
    },
  };
}

// un controllo leggero degli argomenti contro lo schema JSON (tipi, obbligatori, enum, limiti): il modello sbaglia, e un
// messaggio chiaro gli fa correggere la chiamata al giro dopo. Restituisce il primo problema o null.
export function controllaArgomenti(v, s, dove = 'args') {
  if (!s || typeof s !== 'object') return null;
  const tipo = x => (Array.isArray(x) ? 'array' : x === null ? 'null' : Number.isInteger(x) ? 'integer' : typeof x);
  if (s.enum && !s.enum.some(x => JSON.stringify(x) === JSON.stringify(v))) return `${dove}: valore «${v}» non ammesso (${s.enum.join(', ')})`;
  if (s.type) {
    const t = tipo(v), ok = [].concat(s.type).some(x => x === t || (x === 'number' && t === 'integer'));
    if (!ok) return `${dove}: serve ${[].concat(s.type).join(' o ')}, non ${t}`;
  }
  if (typeof v === 'string' && s.maxLength && v.length > s.maxLength) return `${dove}: al massimo ${s.maxLength} caratteri`;
  if (typeof v === 'number' && ((s.minimum != null && v < s.minimum) || (s.maximum != null && v > s.maximum))) return `${dove}: fuori dai limiti`;
  if (Array.isArray(v)) {
    if (s.maxItems != null && v.length > s.maxItems) return `${dove}: al massimo ${s.maxItems} elementi`;
    if (s.minItems != null && v.length < s.minItems) return `${dove}: almeno ${s.minItems} elementi`;
    for (let i = 0; i < v.length; i++) { const e = controllaArgomenti(v[i], s.items, `${dove}[${i}]`); if (e) return e; }
  }
  if (v && tipo(v) === 'object') {
    for (const k of s.required || []) if (v[k] == null || v[k] === '') return `${dove}.${k}: obbligatorio`;
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) { const e = controllaArgomenti(x, s.properties[k], `${dove}.${k}`); if (e) return e; }
      else if (s.additionalProperties === false) return `${dove}.${k}: campo sconosciuto`;
    }
  }
  return null;
}
