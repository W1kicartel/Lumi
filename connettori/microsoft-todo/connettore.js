// Microsoft To Do: Lumi crea un compito nella lista scelta (vuota: la lista «Attività» predefinita), e a scelta ogni riga
// nuova di attività, interventi o commesse diventa un compito. Microsoft Graph, POST /me/todo/lists/{id}/tasks
// { title, body, dueDateTime }. Accesso come per Outlook: OAuth con il codice del dispositivo (app desktop, nessun
// indirizzo pubblico), app registrata su Entra come client pubblico, permesso delegato Tasks.ReadWrite.
// API: https://learn.microsoft.com/en-us/graph/api/todotasklist-post-tasks?view=graph-rest-1.0
import { permessiCompiti, impostazioniCompiti, testiCompiti, unisciTesti, uscitaCompiti, dataDi } from '../_comunica/compiti.js';
const login = k => `${k.base || 'https://login.microsoftonline.com'}/${encodeURIComponent(k.imp.tenant || 'common')}/oauth2/v2.0`;
const graph = k => (k.base ? `${k.base}/v1.0` : 'https://graph.microsoft.com/v1.0');
const no = (r, cosa) => new Error(`Microsoft To Do ha risposto ${r.stato} a ${cosa}${r.json?.error?.message ? ': ' + r.json.error.message : ''}`);
async function liste(k) {
  const r = await k.http.get(`${graph(k)}/me/todo/lists?$top=100`, { bearer: await k.oauth.token() });
  if (!r.ok) throw no(r, 'l\'elenco delle liste'); return r.json?.value || [];
}
// la lista chiesta per nome (o quella delle impostazioni); senza nome la lista predefinita
async function listaDi(k, nome) {
  const n = String(nome || k.imp.lista || '').trim().toLowerCase(), tutte = await liste(k);
  const l = n ? tutte.find(x => x.id === nome || String(x.displayName).toLowerCase() === n) : tutte.find(x => x.wellknownListName === 'defaultList') || tutte[0];
  if (!l) throw new Error(n ? `In Microsoft To Do non c'è la lista «${nome || k.imp.lista}»` : 'In Microsoft To Do non c\'è nessuna lista');
  return l;
}
async function crea(k, { titolo, note, scadenza, lista }) {
  const l = await listaDi(k, lista);
  const json = { title: String(titolo).slice(0, 255), ...(note ? { body: { content: String(note), contentType: 'text' } } : {}),
    ...(scadenza ? { dueDateTime: { dateTime: `${scadenza}T00:00:00`, timeZone: k.fuso() } } : {}) };
  const r = await k.http.post(`${graph(k)}/me/todo/lists/${encodeURIComponent(l.id)}/tasks`, { bearer: await k.oauth.token(), json });
  if (!r.ok) throw no(r, 'la creazione del compito');
  return { ...(r.json || {}), lista: l.displayName };
}
export default {
  id: 'microsoft-todo', nome: 'Microsoft To Do', versione: 1, icona: 'matita',
  descrizione: 'Lumi segna i compiti in Microsoft To Do; le attività, gli interventi o le commesse nuove diventano compiti.',
  impostazioni: [
    { id: 'client_id', nome: 'ID applicazione (client) di Microsoft Entra', segreto: true },
    { id: 'tenant', nome: 'Tenant («common», «consumers» per gli account personali, o l\'id della directory)', predefinito: 'common', schema: /^[\w.-]{2,80}$/ },
    { id: 'lista', nome: 'Nome della lista (vuoto: la lista predefinita «Attività»)', obbligatorio: false },
    ...impostazioniCompiti(),
  ],
  permessi: permessiCompiti,
  oauth: { tipo: 'codice', autorizza: k => `${login(k)}/authorize`, token: k => `${login(k)}/token`, dispositivo: k => `${login(k)}/devicecode`, scope: 'offline_access Tasks.ReadWrite' },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Microsoft' };
    const l = await listaDi(k); return { ok: true, messaggio: `Lista «${l.displayName}»` };
  },
  uscita: uscitaCompiti(async (k, c) => (k.oauth.collegato() ? (await crea(k, { titolo: c.titolo, note: c.note, scadenza: c.scadenza })).id : null)),
  azioni: {
    crea_compito: {
      nome: 'Crea un compito', descrizione: 'Segna un compito in Microsoft To Do (titolo, note, scadenza, lista), es. «segna su To Do: rinnovare l\'assicurazione entro il 30»', lumi: true, scrive: true,
      input: { titolo: { tipo: 'testo', nome: 'Il compito, in breve' }, note: { tipo: 'testo', nome: 'Le note (facoltative)', facoltativo: true }, scadenza: { tipo: 'testo', nome: 'La scadenza AAAA-MM-GG (facoltativa)', facoltativo: true }, lista: { tipo: 'testo', nome: 'Il nome della lista (facoltativo)', facoltativo: true } },
      proponi: async (x, k) => ({ titolo: 'Nuovo compito in Microsoft To Do', righe: [['Compito', String(x.titolo || '')], ['Scadenza', dataDi(x.scadenza) || '—'], ['Lista', x.lista || k.imp.lista || 'predefinita']],
        avvisi: [...(x.titolo ? [] : ['Manca il testo del compito']), ...(x.scadenza && !dataDi(x.scadenza) ? [`Scadenza «${x.scadenza}» non chiara: scrivila come AAAA-MM-GG`] : []), ...(k.oauth.collegato() ? [] : ['Microsoft To Do non è ancora collegato'])] }),
      esegui: async (x, k) => {
        if (!String(x.titolo || '').trim()) throw new Error('Manca il testo del compito');
        const t = await crea(k, { titolo: x.titolo, note: x.note, scadenza: dataDi(x.scadenza), lista: x.lista });
        return { ok: true, id: t.id, lista: t.lista };
      },
    },
  },
  catalogo: {
    categoria: 'produttivita', sito: 'https://to-do.office.com', costo: 'gratis',
    costoNota: 'Microsoft To Do è gratuito con qualunque account Microsoft (anche personale, Outlook.com); incluso nei piani Microsoft 365 aziendali. L\'API Graph non costa.',
    serve: [
      { cosa: 'L\'ID applicazione (client) di un\'app registrata come client pubblico', dove: 'portale Azure / Microsoft Entra → Registrazioni app → Nuova registrazione → Autenticazione → «Consenti flussi client pubblici»: Sì', link: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
      { cosa: 'Il permesso delegato Tasks.ReadWrite di Microsoft Graph', dove: 'La stessa app → Autorizzazioni API → Aggiungi → Microsoft Graph → Autorizzazioni delegate → Tasks.ReadWrite', link: 'https://learn.microsoft.com/en-us/graph/permissions-reference#tasksreadwrite' },
    ],
    passi: [
      'Su Microsoft Entra registra una nuova app: tipi di account «personali e aziendali» (o solo la tua organizzazione).',
      'In Autenticazione attiva «Consenti flussi client pubblici»; in Autorizzazioni API aggiungi Tasks.ReadWrite di Microsoft Graph.',
      'In Lumi incolla l\'ID applicazione; tenant «common» (o «consumers» per un account personale, o l\'id della tua directory).',
      'Accendi il connettore e premi «Collega»: apri microsoft.com/devicelogin e scrivi il codice che vedi.',
      'Facoltativo: scrivi il nome della lista dove far cadere i compiti (vuoto: «Attività»).',
      'Accendi le sezioni da trasformare in compiti e chiedi a Lumi «segna su To Do: rinnovare l\'assicurazione entro il 30».',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://learn.microsoft.com/en-us/graph/api/todotasklist-post-tasks?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/graph/api/todo-list-lists?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/graph/api/resources/todotask?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code'],
    prova: 'finto', parole: ['microsoft to do', 'to do', 'todo', 'wunderlist', 'compiti', 'promemoria', 'microsoft 365', 'task', 'reminder'],
  },
  testi: unisciTesti({
    en: { nome: 'Microsoft To Do', descrizione: 'Lumi adds tasks to Microsoft To Do; new activities, jobs or orders become tasks.', 'imp.client_id': 'Microsoft Entra application (client) ID', 'imp.tenant': 'Tenant («common», «consumers» for personal accounts, or the directory id)', 'imp.lista': 'List name (empty: the default «Tasks» list)',
      'cat.costoNota': 'Microsoft To Do is free with any Microsoft account (personal too, Outlook.com); included in Microsoft 365 business plans. The Graph API is free.',
      'cat.serve': [{ cosa: 'The application (client) ID of an app registered as a public client', dove: 'Azure portal / Microsoft Entra → App registrations → New registration → Authentication → «Allow public client flows»: Yes' }, { cosa: 'The delegated Microsoft Graph permission Tasks.ReadWrite', dove: 'Same app → API permissions → Add → Microsoft Graph → Delegated permissions → Tasks.ReadWrite' }],
      'cat.passi': ['In Microsoft Entra register a new app: «personal and work» account types (or your organization only).', 'Under Authentication turn on «Allow public client flows»; under API permissions add Microsoft Graph Tasks.ReadWrite.', 'In Lumi paste the application ID; tenant «common» (or «consumers» for a personal account, or your directory id).', 'Turn the connector on and press «Connect»: open microsoft.com/devicelogin and type the code you see.', 'Optional: write the name of the list for new tasks (empty: «Tasks»).', 'Turn on the sections to turn into tasks and ask Lumi «add to To Do: renew the insurance by the 30th».'] },
    es: { nome: 'Microsoft To Do', descrizione: 'Lumi apunta tareas en Microsoft To Do; las actividades, intervenciones o encargos nuevos se convierten en tareas.', 'imp.client_id': 'ID de aplicación (cliente) de Microsoft Entra', 'imp.tenant': 'Tenant («common», «consumers» para cuentas personales, o el id del directorio)', 'imp.lista': 'Nombre de la lista (vacío: la lista «Tareas» predeterminada)' },
    fr: { nome: 'Microsoft To Do', descrizione: 'Lumi note les tâches dans Microsoft To Do ; les nouvelles activités, interventions ou commandes deviennent des tâches.', 'imp.client_id': 'ID d\'application (client) Microsoft Entra', 'imp.tenant': 'Tenant (« common », « consumers » pour les comptes personnels, ou l\'id de l\'annuaire)', 'imp.lista': 'Nom de la liste (vide : la liste « Tâches » par défaut)' },
    de: { nome: 'Microsoft To Do', descrizione: 'Lumi trägt Aufgaben in Microsoft To Do ein; neue Aufgaben, Einsätze oder Aufträge werden zu Tasks.', 'imp.client_id': 'Anwendungs-(Client-)ID von Microsoft Entra', 'imp.tenant': 'Mandant („common“, „consumers“ für private Konten oder die Verzeichnis-ID)', 'imp.lista': 'Name der Liste (leer: die Standardliste „Aufgaben“)' },
    pt: { nome: 'Microsoft To Do', descrizione: 'A Lumi anota tarefas no Microsoft To Do; atividades, intervenções ou encomendas novas viram tarefas.', 'imp.client_id': 'ID do aplicativo (cliente) do Microsoft Entra', 'imp.tenant': 'Tenant («common», «consumers» para contas pessoais, ou o id do diretório)', 'imp.lista': 'Nome da lista (vazio: a lista «Tarefas» padrão)' },
  }, testiCompiti),
};
