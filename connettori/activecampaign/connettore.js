// ActiveCampaign (email marketing e automazioni): i clienti con il consenso tra i contatti, iscritti a una lista.
// - in uscita: ogni cliente nuovo o cambiato passa da POST /contact/sync (crea o aggiorna per email: mai doppioni)
//   e va nella lista con POST /contactLists (status 1); la prima volta prende anche il tag scelto (POST /contactTags);
//   se in Lumi il consenso viene tolto, nella lista diventa status 2 (disiscritto);
// - ogni 30 minuti un giro ripassa i clienti cambiati e legge i disiscritti della lista (GET /contacts?listid&status=2):
//   in Lumi il consenso diventa «no».
// API v3: https://<account>.api-us1.com/api/3, intestazione Api-Token; 5 richieste al secondo per account.
import { spezza, cambiate } from '../_comunica/tabelle.js';
const abase = k => `${k.base || String(k.imp.url || '').replace(/\/+$/, '').replace(/\/api\/3$/, '')}/api/3`;
const opz = (k, json) => ({ intestazioni: { 'Api-Token': k.segreti.token }, ...(json ? { json } : {}) });
const no = (r, cosa) => new Error(`ActiveCampaign ha risposto ${r.stato} a ${cosa}${r.json?.message || r.json?.errors?.[0]?.title ? ': ' + (r.json.message || r.json.errors[0].title) : ''}`);
const conConsenso = k => !!k.campo('clienti', 'consenso');
const pausa = ms => new Promise(r => setTimeout(r, ms));
const inLista = (k, contatto, status) => k.http.post(`${abase(k)}/contactLists`, opz(k, { contactList: { list: Number(k.imp.lista), contact: Number(contatto), status } }));
// un cliente tra i contatti: → 'iscritto' | 'disiscritto' | 'senza email' | 'senza consenso'
async function iscrivi(k, c) {
  const email = String(k.valore(c, 'clienti', 'email') || '').trim().toLowerCase();
  if (!email) return 'senza email';
  const noto = k.sincro.remoto('clienti', c.id);
  if (conConsenso(k) && k.valore(c, 'clienti', 'consenso') !== true) {
    if (!noto) return 'senza consenso';
    const r = await inLista(k, noto, 2); if (!r.ok) throw no(r, `la disiscrizione di ${email}`);
    return 'disiscritto';
  }
  const { nome, cognome } = spezza(k.valore(c, 'clienti', 'nome')), tel = k.campo('clienti', 'telefono') && k.valore(c, 'clienti', 'telefono');
  const r = await k.http.post(`${abase(k)}/contact/sync`, opz(k, { contact: { email, firstName: nome, lastName: cognome, ...(tel ? { phone: String(tel) } : {}) } }));
  if (!r.ok || !r.json?.contact?.id) throw no(r, `il contatto ${email}`);
  const id = String(r.json.contact.id); k.sincro.collega('clienti', c.id, id);
  const l = await inLista(k, id, 1); if (!l.ok) throw no(l, `l'iscrizione alla lista di ${email}`);
  if (k.imp.tag && !noto) { const t = await k.http.post(`${abase(k)}/contactTags`, opz(k, { contactTag: { contact: id, tag: String(k.imp.tag) } })); if (!t.ok && t.stato !== 422) throw no(t, 'il tag'); }
  return 'iscritto';
}
// i disiscritti della lista: chi in Lumi ha ancora il consenso lo perde (a pagine da 100, per id crescente)
async function disiscritti(k) {
  if (!conConsenso(k)) return 0; let n = 0, dopo = 0;
  for (let i = 0; i < 30; i++) {
    const q = new URLSearchParams({ listid: String(k.imp.lista), status: '2', limit: '100', 'orders[id]': 'ASC', id_greater: String(dopo) });
    const r = await k.http.get(`${abase(k)}/contacts?${q}`, opz(k)); if (!r.ok) throw no(r, 'l\'elenco dei disiscritti');
    const voci = r.json?.contacts || [];
    for (const s of voci) {
      dopo = Math.max(dopo, Number(s.id) || 0);
      const c = k.dati.trova('clienti', 'email', String(s.email || '').trim().toLowerCase());
      if (c && k.valore(c, 'clienti', 'consenso') !== false) { k.dati.modifica('clienti', c.id, { consenso: false }); n++; }
    }
    if (voci.length < 100) break;
  }
  return n;
}
async function sincronizza(k, { tutto = false } = {}) {
  const e = k.entita('clienti'); if (tutto) k.stato.scrivi(`cursore:${e}`, null);
  const { righe, salva } = cambiate(k, e), conti = { iscritti: 0, saltati: 0 };
  for (const [i, c] of righe.entries()) { if (i) await pausa(250); (await iscrivi(k, c)) === 'iscritto' ? conti.iscritti++ : conti.saltati++; salva(c.modificato); }
  return { ...conti, disiscritti: await disiscritti(k) };
}
export default {
  id: 'activecampaign', nome: 'ActiveCampaign', versione: 1, icona: 'utenti',
  descrizione: 'I clienti con il consenso tra i contatti di ActiveCampaign, iscritti a una lista; chi si disiscrive torna in Lumi.',
  impostazioni: [
    { id: 'url', nome: 'URL dell\'API (es. https://bottega.api-us1.com)', tipo: 'url', schema: /^https:\/\/[a-z0-9-]+\.(api-us1\.com|activehosted\.com)(\/api\/3)?\/?$/i },
    { id: 'token', nome: 'Chiave API', segreto: true, schema: /^[A-Za-z0-9]{40,100}$/ },
    { id: 'lista', nome: 'Id della lista', schema: /^\d{1,9}$/ },
    { id: 'tag', nome: 'Id del tag per i clienti di Lumi (facoltativo)', schema: /^\d{1,9}$/, obbligatorio: false },
  ],
  richiede: { clienti: { nome: {}, email: { tipo: ['email'] }, telefono: { tipo: ['telefono', 'testo'], facoltativo: true }, consenso: { tipo: ['si_no'], facoltativo: true } } },
  permessi: { clienti: { leggi: true, modifica: true } },   // modifica: solo il consenso di chi si disiscrive
  prova: async k => {
    const r = await k.http.get(`${abase(k)}/lists/${encodeURIComponent(k.imp.lista)}`, opz(k));
    return { ok: r.ok, messaggio: r.ok ? `Lista «${r.json?.list?.name || k.imp.lista}»` : r.stato === 404 ? `La lista ${k.imp.lista} non c'è` : `HTTP ${r.stato}` };
  },
  uscita: { clienti: { campi: ['nome', 'email', 'telefono', 'consenso'], quando: (r, k) => !!k.valore(r, 'clienti', 'email'), invia: async (riga, k) => { await iscrivi(k, riga); } } },
  pianificati: { sincronizza: { nome: 'Clienti cambiati e disiscritti', ogni: '30m', giro: k => sincronizza(k) } },
  azioni: {
    sincronizza_ora: {
      nome: 'Sincronizza ora con ActiveCampaign', descrizione: 'Ripassa tutti i clienti con il consenso e legge chi si è disiscritto dalla lista', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Sincronizza con ActiveCampaign', righe: [['Clienti', 'tutti (con email' + (conConsenso(k) ? ' e consenso)' : ')')], ['Lista', String(k.imp.lista)], ['Tag', k.imp.tag || '—']], avvisi: conConsenso(k) ? [] : ['La sezione clienti non ha il campo del consenso: passano tutti i clienti con email'] }),
      esegui: async (x, k) => sincronizza(k, { tutto: true }),
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.activecampaign.com', costo: 'abbonamento',
    costoNota: 'Prova gratuita di 14 giorni; piano Starter da circa 15 $ al mese (1.000 contatti, fatturazione annuale), Plus da circa 49 $; il prezzo sale con i contatti. L\'API è compresa in tutti i piani.',
    serve: [
      { cosa: 'L\'URL dell\'API e la chiave API', dove: 'ActiveCampaign → Impostazioni (ingranaggio in basso a sinistra) → Sviluppatore: «URL» e «Chiave»', link: 'https://help.activecampaign.com/hc/en-us/articles/207317590-Getting-started-with-the-API' },
      { cosa: 'L\'id della lista (e, se vuoi, di un tag)', dove: 'Contatti → Liste → apri la lista: è il numero «listid=» nell\'indirizzo; i tag in Contatti → Gestisci tag', link: 'https://help.activecampaign.com/hc/en-us/articles/115000867664-How-to-find-the-ID-for-lists-forms-and-other-items' },
    ],
    passi: [
      'In ActiveCampaign apri Impostazioni → Sviluppatore e copia URL e chiave API.',
      'Apri Contatti → Liste, scegli la lista dei clienti e copia il numero dopo «listid=» nell\'indirizzo.',
      'Se vuoi un tag sui clienti di Lumi, crealo e copia il suo id (facoltativo).',
      'Incolla URL, chiave, lista e tag; premi «Prova la connessione».',
      'Premi «Sincronizza ora con ActiveCampaign»: passano i clienti con email e consenso.',
      'Da lì ogni cliente nuovo o cambiato va subito ad ActiveCampaign, e ogni 30 minuti chi si disiscrive perde il consenso in Lumi.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developers.activecampaign.com/reference/authentication', 'https://developers.activecampaign.com/reference/sync-a-contacts-data', 'https://developers.activecampaign.com/reference/update-list-status-for-contact', 'https://developers.activecampaign.com/reference/list-all-contacts', 'https://developers.activecampaign.com/reference/create-contact-tag', 'https://www.activecampaign.com/pricing'],
    prova: 'finto', parole: ['activecampaign', 'active campaign', 'email marketing', 'automazioni', 'automation', 'newsletter', 'liste', 'contatti', 'contacts', 'consenso'],
  },
  testi: {
    en: { nome: 'ActiveCampaign', descrizione: 'Customers with consent among ActiveCampaign contacts, subscribed to a list; unsubscribes come back to Lumi.', 'imp.url': 'API URL (e.g. https://shop.api-us1.com)', 'imp.token': 'API key', 'imp.lista': 'List id', 'imp.tag': 'Tag id for Lumi customers (optional)', 'az.sincronizza_ora': 'Sync now with ActiveCampaign', 'giro.sincronizza': 'Changed customers and unsubscribes',
      'cat.costoNota': '14-day free trial; Starter plan from about $15 per month (1,000 contacts, billed annually), Plus from about $49; price grows with contacts. The API is included in every plan.',
      'cat.serve': [{ cosa: 'The API URL and API key', dove: 'ActiveCampaign → Settings (gear, bottom left) → Developer: «URL» and «Key»' }, { cosa: 'The list id (and optionally a tag id)', dove: 'Contacts → Lists → open the list: it is the «listid=» number in the address; tags in Contacts → Manage tags' }],
      'cat.passi': ['In ActiveCampaign open Settings → Developer and copy URL and API key.', 'Open Contacts → Lists, pick the customers list and copy the number after «listid=» in the address.', 'If you want a tag on Lumi customers, create it and copy its id (optional).', 'Paste URL, key, list and tag; press «Test connection».', 'Press «Sync now with ActiveCampaign»: customers with email and consent go over.', 'From then on every new or changed customer goes to ActiveCampaign at once, and every 30 minutes those who unsubscribe lose consent in Lumi.'] },
    es: { nome: 'ActiveCampaign', descrizione: 'Los clientes con consentimiento entre los contactos de ActiveCampaign, suscritos a una lista; las bajas vuelven a Lumi.', 'imp.url': 'URL de la API (p. ej. https://tienda.api-us1.com)', 'imp.token': 'Clave API', 'imp.lista': 'Id de la lista', 'imp.tag': 'Id de la etiqueta para los clientes de Lumi (opcional)', 'az.sincronizza_ora': 'Sincronizar ahora con ActiveCampaign', 'giro.sincronizza': 'Clientes cambiados y bajas' },
    fr: { nome: 'ActiveCampaign', descrizione: 'Les clients avec consentement parmi les contacts ActiveCampaign, inscrits à une liste ; les désinscriptions reviennent dans Lumi.', 'imp.url': 'URL de l\'API (ex. https://boutique.api-us1.com)', 'imp.token': 'Clé API', 'imp.lista': 'Id de la liste', 'imp.tag': 'Id du tag pour les clients Lumi (facultatif)', 'az.sincronizza_ora': 'Synchroniser maintenant avec ActiveCampaign', 'giro.sincronizza': 'Clients modifiés et désinscriptions' },
    de: { nome: 'ActiveCampaign', descrizione: 'Kunden mit Einwilligung unter den ActiveCampaign-Kontakten, in einer Liste; Abmeldungen kommen zurück in Lumi.', 'imp.url': 'API-URL (z. B. https://laden.api-us1.com)', 'imp.token': 'API-Schlüssel', 'imp.lista': 'Listen-ID', 'imp.tag': 'Tag-ID für Lumi-Kunden (optional)', 'az.sincronizza_ora': 'Jetzt mit ActiveCampaign abgleichen', 'giro.sincronizza': 'Geänderte Kunden und Abmeldungen' },
    pt: { nome: 'ActiveCampaign', descrizione: 'Os clientes com consentimento entre os contatos do ActiveCampaign, numa lista; os cancelamentos voltam ao Lumi.', 'imp.url': 'URL da API (ex. https://loja.api-us1.com)', 'imp.token': 'Chave de API', 'imp.lista': 'Id da lista', 'imp.tag': 'Id da etiqueta para os clientes do Lumi (opcional)', 'az.sincronizza_ora': 'Sincronizar agora com o ActiveCampaign', 'giro.sincronizza': 'Clientes alterados e cancelamentos' },
  },
};
