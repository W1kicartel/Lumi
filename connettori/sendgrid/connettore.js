// SendGrid (Twilio): email transazionali ai clienti, fatture e preventivi in allegato. POST /v3/mail/send con la chiave
// API come Bearer; risponde 202 e l'id del messaggio è nell'intestazione X-Message-Id. Regione UE: api.eu.sendgrid.com.
import { connettoreEmail } from '../_comunica/email.js';
const base = k => k.base || (k.imp.regione === 'ue' ? 'https://api.eu.sendgrid.com' : 'https://api.sendgrid.com');
export default connettoreEmail({
  id: 'sendgrid', nome: 'SendGrid', descrizione: 'Email ai clienti con SendGrid: messaggi, fatture e preventivi in allegato.',
  impostazioni: [{ id: 'chiave', nome: 'Chiave API (SG.…)', segreto: true, schema: /^SG\.[\w-]{10,}\.[\w-]{10,}$/ }, { id: 'regione', nome: 'Regione dei dati', tipo: 'scelta', opzioni: ['globale', 'ue'], predefinito: 'globale' }],
  prova: async k => { const r = await k.http.get(`${base(k)}/v3/scopes`, { bearer: k.segreti.chiave }); const ok = r.ok && (r.json?.scopes || []).includes('mail.send');
    return { ok, messaggio: r.ok ? (ok ? 'mail.send' : 'La chiave non ha il permesso Mail Send') : `HTTP ${r.stato}` }; },
  async invia(k, m) {
    const r = await k.http.post(`${base(k)}/v3/mail/send`, { bearer: k.segreti.chiave, json: {
      personalizations: [{ to: [{ email: m.a, ...(m.aNome ? { name: m.aNome } : {}) }] }], from: { email: m.da, ...(m.daNome ? { name: m.daNome } : {}) }, ...(m.rispondi ? { reply_to: { email: m.rispondi } } : {}),
      subject: m.oggetto, content: [{ type: 'text/plain', value: m.testo }, { type: 'text/html', value: m.html }],
      ...(m.allegati.length ? { attachments: m.allegati.map(x => ({ content: x.contenuto.toString('base64'), filename: x.nome, type: x.tipo.split(';')[0], disposition: 'attachment' })) } : {}) } });
    if (!r.ok) throw new Error(`SendGrid: ${r.json?.errors?.[0]?.message || `HTTP ${r.stato}`}`);
    return { id: r.intestazioni['x-message-id'] || null };
  },
  catalogo: {
    categoria: 'email', sito: 'https://sendgrid.com', costo: 'abbonamento',
    costoNota: 'Prova gratuita di 60 giorni (100 email al giorno), poi piani Email API da circa 19,95 $ al mese (Essentials, 50.000 email).',
    serve: [{ cosa: 'Una chiave API con il permesso «Mail Send» (SG.…)', dove: 'app.sendgrid.com → Settings → API Keys → Create API Key → Restricted Access → Mail Send: Full Access', link: 'https://app.sendgrid.com/settings/api_keys' },
      { cosa: 'Un mittente verificato o il dominio autenticato', dove: 'Settings → Sender Authentication', link: 'https://app.sendgrid.com/settings/sender_auth' }],
    passi: ['Crea un account su sendgrid.com', 'Autentica il dominio (Settings → Sender Authentication) o verifica almeno un mittente', 'Crea una chiave API con Mail Send e incollala qui', 'Scrivi l\'email del mittente (dello stesso dominio)', 'Se l\'account è nella regione UE, scegli «ue»', 'Accendi e prova: «Manda un\'email» nella scheda di un cliente'],
    difficolta: 'media', zone: ['mondo', 'UE'],
    fonti: ['https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send', 'https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys', 'https://sendgrid.com/en-us/pricing'],
    prova: 'finto', parole: ['sendgrid', 'twilio', 'email', 'transazionale', 'fatture via email', 'transactional email', 'smtp api'],
  },
  testi: {
    en: { nome: 'SendGrid', descrizione: 'Email customers with SendGrid: messages, invoices and quotes attached.', 'imp.chiave': 'API key (SG.…)', 'imp.regione': 'Data region',
      'cat.costoNota': '60-day free trial (100 emails a day), then Email API plans from about $19.95 a month (Essentials, 50,000 emails).',
      'cat.serve': [{ cosa: 'An API key with «Mail Send» permission (SG.…)', dove: 'app.sendgrid.com → Settings → API Keys → Create API Key → Restricted Access → Mail Send: Full Access' }, { cosa: 'A verified sender or authenticated domain', dove: 'Settings → Sender Authentication' }],
      'cat.passi': ['Create an account on sendgrid.com', 'Authenticate the domain (Settings → Sender Authentication) or verify at least one sender', 'Create an API key with Mail Send and paste it here', 'Write the sender email (same domain)', 'If the account is in the EU region, pick «ue»', 'Turn on and try: «Send an email» in a customer record'] },
    es: { nome: 'SendGrid', descrizione: 'Email a los clientes con SendGrid: mensajes, facturas y presupuestos adjuntos.', 'imp.chiave': 'Clave API (SG.…)', 'imp.regione': 'Región de los datos' },
    fr: { nome: 'SendGrid', descrizione: 'E-mails aux clients avec SendGrid : messages, factures et devis en pièce jointe.', 'imp.chiave': 'Clé API (SG.…)', 'imp.regione': 'Région des données' },
    de: { nome: 'SendGrid', descrizione: 'E-Mails an Kunden mit SendGrid: Nachrichten, Rechnungen und Angebote im Anhang.', 'imp.chiave': 'API-Schlüssel (SG.…)', 'imp.regione': 'Datenregion' },
    pt: { nome: 'SendGrid', descrizione: 'Email aos clientes com o SendGrid: mensagens, faturas e orçamentos em anexo.', 'imp.chiave': 'Chave API (SG.…)', 'imp.regione': 'Região dos dados' },
  },
});
