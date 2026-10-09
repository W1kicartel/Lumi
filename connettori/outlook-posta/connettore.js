// Outlook e Microsoft 365 (posta): le email ai clienti partono dalla tua casella Microsoft, con Microsoft Graph
// (POST /me/sendMail), senza SMTP: Exchange Online sta spegnendo l'accesso SMTP con la password.
// OAuth con il codice del dispositivo (app desktop) o con il codice; tenant configurabile come per il calendario Outlook.
import { connettoreEmail } from '../_comunica/email.js';
const login = k => `${k.base || 'https://login.microsoftonline.com'}/${encodeURIComponent(k.imp.tenant || 'common')}/oauth2/v2.0`;
const graph = k => `${k.base || 'https://graph.microsoft.com'}/v1.0`;
export default connettoreEmail({
  id: 'outlook-posta', nome: 'Outlook e Microsoft 365 (posta)', descrizione: 'Email ai clienti dalla tua casella Outlook o Microsoft 365: messaggi, fatture e preventivi in allegato.',
  impostazioni: [
    { id: 'client_id', nome: 'ID applicazione (client) di Microsoft Entra', segreto: true },
    { id: 'client_secret', nome: 'Segreto client (solo per il collegamento con il codice)', segreto: true, obbligatorio: false },
    { id: 'tenant', nome: 'Tenant («common», «consumers» per gli account personali, o l\'id della directory)', predefinito: 'common', schema: /^[\w.-]{2,80}$/ },
  ],
  oauth: { tipo: 'codice', autorizza: k => `${login(k)}/authorize`, token: k => `${login(k)}/token`, dispositivo: k => `${login(k)}/devicecode`, scope: 'offline_access User.Read Mail.Send' },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Microsoft' };
    const r = await k.http.get(`${graph(k)}/me`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? r.json?.mail || r.json?.userPrincipalName : `HTTP ${r.stato}` };
  },
  async invia(k, m) {
    const tot = m.allegati.reduce((s, x) => s + x.contenuto.length, 0);
    if (tot > 3e6) throw new Error('Allegati oltre 3 MB: Outlook non li accetta in un solo invio');
    const r = await k.http.post(`${graph(k)}/me/sendMail`, { bearer: await k.oauth.token(), json: { saveToSentItems: true, message: {
      subject: m.oggetto, body: { contentType: 'HTML', content: m.html }, toRecipients: [{ emailAddress: { address: m.a, ...(m.aNome ? { name: m.aNome } : {}) } }],
      ...(m.da ? { from: { emailAddress: { address: m.da, ...(m.daNome ? { name: m.daNome } : {}) } } } : {}), ...(m.rispondi ? { replyTo: [{ emailAddress: { address: m.rispondi } }] } : {}),
      ...(m.allegati.length ? { attachments: m.allegati.map(x => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: x.nome, contentType: x.tipo.split(';')[0], contentBytes: x.contenuto.toString('base64') })) } : {}) } } });
    if (!r.ok) throw new Error(`Outlook: ${r.json?.error?.message || `HTTP ${r.stato}`}`);
    return { id: null };   // sendMail risponde 202 senza corpo
  },
  catalogo: {
    categoria: 'email', sito: 'https://www.microsoft.com/microsoft-365/outlook', costo: 'gratis',
    costoNota: 'Gratis con un account Outlook.com; con Microsoft 365 è incluso nel piano (es. Business Basic, circa 5,60 € per utente al mese). Limite di Exchange Online: 10.000 destinatari al giorno.',
    serve: [{ cosa: 'L\'ID applicazione (client) di un\'app registrata, con «Consenti flussi client pubblici» attivo e il permesso delegato Mail.Send', dove: 'entra.microsoft.com → Applicazioni → Registrazioni app → Nuova registrazione → Autenticazione → Consenti flussi client pubblici: Sì → Autorizzazioni API → Microsoft Graph → Delegate → Mail.Send, User.Read', link: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' }],
    passi: ['Su entra.microsoft.com registra una nuova app (tipi di account: anche personali, se usi Outlook.com)', 'In Autenticazione attiva «Consenti flussi client pubblici»', 'In Autorizzazioni API aggiungi Microsoft Graph → Delegate → Mail.Send e User.Read', 'Copia l\'ID applicazione (client) e incollalo qui; per gli account personali scrivi «consumers» come tenant', 'Scrivi la tua email come mittente e premi «Collega»: apri microsoft.com/devicelogin e scrivi il codice che Lumi mostra', 'Accendi e premi «Prova»: mostra la casella collegata'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://learn.microsoft.com/graph/api/user-sendmail', 'https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code', 'https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online', 'https://learn.microsoft.com/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits'],
    prova: 'finto', parole: ['outlook', 'microsoft 365', 'office 365', 'exchange', 'hotmail', 'email', 'posta', 'fatture via email'],
  },
  testi: {
    en: { nome: 'Outlook and Microsoft 365 (mail)', descrizione: 'Email customers from your Outlook or Microsoft 365 mailbox: messages, invoices and quotes attached.', 'imp.client_id': 'Microsoft Entra application (client) ID', 'imp.client_secret': 'Client secret (only for the code sign-in)', 'imp.tenant': 'Tenant («common», «consumers» for personal accounts, or the directory id)',
      'cat.costoNota': 'Free with an Outlook.com account; with Microsoft 365 it is included in the plan (e.g. Business Basic, about €5.60 per user per month). Exchange Online limit: 10,000 recipients a day.',
      'cat.serve': [{ cosa: 'The application (client) ID of a registered app, with «Allow public client flows» on and the delegated Mail.Send permission', dove: 'entra.microsoft.com → Applications → App registrations → New registration → Authentication → Allow public client flows: Yes → API permissions → Microsoft Graph → Delegated → Mail.Send, User.Read' }],
      'cat.passi': ['On entra.microsoft.com register a new app (account types: personal too, if you use Outlook.com)', 'In Authentication turn on «Allow public client flows»', 'In API permissions add Microsoft Graph → Delegated → Mail.Send and User.Read', 'Copy the application (client) ID and paste it here; for personal accounts write «consumers» as tenant', 'Write your email as sender and press «Connect»: open microsoft.com/devicelogin and type the code Lumi shows', 'Turn on and press «Test»: it shows the connected mailbox'] },
    es: { nome: 'Outlook y Microsoft 365 (correo)', descrizione: 'Email a los clientes desde tu buzón de Outlook o Microsoft 365: mensajes, facturas y presupuestos adjuntos.', 'imp.client_id': 'ID de aplicación (cliente) de Microsoft Entra', 'imp.client_secret': 'Secreto de cliente (solo para el acceso con código)', 'imp.tenant': 'Tenant («common», «consumers» para cuentas personales, o el id del directorio)' },
    fr: { nome: 'Outlook et Microsoft 365 (courrier)', descrizione: 'E-mails aux clients depuis ta boîte Outlook ou Microsoft 365 : messages, factures et devis en pièce jointe.', 'imp.client_id': 'ID d\'application (client) Microsoft Entra', 'imp.client_secret': 'Secret client (seulement pour la connexion par code)', 'imp.tenant': 'Tenant (« common », « consumers » pour les comptes personnels, ou l\'id de l\'annuaire)' },
    de: { nome: 'Outlook und Microsoft 365 (E-Mail)', descrizione: 'E-Mails an Kunden aus deinem Outlook- oder Microsoft-365-Postfach: Nachrichten, Rechnungen und Angebote im Anhang.', 'imp.client_id': 'Anwendungs-ID (Client) von Microsoft Entra', 'imp.client_secret': 'Clientgeheimnis (nur für die Anmeldung mit Code)', 'imp.tenant': 'Tenant („common“, „consumers“ für private Konten oder die Verzeichnis-ID)' },
    pt: { nome: 'Outlook e Microsoft 365 (email)', descrizione: 'Email aos clientes a partir da sua caixa Outlook ou Microsoft 365: mensagens, faturas e orçamentos em anexo.', 'imp.client_id': 'ID da aplicação (cliente) do Microsoft Entra', 'imp.client_secret': 'Segredo do cliente (só para o acesso com código)', 'imp.tenant': 'Tenant («common», «consumers» para contas pessoais, ou o id do diretório)' },
  },
});
