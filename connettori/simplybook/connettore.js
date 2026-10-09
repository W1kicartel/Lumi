// SimplyBook.me (centri estetici, parrucchieri, studi): le prenotazioni diventano appuntamenti di Lumi, con il cliente
// (per email o telefono, altrimenti creato). Spostamenti e annullamenti seguono.
// - API JSON-RPC «admin»: getUserToken(azienda, utente, chiave utente API o password) su /login, poi le chiamate su /admin
//   con le intestazioni X-Company-Login e X-User-Token (getBookingDetails, getBookings).
// - Callback dell'API (create, change, cancel, notify) non firmata: { booking_id, booking_hash, company, notification_type }.
//   L'indirizzo porta in fondo un codice segreto generato da Lumi (/in/<codice>); la prenotazione si rilegge dall'API.
// - Senza indirizzo pubblico: un giro ogni 15 minuti legge le prenotazioni dei prossimi 60 giorni e quelle annullate.
import { REQ, PERMESSI, ricevi, annulla, conta, webhookDi } from '../_comunica/agenda.js';
import { daLocale } from '../_comunica/caldav.js';
const api = k => k.base || 'https://user-api.simplybook.me';
const tokens = new Map();
async function rpc(k, metodo, params = [], { admin = true, nuovo = false } = {}) {
  const intestazioni = { 'X-Company-Login': k.imp.azienda };
  if (admin) intestazioni['X-User-Token'] = await token(k, nuovo);
  const r = await k.http.post(`${api(k)}/${admin ? 'admin' : 'login'}`, { json: { jsonrpc: '2.0', method: metodo, params, id: 1 }, intestazioni });
  // un token scaduto: se ne chiede uno nuovo, una volta
  if (admin && !nuovo && (r.stato === 401 || /token/i.test(r.json?.error?.message || ''))) return rpc(k, metodo, params, { admin, nuovo: true });
  if (!r.ok || r.json?.error) throw new Error(`SimplyBook ha risposto ${r.stato}${r.json?.error?.message ? ': ' + r.json.error.message : ''} a ${metodo}`);
  return r.json?.result;
}
async function token(k, nuovo) {
  const chiave = `${k.base}|${k.imp.azienda}|${k.imp.utente}`, t = tokens.get(chiave);
  if (!nuovo && t && t.scade > Date.now()) return t.valore;
  const v = await rpc(k, 'getUserToken', [k.imp.azienda, k.imp.utente, k.segreti.chiave], { admin: false });
  if (!v) throw new Error('SimplyBook non dà l\'accesso: controlla login dell\'azienda, utente e chiave');
  tokens.set(chiave, { valore: v, scade: Date.now() + 30 * 6e4 });
  return v;
}
// «2026-10-20 10:00:00» nel fuso dell'azienda → ISO
const daSb = (s, fuso) => s ? daLocale(String(s).replace(/[-:]/g, '').replace(' ', 'T'), fuso) : null;
const annullata = b => String(b.is_confirm ?? b.is_confirmed ?? '1') === '0' || /cancel/i.test(String(b.status || ''));
const note = b => [`SimplyBook: ${b.event_name || b.event || 'prenotazione'}${b.unit_name || b.unit ? ` · ${b.unit_name || b.unit}` : ''}${b.code ? ` (${b.code})` : ''}`,
  b.comment, ...Object.values(b.additional_fields || {}).filter(x => x?.value).map(x => `${x.field_title || x.title || x.name}: ${x.value}`)].filter(Boolean).join('\n');
export function riceviSimplybook(k, b) {
  if (annullata(b)) return annulla(k, String(b.id));
  return ricevi(k, { remoto: String(b.id), quando: daSb(b.start_date_time || b.start_date, k.fuso()), servizio: b.event_name || b.event, note: note(b), creaClienti: k.imp.clienti !== false,
    cliente: { email: b.client_email, nome: b.client_name || b.client, telefono: b.client_phone } });
}
async function giro(k) {
  const conti = { creati: 0, spostati: 0, uguali: 0, saltati: 0, annullati: 0 }, oggi = new Date().toISOString().slice(0, 10), fino = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const tutte = await rpc(k, 'getBookings', [{ date_from: oggi, date_to: fino, booking_type: 'non_cancelled', order: 'date_start_asc' }]);
  for (const b of Object.values(tutte || {})) conta(conti, riceviSimplybook(k, b));
  const via = await rpc(k, 'getBookings', [{ date_from: oggi, date_to: fino, booking_type: 'cancelled' }]);
  for (const b of Object.values(via || {})) if (annulla(k, String(b.id)) === 'annullato') conti.annullati++;
  return conti;
}

