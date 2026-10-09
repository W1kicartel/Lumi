// pCloud (svizzero, dati in UE a Lussemburgo o negli USA): fatture e documenti in /Lumi/Fatture/2026/…, backup del
// database ogni notte in /Lumi/Backup (gli ultimi N). OAuth con il codice; i token di pCloud non scadono e vanno in
// «Authorization: Bearer». Ogni account vive in una regione e risponde solo dal suo host: eapi.pcloud.com (UE) o
// api.pcloud.com (USA). pCloud lo dice nel ritorno dell'autorizzazione (hostname): il nucleo lo conserva (oauth.conserva,
// k.oauth.extra()) prima dello scambio del codice, che va già fatto su quell'host. Si usa solo se è uno dei due host di
// pCloud (mai un indirizzo qualsiasi arrivato nella query); un collegamento vecchio, senza hostname, usa la regione che il
// titolare aveva scelto (l'impostazione «regione» di prima, se salvata) o l'Europa. pCloud non ha PKCE: pkce: false.
// Le risposte sono sempre HTTP 200: l'esito è nel campo «result» (0 = bene, 2005 = cartella che non c'è…).
// API: https://docs.pcloud.com/methods/file/uploadfile.html
import { randomBytes } from 'node:crypto';
import { archivio, testiArchivio } from '../_comunica/documento.js';

const HOST = ['eapi.pcloud.com', 'api.pcloud.com'];
const host = k => { const h = String(k.oauth?.extra?.()?.hostname || '').toLowerCase(); return HOST.includes(h) ? h : k.imp?.regione === 'api.pcloud.com' ? 'api.pcloud.com' : 'eapi.pcloud.com'; };
const api = k => k.base || `https://${host(k)}`, MS = 300000;
const no = (r, cosa) => new Error(`pCloud: ${cosa} non riuscito (${r.ok ? `errore ${r.json?.result}` : `HTTP ${r.stato}`}${r.json?.error ? `: ${r.json.error}` : ''})`);
const bene = r => r.ok && r.json?.result === 0;
const chiama = async (k, metodo, param) => k.http.get(`${api(k)}/${metodo}?${new URLSearchParams(param)}`, { bearer: await k.oauth.token() });
const percorso = (...p) => '/' + p.join('/').split('/').filter(Boolean).join('/');

// l'id della cartella /Lumi/Fatture/2026: createfolderifnotexists un livello alla volta (il padre deve esistere)
async function cartellaId(k, cartella) {
  const pezzi = percorso(cartella).split('/').filter(Boolean); let id = 0;
  for (let i = 1; i <= pezzi.length; i++) {
    const r = await chiama(k, 'createfolderifnotexists', { path: percorso(...pezzi.slice(0, i)) });
    if (!bene(r)) throw no(r, `creare la cartella «${pezzi[i - 1]}»`);
    id = r.json.metadata?.folderid;
  }
  return id;
}
async function carica(k, cartella, nome, contenuto, tipo) {
  const folderid = await cartellaId(k, cartella), confine = `lumi${randomBytes(12).toString('hex')}`;
  // multipart/form-data; uploadfile sovrascrive un file con lo stesso nome (renameifexists non c'è)
  const corpo = Buffer.concat([Buffer.from(`--${confine}\r\nContent-Disposition: form-data; name="file"; filename="${nome.replace(/"/g, '')}"\r\nContent-Type: ${tipo}\r\n\r\n`), contenuto, Buffer.from(`\r\n--${confine}--\r\n`)]);
  const r = await k.http.post(`${api(k)}/uploadfile?${new URLSearchParams({ folderid: String(folderid), filename: nome, nopartial: '1' })}`,
    { bearer: await k.oauth.token(), testo: corpo, intestazioni: { 'Content-Type': `multipart/form-data; boundary=${confine}` }, ms: MS });
  if (!bene(r)) throw no(r, `il caricamento di «${nome}»`);
  return { id: r.json.fileids?.[0] ?? null };
}
async function elenca(k, cartella) {
  const r = await chiama(k, 'listfolder', { path: percorso(cartella) });
  if (r.ok && r.json?.result === 2005) return [];   // la cartella non c'è ancora
  if (!bene(r)) throw no(r, 'l\'elenco dei backup');
  return (r.json.metadata?.contents || []).filter(x => !x.isfolder).map(x => ({ nome: x.name, id: x.fileid }));
}
async function cancella(k, voce) {
  const r = await chiama(k, 'deletefile', { fileid: String(voce.id) });
  if (!bene(r) && r.json?.result !== 2009) throw no(r, `la cancellazione di «${voce.nome}»`);   // 2009: il file non c'è già più
}

