// Typeform: chi compila un modulo diventa un cliente (niente doppioni per email o telefono), con le risposte nelle note;
// se il modulo chiede una data e un'ora, anche un appuntamento. Il webhook (form_response) è firmato:
// «Typeform-Signature: sha256=<base64 HMAC-SHA256 del corpo con il secret del webhook>». Il secret lo genera Kubo e il
// titolare lo incolla nel webhook su Typeform. Una risposta già importata (event_id, token) non entra due volte.
import { REQ, PERMESSI, richiesta } from '../_comunica/moduli.js';
import { webhookDi } from '../_comunica/agenda.js';

const TIPI = { email: 'email', phone_number: 'telefono', date: 'data' };
// le risposte di Typeform → [{ titolo, tipo, valore }] (il titolo della domanda viene da definition.fields)
export function risposteTypeform(fr = {}) {
  const titoli = Object.fromEntries((fr.definition?.fields || []).map(f => [f.id, f.title]));
  const out = (fr.answers || []).map(a => ({ titolo: String(titoli[a.field?.id] || a.field?.ref || '').replace(/\*|\{\{[^}]*\}\}/g, '').trim(), tipo: TIPI[a.type] || 'testo',
    valore: a.type === 'choice' ? (a.choice?.label ?? a.choice?.other) : a.type === 'choices' ? [...(a.choices?.labels || []), a.choices?.other].filter(Boolean)
      : a.type === 'payment' ? a.payment?.amount : a[a.type] }));
  for (const [c, v] of Object.entries(fr.hidden || {})) out.push({ titolo: c, tipo: 'testo', valore: v });
  return out;
}

