// Ecwid by Lightspeed: prodotti e giacenze nei due sensi, ordini pagati → vendite con il cliente.
// REST v3 (https://docs.ecwid.com/api-reference): https://app.ecwid.com/api/v3/<store id>, Bearer con il secret token
// dell'app personalizzata; liste con offset/limit e total. Webhook firmati: X-Ecwid-Webhook-Signature =
// base64(HMAC-SHA256("<eventCreated>.<eventId>", client secret)); il corpo porta solo l'id: l'ordine si rilegge dall'API.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { importaOrdine, RICHIEDE_NEGOZI, PERMESSI_NEGOZI } from '../_negozi/comune.js';

const api = (k, p) => `${(k.base || 'https://app.ecwid.com').replace(/\/$/, '')}/api/v3/${encodeURIComponent(k.imp.negozio || '')}${p}`;
const tok = k => ({ bearer: k.segreti.token });
const errore = r => new Error(`Ecwid ha risposto ${r.stato}${r.json?.errorMessage ? ': ' + r.json.errorMessage : ''}`);
async function chiama(k, metodo, p, json) { const r = await k.http[metodo](api(k, p), { ...tok(k), ...(json ? { json } : {}) }); if (!r.ok) throw errore(r); return r.json; }
async function* pagine(k, p, quanti = 100) {
  for (let da = 0; da < 1e5; da += quanti) {
    const j = await chiama(k, 'get', `${p}${p.includes('?') ? '&' : '?'}offset=${da}&limit=${quanti}`); if (j?.items?.length) yield j.items;
    if (!j?.items?.length || da + quanti >= Number(j.total || 0)) return;
  }
}
const uguale = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
function importa(k, o) {
  if (o.paymentStatus !== 'PAID') return `ignorato: ${o.paymentStatus}`;
  const p = o.shippingPerson || o.billingPerson || {};
  return importaOrdine(k, { id: o.internalId || o.id, numero: o.id, canale: 'Ecwid',
    cliente: { nome: p.name, email: o.email, telefono: p.phone, via: p.street, cap: p.postalCode, comune: p.city, provincia: p.stateOrProvinceCode },
    // price è il prezzo a pezzo con le opzioni; il coupon assegnato alla riga (couponAmount) si toglie
    linee: (o.items || []).map(x => { const q = Number(x.quantity) || 1; return { sku: x.sku, nome: x.name, q, prezzo: Number(x.price || 0) - Number(x.couponAmount || 0) / q }; }) });
}

