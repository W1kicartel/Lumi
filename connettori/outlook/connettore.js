// Outlook e Microsoft 365: l'agenda di Kubo e il calendario principale di Outlook allineati nei due sensi, con Microsoft Graph.
// - Kubo → Outlook: un appuntamento nuovo o spostato diventa un evento (POST/PATCH /me/events); annullato, l'evento si toglie.
// - Outlook → Kubo: ogni 15 minuti un giro con calendarView/delta (solo le novità dall'ultima volta, con il deltaLink salvato).
//   Le subscription di Graph non servono: vorrebbero rispondere al validationToken, e il webhook di Kubo non risponde a sfide.
// Accesso: OAuth con il codice del dispositivo (app desktop, nessun indirizzo pubblico), app registrata su Entra come client
// pubblico, tenant configurabile («common», «organizations», «consumers» o l'id dell'organizzazione).
// Anti-eco: changeKey dell'evento ricordato dopo ogni scrittura; le scritture del connettore non ripartono (nucleo).
import { daLocale } from '../_comunica/caldav.js';
import { REQ, PERMESSI, ricevi, annulla, titoloDi, fineDi, annullato, conta } from '../_comunica/agenda.js';
const SEM = 'appuntamenti';
const login = k => `${k.base || 'https://login.microsoftonline.com'}/${encodeURIComponent(k.imp.tenant || 'common')}/oauth2/v2.0`;
const graph = k => (k.base ? `${k.base}/v1.0` : 'https://graph.microsoft.com/v1.0');
const PREFER = { Prefer: 'outlook.timezone="UTC", odata.maxpagesize=50' };
// { dateTime: '2026-10-10T08:00:00.0000000', timeZone: 'UTC' } → ISO; un fuso di Windows sconosciuto → il fuso di Kubo
const daGraph = (o, fuso) => { if (!o?.dateTime) return null; const s = o.dateTime.slice(0, 19); if (!o.timeZone || /^(utc|gmt|etc\/utc)$/i.test(o.timeZone)) return new Date(s + 'Z').toISOString();
  const c = s.replace(/[-:]/g, ''); return daLocale(c, o.timeZone) || daLocale(c, fuso); };
// le changeKey ricordate (le ultime 5000), rilette prima di scrivere: il giro e la coda in uscita possono incrociarsi
const ricorda = (k, nuove, via = []) => { const c = { ...(k.stato.leggi('chiavi') || {}), ...nuove }; for (const x of via) delete c[x]; k.stato.scrivi('chiavi', Object.fromEntries(Object.entries(c).slice(-5000))); };
// un evento tolto da Outlook e poi riaperto in Kubo: si scorda l'id vecchio, così ne nasce uno nuovo
const scorda = (k, rigaId) => k.db.prepare('DELETE FROM _connettori_mappa WHERE connettore = ? AND entita = ? AND riga = ?').run(k.id, k.entita(SEM), String(rigaId));

