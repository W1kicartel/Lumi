// SMSHosting: SMS italiani ai clienti e promemoria degli appuntamenti. API REST su api.smshosting.it/rest/api con
// Basic (chiave API : chiave segreta); POST /sms/send in form (from, to senza «+», text, encoding AUTO) e GET /user per il credito.
import { azioneSms, giroPromemoria, impostazioniPromemoria, testiSms, impPrefisso } from '../_comunica/sms.js';

const base = k => `${k.base || 'https://api.smshosting.it'}/rest/api`;
const errore = r => r.json?.errorMsg || r.json?.message || r.testo?.slice(0, 120) || `HTTP ${r.stato}`;
async function sms(k, numero, testo) {
  const r = await k.http.post(`${base(k)}/sms/send`, { basic: [k.imp.chiave, k.segreti.segreto],
    form: { to: numero.replace(/^\+/, ''), text: testo, from: k.imp.mittente || undefined, encoding: 'AUTO', ...(k.imp.prova_finta ? { sandbox: 'true' } : {}) } });
  if (!r.ok) throw new Error(`SMSHosting: ${errore(r)}`);
  const s = r.json?.sms?.[0];
  if (!Number(r.json?.smsInserted)) throw new Error(`SMSHosting: SMS non accettato${s?.statusDetail ? ` (${s.statusDetail})` : ''}`);
  return { id: s?.id, stato: s?.status };
}

