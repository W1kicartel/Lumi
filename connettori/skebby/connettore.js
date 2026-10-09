// Skebby: SMS italiani ai clienti e promemoria degli appuntamenti. Accesso con email e password dell'account
// (GET /token in Basic → «user_key;access_token», che non scade), poi POST /sms con le intestazioni user_key e Access_token.
// Alta qualità (GP) mostra il mittente scelto e arriva con la conferma di consegna; media (TI) e bassa (SI) costano meno.
import { azioneSms, giroPromemoria, impostazioniPromemoria, testiSms, impPrefisso } from '../_comunica/sms.js';

const base = k => `${k.base || 'https://api.skebby.it'}/API/v1.0/REST`;
const chiavi = new Map();   // utente → { user_key, Access_token }: il token non scade, si chiede una volta per avvio
async function accesso(k, nuovo = false) {
  const id = `${k.imp.utente}\n${k.segreti.password}`;
  if (!nuovo && chiavi.has(id)) return chiavi.get(id);
  const r = await k.http.get(`${base(k)}/token`, { basic: [k.imp.utente, k.segreti.password], intestazioni: { Accept: 'text/plain' } });
  if (!r.ok) throw new Error(r.stato === 401 ? 'Skebby: email o password sbagliate' : `Skebby: accesso rifiutato (HTTP ${r.stato})`);
  const [u, t] = r.testo.trim().split(';'); if (!u || !t) throw new Error('Skebby: risposta di accesso non valida');
  const h = { user_key: u, Access_token: t }; chiavi.set(id, h); return h;
}
async function chiama(k, metodo, via, json) {
  for (let i = 0; i < 2; i++) {
    const r = await k.http[metodo](`${base(k)}${via}`, { intestazioni: await accesso(k, i > 0), ...(json ? { json } : {}) });
    if (r.stato === 401 && i === 0) continue;   // token revocato: se ne chiede uno nuovo, una volta
    if (!r.ok) throw new Error(`Skebby ${via}: ${r.json?.result || r.testo?.slice(0, 120) || `HTTP ${r.stato}`}`);
    return r.json || {};
  }
}
async function sms(k, numero, testo) {
  const tipo = k.imp.qualita || 'GP';
  const x = await chiama(k, 'post', '/sms', { message_type: tipo, message: testo, recipient: [numero], ...(tipo === 'GP' && k.imp.mittente ? { sender: k.imp.mittente } : {}), returnCredits: true });
  if (x.result && x.result !== 'OK') throw new Error(`Skebby: ${x.result}`);
  return { id: x.order_id, crediti: x.remaining_credits };
}

