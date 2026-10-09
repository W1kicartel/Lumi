// Box: fatture e documenti in Lumi/Fatture/2026/…, backup del database ogni notte in Lumi/Backup (gli ultimi N).
// OAuth con il codice (token di 60 minuti, refresh token monouso di 60 giorni: il nucleo salva quello nuovo a ogni rinnovo).
// Box lavora per id: le cartelle si cercano creandole (POST /2.0/folders, il 409 «item_name_in_use» porta l'id di quella che
// c'è già). Caricamento multipart su upload.box.com (attributes JSON prima del file); se il nome c'è già, il 409 porta l'id
// del file e si carica una nuova versione con /files/{id}/content. Il caricamento diretto arriva a 50 MB.
// PKCE no (pkce: false): Box non lo documenta (né code_challenge su /authorize né code_verifier su /oauth2/token), e il
// client è confidenziale, con il client_secret.
// API: https://developer.box.com/reference/post-files-content/
import { randomBytes } from 'node:crypto';
import { archivio, testiArchivio } from '../_comunica/documento.js';

const api = k => (k.base ? `${k.base}/2.0` : 'https://api.box.com/2.0'), upload = k => (k.base ? `${k.base}/api/2.0` : 'https://upload.box.com/api/2.0');
const MS = 300000;
const no = (r, cosa) => new Error(`Box: ${cosa} non riuscito (HTTP ${r.stato}${r.json?.message ? `: ${r.json.message}` : ''})`);
// l'id dell'elemento già presente nel 409 (per le cartelle è un elenco, per i file un oggetto)
const conflitto = r => { const c = r.json?.context_info?.conflicts; return (Array.isArray(c) ? c[0] : c)?.id || null; };
// un corpo multipart/form-data con i campi nell'ordine dato: [{ nome, valore }] o [{ nome, file, tipo, contenuto }]
function multipart(parti) {
  const confine = `lumi${randomBytes(12).toString('hex')}`, pezzi = [];
  for (const p of parti) {
    pezzi.push(Buffer.from(`--${confine}\r\nContent-Disposition: form-data; name="${p.nome}"${p.file ? `; filename="${p.file.replace(/"/g, '')}"` : ''}\r\n${p.file ? `Content-Type: ${p.tipo || 'application/octet-stream'}\r\n` : ''}\r\n`));
    pezzi.push(Buffer.isBuffer(p.contenuto) ? p.contenuto : Buffer.from(String(p.valore ?? ''), 'utf8'), Buffer.from('\r\n'));
  }
  pezzi.push(Buffer.from(`--${confine}--\r\n`));
  return { corpo: Buffer.concat(pezzi), tipo: `multipart/form-data; boundary=${confine}` };
}
// l'id della cartella «Lumi/Fatture/2026» a partire dalla radice (id 0), creando quelle che mancano
async function cartellaId(k, bearer, percorso) {
  let padre = '0';
  for (const nome of percorso.split('/').filter(Boolean)) {
    const r = await k.http.post(`${api(k)}/folders?fields=id`, { bearer, json: { name: nome, parent: { id: padre } } });
    const id = r.ok ? r.json?.id : r.stato === 409 ? conflitto(r) : null;
    if (!id) throw no(r, `creare la cartella «${nome}»`);
    padre = String(id);
  }
  return padre;
}
async function carica(k, cartella, nome, contenuto, tipo) {
  const bearer = await k.oauth.token(), padre = await cartellaId(k, bearer, cartella);
  const invia = (url, attributi) => { const m = multipart([{ nome: 'attributes', valore: JSON.stringify(attributi) }, { nome: 'file', file: nome, tipo, contenuto }]);
    return k.http.post(url, { bearer, testo: m.corpo, intestazioni: { 'Content-Type': m.tipo }, ms: MS }); };
  let r = await invia(`${upload(k)}/files/content?fields=id`, { name: nome, parent: { id: padre } });
  if (r.stato === 409 && conflitto(r)) r = await invia(`${upload(k)}/files/${encodeURIComponent(conflitto(r))}/content?fields=id`, { name: nome });   // nuova versione
  if (!r.ok) throw no(r, `il caricamento di «${nome}»`);
  return { id: r.json?.entries?.[0]?.id || null };
}
async function elenca(k, cartella) {
  const bearer = await k.oauth.token(), id = await cartellaId(k, bearer, cartella), out = [];
  for (let offset = 0, n = 0; n < 20; n++) {
    const r = await k.http.get(`${api(k)}/folders/${encodeURIComponent(id)}/items?fields=name&limit=1000&offset=${offset}`, { bearer });
    if (!r.ok) throw no(r, 'l\'elenco dei backup');
    const e = r.json?.entries || []; for (const x of e) if (x.type === 'file') out.push({ nome: x.name, id: x.id });
    offset += e.length; if (!e.length || offset >= Number(r.json?.total_count || 0)) break;
  }
  return out;
}
async function cancella(k, voce) {
  const r = await k.http.delete(`${api(k)}/files/${encodeURIComponent(voce.id)}`, { bearer: await k.oauth.token() });
  if (!r.ok && r.stato !== 404) throw no(r, `la cancellazione di «${voce.nome}»`);
}

