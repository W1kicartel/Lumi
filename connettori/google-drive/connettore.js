// Google Drive: fatture, preventivi e vendite come file (stampa HTML + XML FatturaPA) in Lumi/Fatture/2026/…, e il backup
// del database ogni notte in Lumi/Backup (gli ultimi N). OAuth con il codice + PKCE e scope drive.file: Lumi vede solo i
// file e le cartelle che ha creato lui, non il resto del Drive. Caricamento multipart fino a 5 MB, resumable oltre.
// API: https://developers.google.com/workspace/drive/api/guides/manage-uploads
import { randomBytes } from 'node:crypto';
import { archivio, testiArchivio } from '../_comunica/documento.js';

const api = k => k.base || 'https://www.googleapis.com';
const CARTELLA = 'application/vnd.google-apps.folder', MS = 300000;
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const no = (r, cosa) => new Error(`Google Drive: ${cosa} non riuscito (HTTP ${r.stato}${r.json?.error?.message ? `: ${r.json.error.message}` : ''})`);
async function cerca(k, bearer, filtro) {
  const r = await k.http.get(`${api(k)}/drive/v3/files?${new URLSearchParams({ q: `${filtro} and trashed = false`, fields: 'files(id,name)', spaces: 'drive', pageSize: '1000' })}`, { bearer });
  if (!r.ok) throw no(r, 'la ricerca'); return r.json?.files || [];
}
// l'id di una cartella «Lumi/Fatture/2026», creando quelle che mancano (o null se crea = false e non c'è)
async function cartellaId(k, bearer, percorso, crea = true) {
  let padre = 'root';
  for (const nome of percorso.split('/').filter(Boolean)) {
    let id = (await cerca(k, bearer, `name = '${q(nome)}' and mimeType = '${CARTELLA}' and '${q(padre)}' in parents`))[0]?.id;
    if (!id) {
      if (!crea) return null;
      const c = await k.http.post(`${api(k)}/drive/v3/files?fields=id`, { bearer, json: { name: nome, mimeType: CARTELLA, parents: [padre] } });
      if (!c.ok || !c.json?.id) throw no(c, `creare la cartella «${nome}»`); id = c.json.id;
    }
    padre = id;
  }
  return padre;
}
async function carica(k, cartella, nome, contenuto, tipo) {
  const bearer = await k.oauth.token(), padre = await cartellaId(k, bearer, cartella);
  const esiste = (await cerca(k, bearer, `name = '${q(nome)}' and '${q(padre)}' in parents`))[0]?.id;   // stesso nome: si aggiorna
  const metodo = esiste ? 'PATCH' : 'POST', url = `${api(k)}/upload/drive/v3/files${esiste ? `/${encodeURIComponent(esiste)}` : ''}`;
  const meta = esiste ? { name: nome } : { name: nome, parents: [padre] };
  let r;
  if (contenuto.length <= 5 * 1048576) {
    const confine = `lumi${randomBytes(12).toString('hex')}`;
    const corpo = Buffer.concat([Buffer.from(`--${confine}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${confine}\r\nContent-Type: ${tipo}\r\n\r\n`), contenuto, Buffer.from(`\r\n--${confine}--\r\n`)]);
    r = await k.http.richiesta(metodo, `${url}?uploadType=multipart&fields=id`, { bearer, testo: corpo, intestazioni: { 'Content-Type': `multipart/related; boundary=${confine}` }, ms: MS });
  } else {
    const s = await k.http.richiesta(metodo, `${url}?uploadType=resumable&fields=id`, { bearer, json: meta, intestazioni: { 'X-Upload-Content-Type': tipo, 'X-Upload-Content-Length': String(contenuto.length) } });
    if (!s.ok || !s.intestazioni.location) throw no(s, 'l\'avvio del caricamento');
    r = await k.http.put(s.intestazioni.location, { bearer, testo: contenuto, intestazioni: { 'Content-Type': tipo }, ms: MS });
  }
  if (!r.ok) throw no(r, `il caricamento di «${nome}»`);
  return { id: r.json?.id };
}
async function elenca(k, cartella) {
  const bearer = await k.oauth.token(), id = await cartellaId(k, bearer, cartella, false);
  return id ? (await cerca(k, bearer, `'${q(id)}' in parents and mimeType != '${CARTELLA}'`)).map(f => ({ nome: f.name, id: f.id })) : [];
}
async function cancella(k, voce) {
  const r = await k.http.delete(`${api(k)}/drive/v3/files/${encodeURIComponent(voce.id)}`, { bearer: await k.oauth.token() });
  if (!r.ok && r.stato !== 404) throw no(r, `la cancellazione di «${voce.nome}»`);
}

