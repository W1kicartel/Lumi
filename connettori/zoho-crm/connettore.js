// Zoho CRM: i clienti di Kubo e i contatti di Zoho allineati nei due sensi.
// - accesso: OAuth «codice» sul data center dell'account (impostazione «regione»: accounts.zoho.eu per l'UE, .com, .in, …),
//   scope ZohoCRM.modules.contacts.ALL e ZohoCRM.modules.accounts.ALL; l'API sta su www.zohoapis.<regione>, «Zoho-oauthtoken»;
// - Kubo → Zoho: ogni cliente nuovo o cambiato è un Contact (upsert con duplicate_check_fields Email: mai doppioni);
//   chi ha la partita IVA è anche un Account (upsert per Account_Name) e il contatto ci viene collegato;
// - Zoho → Kubo: ogni 15 minuti i Contacts cambiati dopo l'ultimo giro (If-Modified-Since) creano o aggiornano i clienti.
// Quello che arriva da Zoho non torna indietro (anti-eco del nucleo), e un contatto senza novità non riscrive niente.
import { spezza, lotti } from '../_comunica/tabelle.js';
const REGIONI = ['eu', 'com', 'in', 'com.au', 'jp', 'ca', 'sa', 'com.cn'];
const reg = k => (REGIONI.includes(k.imp.regione) ? k.imp.regione : 'eu');
const zbase = k => `${k.base || `https://www.zohoapis.${reg(k)}`}/crm/v8`;
const conti = k => (k.base ? `${k.base}/oauth/v2` : `https://accounts.${reg(k) === 'ca' ? 'zohocloud' : 'zoho'}.${reg(k)}/oauth/v2`);
const opz = async (k, json, extra = {}) => ({ intestazioni: { Authorization: `Zoho-oauthtoken ${await k.oauth.token()}`, ...extra }, ...(json ? { json } : {}) });
const no = (r, cosa) => new Error(`Zoho CRM ha risposto ${r.stato} a ${cosa}${r.json?.message || r.json?.data?.[0]?.message ? ': ' + (r.json.message || r.json.data[0].message) : ''}`);
const CAMPI = 'Email,First_Name,Last_Name,Phone,Mobile,Modified_Time';
// un Contact di Zoho nella forma della mappa «contatti» (telefono solo se la sezione clienti ce l'ha)
const piatto = (k, c) => ({ id: String(c.id), nome: [c.First_Name, c.Last_Name].filter(Boolean).join(' ') || c.Email || `Contatto ${c.id}`, email: c.Email ? String(c.Email).toLowerCase() : null,
  ...(k.campo('clienti', 'telefono') ? { telefono: c.Phone || c.Mobile || null } : {}) });
