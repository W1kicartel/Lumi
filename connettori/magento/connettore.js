// Magento 2 / Adobe Commerce: articoli e giacenze nei due sensi (MSI: source items della sorgente scelta; senza MSI lo
// stock item classico), ordini pagati → vendite, e la spedizione con il tracking segnata sull'ordine.
// REST (https://developer.adobe.com/commerce/webapi/rest/): token dell'integrazione come Bearer. Dalla 2.4.4 va permesso
// in Negozi › Configurazione › Servizi › OAuth › «Allow OAuth Access Tokens to be used as standalone Bearer tokens».
// Liste con searchCriteria (pageSize, currentPage, filter_groups) e total_count: Magento ripete l'ultima pagina se si va
// oltre, quindi ci si ferma con il totale. Niente webhook nel Magento open source: gli ordini si leggono ogni 10 minuti.
import { importaOrdine, venditaDa, tondo, RICHIEDE_NEGOZI, PERMESSI_NEGOZI } from '../_negozi/comune.js';

const api = (k, p) => `${(k.base || k.imp.url || '').replace(/\/$/, '')}/rest/${k.imp.vista ? encodeURIComponent(k.imp.vista) + '/' : ''}V1${p}`;
const tok = k => ({ bearer: k.segreti.token });
const errore = r => new Error(`Magento ha risposto ${r.stato}${r.json?.message ? ': ' + String(r.json.message).replace(/%(\w+)/g, (_, n) => r.json.parameters?.[n] ?? '') : ''}`);
// searchCriteria come li vuole Magento: filtri in AND (un gruppo per filtro), ordinamento, pagina
function criteri(filtri = [], { pagina = 1, quanti = 100, ordina = null } = {}) {
  const q = new URLSearchParams();
  filtri.forEach(([campo, valore, cond = 'eq'], i) => { const b = `searchCriteria[filter_groups][${i}][filters][0]`; q.set(`${b}[field]`, campo); q.set(`${b}[value]`, valore); q.set(`${b}[condition_type]`, cond); });
  if (ordina) { q.set('searchCriteria[sortOrders][0][field]', ordina); q.set('searchCriteria[sortOrders][0][direction]', 'ASC'); }
  q.set('searchCriteria[pageSize]', quanti); q.set('searchCriteria[currentPage]', pagina);
  return q.toString();
}
async function* tutte(k, p, filtri, opz = {}) {
  const quanti = opz.quanti || 100;
  for (let pagina = 1; pagina < 1e4; pagina++) {
    const r = await k.http.get(`${api(k, p)}?${criteri(filtri, { ...opz, pagina, quanti })}`, tok(k)); if (!r.ok) throw errore(r);
    const l = r.json?.items || []; if (l.length) yield l;
    if (!l.length || pagina * quanti >= Number(r.json?.total_count || 0)) return;
  }
}
const sorgente = k => String(k.imp.sorgente ?? 'default').trim();

