// BigCommerce: varianti (ognuna con il suo SKU) e giacenze nei due sensi, ordini pagati → vendite con il cliente.
// REST (https://developer.bigcommerce.com/docs/start/about): X-Auth-Token dell'account API del negozio; catalogo v3 a
// pagine (meta.pagination.total_pages), ordini v2, giacenze con l'Inventory API (adjustments/absolute, per sede).
// I webhook di BigCommerce non sono firmati (niente HMAC: https://docs.bigcommerce.com/docs/integrations/webhooks): si registrano dall'API con l'indirizzo che porta il codice segreto di Kubo
// (/in/<codice>), e l'ordine si rilegge sempre dall'API prima di crearne la vendita. Un giro ogni 15 minuti fa da rete.
import { importaOrdine, RICHIEDE_NEGOZI, PERMESSI_NEGOZI } from '../_negozi/comune.js';

const api = (k, v, p) => `${(k.base || 'https://api.bigcommerce.com').replace(/\/$/, '')}/stores/${encodeURIComponent(k.imp.negozio || '')}/${v}${p}`;
const tok = k => ({ intestazioni: { 'X-Auth-Token': k.segreti.token } });
const errore = r => new Error(`BigCommerce ha risposto ${r.stato}${r.json?.title ? ': ' + r.json.title : r.json?.[0]?.message ? ': ' + r.json[0].message : ''}`);
async function chiama(k, metodo, v, p, json) { const r = await k.http[metodo](api(k, v, p), { ...tok(k), ...(json ? { json } : {}) }); if (!r.ok) throw errore(r); return r.stato === 204 ? null : r.json; }
// stati pagati: 2 spedito, 3 spedito in parte, 8 in attesa di ritiro, 9 in attesa di spedizione, 10 completato, 11 da evadere
const PAGATI = new Set([2, 3, 8, 9, 10, 11]);
async function ordine(k, id) {
  const o = await chiama(k, 'get', 'v2', `/orders/${id}`); if (!o || !PAGATI.has(Number(o.status_id))) return `ignorato: stato ${o?.status || '?'}`;
  const righe = await chiama(k, 'get', 'v2', `/orders/${id}/products?limit=250`) || [], b = o.billing_address || {};
  return importaOrdine(k, { id: o.id, numero: o.id, canale: 'BigCommerce',
    cliente: { nome: [b.first_name, b.last_name].filter(Boolean).join(' '), email: b.email, telefono: b.phone, via: [b.street_1, b.street_2].filter(Boolean).join(' '), cap: b.zip, comune: b.city },
    // total_inc_tax è la riga ivata; gli sconti applicati alla riga si tolgono
    linee: righe.map(x => { const q = Number(x.quantity) || 1, sconti = (x.applied_discounts || []).reduce((t, d) => t + Number(d.amount || 0), 0); return { sku: x.sku, nome: x.name, q, prezzo: (Number(x.total_inc_tax ?? x.price_inc_tax * q) - sconti) / q }; }) });
}

