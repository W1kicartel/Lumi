// OneDrive (personale e Microsoft 365) con Microsoft Graph: fatture e documenti in Kubo/Fatture/2026/…, backup del
// database ogni notte in Kubo/Backup (gli ultimi N). Accesso con la Microsoft identity platform: il device code (RFC 8628)
// è la strada migliore per un'app desktop senza indirizzo pubblico (si apre microsoft.com/devicelogin e si scrive il
// codice); c'è anche il codice + PKCE con il ritorno su localhost. Tenant «common» (account personali e di lavoro) o il
// proprio. Scope Files.ReadWrite offline_access. Caricamento semplice PUT …:/content fino a 250 MB, le cartelle si creano da sole.
// API: https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
import { archivio, testiArchivio } from '../_comunica/documento.js';

const graph = k => (k.base ? `${k.base}/v1.0` : 'https://graph.microsoft.com/v1.0'), MS = 300000;
const login = fine => k => (k.base ? `${k.base}/${fine}` : `https://login.microsoftonline.com/${encodeURIComponent(k.imp.tenant || 'common')}/oauth2/v2.0/${fine}`);
const via = p => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const no = (r, cosa) => new Error(`OneDrive: ${cosa} non riuscito (HTTP ${r.stato}${r.json?.error?.message ? `: ${r.json.error.message}` : ''})`);

async function carica(k, cartella, nome, contenuto, tipo) {
  const r = await k.http.put(`${graph(k)}/me/drive/root:/${via(`${cartella}/${nome}`)}:/content`, { bearer: await k.oauth.token(), testo: contenuto, intestazioni: { 'Content-Type': tipo }, ms: MS });
  if (!r.ok) throw no(r, `il caricamento di «${nome}»`);
  return { id: r.json?.id };
}
async function elenca(k, cartella) {
  const bearer = await k.oauth.token(), out = [];
  let url = `${graph(k)}/me/drive/root:/${via(cartella)}:/children?$select=id,name,file&$top=200`;
  for (let n = 0; url && n < 50; n++) {
    const r = await k.http.get(url, { bearer });
    if (r.stato === 404) return [];
    if (!r.ok) throw no(r, 'l\'elenco dei backup');
    for (const x of r.json?.value || []) if (x.file) out.push({ nome: x.name, id: x.id });
    url = r.json?.['@odata.nextLink'] || null;
  }
  return out;
}
async function cancella(k, voce) {
  const r = await k.http.delete(`${graph(k)}/me/drive/items/${encodeURIComponent(voce.id)}`, { bearer: await k.oauth.token() });
  if (!r.ok && r.stato !== 404) throw no(r, `la cancellazione di «${voce.nome}»`);
}