export default {
  id: 'magento', nome: 'Magento / Adobe Commerce', versione: 1, icona: 'scatola',
  descrizione: 'Il negozio Magento 2 o Adobe Commerce: catalogo e giacenze in comune, gli ordini pagati diventano vendite.',
  impostazioni: [
    { id: 'url', nome: 'Indirizzo del negozio (https://…)', tipo: 'url' },
    { id: 'token', nome: 'Access token dell\'integrazione', segreto: true, aiuto: 'Sistema › Estensioni › Integrazioni › Aggiungi nuova integrazione › Attiva' },
    { id: 'vista', nome: 'Codice della vista negozio (vuoto = predefinita)', schema: /^[a-z0-9_]*$/ },
    { id: 'sorgente', nome: 'Sorgente MSI (vuoto = magazzino classico)', predefinito: 'default', schema: /^[A-Za-z0-9_-]*$/ },
    { id: 'iva', nome: 'IVA da aggiungere ai prezzi (%, 0 se il catalogo è già ivato)', tipo: 'numero', predefinito: 0 },
  ],
  richiede: RICHIEDE_NEGOZI,
  permessi: PERMESSI_NEGOZI,
  prova: async k => { const r = await k.http.get(api(k, '/store/storeConfigs'), tok(k)); return { ok: r.ok, messaggio: r.ok ? r.json?.[0]?.base_url || null : r.stato === 401 ? 'Token non valido, o token dell\'integrazione non permesso come Bearer (Servizi › OAuth)' : `HTTP ${r.stato}` }; },
  mappe: { articoli: { id: 'sku', chiave: ['codice', 'sku'], campi: [
    { locale: 'nome', remoto: 'name' }, { locale: 'prezzo', remoto: 'prezzo' }, { locale: 'giacenza', remoto: 'quantita', comanda: 'locale' },
  ] } },
  pianificati: {
    prodotti: { nome: 'Prodotti dal negozio', ogni: '15m', async giro(k) {
      const scorte = new Map(), tot = { creati: 0, aggiornati: 0, uguali: 0 };
      if (sorgente(k)) for await (const l of tutte(k, '/inventory/source-items', [['source_code', sorgente(k)]], { quanti: 500 })) for (const s of l) scorte.set(s.sku, Number(s.quantity) || 0);
      // i configurabili non hanno giacenza propria: contano i figli semplici, ognuno con il suo SKU
      for await (const l of tutte(k, '/products', [['type_id', 'simple,virtual', 'in']])) {
        const r = await k.sincro.daRemoto('articoli', l.filter(p => p.sku).map(p => ({ sku: p.sku, name: p.name, prezzo: tondo(Number(p.price || 0) * (1 + Number(k.imp.iva || 0) / 100)),
          quantita: scorte.get(p.sku) ?? Number(p.extension_attributes?.stock_item?.qty ?? 0) })));
        for (const x in tot) tot[x] += r[x];
      }
      return tot;
    } },
    ordini: { nome: 'Ordini dal negozio', ogni: '10m', async giro(k) {
      const da = k.stato.leggi('ordini') || new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
      let ultimo = da; const conti = { vendite: 0, ignorati: 0 };
      for await (const l of tutte(k, '/orders', [['updated_at', da, 'gteq']], { quanti: 50, ordina: 'updated_at' })) for (const o of l) {
        if (o.updated_at > ultimo) ultimo = o.updated_at;
        if (!['processing', 'complete'].includes(o.state)) { conti.ignorati++; continue; }
        const a = o.extension_attributes?.shipping_assignments?.[0]?.shipping?.address || o.billing_address || {};
        // le righe figlie dei configurabili (parent_item_id) ripetono il padre: conta il padre, che ha lo SKU scelto e il prezzo
        const righe = (o.items || []).filter(x => !x.parent_item_id);
        const e = importaOrdine(k, { id: o.entity_id, numero: o.increment_id, canale: 'Magento',
          cliente: { nome: [o.customer_firstname || a.firstname, o.customer_lastname || a.lastname].filter(Boolean).join(' '), email: o.customer_email, telefono: a.telephone, via: (a.street || []).join(' '), cap: a.postcode, comune: a.city, provincia: a.region_code },
          linee: righe.map(x => { const q = Number(x.qty_ordered) || 1; return { sku: x.sku, nome: x.name, q, prezzo: (Number(x.row_total_incl_tax ?? x.price_incl_tax * q) - Number(x.discount_amount || 0)) / q }; }) });
        if (e === 'vendita creata') conti.vendite++; else conti.ignorati++;
      }
      k.stato.scrivi('ordini', ultimo);
      return conti;
    } },
  },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const sku = k.sincro.remoto('articoli', riga.id); if (!sku) return;
    const q = Math.max(0, Number(k.valore(riga, 'articoli', 'giacenza') || 0));
    const r = sorgente(k)
      ? await k.http.post(api(k, '/inventory/source-items'), { ...tok(k), json: { sourceItems: [{ sku, source_code: sorgente(k), quantity: q, status: q > 0 ? 1 : 0 }] } })
      : await k.http.put(api(k, `/products/${encodeURIComponent(sku)}/stockItems/1`), { ...tok(k), json: { stockItem: { qty: q, is_in_stock: q > 0 } } });
    if (!r.ok) throw errore(r);
  } } },
  azioni: {
    spedito: {
      nome: 'Segna spedito su Magento', descrizione: 'crea la spedizione dell\'ordine web con il numero di tracking (il cliente riceve l\'email di Magento)', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, tracking: { tipo: 'testo', nome: 'Numero di tracking' }, corriere: { tipo: 'testo', nome: 'Corriere' } },
      proponi: ({ vendita, tracking, corriere }, k) => { const v = venditaDa(k, vendita), o = k.sincro.remoto('vendite', v.id);
        return { titolo: 'Spedizione su Magento', righe: [['Vendita', v.numero ?? v.id], ['Ordine Magento', o || '—'], ['Tracking', `${corriere || ''} ${tracking}`.trim()]], avvisi: o ? [] : ['Questa vendita non viene da Magento'] }; },
      async esegui({ vendita, tracking, corriere }, k) {
        const v = venditaDa(k, vendita), o = k.sincro.remoto('vendite', v.id); if (!o) throw new Error('Questa vendita non viene da Magento');
        const r = await k.http.post(api(k, `/order/${o}/ship`), { ...tok(k), json: { notify: true, appendComment: true, tracks: [{ track_number: String(tracking), title: corriere || 'Corriere', carrier_code: 'custom' }] } });
        if (!r.ok) throw errore(r);
        return { ok: true, spedizione: r.json };
      },
    },
  },
  catalogo: {
    categoria: 'negozi-online', sito: 'https://business.adobe.com/products/magento/magento-commerce.html', costo: 'gratis',
    costoNota: 'Magento Open Source è gratuito (paghi hosting e manutenzione); Adobe Commerce ha una licenza annuale a preventivo, in base al fatturato.',
    serve: [
      { cosa: 'Access token di un\'integrazione con le risorse Catalogo, Magazzino (Inventory) e Vendite', dove: 'Admin › Sistema › Estensioni › Integrazioni › Aggiungi nuova integrazione › Attiva', link: 'https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/' },
      { cosa: 'Permesso di usare il token come Bearer (Magento 2.4.4 e successivi)', dove: 'Negozi › Configurazione › Servizi › OAuth › Consumer Settings', link: 'https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/#integration-tokens' },
    ],
    passi: [
      'In Magento apri Sistema › Integrazioni › Aggiungi nuova integrazione, dai un nome (Lumi) e la tua password di amministratore.',
      'In «API» scegli le risorse: Catalogo › Prodotti, Negozi › Magazzino (Inventory), Vendite › Ordini e Spedizioni.',
      'Salva, poi «Attiva» e «Consenti»: copia l\'Access Token che compare.',
      'In Negozi › Configurazione › Servizi › OAuth metti «Sì» su «Allow OAuth Access Tokens to be used as standalone Bearer tokens».',
      'In Lumi incolla l\'indirizzo del negozio e il token; lascia la sorgente MSI «default» o svuotala se usi il magazzino classico.',
      'Premi «Prova la connessione», accendi e lancia «Prodotti dal negozio»: gli articoli si abbinano per SKU.',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/', 'https://developer.adobe.com/commerce/webapi/rest/use-rest/performing-searches/', 'https://developer.adobe.com/commerce/webapi/rest/inventory/manage-source-items/', 'https://developer.adobe.com/commerce/webapi/rest/tutorials/orders/order-create-shipment/'],
    prova: 'finto', parole: ['magento', 'adobe commerce', 'negozio online', 'ecommerce', 'msi', 'inventory', 'giacenze', 'ordini', 'spedizione'],
  },
  testi: {
    en: { nome: 'Magento / Adobe Commerce', descrizione: 'The Magento 2 or Adobe Commerce store: shared catalogue and stock, paid orders become sales.', 'imp.url': 'Store address (https://…)', 'imp.token': 'Integration access token', 'aiuto.token': 'System › Extensions › Integrations › Add New Integration › Activate', 'imp.vista': 'Store view code (empty = default)', 'imp.sorgente': 'MSI source (empty = legacy stock)', 'imp.iva': 'VAT to add to prices (%, 0 if the catalogue includes it)', 'az.spedito': 'Mark as shipped on Magento', 'giro.prodotti': 'Products from the store', 'giro.ordini': 'Orders from the store',
      'cat.costoNota': 'Magento Open Source is free (you pay hosting and maintenance); Adobe Commerce has a yearly licence quoted on revenue.',
      'cat.serve': [{ cosa: 'Access token of an integration with the Catalog, Inventory and Sales resources', dove: 'Admin › System › Extensions › Integrations › Add New Integration › Activate' }, { cosa: 'Permission to use the token as a Bearer token (Magento 2.4.4 and later)', dove: 'Stores › Configuration › Services › OAuth › Consumer Settings' }],
      'cat.passi': ['In Magento open System › Integrations › Add New Integration, name it (Lumi) and enter your admin password.', 'Under «API» pick the resources: Catalog › Products, Stores › Inventory, Sales › Orders and Shipments.', 'Save, then «Activate» and «Allow»: copy the Access Token shown.', 'In Stores › Configuration › Services › OAuth set «Allow OAuth Access Tokens to be used as standalone Bearer tokens» to Yes.', 'In Lumi paste the store address and the token; keep the MSI source «default» or empty it for legacy stock.', 'Press «Test connection», switch on and run «Products from the store»: items match by SKU.'] },
    es: { nome: 'Magento / Adobe Commerce', descrizione: 'La tienda Magento 2 o Adobe Commerce: catálogo y existencias en común, los pedidos pagados pasan a ventas.', 'imp.url': 'Dirección de la tienda (https://…)', 'imp.token': 'Access token de la integración', 'aiuto.token': 'Sistema › Extensiones › Integraciones › Añadir › Activar', 'imp.vista': 'Código de la vista de tienda (vacío = predeterminada)', 'imp.sorgente': 'Fuente MSI (vacío = stock clásico)', 'imp.iva': 'IVA que añadir a los precios (%, 0 si el catálogo ya la incluye)', 'az.spedito': 'Marcar como enviado en Magento', 'giro.prodotti': 'Productos de la tienda', 'giro.ordini': 'Pedidos de la tienda' },
    fr: { nome: 'Magento / Adobe Commerce', descrizione: 'La boutique Magento 2 ou Adobe Commerce : catalogue et stock partagés, les commandes payées deviennent des ventes.', 'imp.url': 'Adresse de la boutique (https://…)', 'imp.token': 'Access token de l\'intégration', 'aiuto.token': 'Système › Extensions › Intégrations › Ajouter › Activer', 'imp.vista': 'Code de la vue magasin (vide = par défaut)', 'imp.sorgente': 'Source MSI (vide = stock classique)', 'imp.iva': 'TVA à ajouter aux prix (%, 0 si le catalogue l\'inclut)', 'az.spedito': 'Marquer comme expédié sur Magento', 'giro.prodotti': 'Produits de la boutique', 'giro.ordini': 'Commandes de la boutique' },
    de: { nome: 'Magento / Adobe Commerce', descrizione: 'Der Magento-2- oder Adobe-Commerce-Shop: gemeinsamer Katalog und Bestand, bezahlte Bestellungen werden Verkäufe.', 'imp.url': 'Adresse des Shops (https://…)', 'imp.token': 'Access Token der Integration', 'aiuto.token': 'System › Erweiterungen › Integrationen › Neu › Aktivieren', 'imp.vista': 'Store-View-Code (leer = Standard)', 'imp.sorgente': 'MSI-Quelle (leer = klassischer Bestand)', 'imp.iva': 'MwSt. auf die Preise (%, 0 wenn schon enthalten)', 'az.spedito': 'Auf Magento als versandt markieren', 'giro.prodotti': 'Produkte aus dem Shop', 'giro.ordini': 'Bestellungen aus dem Shop' },
    pt: { nome: 'Magento / Adobe Commerce', descrizione: 'A loja Magento 2 ou Adobe Commerce: catálogo e estoque em comum, os pedidos pagos viram vendas.', 'imp.url': 'Endereço da loja (https://…)', 'imp.token': 'Access token da integração', 'aiuto.token': 'Sistema › Extensões › Integrações › Adicionar › Ativar', 'imp.vista': 'Código da visão de loja (vazio = padrão)', 'imp.sorgente': 'Fonte MSI (vazio = estoque clássico)', 'imp.iva': 'IVA a somar aos preços (%, 0 se o catálogo já inclui)', 'az.spedito': 'Marcar como enviado no Magento', 'giro.prodotti': 'Produtos da loja', 'giro.ordini': 'Pedidos da loja' },
  },
};
