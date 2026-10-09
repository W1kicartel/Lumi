// WhatsApp tramite Twilio: l'iscrizione più semplice (il mittente WhatsApp si registra dalla console di Twilio), i modelli
// con la Content API e l'approvazione di Meta chiesta da Twilio. Costa le tariffe di Meta più 0,005 $ a messaggio.
// Serve: Account SID, Auth Token (firma X-Twilio-Signature dei webhook) e il mittente WhatsApp («+14155238886»), più
// l'indirizzo pubblico di Lumi (il suo o quello della Libreria): la firma di Twilio comprende l'URL intero, e i file (PDF)
// Twilio li scarica da un link. Ai messaggi in arrivo si risponde TwiML vuoto (<Response/>, text/xml).
// Fonti: https://www.twilio.com/docs/whatsapp/api · https://www.twilio.com/docs/usage/webhooks/webhooks-security
//        https://www.twilio.com/docs/content/content-api-resources · https://www.twilio.com/docs/content/content-api-approvals
import { createHmac, timingSafeEqual } from 'node:crypto';
import { bus } from '../../server/moduli/whatsapp-bus.js';

const API = 'https://api.twilio.com', CONTENUTI = 'https://content.twilio.com';
const cont = k => (k.base === API ? CONTENUTI : k.base);   // nelle prove un solo finto servizio fa da tutti e due
const auth = k => ({ basic: [k.imp.sid, k.segreti.token] });
const wa = n => `whatsapp:${String(n).replace(/^whatsapp:/, '')}`;
const errore = r => r.json?.message || `HTTP ${r.stato}`;
const pubblico = k => String(k.imp.indirizzo || k.pubblico || '').trim().replace(/\/+$/, '');
const richiamo = k => (pubblico(k) ? { StatusCallback: `${pubblico(k)}/api/connettori/twilio-whatsapp/in` } : {});
async function manda(k, campi) {
  const r = await k.http.post(`${k.base}/2010-04-01/Accounts/${encodeURIComponent(k.imp.sid)}/Messages.json`, { ...auth(k), form: { From: wa(k.imp.mittente), ...richiamo(k), ...campi } });
  if (!r.ok) throw new Error(errore(r)); return { id: r.json?.sid || null };
}

// X-Twilio-Signature: Base64(HMAC-SHA1(Auth Token, URL + i parametri POST ordinati per nome, nome+valore senza separatori))
export function firmaTwilio(token, url, parametri) {
  const p = parametri instanceof URLSearchParams ? parametri : new URLSearchParams(parametri);
  const dati = url + [...new Set(p.keys())].sort().map(n => p.getAll(n).sort().map(v => n + v).join('')).join('');
  return createHmac('sha1', token).update(Buffer.from(dati, 'utf8')).digest('base64');
}
const uguali = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y); };

const STATI = { queued: 'coda', accepted: 'coda', sending: 'coda', sent: 'inviato', delivered: 'consegnato', read: 'letto', failed: 'fallito', undelivered: 'fallito' };
const APPROVAZIONI = { approved: 'approvato', pending: 'in_attesa', received: 'in_attesa', unsubmitted: 'in_attesa', rejected: 'rifiutato', paused: 'in_pausa', disabled: 'disattivato' };
export function eventi(ev) {
  if (!ev || typeof ev !== 'object' || !ev.MessageSid) return [];
  const st = ev.MessageStatus || ev.SmsStatus, ora = new Date().toISOString();
  if ((ev.Body != null || Number(ev.NumMedia) > 0) && (!st || st === 'received'))
    return [{ tipo: 'messaggio', da: String(ev.From || '').replace(/^whatsapp:/, ''), nome: ev.ProfileName || null, id: ev.MessageSid, quando: ora, testo: ev.Body ?? null, media: Number(ev.NumMedia) > 0 ? (ev.MediaContentType0 || 'file') : null }];
  return st ? [{ tipo: 'stato', id: ev.MessageSid, stato: STATI[st] || st, quando: ora, errore: ev.ErrorCode ? `${ev.ErrorCode} ${ev.ErrorMessage || ''}`.trim() : null }] : [];
}

