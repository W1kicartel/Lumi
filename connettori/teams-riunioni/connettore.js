// Microsoft Teams, riunioni online: la riunione Teams per un appuntamento a distanza, con un clic o chiedendola a Lumi.
// Il link (joinWebUrl) va nelle note dell'appuntamento; con «automatico» ogni appuntamento nuovo prende la sua riunione.
// - Graph: POST /me/onlineMeetings { startDateTime, endDateTime, subject }; spostato → PATCH /me/onlineMeetings/{id}
//   (il link non cambia); annullato → DELETE. Permesso delegato OnlineMeetings.ReadWrite: solo account di lavoro o
//   scuola (Microsoft 365), non gli account personali.
// - Accesso: OAuth con il codice del dispositivo (app desktop, nessun indirizzo pubblico), come il connettore Outlook.
import { titoloDi, fineDi, annullato } from '../_comunica/agenda.js';
const SEM = 'appuntamenti';
const login = k => `${k.base || 'https://login.microsoftonline.com'}/${encodeURIComponent(k.imp.tenant || 'organizations')}/oauth2/v2.0`;
const graph = k => (k.base ? `${k.base}/v1.0` : 'https://graph.microsoft.com/v1.0');
const quando = (k, r) => new Date(k.valore(r, SEM, 'quando')).toLocaleString('it-IT', { timeZone: k.fuso(), dateStyle: 'medium', timeStyle: 'short' });
const orari = (k, r) => ({ startDateTime: new Date(k.valore(r, SEM, 'quando')).toISOString(), endDateTime: fineDi(k, r) });
const no = (r, cosa) => new Error(`Teams ha risposto ${r.stato} a ${cosa}${r.json?.error?.message ? ': ' + r.json.error.message : ''}`);
async function crea(k, r) {
  const x = await k.http.post(`${graph(k)}/me/onlineMeetings`, { bearer: await k.oauth.token(), json: { ...orari(k, r), subject: titoloDi(k, r) } });
  if (!x.ok || !x.json?.joinWebUrl) throw no(x, 'la creazione della riunione');
  const note = k.valore(r, SEM, 'note');
  k.dati.modifica(SEM, r.id, { note: [note, `Teams: ${x.json.joinWebUrl}`].filter(Boolean).join('\n') });
  k.sincro.collega(SEM, r.id, x.json.id);
  return { link: x.json.joinWebUrl, id: x.json.id };
}
// la riunione segue l'appuntamento: spostata con PATCH, annullata con DELETE; senza riunione e con «automatico», la crea
async function segui(r, k) {
  const id = k.sincro.remoto(SEM, r.id);
  if (!id) return k.imp.automatico === true && !annullato(k, r) ? crea(k, r) : null;
  const tok = await k.oauth.token(), url = `${graph(k)}/me/onlineMeetings/${encodeURIComponent(id)}`;
  const x = annullato(k, r) ? await k.http.delete(url, { bearer: tok }) : await k.http.patch(url, { bearer: tok, json: orari(k, r) });
  if (!x.ok && x.stato !== 404) throw no(x, 'l\'aggiornamento della riunione');
  return x.stato;
}

