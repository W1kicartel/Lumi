// Google Tasks: Lumi crea un compito nella lista scelta (vuota: «I miei compiti», @default), e a scelta ogni riga nuova
// di attività, interventi o commesse diventa un compito. OAuth Google con il codice + PKCE, scope tasks.
// POST /tasks/v1/lists/{tasklist}/tasks { title, notes, due }: due è RFC 3339 ma Google tiene solo la data (l'ora si perde).
// API: https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/insert
import { permessiCompiti, impostazioniCompiti, testiCompiti, unisciTesti, uscitaCompiti, dataDi } from '../_comunica/compiti.js';
const gbase = k => k.base || 'https://tasks.googleapis.com';
const no = (r, cosa) => new Error(`Google Tasks ha risposto ${r.stato} a ${cosa}${r.json?.error?.message ? ': ' + r.json.error.message : ''}`);
async function liste(k) {
  const r = await k.http.get(`${gbase(k)}/tasks/v1/users/@me/lists?maxResults=100`, { bearer: await k.oauth.token() });
  if (!r.ok) throw no(r, 'l\'elenco delle liste'); return r.json?.items || [];
}
// l'id della lista chiesta per nome (o id); senza nome quella delle impostazioni, o @default
async function listaDi(k, nome) {
  const n = String(nome || k.imp.lista || '').trim(); if (!n) return { id: '@default', title: 'I miei compiti' };
  const l = (await liste(k)).find(x => x.id === n || String(x.title).toLowerCase() === n.toLowerCase());
  if (!l) throw new Error(`In Google Tasks non c'è la lista «${n}»`);
  return l;
}
async function crea(k, { titolo, note, scadenza, lista }) {
  const l = await listaDi(k, lista);
  const json = { title: String(titolo).slice(0, 1024), ...(note ? { notes: String(note).slice(0, 8192) } : {}), ...(scadenza ? { due: `${scadenza}T00:00:00.000Z` } : {}) };
  const r = await k.http.post(`${gbase(k)}/tasks/v1/lists/${encodeURIComponent(l.id)}/tasks`, { bearer: await k.oauth.token(), json });
  if (!r.ok) throw no(r, 'la creazione del compito');
  return { ...(r.json || {}), lista: l.title };
}
export default {
  id: 'google-tasks', nome: 'Google Tasks', versione: 1, icona: 'matita',
  descrizione: 'Lumi segna i compiti in Google Tasks; le attività, gli interventi o le commesse nuove diventano compiti.',
  impostazioni: [
    { id: 'client_id', nome: 'Google: client ID OAuth', segreto: true }, { id: 'client_secret', nome: 'Google: client secret', segreto: true },
    { id: 'lista', nome: 'Nome della lista (vuoto: «I miei compiti»)', obbligatorio: false },
    ...impostazioniCompiti(),
  ],
  permessi: permessiCompiti,
  oauth: { tipo: 'codice', autorizza: 'https://accounts.google.com/o/oauth2/v2/auth', token: k => (k.base ? `${k.base}/token` : 'https://oauth2.googleapis.com/token'),
    scope: 'https://www.googleapis.com/auth/tasks', extra: { access_type: 'offline', prompt: 'consent' } },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Google' };
    const l = await liste(k); return { ok: true, messaggio: `${l.length} liste` };
  },
  uscita: uscitaCompiti(async (k, c) => (k.oauth.collegato() ? (await crea(k, { titolo: c.titolo, note: c.note, scadenza: c.scadenza })).id : null)),
  azioni: {
    crea_compito: {
      nome: 'Crea un compito', descrizione: 'Segna un compito in Google Tasks (titolo, note, scadenza, lista), es. «aggiungi ai compiti di Google: chiamare il commercialista il 15»', lumi: true, scrive: true,
      input: { titolo: { tipo: 'testo', nome: 'Il compito, in breve' }, note: { tipo: 'testo', nome: 'Le note (facoltative)', facoltativo: true }, scadenza: { tipo: 'testo', nome: 'La scadenza AAAA-MM-GG (facoltativa)', facoltativo: true }, lista: { tipo: 'testo', nome: 'Il nome della lista (facoltativo)', facoltativo: true } },
      proponi: async (x, k) => ({ titolo: 'Nuovo compito in Google Tasks', righe: [['Compito', String(x.titolo || '')], ['Scadenza', dataDi(x.scadenza) || '—'], ['Lista', x.lista || k.imp.lista || 'I miei compiti']],
        avvisi: [...(x.titolo ? [] : ['Manca il testo del compito']), ...(x.scadenza && !dataDi(x.scadenza) ? [`Scadenza «${x.scadenza}» non chiara: scrivila come AAAA-MM-GG`] : []), ...(k.oauth.collegato() ? [] : ['Google Tasks non è ancora collegato'])] }),
      esegui: async (x, k) => {
        if (!String(x.titolo || '').trim()) throw new Error('Manca il testo del compito');
        const t = await crea(k, { titolo: x.titolo, note: x.note, scadenza: dataDi(x.scadenza), lista: x.lista });
        return { ok: true, id: t.id, lista: t.lista, link: t.webViewLink || null };
      },
    },
  },
  catalogo: {
    categoria: 'produttivita', sito: 'https://workspace.google.com/products/tasks/', costo: 'gratis',
    costoNota: 'Google Tasks è gratuito con qualunque account Google (anche Gmail personale) e incluso in Google Workspace. L\'API Tasks non costa (quota di 50.000 richieste al giorno).',
    serve: [
      { cosa: 'Client ID e client secret OAuth (tipo «Applicazione web»)', dove: 'Google Cloud Console → API e servizi → Credenziali → Crea credenziali → ID client OAuth', link: 'https://console.cloud.google.com/apis/credentials' },
      { cosa: 'L\'API Google Tasks attivata nel progetto', dove: 'Google Cloud Console → API e servizi → Libreria → Google Tasks API → Abilita', link: 'https://console.cloud.google.com/apis/library/tasks.googleapis.com' },
    ],
    passi: [
      'Crea un progetto su Google Cloud Console e abilita la Google Tasks API.',
      'Schermata di consenso OAuth: tipo «Esterno», aggiungi te stesso come utente di test (o pubblica l\'app) e lo scope …/auth/tasks.',
      'Crea un ID client OAuth «Applicazione web» con URI di reindirizzamento http://localhost:<porta di Kubo>/api/connettori/google-tasks/oauth/ritorno.',
      'In Kubo incolla client ID e client secret, accendi il connettore e premi «Collega».',
      'Facoltativo: scrivi il nome della lista dove far cadere i compiti (vuoto: «I miei compiti»).',
      'Accendi le sezioni da trasformare in compiti e chiedi a Lumi «aggiungi ai compiti di Google: chiamare il commercialista il 15».',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/insert', 'https://developers.google.com/workspace/tasks/reference/rest/v1/tasks', 'https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists/list', 'https://developers.google.com/workspace/tasks/auth', 'https://developers.google.com/identity/protocols/oauth2/web-server'],
    prova: 'finto', parole: ['google tasks', 'tasks', 'compiti', 'promemoria', 'cose da fare', 'google', 'to-do', 'reminder'],
  },
  testi: unisciTesti({
    en: { nome: 'Google Tasks', descrizione: 'Lumi adds tasks to Google Tasks; new activities, jobs or orders become tasks.', 'imp.client_id': 'Google: OAuth client ID', 'imp.client_secret': 'Google: client secret', 'imp.lista': 'List name (empty: «My Tasks»)',
      'cat.costoNota': 'Google Tasks is free with any Google account (personal Gmail too) and included in Google Workspace. The Tasks API is free (50,000 requests per day quota).',
      'cat.serve': [{ cosa: 'OAuth client ID and client secret («Web application»)', dove: 'Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID' }, { cosa: 'Google Tasks API enabled in the project', dove: 'Google Cloud Console → APIs & Services → Library → Google Tasks API → Enable' }],
      'cat.passi': ['Create a project in Google Cloud Console and enable the Google Tasks API.', 'OAuth consent screen: «External», add yourself as a test user (or publish the app) and the …/auth/tasks scope.', 'Create a «Web application» OAuth client with redirect URI http://localhost:<Kubo port>/api/connettori/google-tasks/oauth/ritorno.', 'In Kubo paste client ID and secret, turn the connector on and press «Connect».', 'Optional: write the name of the list for new tasks (empty: «My Tasks»).', 'Turn on the sections to turn into tasks and ask Lumi «add to my Google tasks: call the accountant on the 15th».'] },
    es: { nome: 'Google Tasks', descrizione: 'Lumi apunta tareas en Google Tasks; las actividades, intervenciones o encargos nuevos se convierten en tareas.', 'imp.client_id': 'Google: client ID de OAuth', 'imp.client_secret': 'Google: client secret', 'imp.lista': 'Nombre de la lista (vacío: «Mis tareas»)' },
    fr: { nome: 'Google Tasks', descrizione: 'Lumi note les tâches dans Google Tasks ; les nouvelles activités, interventions ou commandes deviennent des tâches.', 'imp.client_id': 'Google : client ID OAuth', 'imp.client_secret': 'Google : client secret', 'imp.lista': 'Nom de la liste (vide : « Mes tâches »)' },
    de: { nome: 'Google Tasks', descrizione: 'Lumi trägt Aufgaben in Google Tasks ein; neue Aufgaben, Einsätze oder Aufträge werden zu Tasks.', 'imp.client_id': 'Google: OAuth-Client-ID', 'imp.client_secret': 'Google: Client-Secret', 'imp.lista': 'Name der Liste (leer: „Meine Aufgaben“)' },
    pt: { nome: 'Google Tasks', descrizione: 'A Lumi anota tarefas no Google Tasks; atividades, intervenções ou encomendas novas viram tarefas.', 'imp.client_id': 'Google: client ID OAuth', 'imp.client_secret': 'Google: client secret', 'imp.lista': 'Nome da lista (vazio: «Minhas tarefas»)' },
  }, testiCompiti),
};
