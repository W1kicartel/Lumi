// Google Ads, moduli per i lead: chi compila il modulo di un'inserzione (Ricerca, YouTube, Discovery, Performance Max)
// diventa un cliente, con la campagna e le altre risposte nelle note; niente doppioni per email o telefono.
// Il webhook manda JSON con «google_key», la chiave scelta dal titolare (qui la genera Kubo): si confronta a tempo
// costante prima di leggere il resto. lead_id per non importare due volte; is_test per il lead di prova di Google.
import { timingSafeEqual } from 'node:crypto';
import { REQ, PERMESSI, richiesta } from '../_comunica/moduli.js';
import { webhookDi } from '../_comunica/agenda.js';

const TIPI = { FULL_NAME: 'nome', FIRST_NAME: 'nome_proprio', LAST_NAME: 'cognome', EMAIL: 'email', WORK_EMAIL: 'email', PHONE_NUMBER: 'telefono', WORK_PHONE: 'telefono' };
const NOMI = { POSTAL_CODE: 'CAP', STREET_ADDRESS: 'Indirizzo', CITY: 'Città', REGION: 'Regione', COUNTRY: 'Paese', COMPANY_NAME: 'Azienda', JOB_TITLE: 'Ruolo' };
export function chiaveGiusta(grezzo, chiave) {
  if (!chiave) return false;
  let g; try { g = JSON.parse(Buffer.from(grezzo || '').toString('utf8'))?.google_key; } catch { return false; }
  const a = Buffer.from(String(g ?? '')), b = Buffer.from(String(chiave));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const risposteGoogle = colonne => (colonne || []).filter(c => c.column_id !== 'PHONE_NUMBER_VERIFIED')
  .map(c => ({ titolo: c.column_name || NOMI[c.column_id] || String(c.column_id || '').toLowerCase().replace(/_/g, ' '), tipo: TIPI[c.column_id] || 'testo', valore: c.string_value }));

export default {
  id: 'google-ads-lead', nome: 'Google Ads (moduli per i lead)', versione: 1, icona: 'persona',
  descrizione: 'Chi compila i moduli per i lead delle inserzioni Google diventa un cliente.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave del webhook (da incollare su Google Ads)', segreto: true, generato: true },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (es. https://kubo.studiorossi.it)', tipo: 'url', obbligatorio: false },
    { id: 'prova', nome: 'Importa anche i lead di prova', tipo: 'si_no', predefinito: false },
  ],
  richiede: { clienti: REQ.clienti }, permessi: { clienti: PERMESSI.clienti },
  entrata: {
    firma: { tipo: 'google', segreto: 'chiave', verifica: ({ grezzo, segreto }) => chiaveGiusta(grezzo, segreto) },
    idempotenza: ev => (ev?.lead_id ? `${ev.is_test ? 'prova:' : ''}${ev.lead_id}` : null),
    async gestisci(ev, k) {
      if (!ev?.lead_id || !Array.isArray(ev.user_column_data)) return 'ignorato: non è un lead';
      if (ev.is_test && !k.imp.prova) { k.avvisa('Lead di prova di Google Ads ricevuto: il collegamento funziona'); return 'ignorato: lead di prova'; }
      const dove = [ev.campaign_id && `campagna ${ev.campaign_id}`, ev.adgroup_id && `gruppo ${ev.adgroup_id}`, ev.gcl_id && `GCLID ${ev.gcl_id}`].filter(Boolean).join(' · ');
      const risposte = [...risposteGoogle(ev.user_column_data), ...(dove ? [{ titolo: 'Google Ads', tipo: 'testo', valore: dove }] : [])];
      return richiesta(k, { remoto: ev.lead_id, fonte: 'google-ads', intestazione: `Google Ads${ev.is_test ? ' (prova)' : ''}`, modulo: ev.form_id ? String(ev.form_id) : null, risposte, provenienza: 'altro' });
    },
  },
  azioni: {
    indirizzo_webhook: {
      nome: 'Dati da dare a Google Ads', descrizione: 'L\'URL del webhook e la chiave da incollare nel modulo per i lead',
      async esegui(a, k) { return { indirizzo: webhookDi(k, 'google-ads-lead'), chiave: k.segreti.chiave }; },
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://ads.google.com', costo: 'a-consumo',
    costoNota: 'Il webhook è gratuito: si pagano solo i clic o le conversioni delle inserzioni, con il budget giornaliero scelto nella campagna (nessun minimo fisso).',
    serve: [
      { cosa: 'Un modulo per i lead collegato a una campagna, con l\'URL del webhook e la chiave generata da Kubo', dove: 'Google Ads → Campagne → Asset → + → Modulo per i lead → Opzioni di consegna dei lead → Integrazione webhook', link: 'https://support.google.com/google-ads/answer/9423234' },
      { cosa: 'Un indirizzo pubblico di Kubo con HTTPS raggiungibile da Internet', dove: 'Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel)', link: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/' },
    ],
    passi: ['Accendi il connettore: Kubo crea la chiave del webhook.', 'Scrivi l\'indirizzo pubblico di Kubo (con https) e premi «Dati da dare a Google Ads».', 'Su Google Ads apri il modulo per i lead → Opzioni di consegna dei lead → Integrazione webhook.', 'Incolla l\'URL del webhook e la chiave, poi premi «Invia dati di prova»: Kubo avvisa che il collegamento funziona.', 'Salva il modulo: i lead veri diventano clienti, con la campagna nelle note.'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.google.com/google-ads/webhook/docs/overview', 'https://developers.google.com/google-ads/webhook/docs/implementation', 'https://support.google.com/google-ads/answer/9423234'],
    prova: 'finto', parole: ['google ads', 'adwords', 'lead form', 'moduli per i lead', 'lead', 'contatti', 'inserzioni', 'ads', 'campagne', 'youtube'],
  },
  testi: {
    en: { nome: 'Google Ads (lead forms)', descrizione: 'People who fill in the lead forms of Google ads become customers.', 'imp.chiave': 'Webhook key (to paste into Google Ads)', 'imp.indirizzo': 'Public address of Kubo (e.g. https://kubo.mystudio.com)', 'imp.prova': 'Import test leads too', 'az.indirizzo_webhook': 'Data to give Google Ads',
      'cat.costoNota': 'The webhook is free: you only pay for the clicks or conversions of the ads, with the daily budget set in the campaign (no fixed minimum).',
      'cat.serve': [{ cosa: 'A lead form linked to a campaign, with the webhook URL and the key generated by Kubo', dove: 'Google Ads → Campaigns → Assets → + → Lead form → Lead delivery options → Webhook integration' }, { cosa: 'A public HTTPS address for Kubo reachable from the Internet', dove: 'Your domain with HTTPS, or a tunnel (Cloudflare Tunnel)' }],
      'cat.passi': ['Turn the connector on: Kubo creates the webhook key.', 'Enter Kubo\'s public address (with https) and press «Data to give Google Ads».', 'In Google Ads open the lead form → Lead delivery options → Webhook integration.', 'Paste the webhook URL and the key, then press «Send test data»: Kubo reports that the link works.', 'Save the form: real leads become customers, with the campaign in the notes.'] },
    es: { nome: 'Google Ads (formularios de clientes potenciales)', descrizione: 'Quien rellena los formularios de los anuncios de Google se convierte en cliente.', 'imp.chiave': 'Clave del webhook (para pegar en Google Ads)', 'imp.indirizzo': 'Dirección pública de Kubo (p. ej. https://kubo.miestudio.es)', 'imp.prova': 'Importar también los leads de prueba', 'az.indirizzo_webhook': 'Datos para Google Ads' },
    fr: { nome: 'Google Ads (formulaires pour prospects)', descrizione: 'Les personnes qui remplissent les formulaires des annonces Google deviennent clients.', 'imp.chiave': 'Clé du webhook (à coller dans Google Ads)', 'imp.indirizzo': 'Adresse publique de Kubo (ex. https://kubo.moncabinet.fr)', 'imp.prova': 'Importer aussi les prospects de test', 'az.indirizzo_webhook': 'Données à donner à Google Ads' },
    de: { nome: 'Google Ads (Lead-Formulare)', descrizione: 'Wer die Lead-Formulare der Google-Anzeigen ausfüllt, wird Kunde.', 'imp.chiave': 'Webhook-Schlüssel (in Google Ads einfügen)', 'imp.indirizzo': 'Öffentliche Adresse von Kubo (z. B. https://kubo.meinestudio.de)', 'imp.prova': 'Auch Test-Leads importieren', 'az.indirizzo_webhook': 'Daten für Google Ads' },
    pt: { nome: 'Google Ads (formulários de leads)', descrizione: 'Quem preenche os formulários dos anúncios do Google vira cliente.', 'imp.chiave': 'Chave do webhook (para colar no Google Ads)', 'imp.indirizzo': 'Endereço público do Kubo (ex. https://kubo.meuestudio.com)', 'imp.prova': 'Importar também os leads de teste', 'az.indirizzo_webhook': 'Dados para o Google Ads' },
  },
};
