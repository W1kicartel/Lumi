// Twilio SMS: SMS ai clienti, promemoria degli appuntamenti, stato della consegna e SMS in arrivo.
// Twilio firma ogni richiesta: X-Twilio-Signature = base64(HMAC-SHA1(Auth Token, indirizzo completo + i parametri POST
// ordinati per nome, nome e valore attaccati)). L'indirizzo è quello che vede Twilio: per questo serve l'indirizzo pubblico
// (il suo, o quello di Lumi nella Libreria). Agli SMS in arrivo Twilio vuole TwiML: si risponde <Response/> vuoto, text/xml.
import { createHmac } from 'node:crypto';
import { stessoSegreto } from '../../server/moduli/connettori-rete.js';
import { e164, nomeDi } from '../_comunica/telefono.js';
import { azioneSms, giroPromemoria, impostazioniPromemoria, testiSms, impPrefisso } from '../_comunica/sms.js';

const base = k => k.base || 'https://api.twilio.com';
const pubblico = k => String(k.imp.pubblico || k.pubblico || '').trim().replace(/\/+$/, '');
const TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
export function firmaTwilio(token, url, parametri) {
  const s = [...Object.entries(parametri || {})].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).reduce((t, [n, v]) => t + n + v, url);
  return createHmac('sha1', token).update(Buffer.from(s, 'utf8')).digest('base64');
}
async function sms(k, numero, testo) {
  const da = String(k.imp.mittente || '');
  const r = await k.http.post(`${base(k)}/2010-04-01/Accounts/${encodeURIComponent(k.imp.sid)}/Messages.json`, { basic: [k.imp.sid, k.segreti.token],
    form: { To: numero, Body: testo, ...(/^MG[0-9a-f]{32}$/i.test(da) ? { MessagingServiceSid: da } : { From: da }), StatusCallback: pubblico(k) ? `${pubblico(k)}/api/connettori/twilio/in` : undefined } });
  if (!r.ok) throw new Error(`Twilio: ${r.json?.message || `HTTP ${r.stato}`}${r.json?.code ? ` (${r.json.code})` : ''}`);
  return { id: r.json?.sid, stato: r.json?.status };
}
// un numero che arriva da Twilio (+39333…) cercato tra i clienti anche come lo scrivono le persone (333…, 0039…)
function clienteDa(k, numero) {
  const n = String(numero || ''), loc = n.replace(/^\+39/, '');
  for (const v of [n, loc, `0039${loc}`, loc.replace(/^(\d{3})(\d+)/, '$1 $2')]) { const c = k.dati.trova('clienti', 'telefono', v); if (c) return c; }
  return null;
}

