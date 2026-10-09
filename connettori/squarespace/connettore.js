// Squarespace Commerce: varianti dei prodotti fisici e giacenze nei due sensi, ordini → vendite con il cliente.
// Commerce APIs (https://developers.squarespace.com/commerce-apis/overview): chiave API come Bearer e User-Agent
// obbligatorio; liste a cursore (pagination.nextPageCursor). Ordini con modifiedAfter/modifiedBefore (insieme, e non
// con il cursore). Giacenze: POST /commerce/inventory/adjustments con setFiniteOperations e Idempotency-Key.
// I webhook di Squarespace si abbonano solo con un'app OAuth: con la chiave API gli ordini si leggono ogni 15 minuti.
import { randomUUID } from 'node:crypto';
import { importaOrdine, RICHIEDE_NEGOZI, PERMESSI_NEGOZI } from '../_negozi/comune.js';

const api = (k, p) => `${(k.base || 'https://api.squarespace.com').replace(/\/$/, '')}/1.0${p}`;
const tok = (k, extra = {}) => ({ bearer: k.segreti.chiave, intestazioni: { 'User-Agent': 'Kubo-connettori/1', ...extra } });
const errore = r => new Error(`Squarespace ha risposto ${r.stato}${r.json?.message ? ': ' + r.json.message : ''}`);
async function* pagine(k, p, campo) {
  for (let url = p, n = 0; url && n < 500; n++) {
    const r = await k.http.get(api(k, url), tok(k)); if (!r.ok) throw errore(r);
    if (r.json?.[campo]?.length) yield r.json[campo];
    url = r.json?.pagination?.hasNextPage && r.json.pagination.nextPageCursor ? `${p.split('?')[0]}?cursor=${encodeURIComponent(r.json.pagination.nextPageCursor)}` : null;
  }
}

