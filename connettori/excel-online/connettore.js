// Excel per il web (Microsoft 365, OneDrive): una sezione di Kubo copiata in un foglio di una cartella di lavoro .xlsx,
// ogni ora o su richiesta. È il gemello di Fogli Google per chi lavora con Microsoft: prima riga i nomi dei campi, poi
// una riga per record; il foglio si svuota e si riscrive (le modifiche fatte in Excel non tornano in Kubo).
// Microsoft Graph, API workbook: usedRange → clear, worksheets/add se manca, range(address=…) PATCH a blocchi di righe.
import { sezione, righe, cella } from '../_comunica/tabelle.js';

const login = k => `${k.base || 'https://login.microsoftonline.com'}/${encodeURIComponent(k.imp.tenant || 'common')}/oauth2/v2.0`;
const graph = k => `${k.base || 'https://graph.microsoft.com'}/v1.0`;
const percorso = k => String(k.imp.file || 'Kubo/Kubo.xlsx').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
const libro = k => `${graph(k)}/me/drive/root:/${percorso(k)}:/workbook`;
const foglio = nome => `worksheets('${encodeURIComponent(String(nome).replace(/'/g, "''"))}')`;
// 1 → A, 27 → AA
export const colonna = n => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const male = (r, cosa) => new Error(`Excel: ${cosa} non riuscito (${r.json?.error?.message || `HTTP ${r.stato}`})`);

function tabella(k) {
  const { entita, def, campi } = sezione(k, k.imp.sezione), rr = righe(k, entita);
  // Excel vuole numeri, testi o booleani: niente oggetti (le relazioni diventano il loro titolo)
  return { scheda: String(k.imp.scheda || '').trim().slice(0, 31) || def.nome.slice(0, 31), nome: def.nome, valori: [campi.map(c => c.nome), ...rr.map(r => campi.map(c => cella(r[c.id]) ?? ''))] };
}
async function esporta(k) {
  const t = tabella(k), tok = await k.oauth.token(), w = `${libro(k)}/${foglio(t.scheda)}`;
  let u = await k.http.get(`${w}/usedRange?$select=address`, { bearer: tok });
  if (u.stato === 404) {   // il foglio non c'è (o manca il file): si prova a crearlo
    const n = await k.http.post(`${libro(k)}/worksheets/add`, { bearer: tok, json: { name: t.scheda } });
    if (n.stato === 404) throw new Error(`Excel: il file «${k.imp.file || 'Kubo/Kubo.xlsx'}» non c'è in OneDrive: crea una cartella di lavoro vuota con quel nome`);
    if (!n.ok) throw male(n, `la creazione del foglio «${t.scheda}»`);
  } else if (!u.ok) throw male(u, 'la lettura del foglio');
  else {
    const usato = String(u.json?.address || '').split('!').pop();
    if (usato && usato !== 'A1') { const c = await k.http.post(`${w}/range(address='${usato}')/clear`, { bearer: tok, json: { applyTo: 'Contents' } }); if (!c.ok) throw male(c, 'lo svuotamento'); }
  }
  const largo = colonna(Math.max(1, t.valori[0].length));
  for (let i = 0; i < t.valori.length; i += 2000) {   // a blocchi: una richiesta a Graph non deve superare qualche MB
    const pezzo = t.valori.slice(i, i + 2000), r = await k.http.patch(`${w}/range(address='A${i + 1}:${largo}${i + pezzo.length}')`, { bearer: tok, json: { values: pezzo } });
    if (!r.ok) throw male(r, 'la scrittura');
  }
  return { scheda: t.scheda, righe: t.valori.length - 1 };
}