export default {
  id: 'outlook', nome: 'Outlook e Microsoft 365', versione: 1, icona: 'calendario',
  descrizione: 'Agenda di Kubo e calendario di Outlook allineati nei due sensi.',
  impostazioni: [
    { id: 'client_id', nome: 'ID applicazione (client) di Microsoft Entra', segreto: true },
    { id: 'tenant', nome: 'Tenant («common», «consumers» per gli account personali, o l\'id della directory)', predefinito: 'common', schema: /^[\w.-]{2,80}$/ },
    { id: 'durata', nome: 'Durata di un appuntamento senza servizio (minuti)', tipo: 'numero', predefinito: 60 },
    { id: 'importa', nome: 'Gli eventi nuovi di Outlook diventano appuntamenti', tipo: 'si_no', predefinito: true },
    { id: 'clienti', nome: 'Crea il cliente dal primo invitato', tipo: 'si_no', predefinito: true },
  ],
  richiede: REQ, permessi: PERMESSI,
  oauth: { tipo: 'codice', autorizza: k => `${login(k)}/authorize`, token: k => `${login(k)}/token`, dispositivo: k => `${login(k)}/devicecode`, scope: 'offline_access Calendars.ReadWrite' },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Microsoft' };
    const r = await k.http.get(`${graph(k)}/me/calendar`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? r.json?.name : `HTTP ${r.stato}` };
  },
  uscita: { appuntamenti: { campi: ['quando', 'stato', 'cliente', 'servizio', 'note'], quando: (r, k) => k.oauth.collegato(), async invia(riga, k) {
    const q = k.valore(riga, SEM, 'quando'); if (!q) return;
    const tok = await k.oauth.token(); let rid = k.sincro.remoto(SEM, riga.id);
    const url = id => `${graph(k)}/me/events${id ? '/' + encodeURIComponent(id) : ''}`;
    if (annullato(k, riga)) {
      if (!rid) return;
      const r = await k.http.delete(url(rid), { bearer: tok }); if (!r.ok && r.stato !== 404) throw new Error(`Outlook ha risposto ${r.stato}`);
      return ricorda(k, {}, [rid]);
    }
    const corpo = { subject: titoloDi(k, riga), body: { contentType: 'text', content: k.valore(riga, SEM, 'note') || '' },
      start: { dateTime: q.slice(0, 19), timeZone: 'UTC' }, end: { dateTime: fineDi(k, riga).slice(0, 19), timeZone: 'UTC' } };
    let r = rid ? await k.http.patch(url(rid), { bearer: tok, json: corpo }) : null;
    if (r?.stato === 404) { scorda(k, riga.id); rid = null; }   // tolto da Outlook nel frattempo: si ricrea
    if (!rid) r = await k.http.post(url(), { bearer: tok, json: { ...corpo, transactionId: `kubo-${riga.id}-${Date.parse(q)}` } });
    if (!r.ok) throw new Error(`Outlook ha risposto ${r.stato}`);
    if (!rid && r.json?.id) k.sincro.collega(SEM, riga.id, r.json.id);
    if (r.json?.id) ricorda(k, { [r.json.id]: r.json.changeKey });
  } } },
  pianificati: { sincronizza: { nome: 'Novità dal calendario di Outlook', ogni: '15m', async giro(k) {
    if (!k.oauth.collegato()) return { saltato: 'non collegato' };
    const tok = await k.oauth.token(), conti = { creati: 0, spostati: 0, annullati: 0, uguali: 0, saltati: 0 };
    // il giro di delta copre da ieri a 120 giorni; ogni settimana se ne apre uno nuovo, perché la finestra non scorre da sola
    let link = k.stato.leggi('delta'), dal = k.stato.leggi('deltaDal');
    if (!link || !dal || Date.now() - Date.parse(dal) > 7 * 864e5) {
      const da = new Date(Date.now() - 864e5).toISOString().slice(0, 19), a = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 19);
      link = `${graph(k)}/me/calendarView/delta?startDateTime=${da}&endDateTime=${a}`; dal = new Date().toISOString();
    }
    for (let pagine = 0; link && pagine < 200; pagine++) {
      const r = await k.http.get(link, { bearer: tok, intestazioni: PREFER });
      if (r.stato === 410) { k.stato.scrivi('delta', null); return { ...conti, ricomincia: true }; }   // token scaduto: un giro completo la prossima volta
      if (!r.ok) throw new Error(`Outlook ha risposto ${r.stato}`);
      const chiavi = k.stato.leggi('chiavi') || {}, nuove = {};
      for (const e of r.json?.value || []) {
        if (e['@removed'] || e.isCancelled) { if (annulla(k, e.id) === 'annullato') conti.annullati++; continue; }
        if (chiavi[e.id] && chiavi[e.id] === e.changeKey) { conti.uguali++; continue; }
        if (e.isAllDay || (!k.sincro.locale(SEM, e.id) && k.imp.importa === false)) continue;
        const a = (e.attendees || []).find(x => x.emailAddress?.address)?.emailAddress;
        const x = ricevi(k, { remoto: e.id, quando: daGraph(e.start, k.fuso()), note: [e.subject, e.bodyPreview].filter(Boolean).join('\n'),
          cliente: a ? { email: a.address, nome: a.name } : null, creaClienti: k.imp.clienti !== false });
        conta(conti, x); nuove[e.id] = e.changeKey;
      }
      ricorda(k, nuove);
      if (r.json?.['@odata.nextLink']) link = r.json['@odata.nextLink'];
      else { k.stato.scrivi('delta', r.json?.['@odata.deltaLink'] || null); k.stato.scrivi('deltaDal', dal); link = null; }
    }
    return conti;
  } } },
  catalogo: {
    categoria: 'calendario', sito: 'https://outlook.office.com/calendar', costo: 'gratis',
    costoNota: 'Gratis con un account Microsoft personale (Outlook.com) o con Microsoft 365 (Business Basic da 5,60 € a utente al mese + IVA). Registrare l\'app su Microsoft Entra non costa niente.',
    serve: [
      { cosa: 'ID applicazione (client) di un\'app registrata, con «Consenti flussi client pubblici» attivo', dove: 'portal.azure.com → Microsoft Entra ID → Registrazioni app → Nuova registrazione → Autenticazione', link: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
      { cosa: 'Il permesso delegato Calendars.ReadWrite (più offline_access)', dove: 'Registrazioni app → la tua app → Autorizzazioni API → Microsoft Graph → Autorizzazioni delegate', link: 'https://learn.microsoft.com/graph/permissions-reference#calendarsreadwrite' },
    ],
    passi: ['Su Microsoft Entra apri Registrazioni app → Nuova registrazione; tipi di account: quelli che ti servono (anche personali).', 'In Autenticazione attiva «Consenti flussi client pubblici».', 'In Autorizzazioni API aggiungi Microsoft Graph → delegate → Calendars.ReadWrite e offline_access.', 'Copia l\'ID applicazione (client) e incollalo qui; il tenant resta «common» se non sai cosa mettere.', 'Accendi e premi «Collega con un codice»: apri microsoft.com/devicelogin e scrivi il codice.', 'Gli appuntamenti nuovi vanno in Outlook; ogni 15 minuti Kubo legge le novità del calendario.'],
    difficolta: 'difficile', zone: ['mondo'],
    fonti: ['https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code', 'https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0'],
    prova: 'finto', parole: ['outlook', 'microsoft 365', 'office 365', 'exchange', 'calendario', 'calendar', 'agenda', 'sincronizzazione', 'sync'],
  },
  testi: {
    en: { nome: 'Outlook and Microsoft 365', descrizione: 'Kubo\'s schedule and your Outlook calendar kept in sync both ways.', 'imp.client_id': 'Microsoft Entra application (client) ID', 'imp.tenant': 'Tenant («common», «consumers» for personal accounts, or the directory id)', 'imp.durata': 'Length of an appointment without a service (minutes)', 'imp.importa': 'New Outlook events become appointments', 'imp.clienti': 'Create the customer from the first attendee', 'giro.sincronizza': 'News from the Outlook calendar',
      'cat.costoNota': 'Free with a personal Microsoft account (Outlook.com) or with Microsoft 365 (Business Basic from €5.60 per user per month + VAT). Registering the app on Microsoft Entra costs nothing.',
      'cat.passi': ['In Microsoft Entra open App registrations → New registration; account types: the ones you need (personal too).', 'Under Authentication turn on «Allow public client flows».', 'Under API permissions add Microsoft Graph → delegated → Calendars.ReadWrite and offline_access.', 'Copy the application (client) ID and paste it here; leave the tenant as «common» if unsure.', 'Turn it on and press «Connect with a code»: open microsoft.com/devicelogin and type the code.', 'New appointments go to Outlook; every 15 minutes Kubo reads what changed in the calendar.'],
      'cat.serve': [{ cosa: 'Application (client) ID of a registered app, with «Allow public client flows» on', dove: 'portal.azure.com → Microsoft Entra ID → App registrations → New registration → Authentication' }, { cosa: 'The delegated permission Calendars.ReadWrite (plus offline_access)', dove: 'App registrations → your app → API permissions → Microsoft Graph → Delegated permissions' }] },
    es: { nome: 'Outlook y Microsoft 365', descrizione: 'La agenda de Kubo y el calendario de Outlook sincronizados en ambos sentidos.', 'imp.client_id': 'ID de aplicación (cliente) de Microsoft Entra', 'imp.tenant': 'Tenant («common», «consumers» para cuentas personales, o el id del directorio)', 'imp.durata': 'Duración de una cita sin servicio (minutos)', 'imp.importa': 'Los eventos nuevos de Outlook se convierten en citas', 'imp.clienti': 'Crear el cliente con el primer invitado', 'giro.sincronizza': 'Novedades del calendario de Outlook' },
    fr: { nome: 'Outlook et Microsoft 365', descrizione: 'L\'agenda de Kubo et le calendrier Outlook synchronisés dans les deux sens.', 'imp.client_id': 'ID d\'application (client) Microsoft Entra', 'imp.tenant': 'Tenant (« common », « consumers » pour les comptes personnels, ou l\'id de l\'annuaire)', 'imp.durata': 'Durée d\'un rendez-vous sans prestation (minutes)', 'imp.importa': 'Les nouveaux événements Outlook deviennent des rendez-vous', 'imp.clienti': 'Créer le client à partir du premier invité', 'giro.sincronizza': 'Nouveautés du calendrier Outlook' },
    de: { nome: 'Outlook und Microsoft 365', descrizione: 'Kubos Terminkalender und der Outlook-Kalender in beide Richtungen abgeglichen.', 'imp.client_id': 'Anwendungs-ID (Client) von Microsoft Entra', 'imp.tenant': 'Mandant („common“, „consumers“ für private Konten oder die Verzeichnis-ID)', 'imp.durata': 'Dauer eines Termins ohne Leistung (Minuten)', 'imp.importa': 'Neue Outlook-Termine werden zu Terminen in Kubo', 'imp.clienti': 'Kunden aus dem ersten Teilnehmer anlegen', 'giro.sincronizza': 'Neues aus dem Outlook-Kalender' },
    pt: { nome: 'Outlook e Microsoft 365', descrizione: 'A agenda do Kubo e o calendário do Outlook sincronizados nos dois sentidos.', 'imp.client_id': 'ID do aplicativo (cliente) do Microsoft Entra', 'imp.tenant': 'Tenant («common», «consumers» para contas pessoais, ou o id do diretório)', 'imp.durata': 'Duração de um agendamento sem serviço (minutos)', 'imp.importa': 'Os novos eventos do Outlook viram agendamentos', 'imp.clienti': 'Criar o cliente a partir do primeiro convidado', 'giro.sincronizza': 'Novidades do calendário do Outlook' },
  },
};