const A = archivio({ nome: 'Google Drive', breve: 'Drive', carica, elenca, cancella, pronto: k => k.oauth.collegato() });
export default {
  id: 'google-drive', nome: 'Google Drive', versione: 1, icona: 'documento',
  descrizione: 'Fatture e documenti su Google Drive, cartelle per anno, e il backup del database ogni notte.',
  impostazioni: [...A.impostazioni,
    { id: 'client_id', nome: 'Google: client ID OAuth', segreto: true }, { id: 'client_secret', nome: 'Google: client secret', segreto: true }],
  richiede: A.richiede, permessi: A.permessi, azioni: A.azioni, uscita: A.uscita, pianificati: A.pianificati,
  oauth: { tipo: 'codice', autorizza: 'https://accounts.google.com/o/oauth2/v2/auth', token: k => (k.base ? `${k.base}/token` : 'https://oauth2.googleapis.com/token'),
    scope: 'https://www.googleapis.com/auth/drive.file', extra: { access_type: 'offline', prompt: 'consent' } },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Google' };
    const r = await k.http.get(`${api(k)}/drive/v3/about?fields=user`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? r.json?.user?.emailAddress : `HTTP ${r.stato}` };
  },
  catalogo: {
    categoria: 'archivio', sito: 'https://www.google.com/drive/', costo: 'gratis',
    costoNota: '15 GB gratis con un account Google (condivisi con Gmail e Foto); Google One da 100 GB a 1,99 €/mese o 19,99 €/anno. L\'API di Drive non costa.',
    serve: [
      { cosa: 'Client ID e client secret OAuth (tipo «Applicazione web»)', dove: 'Google Cloud Console → API e servizi → Credenziali → Crea credenziali → ID client OAuth', link: 'https://console.cloud.google.com/apis/credentials' },
      { cosa: 'L\'API Google Drive attivata nel progetto', dove: 'Google Cloud Console → API e servizi → Libreria → Google Drive API → Abilita', link: 'https://console.cloud.google.com/apis/library/drive.googleapis.com' },
    ],
    passi: [
      'Crea un progetto su Google Cloud Console e abilita la Google Drive API.',
      'Schermata di consenso OAuth: tipo «Esterno», aggiungi te stesso come utente di test (o pubblica l\'app) e lo scope …/auth/drive.file.',
      'Crea un ID client OAuth di tipo «Applicazione web» con URI di reindirizzamento http://localhost:<porta di Lumi>/api/connettori/google-drive/oauth/ritorno.',
      'In Lumi incolla client ID e client secret, accendi il connettore e premi «Collega».',
      'Scegli se salvare da solo le fatture emesse e quanti backup notturni tenere (predefinito 14).',
      'Dalla scheda di una fattura usa «Salva su Google Drive», o chiedi a Lumi «salva la fattura 12 su Drive».',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.google.com/workspace/drive/api/guides/manage-uploads', 'https://developers.google.com/workspace/drive/api/guides/api-specific-auth', 'https://developers.google.com/identity/protocols/oauth2/web-server'],
    prova: 'finto', parole: ['google drive', 'drive', 'archivio', 'cloud', 'backup', 'copia', 'documenti', 'storage', 'files', 'google'],
  },
  testi: testiArchivio('Google Drive', {
    en: { nome: 'Google Drive', descrizione: 'Invoices and documents on Google Drive, folders by year, and a nightly database backup.', 'imp.client_id': 'Google: OAuth client ID', 'imp.client_secret': 'Google: client secret',
      'cat.costoNota': '15 GB free with a Google account (shared with Gmail and Photos); Google One from 100 GB at €1.99/month or €19.99/year. The Drive API is free.',
      'cat.serve': [{ cosa: 'OAuth client ID and client secret («Web application»)', dove: 'Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID' }, { cosa: 'Google Drive API enabled in the project', dove: 'Google Cloud Console → APIs & Services → Library → Google Drive API → Enable' }],
      'cat.passi': ['Create a project in Google Cloud Console and enable the Google Drive API.', 'OAuth consent screen: «External», add yourself as a test user (or publish the app) and the …/auth/drive.file scope.', 'Create a «Web application» OAuth client with redirect URI http://localhost:<Lumi port>/api/connettori/google-drive/oauth/ritorno.', 'In Lumi paste client ID and secret, turn the connector on and press «Connect».', 'Choose whether to save issued invoices automatically and how many nightly backups to keep (default 14).', 'From an invoice use «Save to Google Drive», or ask Lumi «save invoice 12 to Drive».'] },
    es: { nome: 'Google Drive', descrizione: 'Facturas y documentos en Google Drive, carpetas por año, y copia nocturna de la base de datos.', 'imp.client_id': 'Google: client ID de OAuth', 'imp.client_secret': 'Google: client secret' },
    fr: { nome: 'Google Drive', descrizione: 'Factures et documents sur Google Drive, dossiers par année, et sauvegarde nocturne de la base.', 'imp.client_id': 'Google : client ID OAuth', 'imp.client_secret': 'Google : client secret' },
    de: { nome: 'Google Drive', descrizione: 'Rechnungen und Dokumente in Google Drive, Ordner nach Jahr, und nächtliche Datenbanksicherung.', 'imp.client_id': 'Google: OAuth-Client-ID', 'imp.client_secret': 'Google: Client-Secret' },
    pt: { nome: 'Google Drive', descrizione: 'Faturas e documentos no Google Drive, pastas por ano, e backup noturno do banco de dados.', 'imp.client_id': 'Google: client ID OAuth', 'imp.client_secret': 'Google: client secret' },
  }),
};
