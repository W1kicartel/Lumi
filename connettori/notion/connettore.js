// Notion: una sezione di Lumi copiata in un database di Notion, una pagina per riga, ogni 15 minuti solo le righe cambiate.
// Le proprietà si abbinano per nome a quelle del database (title, rich_text, number, date, email, phone_number, url,
// checkbox, select, multi_select); il titolo della pagina, se nessun campo ha il suo nome, è il titolo della riga.
// Gli id delle pagine restano in k.sincro: la seconda volta si aggiorna la stessa pagina (PATCH), non se ne crea un'altra.
// API con Notion-Version 2022-06-28: ancora supportata, e parent.database_id funziona senza i «data source» del 2025.
import { sezione, cambiate, testo } from '../_comunica/tabelle.js';
const VERSIONE = '2022-06-28';
const nbase = k => k.base || 'https://api.notion.com';
const opz = (k, json) => ({ bearer: k.segreti.token, intestazioni: { 'Notion-Version': VERSIONE }, ...(json ? { json } : {}) });
const no = (r, cosa) => new Error(`Notion ha risposto ${r.stato} a ${cosa}${r.json?.message ? ': ' + r.json.message : ''}`);
const idDb = k => encodeURIComponent(String(k.imp.database || '').trim().replace(/^.*?([0-9a-f]{32}|[0-9a-f-]{36}).*$/i, '$1'));   // anche l'indirizzo intero del database
const rt = s => [{ type: 'text', text: { content: String(s).slice(0, 2000) } }];
// un valore di Lumi nella forma della proprietà di Notion; null = la proprietà si svuota
function proprieta(tipo, v) {
  const t = testo(v), vuoto = v == null || v === '' || (Array.isArray(v) && !v.length);
  switch (tipo) {
    case 'title': case 'rich_text': return { [tipo]: vuoto ? [] : rt(t) };
    case 'number': { const n = Number(v); return { number: vuoto || !Number.isFinite(n) ? null : n }; }
    case 'checkbox': return { checkbox: v === true };
    case 'date': return { date: vuoto ? null : { start: String(v) } };
    case 'email': case 'phone_number': case 'url': return { [tipo]: vuoto ? null : t };
    case 'select': return { select: vuoto ? null : { name: t.slice(0, 100).replace(/,/g, ' ') } };
    case 'multi_select': return { multi_select: vuoto ? [] : [].concat(v).map(x => ({ name: testo(x).slice(0, 100).replace(/,/g, ' ') })) };
    default: return undefined;   // formule, relazioni, persone…: Notion le gestisce da sé
  }
}
async function schema(k) {
  const r = await k.http.get(`${nbase(k)}/v1/databases/${idDb(k)}`, opz(k));
  if (!r.ok) throw no(r, 'il database');
  return { titolo: r.json?.title?.map(x => x.plain_text).join('') || 'database', proprieta: Object.values(r.json?.properties || {}) };
}
async function sincronizza(k, { tutto = false } = {}) {
  const { entita, def, campi } = sezione(k, k.imp.sezione), db = await schema(k);
  const perNome = new Map(db.proprieta.map(p => [p.name.toLowerCase(), p])), titoloP = db.proprieta.find(p => p.type === 'title');
  const usati = campi.map(c => [c, perNome.get(c.nome.toLowerCase()) || perNome.get(c.id)]).filter(([, p]) => p && proprieta(p.type, null) !== undefined);
  const titoloDaCampo = usati.some(([, p]) => p.type === 'title'), campoTitolo = k.S.campoTitolo?.(def);
  if (tutto) k.stato.scrivi(`cursore:${entita}`, null);
  const { righe, salva } = cambiate(k, entita); let creati = 0, aggiornati = 0;
  for (const r of righe) {
    const props = Object.fromEntries(usati.map(([c, p]) => [p.name, proprieta(p.type, r[c.id])]));
    if (!titoloDaCampo && titoloP) props[titoloP.name] = proprieta('title', campoTitolo ? r[campoTitolo.id] : r.id);
    const pid = k.sincro.remoto(entita, r.id);
    let x = pid ? await k.http.patch(`${nbase(k)}/v1/pages/${pid}`, opz(k, { properties: props })) : null;
    if (!x || x.stato === 404) {   // nuova, o la pagina è stata cancellata in Notion: se ne crea un'altra
      x = await k.http.post(`${nbase(k)}/v1/pages`, opz(k, { parent: { database_id: idDb(k) }, properties: props }));
      if (!x.ok) throw no(x, 'la nuova pagina');
      k.sincro.collega(entita, r.id, x.json.id); creati++;
    } else if (!x.ok) throw no(x, 'l\'aggiornamento della pagina'); else aggiornati++;
    salva(r.modificato);
  }
  return { database: db.titolo, creati, aggiornati, proprieta: usati.length + (titoloDaCampo ? 0 : 1) };
}
export default {
  id: 'notion', nome: 'Notion', versione: 1, icona: 'documento',
  descrizione: 'Copia una sezione di Lumi in un database di Notion, una pagina per riga.',
  impostazioni: [
    { id: 'token', nome: 'Token dell\'integrazione interna (ntn_… o secret_…)', segreto: true, schema: /^(ntn_|secret_)[A-Za-z0-9]{20,}$/ },
    { id: 'database', nome: 'Id del database (o il suo indirizzo)' },
    { id: 'sezione', nome: 'Sezione di Lumi da copiare (es. clienti)' },
  ],
  permessi: { '*': { leggi: true } },
  prova: async k => { const s = await schema(k); return { ok: true, messaggio: `${s.titolo}: ${s.proprieta.length} proprietà` }; },
  azioni: {
    sincronizza_ora: {
      nome: 'Copia tutto in Notion', descrizione: 'Ricopia in Notion tutte le righe della sezione scelta, non solo quelle cambiate', lumi: true, scrive: true,
      proponi: async (x, k) => { const { def } = sezione(k, k.imp.sezione); return { titolo: 'Copia in Notion', righe: [['Sezione', def.nome], ['Database', idDb(k) || '—']], avvisi: [] }; },
      esegui: async (x, k) => sincronizza(k, { tutto: true }),
    },
  },
  pianificati: { sincronizza: { nome: 'Copia le righe cambiate', ogni: '15m', giro: k => sincronizza(k) } },
  catalogo: {
    categoria: 'produttivita', sito: 'https://www.notion.com', costo: 'gratis',
    costoNota: 'Il piano Free basta per l\'integrazione; Plus da 10 € per utente al mese (fatturazione annuale). L\'API non costa niente, con un limite medio di 3 richieste al secondo.',
    serve: [
      { cosa: 'Il token di un\'integrazione interna (Internal Integration Secret)', dove: 'notion.so/profile/integrations → Nuova integrazione → tipo Interna → Configurazione → Secret', link: 'https://www.notion.so/profile/integrations' },
      { cosa: 'L\'accesso dell\'integrazione al database', dove: 'Nel database: ••• in alto a destra → Connessioni → aggiungi l\'integrazione', link: 'https://www.notion.com/help/add-and-manage-connections-with-the-api' },
      { cosa: 'L\'id del database', dove: 'Apri il database a tutta pagina → Copia link: sono i 32 caratteri prima di «?v=»', link: 'https://developers.notion.com/reference/retrieve-a-database' },
    ],
    passi: [
      'In Notion crea un database con le colonne chiamate come i campi di Lumi (es. Nome, Email, Telefono).',
      'Crea un\'integrazione interna su notion.so/profile/integrations e copia il secret.',
      'Nel database apri ••• → Connessioni e aggiungi l\'integrazione, altrimenti Notion risponde 404.',
      'Incolla il secret, il link o l\'id del database e la sezione di Lumi da copiare.',
      'Premi «Prova la connessione», poi «Copia tutto in Notion»: da lì ogni 15 minuti passano solo le righe cambiate.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developers.notion.com/reference/post-page', 'https://developers.notion.com/reference/patch-page', 'https://developers.notion.com/reference/retrieve-a-database', 'https://developers.notion.com/reference/page-property-values', 'https://developers.notion.com/reference/versioning', 'https://developers.notion.com/reference/request-limits'],
    prova: 'finto', parole: ['notion', 'database', 'wiki', 'pagine', 'pages', 'sincronizza', 'sync', 'appunti', 'notes'],
  },
  testi: {
    en: { nome: 'Notion', descrizione: 'Copy a Lumi section into a Notion database, one page per row.', 'imp.token': 'Internal integration token (ntn_… or secret_…)', 'imp.database': 'Database id (or its address)', 'imp.sezione': 'Lumi section to copy (e.g. clienti)', 'az.sincronizza_ora': 'Copy everything to Notion', 'giro.sincronizza': 'Copy changed rows',
      'cat.costoNota': 'The Free plan is enough for the integration; Plus from €10 per user per month (billed annually). The API is free, with an average limit of 3 requests per second.',
      'cat.serve': [{ cosa: 'An internal integration token (Internal Integration Secret)', dove: 'notion.so/profile/integrations → New integration → type Internal → Configuration → Secret' }, { cosa: 'The integration\'s access to the database', dove: 'In the database: ••• top right → Connections → add the integration' }, { cosa: 'The database id', dove: 'Open the database as a full page → Copy link: the 32 characters before «?v=»' }],
      'cat.passi': ['In Notion create a database with columns named like the Lumi fields (e.g. Nome, Email, Telefono).', 'Create an internal integration at notion.so/profile/integrations and copy the secret.', 'In the database open ••• → Connections and add the integration, otherwise Notion answers 404.', 'Paste the secret, the database link or id and the Lumi section to copy.', 'Press «Test connection», then «Copy everything to Notion»: from then on only changed rows go every 15 minutes.'] },
    es: { nome: 'Notion', descrizione: 'Copia una sección de Lumi en una base de datos de Notion, una página por fila.', 'imp.token': 'Token de la integración interna (ntn_… o secret_…)', 'imp.database': 'Id de la base de datos (o su dirección)', 'imp.sezione': 'Sección de Lumi a copiar (p. ej. clienti)', 'az.sincronizza_ora': 'Copiar todo en Notion', 'giro.sincronizza': 'Copiar las filas cambiadas' },
    fr: { nome: 'Notion', descrizione: 'Copie une section de Lumi dans une base de données Notion, une page par ligne.', 'imp.token': 'Jeton de l\'intégration interne (ntn_… ou secret_…)', 'imp.database': 'Id de la base de données (ou son adresse)', 'imp.sezione': 'Section de Lumi à copier (ex. clienti)', 'az.sincronizza_ora': 'Tout copier dans Notion', 'giro.sincronizza': 'Copier les lignes modifiées' },
    de: { nome: 'Notion', descrizione: 'Kopiert einen Lumi-Bereich in eine Notion-Datenbank, eine Seite pro Zeile.', 'imp.token': 'Token der internen Integration (ntn_… oder secret_…)', 'imp.database': 'Datenbank-ID (oder ihre Adresse)', 'imp.sezione': 'Zu kopierender Lumi-Bereich (z. B. clienti)', 'az.sincronizza_ora': 'Alles nach Notion kopieren', 'giro.sincronizza': 'Geänderte Zeilen kopieren' },
    pt: { nome: 'Notion', descrizione: 'Copia uma seção do Lumi para um banco de dados do Notion, uma página por linha.', 'imp.token': 'Token da integração interna (ntn_… ou secret_…)', 'imp.database': 'Id do banco de dados (ou o endereço)', 'imp.sezione': 'Seção do Lumi a copiar (ex. clienti)', 'az.sincronizza_ora': 'Copiar tudo para o Notion', 'giro.sincronizza': 'Copiar as linhas alteradas' },
  },
};