export default {
  id: 'smshosting', nome: 'SMSHosting', versione: 1, icona: 'messaggio',
  descrizione: 'SMS ai clienti e promemoria degli appuntamenti con SMSHosting, il servizio SMS italiano.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API (AUTH_KEY)' },
    { id: 'segreto', nome: 'Chiave segreta (AUTH_SECRET)', segreto: true },
    { id: 'mittente', nome: 'Mittente (alias approvato in SMSHosting o numero, max 11 caratteri)', schema: /^[A-Za-z0-9 .\-]{1,11}$|^\+?\d{6,16}$/, obbligatorio: false },
    { id: 'prova_finta', nome: 'Modalità di prova (sandbox: non manda davvero gli SMS)', tipo: 'si_no', predefinito: false },
    impPrefisso, ...impostazioniPromemoria(),
  ],
  richiede: { clienti: { telefono: { tipo: ['telefono'] } } },
  permessi: { clienti: { leggi: true }, appuntamenti: { leggi: true } },
  prova: async k => {
    const r = await k.http.get(`${base(k)}/user`, { basic: [k.imp.chiave, k.segreti.segreto] });
    if (!r.ok) return { ok: false, messaggio: r.stato === 401 ? 'chiave API o chiave segreta sbagliate' : errore(r) };
    return { ok: true, messaggio: `${r.json?.italysms ?? 0} SMS per l'Italia · credito ${Number(r.json?.credit ?? 0).toFixed(2)} €` };
  },
  azioni: { manda_sms: azioneSms(sms, 'SMSHosting') },
  pianificati: { promemoria: giroPromemoria(sms) },
  catalogo: {
    categoria: 'sms', sito: 'https://www.smshosting.it', costo: 'a-consumo',
    costoNota: 'Credito prepagato senza canone: il prezzo per SMS scende con la quantità acquistata (listino su smshosting.it/it/prezzi-sms). Un SMS oltre 160 caratteri (70 con emoji) conta come più SMS. Prezzi IVA esclusa.',
    serve: [
      { cosa: 'Chiave API (AUTH_KEY) e chiave segreta (AUTH_SECRET)', dove: 'smshosting.it → Sviluppatori → API REST, HTTP e SOAP', link: 'https://www.smshosting.it' },
      { cosa: 'Un mittente personalizzato (alias)', dove: 'smshosting.it → Impostazioni → Mittenti (va approvato)', link: 'https://www.smshosting.it' },
    ],
    passi: ['Crea un account su smshosting.it, attivalo e ricarica il credito', 'Vai in Sviluppatori → API REST, HTTP e SOAP e copia chiave API e chiave segreta', 'Incollale qui e scrivi il mittente approvato', 'Per provare senza spendere accendi la modalità di prova (sandbox): gli SMS non partono davvero', 'Accendi e premi «Prova»: mostra gli SMS e il credito rimasti', 'Se vuoi, accendi il promemoria degli appuntamenti del giorno dopo'],
    difficolta: 'facile', zone: ['IT', 'mondo'],
    fonti: ['https://help.smshosting.it/it/sms-rest-api', 'https://apidoc.smshosting.it/', 'https://github.com/smshosting/smshosting-api-java-client'],
    prova: 'finto', parole: ['smshosting', 'sms hosting', 'sms', 'italia', 'messaggi', 'promemoria', 'appuntamenti', 'text message', 'reminder'],
  },
  testi: {
    en: { nome: 'SMSHosting', descrizione: 'SMS to customers and appointment reminders with SMSHosting, the Italian SMS service.', 'imp.chiave': 'API key (AUTH_KEY)', 'imp.segreto': 'Secret key (AUTH_SECRET)', 'imp.mittente': 'Sender (alias approved in SMSHosting or number, max 11 characters)', 'imp.prova_finta': 'Test mode (sandbox: SMS are not really sent)', ...testiSms.en,
      'cat.costoNota': 'Prepaid credit with no fee: the price per SMS goes down with the amount bought (price list on smshosting.it). An SMS over 160 characters (70 with emoji) counts as more SMS. Prices exclude VAT.',
      'cat.serve': [{ cosa: 'API key (AUTH_KEY) and secret key (AUTH_SECRET)', dove: 'smshosting.it → Developers → REST, HTTP and SOAP API' }, { cosa: 'A custom sender (alias)', dove: 'smshosting.it → Settings → Senders (needs approval)' }],
      'cat.passi': ['Create an account on smshosting.it, activate it and top up', 'Go to Developers → REST, HTTP and SOAP API and copy API key and secret key', 'Paste them here and write the approved sender', 'To try without spending turn on test mode (sandbox): SMS are not really sent', 'Turn on and press «Test»: it shows the SMS and credit left', 'If you like, turn on reminders for next-day appointments'] },
    es: { nome: 'SMSHosting', descrizione: 'SMS a los clientes y recordatorios de citas con SMSHosting, el servicio SMS italiano.', 'imp.chiave': 'Clave API (AUTH_KEY)', 'imp.segreto': 'Clave secreta (AUTH_SECRET)', 'imp.mittente': 'Remitente (alias aprobado en SMSHosting o número, máx. 11 caracteres)', 'imp.prova_finta': 'Modo de prueba (sandbox: los SMS no se envían de verdad)', ...testiSms.es },
    fr: { nome: 'SMSHosting', descrizione: 'SMS aux clients et rappels de rendez-vous avec SMSHosting, le service SMS italien.', 'imp.chiave': 'Clé API (AUTH_KEY)', 'imp.segreto': 'Clé secrète (AUTH_SECRET)', 'imp.mittente': 'Expéditeur (alias approuvé dans SMSHosting ou numéro, 11 caractères max.)', 'imp.prova_finta': 'Mode test (sandbox : les SMS ne partent pas vraiment)', ...testiSms.fr },
    de: { nome: 'SMSHosting', descrizione: 'SMS an Kunden und Terminerinnerungen mit SMSHosting, dem italienischen SMS-Dienst.', 'imp.chiave': 'API-Schlüssel (AUTH_KEY)', 'imp.segreto': 'Geheimer Schlüssel (AUTH_SECRET)', 'imp.mittente': 'Absender (in SMSHosting genehmigter Alias oder Nummer, max. 11 Zeichen)', 'imp.prova_finta': 'Testmodus (Sandbox: SMS werden nicht wirklich gesendet)', ...testiSms.de },
    pt: { nome: 'SMSHosting', descrizione: 'SMS aos clientes e lembretes de agendamentos com o SMSHosting, o serviço SMS italiano.', 'imp.chiave': 'Chave API (AUTH_KEY)', 'imp.segreto': 'Chave secreta (AUTH_SECRET)', 'imp.mittente': 'Remetente (alias aprovado no SMSHosting ou número, máx. 11 caracteres)', 'imp.prova_finta': 'Modo de teste (sandbox: os SMS não são enviados de verdade)', ...testiSms.pt },
  },
};
