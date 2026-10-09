// Gmail: le email ai clienti partono dalla tua casella Gmail o Google Workspace, senza password per app.
// OAuth con il solo permesso di inviare (gmail.send); il messaggio MIME intero va a users.messages.send in base64url.
import { connettoreEmail, indirizzo } from '../_comunica/email.js';
import { messaggio } from '../posta/smtp.js';
const api = k => k.base || 'https://gmail.googleapis.com';
export default connettoreEmail({
  id: 'gmail', nome: 'Gmail', descrizione: 'Email ai clienti dalla tua casella Gmail o Google Workspace: messaggi, fatture e preventivi in allegato.',
  impostazioni: [{ id: 'client_id', nome: 'Google: client ID OAuth', segreto: true }, { id: 'client_secret', nome: 'Google: client secret', segreto: true }],
  oauth: { tipo: 'codice', autorizza: 'https://accounts.google.com/o/oauth2/v2/auth', token: k => (k.base ? `${k.base}/token` : 'https://oauth2.googleapis.com/token'),
    scope: 'https://www.googleapis.com/auth/gmail.send', extra: { access_type: 'offline', prompt: 'consent' } },
  // con il solo gmail.send non si legge il profilo: la prova controlla che il token si rinnovi
  prova: async k => { if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Google' }; await k.oauth.token(); return { ok: true, messaggio: 'collegato' }; },
  async invia(k, m) {
    let mime = messaggio({ da: indirizzo(m.da, m.daNome), a: indirizzo(m.a, m.aNome), oggetto: m.oggetto, testo: m.testo, allegati: m.allegati }).replace(/^\.\./gm, '.');
    if (m.rispondi) mime = `Reply-To: ${m.rispondi}\r\n${mime}`;
    const r = await k.http.post(`${api(k)}/gmail/v1/users/me/messages/send`, { bearer: await k.oauth.token(), json: { raw: Buffer.from(mime, 'utf8').toString('base64url') } });
    if (!r.ok) throw new Error(`Gmail: ${r.json?.error?.message || `HTTP ${r.stato}`}`);
    return { id: r.json?.id };
  },
  catalogo: {
    categoria: 'email', sito: 'https://workspace.google.com/products/gmail/', costo: 'gratis',
    costoNota: 'Gratis con un account Gmail (fino a circa 500 destinatari al giorno); con Google Workspace (da circa 7 € per utente al mese) fino a 2.000 al giorno.',
    serve: [{ cosa: 'Un client OAuth «Applicazione web» con client ID e client secret', dove: 'console.cloud.google.com → nuovo progetto → API e servizi → Libreria → abilita «Gmail API» → Schermata consenso OAuth → Credenziali → Crea credenziali → ID client OAuth → Applicazione web', link: 'https://console.cloud.google.com/apis/credentials' }],
    passi: ['Su console.cloud.google.com crea un progetto e abilita la Gmail API', 'Configura la schermata di consenso OAuth (tipo Esterno, o Interno con Workspace) e aggiungi l\'ambito gmail.send', 'Pubblica l\'app («In produzione»): in modalità Test il collegamento scade dopo 7 giorni; per un uso tuo Google mostra solo un avviso «app non verificata»', 'Crea un ID client OAuth di tipo Applicazione web con l\'URI di reindirizzamento <indirizzo di Kubo>/api/connettori/gmail/oauth/ritorno', 'Incolla qui client ID e client secret, scrivi la tua email come mittente e premi «Collega»', 'Accendi e prova: «Manda la fattura per email» in una fattura emessa'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send', 'https://developers.google.com/workspace/gmail/api/auth/scopes', 'https://developers.google.com/identity/protocols/oauth2/web-server#offline', 'https://support.google.com/a/answer/166852'],
    prova: 'finto', parole: ['gmail', 'google', 'workspace', 'email', 'posta', 'fatture via email', 'g suite'],
  },
  testi: {
    en: { nome: 'Gmail', descrizione: 'Email customers from your Gmail or Google Workspace mailbox: messages, invoices and quotes attached.', 'imp.client_id': 'Google: OAuth client ID', 'imp.client_secret': 'Google: client secret',
      'cat.costoNota': 'Free with a Gmail account (up to about 500 recipients a day); with Google Workspace (from about €7 per user per month) up to 2,000 a day.',
      'cat.serve': [{ cosa: 'An OAuth «Web application» client with client ID and secret', dove: 'console.cloud.google.com → new project → APIs & Services → Library → enable «Gmail API» → OAuth consent screen → Credentials → Create credentials → OAuth client ID → Web application' }],
      'cat.passi': ['On console.cloud.google.com create a project and enable the Gmail API', 'Set up the OAuth consent screen and add the gmail.send scope', 'Publish the app («In production»): in Testing mode the connection expires after 7 days', 'Create a Web application OAuth client with the redirect URI <Kubo address>/api/connettori/gmail/oauth/ritorno', 'Paste client ID and secret here, write your email as sender and press «Connect»', 'Turn on and try: «Email the invoice» on an issued invoice'] },
    es: { nome: 'Gmail', descrizione: 'Email a los clientes desde tu buzón de Gmail o Google Workspace: mensajes, facturas y presupuestos adjuntos.', 'imp.client_id': 'Google: client ID de OAuth', 'imp.client_secret': 'Google: client secret' },
    fr: { nome: 'Gmail', descrizione: 'E-mails aux clients depuis ta boîte Gmail ou Google Workspace : messages, factures et devis en pièce jointe.', 'imp.client_id': 'Google : client ID OAuth', 'imp.client_secret': 'Google : client secret' },
    de: { nome: 'Gmail', descrizione: 'E-Mails an Kunden aus deinem Gmail- oder Google-Workspace-Postfach: Nachrichten, Rechnungen und Angebote im Anhang.', 'imp.client_id': 'Google: OAuth-Client-ID', 'imp.client_secret': 'Google: Client-Secret' },
    pt: { nome: 'Gmail', descrizione: 'Email aos clientes a partir da sua caixa Gmail ou Google Workspace: mensagens, faturas e orçamentos em anexo.', 'imp.client_id': 'Google: client ID OAuth', 'imp.client_secret': 'Google: client secret' },
  },
});