export default {
  id: 'twilio-whatsapp', nome: 'WhatsApp (Twilio)', versione: 1, icona: 'utenti', base: API,
  descrizione: 'WhatsApp con Twilio: iscrizione guidata dalla console, modelli con la Content API. Tariffe di Meta più 0,005 $ a messaggio.',
  impostazioni: [
    { id: 'sid', nome: 'Account SID', schema: /^AC[0-9a-fA-F]{32}$/ },
    { id: 'token', nome: 'Auth Token', segreto: true },
    { id: 'mittente', nome: 'Mittente WhatsApp (es. +14155238886)', schema: /^\+?[1-9]\d{7,14}$/ },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Lumi (es. https://lumi.miobottega.it)', tipo: 'url', obbligatorio: false },
  ],
  permessi: { clienti: { leggi: true } },
  prova: async k => {
    const r = await k.http.get(`${k.base}/2010-04-01/Accounts/${encodeURIComponent(k.imp.sid)}.json`, auth(k));
    return r.ok ? { ok: true, messaggio: `${r.json?.friendly_name || ''} · ${r.json?.status || ''}` } : { ok: false, messaggio: errore(r) };
  },
  // POST /api/connettori/twilio-whatsapp/in: messaggi in arrivo e richiami di stato, form-urlencoded, firmati
  entrata: {
    firma: { tipo: 'verifica', segreto: 'token', verifica: ({ req, grezzo, segreto, k }) => !!pubblico(k) && uguali(req.headers['x-twilio-signature'], firmaTwilio(segreto, pubblico(k) + req.url, new URLSearchParams(grezzo.toString('utf8')))) },
    idempotenza: ev => (ev?.MessageSid ? `${ev.MessageSid}:${ev.MessageStatus || ev.SmsStatus || ''}` : null),
    gestisci: async (ev, k) => { const l = eventi(ev), m = bus.get(k.db); return m && l.length ? m.ricevi(k.id, l) : 'ignorato'; },
    // Twilio vuole TwiML: vuoto = nessuna risposta automatica, e niente avviso 12300 (Content-Type) nella sua console
    risposta: { tipo: 'text/xml', testo: '<?xml version="1.0" encoding="UTF-8"?><Response/>' },
  },
  lavori: { 'whatsapp:invia': (corpo, k) => bus.get(k.db)?.lavora(corpo, k.id) },
  whatsapp: {
    testo: (k, a, testo) => manda(k, { To: wa(a), Body: String(testo) }),
    modello: (k, a, m) => manda(k, { To: wa(a), ContentSid: m.idRemoto, ...(m.valori?.length ? { ContentVariables: JSON.stringify(Object.fromEntries(m.valori.map((v, i) => [String(i + 1), String(v)]))) } : {}) }),
    // Twilio scarica il file da un indirizzo pubblico (il link temporaneo di Lumi)
    documento: (k, a, d) => manda(k, { To: wa(a), MediaUrl: d.link, ...(d.didascalia ? { Body: d.didascalia } : {}) }),
    linkPubblico: k => pubblico(k) || null,
    async modelli(k) {
      const out = []; let url = `${cont(k)}/v1/ContentAndApprovals?PageSize=100`;
      for (let i = 0; url && i < 20; i++) {
        const r = await k.http.get(url, auth(k)); if (!r.ok) throw new Error(errore(r));
        for (const c of r.json?.contents || []) {
          const ap = c.approval_requests || {}, tipo = Object.values(c.types || {})[0] || {};
          out.push({ nome: ap.name || c.friendly_name, lingua: c.language, stato: APPROVAZIONI[ap.status] || 'in_attesa', categoria: String(ap.category || 'utility').toLowerCase(),
            corpo: tipo.body || '', idRemoto: c.sid, motivo: ap.rejection_reason || null });
        }
        url = r.json?.meta?.next_page_url || null;
      }
      return out;
    },
    // il contenuto si crea, poi si chiede a Meta l'approvazione per WhatsApp
    async creaModello(k, { nome, lingua = 'it', categoria = 'utility', corpo, esempi = [] }) {
      const variabili = Object.fromEntries(esempi.map((v, i) => [String(i + 1), String(v)]));
      const c = await k.http.post(`${cont(k)}/v1/Content`, { ...auth(k), json: { friendly_name: nome, language: lingua, variables: variabili, types: { 'twilio/text': { body: corpo } } } });
      if (!c.ok) throw new Error(errore(c));
      const ap = await k.http.post(`${cont(k)}/v1/Content/${c.json.sid}/ApprovalRequests/whatsapp`, { ...auth(k), json: { name: nome, category: String(categoria).toUpperCase() } });
      if (!ap.ok) throw new Error(errore(ap));
      return { idRemoto: c.json.sid, stato: APPROVAZIONI[ap.json?.status] || 'in_attesa', categoria };
    },
    creaModelli: true,
    webhook: () => ({ percorso: '/api/connettori/twilio-whatsapp/in', verifica: false }),
  },
  catalogo: {
    categoria: 'whatsapp', sito: 'https://www.twilio.com/whatsapp', costo: 'a-consumo',
    costoNota: 'Nessun canone: le tariffe di Meta per i modelli (in Italia circa 0,066 € marketing, 0,025 € utility) più 0,005 $ di Twilio per ogni messaggio inviato o ricevuto.',
    serve: [
      { cosa: 'Un account Twilio (con credito)', dove: 'twilio.com → Sign up', link: 'https://www.twilio.com/try-twilio' },
      { cosa: 'Account SID e Auth Token', dove: 'Console di Twilio → Account Info', link: 'https://console.twilio.com/' },
      { cosa: 'Un mittente WhatsApp registrato (il tuo numero, collegato al tuo portafoglio Meta)', dove: 'Console → Messaging → Senders → WhatsApp senders', link: 'https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders' },
      { cosa: 'L\'indirizzo pubblico di Lumi (https)', dove: 'chi ospita Lumi, o un tunnel', link: 'https://www.twilio.com/docs/usage/webhooks/webhooks-security' },
    ],
    passi: [
      'Crea l\'account su twilio.com e aggiungi del credito.',
      'Copia Account SID e Auth Token dalla prima pagina della console.',
      'In Messaging → Senders → WhatsApp senders registra il tuo numero con la procedura guidata (accedi con Facebook e collega il portafoglio Meta).',
      'Nel mittente imposta «Webhook URL for incoming messages» e lo stato con l\'URL che Lumi ti mostra.',
      'In Lumi incolla SID, Auth Token, il numero del mittente e l\'indirizzo pubblico di Lumi (se l\'hai impostato nella Libreria, puoi lasciarlo vuoto), poi accendi.',
      'Sincronizza i modelli o creane uno da Lumi: Twilio chiede a Meta l\'approvazione.',
    ],
    difficolta: 'facile', zone: ['mondo'], prova: 'finto',
    fonti: ['https://www.twilio.com/docs/whatsapp/api', 'https://www.twilio.com/docs/usage/webhooks/webhooks-security', 'https://www.twilio.com/docs/content/content-api-resources',
      'https://www.twilio.com/docs/content/content-api-approvals', 'https://www.twilio.com/en-us/whatsapp/pricing'],
    parole: ['whatsapp', 'twilio', 'messaggi', 'chat', 'promemoria', 'content api'],
  },
  testi: {
    en: { nome: 'WhatsApp (Twilio)', descrizione: 'WhatsApp through Twilio: guided sign-up from the console, templates with the Content API. Meta prices plus $0.005 per message.',
      'imp.sid': 'Account SID', 'imp.token': 'Auth Token', 'imp.mittente': 'WhatsApp sender (e.g. +14155238886)', 'imp.indirizzo': 'Lumi\'s public address (e.g. https://lumi.myshop.com)',
      'cat.costoNota': 'No monthly fee: Meta\'s template prices (in Italy about €0.066 marketing, €0.025 utility) plus Twilio\'s $0.005 for every message sent or received.',
      'cat.serve': [{ cosa: 'A Twilio account (with credit)', dove: 'twilio.com → Sign up' }, { cosa: 'Account SID and Auth Token', dove: 'Twilio console → Account Info' },
        { cosa: 'A registered WhatsApp sender (your number, linked to your Meta portfolio)', dove: 'Console → Messaging → Senders → WhatsApp senders' }, { cosa: 'Lumi\'s public address (https)', dove: 'your Lumi host, or a tunnel' }],
      'cat.passi': ['Create the account on twilio.com and add credit.', 'Copy Account SID and Auth Token from the console home page.',
        'In Messaging → Senders → WhatsApp senders register your number with the guided flow (log in with Facebook and link your Meta portfolio).',
        'On the sender set «Webhook URL for incoming messages» and the status callback to the URL Lumi shows you.',
        'In Lumi paste SID, Auth Token, the sender number and Lumi\'s public address (if you set it in the Library, you can leave it empty), then turn it on.', 'Sync the templates or create one from Lumi: Twilio asks Meta for approval.'] },
    es: { nome: 'WhatsApp (Twilio)', descrizione: 'WhatsApp con Twilio: alta guiada desde la consola, plantillas con la Content API.', 'imp.sid': 'Account SID', 'imp.token': 'Auth Token', 'imp.mittente': 'Remitente de WhatsApp (p. ej. +14155238886)', 'imp.indirizzo': 'Dirección pública de Lumi' },
    fr: { nome: 'WhatsApp (Twilio)', descrizione: 'WhatsApp avec Twilio : inscription guidée depuis la console, modèles avec la Content API.', 'imp.sid': 'Account SID', 'imp.token': 'Auth Token', 'imp.mittente': 'Expéditeur WhatsApp (ex. +14155238886)', 'imp.indirizzo': 'Adresse publique de Lumi' },
    de: { nome: 'WhatsApp (Twilio)', descrizione: 'WhatsApp über Twilio: geführte Anmeldung in der Konsole, Vorlagen mit der Content API.', 'imp.sid': 'Account SID', 'imp.token': 'Auth Token', 'imp.mittente': 'WhatsApp-Absender (z. B. +14155238886)', 'imp.indirizzo': 'Öffentliche Adresse von Lumi' },
    pt: { nome: 'WhatsApp (Twilio)', descrizione: 'WhatsApp pela Twilio: cadastro guiado pelo console, modelos com a Content API.', 'imp.sid': 'Account SID', 'imp.token': 'Auth Token', 'imp.mittente': 'Remetente WhatsApp (ex. +14155238886)', 'imp.indirizzo': 'Endereço público do Lumi' },
  },
};
