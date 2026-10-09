// HubSpot: i clienti di Kubo e i contatti di HubSpot allineati nei due sensi.
// - Kubo → HubSpot: ogni cliente nuovo o cambiato diventa un contatto (batch/upsert con idProperty=email: mai doppioni);
//   se ha la partita IVA è anche un'azienda (company) con lo stesso nome;
// - HubSpot → Kubo: ogni 15 minuti la ricerca dei contatti modificati (lastmodifieddate) crea o aggiorna i clienti;
// - webhook facoltativo (serve un indirizzo pubblico): X-HubSpot-Signature-v3 = base64 HMAC-SHA256 del metodo, dell'URI,
//   del corpo e del timestamp con il client secret dell'app, timestamp entro 5 minuti; il contatto si rilegge dall'API.
// Quello che arriva da HubSpot non torna indietro (anti-eco del nucleo), e un contatto senza novità non riscrive niente.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { spezza, lotti } from '../_comunica/tabelle.js';
const hbase = k => k.base || 'https://api.hubapi.com';
const opz = (k, json) => ({ bearer: k.segreti.token, ...(json ? { json } : {}) });
const no = (r, cosa) => new Error(`HubSpot ha risposto ${r.stato} a ${cosa}${r.json?.message ? ': ' + r.json.message : ''}`);
const PROP = ['email', 'firstname', 'lastname', 'phone', 'lastmodifieddate'];
// un contatto di HubSpot nella forma della mappa «contatti» (telefono solo se la sezione clienti ce l'ha)
const piatto = (k, c) => { const p = c.properties || {};
  return { id: c.id, nome: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || `Contatto ${c.id}`, email: p.email || null, ...(k.campo('clienti', 'telefono') ? { telefono: p.phone || null } : {}) }; };
