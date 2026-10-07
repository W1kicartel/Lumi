// Shopify: come WooCommerce, con l'Admin GraphQL. Dal 1° gennaio 2026 non si creano più le «custom app» legacy: l'app si
// crea nel Dev Dashboard e il token si ottiene con client credentials, dura 24 ore e il nucleo lo rinnova da solo
// (https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant).
// Webhook firmati con X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256 del corpo, client secret dell'app).
// Giacenze: inventorySetQuantities con changeFromQuantity: null e @idempotent, obbligatori dalla versione 2026-04
// (https://shopify.dev/changelog/finalizing-compare-and-swap-redesign-for-inventory-set-quantities).
import { randomUUID } from 'node:crypto';
const negozio = k => (k.base || `https://${String(k.imp.negozio || '').replace(/\.myshopify\.com$/, '')}.myshopify.com`).replace(/\/$/, '');
async function gql(k, query, variables = {}) {
  const r = await k.http.post(`${negozio(k)}/admin/api/${k.imp.versione}/graphql.json`, { intestazioni: { 'X-Shopify-Access-Token': await k.oauth.token() }, json: { query, variables } });
  if (!r.ok || r.json?.errors) throw new Error(`Shopify ha risposto ${r.stato}${r.json?.errors ? ': ' + JSON.stringify(r.json.errors).slice(0, 200) : ''}`);
  return r.json.data;
}
const VARIANTI = `query($dopo: String) { productVariants(first: 100, after: $dopo) { nodes { id sku price inventoryQuantity product { title } } pageInfo { hasNextPage endCursor } } }`;
export default {
  id: 'shopify', nome: 'Shopify', versione: 1, icona: 'scatola',
  descrizione: 'Il negozio Shopify: catalogo e giacenze in comune, gli ordini diventano vendite.',
  impostazioni: [
    { id: 'negozio', nome: 'Nome del negozio (….myshopify.com)', schema: /^[a-z0-9][a-z0-9-]*(\.myshopify\.com)?$/ },
    { id: 'versione', nome: 'Versione dell\'API', predefinito: '2026-07', schema: /^\d{4}-\d{2}$/ },
    { id: 'posizione', nome: 'Magazzino (gid://shopify/Location/…)', schema: /^gid:\/\/shopify\/Location\/\d+$/ },
    { id: 'client_id', nome: 'Client ID dell\'app (Dev Dashboard)', segreto: true }, { id: 'client_secret', nome: 'Client secret dell\'app', segreto: true },
  ],
  oauth: { tipo: 'client', token: k => `${negozio(k)}/admin/oauth/access_token` },
  richiede: { articoli: { codice: { tipo: 'testo', alias: ['sku'] }, nome: { tipo: 'testo' }, prezzo: { tipo: 'valuta' }, giacenza: { tipo: 'numero' } },
    vendite: { stato: { tipo: 'stato' }, righe: { tipo: 'righe' } } },
  permessi: { articoli: { leggi: true, crea: true, modifica: true }, vendite: { leggi: true, crea: true } },
  prova: async k => { const d = await gql(k, '{ shop { name } }'); return { ok: !!d?.shop, messaggio: d?.shop?.name || null }; },
  mappe: { articoli: { id: 'id', chiave: ['codice', 'sku'], campi: [
    { kubo: 'nome', remoto: 'product.title' }, { kubo: 'prezzo', remoto: 'price', da: Number }, { kubo: 'giacenza', remoto: 'inventoryQuantity', comanda: 'kubo' },
  ] } },
  pianificati: { prodotti: { nome: 'Prodotti dal negozio', ogni: '15m', async giro(k) {
    const tot = { creati: 0, aggiornati: 0, uguali: 0 };
    for (let dopo = null, n = 0; n < 500; n++) {
      const v = (await gql(k, VARIANTI, { dopo })).productVariants;
      const r = await k.sincro.daRemoto('articoli', v.nodes.filter(x => x.sku)); for (const x in tot) tot[x] += r[x];
      if (!v.pageInfo.hasNextPage) break; dopo = v.pageInfo.endCursor;
    }
    return tot;
  } } },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const rid = k.sincro.remoto('articoli', riga.id); if (!rid) return;
    if (!k.imp.posizione) throw new Error('Manca il magazzino Shopify nelle impostazioni');
    const it = (await gql(k, 'query($id: ID!) { productVariant(id: $id) { inventoryItem { id } } }', { id: rid })).productVariant?.inventoryItem?.id;
    if (!it) throw new Error(`Variante ${rid} sparita da Shopify`);
    const d = await gql(k, `mutation($input: InventorySetQuantitiesInput!, $chiave: String!) { inventorySetQuantities(input: $input) @idempotent(key: $chiave) { userErrors { field message } } }`,
      { chiave: randomUUID(), input: { name: 'available', reason: 'correction', quantities: [{ inventoryItemId: it, locationId: k.imp.posizione, quantity: Number(k.valore(riga, 'articoli', 'giacenza') || 0), changeFromQuantity: null }] } });
    const e = d.inventorySetQuantities.userErrors; if (e.length) throw new Error(e.map(x => x.message).join('; '));
  } } },
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'x-shopify-hmac-sha256', segreto: 'client_secret', formato: 'base64' },
    idempotenza: (ev, req) => req.headers['x-shopify-webhook-id'] || (ev?.id ? `ordine:${ev.id}` : null),
    async gestisci(o, k, { req }) {
      if (!/^orders\/(create|paid)$/.test(req.headers['x-shopify-topic'] || '') || !Array.isArray(o?.line_items)) return 'ignorato';
      if (o.financial_status !== 'paid' || k.sincro.locale('vendite', o.id)) return 'ignorato: ' + o.financial_status;
      const righe = [];
      for (const l of o.line_items) {
        const a = l.sku ? k.dati.trova('articoli', 'codice', l.sku) : null;
        if (!a) return k.avvisa(`ordine ${o.name || o.id}: articolo ${l.sku || l.title} sconosciuto`);
        // «price» è prima degli sconti, e senza IVA se il negozio non la include nei prezzi: la vendita porta il pagato davvero
        const q = Number(l.quantity) || 1, somma = xs => (xs || []).reduce((t, x) => t + Number(x.amount ?? x.price ?? 0), 0);
        const lordo = Number(l.price) * q - somma(l.discount_allocations) + (o.taxes_included ? 0 : somma(l.tax_lines));
        righe.push({ articolo: a.id, quantita: q, prezzo: Math.round(lordo / q * 100) / 100 });
      }
      const v = k.dati.crea('vendite', { stato: 'pagata', righe }); k.sincro.collega('vendite', v.id, o.id);
      return 'vendita creata';
    },
  },
  testi: {
    en: { descrizione: 'The Shopify store: shared catalogue and stock, orders become sales.', 'imp.negozio': 'Store name (….myshopify.com)', 'imp.versione': 'API version', 'imp.posizione': 'Location (gid://shopify/Location/…)', 'imp.client_id': 'App client ID (Dev Dashboard)', 'imp.client_secret': 'App client secret', 'giro.prodotti': 'Products from the store' },
    es: { descrizione: 'La tienda Shopify: catálogo y existencias en común, los pedidos pasan a ventas.', 'imp.negozio': 'Nombre de la tienda (….myshopify.com)', 'imp.versione': 'Versión de la API', 'imp.posizione': 'Almacén (gid://shopify/Location/…)', 'imp.client_id': 'Client ID de la app (Dev Dashboard)', 'imp.client_secret': 'Client secret de la app', 'giro.prodotti': 'Productos de la tienda' },
    fr: { descrizione: 'La boutique Shopify : catalogue et stock partagés, les commandes deviennent des ventes.', 'imp.negozio': 'Nom de la boutique (….myshopify.com)', 'imp.versione': 'Version de l\'API', 'imp.posizione': 'Entrepôt (gid://shopify/Location/…)', 'imp.client_id': 'Client ID de l\'app (Dev Dashboard)', 'imp.client_secret': 'Client secret de l\'app', 'giro.prodotti': 'Produits de la boutique' },
    de: { descrizione: 'Der Shopify-Shop: gemeinsamer Katalog und Bestand, Bestellungen werden Verkäufe.', 'imp.negozio': 'Name des Shops (….myshopify.com)', 'imp.versione': 'API-Version', 'imp.posizione': 'Lager (gid://shopify/Location/…)', 'imp.client_id': 'Client-ID der App (Dev Dashboard)', 'imp.client_secret': 'Client-Secret der App', 'giro.prodotti': 'Produkte aus dem Shop' },
    pt: { descrizione: 'A loja Shopify: catálogo e estoque em comum, os pedidos viram vendas.', 'imp.negozio': 'Nome da loja (….myshopify.com)', 'imp.versione': 'Versão da API', 'imp.posizione': 'Estoque (gid://shopify/Location/…)', 'imp.client_id': 'Client ID do app (Dev Dashboard)', 'imp.client_secret': 'Client secret do app', 'giro.prodotti': 'Produtos da loja' },
  },
};
