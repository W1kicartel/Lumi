// Postmark: email transazionali ai clienti, fatture e preventivi in allegato. POST /email con X-Postmark-Server-Token;
// il flusso dei messaggi (Message Stream) predefinito è «outbound».
import { connettoreEmail, indirizzo } from '../_comunica/email.js';
const base = k => k.base || 'https://api.postmarkapp.com';
const h = k => ({ 'X-Postmark-Server-Token': k.segreti.token });
export default connettoreEmail({
  id: 'postmark', nome: 'Postmark', descrizione: 'Email ai clienti con Postmark: messaggi, fatture e preventivi in allegato.',
  impostazioni: [{ id: 'token', nome: 'Server API Token', segreto: true, schema: /^[0-9a-f-]{36}$/i }, { id: 'stream', nome: 'Message Stream', predefinito: 'outbound' }],
  prova: async k => { const r = await k.http.get(`${base(k)}/server`, { intestazioni: h(k) }); return { ok: r.ok, messaggio: r.ok ? r.json?.Name : `HTTP ${r.stato}` }; },
  async invia(k, m) {
    const r = await k.http.post(`${base(k)}/email`, { intestazioni: h(k), json: { From: indirizzo(m.da, m.daNome), To: indirizzo(m.a, m.aNome), ...(m.rispondi ? { ReplyTo: m.rispondi } : {}),
      Subject: m.oggetto, TextBody: m.testo, HtmlBody: m.html, MessageStream: k.imp.stream || 'outbound',
      ...(m.allegati.length ? { Attachments: m.allegati.map(x => ({ Name: x.nome, Content: x.contenuto.toString('base64'), ContentType: x.tipo.split(';')[0] })) } : {}) } });
    if (!r.ok || r.json?.ErrorCode) throw new Error(`Postmark: ${r.json?.Message || `HTTP ${r.stato}`}`);
    return { id: r.json?.MessageID };
  },
  catalogo: {
    categoria: 'email', sito: 'https://postmarkapp.com', costo: 'abbonamento',
    costoNota: 'Gratis fino a 100 email al mese (per provare); piani da 15 $ al mese per 10.000 email.',
    serve: [{ cosa: 'Il Server API Token', dove: 'account.postmarkapp.com → Servers → il tuo server → API Tokens', link: 'https://account.postmarkapp.com/servers' },
      { cosa: 'Una Sender Signature o il dominio verificato', dove: 'Sender Signatures → Add Domain or Signature', link: 'https://account.postmarkapp.com/signature_domains' }],
    passi: ['Crea un account su postmarkapp.com (l\'account va approvato prima di scrivere a indirizzi esterni)', 'Verifica il dominio o l\'email del mittente in Sender Signatures', 'Apri il server, scheda API Tokens, copia il token e incollalo qui', 'Scrivi l\'email del mittente', 'Accendi e premi «Prova»: mostra il nome del server'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://postmarkapp.com/developer/api/email-api', 'https://postmarkapp.com/developer/api/overview#authentication', 'https://postmarkapp.com/pricing'],
    prova: 'finto', parole: ['postmark', 'email', 'transazionale', 'fatture via email', 'transactional email'],
  },
  testi: {
    en: { nome: 'Postmark', descrizione: 'Email customers with Postmark: messages, invoices and quotes attached.', 'imp.token': 'Server API Token', 'imp.stream': 'Message Stream',
      'cat.costoNota': 'Free up to 100 emails a month (for testing); plans from $15 a month for 10,000 emails.',
      'cat.serve': [{ cosa: 'The Server API Token', dove: 'account.postmarkapp.com → Servers → your server → API Tokens' }, { cosa: 'A Sender Signature or verified domain', dove: 'Sender Signatures → Add Domain or Signature' }],
      'cat.passi': ['Create an account on postmarkapp.com (it must be approved before writing to outside addresses)', 'Verify the domain or the sender email in Sender Signatures', 'Open the server, API Tokens tab, copy the token and paste it here', 'Write the sender email', 'Turn on and press «Test»: it shows the server name'] },
    es: { nome: 'Postmark', descrizione: 'Email a los clientes con Postmark: mensajes, facturas y presupuestos adjuntos.', 'imp.token': 'Server API Token', 'imp.stream': 'Message Stream' },
    fr: { nome: 'Postmark', descrizione: 'E-mails aux clients avec Postmark : messages, factures et devis en pièce jointe.', 'imp.token': 'Server API Token', 'imp.stream': 'Message Stream' },
    de: { nome: 'Postmark', descrizione: 'E-Mails an Kunden mit Postmark: Nachrichten, Rechnungen und Angebote im Anhang.', 'imp.token': 'Server API Token', 'imp.stream': 'Message Stream' },
    pt: { nome: 'Postmark', descrizione: 'Email aos clientes com o Postmark: mensagens, faturas e orçamentos em anexo.', 'imp.token': 'Server API Token', 'imp.stream': 'Message Stream' },
  },
});
