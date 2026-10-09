// CalDAV: l'agenda di Lumi allineata nei due sensi con un calendario CalDAV: iCloud (password per app), Nextcloud,
// Fastmail, Synology, Radicale, Baïkal…
// - Lumi → calendario: un appuntamento nuovo o spostato diventa un VEVENT (PUT con If-None-Match: * o If-Match: <etag>);
//   annullato, l'evento si cancella. Un evento nato nel calendario si sposta cambiando solo DTSTART/DTEND.
// - calendario → Lumi: ogni 15 minuti un REPORT calendar-query da ieri a 120 giorni; un ETag uguale a quello ricordato
//   vuol dire «niente di nuovo» (così le nostre scritture non tornano indietro); un evento sparito che risponde 404 è annullato.
// Il calendario si trova da solo (current-user-principal → calendar-home-set → il primo che accetta eventi) o si sceglie.
import { caldav, vevento, sposta } from '../_comunica/caldav.js';
import { REQ, PERMESSI, ricevi, annulla, titoloDi, fineDi, annullato, conta } from '../_comunica/agenda.js';
const SEM = 'appuntamenti';
const server = k => k.imp.server || 'https://caldav.icloud.com';
const cli = k => caldav(k.http, { server: server(k), utente: k.imp.utente, password: k.segreti.password });
async function calendario(k) {
  if (k.imp.calendario) return k.imp.calendario;
  const s = k.stato.leggi('calendario'); if (s?.server === server(k) && s.utente === k.imp.utente) return s.url;
  const l = await cli(k).calendari(); if (!l.length) throw new Error('Nessun calendario con eventi su questo account');
  k.stato.scrivi('calendario', { server: server(k), utente: k.imp.utente, url: l[0].url, nome: l[0].nome }); return l[0].url;
}
// gli eventi conosciuti: uid → { u: indirizzo, e: etag, f: visto nella finestra all'ultimo giro }
const visti = k => k.stato.leggi('visti') || {};
const segna = (k, uid, v) => { const x = visti(k); if (v) x[uid] = { ...x[uid], ...v }; else delete x[uid]; k.stato.scrivi('visti', x); };