export default {
  id: 'simplybook', nome: 'SimplyBook.me', versione: 1, icona: 'calendario',
  descrizione: 'Le prenotazioni di SimplyBook.me diventano appuntamenti, con il cliente.',
  impostazioni: [
    { id: 'azienda', nome: 'Login dell\'azienda (quello di nome.simplybook.it)', schema: /^[\w-]{2,80}$/ },
    { id: 'utente', nome: 'Utente amministratore' },
    { id: 'chiave', nome: 'Chiave utente API (api_user_key_…) o password', segreto: true },
    { id: 'codice', nome: 'Codice segreto dell\'indirizzo della callback', segreto: true, generato: true },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Lumi (es. https://lumi.centroesteticorossi.it)', tipo: 'url', obbligatorio: false },
    { id: 'clienti', nome: 'Crea il cliente se non c\'è', tipo: 'si_no', predefinito: true },
  ],
  richiede: REQ, permessi: PERMESSI,
  prova: async k => { await token(k, true); return { ok: true, messaggio: `Accesso a ${k.imp.azienda} riuscito` }; },
  pianificati: { prenotazioni: { nome: 'Prenotazioni dei prossimi 60 giorni', ogni: '15m', giro } },
  entrata: {
    firma: { tipo: 'token', segreto: 'codice' },   // /api/connettori/simplybook/in/<codice segreto>
    async gestisci(ev, k) {
      const tipo = String(ev?.notification_type || ''), id = String(ev?.booking_id || '');
      if (!['create', 'change', 'cancel', 'notify'].includes(tipo) || !/^\d+$/.test(id)) return 'ignorato';
      if (ev.company && String(ev.company).toLowerCase() !== String(k.imp.azienda).toLowerCase()) return 'ignorato: altra azienda';
      if (tipo === 'cancel') return annulla(k, id);
      return riceviSimplybook(k, (await rpc(k, 'getBookingDetails', [id])) || {});
    },
  },
  azioni: {
    indirizzo_callback: {
      nome: 'Indirizzo da dare a SimplyBook', descrizione: 'L\'indirizzo (con il codice segreto) da incollare nella Callback URL dell\'API di SimplyBook',
      async esegui(a, k) { return { indirizzo: `${webhookDi(k, 'simplybook', true)}/${k.segreti.codice}`, avvisi: [] }; },
    },
    leggi_prenotazioni: {
      nome: 'Leggi le prenotazioni adesso', descrizione: 'Porta in agenda le prenotazioni di SimplyBook dei prossimi 60 giorni e segna quelle annullate', lumi: true, scrive: true,
      proponi: async () => ({ titolo: 'Prenotazioni da SimplyBook', righe: [['Periodo', 'oggi + 60 giorni']], avvisi: ['Le prenotazioni nuove diventano appuntamenti, gli annullamenti si segnano'] }),
      esegui: async (x, k) => giro(k),
    },
  },
  catalogo: {
    categoria: 'prenotazioni', sito: 'https://simplybook.me', costo: 'abbonamento',
    costoNota: 'Piano Free gratuito (50 prenotazioni al mese); Basic 11,90 € al mese con pagamento annuale (13,90 € mese per mese, 100 prenotazioni), Standard 24,90 € (500), Premium 49,90 € (2.000). La funzione API va attivata tra le Funzioni personalizzate: controlla che il tuo piano la includa.',
    serve: [
      { cosa: 'Il login dell\'azienda e un utente amministratore con una chiave utente API (o la sua password)', dove: 'SimplyBook → Impostazioni → Funzioni personalizzate → API (attiva) → Impostazioni → chiave utente API', link: 'https://simplybook.me/en/api/developer-api' },
      { cosa: 'Per avere le prenotazioni subito: un indirizzo pubblico di Lumi con HTTPS, da incollare in Callback URL', dove: 'Funzioni personalizzate → API → Impostazioni → Callback URL, con «create», «change» e «cancel» attivi', link: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/' },
    ],
    passi: ['Su SimplyBook apri Funzioni personalizzate e attiva «API».', 'Nelle impostazioni dell\'API crea una chiave utente API per un amministratore.', 'Incolla qui il login dell\'azienda, l\'utente e la chiave, poi premi «Prova la connessione».', 'Premi «Leggi le prenotazioni adesso»: arrivano quelle dei prossimi 60 giorni, poi ogni 15 minuti.', 'Con un indirizzo pubblico (scrivilo qui; se l\'hai impostato nella Libreria, puoi lasciarlo vuoto): premi «Indirizzo da dare a SimplyBook» e incollalo in Callback URL, con create, change e cancel.', 'Fai una prenotazione di prova: compare tra gli appuntamenti, con il cliente.'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://simplybook.me/en/api/developer-api/tab/guide_api', 'https://simplybook.me/en/api/developer-api/tab/doc_api', 'https://help.simplybook.me/index.php/Company_administration_service_methods', 'https://tech-support.simplybook.me/t/116-simplybook-me-not-calling-callback-url/120', 'https://simplybook.me/en/pricing'],
    prova: 'finto', parole: ['simplybook', 'simplybook.me', 'prenotazioni', 'prenotazione online', 'centro estetico', 'parrucchiere', 'booking', 'appuntamenti', 'scheduling'],
  },
  testi: {
    en: { nome: 'SimplyBook.me', descrizione: 'SimplyBook.me bookings become appointments, with the customer.', 'imp.azienda': 'Company login (the one in name.simplybook.it)', 'imp.utente': 'Admin user', 'imp.chiave': 'API user key (api_user_key_…) or password', 'imp.codice': 'Secret code of the callback address', 'imp.indirizzo': 'Public address of Lumi (e.g. https://lumi.mysalon.com)', 'imp.clienti': 'Create the customer if missing', 'az.indirizzo_callback': 'Address to give SimplyBook', 'az.leggi_prenotazioni': 'Read the bookings now', 'giro.prenotazioni': 'Bookings of the next 60 days',
      'cat.costoNota': 'Free plan (50 bookings a month); Basic €11.90 a month billed yearly (€13.90 month to month, 100 bookings), Standard €24.90 (500), Premium €49.90 (2,000). The API feature must be turned on among the Custom Features: check that your plan includes it.',
      'cat.serve': [{ cosa: 'The company login and an admin user with an API user key (or their password)', dove: 'SimplyBook → Settings → Custom Features → API (enable) → Settings → API user key' }, { cosa: 'To get bookings instantly: a public HTTPS address for Lumi, to paste into Callback URL', dove: 'Custom Features → API → Settings → Callback URL, with «create», «change» and «cancel» on' }],
      'cat.passi': ['In SimplyBook open Custom Features and enable «API».', 'In the API settings create an API user key for an admin.', 'Paste the company login, the user and the key here, then press «Test connection».', 'Press «Read the bookings now»: those of the next 60 days arrive, then every 15 minutes.', 'With a public address (enter it here; if you set it in the Library, you can leave it empty): press «Address to give SimplyBook» and paste it into Callback URL, with create, change and cancel.', 'Make a test booking: it shows up among the appointments, with the customer.'] },
    es: { nome: 'SimplyBook.me', descrizione: 'Las reservas de SimplyBook.me se convierten en citas, con el cliente.', 'imp.azienda': 'Login de la empresa (el de nombre.simplybook.it)', 'imp.utente': 'Usuario administrador', 'imp.chiave': 'Clave de usuario API (api_user_key_…) o contraseña', 'imp.codice': 'Código secreto de la dirección de callback', 'imp.indirizzo': 'Dirección pública de Lumi (p. ej. https://lumi.misalon.es)', 'imp.clienti': 'Crear el cliente si no existe', 'az.indirizzo_callback': 'Dirección para SimplyBook', 'az.leggi_prenotazioni': 'Leer las reservas ahora', 'giro.prenotazioni': 'Reservas de los próximos 60 días' },
    fr: { nome: 'SimplyBook.me', descrizione: 'Les réservations SimplyBook.me deviennent des rendez-vous, avec le client.', 'imp.azienda': 'Login de l\'entreprise (celui de nom.simplybook.it)', 'imp.utente': 'Utilisateur administrateur', 'imp.chiave': 'Clé utilisateur API (api_user_key_…) ou mot de passe', 'imp.codice': 'Code secret de l\'adresse de callback', 'imp.indirizzo': 'Adresse publique de Lumi (ex. https://lumi.monsalon.fr)', 'imp.clienti': 'Créer le client s\'il n\'existe pas', 'az.indirizzo_callback': 'Adresse à donner à SimplyBook', 'az.leggi_prenotazioni': 'Lire les réservations maintenant', 'giro.prenotazioni': 'Réservations des 60 prochains jours' },
    de: { nome: 'SimplyBook.me', descrizione: 'SimplyBook.me-Buchungen werden zu Terminen, mit dem Kunden.', 'imp.azienda': 'Firmen-Login (das aus name.simplybook.it)', 'imp.utente': 'Administrator-Benutzer', 'imp.chiave': 'API-Benutzerschlüssel (api_user_key_…) oder Passwort', 'imp.codice': 'Geheimer Code der Callback-Adresse', 'imp.indirizzo': 'Öffentliche Adresse von Lumi (z. B. https://lumi.meinsalon.de)', 'imp.clienti': 'Kunden anlegen, falls er fehlt', 'az.indirizzo_callback': 'Adresse für SimplyBook', 'az.leggi_prenotazioni': 'Buchungen jetzt lesen', 'giro.prenotazioni': 'Buchungen der nächsten 60 Tage' },
    pt: { nome: 'SimplyBook.me', descrizione: 'As reservas do SimplyBook.me viram agendamentos, com o cliente.', 'imp.azienda': 'Login da empresa (o de nome.simplybook.it)', 'imp.utente': 'Usuário administrador', 'imp.chiave': 'Chave de usuário API (api_user_key_…) ou senha', 'imp.codice': 'Código secreto do endereço de callback', 'imp.indirizzo': 'Endereço público do Lumi (ex. https://lumi.meusalao.com)', 'imp.clienti': 'Criar o cliente se não existir', 'az.indirizzo_callback': 'Endereço para o SimplyBook', 'az.leggi_prenotazioni': 'Ler as reservas agora', 'giro.prenotazioni': 'Reservas dos próximos 60 dias' },
  },
};
