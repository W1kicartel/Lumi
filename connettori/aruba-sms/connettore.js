// Aruba SMS: SMS italiani ai clienti e promemoria degli appuntamenti. API REST v1.0 su smspanel.aruba.it (la stessa
// famiglia di API di Skebby, ma con host, tipi di messaggio e credenziali suoi): GET /token in Basic → «user_key;access_token»
// (non scade), poi POST /sms con le intestazioni user_key e Access_token. Il tipo «N» è l'Alta qualità con notifica di ricezione.
import { azioneSms, giroPromemoria, impostazioniPromemoria, testiSms, impPrefisso } from '../_comunica/sms.js';

const base = k => `${k.base || 'https://smspanel.aruba.it'}/API/v1.0/REST`;
const chiavi = new Map();   // utente → intestazioni: il token non scade, si chiede una volta per avvio
async function accesso(k, nuovo = false) {
  const id = `${k.imp.utente}\n${k.segreti.password}`;
  if (!nuovo && chiavi.has(id)) return chiavi.get(id);
  const r = await k.http.get(`${base(k)}/token`, { basic: [k.imp.utente, k.segreti.password], intestazioni: { Accept: 'text/plain' } });
  if (!r.ok) throw new Error(r.stato === 401 ? 'Aruba SMS: email o password sbagliate' : `Aruba SMS: accesso rifiutato (HTTP ${r.stato})`);
  const [u, t] = r.testo.trim().split(';'); if (!u || !t) throw new Error('Aruba SMS: risposta di accesso non valida');
  const h = { user_key: u, Access_token: t }; chiavi.set(id, h); return h;
}
async function chiama(k, metodo, via, json) {
  for (let i = 0; i < 2; i++) {
    const r = await k.http[metodo](`${base(k)}${via}`, { intestazioni: await accesso(k, i > 0), ...(json ? { json } : {}) });
    if (r.stato === 401 && i === 0) continue;   // token revocato: se ne chiede uno nuovo, una volta
    if (!r.ok) throw new Error(`Aruba SMS ${via.split('?')[0]}: ${r.json?.result || r.testo?.slice(0, 120) || `HTTP ${r.stato}`}`);
    return r.json || {};
  }
}
async function sms(k, numero, testo) {
  const tipo = k.imp.qualita || 'N';   // il mittente personalizzato (alias approvato da Aruba e AGCOM) solo con l'Alta qualità
  const x = await chiama(k, 'post', '/sms', { message_type: tipo, message: testo, recipient: [numero], ...(tipo === 'N' && k.imp.mittente ? { sender: k.imp.mittente } : {}), returnCredits: true });
  if (x.result && x.result !== 'OK') throw new Error(`Aruba SMS: ${x.result}`);
  return { id: x.order_id, inviati: x.total_sent };
}