export default {
  id: 'bigcommerce', nome: 'BigCommerce', versione: 1, icona: 'scatola',
  descrizione: 'Il negozio BigCommerce: varianti e giacenze in comune, gli ordini pagati diventano vendite.',
  impostazioni: [
    { id: 'negozio', nome: 'Store hash (quello in api.bigcommerce.com/stores/…)', schema: /^[a-z0-9]{5,20}$/ },
    { id: 'token', nome: 'Access token dell\'account API', segreto: true },
    { id: 'sede', nome: 'Sede del magazzino (location id)', tipo: 'numero', predefinito: 1 },
    { id: 'codice', nome: 'Codice segreto dei webhook', segreto: true, generato: true },
  ],
  richiede: RICHIEDE_NEGOZI,
  permessi: PERMESSI_NEGOZI,
  prova: async k => { const j = await chiama(k, 'get', 'v2', '/store'); return { ok: !!j?.id, messaggio: j?.name || null }; },
  mappe: { articoli: { id: 'id', chiave: ['codice', 'sku'], campi: [
    { kubo: 'nome', remoto: 'nome' }, { kubo: 'prezzo', remoto: 'prezzo' }, { kubo: 'giacenza', remoto: 'inventory_level', comanda: 'kubo' },
  ] } },
  pianificati: {
    prodotti: { nome: 'Prodotti dal negozio', ogni: '15m', async giro(k) {
      const tot = { creati: 0, aggiornati: 0, uguali: 0 };
      for (let p = 1, fine = 1; p <= fine && p < 1000; p++) {
        const j = await chiama(k, 'get', 'v3', `/catalog/products?include=variants&limit=250&page=${p}`); fine = Number(j?.meta?.pagination?.total_pages || 1);
        const varianti = (j?.data || []).flatMap(x => (x.variants || []).filter(v => v.sku).map(v => ({ id: `${x.id}:${v.id}`, sku: v.sku, inventory_level: v.inventory_level,
          nome: (x.variants.length > 1 ? `${x.name} ${(v.option_values || []).map(o => o.label).join(' ')}` : x.name).trim(), prezzo: Number(v.calculated_price ?? v.price ?? x.price) })));
        const r = await k.sincro.daRemoto('articoli', varianti); for (const x in tot) tot[x] += r[x];
      }
      return tot;
    } },
    ordini: { nome: 'Ordini dal negozio', ogni: '15m', async giro(k) {
      const da = k.stato.leggi('ordini') || new Date(Date.now() - 7 * 864e5).toISOString(), conti = { vendite: 0, ignorati: 0 }; let ultimo = da;
      for (let p = 1; p < 200; p++) {
        const l = await chiama(k, 'get', 'v2', `/orders?min_date_modified=${encodeURIComponent(da)}&sort=date_modified:asc&limit=50&page=${p}`) || [];
        for (const o of l) { const m = new Date(o.date_modified).toISOString(); if (m > ultimo) ultimo = m; if (await ordine(k, o.id) === 'vendita creata') conti.vendite++; else conti.ignorati++; }
        if (l.length < 50) break;
      }
      k.stato.scrivi('ordini', ultimo);
      return conti;
    } },
  },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const rid = k.sincro.remoto('articoli', riga.id); if (!rid) return;
    const variante = Number(String(rid).split(':')[1]);
    await chiama(k, 'put', 'v3', '/inventory/adjustments/absolute', { reason: 'Kubo', items: [{ location_id: Number(k.imp.sede || 1), variant_id: variante, quantity: Math.max(0, Math.round(Number(k.valore(riga, 'articoli', 'giacenza') || 0))) }] });
  } } },
  azioni: {
    webhook: {
      nome: 'Registra i webhook degli ordini', descrizione: 'chiede a BigCommerce di avvisare Kubo a ogni ordine creato o cambiato',
      input: { indirizzo: { tipo: 'testo', nome: 'Indirizzo pubblico di Kubo (https://…)' } },
      async esegui({ indirizzo }, k) {
        const base = String(indirizzo || '').replace(/\/$/, ''); if (!/^https:\/\/[^/]+/.test(base)) throw new Error('Serve un indirizzo pubblico https');
        const dest = `${base}/api/connettori/bigcommerce/in/${k.segreti.codice}`, fatti = [];
        for (const scope of ['store/order/created', 'store/order/statusUpdated']) fatti.push((await chiama(k, 'post', 'v3', '/hooks', { scope, destination: dest, is_active: true }))?.data?.id);
        return { ok: true, webhook: fatti };
      },
    },
  },
  entrata: {
    firma: { tipo: 'token', segreto: 'codice' },
    idempotenza: ev => (ev?.data?.id ? `ordine:${ev.data.id}:${ev.data.status?.new_status_id ?? ev.scope}` : null),
    async gestisci(ev, k) {
      if (!/^store\/order\//.test(ev?.scope || '') || !ev.data?.id) return 'ignorato';
      return ordine(k, ev.data.id);   // il webhook non è firmato: si rilegge l'ordine dall'API
    },
  },
  catalogo: {
    categoria: 'negozi-online', sito: 'https://www.bigcommerce.com', costo: 'abbonamento',
    costoNota: 'Piani da 29 $ al mese (Standard, fatturato annuale) a 299 $ (Pro); l\'API è inclusa in tutti i piani.',
    serve: [
      { cosa: 'Account API del negozio (V2/V3) con Products, Orders e Information & Settings in lettura e scrittura: Access token e store hash', dove: 'Pannello › Settings › Store-level API accounts › Create API account', link: 'https://support.bigcommerce.com/s/article/Store-API-Accounts' },
    ],
    passi: [
      'Nel pannello di BigCommerce apri Settings › Store-level API accounts › Create API account (tipo V2/V3).',
      'Dai i permessi Products modify, Orders modify, Information & Settings read-only e Store inventory modify.',
      'Salva: copia l\'Access token; lo store hash è la parte dopo /stores/ nell\'API path.',
      'In Kubo incolla store hash e token, premi «Prova la connessione» e accendi.',
      'Premi «Registra i webhook degli ordini» con l\'indirizzo pubblico di Kubo: gli ordini arrivano subito (senza, arrivano ogni 15 minuti).',
      'Lancia «Prodotti dal negozio»: ogni variante con SKU diventa un articolo.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developer.bigcommerce.com/docs/start/authentication/api-accounts', 'https://developer.bigcommerce.com/docs/rest-catalog/products', 'https://developer.bigcommerce.com/docs/rest-management/inventory/adjustments', 'https://developer.bigcommerce.com/docs/integrations/webhooks'],
    prova: 'finto', parole: ['bigcommerce', 'negozio online', 'ecommerce', 'varianti', 'giacenze', 'ordini', 'webhook', 'online store'],
  },
  testi: {
    en: { descrizione: 'The BigCommerce store: shared variants and stock, paid orders become sales.', 'imp.negozio': 'Store hash (the one in api.bigcommerce.com/stores/…)', 'imp.token': 'API account access token', 'imp.sede': 'Inventory location (location id)', 'imp.codice': 'Webhook secret code', 'az.webhook': 'Register the order webhooks', 'giro.prodotti': 'Products from the store', 'giro.ordini': 'Orders from the store',
      'cat.costoNota': 'Plans from $29 a month (Standard, billed annually) to $299 (Pro); the API is included in every plan.',
      'cat.serve': [{ cosa: 'Store API account (V2/V3) with Products, Orders and Information & Settings: Access token and store hash', dove: 'Control panel › Settings › Store-level API accounts › Create API account' }],
      'cat.passi': ['In the BigCommerce control panel open Settings › Store-level API accounts › Create API account (V2/V3).', 'Grant Products modify, Orders modify, Information & Settings read-only and Store inventory modify.', 'Save: copy the Access token; the store hash is the part after /stores/ in the API path.', 'In Kubo paste store hash and token, press «Test connection» and switch on.', 'Press «Register the order webhooks» with Kubo\'s public address: orders arrive at once (without it, every 15 minutes).', 'Run «Products from the store»: every variant with a SKU becomes an item.'] },
    es: { descrizione: 'La tienda BigCommerce: variantes y existencias en común, los pedidos pagados pasan a ventas.', 'imp.negozio': 'Store hash', 'imp.token': 'Access token de la cuenta API', 'imp.sede': 'Ubicación del almacén (location id)', 'imp.codice': 'Código secreto de los webhooks', 'az.webhook': 'Registrar los webhooks de pedidos', 'giro.prodotti': 'Productos de la tienda', 'giro.ordini': 'Pedidos de la tienda' },
    fr: { descrizione: 'La boutique BigCommerce : variantes et stock partagés, les commandes payées deviennent des ventes.', 'imp.negozio': 'Store hash', 'imp.token': 'Access token du compte API', 'imp.sede': 'Emplacement du stock (location id)', 'imp.codice': 'Code secret des webhooks', 'az.webhook': 'Enregistrer les webhooks des commandes', 'giro.prodotti': 'Produits de la boutique', 'giro.ordini': 'Commandes de la boutique' },
    de: { descrizione: 'Der BigCommerce-Shop: gemeinsame Varianten und Bestand, bezahlte Bestellungen werden Verkäufe.', 'imp.negozio': 'Store-Hash', 'imp.token': 'Access Token des API-Kontos', 'imp.sede': 'Lagerort (Location-ID)', 'imp.codice': 'Geheimer Webhook-Code', 'az.webhook': 'Bestell-Webhooks registrieren', 'giro.prodotti': 'Produkte aus dem Shop', 'giro.ordini': 'Bestellungen aus dem Shop' },
    pt: { descrizione: 'A loja BigCommerce: variantes e estoque em comum, os pedidos pagos viram vendas.', 'imp.negozio': 'Store hash', 'imp.token': 'Access token da conta API', 'imp.sede': 'Local do estoque (location id)', 'imp.codice': 'Código secreto dos webhooks', 'az.webhook': 'Registrar os webhooks de pedidos', 'giro.prodotti': 'Produtos da loja', 'giro.ordini': 'Pedidos da loja' },
  },
};
