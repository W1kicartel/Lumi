// WhatsApp con la Cloud API di Meta, diretta: nessun intermediario, le tariffe di Meta senza ricarichi.
// Serve: l'ID del numero, l'ID dell'account WhatsApp Business (WABA), il token permanente di un utente di sistema con
// whatsapp_business_messaging e whatsapp_business_management, la chiave segreta dell'app (firma X-Hub-Signature-256 dei
// webhook) e il token di verifica, che Kubo genera e il titolare incolla su Meta. La verifica GET (hub.challenge) è
// entrata.verificaGet qui sotto, sullo stesso indirizzo /api/connettori/whatsapp/in. Guida: docs/WHATSAPP.md.
import { bus } from '../../server/moduli/whatsapp-bus.js';
import * as C from './cloud.js';
import { sfidaMeta } from '../../server/moduli/connettori-rete.js';

const ver = k => k.imp.versione || 'v24.0';
const chiama = (k, m, url, opz = {}) => k.http[m](/^https?:/.test(url) ? url : `${k.base}/${ver(k)}/${url}`, { ...opz, bearer: k.segreti.token });

export default {
  id: 'whatsapp', nome: 'WhatsApp (Meta Cloud API)', versione: 1, icona: 'utenti', base: 'https://graph.facebook.com',
  descrizione: 'Scrivi ai clienti su WhatsApp con l\'API ufficiale di Meta: risposte, promemoria, fatture. Le tariffe di Meta, senza ricarichi.',
  impostazioni: [
    { id: 'numero_id', nome: 'ID del numero di telefono (Phone number ID)', schema: /^\d{5,25}$/ },
    { id: 'waba_id', nome: 'ID dell\'account WhatsApp Business (WABA ID)', schema: /^\d{5,25}$/ },
    { id: 'token', nome: 'Token di accesso permanente (utente di sistema)', segreto: true },
    { id: 'segreto_app', nome: 'Chiave segreta dell\'app (App secret)', segreto: true },
    { id: 'verifica', nome: 'Token di verifica del webhook (da incollare su Meta)', segreto: true, generato: true },
    { id: 'versione', nome: 'Versione della Graph API', predefinito: 'v24.0', schema: /^v\d{2}\.\d$/ },
  ],
  permessi: { clienti: { leggi: true } },
  prova: async k => {
    const r = await chiama(k, 'get', `${k.imp.numero_id}?fields=display_phone_number,verified_name,quality_rating`);
    return r.ok ? { ok: true, messaggio: `${r.json?.verified_name || ''} · ${r.json?.display_phone_number || ''} · ${r.json?.quality_rating || ''}` } : { ok: false, messaggio: C.errore(r) };
  },
  // all'accensione l'app si iscrive agli eventi dell'account WhatsApp (POST /<WABA>/subscribed_apps): senza, i webhook non arrivano
  attiva: async k => { try { const r = await chiama(k, 'post', `${k.imp.waba_id}/subscribed_apps`); if (!r.ok) k.avvisa(C.errore(r)); } catch (e) { k.avvisa(String(e.message).slice(0, 200)); } },
  // POST /api/connettori/whatsapp/in: X-Hub-Signature-256 = «sha256=» + HMAC-SHA256 esadecimale del corpo grezzo con la chiave dell'app
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'x-hub-signature-256', segreto: 'segreto_app', formato: 'hex' },
    idempotenza: C.idempotenza,
    gestisci: (ev, k) => C.consegna(bus, k, C.eventi(ev)),
    // GET /api/connettori/whatsapp/in: la verifica di Meta (hub.challenge) con il token generato da Kubo
    verificaGet: (q, k) => sfidaMeta(q, k.segreti.verifica),
  },
  lavori: { 'whatsapp:invia': (corpo, k) => bus.get(k.db)?.lavora(corpo, k.id) },
  // l'interfaccia comune dei tre servizi (server/moduli/whatsapp.js non sa quale c'è sotto)
  whatsapp: {
    ...C.api({
      chiama, percorsoMessaggi: k => `${k.imp.numero_id}/messages`, percorsoMedia: k => `${k.imp.numero_id}/media`,
      percorsoModelli: (k, lista) => `${k.imp.waba_id}/message_templates${lista ? '?fields=id,name,status,category,language,components,rejected_reason&limit=100' : ''}`,
      listaModelli: j => j?.data || [],
    }),
    creaModelli: true,
    webhook: k => ({ percorso: '/api/connettori/whatsapp/in', verifica: true, campi: ['messages', 'message_template_status_update'] }),
  },
  catalogo: {
    categoria: 'whatsapp', sito: 'https://developers.facebook.com/docs/whatsapp/cloud-api', costo: 'a-consumo',
    costoNota: 'Nessun canone: paghi a Meta solo i modelli consegnati (in Italia circa 0,066 € marketing, 0,025 € utility e autenticazione, listino di ottobre 2026). Le risposte entro 24 ore dal messaggio del cliente sono gratis.',
    serve: [
      { cosa: 'Un portafoglio Meta Business, meglio se verificato', dove: 'business.facebook.com → Impostazioni → Centro sicurezza', link: 'https://business.facebook.com/settings' },
      { cosa: 'Un\'app di tipo «Business» con il prodotto WhatsApp', dove: 'developers.facebook.com → Le mie app → Crea app', link: 'https://developers.facebook.com/apps' },
      { cosa: 'Un numero di telefono non registrato nell\'app WhatsApp', dove: 'WhatsApp Manager → Numeri di telefono', link: 'https://business.facebook.com/wa/manage/phone-numbers/' },
      { cosa: 'Il token permanente di un utente di sistema (whatsapp_business_messaging, whatsapp_business_management)', dove: 'Impostazioni del business → Utenti → Utenti di sistema → Genera token', link: 'https://business.facebook.com/settings/system-users' },
      { cosa: 'La chiave segreta dell\'app (App secret)', dove: 'L\'app → Impostazioni dell\'app → Di base', link: 'https://developers.facebook.com/apps' },
      { cosa: 'Un metodo di pagamento sull\'account WhatsApp', dove: 'WhatsApp Manager → Impostazioni di pagamento', link: 'https://business.facebook.com/billing_hub/' },
    ],
    passi: [
      'Crea (o apri) il portafoglio su business.facebook.com e avvia la verifica dell\'azienda.',
      'Su developers.facebook.com crea un\'app di tipo Business e aggiungi il prodotto WhatsApp.',
      'In WhatsApp → Configurazione API aggiungi il tuo numero e verificalo con il codice SMS: copia l\'ID del numero e l\'ID dell\'account WhatsApp Business.',
      'In Impostazioni del business → Utenti di sistema crea un utente di sistema amministratore, assegnagli l\'app e l\'account WhatsApp, genera un token senza scadenza con whatsapp_business_messaging e whatsapp_business_management.',
      'Copia la chiave segreta dell\'app da Impostazioni dell\'app → Di base.',
      'In Kubo incolla i quattro valori e accendi il connettore: Kubo genera il token di verifica.',
      'In WhatsApp → Configurazione incolla l\'URL del webhook e il token di verifica che Kubo ti mostra, poi iscriviti ai campi messages e message_template_status_update.',
      'Aggiungi un metodo di pagamento in WhatsApp Manager e prova la connessione.',
    ],
    difficolta: 'difficile', zone: ['mondo'], prova: 'finto',
    fonti: ['https://developers.facebook.com/docs/whatsapp/cloud-api/get-started', 'https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples',
      'https://developers.facebook.com/docs/graph-api/webhooks/getting-started', 'https://developers.facebook.com/docs/whatsapp/pricing',
      'https://developers.facebook.com/docs/whatsapp/business-management-api/get-started#1--acquire-an-access-token-using-a-system-user-or-facebook-login'],
    parole: ['whatsapp', 'meta', 'cloud api', 'messaggi', 'chat', 'promemoria', 'waba', 'business'],
  },
  testi: {
    en: { nome: 'WhatsApp (Meta Cloud API)', descrizione: 'Message customers on WhatsApp with Meta\'s official API: replies, reminders, invoices. Meta\'s prices, no markup.',
      'imp.numero_id': 'Phone number ID', 'imp.waba_id': 'WhatsApp Business Account ID (WABA ID)', 'imp.token': 'Permanent access token (system user)', 'imp.segreto_app': 'App secret',
      'imp.verifica': 'Webhook verify token (paste it on Meta)', 'imp.versione': 'Graph API version',
      'cat.costoNota': 'No monthly fee: you pay Meta only for delivered templates (in Italy about €0.066 marketing, €0.025 utility and authentication, October 2026 rate card). Replies within 24 hours of the customer\'s message are free.',
      'cat.serve': [{ cosa: 'A Meta business portfolio, ideally verified', dove: 'business.facebook.com → Settings → Security center' }, { cosa: 'A «Business» app with the WhatsApp product', dove: 'developers.facebook.com → My apps → Create app' },
        { cosa: 'A phone number not registered in the WhatsApp app', dove: 'WhatsApp Manager → Phone numbers' }, { cosa: 'A system user permanent token (whatsapp_business_messaging, whatsapp_business_management)', dove: 'Business settings → Users → System users → Generate token' },
        { cosa: 'The app secret', dove: 'Your app → App settings → Basic' }, { cosa: 'A payment method on the WhatsApp account', dove: 'WhatsApp Manager → Payment settings' }],
      'cat.passi': ['Create (or open) the portfolio on business.facebook.com and start business verification.', 'On developers.facebook.com create a Business app and add the WhatsApp product.',
        'In WhatsApp → API setup add your number and verify it with the SMS code: copy the phone number ID and the WhatsApp Business Account ID.',
        'In Business settings → System users create an admin system user, assign it the app and the WhatsApp account, and generate a never-expiring token with whatsapp_business_messaging and whatsapp_business_management.',
        'Copy the app secret from App settings → Basic.', 'In Kubo paste the four values and turn the connector on: Kubo generates the verify token.',
        'In WhatsApp → Configuration paste the webhook URL and the verify token Kubo shows you, then subscribe to the messages and message_template_status_update fields.',
        'Add a payment method in WhatsApp Manager and test the connection.'] },
    es: { nome: 'WhatsApp (Meta Cloud API)', descrizione: 'Escribe a los clientes por WhatsApp con la API oficial de Meta: respuestas, recordatorios, facturas.', 'imp.numero_id': 'ID del número de teléfono', 'imp.waba_id': 'ID de la cuenta de WhatsApp Business (WABA)', 'imp.token': 'Token de acceso permanente (usuario del sistema)', 'imp.segreto_app': 'Clave secreta de la app', 'imp.verifica': 'Token de verificación del webhook', 'imp.versione': 'Versión de la Graph API' },
    fr: { nome: 'WhatsApp (Meta Cloud API)', descrizione: 'Écrivez aux clients sur WhatsApp avec l\'API officielle de Meta : réponses, rappels, factures.', 'imp.numero_id': 'ID du numéro de téléphone', 'imp.waba_id': 'ID du compte WhatsApp Business (WABA)', 'imp.token': 'Jeton d\'accès permanent (utilisateur système)', 'imp.segreto_app': 'Clé secrète de l\'app', 'imp.verifica': 'Jeton de vérification du webhook', 'imp.versione': 'Version de la Graph API' },
    de: { nome: 'WhatsApp (Meta Cloud API)', descrizione: 'Schreibe Kunden auf WhatsApp mit der offiziellen API von Meta: Antworten, Erinnerungen, Rechnungen.', 'imp.numero_id': 'Telefonnummer-ID', 'imp.waba_id': 'WhatsApp-Business-Konto-ID (WABA)', 'imp.token': 'Dauerhaftes Zugriffstoken (Systembenutzer)', 'imp.segreto_app': 'App-Geheimschlüssel', 'imp.verifica': 'Verifizierungstoken des Webhooks', 'imp.versione': 'Graph-API-Version' },
    pt: { nome: 'WhatsApp (Meta Cloud API)', descrizione: 'Escreva aos clientes no WhatsApp com a API oficial da Meta: respostas, lembretes, faturas.', 'imp.numero_id': 'ID do número de telefone', 'imp.waba_id': 'ID da conta WhatsApp Business (WABA)', 'imp.token': 'Token de acesso permanente (usuário do sistema)', 'imp.segreto_app': 'Chave secreta do app', 'imp.verifica': 'Token de verificação do webhook', 'imp.versione': 'Versão da Graph API' },
  },
};