export default {
  id: 'teams-riunioni', nome: 'Microsoft Teams (riunioni)', versione: 1, icona: 'calendario',
  descrizione: 'Una riunione Teams per gli appuntamenti a distanza, con il link nelle note.',
  impostazioni: [
    { id: 'client_id', nome: 'ID applicazione (client) di Microsoft Entra', segreto: true },
    { id: 'tenant', nome: 'Tenant («organizations» o l\'id della directory)', predefinito: 'organizations', schema: /^[\w.-]{2,80}$/ },
    { id: 'automatico', nome: 'Crea la riunione per ogni appuntamento nuovo', tipo: 'si_no', predefinito: false },
    { id: 'durata', nome: 'Durata di un appuntamento senza servizio (minuti)', tipo: 'numero', predefinito: 60 },
  ],
  richiede: { appuntamenti: { quando: { tipo: ['data_ora'] }, note: { tipo: ['testo_lungo', 'testo'] }, stato: { tipo: 'stato', facoltativo: true } } },
  permessi: { appuntamenti: { leggi: true, modifica: true }, servizi: { leggi: true } },
  oauth: { tipo: 'codice', autorizza: k => `${login(k)}/authorize`, token: k => `${login(k)}/token`, dispositivo: k => `${login(k)}/devicecode`, scope: 'offline_access User.Read OnlineMeetings.ReadWrite' },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Microsoft 365' };
    const r = await k.http.get(`${graph(k)}/me`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? r.json?.userPrincipalName || r.json?.displayName : `HTTP ${r.stato}` };
  },
  azioni: {
    crea_riunione: {
      nome: 'Crea la riunione Teams', descrizione: 'Crea una riunione Teams all\'ora dell\'appuntamento e ne scrive il link nelle note', su: SEM, lumi: true, scrive: true,
      input: { appuntamento: { tipo: 'relazione', entita: SEM, nome: 'L\'appuntamento' } },
      proponi: async ({ appuntamento: a }, k) => ({ titolo: 'Riunione Teams', righe: [['Appuntamento', titoloDi(k, a)], ['Quando', quando(k, a)]],
        avvisi: [...(k.sincro.remoto(SEM, a.id) ? ['C\'è già una riunione: si aggiorna l\'ora, il link resta quello'] : []), ...(annullato(k, a) ? ['L\'appuntamento è annullato'] : []),
          ...(k.oauth.collegato() ? [] : ['Collega prima l\'account Microsoft 365'])] }),
      async esegui({ appuntamento: a }, k) {
        if (annullato(k, a)) throw new Error('L\'appuntamento è annullato');
        if (k.sincro.remoto(SEM, a.id)) { await segui(a, k); return { aggiornata: true }; }
        return crea(k, a);
      },
    },
  },
  uscita: { appuntamenti: { campi: ['quando', 'stato', 'servizio'], quando: (r, k) => k.oauth.collegato() && (!!k.sincro.remoto(SEM, r.id) || (k.imp.automatico === true && !annullato(k, r))), invia: async (r, k) => { await segui(r, k); } } },
  catalogo: {
    categoria: 'calendario', sito: 'https://www.microsoft.com/microsoft-teams', costo: 'abbonamento',
    costoNota: 'Serve un account di lavoro Microsoft 365 con Teams: Microsoft 365 Business Basic da 5,60 € a utente al mese + IVA (annuale), oppure Teams Essentials da 3,70 €. Gli account personali non possono creare riunioni via API. Registrare l\'app su Microsoft Entra non costa niente.',
    serve: [
      { cosa: 'ID applicazione (client) di un\'app registrata, con «Consenti flussi client pubblici» attivo', dove: 'entra.microsoft.com → Applicazioni → Registrazioni app → Nuova registrazione → Autenticazione', link: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
      { cosa: 'Il permesso delegato OnlineMeetings.ReadWrite (più offline_access e User.Read)', dove: 'Registrazioni app → la tua app → Autorizzazioni API → Microsoft Graph → Autorizzazioni delegate', link: 'https://learn.microsoft.com/graph/permissions-reference#onlinemeetingsreadwrite' },
    ],
    passi: ['Su Microsoft Entra apri Registrazioni app → Nuova registrazione (account di questa organizzazione).', 'In Autenticazione attiva «Consenti flussi client pubblici».', 'In Autorizzazioni API aggiungi Microsoft Graph → delegate → OnlineMeetings.ReadWrite, User.Read e offline_access.', 'Copia l\'ID applicazione (client) e incollalo qui; il tenant resta «organizations» o l\'id della tua directory.', 'Accendi e premi «Collega con un codice»: apri microsoft.com/devicelogin e scrivi il codice.', 'Sull\'appuntamento premi «Crea la riunione Teams» (o chiedilo a Lumi): il link va nelle note.'],
    difficolta: 'difficile', zone: ['mondo'],
    fonti: ['https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/graph/api/onlinemeeting-update?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/graph/api/onlinemeeting-delete?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code', 'https://www.microsoft.com/it-it/microsoft-365/business/compare-all-microsoft-365-business-products'],
    prova: 'finto', parole: ['teams', 'microsoft teams', 'microsoft 365', 'riunione', 'videochiamata', 'video call', 'meeting', 'consulenza online'],
  },
  testi: {
    en: { nome: 'Microsoft Teams (meetings)', descrizione: 'A Teams meeting for remote appointments, with the link in the notes.', 'imp.client_id': 'Microsoft Entra application (client) ID', 'imp.tenant': 'Tenant («organizations» or the directory id)', 'imp.automatico': 'Create the meeting for every new appointment', 'imp.durata': 'Length of an appointment without a service (minutes)', 'az.crea_riunione': 'Create the Teams meeting',
      'cat.costoNota': 'A Microsoft 365 work account with Teams is needed: Microsoft 365 Business Basic from €5.60 per user per month + VAT (yearly), or Teams Essentials from €3.70. Personal accounts cannot create meetings through the API. Registering the app on Microsoft Entra costs nothing.',
      'cat.serve': [{ cosa: 'Application (client) ID of a registered app, with «Allow public client flows» on', dove: 'entra.microsoft.com → Applications → App registrations → New registration → Authentication' }, { cosa: 'The delegated permission OnlineMeetings.ReadWrite (plus offline_access and User.Read)', dove: 'App registrations → your app → API permissions → Microsoft Graph → Delegated permissions' }],
      'cat.passi': ['In Microsoft Entra open App registrations → New registration (accounts in this organization).', 'Under Authentication turn on «Allow public client flows».', 'Under API permissions add Microsoft Graph → delegated → OnlineMeetings.ReadWrite, User.Read and offline_access.', 'Copy the application (client) ID and paste it here; leave the tenant as «organizations» or your directory id.', 'Turn it on and press «Connect with a code»: open microsoft.com/devicelogin and type the code.', 'On the appointment press «Create the Teams meeting» (or ask Lumi): the link goes into the notes.'] },
    es: { nome: 'Microsoft Teams (reuniones)', descrizione: 'Una reunión de Teams para las citas a distancia, con el enlace en las notas.', 'imp.client_id': 'ID de aplicación (cliente) de Microsoft Entra', 'imp.tenant': 'Tenant («organizations» o el id del directorio)', 'imp.automatico': 'Crear la reunión para cada cita nueva', 'imp.durata': 'Duración de una cita sin servicio (minutos)', 'az.crea_riunione': 'Crear la reunión de Teams' },
    fr: { nome: 'Microsoft Teams (réunions)', descrizione: 'Une réunion Teams pour les rendez-vous à distance, avec le lien dans les notes.', 'imp.client_id': 'ID d\'application (client) Microsoft Entra', 'imp.tenant': 'Tenant (« organizations » ou l\'id de l\'annuaire)', 'imp.automatico': 'Créer la réunion pour chaque nouveau rendez-vous', 'imp.durata': 'Durée d\'un rendez-vous sans prestation (minutes)', 'az.crea_riunione': 'Créer la réunion Teams' },
    de: { nome: 'Microsoft Teams (Besprechungen)', descrizione: 'Eine Teams-Besprechung für Online-Termine, mit dem Link in den Notizen.', 'imp.client_id': 'Anwendungs-ID (Client) von Microsoft Entra', 'imp.tenant': 'Mandant („organizations“ oder die Verzeichnis-ID)', 'imp.automatico': 'Besprechung für jeden neuen Termin erstellen', 'imp.durata': 'Dauer eines Termins ohne Leistung (Minuten)', 'az.crea_riunione': 'Teams-Besprechung erstellen' },
    pt: { nome: 'Microsoft Teams (reuniões)', descrizione: 'Uma reunião do Teams para os agendamentos à distância, com o link nas notas.', 'imp.client_id': 'ID do aplicativo (cliente) do Microsoft Entra', 'imp.tenant': 'Tenant («organizations» ou o id do diretório)', 'imp.automatico': 'Criar a reunião para cada agendamento novo', 'imp.durata': 'Duração de um agendamento sem serviço (minutos)', 'az.crea_riunione': 'Criar a reunião do Teams' },
  },
};
