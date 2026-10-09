// Dropbox: fatture e documenti in /Kubo/Fatture/2026/…, backup del database ogni notte in /Kubo/Backup (gli ultimi N).
// OAuth con il codice + PKCE e token_access_type=offline (refresh token che non scade). Caricamento con /2/files/upload
// (fino a 150 MB, le cartelle si creano da sole); oltre servirebbe una sessione di upload: si rifiuta con un messaggio chiaro.
// API: https://www.dropbox.com/developers/documentation/http/documentation
import { archivio, testiArchivio } from '../_comunica/documento.js';

const api = k => k.base || 'https://api.dropboxapi.com', contenuti = k => k.base || 'https://content.dropboxapi.com', MS = 300000;
// Dropbox-API-Arg va in un'intestazione HTTP: JSON con i caratteri non ASCII scritti come \uXXXX
const arg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const no = (r, cosa) => new Error(`Dropbox: ${cosa} non riuscito (HTTP ${r.stato}${r.json?.error_summary ? `: ${r.json.error_summary}` : ''})`);
const percorso = (...p) => '/' + p.join('/').split('/').filter(Boolean).join('/');

async function carica(k, cartella, nome, contenuto) {
  const r = await k.http.post(`${contenuti(k)}/2/files/upload`, { bearer: await k.oauth.token(), testo: contenuto, ms: MS,
    intestazioni: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': arg({ path: percorso(cartella, nome), mode: 'overwrite', autorename: false, mute: true }) } });
  if (!r.ok) throw no(r, `il caricamento di «${nome}»`);
  return { id: r.json?.id };
}
async function elenca(k, cartella) {
  const bearer = await k.oauth.token(), out = [];
  let r = await k.http.post(`${api(k)}/2/files/list_folder`, { bearer, json: { path: percorso(cartella), limit: 2000 } });
  if (r.stato === 409 && /not_found/.test(r.json?.error_summary || '')) return [];
  for (let n = 0; n < 50; n++) {
    if (!r.ok) throw no(r, 'l\'elenco dei backup');
    for (const e of r.json?.entries || []) if (e['.tag'] === 'file') out.push({ nome: e.name, id: e.path_lower });
    if (!r.json?.has_more) break;
    r = await k.http.post(`${api(k)}/2/files/list_folder/continue`, { bearer, json: { cursor: r.json.cursor } });
  }
  return out;
}
async function cancella(k, voce) {
  const r = await k.http.post(`${api(k)}/2/files/delete_v2`, { bearer: await k.oauth.token(), json: { path: voce.id } });
  if (!r.ok && !(r.stato === 409 && /not_found/.test(r.json?.error_summary || ''))) throw no(r, `la cancellazione di «${voce.nome}»`);
}

const A = archivio({ nome: 'Dropbox', carica, elenca, cancella, massimo: 150 * 1048576, pronto: k => k.oauth.collegato() });
export default {
  id: 'dropbox', nome: 'Dropbox', versione: 1, icona: 'documento',
  descrizione: 'Fatture e documenti su Dropbox, cartelle per anno, e il backup del database ogni notte.',
  impostazioni: [...A.impostazioni,
    { id: 'client_id', nome: 'Dropbox: App key', segreto: true }, { id: 'client_secret', nome: 'Dropbox: App secret', segreto: true, obbligatorio: false }],
  richiede: A.richiede, permessi: A.permessi, azioni: A.azioni, uscita: A.uscita, pianificati: A.pianificati,
  oauth: { tipo: 'codice', autorizza: 'https://www.dropbox.com/oauth2/authorize', token: k => (k.base ? `${k.base}/oauth2/token` : 'https://api.dropboxapi.com/oauth2/token'),
    scope: 'account_info.read files.metadata.read files.content.read files.content.write', extra: { token_access_type: 'offline' } },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Dropbox' };
    const r = await k.http.post(`${api(k)}/2/users/get_current_account`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? r.json?.email : `HTTP ${r.stato}` };
  },
  catalogo: {
    categoria: 'archivio', sito: 'https://www.dropbox.com', costo: 'gratis',
    costoNota: 'Dropbox Basic gratis con 2 GB; Plus 2 TB a circa 11,99 €/mese (9,99 €/mese con pagamento annuale). L\'API non costa.',
    serve: [{ cosa: 'App key e App secret di un\'app Dropbox (accesso «App folder» o «Full Dropbox»)', dove: 'Dropbox App Console → Create app → Scoped access → scheda Settings', link: 'https://www.dropbox.com/developers/apps' }],
    passi: [
      'Nella App Console crea un\'app «Scoped access», tipo «App folder» (Kubo vede solo la sua cartella Apps/<nome app>).',
      'Scheda Permissions: spunta files.metadata.read, files.content.read, files.content.write e premi Submit.',
      'Scheda Settings: in Redirect URIs aggiungi http://localhost:<porta di Kubo>/api/connettori/dropbox/oauth/ritorno.',
      'In Kubo incolla App key e App secret, accendi il connettore e premi «Collega».',
      'Scegli se salvare da solo le fatture emesse e quanti backup tenere. Un file oltre 150 MB viene rifiutato.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://www.dropbox.com/developers/documentation/http/documentation', 'https://developers.dropbox.com/oauth-guide', 'https://www.dropbox.com/developers/reference/auth-types'],
    prova: 'finto', parole: ['dropbox', 'archivio', 'cloud', 'backup', 'copia', 'documenti', 'storage', 'files'],
  },
  testi: testiArchivio('Dropbox', {
    en: { nome: 'Dropbox', descrizione: 'Invoices and documents on Dropbox, folders by year, and a nightly database backup.', 'imp.client_id': 'Dropbox: App key', 'imp.client_secret': 'Dropbox: App secret',
      'cat.costoNota': 'Dropbox Basic free with 2 GB; Plus 2 TB for about €11.99/month (€9.99/month billed yearly). The API is free.',
      'cat.serve': [{ cosa: 'App key and App secret of a Dropbox app («App folder» or «Full Dropbox» access)', dove: 'Dropbox App Console → Create app → Scoped access → Settings tab' }],
      'cat.passi': ['In the App Console create a «Scoped access» app, «App folder» type (Kubo only sees its own Apps/<app name> folder).', 'Permissions tab: tick files.metadata.read, files.content.read, files.content.write and press Submit.', 'Settings tab: add the redirect URI http://localhost:<Kubo port>/api/connettori/dropbox/oauth/ritorno.', 'In Kubo paste App key and App secret, turn the connector on and press «Connect».', 'Choose whether to save issued invoices automatically and how many backups to keep. Files over 150 MB are refused.'] },
    es: { nome: 'Dropbox', descrizione: 'Facturas y documentos en Dropbox, carpetas por año, y copia nocturna de la base de datos.', 'imp.client_id': 'Dropbox: App key', 'imp.client_secret': 'Dropbox: App secret' },
    fr: { nome: 'Dropbox', descrizione: 'Factures et documents sur Dropbox, dossiers par année, et sauvegarde nocturne de la base.', 'imp.client_id': 'Dropbox : App key', 'imp.client_secret': 'Dropbox : App secret' },
    de: { nome: 'Dropbox', descrizione: 'Rechnungen und Dokumente in Dropbox, Ordner nach Jahr, und nächtliche Datenbanksicherung.', 'imp.client_id': 'Dropbox: App key', 'imp.client_secret': 'Dropbox: App secret' },
    pt: { nome: 'Dropbox', descrizione: 'Faturas e documentos no Dropbox, pastas por ano, e backup noturno do banco de dados.', 'imp.client_id': 'Dropbox: App key', 'imp.client_secret': 'Dropbox: App secret' },
  }),
};
