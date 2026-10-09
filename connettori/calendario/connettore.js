// Calendario: l'agenda di Kubo sul telefono. Due strade:
// - il feed .ics (RFC 5545) a un indirizzo segreto, in sola lettura: si aggiunge su iPhone, Android, Outlook, Google
//   («aggiungi calendario da URL»). Nessun account, nessuna chiave: il 90% del valore con il 10% della fatica;
// - Google Calendar con OAuth (codice + PKCE, accesso offline): ogni appuntamento nuovo o spostato va nel calendario scelto.
// Il feed contiene nomi di clienti: l'indirizzo è un segreto, si rigenera spegnendo e togliendo il codice.
import { timingSafeEqual } from 'node:crypto';
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const piega = l => { const out = []; let s = l; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = ' ' + s.slice(n); } out.push(s); return out.join('\r\n'); };
// il titolo di un appuntamento: i titoli delle relazioni (servizio, cliente…), altrimenti il nome della sezione
function titolo(k, def, r) {
  const t = def.campi.filter(c => c.tipo === 'relazione' && !c.archiviato && r[c.id]?.titolo).map(c => r[c.id].titolo);
  return t.join(' · ') || def.nome;
}
function eventi(k) {
  const sem = 'appuntamenti', def = k.S.leggi(k.db, k.entita(sem)), quando = k.campo(sem, 'quando'); if (!def || !quando) return [];
  const da = new Date(Date.now() - 30 * 864e5).toISOString(), min = Number(k.imp.durata || 60);
  return k.dati.elenca(sem, { filtri: [{ campo: 'quando', op: '>=', valore: da }], ordina: [{ campo: quando, dir: 'asc' }], perPagina: 500 }).righe
    .filter(r => r[quando]).map(r => ({ id: r.id, inizio: r[quando], fine: new Date(Date.parse(r[quando]) + min * 6e4).toISOString(), titolo: titolo(k, def, r), modificato: r.modificato }));
}
// il codice del feed si confronta a tempo costante (come le firme dei webhook)
const stesso = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && timingSafeEqual(x, y); };
const gbase = k => k.base || 'https://www.googleapis.com';
export default {
  id: 'calendario', nome: 'Calendario', versione: 1, icona: 'calendario',
  descrizione: 'L\'agenda sul telefono: feed .ics da aggiungere al calendario, oppure Google Calendar.',
  catalogo: { categoria: 'calendario', sito: 'https://calendar.google.com', costo: 'gratis', costoNota: 'Il feed .ics e Google Calendar sono gratuiti', serve: [{ cosa: 'Niente per il feed .ics: l\'indirizzo segreto lo crea Kubo', dove: 'In questa pagina, dopo l\'accensione' }, { cosa: 'Per Google Calendar (facoltativo): client ID e client secret OAuth', dove: 'Google Cloud Console → API e servizi → Credenziali → ID client OAuth (applicazione web)', link: 'https://console.cloud.google.com/apis/credentials' }], passi: ['Accendi: Kubo crea l\'indirizzo segreto del feed', 'Copia l\'indirizzo e aggiungilo al calendario del telefono («Iscriviti a un calendario»)', 'Per Google Calendar: in Google Cloud Console abilita la Google Calendar API e crea un ID client OAuth', 'Come URI di reindirizzamento metti l\'indirizzo di Kubo seguito da /api/connettori/calendario/oauth/ritorno', 'Incolla client ID e client secret qui e premi «Collega l\'account»'], difficolta: 'facile', zone: ['IT', 'UE', 'mondo'], fonti: ['https://www.rfc-editor.org/rfc/rfc5545', 'https://developers.google.com/calendar/api/guides/overview', 'https://developers.google.com/identity/protocols/oauth2/web-server'], prova: 'finto', parole: ['agenda', 'ics', 'google calendar', 'appuntamenti', 'iphone', 'android'] },
  impostazioni: [
    { id: 'feed', nome: 'Codice segreto del feed', segreto: true, generato: true },
    { id: 'durata', nome: 'Durata di un appuntamento (minuti)', tipo: 'numero', predefinito: 60 },
    { id: 'google', nome: 'Calendario Google (id, «primary» = il principale)', predefinito: 'primary' },
    { id: 'client_id', nome: 'Google: client ID OAuth', segreto: true, obbligatorio: false }, { id: 'client_secret', nome: 'Google: client secret', segreto: true, obbligatorio: false },
  ],
  richiede: { appuntamenti: { quando: { tipo: ['data_ora'] } } },
  permessi: { appuntamenti: { leggi: true } },
  oauth: { tipo: 'codice', autorizza: 'https://accounts.google.com/o/oauth2/v2/auth', token: k => (k.base ? `${k.base}/token` : 'https://oauth2.googleapis.com/token'),
    scope: 'https://www.googleapis.com/auth/calendar.events', extra: { access_type: 'offline', prompt: 'consent' } },
  pubbliche: {
    // GET /api/connettori/calendario/pub/agenda.ics?t=<codice segreto>
    'agenda.ics': async ({ q, k }) => {
      const s = k.segreti.feed; if (!s || !stesso(q.get('t'), s)) return null;
      const righe = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kubo//Agenda//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(k.db.prepare("SELECT valore FROM _meta WHERE chiave = 'azienda'").get()?.valore || 'Kubo')}`];
      for (const e of eventi(k)) righe.push('BEGIN:VEVENT', `UID:${e.id}@kubo`, `DTSTAMP:${utc(e.modificato || Date.now())}`, `DTSTART:${utc(e.inizio)}`, `DTEND:${utc(e.fine)}`, `SUMMARY:${esc(e.titolo)}`, 'END:VEVENT');
      righe.push('END:VCALENDAR');
      return { tipo: 'text/calendar; charset=utf-8', corpo: righe.map(piega).join('\r\n') + '\r\n' };
    },
  },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: true, messaggio: null };   // solo il feed: niente da provare fuori
    const r = await k.http.get(`${gbase(k)}/calendar/v3/calendars/${encodeURIComponent(k.imp.google)}`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? r.json?.summary : `HTTP ${r.stato}` };
  },
  uscita: { appuntamenti: { campi: ['quando'], quando: (r, k) => k.oauth.collegato(), async invia(riga, k) {
    const quando = k.valore(riga, 'appuntamenti', 'quando'); if (!quando) return;
    const def = k.S.leggi(k.db, k.entita('appuntamenti')), min = Number(k.imp.durata || 60), rid = k.sincro.remoto('appuntamenti', riga.id);
    const corpo = { summary: titolo(k, def, riga), start: { dateTime: quando }, end: { dateTime: new Date(Date.parse(quando) + min * 6e4).toISOString() } };
    const url = `${gbase(k)}/calendar/v3/calendars/${encodeURIComponent(k.imp.google)}/events${rid ? '/' + encodeURIComponent(rid) : ''}`;
    const r = await (rid ? k.http.patch : k.http.post)(url, { bearer: await k.oauth.token(), json: corpo });
    if (!r.ok) throw new Error(`Google Calendar ha risposto ${r.stato}`);
    if (!rid && r.json?.id) k.sincro.collega('appuntamenti', riga.id, r.json.id);
  } } },
  testi: {
    en: { 'cat.costoNota': 'The .ics feed and Google Calendar are free', 'cat.serve': [{ cosa: 'Nothing for the .ics feed: Kubo creates the secret address', dove: 'On this page, after switching it on' }, { cosa: 'For Google Calendar (optional): OAuth client ID and client secret', dove: 'Google Cloud Console → APIs & Services → Credentials → OAuth client ID (web application)' }], 'cat.passi': ['Switch it on: Kubo creates the secret feed address', 'Copy the address and add it to your phone calendar («Subscribe to a calendar»)', 'For Google Calendar: in Google Cloud Console enable the Google Calendar API and create an OAuth client ID', 'As the redirect URI use Kubo\'s address followed by /api/connettori/calendario/oauth/ritorno', 'Paste the client ID and client secret here and press «Connect the account»'],
      nome: 'Calendar', descrizione: 'Your schedule on your phone: an .ics feed to add to your calendar, or Google Calendar.', 'imp.feed': 'Feed secret code', 'imp.durata': 'Appointment length (minutes)', 'imp.google': 'Google calendar (id, «primary» = the main one)', 'imp.client_id': 'Google: OAuth client ID', 'imp.client_secret': 'Google: client secret' },
    es: { nome: 'Calendario', descrizione: 'La agenda en el móvil: feed .ics para añadir al calendario, o Google Calendar.', 'imp.feed': 'Código secreto del feed', 'imp.durata': 'Duración de una cita (minutos)', 'imp.google': 'Calendario de Google (id, «primary» = el principal)', 'imp.client_id': 'Google: client ID de OAuth', 'imp.client_secret': 'Google: client secret' },
    fr: { nome: 'Calendrier', descrizione: 'L\'agenda sur le téléphone : flux .ics à ajouter au calendrier, ou Google Agenda.', 'imp.feed': 'Code secret du flux', 'imp.durata': 'Durée d\'un rendez-vous (minutes)', 'imp.google': 'Agenda Google (id, « primary » = le principal)', 'imp.client_id': 'Google : client ID OAuth', 'imp.client_secret': 'Google : client secret' },
    de: { nome: 'Kalender', descrizione: 'Der Terminkalender auf dem Handy: .ics-Feed zum Abonnieren oder Google Kalender.', 'imp.feed': 'Geheimcode des Feeds', 'imp.durata': 'Dauer eines Termins (Minuten)', 'imp.google': 'Google-Kalender (ID, „primary“ = der Hauptkalender)', 'imp.client_id': 'Google: OAuth-Client-ID', 'imp.client_secret': 'Google: Client-Secret' },
    pt: { nome: 'Calendário', descrizione: 'A agenda no celular: feed .ics para adicionar ao calendário, ou Google Agenda.', 'imp.feed': 'Código secreto do feed', 'imp.durata': 'Duração de um agendamento (minutos)', 'imp.google': 'Agenda Google (id, «primary» = a principal)', 'imp.client_id': 'Google: client ID OAuth', 'imp.client_secret': 'Google: client secret' },
  },
};
