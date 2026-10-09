// Il motore dell'assistente viene dal progetto Lumi per le aziende (MIT, © W1kicartel). Adattamento per il gestionale: «testi» sostituisce alcune frasi
// dell'interfaccia (per esempio quelle della modalità senza chiave), «strumenti» può essere una funzione.
// Lumi: l'assistente AI che vive in una pillola in cima allo schermo, per il gestionale, il CRM o il sito della tua
// azienda. Un modulo ES, niente build, niente dipendenze:
//
//   import { Lumi } from './lumi/lumi.js';
//   const lumi = Lumi.avvia({
//     nome: 'Bottega Aurora',                       // l'azienda: Lumi lo usa per presentarsi e nel prompt
//     server: 'https://…/functions/v1/lumi',        // il server di Lumi (Supabase o Node); null = demo senza AI
//     strumenti: [
//       { nome: 'cerca_clienti', descrizione: '…', schema: { type: 'object', … }, leggi: async args => risultato },
//       { nome: 'nuovo_ordine', descrizione: '…', schema: {…}, proponi: async args => ({ titolo, righe }), esegui: async args => esito },
//     ],
//     daVedere: async () => [{ testo, nota, livello: 'urgente' | 'attenzione' | 'info', numero, apri }],
//     azioni: [{ testo: 'Nuovo cliente', icona: 'cliente', fai: () => … }],
//     contesto: async () => 'Oggi 3 ordini da spedire, negozio aperto 9-19.',
//     privacy: { inNegozio: true },
//   });
//
// Tutte le opzioni sono documentate in docs/API.md. Lumi.avvia restituisce un oggetto con apri, chiudi, chiedi,
// conferma, annulla, interrompi, ricomincia, aggiorna, schermoCondiviso, voceAlta, stato e distruggi.
import { montaInterfaccia } from './interfaccia.js';
import { traduttore, scegliLingua } from './lingua.js';

let istanza = null;

function normalizza(o = {}) {
  if (o.server != null && typeof o.server !== 'string') throw new TypeError('Lumi: «server» must be a URL string or null');
  for (const k of ['daVedere', 'contesto', 'locale']) if (o[k] != null && typeof o[k] !== 'function' && !(k === 'contesto' && typeof o[k] === 'string')) throw new TypeError(`Lumi: «${k}» must be a function`);
  if (o.azioni != null && !Array.isArray(o.azioni)) throw new TypeError('Lumi: «azioni» must be an array');
  const lingua = scegliLingua(o.lingua);
  return {
    ...o,
    nome: String(o.nome || ''),
    nomeAssistente: String(o.nomeAssistente || 'Lumi'),
    server: o.server || null,
    lingua,
    t: conTesti(traduttore(lingua), o.testi),
    strumenti: o.strumenti || [],
    privacy: o.privacy || {},
  };
}

// alcune frasi dell'host al posto di quelle di Lumi: { 'avviso.collega': '…' } (con {segnaposto} come le altre)
function conTesti(base, testi) {
  if (!testi || typeof testi !== 'object') return base;
  const t = (k, p) => (typeof testi[k] === 'string' ? testi[k].replace(/\{(\w+)\}/g, (x, c) => (p && c in p ? String(p[c]) : x)) : base(k, p));
  return Object.assign(t, { lingua: base.lingua, locale: base.locale, voce: base.voce });
}

function caricaStile(o) {
  if (o.css === false || document.querySelector('link[data-lumi]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = typeof o.css === 'string' ? o.css : new URL('./lumi.css', import.meta.url).href; l.dataset.lumi = '';
  document.head.append(l);
}

// un'istanza che non fa niente, con la stessa forma di quella vera
function finta() {
  const niente = () => {};
  return { apri: niente, chiudi: niente, chiedi: async () => {}, conferma: niente, annulla: niente, interrompi: niente, ricomincia: niente, aggiorna: async () => {},
    schermoCondiviso: () => false, voceAlta: () => false, get stato() { return null; }, distruggi: niente };
}

export const Lumi = {
  avvia(opzioni) {
    if (istanza) istanza.distruggi();
    const op = normalizza(opzioni);
    // nella finestra del gestionale della shell desktop la pillola c'è già, sempre in primo piano: qui non si monta
    if (window.lumiDesktop?.senzaPillola) return finta();
    caricaStile(op);
    // nella shell desktop la finestra della pillola mostra solo Lumi: il resto della pagina resta vivo ma nascosto
    if (window.lumiDesktop?.solo) document.documentElement.dataset.lumiSolo = '1';
    istanza = montaInterfaccia(op, op.t);
    const via = istanza.distruggi;
    istanza.distruggi = () => { via(); istanza = null; };
    return istanza;
  },
  get attivo() { return istanza; },
};
export default Lumi;
