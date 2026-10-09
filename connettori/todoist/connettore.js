// Todoist: Lumi crea un compito da una frase («ricordami di chiamare Rossi venerdì»: la scadenza resta in linguaggio
// naturale, la capisce Todoist con due_string e due_lang), e a scelta ogni riga nuova di attività, interventi o commesse
// diventa un compito. API v1 (la REST v2 è stata sostituita): https://api.todoist.com/api/v1, token personale Bearer.
import { permessiCompiti, impostazioniCompiti, testiCompiti, unisciTesti, uscitaCompiti } from '../_comunica/compiti.js';
const tbase = k => k.base || 'https://api.todoist.com';
const no = (r, cosa) => new Error(`Todoist ha risposto ${r.stato} a ${cosa}${r.json?.error ? ': ' + r.json.error : ''}`);
// i progetti (a pagine con next_cursor), al massimo 10 pagine
async function progetti(k) {
  const out = []; let cursor = null;
  for (let i = 0; i < 10; i++) {
    const r = await k.http.get(`${tbase(k)}/api/v1/projects?limit=200${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { bearer: k.segreti.token });
    if (!r.ok) throw no(r, 'l\'elenco dei progetti');
    out.push(...(r.json?.results || [])); cursor = r.json?.next_cursor; if (!cursor) break;
  }
  return out;
}
// il progetto chiesto per nome (o id); senza nome quello delle impostazioni, o la Inbox
async function progettoDi(k, nome) {
  const n = String(nome || '').trim(); if (!n) return k.imp.progetto ? { id: k.imp.progetto, name: k.imp.progetto } : null;
  const p = (await progetti(k)).find(x => x.id === n || String(x.name).toLowerCase() === n.toLowerCase());
  if (!p) throw new Error(`In Todoist non c'è il progetto «${n}»`);
  return p;
}
async function crea(k, { contenuto, note, scadenza, progetto }) {
  // una data esatta (dalle righe di Kubo) va in due_date; le parole («venerdì», «ogni lunedì») in due_string
  const s = String(scadenza || '').trim(), due = !s ? {} : /^\d{4}-\d{2}-\d{2}$/.test(s) ? { due_date: s } : { due_string: s, due_lang: k.imp.lingua || 'it' };
  const json = { content: String(contenuto).slice(0, 500), ...(note ? { description: note } : {}), ...due, ...(progetto ? { project_id: progetto } : {}) };
  const r = await k.http.post(`${tbase(k)}/api/v1/tasks`, { bearer: k.segreti.token, json });
  if (!r.ok) throw no(r, 'la creazione del compito');
  return r.json;
}
export default {
  id: 'todoist', nome: 'Todoist', versione: 1, icona: 'matita',
  descrizione: 'Lumi segna i compiti in Todoist; le attività, gli interventi o le commesse nuove diventano compiti.',
  impostazioni: [
    { id: 'token', nome: 'Token API personale', segreto: true, schema: /^[0-9a-f]{40}$/ },
    { id: 'progetto', nome: 'Id del progetto predefinito (vuoto: la Inbox)', obbligatorio: false },
    { id: 'lingua', nome: 'Lingua delle scadenze scritte a parole', tipo: 'scelta', opzioni: ['it', 'en', 'es', 'fr', 'de', 'pt'].map(id => ({ id, nome: id })), predefinito: 'it' },
    ...impostazioniCompiti(),
  ],
  permessi: permessiCompiti,
  prova: async k => { const p = await progetti(k); return { ok: true, messaggio: `${p.length} progetti` }; },
  uscita: uscitaCompiti(async (k, c) => (await crea(k, { contenuto: c.titolo, note: c.note, scadenza: c.scadenza, progetto: k.imp.progetto || null })).id),
  azioni: {
    crea_compito: {
      nome: 'Crea un compito', descrizione: 'Segna un compito in Todoist, per esempio «ricordami di chiamare Rossi venerdì»', lumi: true, scrive: true,
      input: { contenuto: { tipo: 'testo', nome: 'Il compito, in breve (es. Chiamare Rossi)' }, scadenza: { tipo: 'testo', nome: 'Quando, a parole (es. venerdì, domani alle 10, ogni lunedì)', facoltativo: true }, progetto: { tipo: 'testo', nome: 'Il nome del progetto (facoltativo)', facoltativo: true }, note: { tipo: 'testo', nome: 'Note (facoltative)', facoltativo: true } },
      proponi: async (x, k) => ({ titolo: 'Nuovo compito in Todoist', righe: [['Compito', String(x.contenuto || '')], ['Scadenza', x.scadenza || '—'], ['Progetto', x.progetto || 'Inbox']], avvisi: x.contenuto ? [] : ['Manca il testo del compito'] }),
      esegui: async (x, k) => {
        if (!String(x.contenuto || '').trim()) throw new Error('Manca il testo del compito');
        const p = await progettoDi(k, x.progetto), t = await crea(k, { ...x, progetto: p?.id });
        return { ok: true, id: t.id, scadenza: t.due?.date || null, link: t.url || `https://app.todoist.com/app/task/${t.id}` };
      },
    },
  },
  catalogo: {
    categoria: 'produttivita', sito: 'https://www.todoist.com', costo: 'gratis',
    costoNota: 'Piano Beginner gratuito (fino a 5 progetti personali), con l\'API. Pro circa 4 € al mese con fatturazione annuale; Business circa 6 € per utente al mese.',
    serve: [
      { cosa: 'Il token API personale', dove: 'Todoist → Impostazioni → Integrazioni → Sviluppatore → Token API → Copia', link: 'https://app.todoist.com/app/settings/integrations/developer' },
      { cosa: 'Facoltativo: l\'id del progetto predefinito', dove: 'Apri il progetto nel browser: è il numero (o codice) in fondo all\'indirizzo', link: 'https://www.todoist.com/help/articles/find-your-project-id-or-task-id-6IqXPXbM' },
    ],
    passi: [
      'In Todoist apri Impostazioni → Integrazioni → Sviluppatore e copia il token API.',
      'Incollalo qui; se vuoi, scrivi l\'id del progetto dove far cadere i compiti (vuoto: la Inbox).',
      'Premi «Prova la connessione»: vedi quanti progetti hai.',
      'Accendi le sezioni che vuoi trasformare in compiti (attività, interventi, commesse).',
      'Da qui chiedi a Lumi «ricordami di chiamare Rossi venerdì»: ti mostra il compito e lo crea dopo la conferma.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developer.todoist.com/api/v1/#tag/Tasks/operation/create_task_api_v1_tasks_post', 'https://developer.todoist.com/api/v1/#tag/Projects/operation/get_projects_api_v1_projects_get', 'https://developer.todoist.com/api/v1/#tag/Authorization', 'https://www.todoist.com/pricing'],
    prova: 'finto', parole: ['todoist', 'compiti', 'promemoria', 'cose da fare', 'to-do', 'task', 'reminder', 'todo list'],
  },
  testi: unisciTesti({
    en: { nome: 'Todoist', descrizione: 'Lumi adds tasks to Todoist; new activities, jobs or orders become tasks.', 'imp.token': 'Personal API token', 'imp.progetto': 'Default project id (empty: Inbox)', 'imp.lingua': 'Language of due dates written in words',
      'cat.costoNota': 'Free Beginner plan (up to 5 personal projects), API included. Pro about €4 per month billed annually; Business about €6 per user per month.',
      'cat.serve': [{ cosa: 'The personal API token', dove: 'Todoist → Settings → Integrations → Developer → API token → Copy' }, { cosa: 'Optional: the default project id', dove: 'Open the project in the browser: it is the number (or code) at the end of the address' }],
      'cat.passi': ['In Todoist open Settings → Integrations → Developer and copy the API token.', 'Paste it here; optionally add the id of the project where tasks land (empty: Inbox).', 'Press «Test connection»: you see how many projects you have.', 'Turn on the sections to turn into tasks (activities, jobs, orders).', 'Then ask Lumi «remind me to call Rossi on Friday»: it shows the task and creates it after you confirm.'] },
    es: { nome: 'Todoist', descrizione: 'Lumi apunta tareas en Todoist; las actividades, intervenciones o encargos nuevos se convierten en tareas.', 'imp.token': 'Token API personal', 'imp.progetto': 'Id del proyecto predeterminado (vacío: Bandeja de entrada)', 'imp.lingua': 'Idioma de los vencimientos escritos con palabras' },
    fr: { nome: 'Todoist', descrizione: 'Lumi note les tâches dans Todoist ; les nouvelles activités, interventions ou commandes deviennent des tâches.', 'imp.token': 'Jeton API personnel', 'imp.progetto': 'Id du projet par défaut (vide : Boîte de réception)', 'imp.lingua': 'Langue des échéances écrites en toutes lettres' },
    de: { nome: 'Todoist', descrizione: 'Lumi trägt Aufgaben in Todoist ein; neue Aufgaben, Einsätze oder Aufträge werden zu Tasks.', 'imp.token': 'Persönliches API-Token', 'imp.progetto': 'Standardprojekt-ID (leer: Eingang)', 'imp.lingua': 'Sprache der in Worten geschriebenen Fälligkeiten' },
    pt: { nome: 'Todoist', descrizione: 'A Lumi anota tarefas no Todoist; atividades, intervenções ou encomendas novas viram tarefas.', 'imp.token': 'Token de API pessoal', 'imp.progetto': 'Id do projeto padrão (vazio: Caixa de entrada)', 'imp.lingua': 'Idioma dos prazos escritos por extenso' },
  }, testiCompiti),
};
