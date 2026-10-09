// Fogli Google: una sezione di Kubo (clienti, vendite, articoli…) copiata in una scheda di un foglio di calcolo.
// Prima riga = i nomi dei campi, poi una riga per record. Ogni ora (se lo vuoi) e su richiesta («esporta ora», anche da Lumi).
// La scheda si svuota e si riscrive intera: è una copia da consultare e condividere, le modifiche nel foglio non tornano in Kubo.
// Sheets API v4: values.clear e values.update con valueInputOption=RAW; OAuth con codice + PKCE (come Calendario).
import { sezione, righe, cella } from '../_comunica/tabelle.js';
const gbase = k => k.base || 'https://sheets.googleapis.com';
const foglio = k => { const id = String(k.imp.foglio || '').trim(); if (!id) throw new Error('Manca l\'id del foglio di calcolo'); return encodeURIComponent(id); };
// «Clienti» → 'Clienti' (gli apici servono per i nomi con spazi; un apice nel nome si raddoppia)
const intervallo = scheda => encodeURIComponent(`'${String(scheda).replace(/'/g, "''")}'`);
function tabella(k) {
  const { entita, def, campi } = sezione(k, k.imp.sezione), rr = righe(k, entita);
  return { scheda: String(k.imp.scheda || '').trim() || def.nome, nome: def.nome, valori: [campi.map(c => c.nome), ...rr.map(r => campi.map(c => cella(r[c.id])))] };
}
async function esporta(k) {
  const t = tabella(k), tok = await k.oauth.token(), url = `${gbase(k)}/v4/spreadsheets/${foglio(k)}`;
  let r = await k.http.post(`${url}/values/${intervallo(t.scheda)}:clear`, { bearer: tok, json: {} });
  if (r.stato === 400) {   // la scheda non c'è ancora: si crea
    const n = await k.http.post(`${url}:batchUpdate`, { bearer: tok, json: { requests: [{ addSheet: { properties: { title: t.scheda } } }] } });
    if (!n.ok) throw new Error(`Fogli Google non ha creato la scheda «${t.scheda}» (HTTP ${n.stato})`);
  } else if (!r.ok) throw new Error(`Fogli Google ha risposto ${r.stato}${r.json?.error?.message ? ': ' + r.json.error.message : ''}`);
  r = await k.http.put(`${url}/values/${intervallo(t.scheda)}?valueInputOption=RAW`, { bearer: tok, json: { range: `'${t.scheda.replace(/'/g, "''")}'`, majorDimension: 'ROWS', values: t.valori } });
  if (!r.ok) throw new Error(`Fogli Google ha risposto ${r.stato}${r.json?.error?.message ? ': ' + r.json.error.message : ''}`);
  return { scheda: t.scheda, righe: t.valori.length - 1, celle: r.json?.updatedCells ?? null };
}
export default {
  id: 'google-sheets', nome: 'Fogli Google', versione: 1, icona: 'griglia',
  descrizione: 'Copia una sezione di Kubo in un foglio Google, ogni ora o quando vuoi.',
  impostazioni: [
    { id: 'sezione', nome: 'Sezione da esportare (es. clienti)', obbligatorio: true },
    { id: 'foglio', nome: 'Id del foglio di calcolo (nell\'indirizzo, tra /d/ e /edit)', schema: /^[A-Za-z0-9_-]{20,100}$/ },
    { id: 'scheda', nome: 'Nome della scheda (vuoto = il nome della sezione)' },
    { id: 'ogni_ora', nome: 'Aggiorna da solo ogni ora', tipo: 'si_no', predefinito: true },
    { id: 'client_id', nome: 'Google: client ID OAuth', segreto: true }, { id: 'client_secret', nome: 'Google: client secret', segreto: true },
  ],
  permessi: { '*': { leggi: true } },   // la sezione si sceglie nelle impostazioni: il connettore legge, non scrive mai in Kubo
  oauth: { tipo: 'codice', autorizza: 'https://accounts.google.com/o/oauth2/v2/auth', token: k => (k.base ? `${k.base}/token` : 'https://oauth2.googleapis.com/token'),
    scope: 'https://www.googleapis.com/auth/spreadsheets', extra: { access_type: 'offline', prompt: 'consent' } },
  prova: async k => {
    const r = await k.http.get(`${gbase(k)}/v4/spreadsheets/${foglio(k)}?fields=properties.title`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? r.json?.properties?.title : `HTTP ${r.stato}` };
  },
  azioni: {
    esporta_ora: {
      nome: 'Esporta ora nel foglio', descrizione: 'Riscrive adesso la scheda del foglio Google con i dati della sezione scelta', lumi: true, scrive: true,
      proponi: async (x, k) => { const t = tabella(k); return { titolo: 'Esporta in Fogli Google', righe: [['Sezione', t.nome], ['Scheda', t.scheda], ['Righe', String(t.valori.length - 1)]], avvisi: ['La scheda viene svuotata e riscritta: le modifiche fatte a mano nel foglio si perdono'] }; },
      esegui: async (x, k) => esporta(k),
    },
  },
  pianificati: { esporta: { nome: 'Esporta nel foglio', ogni: '1h', giro: async k => (k.imp.ogni_ora === false ? { saltato: 'aggiornamento automatico spento' } : esporta(k)) } },
  catalogo: {
    categoria: 'produttivita', sito: 'https://workspace.google.com/products/sheets/', costo: 'gratis',
    costoNota: 'Gratis con un account Google personale; con Google Workspace da 7 € circa per utente al mese (Business Starter). L\'API di Fogli non costa niente, con limiti di 300 richieste al minuto per progetto.',
    serve: [
      { cosa: 'Client ID e client secret OAuth (tipo «Applicazione web»)', dove: 'Google Cloud Console → API e servizi → Credenziali → Crea credenziali → ID client OAuth', link: 'https://console.cloud.google.com/apis/credentials' },
      { cosa: 'L\'API Google Sheets attivata nel progetto', dove: 'Google Cloud Console → API e servizi → Libreria → Google Sheets API → Abilita', link: 'https://console.cloud.google.com/apis/library/sheets.googleapis.com' },
      { cosa: 'L\'id del foglio di calcolo', dove: 'Apri il foglio: è la parte dell\'indirizzo tra /d/ e /edit', link: 'https://sheets.google.com' },
    ],
    passi: [
      'Crea un progetto su Google Cloud Console e abilita la Google Sheets API.',
      'Configura la schermata di consenso OAuth (tipo «Esterno», aggiungi te stesso tra gli utenti di prova).',
      'Crea un ID client OAuth «Applicazione web» con l\'indirizzo di ritorno che Kubo mostra in questa pagina.',
      'Incolla client ID e client secret, poi premi «Collega» e accedi con l\'account Google proprietario del foglio.',
      'Scegli la sezione (es. clienti), incolla l\'id del foglio e, se vuoi, il nome della scheda.',
      'Premi «Esporta ora»: la scheda si riempie; da lì in poi si aggiorna ogni ora.',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update', 'https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/clear', 'https://developers.google.com/workspace/sheets/api/guides/values', 'https://developers.google.com/identity/protocols/oauth2/web-server'],
    prova: 'finto', parole: ['fogli google', 'google sheets', 'foglio di calcolo', 'spreadsheet', 'excel', 'esporta', 'export', 'tabella'],
  },
  testi: {
    en: { nome: 'Google Sheets', descrizione: 'Copy a Kubo section into a Google Sheet, every hour or on demand.', 'imp.sezione': 'Section to export (e.g. clienti)', 'imp.foglio': 'Spreadsheet id (in the address, between /d/ and /edit)', 'imp.scheda': 'Tab name (empty = the section name)', 'imp.ogni_ora': 'Update automatically every hour', 'imp.client_id': 'Google: OAuth client ID', 'imp.client_secret': 'Google: client secret', 'az.esporta_ora': 'Export to the sheet now', 'giro.esporta': 'Export to the sheet',
      'cat.costoNota': 'Free with a personal Google account; Google Workspace from about €7 per user per month (Business Starter). The Sheets API is free, limited to 300 requests per minute per project.',
      'cat.serve': [{ cosa: 'OAuth client ID and client secret («Web application»)', dove: 'Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID' }, { cosa: 'Google Sheets API enabled in the project', dove: 'Google Cloud Console → APIs & Services → Library → Google Sheets API → Enable' }, { cosa: 'The spreadsheet id', dove: 'Open the sheet: it is the part of the address between /d/ and /edit' }],
      'cat.passi': ['Create a project in Google Cloud Console and enable the Google Sheets API.', 'Set up the OAuth consent screen («External», add yourself as a test user).', 'Create a «Web application» OAuth client ID with the redirect address shown on this page.', 'Paste client ID and secret, press «Connect» and sign in with the Google account that owns the sheet.', 'Choose the section (e.g. clienti), paste the spreadsheet id and, if you like, the tab name.', 'Press «Export now»: the tab fills up; from then on it updates every hour.'] },
    es: { nome: 'Hojas de cálculo de Google', descrizione: 'Copia una sección de Kubo en una hoja de Google, cada hora o cuando quieras.', 'imp.sezione': 'Sección a exportar (p. ej. clienti)', 'imp.foglio': 'Id de la hoja de cálculo (en la dirección, entre /d/ y /edit)', 'imp.scheda': 'Nombre de la pestaña (vacío = el nombre de la sección)', 'imp.ogni_ora': 'Actualizar solo cada hora', 'imp.client_id': 'Google: client ID de OAuth', 'imp.client_secret': 'Google: client secret', 'az.esporta_ora': 'Exportar ahora a la hoja', 'giro.esporta': 'Exportar a la hoja' },
    fr: { nome: 'Google Sheets', descrizione: 'Copie une section de Kubo dans une feuille Google, chaque heure ou à la demande.', 'imp.sezione': 'Section à exporter (ex. clienti)', 'imp.foglio': 'Id de la feuille de calcul (dans l\'adresse, entre /d/ et /edit)', 'imp.scheda': 'Nom de l\'onglet (vide = le nom de la section)', 'imp.ogni_ora': 'Mettre à jour seul chaque heure', 'imp.client_id': 'Google : client ID OAuth', 'imp.client_secret': 'Google : client secret', 'az.esporta_ora': 'Exporter maintenant vers la feuille', 'giro.esporta': 'Exporter vers la feuille' },
    de: { nome: 'Google Tabellen', descrizione: 'Kopiert einen Kubo-Bereich in eine Google-Tabelle, stündlich oder auf Wunsch.', 'imp.sezione': 'Zu exportierender Bereich (z. B. clienti)', 'imp.foglio': 'ID der Tabelle (in der Adresse zwischen /d/ und /edit)', 'imp.scheda': 'Name des Tabellenblatts (leer = Name des Bereichs)', 'imp.ogni_ora': 'Stündlich automatisch aktualisieren', 'imp.client_id': 'Google: OAuth-Client-ID', 'imp.client_secret': 'Google: Client-Secret', 'az.esporta_ora': 'Jetzt in die Tabelle exportieren', 'giro.esporta': 'In die Tabelle exportieren' },
    pt: { nome: 'Planilhas Google', descrizione: 'Copia uma seção do Kubo para uma planilha Google, a cada hora ou quando quiser.', 'imp.sezione': 'Seção a exportar (ex. clienti)', 'imp.foglio': 'Id da planilha (no endereço, entre /d/ e /edit)', 'imp.scheda': 'Nome da aba (vazio = o nome da seção)', 'imp.ogni_ora': 'Atualizar sozinho a cada hora', 'imp.client_id': 'Google: client ID OAuth', 'imp.client_secret': 'Google: client secret', 'az.esporta_ora': 'Exportar agora para a planilha', 'giro.esporta': 'Exportar para a planilha' },
  },
};
