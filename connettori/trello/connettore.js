// Trello: Lumi crea una scheda nella lista scelta, e a scelta ogni riga nuova di attività, interventi (l'officina)
// o commesse diventa una scheda, con il link alla riga di Lumi se c'è l'indirizzo pubblico.
// Chiave API + token: Trello li accetta nella query (key=…&token=…) o nell'intestazione «Authorization: OAuth
// oauth_consumer_key=…, oauth_token=…». Qui l'intestazione: i segreti non finiscono negli indirizzi né nei registri.
import { permessiCompiti, impostazioniCompiti, testiCompiti, unisciTesti, uscitaCompiti, dataDi } from '../_comunica/compiti.js';
const tbase = k => k.base || 'https://api.trello.com';
const opz = (k, json) => ({ intestazioni: { Authorization: `OAuth oauth_consumer_key="${k.segreti.chiave}", oauth_token="${k.segreti.token}"` }, ...(json ? { json } : {}) });
const no = (r, cosa) => new Error(`Trello ha risposto ${r.stato} a ${cosa}${r.testo && r.testo.length < 200 ? ': ' + r.testo : ''}`);
async function crea(k, { nome, descrizione, scadenza, link }) {
  const json = { idList: k.imp.lista, name: String(nome).slice(0, 500), pos: 'top', ...(descrizione ? { desc: String(descrizione).slice(0, 16000) } : {}), ...(scadenza ? { due: scadenza } : {}), ...(link ? { urlSource: link } : {}) };
  const r = await k.http.post(`${tbase(k)}/1/cards`, opz(k, json));
  if (!r.ok) throw no(r, 'la creazione della scheda');
  return r.json;
}
export default {
  id: 'trello', nome: 'Trello', versione: 1, icona: 'griglia',
  descrizione: 'Lumi crea le schede su Trello; le attività, gli interventi o le commesse nuove diventano schede.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API (API key)', segreto: true, schema: /^[0-9a-f]{32}$/ },
    { id: 'token', nome: 'Token', segreto: true, schema: /^[A-Za-z0-9]{60,80}$/ },
    { id: 'lista', nome: 'Id della lista dove nascono le schede', schema: /^[0-9a-f]{24}$/ },
    ...impostazioniCompiti(),
  ],
  permessi: permessiCompiti,
  prova: async k => {
    const r = await k.http.get(`${tbase(k)}/1/lists/${encodeURIComponent(k.imp.lista)}?fields=name`, opz(k));
    return { ok: r.ok, messaggio: r.ok ? `Lista «${r.json?.name}»` : `HTTP ${r.stato}` };
  },
  uscita: uscitaCompiti(async (k, c) => (await crea(k, { nome: c.titolo, descrizione: c.note, scadenza: c.scadenza, link: c.link })).id),
  azioni: {
    crea_compito: {
      nome: 'Crea una scheda', descrizione: 'Crea una scheda nella lista di Trello scelta nelle impostazioni (nome, descrizione, scadenza)', lumi: true, scrive: true,
      input: { nome: { tipo: 'testo', nome: 'Il titolo della scheda' }, descrizione: { tipo: 'testo', nome: 'La descrizione (facoltativa)', facoltativo: true }, scadenza: { tipo: 'testo', nome: 'La scadenza AAAA-MM-GG (facoltativa)', facoltativo: true } },
      proponi: async x => ({ titolo: 'Nuova scheda su Trello', righe: [['Scheda', String(x.nome || '')], ['Scadenza', dataDi(x.scadenza) || '—']], avvisi: [...(x.nome ? [] : ['Manca il titolo della scheda']), ...(x.scadenza && !dataDi(x.scadenza) ? [`Scadenza «${x.scadenza}» non chiara: scrivila come AAAA-MM-GG`] : [])] }),
      esegui: async (x, k) => {
        if (!String(x.nome || '').trim()) throw new Error('Manca il titolo della scheda');
        const c = await crea(k, { nome: x.nome, descrizione: x.descrizione, scadenza: dataDi(x.scadenza) });
        return { ok: true, id: c.id, link: c.shortUrl || c.url || null };
      },
    },
  },
  catalogo: {
    categoria: 'produttivita', sito: 'https://trello.com', costo: 'gratis',
    costoNota: 'Piano Free gratuito (fino a 10 collaboratori per Workspace), con l\'API. Standard 5 $ per utente al mese con fatturazione annuale; Premium 10 $.',
    serve: [
      { cosa: 'Una Power-Up (serve per avere la chiave API) e la sua API key', dove: 'trello.com/power-ups/admin → Nuovo → compila e crea → API key → Genera una nuova chiave API', link: 'https://trello.com/power-ups/admin' },
      { cosa: 'Il token del tuo account', dove: 'Nella pagina della API key, link «Token» accanto alla chiave → Consenti', link: 'https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/' },
      { cosa: 'L\'id della lista', dove: 'Apri una scheda della lista, aggiungi «.json» all\'indirizzo e cerca «idList»', link: 'https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/' },
    ],
    passi: [
      'Vai su trello.com/power-ups/admin e crea una Power-Up per il tuo Workspace (il nome è libero, es. Lumi).',
      'Nella scheda «API key» genera la chiave, poi premi «Token» e consenti l\'accesso: copia chiave e token.',
      'Trova l\'id della lista: apri una sua scheda, aggiungi «.json» all\'indirizzo e copia il valore di «idList».',
      'Incolla chiave, token e id della lista e premi «Prova la connessione»: vedi il nome della lista.',
      'Accendi le sezioni che vuoi trasformare in schede (es. gli interventi dell\'officina).',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developer.atlassian.com/cloud/trello/rest/api-group-cards/#api-cards-post', 'https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/', 'https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/', 'https://trello.com/pricing'],
    prova: 'finto', parole: ['trello', 'schede', 'kanban', 'bacheca', 'lista', 'board', 'card', 'task'],
  },
  testi: unisciTesti({
    en: { nome: 'Trello', descrizione: 'Lumi creates Trello cards; new activities, jobs or orders become cards.', 'imp.chiave': 'API key', 'imp.token': 'Token', 'imp.lista': 'Id of the list where cards are created', 'az.crea_compito': 'Create a card',
      'cat.costoNota': 'Free plan (up to 10 collaborators per Workspace), API included. Standard $5 per user per month billed annually; Premium $10.',
      'cat.serve': [{ cosa: 'A Power-Up (needed to get the API key) and its API key', dove: 'trello.com/power-ups/admin → New → fill in and create → API key → Generate a new API key' }, { cosa: 'Your account token', dove: 'On the API key page, «Token» link next to the key → Allow' }, { cosa: 'The list id', dove: 'Open a card of the list, add «.json» to the address and look for «idList»' }],
      'cat.passi': ['Go to trello.com/power-ups/admin and create a Power-Up for your Workspace (any name, e.g. Lumi).', 'In the «API key» tab generate the key, then press «Token» and allow access: copy key and token.', 'Find the list id: open one of its cards, add «.json» to the address and copy the «idList» value.', 'Paste key, token and list id and press «Test connection»: you see the list name.', 'Turn on the sections to turn into cards (e.g. workshop jobs).'] },
    es: { nome: 'Trello', descrizione: 'Lumi crea tarjetas en Trello; las actividades, intervenciones o encargos nuevos se convierten en tarjetas.', 'imp.chiave': 'Clave API', 'imp.token': 'Token', 'imp.lista': 'Id de la lista donde nacen las tarjetas', 'az.crea_compito': 'Crear una tarjeta' },
    fr: { nome: 'Trello', descrizione: 'Lumi crée des cartes Trello ; les nouvelles activités, interventions ou commandes deviennent des cartes.', 'imp.chiave': 'Clé API', 'imp.token': 'Jeton', 'imp.lista': 'Id de la liste où naissent les cartes', 'az.crea_compito': 'Créer une carte' },
    de: { nome: 'Trello', descrizione: 'Lumi legt Trello-Karten an; neue Aufgaben, Einsätze oder Aufträge werden zu Karten.', 'imp.chiave': 'API-Schlüssel', 'imp.token': 'Token', 'imp.lista': 'ID der Liste für neue Karten', 'az.crea_compito': 'Karte anlegen' },
    pt: { nome: 'Trello', descrizione: 'A Lumi cria cartões no Trello; atividades, intervenções ou encomendas novas viram cartões.', 'imp.chiave': 'Chave de API', 'imp.token': 'Token', 'imp.lista': 'Id da lista onde nascem os cartões', 'az.crea_compito': 'Criar um cartão' },
  }, testiCompiti),
};