export default {
  id: 'excel-online', nome: 'Excel (Microsoft 365)', versione: 1, icona: 'griglia',
  descrizione: 'Copia una sezione di Kubo in un file Excel su OneDrive, ogni ora o quando vuoi.',
  impostazioni: [
    { id: 'sezione', nome: 'Sezione da esportare (es. clienti)' },
    { id: 'file', nome: 'File Excel in OneDrive (es. Kubo/Kubo.xlsx)', predefinito: 'Kubo/Kubo.xlsx', schema: /^[^\\:*?"<>|]+\.xlsx$/i },
    { id: 'scheda', nome: 'Nome del foglio (vuoto = il nome della sezione)', obbligatorio: false },
    { id: 'ogni_ora', nome: 'Aggiorna da solo ogni ora', tipo: 'si_no', predefinito: true },
    { id: 'client_id', nome: 'ID applicazione (client) di Microsoft Entra', segreto: true },
    { id: 'tenant', nome: 'Tenant («common», «consumers» per gli account personali, o l\'id della directory)', predefinito: 'common', schema: /^[\w.-]{2,80}$/ },
  ],
  permessi: { '*': { leggi: true } },   // la sezione si sceglie nelle impostazioni: il connettore legge, non scrive mai in Kubo
  oauth: { tipo: 'codice', autorizza: k => `${login(k)}/authorize`, token: k => `${login(k)}/token`, dispositivo: k => `${login(k)}/devicecode`, scope: 'offline_access Files.ReadWrite' },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Microsoft' };
    const r = await k.http.get(`${graph(k)}/me/drive/root:/${percorso(k)}?$select=name,webUrl`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? r.json?.name : r.stato === 404 ? `Il file ${k.imp.file || 'Kubo/Kubo.xlsx'} non c'è in OneDrive` : `HTTP ${r.stato}` };
  },
  azioni: { esporta_ora: {
    nome: 'Esporta ora in Excel', descrizione: 'Riscrive adesso il foglio Excel con i dati della sezione scelta', lumi: true, scrive: true,
    proponi: async (x, k) => { const t = tabella(k); return { titolo: 'Esporta in Excel', righe: [['Sezione', t.nome], ['File', k.imp.file || 'Kubo/Kubo.xlsx'], ['Foglio', t.scheda], ['Righe', String(t.valori.length - 1)]], avvisi: ['Il foglio viene svuotato e riscritto'] }; },
    esegui: async (x, k) => esporta(k),
  } },
  pianificati: { esporta: { nome: 'Esporta in Excel', ogni: '1h', giro: async k => (k.imp.ogni_ora === false ? { saltato: 'aggiornamento automatico spento' } : !k.oauth.collegato() ? { saltato: 'non collegato' } : esporta(k)) } },
  catalogo: {
    categoria: 'produttivita', sito: 'https://www.microsoft.com/microsoft-365/excel', costo: 'gratis',
    costoNota: 'Gratis con un account Microsoft personale (Excel per il web e 5 GB di OneDrive); con Microsoft 365 Business Basic circa 5,60 € per utente al mese. L\'API Graph non costa niente.',
    serve: [{ cosa: 'L\'ID applicazione (client) di un\'app registrata con il permesso delegato Files.ReadWrite e i flussi client pubblici attivi', dove: 'entra.microsoft.com → Registrazioni app → Nuova registrazione → Autenticazione → Consenti flussi client pubblici: Sì → Autorizzazioni API → Microsoft Graph → Delegate → Files.ReadWrite', link: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
      { cosa: 'Una cartella di lavoro Excel vuota in OneDrive', dove: 'onedrive.live.com (o OneDrive di lavoro) → Nuovo → Cartella di lavoro di Excel → salvala come Kubo/Kubo.xlsx', link: 'https://onedrive.live.com' }],
    passi: ['In OneDrive crea la cartella «Kubo» e dentro una cartella di lavoro Excel vuota «Kubo.xlsx»', 'Su entra.microsoft.com registra un\'app, attiva «Consenti flussi client pubblici» e aggiungi il permesso Files.ReadWrite', 'Incolla qui l\'ID applicazione; per un account personale scrivi «consumers» come tenant', 'Scegli la sezione da esportare (es. clienti) e premi «Collega»: apri microsoft.com/devicelogin e scrivi il codice', 'Premi «Esporta ora in Excel» (o chiedilo a Lumi): il foglio si riempie, e poi si aggiorna ogni ora'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://learn.microsoft.com/graph/api/range-update', 'https://learn.microsoft.com/graph/api/range-clear', 'https://learn.microsoft.com/graph/api/worksheetcollection-add', 'https://learn.microsoft.com/graph/api/worksheet-usedrange', 'https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code'],
    prova: 'finto', parole: ['excel', 'microsoft 365', 'office 365', 'onedrive', 'foglio di calcolo', 'esporta', 'spreadsheet', 'xlsx'],
  },
  testi: {
    en: { nome: 'Excel (Microsoft 365)', descrizione: 'Copies a Kubo section into an Excel file on OneDrive, every hour or whenever you want.', 'imp.sezione': 'Section to export (e.g. clienti)', 'imp.file': 'Excel file in OneDrive (e.g. Kubo/Kubo.xlsx)', 'imp.scheda': 'Worksheet name (empty = the section name)', 'imp.ogni_ora': 'Update by itself every hour', 'imp.client_id': 'Microsoft Entra application (client) ID', 'imp.tenant': 'Tenant («common», «consumers» for personal accounts, or the directory id)', 'az.esporta_ora': 'Export to Excel now', 'giro.esporta': 'Export to Excel',
      'cat.costoNota': 'Free with a personal Microsoft account (Excel for the web and 5 GB of OneDrive); Microsoft 365 Business Basic about €5.60 per user per month. The Graph API costs nothing.',
      'cat.serve': [{ cosa: 'The application (client) ID of a registered app with delegated Files.ReadWrite and public client flows on', dove: 'entra.microsoft.com → App registrations → New registration → Authentication → Allow public client flows: Yes → API permissions → Microsoft Graph → Delegated → Files.ReadWrite' }, { cosa: 'An empty Excel workbook in OneDrive', dove: 'OneDrive → New → Excel workbook → save it as Kubo/Kubo.xlsx' }],
      'cat.passi': ['In OneDrive create a «Kubo» folder with an empty Excel workbook «Kubo.xlsx»', 'On entra.microsoft.com register an app, turn on «Allow public client flows» and add Files.ReadWrite', 'Paste the application ID here; for a personal account write «consumers» as tenant', 'Pick the section to export and press «Connect»: open microsoft.com/devicelogin and type the code', 'Press «Export to Excel now» (or ask Lumi): the sheet fills up, then updates every hour'] },
    es: { nome: 'Excel (Microsoft 365)', descrizione: 'Copia una sección de Kubo en un archivo Excel de OneDrive, cada hora o cuando quieras.', 'imp.sezione': 'Sección que exportar (p. ej. clienti)', 'imp.file': 'Archivo Excel en OneDrive (p. ej. Kubo/Kubo.xlsx)', 'imp.scheda': 'Nombre de la hoja (vacío = el de la sección)', 'imp.ogni_ora': 'Actualizar solo cada hora', 'imp.client_id': 'ID de aplicación (cliente) de Microsoft Entra', 'imp.tenant': 'Tenant («common», «consumers» para cuentas personales, o el id del directorio)', 'az.esporta_ora': 'Exportar ahora a Excel', 'giro.esporta': 'Exportar a Excel' },
    fr: { nome: 'Excel (Microsoft 365)', descrizione: 'Copie une section de Kubo dans un fichier Excel sur OneDrive, chaque heure ou quand tu veux.', 'imp.sezione': 'Section à exporter (ex. clienti)', 'imp.file': 'Fichier Excel dans OneDrive (ex. Kubo/Kubo.xlsx)', 'imp.scheda': 'Nom de la feuille (vide = celui de la section)', 'imp.ogni_ora': 'Mettre à jour seul chaque heure', 'imp.client_id': 'ID d\'application (client) Microsoft Entra', 'imp.tenant': 'Tenant (« common », « consumers » pour les comptes personnels, ou l\'id de l\'annuaire)', 'az.esporta_ora': 'Exporter vers Excel maintenant', 'giro.esporta': 'Exporter vers Excel' },
    de: { nome: 'Excel (Microsoft 365)', descrizione: 'Kopiert einen Kubo-Bereich in eine Excel-Datei auf OneDrive, stündlich oder wann du willst.', 'imp.sezione': 'Zu exportierender Bereich (z. B. clienti)', 'imp.file': 'Excel-Datei in OneDrive (z. B. Kubo/Kubo.xlsx)', 'imp.scheda': 'Name des Arbeitsblatts (leer = Name des Bereichs)', 'imp.ogni_ora': 'Stündlich selbst aktualisieren', 'imp.client_id': 'Anwendungs-ID (Client) von Microsoft Entra', 'imp.tenant': 'Tenant („common“, „consumers“ für private Konten oder die Verzeichnis-ID)', 'az.esporta_ora': 'Jetzt nach Excel exportieren', 'giro.esporta': 'Nach Excel exportieren' },
    pt: { nome: 'Excel (Microsoft 365)', descrizione: 'Copia uma seção do Kubo para um arquivo Excel no OneDrive, a cada hora ou quando quiser.', 'imp.sezione': 'Seção a exportar (ex. clienti)', 'imp.file': 'Arquivo Excel no OneDrive (ex. Kubo/Kubo.xlsx)', 'imp.scheda': 'Nome da planilha (vazio = o da seção)', 'imp.ogni_ora': 'Atualizar sozinho a cada hora', 'imp.client_id': 'ID da aplicação (cliente) do Microsoft Entra', 'imp.tenant': 'Tenant («common», «consumers» para contas pessoais, ou o id do diretório)', 'az.esporta_ora': 'Exportar agora para o Excel', 'giro.esporta': 'Exportar para o Excel' },
  },
};
