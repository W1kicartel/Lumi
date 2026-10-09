// Asana: Lumi crea un compito nel progetto (o nell'area di lavoro) scelto, e a scelta ogni riga nuova di attività,
// interventi o commesse diventa un compito. Personal Access Token (Bearer), POST /api/1.0/tasks { data: { … } }.
import { permessiCompiti, impostazioniCompiti, testiCompiti, unisciTesti, uscitaCompiti, dataDi } from '../_comunica/compiti.js';
const abase = k => k.base || 'https://app.asana.com';
const no = (r, cosa) => new Error(`Asana ha risposto ${r.stato} a ${cosa}${r.json?.errors?.[0]?.message ? ': ' + r.json.errors[0].message : ''}`);
async function crea(k, { nome, note, scadenza }) {
  if (!k.imp.progetto && !k.imp.area) throw new Error('Scrivi nelle impostazioni l\'id del progetto o dell\'area di lavoro di Asana');
  const data = { name: String(nome).slice(0, 1000), ...(note ? { notes: String(note) } : {}), ...(scadenza ? { due_on: scadenza } : {}), ...(k.imp.progetto ? { projects: [k.imp.progetto] } : { workspace: k.imp.area }) };
  const r = await k.http.post(`${abase(k)}/api/1.0/tasks`, { bearer: k.segreti.token, json: { data } });
  if (!r.ok) throw no(r, 'la creazione del compito');
  return r.json?.data || {};
}
export default {
  id: 'asana', nome: 'Asana', versione: 1, icona: 'matita',
  descrizione: 'Lumi crea i compiti in Asana; le attività, gli interventi o le commesse nuove diventano compiti.',
  impostazioni: [
    { id: 'token', nome: 'Personal Access Token', segreto: true, schema: /^[0-9]\/[0-9a-zA-Z:/]{20,}$/ },
    { id: 'progetto', nome: 'Id (gid) del progetto dove nascono i compiti', schema: /^\d{6,20}$/, obbligatorio: false },
    { id: 'area', nome: 'Oppure: id (gid) dell\'area di lavoro (workspace)', schema: /^\d{6,20}$/, obbligatorio: false },
    ...impostazioniCompiti(),
  ],
  permessi: permessiCompiti,
  prova: async k => { const r = await k.http.get(`${abase(k)}/api/1.0/users/me?opt_fields=name`, { bearer: k.segreti.token }); return { ok: r.ok, messaggio: r.ok ? `Collegato come ${r.json?.data?.name}` : `HTTP ${r.stato}` }; },
  uscita: uscitaCompiti(async (k, c) => (await crea(k, { nome: c.titolo, note: c.note, scadenza: c.scadenza })).gid),
  azioni: {
    crea_compito: {
      nome: 'Crea un compito', descrizione: 'Crea un compito in Asana nel progetto scelto nelle impostazioni (nome, note, scadenza)', lumi: true, scrive: true,
      input: { nome: { tipo: 'testo', nome: 'Il compito, in breve' }, note: { tipo: 'testo', nome: 'Le note (facoltative)', facoltativo: true }, scadenza: { tipo: 'testo', nome: 'La scadenza AAAA-MM-GG (facoltativa)', facoltativo: true } },
      proponi: async x => ({ titolo: 'Nuovo compito in Asana', righe: [['Compito', String(x.nome || '')], ['Scadenza', dataDi(x.scadenza) || '—']], avvisi: [...(x.nome ? [] : ['Manca il testo del compito']), ...(x.scadenza && !dataDi(x.scadenza) ? [`Scadenza «${x.scadenza}» non chiara: scrivila come AAAA-MM-GG`] : [])] }),
      esegui: async (x, k) => {
        if (!String(x.nome || '').trim()) throw new Error('Manca il testo del compito');
        const t = await crea(k, { nome: x.nome, note: x.note, scadenza: dataDi(x.scadenza) });
        return { ok: true, id: t.gid, link: t.permalink_url || null };
      },
    },
  },
  catalogo: {
    categoria: 'produttivita', sito: 'https://asana.com', costo: 'gratis',
    costoNota: 'Piano Personal gratuito (fino a 10 persone), con l\'API. Starter circa 10,99 $ per utente al mese con fatturazione annuale; Advanced circa 24,99 $.',
    serve: [
      { cosa: 'Un Personal Access Token', dove: 'Asana → Developer console → Personal access tokens → Create new token', link: 'https://app.asana.com/0/my-apps' },
      { cosa: 'L\'id (gid) del progetto', dove: 'Apri il progetto: è il numero lungo nell\'indirizzo, dopo /project/ (o dopo /0/)', link: 'https://developers.asana.com/docs/personal-access-token' },
    ],
    passi: [
      'Apri la Developer console di Asana e crea un Personal Access Token: copialo subito, non si rivede.',
      'Apri il progetto dove vuoi i compiti e copia il numero lungo dall\'indirizzo (il gid del progetto).',
      'Incolla token e id del progetto e premi «Prova la connessione».',
      'Accendi le sezioni che vuoi trasformare in compiti (attività, interventi, commesse).',
      'Da qui chiedi a Lumi «metti in Asana: preparare l\'offerta per Bianchi entro il 15»: ti mostra il compito e lo crea dopo la conferma.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developers.asana.com/reference/createtask', 'https://developers.asana.com/docs/personal-access-token', 'https://developers.asana.com/reference/getuser', 'https://asana.com/pricing'],
    prova: 'finto', parole: ['asana', 'compiti', 'progetti', 'attività', 'task', 'project management', 'to-do'],
  },
  testi: unisciTesti({
    en: { nome: 'Asana', descrizione: 'Lumi creates tasks in Asana; new activities, jobs or orders become tasks.', 'imp.token': 'Personal Access Token', 'imp.progetto': 'Project id (gid) for new tasks', 'imp.area': 'Or: workspace id (gid)',
      'cat.costoNota': 'Free Personal plan (up to 10 people), API included. Starter about $10.99 per user per month billed annually; Advanced about $24.99.',
      'cat.serve': [{ cosa: 'A Personal Access Token', dove: 'Asana → Developer console → Personal access tokens → Create new token' }, { cosa: 'The project id (gid)', dove: 'Open the project: it is the long number in the address, after /project/ (or after /0/)' }],
      'cat.passi': ['Open the Asana Developer console and create a Personal Access Token: copy it now, it is not shown again.', 'Open the project for the tasks and copy the long number from the address (the project gid).', 'Paste token and project id and press «Test connection».', 'Turn on the sections to turn into tasks (activities, jobs, orders).', 'Then ask Lumi «put in Asana: prepare the offer for Bianchi by the 15th»: it shows the task and creates it after you confirm.'] },
    es: { nome: 'Asana', descrizione: 'Lumi crea tareas en Asana; las actividades, intervenciones o encargos nuevos se convierten en tareas.', 'imp.token': 'Personal Access Token', 'imp.progetto': 'Id (gid) del proyecto de las tareas', 'imp.area': 'O bien: id (gid) del espacio de trabajo' },
    fr: { nome: 'Asana', descrizione: 'Lumi crée des tâches dans Asana ; les nouvelles activités, interventions ou commandes deviennent des tâches.', 'imp.token': 'Personal Access Token', 'imp.progetto': 'Id (gid) du projet des tâches', 'imp.area': 'Ou : id (gid) de l\'espace de travail' },
    de: { nome: 'Asana', descrizione: 'Lumi legt Aufgaben in Asana an; neue Aufgaben, Einsätze oder Aufträge werden zu Tasks.', 'imp.token': 'Personal Access Token', 'imp.progetto': 'Projekt-ID (gid) für neue Tasks', 'imp.area': 'Oder: Workspace-ID (gid)' },
    pt: { nome: 'Asana', descrizione: 'A Lumi cria tarefas no Asana; atividades, intervenções ou encomendas novas viram tarefas.', 'imp.token': 'Personal Access Token', 'imp.progetto': 'Id (gid) do projeto das tarefas', 'imp.area': 'Ou: id (gid) do espaço de trabalho' },
  }, testiCompiti),
};