export default {
  id: 'twilio', nome: 'Twilio SMS', versione: 1, icona: 'messaggio',
  descrizione: 'SMS ai clienti e promemoria degli appuntamenti con Twilio, con lo stato della consegna.',
  impostazioni: [
    { id: 'sid', nome: 'Account SID (AC…)', schema: /^AC[0-9a-f]{32}$/i },
    { id: 'token', nome: 'Auth Token', segreto: true, schema: /^[0-9a-f]{32}$/i },
    { id: 'mittente', nome: 'Mittente: numero Twilio (+39…), nome (max 11) o Messaging Service (MG…)' },
    { id: 'pubblico', nome: 'Indirizzo pubblico di Lumi (per stato della consegna e SMS in arrivo)', tipo: 'url', obbligatorio: false },
    impPrefisso, ...impostazioniPromemoria(),
  ],
  richiede: { clienti: { telefono: { tipo: ['telefono'] } } },
  permessi: { clienti: { leggi: true }, appuntamenti: { leggi: true } },
  prova: async k => {
    const r = await k.http.get(`${base(k)}/2010-04-01/Accounts/${encodeURIComponent(k.imp.sid)}.json`, { basic: [k.imp.sid, k.segreti.token] });
    return { ok: r.ok, messaggio: r.ok ? `${r.json?.friendly_name} (${r.json?.status})` : `HTTP ${r.stato}` };
  },
  azioni: { manda_sms: azioneSms(sms, 'Twilio') },
  pianificati: { promemoria: giroPromemoria(sms) },
  entrata: {
    // la firma si calcola sull'indirizzo pubblico + il percorso chiesto (con la query, se c'è)
    firma: { tipo: 'twilio', segreto: 'token', verifica: ({ req, grezzo, segreto, k }) => {
      if (!pubblico(k)) return false;
      const via = new URL(req.url, 'http://x'), url = pubblico(k) + via.pathname + via.search;
      const p = /x-www-form-urlencoded/i.test(req.headers['content-type'] || '') ? Object.fromEntries(new URLSearchParams(grezzo.toString('utf8'))) : {};
      return stessoSegreto(req.headers['x-twilio-signature'] || '', firmaTwilio(segreto, url, p));
    } },
    idempotenza: ev => `${ev.MessageSid || ev.SmsSid}:${ev.MessageStatus || ev.SmsStatus}`,
    // TwiML vuoto: nessuna risposta automatica al cliente, e niente avviso 12300 (Content-Type) nella console di Twilio
    risposta: { tipo: 'text/xml', testo: TWIML },
    async gestisci(ev, k) {
      const stato = ev.MessageStatus || ev.SmsStatus;
      if (stato === 'received' && ev.Body != null) {   // un SMS in arrivo sul numero Twilio
        const c = clienteDa(k, ev.From), chi = c ? nomeDi(k, c) : ev.From;
        k.avvisa(`SMS da ${chi}: ${String(ev.Body).slice(0, 300)}`); return `SMS ricevuto da ${chi}`;
      }
      if (['failed', 'undelivered'].includes(stato)) { k.avvisa(`l'SMS a ${ev.To} non è stato consegnato${ev.ErrorCode ? ` (errore ${ev.ErrorCode})` : ''}`); return `non consegnato: ${ev.To}`; }
      return stato ? `stato: ${stato}` : 'ignorato';
    },
  },
  catalogo: {
    categoria: 'sms', sito: 'https://www.twilio.com/it-it/messaging', costo: 'a-consumo',
    costoNota: 'A consumo, in dollari: verso l\'Italia circa 0,093 $ per SMS (per pezzo da 160 caratteri), 0,02 $ per un SMS ricevuto; un numero mobile italiano costa circa 45 $ al mese (serve il fascicolo normativo). In alternativa un mittente alfanumerico. Prova gratuita con un piccolo credito iniziale.',
    serve: [
      { cosa: 'Account SID e Auth Token', dove: 'console.twilio.com → Account Dashboard → riquadro «Account Info»', link: 'https://console.twilio.com' },
      { cosa: 'Un mittente: numero Twilio, Messaging Service (MG…) o nome alfanumerico', dove: 'Console → Phone Numbers → Buy a number, oppure Messaging → Services', link: 'https://console.twilio.com/us1/develop/phone-numbers/manage/search' },
    ],
    passi: ['Crea un account su twilio.com e verifica il tuo numero', 'Dalla console copia Account SID e Auth Token e incollali qui', 'Compra un numero (per l\'Italia serve un fascicolo normativo) o crea un Messaging Service, e scrivilo come mittente', 'Con la prova gratuita gli SMS arrivano solo ai numeri verificati', 'Per lo stato della consegna e gli SMS in arrivo scrivi l\'indirizzo pubblico di Lumi (se l\'hai impostato nella Libreria, puoi lasciarlo vuoto); per gli SMS in arrivo imposta lo stesso indirizzo (…/api/connettori/twilio/in) sul numero, in «A message comes in»', 'Accendi e prova: «Manda un SMS» nella scheda di un cliente'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource', 'https://www.twilio.com/docs/usage/security#validating-requests', 'https://www.twilio.com/docs/messaging/guides/track-outbound-message-status', 'https://www.twilio.com/en-us/sms/pricing/it'],
    prova: 'finto', parole: ['twilio', 'sms', 'messaggi', 'promemoria', 'appuntamenti', 'text message', 'reminder'],
  },
  testi: {
    en: { nome: 'Twilio SMS', descrizione: 'SMS to customers and appointment reminders with Twilio, with delivery status.', 'imp.sid': 'Account SID (AC…)', 'imp.token': 'Auth Token', 'imp.mittente': 'Sender: Twilio number (+39…), name (max 11) or Messaging Service (MG…)', 'imp.pubblico': 'Public address of Lumi (for delivery status and incoming SMS)', ...testiSms.en,
      'cat.costoNota': 'Pay as you go, in dollars: to Italy about $0.093 per SMS (per 160-character segment), $0.02 per received SMS; an Italian mobile number costs about $45 a month (a regulatory bundle is required). Or an alphanumeric sender. Free trial with a small starting credit.',
      'cat.serve': [{ cosa: 'Account SID and Auth Token', dove: 'console.twilio.com → Account Dashboard → «Account Info» box' }, { cosa: 'A sender: Twilio number, Messaging Service (MG…) or alphanumeric name', dove: 'Console → Phone Numbers → Buy a number, or Messaging → Services' }],
      'cat.passi': ['Create an account on twilio.com and verify your number', 'Copy Account SID and Auth Token from the console and paste them here', 'Buy a number (Italy needs a regulatory bundle) or create a Messaging Service, and set it as sender', 'On the free trial SMS only reach verified numbers', 'For delivery status and incoming SMS write Lumi\'s public address (if you set it in the Library, you can leave it empty); for incoming SMS set the same address (…/api/connettori/twilio/in) on the number under «A message comes in»', 'Turn on and try: «Send an SMS» in a customer record'] },
    es: { nome: 'Twilio SMS', descrizione: 'SMS a los clientes y recordatorios de citas con Twilio, con el estado de entrega.', 'imp.sid': 'Account SID (AC…)', 'imp.token': 'Auth Token', 'imp.mittente': 'Remitente: número Twilio (+39…), nombre (máx. 11) o Messaging Service (MG…)', 'imp.pubblico': 'Dirección pública de Lumi (estado de entrega y SMS entrantes)', ...testiSms.es },
    fr: { nome: 'Twilio SMS', descrizione: 'SMS aux clients et rappels de rendez-vous avec Twilio, avec l\'état de livraison.', 'imp.sid': 'Account SID (AC…)', 'imp.token': 'Auth Token', 'imp.mittente': 'Expéditeur : numéro Twilio (+39…), nom (11 max.) ou Messaging Service (MG…)', 'imp.pubblico': 'Adresse publique de Lumi (état de livraison et SMS entrants)', ...testiSms.fr },
    de: { nome: 'Twilio SMS', descrizione: 'SMS an Kunden und Terminerinnerungen mit Twilio, mit Zustellstatus.', 'imp.sid': 'Account SID (AC…)', 'imp.token': 'Auth Token', 'imp.mittente': 'Absender: Twilio-Nummer (+39…), Name (max. 11) oder Messaging Service (MG…)', 'imp.pubblico': 'Öffentliche Adresse von Lumi (Zustellstatus und eingehende SMS)', ...testiSms.de },
    pt: { nome: 'Twilio SMS', descrizione: 'SMS aos clientes e lembretes de agendamentos com o Twilio, com o estado da entrega.', 'imp.sid': 'Account SID (AC…)', 'imp.token': 'Auth Token', 'imp.mittente': 'Remetente: número Twilio (+39…), nome (máx. 11) ou Messaging Service (MG…)', 'imp.pubblico': 'Endereço público do Lumi (estado da entrega e SMS recebidos)', ...testiSms.pt },
  },
};
