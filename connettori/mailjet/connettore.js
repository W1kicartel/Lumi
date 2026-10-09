// Mailjet (Sinch, azienda francese, dati nell'UE): email transazionali ai clienti, fatture e preventivi in allegato.
// POST /v3.1/send con Basic (chiave API e chiave segreta).
import { connettoreEmail } from '../_comunica/email.js';
const base = k => k.base || 'https://api.mailjet.com';
const auth = k => ({ basic: [k.imp.chiave, k.segreti.segreto] });
export default connettoreEmail({
  id: 'mailjet', nome: 'Mailjet', descrizione: 'Email ai clienti con Mailjet (dati nell\'UE): messaggi, fatture e preventivi in allegato.',
  impostazioni: [{ id: 'chiave', nome: 'API Key', schema: /^[0-9a-f]{32}$/i }, { id: 'segreto', nome: 'Secret Key', segreto: true, schema: /^[0-9a-f]{32}$/i }],
  prova: async k => { const r = await k.http.get(`${base(k)}/v3/REST/sender?Limit=10`, auth(k)); return { ok: r.ok, messaggio: r.ok ? (r.json?.Data || []).map(s => `${s.Email} (${s.Status})`).join(', ') || 'nessun mittente' : `HTTP ${r.stato}` }; },
  async invia(k, m) {
    const r = await k.http.post(`${base(k)}/v3.1/send`, { ...auth(k), json: { Messages: [{ From: { Email: m.da, ...(m.daNome ? { Name: m.daNome } : {}) }, To: [{ Email: m.a, ...(m.aNome ? { Name: m.aNome } : {}) }],
      ...(m.rispondi ? { ReplyTo: { Email: m.rispondi } } : {}), Subject: m.oggetto, TextPart: m.testo, HTMLPart: m.html,
      ...(m.allegati.length ? { Attachments: m.allegati.map(x => ({ ContentType: x.tipo.split(';')[0], Filename: x.nome, Base64Content: x.contenuto.toString('base64') })) } : {}) }] } });
    const x = r.json?.Messages?.[0];
    if (!r.ok || x?.Status !== 'success') throw new Error(`Mailjet: ${x?.Errors?.[0]?.ErrorMessage || r.json?.ErrorMessage || `HTTP ${r.stato}`}`);
    return { id: x.To?.[0]?.MessageUUID || null };
  },
  catalogo: {
    categoria: 'email', sito: 'https://www.mailjet.com/it/', costo: 'gratis',
    costoNota: 'Piano Free: 6.000 email al mese (200 al giorno). Essential da 19 $ al mese per 15.000 email, senza limite giornaliero.',
    serve: [{ cosa: 'API Key e Secret Key', dove: 'app.mailjet.com → Impostazioni account → REST API → Gestione chiavi API (Principale o secondaria)', link: 'https://app.mailjet.com/account/apikeys' },
      { cosa: 'Un mittente o un dominio verificati', dove: 'Impostazioni account → Aggiungi un dominio o un indirizzo mittente', link: 'https://app.mailjet.com/account/sender' }],
    passi: ['Crea un account su mailjet.com', 'Verifica l\'indirizzo del mittente o, meglio, il dominio (record SPF e DKIM)', 'Copia API Key e Secret Key e incollale qui', 'Scrivi l\'email del mittente verificato', 'Accendi e premi «Prova»: mostra i mittenti e il loro stato'],
    difficolta: 'facile', zone: ['UE', 'mondo'],
    fonti: ['https://dev.mailjet.com/email/guides/send-api-v31/', 'https://dev.mailjet.com/email/reference/send-emails/', 'https://dev.mailjet.com/email/reference/sender-addresses-and-domains/sender/', 'https://www.mailjet.com/pricing/'],
    prova: 'finto', parole: ['mailjet', 'sinch', 'email', 'transazionale', 'newsletter', 'fatture via email', 'transactional email'],
  },
  testi: {
    en: { nome: 'Mailjet', descrizione: 'Email customers with Mailjet (data in the EU): messages, invoices and quotes attached.', 'imp.chiave': 'API Key', 'imp.segreto': 'Secret Key',
      'cat.costoNota': 'Free plan: 6,000 emails a month (200 a day). Essential from $19 a month for 15,000 emails, no daily limit.',
      'cat.serve': [{ cosa: 'API Key and Secret Key', dove: 'app.mailjet.com → Account settings → REST API → API key management' }, { cosa: 'A verified sender or domain', dove: 'Account settings → Add a sender domain or address' }],
      'cat.passi': ['Create an account on mailjet.com', 'Verify the sender address or, better, the domain (SPF and DKIM records)', 'Copy API Key and Secret Key and paste them here', 'Write the verified sender email', 'Turn on and press «Test»: it shows the senders and their status'] },
    es: { nome: 'Mailjet', descrizione: 'Email a los clientes con Mailjet (datos en la UE): mensajes, facturas y presupuestos adjuntos.', 'imp.chiave': 'API Key', 'imp.segreto': 'Secret Key' },
    fr: { nome: 'Mailjet', descrizione: 'E-mails aux clients avec Mailjet (données dans l\'UE) : messages, factures et devis en pièce jointe.', 'imp.chiave': 'API Key', 'imp.segreto': 'Secret Key' },
    de: { nome: 'Mailjet', descrizione: 'E-Mails an Kunden mit Mailjet (Daten in der EU): Nachrichten, Rechnungen und Angebote im Anhang.', 'imp.chiave': 'API Key', 'imp.segreto': 'Secret Key' },
    pt: { nome: 'Mailjet', descrizione: 'Email aos clientes com o Mailjet (dados na UE): mensagens, faturas e orçamentos em anexo.', 'imp.chiave': 'API Key', 'imp.segreto': 'Secret Key' },
  },
});
