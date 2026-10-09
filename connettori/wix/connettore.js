// Wix Stores / Wix eCommerce: gli ordini pagati del sito → vendite con il cliente.
// REST con una chiave API dell'account (Authorization: <chiave>) e l'id del sito (wix-site-id), solo dal server
// (https://dev.wix.com/docs/rest/articles/getting-started/api-keys). Ordini: POST /ecom/v1/orders/search con filtro su
// paymentStatus e updatedDate e cursorPaging (100 al massimo) (https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/search-orders).
// La giacenza verso Wix non c'è ancora: i siti nuovi usano il Catalog V3 (inventory-items con revision), quelli vecchi il V1,
// e i webhook sono riservati alle app Wix (JWT firmati con la chiave dell'app): qui gli ordini si leggono ogni 15 minuti.
import { importaOrdine, RICHIEDE_NEGOZI } from '../_negozi/comune.js';

const api = (k, p) => `${(k.base || 'https://www.wixapis.com').replace(/\/$/, '')}${p}`;
const tok = k => ({ intestazioni: { Authorization: k.segreti.chiave, 'wix-site-id': k.imp.sito } });
const errore = r => new Error(`Wix ha risposto ${r.stato}${r.json?.message ? ': ' + r.json.message : ''}`);

export default {
  id: 'wix', nome: 'Wix Stores', versione: 1, icona: 'scatola',
  descrizione: 'Il negozio Wix: gli ordini pagati del sito diventano vendite, con il cliente.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API dell\'account Wix', segreto: true, aiuto: 'manage.wix.com › Impostazioni dell\'account › Chiavi API' },
    { id: 'sito', nome: 'ID del sito (wix-site-id)', schema: /^[0-9a-f-]{36}$/, aiuto: 'Il codice dopo /dashboard/ nell\'indirizzo del pannello del sito' },
  ],
  richiede: RICHIEDE_NEGOZI,
  permessi: { articoli: { leggi: true }, vendite: { leggi: true, crea: true }, clienti: { leggi: true, crea: true } },
  prova: async k => { const r = await k.http.post(api(k, '/ecom/v1/orders/search'), { ...tok(k), json: { search: { cursorPaging: { limit: 1 } } } });
    return { ok: r.ok, messaggio: r.ok ? null : r.stato === 403 ? 'La chiave non ha il permesso sugli ordini (Wix eCommerce) o l\'id del sito è sbagliato' : `HTTP ${r.stato}` }; },
  pianificati: { ordini: { nome: 'Ordini dal sito', ogni: '15m', async giro(k) {
    const da = k.stato.leggi('ordini') || new Date(Date.now() - 7 * 864e5).toISOString(), conti = { vendite: 0, ignorati: 0 }; let ultimo = da;
    for (let cursore = null, n = 0; n < 200; n++) {
      const search = cursore ? { cursorPaging: { limit: 100, cursor: cursore } }
        : { filter: { paymentStatus: 'PAID', updatedDate: { $gte: da } }, sort: [{ fieldName: 'updatedDate', order: 'ASC' }], cursorPaging: { limit: 100 } };
      const r = await k.http.post(api(k, '/ecom/v1/orders/search'), { ...tok(k), json: { search } }); if (!r.ok) throw errore(r);
      for (const o of r.json?.orders || []) {
        if (o.updatedDate > ultimo) ultimo = o.updatedDate;
        if (o.status === 'CANCELED') { conti.ignorati++; continue; }
        const a = o.shippingInfo?.logistics?.shippingDestination?.address || o.billingInfo?.address || {}, c = o.billingInfo?.contactDetails || {};
        const e = importaOrdine(k, { id: o.id, numero: o.number, canale: 'Wix',
          cliente: { nome: [c.firstName, c.lastName].filter(Boolean).join(' '), email: o.buyerInfo?.email, telefono: c.phone, via: [a.addressLine, a.addressLine2].filter(Boolean).join(' '), cap: a.postalCode, comune: a.city, provincia: String(a.subdivision || '').replace(/^IT-/, '') },
          // totalPriceAfterTax è la riga con l'IVA e dopo gli sconti; price è il prezzo a pezzo
          linee: (o.lineItems || []).map(x => { const q = Number(x.quantity) || 1; return { sku: x.physicalProperties?.sku, nome: x.productName?.original, q, prezzo: x.totalPriceAfterTax?.amount != null ? Number(x.totalPriceAfterTax.amount) / q : Number(x.price?.amount || 0) }; }) });
        if (e === 'vendita creata') conti.vendite++; else conti.ignorati++;
      }
      cursore = r.json?.metadata?.hasNext ? r.json.metadata.cursors?.next : null; if (!cursore) break;
    }
    k.stato.scrivi('ordini', ultimo);
    return conti;
  } } },
  catalogo: {
    categoria: 'negozi-online', sito: 'https://www.wix.com/ecommerce', costo: 'abbonamento',
    costoNota: 'Per vendere su Wix serve un piano Business (in Italia da circa 26 € al mese con fatturazione annuale). Le chiavi API sono gratuite.',
    serve: [
      { cosa: 'Chiave API dell\'account con il permesso «Wix eCommerce › Read Orders» (o Manage Orders) sul sito', dove: 'manage.wix.com › Impostazioni account › Chiavi API › Genera chiave API', link: 'https://dev.wix.com/docs/rest/articles/getting-started/api-keys' },
      { cosa: 'ID del sito', dove: 'Pannello del sito: il codice dopo /dashboard/ nell\'indirizzo', link: 'https://dev.wix.com/docs/rest/articles/getting-started/api-keys' },
    ],
    passi: [
      'Da manage.wix.com apri le Chiavi API dell\'account e premi «Genera chiave API».',
      'Scegli il sito del negozio e dai il permesso sugli ordini di Wix eCommerce (lettura).',
      'Copia la chiave (si vede una volta sola) e l\'ID del sito (nell\'indirizzo del pannello, dopo /dashboard/).',
      'In Kubo incolla chiave e ID, premi «Prova la connessione» e accendi: gli ordini pagati arrivano ogni 15 minuti.',
      'Gli articoli si abbinano per SKU: dai lo stesso codice ai prodotti di Wix e agli articoli di Kubo.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://dev.wix.com/docs/rest/articles/getting-started/api-keys', 'https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/search-orders', 'https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-update-inventory-items'],
    prova: 'finto', parole: ['wix', 'wix stores', 'wix ecommerce', 'negozio online', 'sito', 'ordini', 'orders', 'online store'],
  },
  testi: {
    en: { descrizione: 'The Wix store: paid website orders become sales, with the customer.', 'imp.chiave': 'Wix account API key', 'aiuto.chiave': 'manage.wix.com › Account settings › API keys', 'imp.sito': 'Site ID (wix-site-id)', 'aiuto.sito': 'The code after /dashboard/ in the site dashboard address', 'giro.ordini': 'Orders from the website',
      'cat.costoNota': 'Selling on Wix needs a Business plan (in Italy from about €26 a month billed annually). API keys are free.',
      'cat.serve': [{ cosa: 'Account API key with «Wix eCommerce › Read Orders» (or Manage Orders) on the site', dove: 'manage.wix.com › Account settings › API keys › Generate API key' }, { cosa: 'Site ID', dove: 'Site dashboard: the code after /dashboard/ in the address' }],
      'cat.passi': ['From manage.wix.com open the account API keys and press «Generate API key».', 'Pick the store site and grant Wix eCommerce orders permission (read).', 'Copy the key (shown only once) and the site ID (in the dashboard address, after /dashboard/).', 'In Kubo paste key and ID, press «Test connection» and switch on: paid orders arrive every 15 minutes.', 'Items match by SKU: give Wix products and Kubo items the same code.'] },
    es: { descrizione: 'La tienda Wix: los pedidos pagados de la web pasan a ventas, con el cliente.', 'imp.chiave': 'Clave API de la cuenta Wix', 'aiuto.chiave': 'manage.wix.com › Configuración de la cuenta › Claves API', 'imp.sito': 'ID del sitio (wix-site-id)', 'aiuto.sito': 'El código tras /dashboard/ en la dirección del panel', 'giro.ordini': 'Pedidos de la web' },
    fr: { descrizione: 'La boutique Wix : les commandes payées du site deviennent des ventes, avec le client.', 'imp.chiave': 'Clé API du compte Wix', 'aiuto.chiave': 'manage.wix.com › Paramètres du compte › Clés API', 'imp.sito': 'ID du site (wix-site-id)', 'aiuto.sito': 'Le code après /dashboard/ dans l\'adresse du tableau de bord', 'giro.ordini': 'Commandes du site' },
    de: { descrizione: 'Der Wix-Shop: bezahlte Bestellungen der Website werden Verkäufe, mit Kunde.', 'imp.chiave': 'API-Schlüssel des Wix-Kontos', 'aiuto.chiave': 'manage.wix.com › Kontoeinstellungen › API-Schlüssel', 'imp.sito': 'Website-ID (wix-site-id)', 'aiuto.sito': 'Der Code nach /dashboard/ in der Adresse der Verwaltung', 'giro.ordini': 'Bestellungen der Website' },
    pt: { descrizione: 'A loja Wix: os pedidos pagos do site viram vendas, com o cliente.', 'imp.chiave': 'Chave de API da conta Wix', 'aiuto.chiave': 'manage.wix.com › Configurações da conta › Chaves de API', 'imp.sito': 'ID do site (wix-site-id)', 'aiuto.sito': 'O código depois de /dashboard/ no endereço do painel', 'giro.ordini': 'Pedidos do site' },
  },
};