// un cliente come Contact: Last_Name è obbligatorio in Zoho, per un nome solo va lì
function contatto(k, c, azienda) {
  const n = String(k.valore(c, 'clienti', 'nome') || '').trim(), { nome, cognome } = spezza(n), tel = k.campo('clienti', 'telefono') && k.valore(c, 'clienti', 'telefono');
  return { Email: String(k.valore(c, 'clienti', 'email')).trim().toLowerCase(), ...(cognome ? { First_Name: nome, Last_Name: cognome } : { Last_Name: nome || 'Cliente' }),
    ...(tel ? { Phone: String(tel) } : {}), ...(azienda ? { Account_Name: { id: azienda } } : {}) };
}
// un cliente con la partita IVA è anche un Account: l'id sta in k.stato (l'abbinamento righe↔id è dei contatti)
async function azienda(k, c) {
  const piva = k.campo('clienti', 'piva') && k.valore(c, 'clienti', 'piva'); if (!piva) return null;
  const tel = k.valore(c, 'clienti', 'telefono'), ind = k.campo('clienti', 'indirizzo') && k.valore(c, 'clienti', 'indirizzo');
  const rec = { Account_Name: String(k.valore(c, 'clienti', 'nome')), ...(tel ? { Phone: String(tel) } : {}), ...(ind ? { Billing_Street: String(ind) } : {}), Description: `P.IVA ${piva}` };
  const r = await k.http.post(`${zbase(k)}/Accounts/upsert`, await opz(k, { data: [rec], duplicate_check_fields: ['Account_Name'], trigger: [] }));
  const x = r.json?.data?.[0]; if (!r.ok || x?.status !== 'success') throw no(r, 'l\'azienda');
  const mappa = k.stato.leggi('aziende') || {}; if (mappa[c.id] !== x.details.id) { mappa[c.id] = x.details.id; k.stato.scrivi('aziende', mappa); }
  return x.details.id;
}
// Kubo → Zoho, a lotti da 100 (il massimo dell'upsert)
async function invia(k, clienti) {
  let n = 0;
  for (const gruppo of lotti(clienti.filter(c => k.valore(c, 'clienti', 'email')), 100)) {
    const data = []; for (const c of gruppo) data.push(contatto(k, c, await azienda(k, c)));
    const r = await k.http.post(`${zbase(k)}/Contacts/upsert`, await opz(k, { data, duplicate_check_fields: ['Email'], trigger: [] }));
    if (!r.ok && r.stato !== 207) throw no(r, 'l\'invio dei contatti');
    (r.json?.data || []).forEach((x, i) => { if (x.status === 'success' && x.details?.id) { k.sincro.collega('clienti', gruppo[i].id, String(x.details.id)); n++; } });
  }
  return n;
}
// Zoho → Kubo: i Contacts cambiati dopo il cursore (Modified_Time), in ordine, al massimo 2.000 per giro
async function ricevi(k) {
  const dopo = k.stato.leggi('modificati'), tot = { creati: 0, aggiornati: 0, uguali: 0 }; let ultimo = dopo;
  for (let pagina = 1; pagina <= 10; pagina++) {
    const q = new URLSearchParams({ fields: CAMPI, sort_by: 'Modified_Time', sort_order: 'asc', per_page: '200', page: String(pagina) });
    const r = await k.http.get(`${zbase(k)}/Contacts?${q}`, await opz(k, null, dopo ? { 'If-Modified-Since': dopo } : {}));
    if (r.stato === 304 || r.stato === 204) break;
    if (!r.ok) throw no(r, 'la lettura dei contatti');
    const res = (r.json?.data || []).filter(x => x.Email && (!dopo || Date.parse(x.Modified_Time) > Date.parse(dopo)));
    const c = await k.sincro.daRemoto('contatti', res.map(x => piatto(k, x)));
    for (const x of Object.keys(tot)) tot[x] += c[x];
    for (const x of r.json?.data || []) if (x.Modified_Time && (!ultimo || Date.parse(x.Modified_Time) > Date.parse(ultimo))) ultimo = x.Modified_Time;
    if (!r.json?.info?.more_records) break;
  }
  if (ultimo && ultimo !== dopo) k.stato.scrivi('modificati', ultimo);
  return tot;
}
export default {
  id: 'zoho-crm', nome: 'Zoho CRM', versione: 1, icona: 'utenti',
  descrizione: 'Clienti di Kubo e contatti di Zoho CRM allineati nei due sensi; le aziende con P.IVA come Account.',
  impostazioni: [
    { id: 'client_id', nome: 'Client ID (Zoho API Console)', segreto: true },
    { id: 'client_secret', nome: 'Client secret (Zoho API Console)', segreto: true },
    { id: 'regione', nome: 'Data center dell\'account', tipo: 'scelta', opzioni: [{ id: 'eu', nome: 'Europa (zoho.eu)' }, { id: 'com', nome: 'Stati Uniti (zoho.com)' }, { id: 'in', nome: 'India (zoho.in)' },
      { id: 'com.au', nome: 'Australia (zoho.com.au)' }, { id: 'jp', nome: 'Giappone (zoho.jp)' }, { id: 'ca', nome: 'Canada (zohocloud.ca)' }, { id: 'sa', nome: 'Arabia Saudita (zoho.sa)' }, { id: 'com.cn', nome: 'Cina (zoho.com.cn)' }], predefinito: 'eu' },
  ],
  richiede: { clienti: { nome: {}, email: { tipo: ['email'] }, telefono: { tipo: ['telefono', 'testo'], facoltativo: true }, piva: { tipo: ['testo'], facoltativo: true }, indirizzo: { tipo: ['indirizzo', 'testo'], facoltativo: true } } },
  permessi: { clienti: { leggi: true, crea: true, modifica: true } },
  mappe: { contatti: { entita: 'clienti', id: 'id', chiave: ['email', 'email'], campi: [{ kubo: 'nome', remoto: 'nome' }, { kubo: 'email', remoto: 'email' }, { kubo: 'telefono', remoto: 'telefono' }] } },
  oauth: { tipo: 'codice', autorizza: k => `${conti(k)}/auth`, token: k => `${conti(k)}/token`, scope: 'ZohoCRM.modules.contacts.ALL,ZohoCRM.modules.accounts.ALL', extra: { access_type: 'offline', prompt: 'consent' } },
  prova: async k => { const r = await k.http.get(`${zbase(k)}/Contacts?fields=Email&per_page=1`, await opz(k)); return { ok: r.ok || r.stato === 204, messaggio: r.ok || r.stato === 204 ? `Collegato a Zoho CRM (${reg(k)})` : `HTTP ${r.stato}` }; },
  uscita: { clienti: { campi: ['nome', 'email', 'telefono', 'piva'], quando: (r, k) => !!k.valore(r, 'clienti', 'email'), invia: async (riga, k) => { await invia(k, [riga]); } } },
  pianificati: { contatti: { nome: 'Contatti modificati in Zoho CRM', ogni: '15m', giro: k => ricevi(k) } },
  azioni: {
    invia_tutti: {
      nome: 'Manda tutti i clienti a Zoho CRM', descrizione: 'Crea o aggiorna in Zoho CRM un contatto per ogni cliente con l\'email (e un\'azienda per chi ha la P.IVA)', su: 'clienti', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Clienti verso Zoho CRM', righe: [['Clienti con email', String(k.dati.elenca('clienti', { filtri: [{ campo: 'email', op: 'nonvuoto' }], perPagina: 1 }).totale ?? '—')], ['Data center', reg(k)]], avvisi: ['I contatti con la stessa email vengono aggiornati, non duplicati'] }),
      async esegui(x, k) { const tutti = []; for (let p = 1; p < 100; p++) { const l = k.dati.elenca('clienti', { perPagina: 500, pagina: p }).righe; tutti.push(...l); if (l.length < 500) break; } return { contatti: await invia(k, tutti) }; },
    },
    ricevi_ora: {
      nome: 'Leggi ora i contatti cambiati in Zoho CRM', descrizione: 'Porta in Kubo i contatti creati o modificati in Zoho CRM dall\'ultimo giro', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Contatti da Zoho CRM', righe: [['Dall\'ultimo giro', k.stato.leggi('modificati') || 'tutti']], avvisi: [] }),
      esegui: async (x, k) => ricevi(k),
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.zoho.com/it/crm/', costo: 'gratis',
    costoNota: 'Edizione Free gratuita fino a 3 utenti (con l\'API); Standard da 14 € per utente al mese, Professional da 23 € (fatturazione annuale). Le chiamate API al giorno dipendono dall\'edizione e dalle licenze.',
    serve: [
      { cosa: 'Un client «Server-based Applications» con Client ID e Client secret', dove: 'Zoho API Console (api-console.zoho.eu per l\'UE) → Add Client → Server-based Applications; come Authorized Redirect URI metti <indirizzo di Kubo>/api/connettori/zoho-crm/oauth/ritorno', link: 'https://api-console.zoho.eu' },
      { cosa: 'Il data center del tuo account', dove: 'È il dominio con cui entri in Zoho: crm.zoho.eu → Europa, crm.zoho.com → Stati Uniti, crm.zoho.in → India…', link: 'https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html' },
    ],
    passi: [
      'Guarda il dominio con cui entri in Zoho CRM (zoho.eu, zoho.com, zoho.in…) e scegli qui lo stesso data center.',
      'Apri la Zoho API Console del tuo data center e aggiungi un client «Server-based Applications».',
      'Come Authorized Redirect URI incolla <indirizzo di Kubo>/api/connettori/zoho-crm/oauth/ritorno.',
      'Copia Client ID e Client secret, incollali qui e premi «Collega»: accetta l\'accesso a contatti e aziende.',
      'Premi «Manda tutti i clienti a Zoho CRM»: i clienti con email diventano contatti, quelli con P.IVA anche aziende.',
      'Da lì ogni cliente cambiato in Kubo va subito a Zoho, e ogni 15 minuti i contatti cambiati in Zoho arrivano in Kubo.',
    ],
    difficolta: 'media', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html', 'https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html', 'https://www.zoho.com/crm/developer/docs/api/v8/upsert-records.html', 'https://www.zoho.com/crm/developer/docs/api/v8/get-records.html', 'https://www.zoho.com/crm/developer/docs/api/v8/scopes.html', 'https://www.zoho.com/it/crm/zohocrm-pricing.html'],
    prova: 'finto', parole: ['zoho', 'zoho crm', 'crm', 'contatti', 'contacts', 'aziende', 'accounts', 'lead', 'vendite', 'sales'],
  },
  testi: {
    en: { nome: 'Zoho CRM', descrizione: 'Kubo customers and Zoho CRM contacts in line both ways; VAT-registered businesses as Accounts.', 'imp.client_id': 'Client ID (Zoho API Console)', 'imp.client_secret': 'Client secret (Zoho API Console)', 'imp.regione': 'Account data center', 'az.invia_tutti': 'Send all customers to Zoho CRM', 'az.ricevi_ora': 'Read contacts changed in Zoho CRM now', 'giro.contatti': 'Contacts changed in Zoho CRM',
      'cat.costoNota': 'Free edition for up to 3 users (API included); Standard from €14 per user per month, Professional from €23 (billed annually). Daily API calls depend on edition and licences.',
      'cat.serve': [{ cosa: 'A «Server-based Applications» client with Client ID and Client secret', dove: 'Zoho API Console (api-console.zoho.eu for the EU) → Add Client → Server-based Applications; as Authorized Redirect URI use <Kubo address>/api/connettori/zoho-crm/oauth/ritorno' }, { cosa: 'Your account data center', dove: 'It is the domain you log in with: crm.zoho.eu → Europe, crm.zoho.com → United States, crm.zoho.in → India…' }],
      'cat.passi': ['Check the domain you log into Zoho CRM with (zoho.eu, zoho.com, zoho.in…) and pick the same data center here.', 'Open the Zoho API Console of your data center and add a «Server-based Applications» client.', 'As Authorized Redirect URI paste <Kubo address>/api/connettori/zoho-crm/oauth/ritorno.', 'Copy Client ID and Client secret, paste them here and press «Connect»: allow access to contacts and accounts.', 'Press «Send all customers to Zoho CRM»: customers with an email become contacts, those with a VAT number also accounts.', 'From then on every customer changed in Kubo goes to Zoho right away, and every 15 minutes contacts changed in Zoho come into Kubo.'] },
    es: { nome: 'Zoho CRM', descrizione: 'Clientes de Kubo y contactos de Zoho CRM alineados en ambos sentidos; las empresas con NIF como Account.', 'imp.client_id': 'Client ID (Zoho API Console)', 'imp.client_secret': 'Client secret (Zoho API Console)', 'imp.regione': 'Centro de datos de la cuenta', 'az.invia_tutti': 'Enviar todos los clientes a Zoho CRM', 'az.ricevi_ora': 'Leer ahora los contactos cambiados en Zoho CRM', 'giro.contatti': 'Contactos modificados en Zoho CRM' },
    fr: { nome: 'Zoho CRM', descrizione: 'Clients de Kubo et contacts Zoho CRM alignés dans les deux sens ; les entreprises avec n° de TVA comme Account.', 'imp.client_id': 'Client ID (Zoho API Console)', 'imp.client_secret': 'Client secret (Zoho API Console)', 'imp.regione': 'Centre de données du compte', 'az.invia_tutti': 'Envoyer tous les clients à Zoho CRM', 'az.ricevi_ora': 'Lire maintenant les contacts modifiés dans Zoho CRM', 'giro.contatti': 'Contacts modifiés dans Zoho CRM' },
    de: { nome: 'Zoho CRM', descrizione: 'Kubo-Kunden und Zoho-CRM-Kontakte in beide Richtungen abgeglichen; Firmen mit USt-IdNr. als Account.', 'imp.client_id': 'Client-ID (Zoho API Console)', 'imp.client_secret': 'Client-Secret (Zoho API Console)', 'imp.regione': 'Rechenzentrum des Kontos', 'az.invia_tutti': 'Alle Kunden an Zoho CRM senden', 'az.ricevi_ora': 'In Zoho CRM geänderte Kontakte jetzt lesen', 'giro.contatti': 'In Zoho CRM geänderte Kontakte' },
    pt: { nome: 'Zoho CRM', descrizione: 'Clientes do Kubo e contatos do Zoho CRM alinhados nos dois sentidos; empresas com NIF como Account.', 'imp.client_id': 'Client ID (Zoho API Console)', 'imp.client_secret': 'Client secret (Zoho API Console)', 'imp.regione': 'Centro de dados da conta', 'az.invia_tutti': 'Enviar todos os clientes ao Zoho CRM', 'az.ricevi_ora': 'Ler agora os contatos alterados no Zoho CRM', 'giro.contatti': 'Contatos alterados no Zoho CRM' },
  },
};
