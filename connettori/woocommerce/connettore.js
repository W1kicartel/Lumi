// WooCommerce: articoli e giacenze nei due sensi, ordini del sito → vendite di Kubo.
// API REST wc/v3 con le chiavi consumer (Basic su HTTPS), pagine con X-WP-TotalPages; webhook firmati con
// X-WC-Webhook-Signature = base64(HMAC-SHA256 del corpo) (https://woocommerce.github.io/woocommerce-rest-api-docs/#webhooks).
// Il sito comanda nome e prezzo, Kubo comanda la giacenza (la cassa scala il magazzino): la giacenza va al sito in coda,
// e solo l'ultima conta. Quello che arriva dal sito non torna indietro (anti-eco del nucleo).
const api = (k, p) => `${(k.base || k.imp.url || '').replace(/\/$/, '')}/wp-json/wc/v3${p}`;
const chiavi = k => ({ basic: [k.segreti.ck, k.segreti.cs] });
export default {
  id: 'woocommerce', nome: 'WooCommerce', versione: 1, icona: 'scatola',
  descrizione: 'Il negozio online: catalogo e giacenze in comune, gli ordini del sito diventano vendite.',
  impostazioni: [
    { id: 'url', nome: 'Indirizzo del sito (https://…)', tipo: 'url' },
    { id: 'ck', nome: 'Consumer key (ck_…)', segreto: true }, { id: 'cs', nome: 'Consumer secret (cs_…)', segreto: true },
    { id: 'webhook', nome: 'Segreto dei webhook', segreto: true },
  ],
  richiede: { articoli: { codice: { tipo: 'testo', alias: ['sku'] }, nome: { tipo: 'testo' }, prezzo: { tipo: 'valuta' }, giacenza: { tipo: 'numero' } },
    vendite: { stato: { tipo: 'stato' }, righe: { tipo: 'righe' } } },
  permessi: { articoli: { leggi: true, crea: true, modifica: true }, vendite: { leggi: true, crea: true } },
  prova: async k => { const r = await k.http.get(api(k, '/system_status'), chiavi(k)); return { ok: r.ok, messaggio: r.ok ? null : r.json?.message || `HTTP ${r.stato}` }; },
  mappe: { articoli: { id: 'id', chiave: ['codice', 'sku'], campi: [
    { kubo: 'nome', remoto: 'name' }, { kubo: 'prezzo', remoto: 'regular_price', da: Number },
    { kubo: 'giacenza', remoto: 'stock_quantity', comanda: 'kubo' },
  ] } },
  pianificati: { prodotti: { nome: 'Prodotti dal sito', ogni: '15m', async giro(k) {
    const tot = { creati: 0, aggiornati: 0, uguali: 0 };
    for await (const pagina of k.http.pagine(api(k, '/products?per_page=100'), { ...chiavi(k), totale: 'x-wp-totalpages' })) {
      const r = await k.sincro.daRemoto('articoli', pagina.filter(p => p.sku)); for (const x in tot) tot[x] += r[x];
    }
    return tot;
  } } },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const rid = k.sincro.remoto('articoli', riga.id); if (!rid) return;   // un articolo che il sito non ha
    const r = await k.http.put(api(k, `/products/${rid}`), { ...chiavi(k), json: { manage_stock: true, stock_quantity: Number(k.valore(riga, 'articoli', 'giacenza') || 0) } });
    if (!r.ok) throw new Error(`WooCommerce ha risposto ${r.stato}`);
  } } },
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'x-wc-webhook-signature', segreto: 'webhook', formato: 'base64' },
    idempotenza: (ev, req) => req.headers['x-wc-webhook-delivery-id'] || (ev?.id ? `ordine:${ev.id}:${ev.status}` : null),
    async gestisci(o, k) {
      if (!o?.id || !Array.isArray(o.line_items)) return 'ignorato';   // anche il «ping» alla creazione del webhook
      if (!['processing', 'completed'].includes(o.status) || k.sincro.locale('vendite', o.id)) return 'ignorato: ' + o.status;
      const righe = [];
      for (const l of o.line_items) {
        const a = l.sku ? k.dati.trova('articoli', 'codice', l.sku) : null;
        if (!a) return k.avvisa(`ordine ${o.number || o.id}: articolo ${l.sku || l.name} sconosciuto`);
        // «price» è senza IVA e prima degli sconti: la vendita porta quello che il cliente ha pagato davvero (totale della riga + IVA)
        const q = Number(l.quantity) || 1, lordo = Number(l.total ?? l.price * q) + Number(l.total_tax || 0);
        righe.push({ articolo: a.id, quantita: q, prezzo: Math.round(lordo / q * 100) / 100 });
      }
      const v = k.dati.crea('vendite', { stato: 'pagata', righe });
      k.sincro.collega('vendite', v.id, o.id);
      return 'vendita creata';
    },
  },
  testi: {
    en: { descrizione: 'The online shop: shared catalogue and stock, website orders become sales.', 'imp.url': 'Website address (https://…)', 'imp.webhook': 'Webhook secret', 'giro.prodotti': 'Products from the website' },
    es: { descrizione: 'La tienda online: catálogo y existencias en común, los pedidos de la web pasan a ventas.', 'imp.url': 'Dirección del sitio (https://…)', 'imp.webhook': 'Secreto de los webhooks', 'giro.prodotti': 'Productos de la web' },
    fr: { descrizione: 'La boutique en ligne : catalogue et stock partagés, les commandes du site deviennent des ventes.', 'imp.url': 'Adresse du site (https://…)', 'imp.webhook': 'Secret des webhooks', 'giro.prodotti': 'Produits du site' },
    de: { descrizione: 'Der Onlineshop: gemeinsamer Katalog und Bestand, Bestellungen der Website werden Verkäufe.', 'imp.url': 'Adresse der Website (https://…)', 'imp.webhook': 'Webhook-Geheimnis', 'giro.prodotti': 'Produkte von der Website' },
    pt: { descrizione: 'A loja online: catálogo e estoque em comum, os pedidos do site viram vendas.', 'imp.url': 'Endereço do site (https://…)', 'imp.webhook': 'Segredo dos webhooks', 'giro.prodotti': 'Produtos do site' },
  },
};