export default {
  id: 'caldav', nome: 'iCloud, Nextcloud e CalDAV', versione: 1, icona: 'calendario',
  descrizione: 'Agenda di Lumi e calendario di iPhone (iCloud), Nextcloud o un altro CalDAV allineati nei due sensi.',
  impostazioni: [
    { id: 'server', nome: 'Indirizzo CalDAV (iCloud: https://caldav.icloud.com)', tipo: 'url', predefinito: 'https://caldav.icloud.com' },
    { id: 'utente', nome: 'Utente (iCloud: l\'email dell\'ID Apple)' },
    { id: 'password', nome: 'Password per app (iCloud) o password', segreto: true },
    { id: 'calendario', nome: 'Indirizzo del calendario (vuoto = il primo trovato)', tipo: 'url', obbligatorio: false },
    { id: 'durata', nome: 'Durata di un appuntamento senza servizio (minuti)', tipo: 'numero', predefinito: 60 },
    { id: 'importa', nome: 'Gli eventi nuovi del calendario diventano appuntamenti', tipo: 'si_no', predefinito: true },
    { id: 'clienti', nome: 'Crea il cliente dal primo invitato', tipo: 'si_no', predefinito: true },
  ],
  richiede: REQ, permessi: PERMESSI,
  prova: async k => { const l = await cli(k).calendari(); return { ok: l.length > 0, messaggio: l.map(c => c.nome).join(', ') || 'Nessun calendario con eventi' }; },
  azioni: {
    calendari: { nome: 'Elenca i calendari', descrizione: 'I calendari dell\'account CalDAV, con l\'indirizzo da scegliere nelle impostazioni', async esegui(a, k) { return { calendari: await cli(k).calendari() }; } },
  },
  uscita: { appuntamenti: { campi: ['quando', 'stato', 'cliente', 'servizio', 'note'], quando: (r, k) => !!k.imp.utente && !!k.segreti.password, async invia(riga, k) {
    const q = k.valore(riga, SEM, 'quando'); if (!q) return;
    const c = cli(k), cal = await calendario(k); let uid = k.sincro.remoto(SEM, riga.id); const v = uid ? visti(k)[uid] : null;
    if (annullato(k, riga)) { if (v?.u) { await c.togli(v.u, v.e); segna(k, uid, null); } return; }
    uid ||= `lumi-${riga.id}@lumi`;
    const url = v?.u || new URL(`${encodeURIComponent(uid.replace(/@.*$/, ''))}.ics`, cal.endsWith('/') ? cal : cal + '/').href, fine = fineDi(k, riga);
    const nostro = uid.startsWith('lumi-');
    const ics = async () => {
      if (nostro) return vevento({ uid, inizio: q, fine, titolo: titoloDi(k, riga), descrizione: k.valore(riga, SEM, 'note') });
      const g = await c.leggi(url); if (!g.ics) throw new Error(`CalDAV: evento non trovato (${g.stato})`); return { ics: sposta(g.ics, q, fine), etag: g.etag };
    };
    let x = await ics(), corpo = typeof x === 'string' ? x : x.ics, r = await c.metti(url, corpo, typeof x === 'string' ? v?.e : x.etag || v?.e);
    // l'evento è cambiato sul server (o c'è già): si rilegge l'etag e si riprova una volta, poi vince Lumi
    if (r.stato === 412) { const g = await c.leggi(url); r = await c.metti(url, corpo, g.etag || undefined); if (r.stato === 412) throw new Error('CalDAV: l\'evento è cambiato sul server, riprovo più tardi'); }
    k.sincro.collega(SEM, riga.id, uid); segna(k, uid, { u: url, e: r.etag, f: false });
  } } },
  pianificati: { sincronizza: { nome: 'Novità dal calendario', ogni: '15m', async giro(k) {
    if (!k.imp.utente || !k.segreti.password) return { saltato: 'non configurato' };
    const c = cli(k), cal = await calendario(k), conti = { creati: 0, spostati: 0, annullati: 0, uguali: 0, saltati: 0 }, noti = visti(k), ora = new Set();
    const evs = await c.eventi(cal, new Date(Date.now() - 864e5), new Date(Date.now() + 120 * 864e5), k.fuso());
    for (const e of evs) {
      ora.add(e.uid); const prima = noti[e.uid]; noti[e.uid] = { u: e.url, e: e.etag, f: true };
      if (prima?.e && prima.e === e.etag) { conti.uguali++; continue; }
      if (e.stato === 'CANCELLED') { if (annulla(k, e.uid) === 'annullato') conti.annullati++; continue; }
      // gli eventi ripetuti (RRULE) non diventano appuntamenti: un appuntamento è una volta sola
      if (e.tutto || e.ripetuto || !e.inizio || (!k.sincro.locale(SEM, e.uid) && k.imp.importa === false)) continue;
      const p = e.partecipanti[0];
      const x = ricevi(k, { remoto: e.uid, quando: e.inizio, note: [e.titolo, e.descrizione].filter(Boolean).join('\n'), cliente: p ? { email: p.email, nome: p.nome } : null, creaClienti: k.imp.clienti !== false });
      conta(conti, x);
    }
    // spariti dalla finestra: cancellati (404) o solo spostati lontano (si smette di guardarli)
    for (const [uid, v] of Object.entries(noti)) if (v.f && !ora.has(uid)) {
      const g = await c.leggi(v.u);
      if (g.stato === 404 || g.stato === 410) { if (annulla(k, uid) === 'annullato') conti.annullati++; delete noti[uid]; } else noti[uid] = { ...v, f: false };
    }
    k.stato.scrivi('visti', noti);
    return conti;
  } } },
  catalogo: {
    categoria: 'calendario', sito: 'https://www.icloud.com/calendar', costo: 'gratis',
    costoNota: 'Gratis: iCloud (5 GB gratuiti), Nextcloud installato in proprio o un CalDAV del NAS. Fastmail da 5 $ al mese.',
    serve: [
      { cosa: 'iCloud: una password specifica per app (l\'ID Apple deve avere l\'autenticazione a due fattori)', dove: 'account.apple.com → Accesso e sicurezza → Password specifiche per le app → Genera', link: 'https://support.apple.com/it-it/102654' },
      { cosa: 'Nextcloud: l\'indirizzo CalDAV e una password per app', dove: 'Nextcloud → Calendario → Impostazioni del calendario → Copia l\'indirizzo CalDAV primario; Impostazioni personali → Sicurezza → Crea una nuova password per app', link: 'https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_ios.html' },
    ],
    passi: ['iCloud: su account.apple.com apri Accesso e sicurezza → Password specifiche per le app e generane una per «Lumi».', 'Nextcloud: copia l\'indirizzo CalDAV (https://tuo-nextcloud/remote.php/dav) e crea una password per app in Impostazioni → Sicurezza.', 'Scrivi qui indirizzo, utente (per iCloud l\'email dell\'ID Apple) e password per app.', 'Premi «Prova»: compaiono i calendari trovati; se vuoi un calendario preciso, usa «Elenca i calendari» e incollane l\'indirizzo.', 'Accendi: gli appuntamenti vanno nel calendario e ogni 15 minuti Lumi legge le novità.'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://www.rfc-editor.org/rfc/rfc4791', 'https://www.rfc-editor.org/rfc/rfc5545', 'https://www.rfc-editor.org/rfc/rfc6764', 'https://support.apple.com/it-it/102654', 'https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_ios.html'],
    prova: 'finto', parole: ['caldav', 'icloud', 'iphone', 'apple', 'calendario apple', 'nextcloud', 'fastmail', 'synology', 'radicale', 'calendar', 'agenda', 'sync'],
  },
  testi: {
    en: { nome: 'iCloud, Nextcloud and CalDAV', descrizione: 'Lumi\'s schedule and your iPhone (iCloud), Nextcloud or other CalDAV calendar in sync both ways.', 'imp.server': 'CalDAV address (iCloud: https://caldav.icloud.com)', 'imp.utente': 'User (iCloud: the Apple ID email)', 'imp.password': 'App-specific password (iCloud) or password', 'imp.calendario': 'Calendar address (empty = the first one found)', 'imp.durata': 'Length of an appointment without a service (minutes)', 'imp.importa': 'New calendar events become appointments', 'imp.clienti': 'Create the customer from the first attendee', 'az.calendari': 'List the calendars', 'giro.sincronizza': 'News from the calendar',
      'cat.costoNota': 'Free: iCloud (5 GB free), self-hosted Nextcloud or a NAS CalDAV. Fastmail from $5 a month.',
      'cat.passi': ['iCloud: on account.apple.com open Sign-In and Security → App-Specific Passwords and generate one for «Lumi».', 'Nextcloud: copy the CalDAV address (https://your-nextcloud/remote.php/dav) and create an app password under Settings → Security.', 'Enter address, user (for iCloud the Apple ID email) and app password here.', 'Press «Test»: the calendars found are listed; for a specific one use «List the calendars» and paste its address.', 'Turn it on: appointments go to the calendar and every 15 minutes Lumi reads what changed.'],
      'cat.serve': [{ cosa: 'iCloud: an app-specific password (the Apple ID needs two-factor authentication)', dove: 'account.apple.com → Sign-In and Security → App-Specific Passwords → Generate' }, { cosa: 'Nextcloud: the CalDAV address and an app password', dove: 'Nextcloud → Calendar → Calendar settings → Copy primary CalDAV address; Personal settings → Security → Create new app password' }] },
    es: { nome: 'iCloud, Nextcloud y CalDAV', descrizione: 'La agenda de Lumi y el calendario del iPhone (iCloud), Nextcloud u otro CalDAV sincronizados en ambos sentidos.', 'imp.server': 'Dirección CalDAV (iCloud: https://caldav.icloud.com)', 'imp.utente': 'Usuario (iCloud: el email del ID de Apple)', 'imp.password': 'Contraseña de aplicación (iCloud) o contraseña', 'imp.calendario': 'Dirección del calendario (vacío = el primero encontrado)', 'imp.durata': 'Duración de una cita sin servicio (minutos)', 'imp.importa': 'Los eventos nuevos del calendario se convierten en citas', 'imp.clienti': 'Crear el cliente con el primer invitado', 'az.calendari': 'Listar los calendarios', 'giro.sincronizza': 'Novedades del calendario' },
    fr: { nome: 'iCloud, Nextcloud et CalDAV', descrizione: 'L\'agenda de Lumi et le calendrier de l\'iPhone (iCloud), Nextcloud ou un autre CalDAV synchronisés dans les deux sens.', 'imp.server': 'Adresse CalDAV (iCloud : https://caldav.icloud.com)', 'imp.utente': 'Utilisateur (iCloud : l\'e-mail de l\'identifiant Apple)', 'imp.password': 'Mot de passe pour app (iCloud) ou mot de passe', 'imp.calendario': 'Adresse du calendrier (vide = le premier trouvé)', 'imp.durata': 'Durée d\'un rendez-vous sans prestation (minutes)', 'imp.importa': 'Les nouveaux événements du calendrier deviennent des rendez-vous', 'imp.clienti': 'Créer le client à partir du premier invité', 'az.calendari': 'Lister les calendriers', 'giro.sincronizza': 'Nouveautés du calendrier' },
    de: { nome: 'iCloud, Nextcloud und CalDAV', descrizione: 'Lumis Terminkalender und der Kalender von iPhone (iCloud), Nextcloud oder einem anderen CalDAV in beide Richtungen abgeglichen.', 'imp.server': 'CalDAV-Adresse (iCloud: https://caldav.icloud.com)', 'imp.utente': 'Benutzer (iCloud: die E-Mail der Apple-ID)', 'imp.password': 'App-spezifisches Passwort (iCloud) oder Passwort', 'imp.calendario': 'Adresse des Kalenders (leer = der erste gefundene)', 'imp.durata': 'Dauer eines Termins ohne Leistung (Minuten)', 'imp.importa': 'Neue Kalendereinträge werden zu Terminen', 'imp.clienti': 'Kunden aus dem ersten Teilnehmer anlegen', 'az.calendari': 'Kalender auflisten', 'giro.sincronizza': 'Neues aus dem Kalender' },
    pt: { nome: 'iCloud, Nextcloud e CalDAV', descrizione: 'A agenda do Lumi e o calendário do iPhone (iCloud), Nextcloud ou outro CalDAV sincronizados nos dois sentidos.', 'imp.server': 'Endereço CalDAV (iCloud: https://caldav.icloud.com)', 'imp.utente': 'Usuário (iCloud: o email do ID Apple)', 'imp.password': 'Senha de app (iCloud) ou senha', 'imp.calendario': 'Endereço do calendário (vazio = o primeiro encontrado)', 'imp.durata': 'Duração de um agendamento sem serviço (minutos)', 'imp.importa': 'Os novos eventos do calendário viram agendamentos', 'imp.clienti': 'Criar o cliente a partir do primeiro convidado', 'az.calendari': 'Listar os calendários', 'giro.sincronizza': 'Novidades do calendário' },
  },
};