export default {
  id: 'skebby', nome: 'Skebby', versione: 1, icona: 'messaggio', base: 'https://api.skebby.it',
  descrizione: 'SMS ai clienti e promemoria degli appuntamenti con Skebby, il servizio SMS italiano.',
  impostazioni: [
    { id: 'utente', nome: 'Email (o nome utente) dell\'account Skebby' },
    { id: 'password', nome: 'Password dell\'account Skebby', segreto: true },
    { id: 'qualita', nome: 'Qualità degli SMS', tipo: 'scelta', opzioni: ['GP', 'TI', 'SI'], predefinito: 'GP', aiuto: 'GP = Alta qualità, con il tuo mittente e la conferma di consegna; TI = media; SI = bassa (mittente generico)' },
    { id: 'mittente', nome: 'Mittente (alias registrato in Skebby, max 11 caratteri)', schema: /^[A-Za-z0-9 .\-]{1,11}$|^\+?\d{6,16}$/, obbligatorio: false },
    impPrefisso, ...impostazioniPromemoria(),
  ],
  richiede: { clienti: { telefono: { tipo: ['telefono'] } } },
  permessi: { clienti: { leggi: true }, appuntamenti: { leggi: true } },
  prova: async k => {
    const s = await chiama(k, 'get', '/status?typeAliases=true');
    return { ok: true, messaggio: (s.sms || []).map(x => `${x.type}: ${x.quantity}`).join(' · ') || 'collegato' };
  },
  azioni: { manda_sms: azioneSms(sms, 'Skebby') },
  pianificati: { promemoria: giroPromemoria(sms) },
  catalogo: {
    categoria: 'sms', sito: 'https://www.skebby.it', costo: 'a-consumo',
    costoNota: 'Pacchetti di SMS prepagati senza canone né scadenza: il prezzo per SMS scende con la quantità ed è più alto per l\'Alta qualità (listino su skebby.it/prezzi/pacchetti-invio-sms). C\'è una prova gratuita con alcuni SMS. Prezzi IVA esclusa.',
    serve: [
      { cosa: 'Email e password dell\'account Skebby', dove: 'quelle con cui entri su skebby.it', link: 'https://www.skebby.it/action/free-trial/' },
      { cosa: 'Un mittente personalizzato (alias) per l\'Alta qualità', dove: 'Skebby → Impostazioni → Mittenti SMS → Nuovo mittente (va approvato)', link: 'https://www.skebby.it' },
    ],
    passi: ['Crea un account su skebby.it (c\'è la prova gratuita) e compra un pacchetto di SMS', 'Registra un mittente (es. il nome del negozio, max 11 caratteri) e aspetta l\'approvazione', 'Scrivi qui email e password dell\'account e il mittente', 'Scegli la qualità: GP (alta) per mostrare il mittente e avere la conferma di consegna', 'Accendi e premi «Prova»: mostra gli SMS rimasti', 'Se vuoi, accendi il promemoria degli appuntamenti del giorno dopo'],
    difficolta: 'facile', zone: ['IT'],
    fonti: ['https://developers.skebby.it/#authentication-api', 'https://developers.skebby.it/#send-an-sms-message', 'https://developers.skebby.it/#get-user-status'],
    prova: 'finto', parole: ['skebby', 'sms', 'italia', 'messaggi', 'promemoria', 'appuntamenti', 'alta qualità', 'text message', 'reminder'],
  },
  testi: {
    en: { nome: 'Skebby', descrizione: 'SMS to customers and appointment reminders with Skebby, the Italian SMS service.', 'imp.utente': 'Skebby account email (or username)', 'imp.password': 'Skebby account password', 'imp.qualita': 'SMS quality', 'aiuto.qualita': 'GP = High quality, with your sender and delivery receipt; TI = medium; SI = low (generic sender)', 'imp.mittente': 'Sender (alias registered in Skebby, max 11 characters)', ...testiSms.en,
      'cat.costoNota': 'Prepaid SMS packages with no fee and no expiry: the price per SMS goes down with quantity and is higher for High quality (price list on skebby.it). Free trial with a few SMS. Prices exclude VAT.',
      'cat.serve': [{ cosa: 'Email and password of the Skebby account', dove: 'the ones you use to log in on skebby.it' }, { cosa: 'A custom sender (alias) for High quality', dove: 'Skebby → Settings → SMS senders → New sender (needs approval)' }],
      'cat.passi': ['Create an account on skebby.it (free trial available) and buy an SMS package', 'Register a sender (e.g. the shop name, max 11 characters) and wait for approval', 'Write the account email, password and the sender here', 'Pick the quality: GP (high) shows the sender and gives delivery receipts', 'Turn on and press «Test»: it shows the SMS left', 'If you like, turn on reminders for next-day appointments'] },
    es: { nome: 'Skebby', descrizione: 'SMS a los clientes y recordatorios de citas con Skebby, el servicio SMS italiano.', 'imp.utente': 'Email (o usuario) de la cuenta Skebby', 'imp.password': 'Contraseña de la cuenta Skebby', 'imp.qualita': 'Calidad de los SMS', 'aiuto.qualita': 'GP = alta calidad, con tu remitente y confirmación de entrega; TI = media; SI = baja (remitente genérico)', 'imp.mittente': 'Remitente (alias registrado en Skebby, máx. 11 caracteres)', ...testiSms.es },
    fr: { nome: 'Skebby', descrizione: 'SMS aux clients et rappels de rendez-vous avec Skebby, le service SMS italien.', 'imp.utente': 'E-mail (ou identifiant) du compte Skebby', 'imp.password': 'Mot de passe du compte Skebby', 'imp.qualita': 'Qualité des SMS', 'aiuto.qualita': 'GP = haute qualité, avec ton expéditeur et accusé de réception ; TI = moyenne ; SI = basse (expéditeur générique)', 'imp.mittente': 'Expéditeur (alias enregistré dans Skebby, 11 caractères max.)', ...testiSms.fr },
    de: { nome: 'Skebby', descrizione: 'SMS an Kunden und Terminerinnerungen mit Skebby, dem italienischen SMS-Dienst.', 'imp.utente': 'E-Mail (oder Benutzername) des Skebby-Kontos', 'imp.password': 'Passwort des Skebby-Kontos', 'imp.qualita': 'SMS-Qualität', 'aiuto.qualita': 'GP = hohe Qualität, mit deinem Absender und Zustellbestätigung; TI = mittel; SI = niedrig (allgemeiner Absender)', 'imp.mittente': 'Absender (in Skebby registrierter Alias, max. 11 Zeichen)', ...testiSms.de },
    pt: { nome: 'Skebby', descrizione: 'SMS aos clientes e lembretes de agendamentos com o Skebby, o serviço SMS italiano.', 'imp.utente': 'Email (ou usuário) da conta Skebby', 'imp.password': 'Senha da conta Skebby', 'imp.qualita': 'Qualidade dos SMS', 'aiuto.qualita': 'GP = alta qualidade, com o seu remetente e confirmação de entrega; TI = média; SI = baixa (remetente genérico)', 'imp.mittente': 'Remetente (alias registrado no Skebby, máx. 11 caracteres)', ...testiSms.pt },
  },
};