const A = archivio({ nome: 'OneDrive', carica, elenca, cancella, massimo: 250 * 1048576, pronto: k => k.oauth.collegato() });
export default {
  id: 'onedrive', nome: 'OneDrive', versione: 1, icona: 'documento',
  descrizione: 'Fatture e documenti su OneDrive, cartelle per anno, e il backup del database ogni notte.',
  impostazioni: [...A.impostazioni,
    { id: 'tenant', nome: 'Tenant (common, consumers, organizations o l\'id della directory)', predefinito: 'common', schema: /^[A-Za-z0-9.-]{1,100}$/ },
    { id: 'client_id', nome: 'ID applicazione (client)', segreto: true }, { id: 'client_secret', nome: 'Segreto client (solo per app «Web»)', segreto: true, obbligatorio: false }],
  richiede: A.richiede, permessi: A.permessi, azioni: A.azioni, uscita: A.uscita, pianificati: A.pianificati,
  oauth: { tipo: 'codice', autorizza: login('authorize'), token: login('token'), dispositivo: login('devicecode'), scope: 'Files.ReadWrite offline_access' },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Microsoft' };
    const r = await k.http.get(`${graph(k)}/me/drive?$select=owner,quota`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? (r.json?.owner?.user?.displayName || 'OneDrive') : `HTTP ${r.stato}` };
  },
  catalogo: {
    categoria: 'archivio', sito: 'https://www.microsoft.com/microsoft-365/onedrive/online-cloud-storage', costo: 'gratis',
    costoNota: 'OneDrive gratis con 5 GB; Microsoft 365 Basic 100 GB a 2 €/mese; Microsoft 365 Personal (1 TB) a 99 €/anno. Microsoft Graph non costa.',
    serve: [{ cosa: 'ID applicazione (client) di una registrazione app, con «Consenti flussi client pubblici» attivo', dove: 'Microsoft Entra admin center → Identità → Applicazioni → Registrazioni app → Nuova registrazione → Autenticazione', link: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' }],
    passi: [
      'Nell\'Entra admin center (o portal.azure.com) crea una registrazione app: tipi di account «qualsiasi directory e account Microsoft personali».',
      'Autenticazione: aggiungi la piattaforma «App per dispositivi mobili e desktop» con http://localhost e attiva «Consenti flussi client pubblici» (serve al device code).',
      'Autorizzazioni API: Microsoft Graph → delegate → Files.ReadWrite e offline_access.',
      'In Kubo incolla l\'ID applicazione (client), lascia il tenant «common» (o metti quello della tua azienda) e accendi il connettore.',
      'Collega l\'account con il codice dispositivo: apri microsoft.com/devicelogin e scrivi il codice che Kubo mostra (oppure «Collega» con il ritorno su localhost).',
      'Scegli se salvare da solo le fatture emesse e quanti backup tenere. Un file oltre 250 MB viene rifiutato.',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code', 'https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0', 'https://learn.microsoft.com/en-us/graph/api/driveitem-delete?view=graph-rest-1.0'],
    prova: 'finto', parole: ['onedrive', 'microsoft', 'microsoft 365', 'office', 'archivio', 'cloud', 'backup', 'copia', 'documenti', 'storage'],
  },
  testi: testiArchivio('OneDrive', {
    en: { nome: 'OneDrive', descrizione: 'Invoices and documents on OneDrive, folders by year, and a nightly database backup.', 'imp.tenant': 'Tenant (common, consumers, organizations or the directory id)', 'imp.client_id': 'Application (client) ID', 'imp.client_secret': 'Client secret (only for «Web» apps)',
      'cat.costoNota': 'OneDrive free with 5 GB; Microsoft 365 Basic 100 GB at €2/month; Microsoft 365 Personal (1 TB) at €99/year. Microsoft Graph is free.',
      'cat.serve': [{ cosa: 'Application (client) ID of an app registration, with «Allow public client flows» on', dove: 'Microsoft Entra admin center → Identity → Applications → App registrations → New registration → Authentication' }],
      'cat.passi': ['In the Entra admin center (or portal.azure.com) create an app registration: account types «any directory and personal Microsoft accounts».', 'Authentication: add the «Mobile and desktop applications» platform with http://localhost and turn on «Allow public client flows» (needed for the device code).', 'API permissions: Microsoft Graph → delegated → Files.ReadWrite and offline_access.', 'In Kubo paste the Application (client) ID, keep the «common» tenant (or your company one) and turn the connector on.', 'Connect with the device code: open microsoft.com/devicelogin and type the code Kubo shows (or «Connect» with the localhost redirect).', 'Choose whether to save issued invoices automatically and how many backups to keep. Files over 250 MB are refused.'] },
    es: { nome: 'OneDrive', descrizione: 'Facturas y documentos en OneDrive, carpetas por año, y copia nocturna de la base de datos.', 'imp.tenant': 'Tenant (common, consumers, organizations o el id del directorio)', 'imp.client_id': 'ID de aplicación (cliente)', 'imp.client_secret': 'Secreto de cliente (solo apps «Web»)' },
    fr: { nome: 'OneDrive', descrizione: 'Factures et documents sur OneDrive, dossiers par année, et sauvegarde nocturne de la base.', 'imp.tenant': 'Tenant (common, consumers, organizations ou l\'id de l\'annuaire)', 'imp.client_id': 'ID d\'application (client)', 'imp.client_secret': 'Secret client (seulement pour les apps « Web »)' },
    de: { nome: 'OneDrive', descrizione: 'Rechnungen und Dokumente in OneDrive, Ordner nach Jahr, und nächtliche Datenbanksicherung.', 'imp.tenant': 'Tenant (common, consumers, organizations oder die Verzeichnis-ID)', 'imp.client_id': 'Anwendungs-ID (Client)', 'imp.client_secret': 'Clientgeheimnis (nur für „Web“-Apps)' },
    pt: { nome: 'OneDrive', descrizione: 'Faturas e documentos no OneDrive, pastas por ano, e backup noturno do banco de dados.', 'imp.tenant': 'Tenant (common, consumers, organizations ou o id do diretório)', 'imp.client_id': 'ID do aplicativo (cliente)', 'imp.client_secret': 'Segredo do cliente (só para apps «Web»)' },
  }),
};
