// Airtable: una sezione di Lumi copiata in una tabella di Airtable, ogni 15 minuti, solo le righe cambiate.
// Le righe si abbinano con il campo «Lumi ID» (upsert con performUpsert.fieldsToMergeOn, lotti da 10 come vuole l'API);
// passano solo i campi che hanno lo stesso nome in Airtable (letti dallo schema della base), con typecast per date e scelte.
// La sezione si sceglie a runtime: niente «uscita» (si dichiara per sezioni fisse), ma un cursore su «modificato» in k.stato.
import { sezione, cambiate, cella, lotti } from '../_comunica/tabelle.js';
const abase = k => k.base || 'https://api.airtable.com';
const no = (r, cosa) => new Error(`Airtable ha risposto ${r.stato} a ${cosa}${r.json?.error?.message ? ': ' + r.json.error.message : r.json?.error?.type ? ': ' + r.json.error.type : ''}`);
const pausa = ms => new Promise(r => setTimeout(r, ms));
// la tabella scelta (per nome o id) con i suoi campi, dallo schema della base
async function tabella(k) {
  const r = await k.http.get(`${abase(k)}/v0/meta/bases/${encodeURIComponent(k.imp.base)}/tables`, { bearer: k.segreti.token });
  if (!r.ok) throw no(r, 'lo schema della base');
  const t = (r.json?.tables || []).find(x => x.id === k.imp.tabella || x.name.toLowerCase() === String(k.imp.tabella || '').trim().toLowerCase());
  if (!t) throw new Error(`Nella base non c'è la tabella «${k.imp.tabella}»`);
  return t;
}
async function sincronizza(k, { tutto = false } = {}) {
  const { entita, campi } = sezione(k, k.imp.sezione), t = await tabella(k), chiave = String(k.imp.chiave || 'Lumi ID').trim();
  const nomi = new Map(t.fields.map(f => [f.name.toLowerCase(), f.name]));
  if (!nomi.has(chiave.toLowerCase())) throw new Error(`Aggiungi alla tabella «${t.name}» un campo di testo «${chiave}»: serve ad abbinare le righe`);
  const usati = campi.filter(c => nomi.has(c.nome.toLowerCase()) && c.nome.toLowerCase() !== chiave.toLowerCase());
  if (tutto) k.stato.scrivi(`cursore:${entita}`, null);
  const { righe, salva } = cambiate(k, entita); let creati = 0, aggiornati = 0;
  for (const [i, gruppo] of lotti(righe, 10).entries()) {
    if (i) await pausa(220);   // 5 richieste al secondo per base
    const records = gruppo.map(r => ({ fields: { [nomi.get(chiave.toLowerCase())]: r.id, ...Object.fromEntries(usati.map(c => [nomi.get(c.nome.toLowerCase()), cella(r[c.id]) === '' ? null : cella(r[c.id])])) } }));
    const x = await k.http.patch(`${abase(k)}/v0/${encodeURIComponent(k.imp.base)}/${encodeURIComponent(t.id)}`, { bearer: k.segreti.token, json: { performUpsert: { fieldsToMergeOn: [nomi.get(chiave.toLowerCase())] }, records, typecast: true } });
    if (!x.ok) throw no(x, 'l\'aggiornamento');
    (x.json?.records || []).forEach((rec, j) => gruppo[j] && k.sincro.collega(entita, gruppo[j].id, rec.id));
    creati += x.json?.createdRecords?.length || 0; aggiornati += x.json?.updatedRecords?.length || 0;
    salva(gruppo.at(-1).modificato);   // il cursore avanza lotto per lotto: un errore a metà non rimanda tutto
  }
  return { tabella: t.name, creati, aggiornati, campi: usati.length };
}
export default {
  id: 'airtable', nome: 'Airtable', versione: 1, icona: 'griglia',
  descrizione: 'Tiene una tabella di Airtable allineata a una sezione di Lumi.',
  impostazioni: [
    { id: 'token', nome: 'Personal access token', segreto: true, schema: /^pat[A-Za-z0-9.]{10,}$/ },
    { id: 'base', nome: 'Id della base (inizia con «app»)', schema: /^app[A-Za-z0-9]{10,20}$/ },
    { id: 'tabella', nome: 'Tabella di Airtable (nome o id)' },
    { id: 'sezione', nome: 'Sezione di Lumi da copiare (es. clienti)' },
    { id: 'chiave', nome: 'Campo di Airtable che tiene l\'id di Lumi', predefinito: 'Lumi ID' },
  ],
  permessi: { '*': { leggi: true } },
  prova: async k => { const t = await tabella(k); return { ok: true, messaggio: `${t.name}: ${t.fields.length} campi` }; },
  azioni: {
    sincronizza_ora: {
      nome: 'Copia tutto in Airtable', descrizione: 'Ricopia in Airtable tutte le righe della sezione scelta, non solo quelle cambiate', lumi: true, scrive: true,
      proponi: async (x, k) => { const { def } = sezione(k, k.imp.sezione); return { titolo: 'Copia in Airtable', righe: [['Sezione', def.nome], ['Tabella', k.imp.tabella || '—']], avvisi: [] }; },
      esegui: async (x, k) => sincronizza(k, { tutto: true }),
    },
  },
  pianificati: { sincronizza: { nome: 'Copia le righe cambiate', ogni: '15m', giro: k => sincronizza(k) } },
  catalogo: {
    categoria: 'produttivita', sito: 'https://www.airtable.com', costo: 'abbonamento',
    costoNota: 'Piano Free: 1.000 righe per base e 1.000 chiamate API al mese. Team da 20 $ per utente al mese (fatturazione annuale), con 100.000 chiamate al mese.',
    serve: [
      { cosa: 'Personal access token con gli scope data.records:read, data.records:write e schema.bases:read, e accesso alla base', dove: 'Airtable → icona del profilo → Builder hub → Personal access tokens → Create token', link: 'https://airtable.com/create/tokens' },
      { cosa: 'L\'id della base (app…) e il nome della tabella', dove: 'Apri la base: l\'indirizzo è airtable.com/appXXXXXXXX/tblYYYYYY/…', link: 'https://support.airtable.com/docs/finding-airtable-ids' },
      { cosa: 'Un campo di testo «Lumi ID» nella tabella, e colonne con gli stessi nomi dei campi di Lumi', dove: 'Nella tabella: «+» in fondo alle colonne → Single line text', link: 'https://support.airtable.com/docs/supported-field-types-in-airtable-overview' },
    ],
    passi: [
      'Crea in Airtable la tabella e dai alle colonne gli stessi nomi dei campi di Lumi (es. Nome, Email, Telefono).',
      'Aggiungi una colonna di testo «Lumi ID»: Lumi la usa per riconoscere le righe già copiate.',
      'Crea un personal access token con data.records:read, data.records:write, schema.bases:read e aggiungi la base.',
      'Incolla token, id della base (app…), nome della tabella e la sezione di Lumi da copiare.',
      'Premi «Prova la connessione», poi «Copia tutto in Airtable»: da lì ogni 15 minuti passano solo le righe cambiate.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://airtable.com/developers/web/api/update-multiple-records', 'https://airtable.com/developers/web/api/get-base-schema', 'https://airtable.com/developers/web/api/rate-limits', 'https://airtable.com/developers/web/guides/personal-access-tokens', 'https://airtable.com/pricing'],
    prova: 'finto', parole: ['airtable', 'tabella', 'database', 'base', 'no-code', 'sincronizza', 'sync', 'spreadsheet'],
  },
  testi: {
    en: { nome: 'Airtable', descrizione: 'Keeps an Airtable table in line with a Lumi section.', 'imp.token': 'Personal access token', 'imp.base': 'Base id (starts with «app»)', 'imp.tabella': 'Airtable table (name or id)', 'imp.sezione': 'Lumi section to copy (e.g. clienti)', 'imp.chiave': 'Airtable field holding the Lumi id', 'az.sincronizza_ora': 'Copy everything to Airtable', 'giro.sincronizza': 'Copy changed rows',
      'cat.costoNota': 'Free plan: 1,000 records per base and 1,000 API calls per month. Team from $20 per user per month (billed annually), with 100,000 calls per month.',
      'cat.serve': [{ cosa: 'Personal access token with scopes data.records:read, data.records:write and schema.bases:read, and access to the base', dove: 'Airtable → profile icon → Builder hub → Personal access tokens → Create token' }, { cosa: 'The base id (app…) and the table name', dove: 'Open the base: the address is airtable.com/appXXXXXXXX/tblYYYYYY/…' }, { cosa: 'A «Lumi ID» text field in the table, and columns named like the Lumi fields', dove: 'In the table: «+» after the last column → Single line text' }],
      'cat.passi': ['Create the table in Airtable and name the columns like the Lumi fields (e.g. Nome, Email, Telefono).', 'Add a «Lumi ID» text column: Lumi uses it to recognise rows already copied.', 'Create a personal access token with data.records:read, data.records:write, schema.bases:read and add the base.', 'Paste token, base id (app…), table name and the Lumi section to copy.', 'Press «Test connection», then «Copy everything to Airtable»: from then on only changed rows go every 15 minutes.'] },
    es: { nome: 'Airtable', descrizione: 'Mantiene una tabla de Airtable alineada con una sección de Lumi.', 'imp.token': 'Personal access token', 'imp.base': 'Id de la base (empieza por «app»)', 'imp.tabella': 'Tabla de Airtable (nombre o id)', 'imp.sezione': 'Sección de Lumi a copiar (p. ej. clienti)', 'imp.chiave': 'Campo de Airtable con el id de Lumi', 'az.sincronizza_ora': 'Copiar todo en Airtable', 'giro.sincronizza': 'Copiar las filas cambiadas' },
    fr: { nome: 'Airtable', descrizione: 'Garde une table Airtable alignée sur une section de Lumi.', 'imp.token': 'Personal access token', 'imp.base': 'Id de la base (commence par « app »)', 'imp.tabella': 'Table Airtable (nom ou id)', 'imp.sezione': 'Section de Lumi à copier (ex. clienti)', 'imp.chiave': 'Champ Airtable contenant l\'id Lumi', 'az.sincronizza_ora': 'Tout copier dans Airtable', 'giro.sincronizza': 'Copier les lignes modifiées' },
    de: { nome: 'Airtable', descrizione: 'Hält eine Airtable-Tabelle mit einem Lumi-Bereich abgeglichen.', 'imp.token': 'Personal Access Token', 'imp.base': 'Base-ID (beginnt mit „app“)', 'imp.tabella': 'Airtable-Tabelle (Name oder ID)', 'imp.sezione': 'Zu kopierender Lumi-Bereich (z. B. clienti)', 'imp.chiave': 'Airtable-Feld mit der Lumi-ID', 'az.sincronizza_ora': 'Alles nach Airtable kopieren', 'giro.sincronizza': 'Geänderte Zeilen kopieren' },
    pt: { nome: 'Airtable', descrizione: 'Mantém uma tabela do Airtable alinhada a uma seção do Lumi.', 'imp.token': 'Personal access token', 'imp.base': 'Id da base (começa com «app»)', 'imp.tabella': 'Tabela do Airtable (nome ou id)', 'imp.sezione': 'Seção do Lumi a copiar (ex. clienti)', 'imp.chiave': 'Campo do Airtable com o id do Lumi', 'az.sincronizza_ora': 'Copiar tudo para o Airtable', 'giro.sincronizza': 'Copiar as linhas alteradas' },
  },
};
