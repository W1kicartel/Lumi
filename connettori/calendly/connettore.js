// Calendly: chi prenota dal link di Calendly finisce nell'agenda di Lumi. invitee.created crea l'appuntamento (e il
// cliente, trovato per email o creato), uno spostamento (invitee.created con old_invitee) sposta quello che c'è,
// invitee.canceled lo annulla. La firma è «Calendly-Webhook-Signature: t=<secondi>,v1=<hex HMAC-SHA256("t.corpo")>»
// con la chiave di firma, che qui genera Lumi e consegna a Calendly quando registra il webhook (API v2, token personale).
// Serve un indirizzo pubblico: Calendly deve raggiungere Lumi da Internet.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { REQ, PERMESSI, ricevi, annulla, webhookDi, indirizzoDi, MANCA_INDIRIZZO } from '../_comunica/agenda.js';

export const TOLLERANZA = 180;   // secondi, contro il replay
export function firmaCalendly(intestazione, grezzo, chiave, ora = Date.now()) {
  if (!intestazione || !chiave) return false;
  const p = Object.fromEntries(String(intestazione).split(',').map(x => x.split('=').map(s => s.trim())));
  const t = Number(p.t); if (!t || !p.v1 || Math.abs(ora / 1000 - t) > TOLLERANZA) return false;
  const atteso = Buffer.from(createHmac('sha256', chiave).update(`${t}.`).update(grezzo).digest('hex')), v = Buffer.from(String(p.v1));
  return atteso.length === v.length && timingSafeEqual(atteso, v);
}
export const firmaCalendlyDi = (chiave, corpo, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', chiave).update(`${t}.${corpo}`).digest('hex')}`;
const base = k => k.base || 'https://api.calendly.com';
// le risposte alle domande del modulo di prenotazione vanno nelle note
const note = p => [p.scheduled_event?.name && `Calendly: ${p.scheduled_event.name}`, ...(p.questions_and_answers || []).map(q => `${q.question}: ${q.answer}`)].filter(Boolean).join('\n');

export default {
  id: 'calendly', nome: 'Calendly', versione: 1, icona: 'calendario', base: 'https://api.calendly.com',
  descrizione: 'Le prenotazioni di Calendly diventano appuntamenti, con il cliente.',
  impostazioni: [
    { id: 'token', nome: 'Token di accesso personale', segreto: true },
    { id: 'firma', nome: 'Chiave di firma dei webhook', segreto: true, generato: true },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Lumi (es. https://lumi.studiorossi.it)', tipo: 'url', obbligatorio: false },
    { id: 'clienti', nome: 'Crea il cliente se non c\'è', tipo: 'si_no', predefinito: true },
  ],
  richiede: REQ, permessi: PERMESSI,
  prova: async k => { const r = await k.http.get(`${base(k)}/users/me`, { bearer: k.segreti.token }); return { ok: r.ok, messaggio: r.ok ? r.json?.resource?.name : `HTTP ${r.stato}` }; },
  entrata: {
    firma: { tipo: 'calendly', segreto: 'firma', verifica: ({ req, grezzo, segreto }) => firmaCalendly(req.headers['calendly-webhook-signature'], grezzo, segreto) },
    idempotenza: ev => `${ev.event}:${ev.payload?.uri || ''}`,
    async gestisci(ev, k) {
      const p = ev.payload || {};
      if (ev.event === 'invitee.canceled') return p.rescheduled ? 'ignorato: spostato' : annulla(k, p.uri);
      if (ev.event !== 'invitee.created') return 'ignorato';
      return ricevi(k, { remoto: p.uri, vecchio: p.old_invitee, quando: p.scheduled_event?.start_time, servizio: p.scheduled_event?.name, note: note(p),
        cliente: { email: p.email, nome: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '), telefono: p.text_reminder_number }, creaClienti: k.imp.clienti !== false });
    },
  },
  azioni: {
    registra_webhook: {
      nome: 'Registra il webhook su Calendly', descrizione: 'Chiede a Calendly di avvisare Lumi a ogni prenotazione e annullamento', scrive: true,
      proponi: async (a, k) => ({ titolo: 'Webhook di Calendly', righe: [['Indirizzo', webhookDi(k, 'calendly')], ['Eventi', 'invitee.created, invitee.canceled']],
        avvisi: indirizzoDi(k) ? [] : [MANCA_INDIRIZZO] }),
      async esegui(a, k) {
        if (!indirizzoDi(k)) throw new Error(MANCA_INDIRIZZO);
        const me = await k.http.get(`${base(k)}/users/me`, { bearer: k.segreti.token }); if (!me.ok) throw new Error(`Calendly ha risposto ${me.stato}`);
        const r = await k.http.post(`${base(k)}/webhook_subscriptions`, { bearer: k.segreti.token, json: { url: webhookDi(k, 'calendly'), events: ['invitee.created', 'invitee.canceled'],
          organization: me.json.resource.current_organization, user: me.json.resource.uri, scope: 'user', signing_key: k.segreti.firma } });
        if (r.stato === 409) return { gia: true };   // già registrato con lo stesso indirizzo
        if (!r.ok) throw new Error(`Calendly ha risposto ${r.stato}: ${r.json?.message || ''}`);
        return { uri: r.json?.resource?.uri };
      },
    },
  },
  catalogo: {
    categoria: 'prenotazioni', sito: 'https://calendly.com', costo: 'abbonamento',
    costoNota: 'I webhook richiedono un piano a pagamento: Standard da 10 $ a utente al mese (annuale), Teams 16 $; il piano Free non li ha.',
    serve: [
      { cosa: 'Token di accesso personale (Personal Access Token)', dove: 'Calendly → Integrazioni e app → API e webhook → Genera nuovo token', link: 'https://calendly.com/integrations/api_webhooks' },
      { cosa: 'Un indirizzo pubblico di Lumi (dominio o tunnel) raggiungibile da Internet', dove: 'Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel)', link: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/' },
    ],
    passi: ['Su Calendly apri Integrazioni e app → API e webhook e genera un token personale.', 'Incolla il token qui.', 'Scrivi l\'indirizzo pubblico di Lumi (con https); se l\'hai impostato nella Libreria, puoi lasciarlo vuoto.', 'Accendi il connettore: la chiave di firma la crea Lumi.', 'Premi «Registra il webhook su Calendly».', 'Fai una prenotazione di prova: compare tra gli appuntamenti, con il cliente.'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures', 'https://developer.calendly.com/openapi/calendly-api.yaml', 'https://calendly.com/pricing'],
    prova: 'finto', parole: ['calendly', 'prenotazioni', 'prenotazione online', 'booking', 'appuntamenti', 'scheduling', 'webhook'],
  },
  testi: {
    en: { nome: 'Calendly', descrizione: 'Calendly bookings become appointments, with the customer.', 'imp.token': 'Personal access token', 'imp.firma': 'Webhook signing key', 'imp.indirizzo': 'Public address of Lumi (e.g. https://lumi.mystudio.com)', 'imp.clienti': 'Create the customer if missing', 'az.registra_webhook': 'Register the webhook on Calendly',
      'cat.costoNota': 'Webhooks need a paid plan: Standard from $10 per user per month (yearly), Teams $16; the Free plan does not have them.',
      'cat.passi': ['In Calendly open Integrations & apps → API & webhooks and generate a personal token.', 'Paste the token here.', 'Enter Lumi\'s public address (with https); if you set it in the Library, you can leave it empty.', 'Turn the connector on: Lumi creates the signing key.', 'Press «Register the webhook on Calendly».', 'Make a test booking: it shows up among the appointments, with the customer.'],
      'cat.serve': [{ cosa: 'Personal Access Token', dove: 'Calendly → Integrations & apps → API & webhooks → Generate new token' }, { cosa: 'A public address for Lumi reachable from the Internet', dove: 'Your domain with HTTPS, or a tunnel (Cloudflare Tunnel)' }] },
    es: { nome: 'Calendly', descrizione: 'Las reservas de Calendly se convierten en citas, con el cliente.', 'imp.token': 'Token de acceso personal', 'imp.firma': 'Clave de firma de los webhooks', 'imp.indirizzo': 'Dirección pública de Lumi (p. ej. https://lumi.miestudio.es)', 'imp.clienti': 'Crear el cliente si no existe', 'az.registra_webhook': 'Registrar el webhook en Calendly' },
    fr: { nome: 'Calendly', descrizione: 'Les réservations Calendly deviennent des rendez-vous, avec le client.', 'imp.token': 'Jeton d\'accès personnel', 'imp.firma': 'Clé de signature des webhooks', 'imp.indirizzo': 'Adresse publique de Lumi (ex. https://lumi.moncabinet.fr)', 'imp.clienti': 'Créer le client s\'il n\'existe pas', 'az.registra_webhook': 'Enregistrer le webhook sur Calendly' },
    de: { nome: 'Calendly', descrizione: 'Calendly-Buchungen werden zu Terminen, mit dem Kunden.', 'imp.token': 'Persönliches Zugriffstoken', 'imp.firma': 'Signaturschlüssel der Webhooks', 'imp.indirizzo': 'Öffentliche Adresse von Lumi (z. B. https://lumi.meinestudio.de)', 'imp.clienti': 'Kunden anlegen, falls er fehlt', 'az.registra_webhook': 'Webhook bei Calendly registrieren' },
    pt: { nome: 'Calendly', descrizione: 'As reservas do Calendly viram agendamentos, com o cliente.', 'imp.token': 'Token de acesso pessoal', 'imp.firma': 'Chave de assinatura dos webhooks', 'imp.indirizzo': 'Endereço público do Lumi (ex. https://lumi.meuestudio.com)', 'imp.clienti': 'Criar o cliente se não existir', 'az.registra_webhook': 'Registrar o webhook no Calendly' },
  },
};