export default {
  id: 'typeform', nome: 'Typeform', versione: 1, icona: 'persona',
  descrizione: 'Chi compila un modulo Typeform diventa un cliente, con le risposte nelle note.',
  impostazioni: [
    { id: 'segreto', nome: 'Secret del webhook (da incollare su Typeform)', segreto: true, generato: true },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (es. https://kubo.studiorossi.it)', tipo: 'url', obbligatorio: false },
    { id: 'clienti', nome: 'Crea il cliente se non c\'è', tipo: 'si_no', predefinito: true },
  ],
  richiede: REQ, permessi: PERMESSI,
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'typeform-signature', segreto: 'segreto', formato: 'base64' },
    idempotenza: ev => ev?.event_id || ev?.form_response?.token || null,
    async gestisci(ev, k) {
      if (ev?.event_type !== 'form_response' || !ev.form_response) return 'ignorato';
      const fr = ev.form_response;
      return richiesta(k, { remoto: fr.token || ev.event_id, fonte: 'typeform', intestazione: 'Typeform', modulo: fr.definition?.title, risposte: risposteTypeform(fr), crea: k.imp.clienti !== false });
    },
  },
  azioni: {
    indirizzo_webhook: {
      nome: 'Indirizzo da dare a Typeform', descrizione: 'L\'indirizzo da incollare nel webhook del modulo su Typeform',
      async esegui(a, k) { return { indirizzo: webhookDi(k, 'typeform') }; },
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.typeform.com', costo: 'abbonamento',
    costoNota: 'Il piano Free (10 risposte al mese) ha già i webhook; Basic da 25 € al mese (annuale) per 100 risposte, Plus 50 €, Business 83 €.',
    serve: [
      { cosa: 'Un webhook sul modulo, con il secret generato da Kubo', dove: 'Typeform → apri il modulo → Connect → Webhooks → Add a webhook → poi Edit → Secret', link: 'https://www.typeform.com/help/a/webhooks-360029573471/' },
      { cosa: 'Un indirizzo pubblico di Kubo (dominio o tunnel) raggiungibile da Internet', dove: 'Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel)', link: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/' },
    ],
    passi: ['Accendi il connettore: Kubo crea il secret del webhook.', 'Scrivi l\'indirizzo pubblico di Kubo (con https).', 'Su Typeform apri il modulo → Connect → Webhooks → Add a webhook e incolla l\'indirizzo dato da «Indirizzo da dare a Typeform».', 'Premi Edit sul webhook, incolla il secret in «Secret» e salva; poi accendi il webhook.', 'Per riconoscere il cliente usa le domande «Email» e «Phone number» (e una domanda «Nome»); per un appuntamento una domanda «Date» e una «Ora» (es. 15:30).', 'Premi «Send test request» o compila il modulo: il cliente compare in Kubo.'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://www.typeform.com/developers/webhooks/secure-your-webhooks/', 'https://www.typeform.com/developers/webhooks/example-payload/', 'https://www.typeform.com/pricing/'],
    prova: 'finto', parole: ['typeform', 'moduli', 'modulo contatti', 'form', 'forms', 'lead', 'sondaggi', 'survey', 'richieste'],
  },
  testi: {
    en: { nome: 'Typeform', descrizione: 'People who fill in a Typeform become customers, with the answers in the notes.', 'imp.segreto': 'Webhook secret (to paste into Typeform)', 'imp.indirizzo': 'Public address of Kubo (e.g. https://kubo.mystudio.com)', 'imp.clienti': 'Create the customer if missing', 'az.indirizzo_webhook': 'Address to give Typeform',
      'cat.costoNota': 'The Free plan (10 responses a month) already has webhooks; Basic from €25 a month (yearly) for 100 responses, Plus €50, Business €83.',
      'cat.serve': [{ cosa: 'A webhook on the form, with the secret generated by Kubo', dove: 'Typeform → open the form → Connect → Webhooks → Add a webhook → then Edit → Secret' }, { cosa: 'A public address for Kubo reachable from the Internet', dove: 'Your domain with HTTPS, or a tunnel (Cloudflare Tunnel)' }],
      'cat.passi': ['Turn the connector on: Kubo creates the webhook secret.', 'Enter Kubo\'s public address (with https).', 'In Typeform open the form → Connect → Webhooks → Add a webhook and paste the address given by «Address to give Typeform».', 'Press Edit on the webhook, paste the secret in «Secret» and save; then turn the webhook on.', 'To recognise the customer use «Email» and «Phone number» questions (and a «Name» question); for an appointment a «Date» question and a «Time» one (e.g. 15:30).', 'Press «Send test request» or fill in the form: the customer shows up in Kubo.'] },
    es: { nome: 'Typeform', descrizione: 'Quien rellena un Typeform se convierte en cliente, con las respuestas en las notas.', 'imp.segreto': 'Secreto del webhook (para pegar en Typeform)', 'imp.indirizzo': 'Dirección pública de Kubo (p. ej. https://kubo.miestudio.es)', 'imp.clienti': 'Crear el cliente si no existe', 'az.indirizzo_webhook': 'Dirección para Typeform' },
    fr: { nome: 'Typeform', descrizione: 'Les personnes qui remplissent un Typeform deviennent clients, avec les réponses dans les notes.', 'imp.segreto': 'Secret du webhook (à coller dans Typeform)', 'imp.indirizzo': 'Adresse publique de Kubo (ex. https://kubo.moncabinet.fr)', 'imp.clienti': 'Créer le client s\'il n\'existe pas', 'az.indirizzo_webhook': 'Adresse à donner à Typeform' },
    de: { nome: 'Typeform', descrizione: 'Wer ein Typeform ausfüllt, wird Kunde, mit den Antworten in den Notizen.', 'imp.segreto': 'Webhook-Secret (in Typeform einfügen)', 'imp.indirizzo': 'Öffentliche Adresse von Kubo (z. B. https://kubo.meinestudio.de)', 'imp.clienti': 'Kunden anlegen, falls er fehlt', 'az.indirizzo_webhook': 'Adresse für Typeform' },
    pt: { nome: 'Typeform', descrizione: 'Quem preenche um Typeform vira cliente, com as respostas nas notas.', 'imp.segreto': 'Segredo do webhook (para colar no Typeform)', 'imp.indirizzo': 'Endereço público do Kubo (ex. https://kubo.meuestudio.com)', 'imp.clienti': 'Criar o cliente se não existir', 'az.indirizzo_webhook': 'Endereço para o Typeform' },
  },
};