export default {
  id: 'ecwid', nome: 'Ecwid', versione: 1, icona: 'scatola',
  descrizione: 'Il negozio Ecwid: catalogo e giacenze in comune, gli ordini pagati diventano vendite.',
  impostazioni: [
    { id: 'negozio', nome: 'Store ID', schema: /^\d{3,12}$/ },
    { id: 'token', nome: 'Secret token (secret_…)', segreto: true },
    { id: 'client_secret', nome: 'Client secret dell\'app (firma i webhook)', segreto: true, obbligatorio: false },
  ],
  richiede: RICHIEDE_NEGOZI,
  permessi: PERMESSI_NEGOZI,
  prova: async k => { const j = await chiama(k, 'get', '/profile'); return { ok: !!j?.generalInfo, messaggio: j?.generalInfo?.storeUrl || null }; },
  mappe: { articoli: { id: 'id', chiave: ['codice', 'sku'], campi: [
    { locale: 'nome', remoto: 'name' }, { locale: 'prezzo', remoto: 'price', da: Number }, { locale: 'giacenza', remoto: 'quantity', comanda: 'locale' },
  ] } },
  pianificati: {
    prodotti: { nome: 'Prodotti dal negozio', ogni: '15m', async giro(k) {
      const tot = { creati: 0, aggiornati: 0, uguali: 0 };
      for await (const l of pagine(k, '/products')) { const r = await k.sincro.daRemoto('articoli', l.filter(p => p.sku)); for (const x in tot) tot[x] += r[x]; }
      return tot;
    } },
    ordini: { nome: 'Ordini dal negozio', ogni: '15m', async giro(k) {
      const da = Number(k.stato.leggi('ordini') || Math.floor(Date.now() / 1000) - 7 * 86400), conti = { vendite: 0, ignorati: 0 }; let ultimo = da;
      for await (const l of pagine(k, `/orders?updatedFrom=${da}&paymentStatus=PAID`)) for (const o of l) {
        ultimo = Math.max(ultimo, Number(o.updateTimestamp) || Math.floor(Date.parse(String(o.updateDate || '').replace(' ', 'T').replace(/ ?([+-]\d{2})(\d{2})$/, '$1:$2')) / 1000) || 0);
        if (importa(k, o) === 'vendita creata') conti.vendite++; else conti.ignorati++;
      }
      k.stato.scrivi('ordini', ultimo);
      return conti;
    } },
  },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const rid = k.sincro.remoto('articoli', riga.id); if (!rid) return;
    await chiama(k, 'put', `/products/${rid}`, { quantity: Math.max(0, Math.round(Number(k.valore(riga, 'articoli', 'giacenza') || 0))), unlimited: false });
  } } },
  entrata: {
    firma: { segreto: 'client_secret', verifica: ({ req, grezzo, segreto }) => {
      let ev; try { ev = JSON.parse(grezzo.toString('utf8')); } catch { return false; }
      return uguale(req.headers['x-ecwid-webhook-signature'], createHmac('sha256', segreto).update(`${ev.eventCreated}.${ev.eventId}`).digest('base64'));
    } },
    idempotenza: ev => ev?.eventId || null,
    async gestisci(ev, k) {
      if (!/^order\.(created|updated)$/.test(ev?.eventType || '') || String(ev.storeId) !== String(k.imp.negozio)) return 'ignorato';
      return importa(k, await chiama(k, 'get', `/orders/${encodeURIComponent(ev.data?.orderId || ev.entityId)}`));
    },
  },
  catalogo: {
    categoria: 'negozi-online', sito: 'https://www.ecwid.com/it', costo: 'abbonamento',
    costoNota: 'Piano Free fino a 5 prodotti; l\'API REST è disponibile dai piani a pagamento (Venture da circa 19 € al mese, Business, Unlimited).',
    serve: [
      { cosa: 'Store ID e Secret token di un\'app personalizzata con gli accessi read_catalog, update_catalog, read_orders, read_store_profile', dove: 'Pannello Ecwid › App › Le mie app › app personalizzata › Dettagli', link: 'https://docs.ecwid.com/develop-apps/app-types/custom-app' },
      { cosa: 'Client secret dell\'app per i webhook, con l\'indirizzo di Lumi come Webhook URL', dove: 'Stessa app › Webhooks (eventi order.created, order.updated)', link: 'https://docs.ecwid.com/develop-apps/webhooks' },
    ],
    passi: [
      'Nel pannello Ecwid apri App › Le mie app e crea un\'app personalizzata (gratuita, solo per il tuo negozio).',
      'Chiedi gli accessi read_catalog, update_catalog, read_orders e read_store_profile, poi installala.',
      'Copia lo Store ID, il Secret token e il Client secret.',
      'Nella sezione Webhooks dell\'app metti l\'indirizzo che Lumi mostra in questa pagina con gli eventi order.created e order.updated.',
      'In Lumi incolla i tre valori, premi «Prova la connessione», accendi e lancia «Prodotti dal negozio».',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://docs.ecwid.com/api-reference/rest-api', 'https://docs.ecwid.com/develop-apps/webhooks', 'https://docs.ecwid.com/api-reference/rest-api/orders/search-orders', 'https://docs.ecwid.com/api-reference/rest-api/products/update-product'],
    prova: 'finto', parole: ['ecwid', 'lightspeed', 'negozio online', 'ecommerce', 'giacenze', 'ordini', 'webhook', 'online store'],
  },
  testi: {
    en: { descrizione: 'The Ecwid store: shared catalogue and stock, paid orders become sales.', 'imp.negozio': 'Store ID', 'imp.token': 'Secret token (secret_…)', 'imp.client_secret': 'App client secret (signs the webhooks)', 'giro.prodotti': 'Products from the store', 'giro.ordini': 'Orders from the store',
      'cat.costoNota': 'Free plan up to 5 products; the REST API is available on paid plans (Venture from about €19 a month, Business, Unlimited).',
      'cat.serve': [{ cosa: 'Store ID and Secret token of a custom app with read_catalog, update_catalog, read_orders, read_store_profile', dove: 'Ecwid admin › Apps › My Apps › custom app › Details' }, { cosa: 'App client secret for the webhooks, with Lumi\'s address as Webhook URL', dove: 'Same app › Webhooks (order.created, order.updated)' }],
      'cat.passi': ['In the Ecwid admin open Apps › My Apps and create a custom app (free, only for your store).', 'Request read_catalog, update_catalog, read_orders and read_store_profile, then install it.', 'Copy the Store ID, the Secret token and the Client secret.', 'In the app Webhooks section enter the address Lumi shows on this page with the order.created and order.updated events.', 'In Lumi paste the three values, press «Test connection», switch on and run «Products from the store».'] },
    es: { descrizione: 'La tienda Ecwid: catálogo y existencias en común, los pedidos pagados pasan a ventas.', 'imp.negozio': 'Store ID', 'imp.token': 'Secret token (secret_…)', 'imp.client_secret': 'Client secret de la app (firma los webhooks)', 'giro.prodotti': 'Productos de la tienda', 'giro.ordini': 'Pedidos de la tienda' },
    fr: { descrizione: 'La boutique Ecwid : catalogue et stock partagés, les commandes payées deviennent des ventes.', 'imp.negozio': 'Store ID', 'imp.token': 'Secret token (secret_…)', 'imp.client_secret': 'Client secret de l\'app (signe les webhooks)', 'giro.prodotti': 'Produits de la boutique', 'giro.ordini': 'Commandes de la boutique' },
    de: { descrizione: 'Der Ecwid-Shop: gemeinsamer Katalog und Bestand, bezahlte Bestellungen werden Verkäufe.', 'imp.negozio': 'Store-ID', 'imp.token': 'Secret Token (secret_…)', 'imp.client_secret': 'Client Secret der App (signiert die Webhooks)', 'giro.prodotti': 'Produkte aus dem Shop', 'giro.ordini': 'Bestellungen aus dem Shop' },
    pt: { descrizione: 'A loja Ecwid: catálogo e estoque em comum, os pedidos pagos viram vendas.', 'imp.negozio': 'Store ID', 'imp.token': 'Secret token (secret_…)', 'imp.client_secret': 'Client secret do app (assina os webhooks)', 'giro.prodotti': 'Produtos da loja', 'giro.ordini': 'Pedidos da loja' },
  },
};
