// MailUp (la piattaforma italiana di email e SMS marketing): i clienti con il consenso iscritti a una lista.
// - accesso: OAuth2 «password» su /Authorization/OAuth/Token (client id e secret in Basic, utente e password della console);
//   il token dura un'ora e resta solo in memoria: scaduto, se ne chiede un altro;
// - in uscita: ogni cliente nuovo o cambiato va nella lista (POST Console/List/{id}/Recipient con Name, Email, MobileNumber,
//   MobilePrefix e i campi 1 = nome, 2 = cognome); se in Kubo il consenso viene tolto, si disiscrive (DELETE …/Unsubscribe/{id});
// - ogni 30 minuti un giro ripassa i clienti cambiati e legge i disiscritti della lista: in Kubo il consenso diventa «no».
// Se la sezione clienti ha il campo del consenso, passano solo i clienti che l'hanno dato (GDPR).
import { spezza, cambiate } from '../_comunica/tabelle.js';
import { e164 } from '../_comunica/telefono.js';
const mbase = k => k.base || 'https://services.mailup.com';
const api = (k, p) => `${mbase(k)}/API/v1.1/Rest/ConsoleService.svc/Console/${p}`;
const no = (r, cosa) => new Error(`MailUp ha risposto ${r.stato} a ${cosa}${r.json?.ErrorDescription || r.json?.error_description ? ': ' + (r.json.ErrorDescription || r.json.error_description) : ''}`);
const conConsenso = k => !!k.campo('clienti', 'consenso');
const lista = k => encodeURIComponent(String(k.imp.lista || '1'));
// il token in memoria, per connettore e utente
const token = new Map();
async function tok(k) {
  const s = k.segreti, chiave = `${k.id}|${mbase(k)}|${k.imp.utente}`, t = token.get(chiave);
  if (t && t.scade - Date.now() > 60000) return t.access;
  const r = await k.http.post(`${mbase(k)}/Authorization/OAuth/Token`, { basic: [k.imp.client_id, s.client_secret], form: { grant_type: 'password', username: k.imp.utente, password: s.password } });
  if (!r.ok || !r.json?.access_token) { token.delete(chiave); throw no(r, 'l\'accesso (controlla utente, password, client id e secret)'); }
  token.set(chiave, { access: r.json.access_token, scade: Date.now() + Number(r.json.expires_in || 3600) * 1000 });
  return r.json.access_token;
}
const opz = async (k, json) => ({ bearer: await tok(k), ...(json ? { json } : {}) });
// un numero di cellulare italiano (+393…) diventa prefisso e numero; gli altri non passano
function cellulare(k, c) {
  const t = k.campo('clienti', 'telefono') && e164(k.valore(c, 'clienti', 'telefono'));
  return t && /^\+393\d{8,9}$/.test(t) ? { MobilePrefix: '39', MobileNumber: t.slice(3) } : {};
}
// un cliente nella lista: → 'iscritto' | 'disiscritto' | 'senza email' | 'senza consenso'
async function iscrivi(k, c) {
  const email = String(k.valore(c, 'clienti', 'email') || '').trim().toLowerCase();
  if (!email) return 'senza email';
  if (conConsenso(k) && k.valore(c, 'clienti', 'consenso') !== true) {
    const id = k.sincro.remoto('clienti', c.id); if (!id) return 'senza consenso';
    const r = await k.http.delete(api(k, `List/${lista(k)}/Unsubscribe/${encodeURIComponent(id)}`), await opz(k));
    if (!r.ok && r.stato !== 404) throw no(r, `la disiscrizione di ${email}`);
    return 'disiscritto';
  }
  const n = String(k.valore(c, 'clienti', 'nome') || '').trim(), { nome, cognome } = spezza(n);
  const json = { Name: n || email, Email: email, ...cellulare(k, c), Fields: [{ Id: 1, Value: nome }, { Id: 2, Value: cognome }] };
  const r = await k.http.post(api(k, `List/${lista(k)}/Recipient`), await opz(k, json));
  if (!r.ok) throw no(r, `l'iscrizione di ${email}`);
  const id = r.json?.idRecipient ?? r.json; if (id != null && /^\d+$/.test(String(id))) k.sincro.collega('clienti', c.id, String(id));
  return 'iscritto';
}
// i disiscritti della lista (MailUp non dice quando): chi in Kubo ha ancora il consenso lo perde
async function disiscritti(k) {
  if (!conConsenso(k)) return 0; let n = 0;
  for (let p = 0; p < 20; p++) {
    const r = await k.http.get(api(k, `List/${lista(k)}/Recipients/Unsubscribed?pageSize=100&pageNumber=${p}`), await opz(k));
    if (!r.ok) throw no(r, 'l\'elenco dei disiscritti');
    const voci = r.json?.Items || [];
    for (const s of voci) {
      const c = k.dati.trova('clienti', 'email', String(s.Email || '').trim().toLowerCase());
      if (c && k.valore(c, 'clienti', 'consenso') !== false) { k.dati.modifica('clienti', c.id, { consenso: false }); n++; }
    }
    if (voci.length < 100 || (p + 1) * 100 >= Number(r.json?.TotalElementsCount || 0)) break;
  }
  return n;
}
async function sincronizza(k, { tutto = false } = {}) {
  const e = k.entita('clienti'); if (tutto) k.stato.scrivi(`cursore:${e}`, null);
  const { righe, salva } = cambiate(k, e), conti = { iscritti: 0, saltati: 0 };
  for (const c of righe) { (await iscrivi(k, c)) === 'iscritto' ? conti.iscritti++ : conti.saltati++; salva(c.modificato); }
  return { ...conti, disiscritti: await disiscritti(k) };
}
export default {
  id: 'mailup', nome: 'MailUp', versione: 1, icona: 'utenti',
  descrizione: 'I clienti con il consenso iscritti a una lista di MailUp; chi si disiscrive torna in Kubo senza consenso.',
  impostazioni: [
    { id: 'utente', nome: 'Utente della console MailUp (es. m12345)', schema: /^[A-Za-z0-9._@-]{3,80}$/ },
    { id: 'password', nome: 'Password della console MailUp', segreto: true },
    { id: 'client_id', nome: 'Client ID delle chiavi API', schema: /^[A-Za-z0-9-]{8,80}$/ },
    { id: 'client_secret', nome: 'Client secret delle chiavi API', segreto: true },
    { id: 'lista', nome: 'Id della lista (il numero in Impostazioni → Liste)', schema: /^\d{1,9}$/, predefinito: '1' },
  ],
  richiede: { clienti: { nome: {}, email: { tipo: ['email'] }, telefono: { tipo: ['telefono', 'testo'], facoltativo: true }, consenso: { tipo: ['si_no'], facoltativo: true } } },
  permessi: { clienti: { leggi: true, modifica: true } },   // modifica: solo il consenso di chi si disiscrive
  prova: async k => {
    const r = await k.http.get(api(k, 'User/Lists?pageSize=100'), await opz(k)); if (!r.ok) return { ok: false, messaggio: `HTTP ${r.stato}` };
    const l = (r.json?.Items || []).find(x => String(x.idList ?? x.IdList) === String(k.imp.lista || '1'));
    return { ok: !!l, messaggio: l ? `Lista «${l.Name}»` : `La lista ${k.imp.lista || '1'} non c'è` };
  },
  uscita: { clienti: { campi: ['nome', 'email', 'telefono', 'consenso'], quando: (r, k) => !!k.valore(r, 'clienti', 'email'), invia: async (riga, k) => { await iscrivi(k, riga); } } },
  pianificati: { sincronizza: { nome: 'Clienti cambiati e disiscritti', ogni: '30m', giro: k => sincronizza(k) } },
  azioni: {
    sincronizza_ora: {
      nome: 'Sincronizza ora con MailUp', descrizione: 'Ripassa tutti i clienti con il consenso e legge chi si è disiscritto dalla lista', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Sincronizza con MailUp', righe: [['Clienti', 'tutti (con email' + (conConsenso(k) ? ' e consenso)' : ')')], ['Lista', String(k.imp.lista || '1')]], avvisi: conConsenso(k) ? [] : ['La sezione clienti non ha il campo del consenso: passano tutti i clienti con email'] }),
      esegui: async (x, k) => sincronizza(k, { tutto: true }),
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.mailup.it', costo: 'abbonamento',
    costoNota: 'Prova gratuita di 30 giorni; piani a invii illimitati per numero di contatti: Basic da circa 75 € al mese (fino a 2.500 contatti, IVA esclusa); l\'API è compresa in tutti i piani. Gli SMS si comprano a parte.',
    serve: [
      { cosa: 'Utente e password della console (es. m12345)', dove: 'Sono quelli con cui entri in MailUp', link: 'https://login.mailup.com' },
      { cosa: 'Client ID e Client secret', dove: 'MailUp → Impostazioni → Impostazioni avanzate → Codici sviluppatore (Developer\'s corner) → Chiavi API: «Crea»', link: 'https://help.mailup.com/display/mailupapi/Get+a+Developer+Account' },
      { cosa: 'L\'id della lista', dove: 'Impostazioni → Liste: il numero (ID) accanto al nome della lista', link: 'https://help.mailup.com/display/MUG/Lists' },
    ],
    passi: [
      'In MailUp apri Impostazioni → Impostazioni avanzate → Codici sviluppatore e crea le chiavi API: copia Client ID e Client secret.',
      'In Impostazioni → Liste guarda l\'ID della lista dove vuoi i clienti (di solito 1).',
      'Incolla utente, password, Client ID, Client secret e id della lista; premi «Prova la connessione».',
      'Premi «Sincronizza ora con MailUp»: passano i clienti con email e consenso (i cellulari italiani anche per gli SMS).',
      'Da lì ogni cliente nuovo o cambiato va subito nella lista, e ogni 30 minuti chi si disiscrive perde il consenso in Kubo.',
    ],
    difficolta: 'media', zone: ['IT', 'UE'],
    fonti: ['https://help.mailup.com/display/mailupapi/Authenticating+with+OAuth+v2', 'https://help.mailup.com/display/mailupapi/Recipients', 'https://help.mailup.com/display/mailupapi/Lists+and+Groups', 'https://www.mailup.it/prezzi/'],
    prova: 'finto', parole: ['mailup', 'newsletter', 'email marketing', 'sms marketing', 'liste', 'lists', 'iscritti', 'subscribers', 'consenso', 'gdpr'],
  },
  testi: {
    en: { nome: 'MailUp', descrizione: 'Customers with consent subscribed to a MailUp list; unsubscribes come back to Kubo without consent.', 'imp.utente': 'MailUp console username (e.g. m12345)', 'imp.password': 'MailUp console password', 'imp.client_id': 'API keys client ID', 'imp.client_secret': 'API keys client secret', 'imp.lista': 'List id (the number in Settings → Lists)', 'az.sincronizza_ora': 'Sync now with MailUp', 'giro.sincronizza': 'Changed customers and unsubscribes',
      'cat.costoNota': '30-day free trial; unlimited-sending plans priced by contacts: Basic from about €75 per month (up to 2,500 contacts, VAT excluded); the API is included in every plan. SMS are bought separately.',
      'cat.serve': [{ cosa: 'Console username and password (e.g. m12345)', dove: 'The ones you use to log into MailUp' }, { cosa: 'Client ID and Client secret', dove: 'MailUp → Settings → Advanced settings → Developer\'s corner → API keys: «Create»' }, { cosa: 'The list id', dove: 'Settings → Lists: the number (ID) next to the list name' }],
      'cat.passi': ['In MailUp open Settings → Advanced settings → Developer\'s corner and create the API keys: copy Client ID and Client secret.', 'In Settings → Lists check the ID of the list for your customers (usually 1).', 'Paste username, password, Client ID, Client secret and list id; press «Test connection».', 'Press «Sync now with MailUp»: customers with email and consent go over (Italian mobiles also for SMS).', 'From then on every new or changed customer goes to the list at once, and every 30 minutes those who unsubscribe lose consent in Kubo.'] },
    es: { nome: 'MailUp', descrizione: 'Los clientes con consentimiento suscritos a una lista de MailUp; las bajas vuelven a Kubo sin consentimiento.', 'imp.utente': 'Usuario de la consola MailUp (p. ej. m12345)', 'imp.password': 'Contraseña de la consola MailUp', 'imp.client_id': 'Client ID de las claves API', 'imp.client_secret': 'Client secret de las claves API', 'imp.lista': 'Id de la lista (el número en Ajustes → Listas)', 'az.sincronizza_ora': 'Sincronizar ahora con MailUp', 'giro.sincronizza': 'Clientes cambiados y bajas' },
    fr: { nome: 'MailUp', descrizione: 'Les clients avec consentement inscrits à une liste MailUp ; les désinscriptions reviennent dans Kubo sans consentement.', 'imp.utente': 'Utilisateur de la console MailUp (ex. m12345)', 'imp.password': 'Mot de passe de la console MailUp', 'imp.client_id': 'Client ID des clés API', 'imp.client_secret': 'Client secret des clés API', 'imp.lista': 'Id de la liste (le numéro dans Paramètres → Listes)', 'az.sincronizza_ora': 'Synchroniser maintenant avec MailUp', 'giro.sincronizza': 'Clients modifiés et désinscriptions' },
    de: { nome: 'MailUp', descrizione: 'Kunden mit Einwilligung in einer MailUp-Liste; Abmeldungen kommen ohne Einwilligung zurück in Kubo.', 'imp.utente': 'Benutzer der MailUp-Konsole (z. B. m12345)', 'imp.password': 'Passwort der MailUp-Konsole', 'imp.client_id': 'Client-ID der API-Schlüssel', 'imp.client_secret': 'Client-Secret der API-Schlüssel', 'imp.lista': 'Listen-ID (die Nummer unter Einstellungen → Listen)', 'az.sincronizza_ora': 'Jetzt mit MailUp abgleichen', 'giro.sincronizza': 'Geänderte Kunden und Abmeldungen' },
    pt: { nome: 'MailUp', descrizione: 'Os clientes com consentimento inscritos numa lista do MailUp; os cancelamentos voltam ao Kubo sem consentimento.', 'imp.utente': 'Utilizador da consola MailUp (ex. m12345)', 'imp.password': 'Palavra-passe da consola MailUp', 'imp.client_id': 'Client ID das chaves API', 'imp.client_secret': 'Client secret das chaves API', 'imp.lista': 'Id da lista (o número em Definições → Listas)', 'az.sincronizza_ora': 'Sincronizar agora com o MailUp', 'giro.sincronizza': 'Clientes alterados e cancelamentos' },
  },
};
