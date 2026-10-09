// ClickUp: Lumi crea un compito nella lista scelta, e a scelta ogni riga nuova di attività, interventi o commesse diventa
// un compito. Token personale (pk_…) così com'è nell'intestazione Authorization (senza «Bearer»).
// POST /api/v2/list/{list_id}/task { name, description, due_date (millisecondi), due_date_time: false }.
// API: https://developer.clickup.com/reference/createtask
import { permessiCompiti, impostazioniCompiti, testiCompiti, unisciTesti, uscitaCompiti, dataDi } from '../_comunica/compiti.js';
const cbase = k => k.base || 'https://api.clickup.com';
const auth = k => ({ intestazioni: { Authorization: k.segreti.token } });
const no = (r, cosa) => new Error(`ClickUp ha risposto ${r.stato} a ${cosa}${r.json?.err ? ': ' + r.json.err : ''}`);
// la scadenza è un giorno senza ora: mezzogiorno UTC resta lo stesso giorno in ogni fuso d'Europa e delle Americhe
const msDi = giorno => (giorno ? Date.parse(`${giorno}T12:00:00Z`) : null);
async function crea(k, { nome, note, scadenza }) {
  const lista = String(k.imp.lista || '').trim(); if (!lista) throw new Error('Scrivi nelle impostazioni l\'id della lista di ClickUp');
  const json = { name: String(nome).slice(0, 1000), ...(note ? { description: String(note) } : {}), ...(scadenza ? { due_date: msDi(scadenza), due_date_time: false } : {}) };
  const r = await k.http.post(`${cbase(k)}/api/v2/list/${encodeURIComponent(lista)}/task`, { ...auth(k), json });
  if (!r.ok) throw no(r, 'la creazione del compito');
  return r.json || {};
}
export default {
  id: 'clickup', nome: 'ClickUp', versione: 1, icona: 'matita',
  descrizione: 'Lumi crea i compiti in ClickUp; le attività, gli interventi o le commesse nuove diventano compiti.',
  impostazioni: [
    { id: 'token', nome: 'Token API personale (pk_…)', segreto: true, schema: /^pk_[A-Za-z0-9_]{10,}$/ },
    { id: 'lista', nome: 'Id della lista dove nascono i compiti', schema: /^[0-9a-z-]{3,40}$/ },
    ...impostazioniCompiti(),
  ],
  permessi: permessiCompiti,
  prova: async k => {
    const r = await k.http.get(`${cbase(k)}/api/v2/list/${encodeURIComponent(String(k.imp.lista || ''))}`, auth(k));
    return { ok: r.ok, messaggio: r.ok ? `Lista «${r.json?.name}»` : `HTTP ${r.stato}${r.json?.err ? ': ' + r.json.err : ''}` };
  },
  uscita: uscitaCompiti(async (k, c) => (await crea(k, { nome: c.titolo, note: c.note, scadenza: c.scadenza })).id),
  azioni: {
    crea_compito: {
      nome: 'Crea un compito', descrizione: 'Crea un compito in ClickUp nella lista scelta nelle impostazioni (nome, note, scadenza), es. «metti in ClickUp: ordinare il materiale entro il 20»', lumi: true, scrive: true,
      input: { nome: { tipo: 'testo', nome: 'Il compito, in breve' }, note: { tipo: 'testo', nome: 'Le note (facoltative)', facoltativo: true }, scadenza: { tipo: 'testo', nome: 'La scadenza AAAA-MM-GG (facoltativa)', facoltativo: true } },
      proponi: async x => ({ titolo: 'Nuovo compito in ClickUp', righe: [['Compito', String(x.nome || '')], ['Scadenza', dataDi(x.scadenza) || '—']], avvisi: [...(x.nome ? [] : ['Manca il testo del compito']), ...(x.scadenza && !dataDi(x.scadenza) ? [`Scadenza «${x.scadenza}» non chiara: scrivila come AAAA-MM-GG`] : [])] }),
      esegui: async (x, k) => {
        if (!String(x.nome || '').trim()) throw new Error('Manca il testo del compito');
        const t = await crea(k, { nome: x.nome, note: x.note, scadenza: dataDi(x.scadenza) });
        return { ok: true, id: t.id, link: t.url || null };
      },
    },
  },
  catalogo: {
    categoria: 'produttivita', sito: 'https://clickup.com', costo: 'gratis',
    costoNota: 'Piano Free Forever gratuito (100 MB di spazio, utenti illimitati), con l\'API. Unlimited circa 7 $ per utente al mese con fatturazione annuale; Business circa 12 $.',
    serve: [
      { cosa: 'Il token API personale (inizia con pk_)', dove: 'ClickUp → avatar in alto → Impostazioni → App → API Token → Generate', link: 'https://app.clickup.com/settings/apps' },
      { cosa: 'L\'id della lista', dove: 'Apri la lista nel browser: è il numero dopo /li/ nell\'indirizzo (o «Copy link» dal menu della lista)', link: 'https://help.clickup.com/hc/en-us/articles/6303426241687-Use-the-ClickUp-API' },
    ],
    passi: [
      'In ClickUp apri Impostazioni → App e genera il token API personale (pk_…).',
      'Apri la lista dove vuoi i compiti e copia il numero che segue /li/ nell\'indirizzo.',
      'Incolla token e id della lista e premi «Prova la connessione»: vedi il nome della lista.',
      'Accendi le sezioni che vuoi trasformare in compiti (attività, interventi, commesse).',
      'Da qui chiedi a Lumi «metti in ClickUp: ordinare il materiale entro il 20»: ti mostra il compito e lo crea dopo la conferma.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developer.clickup.com/reference/createtask', 'https://developer.clickup.com/docs/authentication', 'https://developer.clickup.com/reference/getlist', 'https://clickup.com/pricing'],
    prova: 'finto', parole: ['clickup', 'compiti', 'progetti', 'attività', 'task', 'project management', 'to-do'],
  },
  testi: unisciTesti({
    en: { nome: 'ClickUp', descrizione: 'Lumi creates tasks in ClickUp; new activities, jobs or orders become tasks.', 'imp.token': 'Personal API token (pk_…)', 'imp.lista': 'List id for new tasks',
      'cat.costoNota': 'Free Forever plan (100 MB storage, unlimited members), API included. Unlimited about $7 per user per month billed annually; Business about $12.',
      'cat.serve': [{ cosa: 'The personal API token (starts with pk_)', dove: 'ClickUp → avatar at the top → Settings → Apps → API Token → Generate' }, { cosa: 'The list id', dove: 'Open the list in the browser: it is the number after /li/ in the address (or «Copy link» from the list menu)' }],
      'cat.passi': ['In ClickUp open Settings → Apps and generate the personal API token (pk_…).', 'Open the list for the tasks and copy the number after /li/ in the address.', 'Paste token and list id and press «Test connection»: you see the list name.', 'Turn on the sections to turn into tasks (activities, jobs, orders).', 'Then ask Lumi «put in ClickUp: order the material by the 20th»: it shows the task and creates it after you confirm.'] },
    es: { nome: 'ClickUp', descrizione: 'Lumi crea tareas en ClickUp; las actividades, intervenciones o encargos nuevos se convierten en tareas.', 'imp.token': 'Token API personal (pk_…)', 'imp.lista': 'Id de la lista de las tareas' },
    fr: { nome: 'ClickUp', descrizione: 'Lumi crée des tâches dans ClickUp ; les nouvelles activités, interventions ou commandes deviennent des tâches.', 'imp.token': 'Jeton API personnel (pk_…)', 'imp.lista': 'Id de la liste des tâches' },
    de: { nome: 'ClickUp', descrizione: 'Lumi legt Aufgaben in ClickUp an; neue Aufgaben, Einsätze oder Aufträge werden zu Tasks.', 'imp.token': 'Persönliches API-Token (pk_…)', 'imp.lista': 'Listen-ID für neue Tasks' },
    pt: { nome: 'ClickUp', descrizione: 'A Lumi cria tarefas no ClickUp; atividades, intervenções ou encomendas novas viram tarefas.', 'imp.token': 'Token de API pessoal (pk_…)', 'imp.lista': 'Id da lista das tarefas' },
  }, testiCompiti),
};
