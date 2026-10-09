// MailerSend (degli autori di MailerLite, azienda UE): email transazionali ai clienti, fatture e preventivi in allegato.
// POST /v1/email con il token come Bearer; risponde 202 con l'id nell'intestazione X-Message-Id.
import { connettoreEmail } from '../_comunica/email.js';
const base = k => k.base || 'https://api.mailersend.com';
export default connettoreEmail({
  id: 'mailersend', nome: 'MailerSend', descrizione: 'Email ai clienti con MailerSend: messaggi, fatture e preventivi in allegato.',
  impostazioni: [{ id: 'token', nome: 'Token API (mlsn.…)', segreto: true }],
  prova: async k => { const r = await k.http.get(`${base(k)}/v1/domains`, { bearer: k.segreti.token }); return { ok: r.ok, messaggio: r.ok ? (r.json?.data || []).map(d => `${d.name}${d.is_verified ? '' : ' (da verificare)'}`).join(', ') : `HTTP ${r.stato}` }; },
  async invia(k, m) {
    const r = await k.http.post(`${base(k)}/v1/email`, { bearer: k.segreti.token, json: { from: { email: m.da, ...(m.daNome ? { name: m.daNome } : {}) }, to: [{ email: m.a, ...(m.aNome ? { name: m.aNome } : {}) }],
      ...(m.rispondi ? { reply_to: { email: m.rispondi } } : {}), subject: m.oggetto, text: m.testo, html: m.html,
      ...(m.allegati.length ? { attachments: m.allegati.map(x => ({ content: x.contenuto.toString('base64'), filename: x.nome, disposition: 'attachment' })) } : {}) } });
    if (!r.ok) throw new Error(`MailerSend: ${r.json?.message || `HTTP ${r.stato}`}`);
    return { id: r.intestazioni['x-message-id'] || null };
  },
  catalogo: {
    categoria: 'email', sito: 'https://www.mailersend.com', costo: 'gratis',
    costoNota: 'Piano Free: 500 email al mese. Hobby da 7 $ al mese (5,60 $ con pagamento annuale).',
    serve: [{ cosa: 'Un token API con il permesso «Email: accesso completo»', dove: 'app.mailersend.com → Integrations → API tokens → Manage → Generate new token', link: 'https://app.mailersend.com/api-tokens' },
      { cosa: 'Il dominio del mittente verificato', dove: 'Domains → Add domain (record SPF, DKIM e Return-Path)', link: 'https://app.mailersend.com/domains' }],
    passi: ['Crea un account su mailersend.com', 'Aggiungi e verifica il tuo dominio (record DNS)', 'Genera un token API con l\'accesso alle email e incollalo qui', 'Scrivi l\'email del mittente (dello stesso dominio)', 'Accendi e premi «Prova»: mostra i domini e se sono verificati'],
    difficolta: 'media', zone: ['UE', 'mondo'],
    fonti: ['https://developers.mailersend.com/api/v1/email.html#send-an-email', 'https://developers.mailersend.com/api/v1/domains.html', 'https://www.mailersend.com/pricing'],
    prova: 'finto', parole: ['mailersend', 'mailerlite', 'email', 'transazionale', 'fatture via email', 'transactional email'],
  },
  testi: {
    en: { nome: 'MailerSend', descrizione: 'Email customers with MailerSend: messages, invoices and quotes attached.', 'imp.token': 'API token (mlsn.…)',
      'cat.costoNota': 'Free plan: 500 emails a month. Hobby from $7 a month ($5.60 billed yearly).',
      'cat.serve': [{ cosa: 'An API token with «Email: full access»', dove: 'app.mailersend.com → Integrations → API tokens → Manage → Generate new token' }, { cosa: 'The verified sender domain', dove: 'Domains → Add domain (SPF, DKIM and Return-Path records)' }],
      'cat.passi': ['Create an account on mailersend.com', 'Add and verify your domain (DNS records)', 'Generate an API token with email access and paste it here', 'Write the sender email (same domain)', 'Turn on and press «Test»: it shows the domains and whether they are verified'] },
    es: { nome: 'MailerSend', descrizione: 'Email a los clientes con MailerSend: mensajes, facturas y presupuestos adjuntos.', 'imp.token': 'Token API (mlsn.…)' },
    fr: { nome: 'MailerSend', descrizione: 'E-mails aux clients avec MailerSend : messages, factures et devis en pièce jointe.', 'imp.token': 'Jeton API (mlsn.…)' },
    de: { nome: 'MailerSend', descrizione: 'E-Mails an Kunden mit MailerSend: Nachrichten, Rechnungen und Angebote im Anhang.', 'imp.token': 'API-Token (mlsn.…)' },
    pt: { nome: 'MailerSend', descrizione: 'Email aos clientes com o MailerSend: mensagens, faturas e orçamentos em anexo.', 'imp.token': 'Token API (mlsn.…)' },
  },
});