function proprieta(k, c) {
  const { nome, cognome } = spezza(k.valore(c, 'clienti', 'nome')), tel = k.valore(c, 'clienti', 'telefono');
  return { email: String(k.valore(c, 'clienti', 'email')).trim().toLowerCase(), firstname: nome, lastname: cognome, ...(tel ? { phone: String(tel) } : {}) };
}
// Kubo → HubSpot, a lotti da 100 (il massimo di batch/upsert)
async function invia(k, clienti) {
  let n = 0;
  for (const gruppo of lotti(clienti.filter(c => k.valore(c, 'clienti', 'email')), 100)) {
    const r = await k.http.post(`${hbase(k)}/crm/v3/objects/contacts/batch/upsert`, opz(k, { inputs: gruppo.map(c => { const p = proprieta(k, c); return { idProperty: 'email', id: p.email, properties: p }; }) }));
    if (!r.ok) throw no(r, 'l\'invio dei contatti');
    for (const x of r.json?.results || []) { const c = gruppo.find(g => proprieta(k, g).email === String(x.properties?.email || '').toLowerCase()); if (c) { k.sincro.collega('clienti', c.id, x.id); n++; } }
    for (const c of gruppo) await azienda(k, c);
  }
  return n;
}
// un cliente con la partita IVA è anche un'azienda: l'id della company sta in k.stato (l'abbinamento righe↔id è dei contatti)
async function azienda(k, c) {
  const piva = k.campo('clienti', 'piva') && k.valore(c, 'clienti', 'piva'); if (!piva) return;
  const mappa = k.stato.leggi('aziende') || {}, tel = k.valore(c, 'clienti', 'telefono'), ind = k.campo('clienti', 'indirizzo') && k.valore(c, 'clienti', 'indirizzo');
  const properties = { name: k.valore(c, 'clienti', 'nome'), ...(tel ? { phone: String(tel) } : {}), ...(ind ? { address: String(ind) } : {}), description: `P.IVA ${piva}` };
  const r = mappa[c.id] ? await k.http.patch(`${hbase(k)}/crm/v3/objects/companies/${mappa[c.id]}`, opz(k, { properties })) : await k.http.post(`${hbase(k)}/crm/v3/objects/companies`, opz(k, { properties }));
  if (!r.ok) throw no(r, 'l\'azienda');
  if (!mappa[c.id]) { mappa[c.id] = r.json.id; k.stato.scrivi('aziende', mappa); }
}
// HubSpot → Kubo: i contatti modificati dopo il cursore, in ordine, al massimo 2.000 per giro
async function ricevi(k) {
  let dopo = k.stato.leggi('modificati') || '0', after, conti = { creati: 0, aggiornati: 0, uguali: 0 };
  for (let i = 0; i < 20; i++) {
    const r = await k.http.post(`${hbase(k)}/crm/v3/objects/contacts/search`, opz(k, { filterGroups: [{ filters: [{ propertyName: 'lastmodifieddate', operator: 'GT', value: dopo }] }],
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }], properties: PROP, limit: 100, ...(after ? { after } : {}) }));
    if (!r.ok) throw no(r, 'la ricerca dei contatti');
    const res = r.json?.results || [], c = await k.sincro.daRemoto('contatti', res.map(x => piatto(k, x)));
    for (const x of Object.keys(conti)) conti[x] += c[x];
    const ultimo = res.at(-1)?.properties?.lastmodifieddate; if (ultimo) k.stato.scrivi('modificati', String(Date.parse(ultimo) || ultimo));
    after = r.json?.paging?.next?.after; if (!after) break;
  }
  return conti;
}
// la firma v3: l'URI è quello che ha chiamato HubSpot (l'indirizzo pubblico di Kubo + il percorso), con alcuni caratteri decodificati
const DECODIFICA = { '%3A': ':', '%2F': '/', '%3F': '?', '%40': '@', '%21': '!', '%24': '$', '%27': "'", '%28': '(', '%29': ')', '%2A': '*', '%2C': ',', '%3B': ';' };
export function firmaV3(segreto, metodo, uri, corpo, ts) { return createHmac('sha256', segreto).update(`${metodo}${uri}${corpo}${ts}`, 'utf8').digest('base64'); }
function verifica({ req, grezzo, segreto, k }) {
  const ts = Number(req.headers['x-hubspot-request-timestamp']), firma = String(req.headers['x-hubspot-signature-v3'] || '');
  if (!ts || !firma || Math.abs(Date.now() - ts) > 3e5) return false;
  const base = String(k.imp.pubblico || k.pubblico || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
  const uri = base + String(req.url).replace(/%(3A|2F|3F|40|21|24|27|28|29|2A|2C|3B)/gi, m => DECODIFICA[m.toUpperCase()]);
  const a = Buffer.from(firmaV3(segreto, req.method, uri, grezzo.toString('utf8'), req.headers['x-hubspot-request-timestamp'])), b = Buffer.from(firma);
  return a.length === b.length && timingSafeEqual(a, b);
}
export default {
  id: 'hubspot', nome: 'HubSpot', versione: 1, icona: 'utenti',
  descrizione: 'Clienti di Kubo e contatti di HubSpot allineati nei due sensi; le aziende con P.IVA come company.',
  impostazioni: [
    { id: 'token', nome: 'Access token della Private App (pat-…)', segreto: true, schema: /^pat-[a-z0-9]+-[0-9a-f-]{20,}$/i },
    { id: 'firma', nome: 'Client secret della Private App (solo per il webhook)', segreto: true, obbligatorio: false },
    { id: 'pubblico', nome: 'Indirizzo pubblico di Kubo (solo per il webhook, es. https://kubo.bottega.it)', tipo: 'url', obbligatorio: false },
  ],
  richiede: { clienti: { nome: {}, email: { tipo: ['email'] }, telefono: { tipo: ['telefono', 'testo'], facoltativo: true }, piva: { tipo: ['testo'], facoltativo: true }, indirizzo: { tipo: ['indirizzo', 'testo'], facoltativo: true } } },
  permessi: { clienti: { leggi: true, crea: true, modifica: true } },
  mappe: { contatti: { entita: 'clienti', id: 'id', chiave: ['email', 'email'], campi: [{ kubo: 'nome', remoto: 'nome' }, { kubo: 'email', remoto: 'email' }, { kubo: 'telefono', remoto: 'telefono' }] } },
  prova: async k => { const r = await k.http.get(`${hbase(k)}/crm/v3/objects/contacts?limit=1`, opz(k)); return { ok: r.ok, messaggio: r.ok ? 'Collegato a HubSpot' : `HTTP ${r.stato}` }; },
  uscita: { clienti: { campi: ['nome', 'email', 'telefono', 'piva'], quando: (r, k) => !!k.valore(r, 'clienti', 'email'), invia: async (riga, k) => { await invia(k, [riga]); } } },
  pianificati: { contatti: { nome: 'Contatti modificati in HubSpot', ogni: '15m', giro: k => ricevi(k) } },
  entrata: {
    firma: { tipo: 'hubspot-v3', segreto: 'firma', verifica },
    idempotenza: ev => [].concat(ev).map(e => e?.eventId).filter(Boolean).join(',').slice(0, 300) || null,
    async gestisci(ev, k) {
      const ids = [...new Set([].concat(ev).filter(e => /^contact\.(creation|propertyChange|merge|restore)/.test(e?.subscriptionType || '')).map(e => String(e.objectId)))];
      if (!ids.length) return 'ignorato: nessun contatto';
      const r = await k.http.post(`${hbase(k)}/crm/v3/objects/contacts/batch/read`, opz(k, { properties: PROP, inputs: ids.map(id => ({ id })) }));
      if (!r.ok) throw no(r, 'la lettura dei contatti');
      const c = await k.sincro.daRemoto('contatti', (r.json?.results || []).map(x => piatto(k, x)));
      return `contatti: ${c.creati} creati, ${c.aggiornati} aggiornati`;
    },
  },
  azioni: {
    invia_tutti: {
      nome: 'Manda tutti i clienti a HubSpot', descrizione: 'Crea o aggiorna in HubSpot un contatto per ogni cliente con l\'email', su: 'clienti', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Clienti verso HubSpot', righe: [['Clienti con email', String(k.dati.elenca('clienti', { filtri: [{ campo: 'email', op: 'nonvuoto' }], perPagina: 1 }).totale ?? '—')]], avvisi: ['I contatti con la stessa email vengono aggiornati, non duplicati'] }),
      async esegui(x, k) { const tutti = []; for (let p = 1; p < 100; p++) { const l = k.dati.elenca('clienti', { perPagina: 500, pagina: p }).righe; tutti.push(...l); if (l.length < 500) break; } return { contatti: await invia(k, tutti) }; },
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.hubspot.com', costo: 'gratis',
    costoNota: 'HubSpot CRM gratuito (Free tools) con contatti illimitati fino a 1.000.000 e accesso alle API con le Private App; Starter Customer Platform da 9 € al mese per posto (fatturazione annuale).',
    serve: [
      { cosa: 'L\'access token di una Private App con gli scope crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.companies.write', dove: 'HubSpot → Impostazioni (ingranaggio) → Integrazioni → Private App → Crea una Private App → Ambiti → Crea → Mostra token', link: 'https://app.hubspot.com/private-apps/' },
      { cosa: 'Solo per il webhook: il client secret della Private App e un indirizzo pubblico di Kubo', dove: 'Private App → Webhook (URL di destinazione) e scheda Autenticazione → Client secret', link: 'https://developers.hubspot.com/docs/guides/apps/private-apps/create-and-edit-webhook-subscriptions-in-private-apps' },
    ],
    passi: [
      'In HubSpot apri Impostazioni → Integrazioni → Private App e crea un\'app «Kubo».',
      'Negli Ambiti spunta crm.objects.contacts.read, crm.objects.contacts.write e crm.objects.companies.write, poi crea l\'app.',
      'Copia l\'access token (pat-…) e incollalo qui; premi «Prova la connessione».',
      'Premi «Manda tutti i clienti a HubSpot»: i clienti con email diventano contatti, quelli con P.IVA anche aziende.',
      'Da lì ogni cliente cambiato in Kubo va subito a HubSpot, e ogni 15 minuti i contatti cambiati in HubSpot arrivano in Kubo.',
      'Facoltativo, se Kubo ha un indirizzo pubblico: nella Private App aggiungi il webhook verso <indirizzo>/api/connettori/hubspot/in con gli eventi dei contatti, e incolla qui il client secret. Se hai impostato l\'indirizzo pubblico di Kubo nella Libreria, puoi lasciarlo vuoto qui.',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.hubspot.com/docs/guides/api/crm/objects/contacts', 'https://developers.hubspot.com/docs/guides/api/crm/search', 'https://developers.hubspot.com/docs/guides/apps/private-apps/overview', 'https://developers.hubspot.com/docs/api/webhooks/validating-requests', 'https://www.hubspot.com/pricing/crm'],
    prova: 'finto', parole: ['hubspot', 'crm', 'contatti', 'contacts', 'aziende', 'companies', 'lead', 'marketing', 'vendite', 'sales'],
  },
  testi: {
    en: { nome: 'HubSpot', descrizione: 'Kubo customers and HubSpot contacts in line both ways; VAT-registered businesses as companies.', 'imp.token': 'Private App access token (pat-…)', 'imp.firma': 'Private App client secret (webhook only)', 'imp.pubblico': 'Public address of Kubo (webhook only, e.g. https://kubo.shop.com)', 'az.invia_tutti': 'Send all customers to HubSpot', 'giro.contatti': 'Contacts changed in HubSpot',
      'cat.costoNota': 'Free HubSpot CRM (Free tools) with up to 1,000,000 contacts and API access through Private Apps; Starter Customer Platform from €9 per seat per month (billed annually).',
      'cat.serve': [{ cosa: 'A Private App access token with scopes crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.companies.write', dove: 'HubSpot → Settings (gear) → Integrations → Private Apps → Create a private app → Scopes → Create → Show token' }, { cosa: 'Webhook only: the Private App client secret and a public address for Kubo', dove: 'Private App → Webhooks (target URL) and Auth tab → Client secret' }],
      'cat.passi': ['In HubSpot open Settings → Integrations → Private Apps and create a «Kubo» app.', 'Under Scopes tick crm.objects.contacts.read, crm.objects.contacts.write and crm.objects.companies.write, then create the app.', 'Copy the access token (pat-…) and paste it here; press «Test connection».', 'Press «Send all customers to HubSpot»: customers with an email become contacts, those with a VAT number also companies.', 'From then on every customer changed in Kubo goes to HubSpot right away, and every 15 minutes contacts changed in HubSpot come into Kubo.', 'Optional, if Kubo has a public address: add the webhook <address>/api/connettori/hubspot/in with contact events in the Private App, and paste the client secret here. If you set Kubo\'s public address in the Library, you can leave it empty here.'] },
    es: { nome: 'HubSpot', descrizione: 'Clientes de Kubo y contactos de HubSpot alineados en ambos sentidos; las empresas con NIF como company.', 'imp.token': 'Access token de la Private App (pat-…)', 'imp.firma': 'Client secret de la Private App (solo para el webhook)', 'imp.pubblico': 'Dirección pública de Kubo (solo para el webhook)', 'az.invia_tutti': 'Enviar todos los clientes a HubSpot', 'giro.contatti': 'Contactos modificados en HubSpot' },
    fr: { nome: 'HubSpot', descrizione: 'Clients de Kubo et contacts HubSpot alignés dans les deux sens ; les entreprises avec n° de TVA comme company.', 'imp.token': 'Access token de la Private App (pat-…)', 'imp.firma': 'Client secret de la Private App (webhook uniquement)', 'imp.pubblico': 'Adresse publique de Kubo (webhook uniquement)', 'az.invia_tutti': 'Envoyer tous les clients à HubSpot', 'giro.contatti': 'Contacts modifiés dans HubSpot' },
    de: { nome: 'HubSpot', descrizione: 'Kubo-Kunden und HubSpot-Kontakte in beide Richtungen abgeglichen; Firmen mit USt-IdNr. als Company.', 'imp.token': 'Access Token der Private App (pat-…)', 'imp.firma': 'Client Secret der Private App (nur für den Webhook)', 'imp.pubblico': 'Öffentliche Adresse von Kubo (nur für den Webhook)', 'az.invia_tutti': 'Alle Kunden an HubSpot senden', 'giro.contatti': 'In HubSpot geänderte Kontakte' },
    pt: { nome: 'HubSpot', descrizione: 'Clientes do Kubo e contatos do HubSpot alinhados nos dois sentidos; empresas com NIF como company.', 'imp.token': 'Access token da Private App (pat-…)', 'imp.firma': 'Client secret da Private App (só para o webhook)', 'imp.pubblico': 'Endereço público do Kubo (só para o webhook)', 'az.invia_tutti': 'Enviar todos os clientes ao HubSpot', 'giro.contatti': 'Contatos alterados no HubSpot' },
  },
};
