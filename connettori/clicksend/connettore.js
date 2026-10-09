// ClickSend: SMS ai clienti e promemoria degli appuntamenti. Basic (nome utente : API key); POST /v3/sms/send con
// messages[{ source, from, to, body }]: la risposta è 200 anche se un messaggio è rifiutato, conta lo status di ognuno.
import { azioneSms, giroPromemoria, impostazioniPromemoria, testiSms, impPrefisso } from '../_comunica/sms.js';

const base = k => `${k.base || 'https://rest.clicksend.com'}/v3`;
const accesso = k => ({ basic: [k.imp.utente, k.segreti.chiave] });
async function sms(k, numero, testo) {
  const r = await k.http.post(`${base(k)}/sms/send`, { ...accesso(k), json: { messages: [{ source: 'kubo', to: numero, body: testo, ...(k.imp.mittente ? { from: k.imp.mittente } : {}) }] } });
  const m = r.json?.data?.messages?.[0];
  if (!r.ok || !m) throw new Error(`ClickSend: ${r.json?.response_msg || `HTTP ${r.stato}`}`);
  if (m.status !== 'SUCCESS') throw new Error(`ClickSend: SMS rifiutato (${m.status})`);
  return { id: m.message_id, costo: m.message_price };
}

export default {
  id: 'clicksend', nome: 'ClickSend', versione: 1, icona: 'messaggio',
  descrizione: 'SMS ai clienti e promemoria degli appuntamenti con ClickSend.',
  impostazioni: [
    { id: 'utente', nome: 'Nome utente ClickSend (API username)' },
    { id: 'chiave', nome: 'API key', segreto: true },
    { id: 'mittente', nome: 'Mittente (nome fino a 11 caratteri o numero; vuoto = quello predefinito dell\'account)', schema: /^[A-Za-z0-9 ]{1,11}$|^\+?\d{6,16}$/, obbligatorio: false },
    impPrefisso, ...impostazioniPromemoria(),
  ],
  richiede: { clienti: { telefono: { tipo: ['telefono'] } } },
  permessi: { clienti: { leggi: true }, appuntamenti: { leggi: true } },
  prova: async k => {
    const r = await k.http.get(`${base(k)}/account`, accesso(k)), d = r.json?.data || {};
    if (!r.ok) return { ok: false, messaggio: r.stato === 401 ? 'nome utente o API key sbagliati' : r.json?.response_msg || `HTTP ${r.stato}` };
    return { ok: true, messaggio: `${d.username || k.imp.utente} · credito ${d.balance ?? '?'} ${d._currency?.currency_name_short || ''}`.trim() };
  },
  azioni: { manda_sms: azioneSms(sms, 'ClickSend') },
  pianificati: { promemoria: giroPromemoria(sms) },
  catalogo: {
    categoria: 'sms', sito: 'https://www.clicksend.com/it/', costo: 'a-consumo',
    costoNota: 'A consumo, senza canone né contratto: si ricarica il credito e ogni SMS costa secondo il paese e la quantità (listino su clicksend.com/it/pricing). Alla registrazione c\'è un piccolo credito di prova.',
    serve: [
      { cosa: 'Nome utente API e API key', dove: 'dashboard.clicksend.com → in alto a destra il menu «Developers» → API Credentials', link: 'https://dashboard.clicksend.com/account/subaccounts' },
      { cosa: 'Facoltativo: un mittente (nome o numero dedicato)', dove: 'Dashboard → Numbers, oppure Settings → Sender IDs', link: 'https://dashboard.clicksend.com' },
    ],
    passi: ['Crea un account su clicksend.com', 'Apri Developers → API Credentials e copia nome utente e API key', 'Incollali qui e, se vuoi, scrivi il mittente (es. il nome del negozio, max 11 caratteri)', 'Accendi e premi «Prova»: mostra il credito', 'Prova «Manda un SMS» dalla scheda di un cliente', 'Se vuoi, accendi il promemoria degli appuntamenti del giorno dopo'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developers.clicksend.com/docs/messaging/sms/other/send-sms', 'https://developers.clicksend.com/docs/account/other/view-account', 'https://www.clicksend.com/it/pricing/it/'],
    prova: 'finto', parole: ['clicksend', 'sms', 'messaggi', 'promemoria', 'appuntamenti', 'text message', 'reminder'],
  },
  testi: {
    en: { nome: 'ClickSend', descrizione: 'SMS to customers and appointment reminders with ClickSend.', 'imp.utente': 'ClickSend username (API username)', 'imp.chiave': 'API key', 'imp.mittente': 'Sender (name up to 11 characters or number; empty = account default)', ...testiSms.en,
      'cat.costoNota': 'Pay as you go, no fee or contract: you top up credit and each SMS is priced by country and volume (price list on clicksend.com/pricing). A small trial credit on sign-up.',
      'cat.serve': [{ cosa: 'API username and API key', dove: 'dashboard.clicksend.com → top-right «Developers» menu → API Credentials' }, { cosa: 'Optional: a sender (name or dedicated number)', dove: 'Dashboard → Numbers, or Settings → Sender IDs' }],
      'cat.passi': ['Create an account on clicksend.com', 'Open Developers → API Credentials and copy username and API key', 'Paste them here and, if you like, write the sender (e.g. the shop name, max 11 characters)', 'Turn on and press «Test»: it shows the credit', 'Try «Send an SMS» from a customer record', 'If you like, turn on reminders for next-day appointments'] },
    es: { nome: 'ClickSend', descrizione: 'SMS a los clientes y recordatorios de citas con ClickSend.', 'imp.utente': 'Usuario de ClickSend (API username)', 'imp.chiave': 'API key', 'imp.mittente': 'Remitente (nombre hasta 11 caracteres o número; vacío = el de la cuenta)', ...testiSms.es },
    fr: { nome: 'ClickSend', descrizione: 'SMS aux clients et rappels de rendez-vous avec ClickSend.', 'imp.utente': 'Identifiant ClickSend (API username)', 'imp.chiave': 'API key', 'imp.mittente': 'Expéditeur (nom jusqu\'à 11 caractères ou numéro ; vide = celui du compte)', ...testiSms.fr },
    de: { nome: 'ClickSend', descrizione: 'SMS an Kunden und Terminerinnerungen mit ClickSend.', 'imp.utente': 'ClickSend-Benutzername (API username)', 'imp.chiave': 'API key', 'imp.mittente': 'Absender (Name bis 11 Zeichen oder Nummer; leer = Standard des Kontos)', ...testiSms.de },
    pt: { nome: 'ClickSend', descrizione: 'SMS aos clientes e lembretes de agendamentos com o ClickSend.', 'imp.utente': 'Usuário ClickSend (API username)', 'imp.chiave': 'API key', 'imp.mittente': 'Remetente (nome até 11 caracteres ou número; vazio = o padrão da conta)', ...testiSms.pt },
  },
};