export default {
  id: 'aruba-sms', nome: 'Aruba SMS', versione: 1, icona: 'messaggio', base: 'https://smspanel.aruba.it',
  descrizione: 'SMS ai clienti e promemoria degli appuntamenti con Aruba SMS.',
  impostazioni: [
    { id: 'utente', nome: 'Email (o nome utente) del pannello Aruba SMS' },
    { id: 'password', nome: 'Password del pannello Aruba SMS', segreto: true },
    { id: 'qualita', nome: 'Tipo di SMS', tipo: 'scelta', opzioni: ['N', 'L'], predefinito: 'N', aiuto: 'N = Alta qualità, con il tuo mittente e la notifica di ricezione; L = bassa qualità, solo se il tuo pacchetto la comprende (mittente generico)' },
    { id: 'mittente', nome: 'Mittente (alias approvato in Aruba SMS, max 11 caratteri)', schema: /^[A-Za-z0-9 .\-]{1,11}$|^\+?\d{6,16}$/, obbligatorio: false },
    impPrefisso, ...impostazioniPromemoria(),
  ],
  richiede: { clienti: { telefono: { tipo: ['telefono'] } } },
  permessi: { clienti: { leggi: true }, appuntamenti: { leggi: true } },
  prova: async k => {
    const s = await chiama(k, 'get', '/status?typeAliases=true');
    return { ok: true, messaggio: (s.sms || []).map(x => `${x.type}: ${x.quantity}`).join(' · ') || 'collegato' };
  },
  azioni: { manda_sms: azioneSms(sms, 'Aruba SMS') },
  pianificati: { promemoria: giroPromemoria(sms) },
  catalogo: {
    categoria: 'sms', sito: 'https://www.aruba.it/sms.aspx', costo: 'a-consumo',
    costoNota: 'Pacchetti di SMS prepagati senza canone: il prezzo per SMS scende con la quantità (listino su aruba.it, sezione SMS). Un SMS oltre 160 caratteri usa più crediti. Prezzi IVA esclusa.',
    serve: [
      { cosa: 'Email (o nome utente) e password del pannello Aruba SMS', dove: 'quelle con cui entri su smspanel.aruba.it', link: 'https://smspanel.aruba.it' },
      { cosa: 'Un mittente personalizzato (alias) per l\'Alta qualità', dove: 'pannello Aruba SMS → Impostazioni → Mittenti (l\'alias va approvato da Aruba e da AGCOM)', link: 'https://smspanel.aruba.it' },
    ],
    passi: ['Compra un pacchetto di SMS su aruba.it ed entra nel pannello smspanel.aruba.it', 'Registra un mittente (es. il nome del negozio, max 11 caratteri) e aspetta l\'approvazione', 'Scrivi qui email (o nome utente) e password del pannello e il mittente', 'Lascia il tipo «N» (Alta qualità): mostra il mittente e dà la notifica di ricezione', 'Accendi e premi «Prova»: mostra gli SMS rimasti per tipo', 'Se vuoi, accendi il promemoria degli appuntamenti del giorno dopo'],
    difficolta: 'facile', zone: ['IT'],
    fonti: ['https://smsdevelopers.aruba.it/#authentication-api', 'https://smsdevelopers.aruba.it/#send-an-sms-message', 'https://smsdevelopers.aruba.it/#get-user-status'],
    prova: 'finto', parole: ['aruba', 'aruba sms', 'sms', 'italia', 'messaggi', 'promemoria', 'appuntamenti', 'alta qualità', 'text message', 'reminder'],
  },
  testi: {
    en: { nome: 'Aruba SMS', descrizione: 'SMS to customers and appointment reminders with Aruba SMS.', 'imp.utente': 'Aruba SMS panel email (or username)', 'imp.password': 'Aruba SMS panel password', 'imp.qualita': 'SMS type', 'aiuto.qualita': 'N = High quality, with your sender and delivery notice; L = low quality, only if your package includes it (generic sender)', 'imp.mittente': 'Sender (alias approved in Aruba SMS, max 11 characters)', ...testiSms.en,
      'cat.costoNota': 'Prepaid SMS packages with no fee: the price per SMS goes down with quantity (price list on aruba.it, SMS section). An SMS over 160 characters uses more credits. Prices exclude VAT.',
      'cat.serve': [{ cosa: 'Email (or username) and password of the Aruba SMS panel', dove: 'the ones you use to log in on smspanel.aruba.it' }, { cosa: 'A custom sender (alias) for High quality', dove: 'Aruba SMS panel → Settings → Senders (the alias must be approved by Aruba and AGCOM)' }],
      'cat.passi': ['Buy an SMS package on aruba.it and log in to smspanel.aruba.it', 'Register a sender (e.g. the shop name, max 11 characters) and wait for approval', 'Write the panel email (or username), password and the sender here', 'Keep type «N» (High quality): it shows the sender and gives delivery notices', 'Turn on and press «Test»: it shows the SMS left per type', 'If you like, turn on reminders for next-day appointments'] },
    es: { nome: 'Aruba SMS', descrizione: 'SMS a los clientes y recordatorios de citas con Aruba SMS.', 'imp.utente': 'Email (o usuario) del panel Aruba SMS', 'imp.password': 'Contraseña del panel Aruba SMS', 'imp.qualita': 'Tipo de SMS', 'aiuto.qualita': 'N = alta calidad, con tu remitente y aviso de recepción; L = baja calidad, solo si tu paquete la incluye (remitente genérico)', 'imp.mittente': 'Remitente (alias aprobado en Aruba SMS, máx. 11 caracteres)', ...testiSms.es },
    fr: { nome: 'Aruba SMS', descrizione: 'SMS aux clients et rappels de rendez-vous avec Aruba SMS.', 'imp.utente': 'E-mail (ou identifiant) du panneau Aruba SMS', 'imp.password': 'Mot de passe du panneau Aruba SMS', 'imp.qualita': 'Type de SMS', 'aiuto.qualita': 'N = haute qualité, avec ton expéditeur et avis de réception ; L = basse qualité, seulement si ton forfait l\'inclut (expéditeur générique)', 'imp.mittente': 'Expéditeur (alias approuvé dans Aruba SMS, 11 caractères max.)', ...testiSms.fr },
    de: { nome: 'Aruba SMS', descrizione: 'SMS an Kunden und Terminerinnerungen mit Aruba SMS.', 'imp.utente': 'E-Mail (oder Benutzername) des Aruba-SMS-Panels', 'imp.password': 'Passwort des Aruba-SMS-Panels', 'imp.qualita': 'SMS-Typ', 'aiuto.qualita': 'N = hohe Qualität, mit deinem Absender und Empfangsbestätigung; L = niedrige Qualität, nur wenn dein Paket sie enthält (allgemeiner Absender)', 'imp.mittente': 'Absender (in Aruba SMS genehmigter Alias, max. 11 Zeichen)', ...testiSms.de },
    pt: { nome: 'Aruba SMS', descrizione: 'SMS aos clientes e lembretes de agendamentos com o Aruba SMS.', 'imp.utente': 'Email (ou usuário) do painel Aruba SMS', 'imp.password': 'Senha do painel Aruba SMS', 'imp.qualita': 'Tipo de SMS', 'aiuto.qualita': 'N = alta qualidade, com o seu remetente e aviso de receção; L = baixa qualidade, só se o seu pacote a incluir (remetente genérico)', 'imp.mittente': 'Remetente (alias aprovado no Aruba SMS, máx. 11 caracteres)', ...testiSms.pt },
  },
};
