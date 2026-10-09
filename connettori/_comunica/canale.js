// Un canale di squadra a indirizzo segreto (Slack, Microsoft Teams, Discord, Mattermost…): gli avvisi degli eventi
// scelti e l'azione «scrivi nel canale» per Lumi. L'indirizzo del webhook È la chiave: si custodisce come segreto.
import { impostazioniAvvisi, testiAvvisi, uscitaAvvisi, segnaAcceso, lingua, impRiepilogo, testiRiepilogo, giroRiepilogo } from './notifiche.js';

const PROVA = { it: 'Lumi è collegato a questo canale.', en: 'Lumi is connected to this channel.', es: 'Lumi está conectado a este canal.', fr: 'Lumi est connecté à ce canal.', de: 'Lumi ist mit diesem Kanal verbunden.', pt: 'O Lumi está ligado a este canal.' };
const AZ = {
  en: { 'imp.url': 'Webhook address', 'az.scrivi': 'Write in the channel' }, es: { 'imp.url': 'Dirección del webhook', 'az.scrivi': 'Escribir en el canal' },
  fr: { 'imp.url': 'Adresse du webhook', 'az.scrivi': 'Écrire dans le canal' }, de: { 'imp.url': 'Webhook-Adresse', 'az.scrivi': 'In den Kanal schreiben' }, pt: { 'imp.url': 'Endereço do webhook', 'az.scrivi': 'Escrever no canal' },
};

// def: { id, nome, descrizione, corpo: testo => json, ok: risposta => bool, catalogo, testi: { en: { nome, descrizione, … } } }
// oppure, per un servizio che non è un webhook a indirizzo segreto: { impostazioni, scrivi: async (k, testo) => … }
export function canale(def) {
  async function scrivi(k, testo) {
    if (def.scrivi) return def.scrivi(k, String(testo).slice(0, 3500));
    const r = await k.http.post(k.segreti.url, { json: def.corpo(String(testo).slice(0, 3500)) });
    if (!(def.ok ? def.ok(r) : r.ok)) throw new Error(`${def.nome} ha risposto ${r.stato}${r.testo ? `: ${r.testo.slice(0, 120)}` : ''}`);
    return { inviato: true };
  }
  return {
    id: def.id, nome: def.nome, versione: 1, icona: 'messaggio', descrizione: def.descrizione,
    impostazioni: [...(def.impostazioni || [{ id: 'url', nome: 'Indirizzo del webhook', segreto: true, tipo: 'url' }]), ...impostazioniAvvisi(), impRiepilogo],
    permessi: { clienti: { leggi: true }, vendite: { leggi: true }, appuntamenti: { leggi: true }, prenotazioni: { leggi: true }, articoli: { leggi: true }, fatture: { leggi: true } },
    attiva: async k => segnaAcceso(k),
    prova: async k => { await scrivi(k, PROVA[lingua(k)] || PROVA.it); return { ok: true }; },
    uscita: uscitaAvvisi(scrivi),
    pianificati: { riepilogo: giroRiepilogo(scrivi) },
    azioni: { scrivi: {
      nome: 'Scrivi nel canale', descrizione: `Scrive un messaggio nel canale ${def.nome} della squadra`, lumi: true, scrive: true,
      input: { testo: { tipo: 'testo', nome: 'Il messaggio' } },
      proponi: async ({ testo }) => ({ titolo: `Messaggio su ${def.nome}`, righe: [['Testo', testo]], avvisi: String(testo || '').trim() ? [] : ['Il messaggio è vuoto'] }),
      esegui: async ({ testo }, k) => { if (!String(testo || '').trim()) throw new Error('Il messaggio è vuoto'); return scrivi(k, testo); },
    } },
    catalogo: def.catalogo,
    testi: Object.fromEntries(['en', 'es', 'fr', 'de', 'pt'].map(l => [l, { ...AZ[l], ...testiAvvisi(l), ...testiRiepilogo(l), ...(def.testi[l] || {}) }])),
  };
}