const A = archivio({ nome: 'Box', carica, elenca, cancella, massimo: 50 * 1048576, pronto: k => k.oauth.collegato() });
export default {
  id: 'box', nome: 'Box', versione: 1, icona: 'documento',
  descrizione: 'Fatture e documenti su Box, cartelle per anno, e il backup del database ogni notte.',
  impostazioni: [...A.impostazioni,
    { id: 'client_id', nome: 'Box: Client ID', segreto: true }, { id: 'client_secret', nome: 'Box: Client Secret', segreto: true }],
  richiede: A.richiede, permessi: A.permessi, azioni: A.azioni, uscita: A.uscita, pianificati: A.pianificati,
  oauth: { tipo: 'codice', autorizza: 'https://account.box.com/api/oauth2/authorize', token: k => (k.base ? `${k.base}/oauth2/token` : 'https://api.box.com/oauth2/token'), scope: 'root_readwrite', pkce: false },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Box' };
    const r = await k.http.get(`${api(k)}/users/me?fields=login`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? r.json?.login : `HTTP ${r.stato}` };
  },
  catalogo: {
    categoria: 'archivio', sito: 'https://www.box.com', costo: 'gratis',
    costoNota: 'Piano Individual gratis con 10 GB (file fino a 250 MB); Personal Pro 100 GB a circa 10 € al mese; Business Starter e Business a partire da pochi euro fino a circa 15 € per utente al mese (fatturazione annuale). L\'API non costa.',
    serve: [{ cosa: 'Client ID e Client Secret di un\'app «Custom App» con autenticazione «User Authentication (OAuth 2.0)»', dove: 'Box Developer Console → My Platform Apps → Create Platform App → Custom App → scheda Configuration', link: 'https://app.box.com/developers/console' }],
    passi: [
      'Nella Developer Console di Box crea una «Custom App» con «User Authentication (OAuth 2.0)».',
      'Scheda Configuration: in Application Scopes spunta «Write all files and folders stored in Box» e salva.',
      'Sempre in Configuration, alla voce Redirect URIs aggiungi http://localhost:<porta di Lumi>/api/connettori/box/oauth/ritorno.',
      'Copia Client ID e Client Secret, incollali in Lumi, accendi il connettore e premi «Collega».',
      'Scegli se salvare da solo le fatture emesse e quanti backup tenere. Un file oltre 50 MB viene rifiutato.',
      'Se Lumi resta spento più di 60 giorni il collegamento scade: basta premere di nuovo «Collega».',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developer.box.com/reference/post-files-content/', 'https://developer.box.com/reference/post-files-id-content/', 'https://developer.box.com/reference/post-folders/', 'https://developer.box.com/guides/authentication/oauth2/', 'https://www.box.com/pricing'],
    prova: 'finto', parole: ['box', 'box.com', 'archivio', 'cloud', 'backup', 'copia', 'documenti', 'storage', 'files'],
  },
  testi: testiArchivio('Box', {
    en: { nome: 'Box', descrizione: 'Invoices and documents on Box, folders by year, and a nightly database backup.', 'imp.client_id': 'Box: Client ID', 'imp.client_secret': 'Box: Client Secret',
      'cat.costoNota': 'Free Individual plan with 10 GB (files up to 250 MB); Personal Pro 100 GB for about €10/month; Business Starter and Business from a few euros up to about €15 per user per month (billed annually). The API is free.',
      'cat.serve': [{ cosa: 'Client ID and Client Secret of a «Custom App» with «User Authentication (OAuth 2.0)»', dove: 'Box Developer Console → My Platform Apps → Create Platform App → Custom App → Configuration tab' }],
      'cat.passi': ['In the Box Developer Console create a «Custom App» with «User Authentication (OAuth 2.0)».', 'Configuration tab: under Application Scopes tick «Write all files and folders stored in Box» and save.', 'Still in Configuration, add the redirect URI http://localhost:<Lumi port>/api/connettori/box/oauth/ritorno.', 'Copy Client ID and Client Secret, paste them in Lumi, turn the connector on and press «Connect».', 'Choose whether to save issued invoices automatically and how many backups to keep. Files over 50 MB are refused.', 'If Lumi stays off for more than 60 days the link expires: just press «Connect» again.'] },
    es: { nome: 'Box', descrizione: 'Facturas y documentos en Box, carpetas por año, y copia nocturna de la base de datos.', 'imp.client_id': 'Box: Client ID', 'imp.client_secret': 'Box: Client Secret' },
    fr: { nome: 'Box', descrizione: 'Factures et documents sur Box, dossiers par année, et sauvegarde nocturne de la base.', 'imp.client_id': 'Box : Client ID', 'imp.client_secret': 'Box : Client Secret' },
    de: { nome: 'Box', descrizione: 'Rechnungen und Dokumente in Box, Ordner nach Jahr, und nächtliche Datenbanksicherung.', 'imp.client_id': 'Box: Client-ID', 'imp.client_secret': 'Box: Client-Secret' },
    pt: { nome: 'Box', descrizione: 'Faturas e documentos no Box, pastas por ano, e backup noturno do banco de dados.', 'imp.client_id': 'Box: Client ID', 'imp.client_secret': 'Box: Client Secret' },
  }),
};