const A = archivio({ nome: 'pCloud', carica, elenca, cancella, pronto: k => k.oauth.collegato() });
export default {
  id: 'pcloud', nome: 'pCloud', versione: 1, icona: 'documento',
  descrizione: 'Fatture e documenti su pCloud (anche con i dati in Europa), cartelle per anno, e il backup del database ogni notte.',
  impostazioni: [
    ...A.impostazioni,
    { id: 'client_id', nome: 'pCloud: Client ID', segreto: true }, { id: 'client_secret', nome: 'pCloud: Client secret', segreto: true }],
  richiede: A.richiede, permessi: A.permessi, azioni: A.azioni, uscita: A.uscita, pianificati: A.pianificati,
  oauth: { tipo: 'codice', autorizza: 'https://my.pcloud.com/oauth2/authorize', token: k => `${api(k)}/oauth2_token`, pkce: false, conserva: ['hostname'] },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account pCloud' };
    const r = await chiama(k, 'userinfo', {});
    // 2000/1000 dall'host sbagliato: un collegamento vecchio senza la regione giusta, basta collegare di nuovo
    return bene(r) ? { ok: true, messaggio: r.json.email } : { ok: false, messaggio: `${no(r, 'la prova').message}. Collega di nuovo l'account pCloud` };
  },
  catalogo: {
    categoria: 'archivio', sito: 'https://www.pcloud.com', costo: 'gratis',
    costoNota: 'Piano gratuito fino a 10 GB; Premium 500 GB circa 4,99 €/mese o 49,99 €/anno, Premium Plus 2 TB circa 9,99 €/mese; esistono anche i piani a vita (pagamento unico). Lo spazio in UE (Lussemburgo) non costa di più. L\'API non costa.',
    serve: [
      { cosa: 'Client ID e Client secret di un\'app pCloud', dove: 'pCloud → My applications (pagina sviluppatori) → New app → Settings', link: 'https://docs.pcloud.com/my_apps/' },
    ],
    passi: [
      'Accedi a pCloud, apri la pagina «My applications» degli sviluppatori e crea una nuova app.',
      'Nelle impostazioni dell\'app spunta i permessi di lettura e scrittura dei file.',
      'Alla voce Redirect URIs aggiungi http://localhost:<porta di Lumi>/api/connettori/pcloud/oauth/ritorno.',
      'Incolla Client ID e Client secret, accendi il connettore e premi «Collega»: la regione dei dati (Europa o Stati Uniti) Lumi la riconosce da sé.',
      'Premi «Prova la connessione»: se non va, collega di nuovo l\'account.',
      'Scegli se salvare da solo le fatture emesse e quanti backup notturni tenere (predefinito 14).',
    ],
    difficolta: 'media', zone: ['UE', 'mondo'],
    fonti: ['https://docs.pcloud.com/methods/oauth_2.0/authorize.html', 'https://docs.pcloud.com/methods/oauth_2.0/oauth2_token.html', 'https://docs.pcloud.com/methods/oauth_2.0/', 'https://docs.pcloud.com/methods/file/uploadfile.html', 'https://docs.pcloud.com/methods/folder/createfolderifnotexists.html', 'https://docs.pcloud.com/methods/folder/listfolder.html', 'https://docs.pcloud.com/methods/file/deletefile.html'],
    prova: 'finto', parole: ['pcloud', 'archivio', 'cloud', 'backup', 'copia', 'documenti', 'svizzera', 'europa', 'storage', 'files'],
  },
  testi: testiArchivio('pCloud', {
    en: { nome: 'pCloud', descrizione: 'Invoices and documents on pCloud (EU data region too), folders by year, and a nightly database backup.', 'imp.client_id': 'pCloud: Client ID', 'imp.client_secret': 'pCloud: Client secret',
      'cat.costoNota': 'Free plan up to 10 GB; Premium 500 GB about €4.99/month or €49.99/year, Premium Plus 2 TB about €9.99/month; lifetime plans (one-off payment) too. EU storage (Luxembourg) costs the same. The API is free.',
      'cat.serve': [{ cosa: 'Client ID and Client secret of a pCloud app', dove: 'pCloud → My applications (developer page) → New app → Settings' }],
      'cat.passi': ['Sign in to pCloud, open the developer «My applications» page and create a new app.', 'In the app settings tick the file read and write permissions.', 'Under Redirect URIs add http://localhost:<Lumi port>/api/connettori/pcloud/oauth/ritorno.', 'Paste Client ID and Client secret, turn the connector on and press «Connect»: Lumi detects the data region (Europe or United States) by itself.', 'Press «Test connection»: if it fails, connect the account again.', 'Choose whether to save issued invoices automatically and how many nightly backups to keep (default 14).'] },
    es: { nome: 'pCloud', descrizione: 'Facturas y documentos en pCloud (también con datos en la UE), carpetas por año, y copia nocturna de la base de datos.', 'imp.client_id': 'pCloud: Client ID', 'imp.client_secret': 'pCloud: Client secret' },
    fr: { nome: 'pCloud', descrizione: 'Factures et documents sur pCloud (données dans l\'UE possible), dossiers par année, et sauvegarde nocturne de la base.', 'imp.client_id': 'pCloud : Client ID', 'imp.client_secret': 'pCloud : Client secret' },
    de: { nome: 'pCloud', descrizione: 'Rechnungen und Dokumente in pCloud (auch mit Daten in der EU), Ordner nach Jahr, und nächtliche Datenbanksicherung.', 'imp.client_id': 'pCloud: Client-ID', 'imp.client_secret': 'pCloud: Client-Secret' },
    pt: { nome: 'pCloud', descrizione: 'Faturas e documentos no pCloud (também com dados na UE), pastas por ano, e backup noturno do banco de dados.', 'imp.client_id': 'pCloud: Client ID', 'imp.client_secret': 'pCloud: Client secret' },
  }),
};
