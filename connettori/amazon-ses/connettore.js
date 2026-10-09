// Amazon SES (API v2): email transazionali ai clienti, fatture e preventivi in allegato. POST /v2/email/outbound-emails
// con il messaggio MIME intero (Raw: così gli allegati vanno sempre), firmato con AWS Signature V4 (servizio «ses»).
import { connettoreEmail } from '../_comunica/email.js';
import { firmaV4 } from '../_comunica/sigv4.js';
import { messaggio } from '../posta/smtp.js';
import { indirizzo } from '../_comunica/email.js';
const url = (k, via) => `${k.base || `https://email.${k.imp.regione || 'eu-south-1'}.amazonaws.com`}${via}`;
async function chiama(k, metodo, via, json) {
  const u = url(k, via), corpo = json ? JSON.stringify(json) : '', h = json ? { 'Content-Type': 'application/json' } : {};
  const f = firmaV4({ metodo, url: u, intestazioni: h, corpo, regione: k.imp.regione || 'eu-south-1', servizio: 'ses', chiave: k.imp.chiave_accesso, segreto: k.segreti.segreto });
  const r = await k.http.richiesta(metodo, u, { ...(json ? { testo: corpo } : {}), intestazioni: { ...h, ...f } });
  if (!r.ok) throw new Error(`Amazon SES: ${r.json?.message || r.json?.Message || `HTTP ${r.stato}`}`);
  return r.json || {};
}
export default connettoreEmail({
  id: 'amazon-ses', nome: 'Amazon SES', descrizione: 'Email ai clienti con Amazon SES: messaggi, fatture e preventivi in allegato, a pochi centesimi.',
  impostazioni: [{ id: 'chiave_accesso', nome: 'Access key ID (AKIA…)', schema: /^(AKIA|ASIA)[A-Z0-9]{16}$/ }, { id: 'segreto', nome: 'Secret access key', segreto: true },
    { id: 'regione', nome: 'Regione AWS (es. eu-south-1 Milano, eu-west-1 Irlanda)', predefinito: 'eu-south-1', schema: /^[a-z]{2}(-[a-z]+)+-\d$/ }],
  prova: async k => { const a = await chiama(k, 'GET', '/v2/email/account'); return { ok: true, messaggio: `${a.ProductionAccessEnabled ? 'produzione' : 'sandbox: solo indirizzi verificati'} · invio ${a.SendingEnabled ? 'attivo' : 'fermo'}` }; },
  async invia(k, m) {
    let mime = messaggio({ da: indirizzo(m.da, m.daNome), a: m.a, oggetto: m.oggetto, testo: m.testo, allegati: m.allegati }).replace(/^\.\./gm, '.');   // niente punti raddoppiati: non è SMTP
    if (m.rispondi) mime = `Reply-To: ${m.rispondi}\r\n${mime}`;
    const x = await chiama(k, 'POST', '/v2/email/outbound-emails', { Content: { Raw: { Data: Buffer.from(mime, 'utf8').toString('base64') } } });
    return { id: x.MessageId };
  },
  catalogo: {
    categoria: 'email', sito: 'https://aws.amazon.com/ses/', costo: 'a-consumo',
    costoNota: '0,10 $ ogni 1.000 email (più 0,12 $ per GB di allegati). Per i primi 12 mesi, 3.000 email al mese gratis. All\'inizio l\'account è in «sandbox»: si scrive solo a indirizzi verificati finché non chiedi l\'accesso di produzione.',
    serve: [{ cosa: 'Access key ID e Secret access key di un utente IAM con il permesso ses:SendRawEmail (e ses:GetAccount per la prova)', dove: 'Console AWS → IAM → Users → Create user → Attach policies (AmazonSESFullAccess o una policy su misura) → Security credentials → Create access key', link: 'https://console.aws.amazon.com/iam/home#/users' },
      { cosa: 'Il dominio o l\'email del mittente verificati in SES, e l\'accesso di produzione', dove: 'Console AWS → Amazon SES → Configuration → Identities → Create identity; poi Account dashboard → Request production access', link: 'https://console.aws.amazon.com/ses/home' }],
    passi: ['Nella console AWS scegli la regione (es. Europa – Milano, eu-south-1) e apri Amazon SES', 'Crea un\'identità per il tuo dominio e aggiungi i record DKIM al DNS', 'Chiedi l\'accesso di produzione (Account dashboard), altrimenti scrivi solo a indirizzi verificati', 'In IAM crea un utente con il permesso di inviare (ses:SendRawEmail) e una chiave di accesso', 'Incolla qui Access key ID, Secret e la regione, e l\'email del mittente', 'Accendi e premi «Prova»: dice se sei in sandbox o in produzione'],
    difficolta: 'difficile', zone: ['mondo', 'UE'],
    fonti: ['https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html', 'https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetAccount.html', 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html', 'https://aws.amazon.com/ses/pricing/'],
    prova: 'finto', parole: ['amazon', 'aws', 'ses', 'email', 'transazionale', 'fatture via email', 'transactional email'],
  },
  testi: {
    en: { nome: 'Amazon SES', descrizione: 'Email customers with Amazon SES: messages, invoices and quotes attached, for a few cents.', 'imp.chiave_accesso': 'Access key ID (AKIA…)', 'imp.segreto': 'Secret access key', 'imp.regione': 'AWS region (e.g. eu-south-1 Milan, eu-west-1 Ireland)',
      'cat.costoNota': '$0.10 per 1,000 emails (plus $0.12 per GB of attachments). 3,000 emails a month free for the first 12 months. New accounts start in «sandbox»: you can only write to verified addresses until you request production access.',
      'cat.serve': [{ cosa: 'Access key ID and Secret access key of an IAM user allowed ses:SendRawEmail (and ses:GetAccount for the test)', dove: 'AWS console → IAM → Users → Create user → Attach policies → Security credentials → Create access key' }, { cosa: 'The sender domain or email verified in SES, and production access', dove: 'AWS console → Amazon SES → Configuration → Identities → Create identity; then Account dashboard → Request production access' }],
      'cat.passi': ['In the AWS console pick the region and open Amazon SES', 'Create an identity for your domain and add the DKIM records to DNS', 'Request production access (Account dashboard), otherwise you can only write to verified addresses', 'In IAM create a user allowed to send (ses:SendRawEmail) and an access key', 'Paste Access key ID, Secret and region here, and the sender email', 'Turn on and press «Test»: it says if you are in sandbox or production'] },
    es: { nome: 'Amazon SES', descrizione: 'Email a los clientes con Amazon SES: mensajes, facturas y presupuestos adjuntos, por pocos céntimos.', 'imp.chiave_accesso': 'Access key ID (AKIA…)', 'imp.segreto': 'Secret access key', 'imp.regione': 'Región AWS (p. ej. eu-south-2 España, eu-west-1 Irlanda)' },
    fr: { nome: 'Amazon SES', descrizione: 'E-mails aux clients avec Amazon SES : messages, factures et devis en pièce jointe, pour quelques centimes.', 'imp.chiave_accesso': 'Access key ID (AKIA…)', 'imp.segreto': 'Secret access key', 'imp.regione': 'Région AWS (ex. eu-west-3 Paris, eu-west-1 Irlande)' },
    de: { nome: 'Amazon SES', descrizione: 'E-Mails an Kunden mit Amazon SES: Nachrichten, Rechnungen und Angebote im Anhang, für wenige Cent.', 'imp.chiave_accesso': 'Access key ID (AKIA…)', 'imp.segreto': 'Secret access key', 'imp.regione': 'AWS-Region (z. B. eu-central-1 Frankfurt, eu-west-1 Irland)' },
    pt: { nome: 'Amazon SES', descrizione: 'Email aos clientes com o Amazon SES: mensagens, faturas e orçamentos em anexo, por poucos cêntimos.', 'imp.chiave_accesso': 'Access key ID (AKIA…)', 'imp.segreto': 'Secret access key', 'imp.regione': 'Região AWS (ex. eu-west-1 Irlanda, sa-east-1 São Paulo)' },
  },
});
