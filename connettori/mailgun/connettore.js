// Mailgun: email transazionali ai clienti, fatture e preventivi in allegato. POST /v3/<dominio>/messages in
// multipart/form-data (gli allegati sono file), Basic con «api» e la chiave. Regione UE: api.eu.mailgun.net.
import { randomBytes } from 'node:crypto';
import { connettoreEmail, indirizzo } from '../_comunica/email.js';
const base = k => k.base || (k.imp.regione === 'ue' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net');
const auth = k => ({ basic: ['api', k.segreti.chiave] });
const q = s => String(s).replace(/["\r\n]/g, '_');
export function multipart(campi, file = []) {
  const conf = `kubo${randomBytes(12).toString('hex')}`, parti = [];
  for (const [n, v] of campi) if (v != null) parti.push(Buffer.from(`--${conf}\r\nContent-Disposition: form-data; name="${q(n)}"\r\n\r\n${v}\r\n`, 'utf8'));
  for (const f of file) parti.push(Buffer.from(`--${conf}\r\nContent-Disposition: form-data; name="attachment"; filename="${q(f.nome)}"\r\nContent-Type: ${f.tipo}\r\n\r\n`, 'utf8'), f.contenuto, Buffer.from('\r\n'));
  parti.push(Buffer.from(`--${conf}--\r\n`));
  return { corpo: Buffer.concat(parti), tipo: `multipart/form-data; boundary=${conf}` };
}
export default connettoreEmail({
  id: 'mailgun', nome: 'Mailgun', descrizione: 'Email ai clienti con Mailgun: messaggi, fatture e preventivi in allegato.',
  impostazioni: [{ id: 'chiave', nome: 'Chiave API privata (o Sending API key del dominio)', segreto: true }, { id: 'dominio', nome: 'Dominio di invio (es. mg.tuodominio.it)', schema: /^[a-z0-9.-]+\.[a-z]{2,}$/i },
    { id: 'regione', nome: 'Regione', tipo: 'scelta', opzioni: ['us', 'ue'], predefinito: 'ue' }],
  prova: async k => { const r = await k.http.get(`${base(k)}/v3/domains/${encodeURIComponent(k.imp.dominio)}`, auth(k)); return { ok: r.ok, messaggio: r.ok ? `${r.json?.domain?.name} (${r.json?.domain?.state})` : `HTTP ${r.stato}` }; },
  async invia(k, m) {
    const { corpo, tipo } = multipart([['from', indirizzo(m.da, m.daNome)], ['to', indirizzo(m.a, m.aNome)], ['subject', m.oggetto], ['text', m.testo], ['html', m.html], ['h:Reply-To', m.rispondi]], m.allegati);
    const r = await k.http.post(`${base(k)}/v3/${encodeURIComponent(k.imp.dominio)}/messages`, { ...auth(k), testo: corpo, intestazioni: { 'Content-Type': tipo } });
    if (!r.ok) throw new Error(`Mailgun: ${r.json?.message || `HTTP ${r.stato}`}`);
    return { id: r.json?.id };
  },
  catalogo: {
    categoria: 'email', sito: 'https://www.mailgun.com', costo: 'abbonamento',
    costoNota: 'Piano Free: 100 email al giorno (un dominio personalizzato). Basic da 15 $ al mese per 10.000 email. Regione UE disponibile (dati in Germania).',
    serve: [{ cosa: 'La chiave API (Private API key, o una Sending API key del dominio)', dove: 'app.mailgun.com → Settings (ingranaggio) → API Security → Add new key, oppure Sending → Domain settings → Sending API keys', link: 'https://app.mailgun.com/settings/api_security' },
      { cosa: 'Il dominio di invio verificato', dove: 'Sending → Domains → Add new domain (record DNS SPF, DKIM, MX)', link: 'https://app.mailgun.com/mg/sending/domains' }],
    passi: ['Crea un account su mailgun.com scegliendo la regione UE se lavori in Italia', 'Aggiungi un dominio di invio (es. mg.tuodominio.it) e copia i record DNS dal tuo provider', 'Crea una chiave API e incollala qui con il dominio', 'Scegli la regione uguale a quella dell\'account', 'Scrivi l\'email del mittente (es. fatture@mg.tuodominio.it)', 'Accendi e premi «Prova»: mostra lo stato del dominio'],
    difficolta: 'media', zone: ['mondo', 'UE'],
    fonti: ['https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages', 'https://documentation.mailgun.com/docs/mailgun/api-reference/authentication', 'https://www.mailgun.com/pricing/'],
    prova: 'finto', parole: ['mailgun', 'sinch', 'email', 'transazionale', 'fatture via email', 'transactional email'],
  },
  testi: {
    en: { nome: 'Mailgun', descrizione: 'Email customers with Mailgun: messages, invoices and quotes attached.', 'imp.chiave': 'Private API key (or the domain Sending API key)', 'imp.dominio': 'Sending domain (e.g. mg.yourdomain.com)', 'imp.regione': 'Region',
      'cat.costoNota': 'Free plan: 100 emails a day (one custom domain). Basic from $15 a month for 10,000 emails. EU region available (data in Germany).',
      'cat.serve': [{ cosa: 'The API key (Private API key, or a domain Sending API key)', dove: 'app.mailgun.com → Settings → API Security → Add new key, or Sending → Domain settings → Sending API keys' }, { cosa: 'The verified sending domain', dove: 'Sending → Domains → Add new domain (SPF, DKIM, MX DNS records)' }],
      'cat.passi': ['Create an account on mailgun.com, choosing the EU region if you work in Europe', 'Add a sending domain and copy the DNS records into your provider', 'Create an API key and paste it here with the domain', 'Pick the same region as the account', 'Write the sender email', 'Turn on and press «Test»: it shows the domain state'] },
    es: { nome: 'Mailgun', descrizione: 'Email a los clientes con Mailgun: mensajes, facturas y presupuestos adjuntos.', 'imp.chiave': 'Clave API privada (o Sending API key del dominio)', 'imp.dominio': 'Dominio de envío (p. ej. mg.tudominio.es)', 'imp.regione': 'Región' },
    fr: { nome: 'Mailgun', descrizione: 'E-mails aux clients avec Mailgun : messages, factures et devis en pièce jointe.', 'imp.chiave': 'Clé API privée (ou Sending API key du domaine)', 'imp.dominio': 'Domaine d\'envoi (ex. mg.tondomaine.fr)', 'imp.regione': 'Région' },
    de: { nome: 'Mailgun', descrizione: 'E-Mails an Kunden mit Mailgun: Nachrichten, Rechnungen und Angebote im Anhang.', 'imp.chiave': 'Privater API-Schlüssel (oder Sending API key der Domain)', 'imp.dominio': 'Versanddomain (z. B. mg.deinedomain.de)', 'imp.regione': 'Region' },
    pt: { nome: 'Mailgun', descrizione: 'Email aos clientes com o Mailgun: mensagens, faturas e orçamentos em anexo.', 'imp.chiave': 'Chave API privada (ou Sending API key do domínio)', 'imp.dominio': 'Domínio de envio (ex. mg.seudominio.pt)', 'imp.regione': 'Região' },
  },
});