export default {
  id: 'squarespace', nome: 'Squarespace Commerce', versione: 1, icona: 'scatola',
  descrizione: 'Il negozio Squarespace: varianti e giacenze in comune, gli ordini diventano vendite.',
  impostazioni: [{ id: 'chiave', nome: 'Chiave API (Commerce)', segreto: true, aiuto: 'Impostazioni › Sviluppatore › Chiavi API' }],
  richiede: RICHIEDE_NEGOZI,
  permessi: PERMESSI_NEGOZI,
  prova: async k => { const r = await k.http.get(api(k, '/commerce/inventory'), tok(k)); return { ok: r.ok, messaggio: r.ok ? null : r.stato === 401 ? 'Chiave non valida' : r.stato === 403 ? 'La chiave non ha i permessi di Commerce, o il piano non li include' : `HTTP ${r.stato}` }; },
  mappe: { articoli: { id: 'id', chiave: ['codice', 'sku'], campi: [
    { kubo: 'nome', remoto: 'nome' }, { kubo: 'prezzo', remoto: 'prezzo' }, { kubo: 'giacenza', remoto: 'quantita', comanda: 'kubo' },
  ] } },
  pianificati: {
    prodotti: { nome: 'Prodotti dal negozio', ogni: '15m', async giro(k) {
      const tot = { creati: 0, aggiornati: 0, uguali: 0 };
      for await (const l of pagine(k, '/commerce/products?type=PHYSICAL', 'products')) {
        const varianti = l.flatMap(p => (p.variants || []).filter(v => v.sku).map(v => ({ id: v.id, sku: v.sku, quantita: v.stock?.unlimited ? null : Number(v.stock?.quantity ?? 0),
          nome: [p.name, ...Object.values(v.attributes || {})].join(' ').trim(), prezzo: Number(v.pricing?.onSale ? v.pricing.salePrice?.value : v.pricing?.basePrice?.value) || 0 })));
        const r = await k.sincro.daRemoto('articoli', varianti); for (const x in tot) tot[x] += r[x];
      }
      return tot;
    } },
    ordini: { nome: 'Ordini dal negozio', ogni: '15m', async giro(k) {
      const da = k.stato.leggi('ordini') || new Date(Date.now() - 7 * 864e5).toISOString(), a = new Date().toISOString(), conti = { vendite: 0, ignorati: 0 };
      const primo = `/commerce/orders?modifiedAfter=${encodeURIComponent(da)}&modifiedBefore=${encodeURIComponent(a)}`;
      for await (const l of pagine(k, primo, 'result')) for (const o of l) {
        if (o.fulfillmentStatus === 'CANCELED') { conti.ignorati++; continue; }
        const b = o.shippingAddress || o.billingAddress || {};
        const e = importaOrdine(k, { id: o.id, numero: o.orderNumber, canale: 'Squarespace',
          cliente: { nome: [b.firstName, b.lastName].filter(Boolean).join(' '), email: o.customerEmail, telefono: b.phone, via: [b.address1, b.address2].filter(Boolean).join(' '), cap: b.postalCode, comune: b.city, provincia: b.state },
          linee: (o.lineItems || []).map(x => ({ sku: x.sku, nome: x.productName, q: x.quantity, prezzo: Number(x.unitPricePaid?.value || 0) })) });
        if (e === 'vendita creata') conti.vendite++; else conti.ignorati++;
      }
      k.stato.scrivi('ordini', a);
      return conti;
    } },
  },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const variante = k.sincro.remoto('articoli', riga.id); if (!variante) return;
    const r = await k.http.post(api(k, '/commerce/inventory/adjustments'), { ...tok(k, { 'Idempotency-Key': randomUUID() }),
      json: { setFiniteOperations: [{ variantId: variante, quantity: Math.max(0, Math.round(Number(k.valore(riga, 'articoli', 'giacenza') || 0))) }] } });
    if (!r.ok) throw errore(r);
  } } },
  catalogo: {
    categoria: 'negozi-online', sito: 'https://www.squarespace.com', costo: 'abbonamento',
    costoNota: 'Le API di Commerce (ordini, prodotti, magazzino) sono riservate ai piani con il commercio avanzato (Commerce Advanced, dal 2024 «Advanced»): circa 65–99 € al mese con fatturazione annuale.',
    serve: [
      { cosa: 'Chiave API con i permessi Orders, Products e Inventory (lettura e scrittura)', dove: 'Pannello del sito › Impostazioni › Sviluppatore › Chiavi API › Genera chiave', link: 'https://support.squarespace.com/hc/en-us/articles/236297987-Squarespace-API-keys' },
    ],
    passi: [
      'Nel pannello del sito apri Impostazioni › Sviluppatore › Chiavi API e premi «Genera chiave».',
      'Dai un nome (Kubo) e spunta Orders, Products e Inventory in lettura e scrittura.',
      'Copia la chiave (si vede una volta sola) e incollala in Kubo.',
      'Premi «Prova la connessione», accendi e lancia «Prodotti dal negozio»: ogni variante con SKU diventa un articolo.',
      'Gli ordini arrivano ogni 15 minuti; la giacenza cambiata in Kubo va al sito.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developers.squarespace.com/commerce-apis/overview', 'https://developers.squarespace.com/commerce-apis/retrieve-all-orders', 'https://developers.squarespace.com/commerce-apis/adjust-stock-quantities', 'https://developers.squarespace.com/commerce-apis/retrieve-all-products'],
    prova: 'finto', parole: ['squarespace', 'negozio online', 'ecommerce', 'giacenze', 'ordini', 'inventory', 'orders', 'online store'],
  },
  testi: {
    en: { nome: 'Squarespace Commerce', descrizione: 'The Squarespace store: shared variants and stock, orders become sales.', 'imp.chiave': 'API key (Commerce)', 'aiuto.chiave': 'Settings › Developer › API keys', 'giro.prodotti': 'Products from the store', 'giro.ordini': 'Orders from the store',
      'cat.costoNota': 'The Commerce APIs (orders, products, inventory) are reserved to plans with advanced commerce (Commerce Advanced, «Advanced» since 2024): about €65–99 a month billed annually.',
      'cat.serve': [{ cosa: 'API key with Orders, Products and Inventory (read and write)', dove: 'Site panel › Settings › Developer › API keys › Generate key' }],
      'cat.passi': ['In the site panel open Settings › Developer › API keys and press «Generate key».', 'Name it (Kubo) and tick Orders, Products and Inventory, read and write.', 'Copy the key (shown only once) and paste it into Kubo.', 'Press «Test connection», switch on and run «Products from the store»: every variant with a SKU becomes an item.', 'Orders arrive every 15 minutes; stock changed in Kubo goes to the site.'] },
    es: { nome: 'Squarespace Commerce', descrizione: 'La tienda Squarespace: variantes y existencias en común, los pedidos pasan a ventas.', 'imp.chiave': 'Clave API (Commerce)', 'aiuto.chiave': 'Configuración › Desarrollador › Claves API', 'giro.prodotti': 'Productos de la tienda', 'giro.ordini': 'Pedidos de la tienda' },
    fr: { nome: 'Squarespace Commerce', descrizione: 'La boutique Squarespace : variantes et stock partagés, les commandes deviennent des ventes.', 'imp.chiave': 'Clé API (Commerce)', 'aiuto.chiave': 'Paramètres › Développeur › Clés API', 'giro.prodotti': 'Produits de la boutique', 'giro.ordini': 'Commandes de la boutique' },
    de: { nome: 'Squarespace Commerce', descrizione: 'Der Squarespace-Shop: gemeinsame Varianten und Bestand, Bestellungen werden Verkäufe.', 'imp.chiave': 'API-Schlüssel (Commerce)', 'aiuto.chiave': 'Einstellungen › Entwickler › API-Schlüssel', 'giro.prodotti': 'Produkte aus dem Shop', 'giro.ordini': 'Bestellungen aus dem Shop' },
    pt: { nome: 'Squarespace Commerce', descrizione: 'A loja Squarespace: variantes e estoque em comum, os pedidos viram vendas.', 'imp.chiave': 'Chave de API (Commerce)', 'aiuto.chiave': 'Configurações › Desenvolvedor › Chaves de API', 'giro.prodotti': 'Produtos da loja', 'giro.ordini': 'Pedidos da loja' },
  },
};
