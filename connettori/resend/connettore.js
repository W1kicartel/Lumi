// Resend: email transazionali ai clienti, fatture e preventivi in allegato. POST /emails con la chiave come Bearer.
// Una chiave «Sending access» non può leggere i domini: la prova lo dice invece di fallire.
import { connettoreEmail, indirizzo } from '../_comunica/email.js';
const base = k => k.base || 'https://api.resend.com';
export default connettoreEmail({
  id: 'resend', nome: 'Resend', descrizione: 'Email ai clienti con Resend: messaggi, fatture e preventivi in allegato.',
  impostazioni: [{ id: 'chiave', nome: 'Chiave API (re_…)', segreto: true, schema: /^re_[\w]{8,}$/ }],
  prova: async k => {
    const r = await k.http.get(`${base(k)}/domains`, { bearer: k.segreti.chiave });
    if (r.stato === 401 && r.json?.name === 'restricted_api_key') return { ok: true, messaggio: 'Chiave di solo invio' };
    return { ok: r.ok, messaggio: r.ok ? (r.json?.data || []).map(d => `${d.name} (${d.status})`).join(', ') : `HTTP ${r.stato}` };
  },
  async invia(k, m) {
    const r = await k.http.post(`${base(k)}/emails`, { bearer: k.segreti.chiave, json: { from: indirizzo(m.da, m.daNome), to: [m.a], subject: m.oggetto, text: m.testo, html: m.html, ...(m.rispondi ? { reply_to: m.rispondi } : {}),
      ...(m.allegati.length ? { attachments: m.allegati.map(x => ({ filename: x.nome, content: x.contenuto.toString('base64'), content_type: x.tipo.split(';')[0] })) } : {}) } });
    if (!r.ok) throw new Error(`Resend: ${r.json?.message || `HTTP ${r.stato}`}`);
    return { id: r.json?.id };
  },
  catalogo: {
    categoria: 'email', sito: 'https://resend.com', costo: 'gratis',
    costoNota: 'Piano Free: 3.000 email al mese (100 al giorno), un dominio. Pro da 20 $ al mese per 50.000 email.',
    serve: [{ cosa: 'Una chiave API (re_…)', dove: 'resend.com → API Keys → Create API Key (permesso «Sending access» basta)', link: 'https://resend.com/api-keys' },
      { cosa: 'Il dominio del mittente verificato', dove: 'resend.com → Domains → Add Domain (record DNS SPF e DKIM)', link: 'https://resend.com/domains' }],
    passi: ['Crea un account su resend.com', 'Aggiungi il tuo dominio in Domains e copia i record DNS dal pannello del tuo provider (Aruba, Register.it…)', 'Quando il dominio è «Verified», crea una chiave API e incollala qui', 'Scrivi l\'email del mittente (es. fatture@tuodominio.it)', 'Accendi e prova: «Manda la fattura per email» in una fattura emessa'],
    difficolta: 'media', zone: ['mondo', 'UE'],
    fonti: ['https://resend.com/docs/api-reference/emails/send-email', 'https://resend.com/docs/api-reference/domains/list-domains', 'https://resend.com/pricing'],
    prova: 'finto', parole: ['resend', 'email', 'transazionale', 'fatture via email', 'transactional email'],
  },
  testi: {
    en: { nome: 'Resend', descrizione: 'Email customers with Resend: messages, invoices and quotes attached.', 'imp.chiave': 'API key (re_…)',
      'cat.costoNota': 'Free plan: 3,000 emails a month (100 a day), one domain. Pro from $20 a month for 50,000 emails.',
      'cat.serve': [{ cosa: 'An API key (re_…)', dove: 'resend.com → API Keys → Create API Key («Sending access» is enough)' }, { cosa: 'The verified sender domain', dove: 'resend.com → Domains → Add Domain (SPF and DKIM DNS records)' }],
      'cat.passi': ['Create an account on resend.com', 'Add your domain in Domains and copy the DNS records into your DNS provider', 'When the domain is «Verified», create an API key and paste it here', 'Write the sender email', 'Turn on and try: «Email the invoice» on an issued invoice'] },
    es: { nome: 'Resend', descrizione: 'Email a los clientes con Resend: mensajes, facturas y presupuestos adjuntos.', 'imp.chiave': 'Clave API (re_…)' },
    fr: { nome: 'Resend', descrizione: 'E-mails aux clients avec Resend : messages, factures et devis en pièce jointe.', 'imp.chiave': 'Clé API (re_…)' },
    de: { nome: 'Resend', descrizione: 'E-Mails an Kunden mit Resend: Nachrichten, Rechnungen und Angebote im Anhang.', 'imp.chiave': 'API-Schlüssel (re_…)' },
    pt: { nome: 'Resend', descrizione: 'Email aos clientes com o Resend: mensagens, faturas e orçamentos em anexo.', 'imp.chiave': 'Chave API (re_…)' },
  },
});
