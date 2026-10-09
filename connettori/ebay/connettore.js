// eBay: ordini pagati → vendite (Sell Fulfillment API), giacenza degli inventory item da Kubo a eBay (Sell Inventory API,
// bulkUpdatePriceQuantity), spedizione con il tracking (createShippingFulfillment).
// Accesso: user token OAuth; Kubo tiene il refresh token (dura 18 mesi) e chiede l'access token di 2 ore con
// grant_type=refresh_token e Authorization: Basic base64(client_id:client_secret)
// (https://developer.ebay.com/api-docs/static/oauth-refresh-token-request.html).
// Attenzione: la Inventory API vede solo le inserzioni create con la Inventory API (o migrate con bulkMigrateListing);
// quelle create da Seller Hub restano fuori dal collegamento delle giacenze. Gli ordini arrivano comunque tutti.
// Nessun dato personale degli acquirenti entra in Kubo (solo il numero d'ordine): niente obblighi di cancellazione.
import { importaOrdine, venditaDa, RICHIEDE_NEGOZI } from '../_negozi/comune.js';
import { token } from '../_negozi/token.js';

const SCOPE = 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment';
const host = k => (k.base || (k.imp.ambiente === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com')).replace(/\/$/, '');
const accesso = async k => ({ bearer: await token(k, { url: `${host(k)}/identity/v1/oauth2/token`, basic: [k.segreti.client_id, k.segreti.client_secret],
  form: { grant_type: 'refresh_token', refresh_token: k.segreti.refresh_token, scope: SCOPE } }), intestazioni: { 'X-EBAY-C-MARKETPLACE-ID': k.imp.mercato || 'EBAY_IT', 'Accept-Language': 'it-IT' } });
const errore = r => new Error(`eBay ha risposto ${r.stato}${r.json?.errors?.[0] ? ': ' + r.json.errors[0].message : ''}`);
async function chiama(k, metodo, p, json) { const r = await k.http[metodo](host(k) + p, { ...(await accesso(k)), ...(json ? { json } : {}) }); if (!r.ok) throw errore(r); return r.json; }
// le liste di eBay: limit/offset con «next» finché c'è
async function* pagine(k, p, campo) {
  for (let url = p, n = 0; url && n < 500; n++) {
    const j = await chiama(k, 'get', url); if (j?.[campo]?.length) yield j[campo];
    url = j?.next ? j.next.replace(/^https?:\/\/[^/]+/, '') : null;
  }
}

export default {
  id: 'ebay', nome: 'eBay', versione: 1, icona: 'scatola',
  descrizione: 'Gli ordini eBay pagati diventano vendite, la giacenza segue il magazzino di Kubo, la spedizione si segna con il tracking.',
  impostazioni: [
    { id: 'client_id', nome: 'App ID (Client ID)', segreto: true },
    { id: 'client_secret', nome: 'Cert ID (Client secret)', segreto: true },
    { id: 'refresh_token', nome: 'Refresh token dell\'utente (v^1.1#…)', segreto: true, aiuto: 'Developer Program › User Tokens › Get a Token from eBay via Your Application' },
    { id: 'mercato', nome: 'Marketplace', predefinito: 'EBAY_IT', schema: /^EBAY_[A-Z_]+$/ },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['produzione', 'sandbox'], predefinito: 'produzione' },
  ],
  richiede: RICHIEDE_NEGOZI,
  permessi: { articoli: { leggi: true }, vendite: { leggi: true, crea: true } },
  prova: async k => { const j = await chiama(k, 'get', '/sell/fulfillment/v1/order?limit=1'); return { ok: true, messaggio: `${j?.total ?? 0} ordini` }; },
  pianificati: {
    offerte: { nome: 'Inventario eBay ↔ articoli', ogni: '6h', async giro(k) {
      const conti = { collegati: 0, sconosciuti: 0 };
      for await (const l of pagine(k, '/sell/inventory/v1/inventory_item?limit=100&offset=0', 'inventoryItems')) for (const it of l) {
        const a = k.dati.trova('articoli', 'codice', it.sku); if (a) { k.sincro.collega('articoli', a.id, it.sku); conti.collegati++; } else conti.sconosciuti++;
      }
      return conti;
    } },
    ordini: { nome: 'Ordini da eBay', ogni: '15m', async giro(k) {
      const da = k.stato.leggi('ordini') || new Date(Date.now() - 7 * 864e5).toISOString(), conti = { vendite: 0, ignorati: 0 }; let ultimo = da;
      for await (const l of pagine(k, `/sell/fulfillment/v1/order?filter=${encodeURIComponent(`lastmodifieddate:[${da}..]`)}&limit=50&offset=0`, 'orders')) for (const o of l) {
        if (o.lastModifiedDate > ultimo) ultimo = o.lastModifiedDate;
        if (o.orderPaymentStatus !== 'PAID' || o.cancelStatus?.cancelState === 'CANCELED') { conti.ignorati++; continue; }
        // lineItemCost è il prezzo della riga (quantità compresa); le promozioni del venditore si tolgono
        const e = importaOrdine(k, { id: o.orderId, numero: o.orderId, canale: 'eBay',
          linee: (o.lineItems || []).map(i => { const q = Number(i.quantity) || 1, sconti = (i.appliedPromotions || []).reduce((t, p) => t + Number(p.discountAmount?.value || 0), 0);
            return { sku: i.sku, nome: i.title, q, prezzo: (Number(i.lineItemCost?.value || 0) - sconti) / q }; }) });
        if (e === 'vendita creata') conti.vendite++; else conti.ignorati++;
      }
      k.stato.scrivi('ordini', ultimo);
      return conti;
    } },
  },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const sku = k.sincro.remoto('articoli', riga.id); if (!sku) return;
    const j = await chiama(k, 'post', '/sell/inventory/v1/bulk_update_price_quantity', { requests: [{ sku, shipToLocationAvailability: { quantity: Math.max(0, Math.round(Number(k.valore(riga, 'articoli', 'giacenza') || 0))) } }] });
    const no = (j?.responses || []).filter(x => x.statusCode >= 300); if (no.length) throw new Error(`eBay: ${no.flatMap(x => x.errors || []).map(e => e.message).join('; ') || 'giacenza rifiutata'}`);
  } } },
  azioni: {
    spedito: {
      nome: 'Segna spedito su eBay', descrizione: 'segna spedito un ordine eBay con corriere e tracking', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, tracking: { tipo: 'testo', nome: 'Numero di tracking' }, corriere: { tipo: 'testo', nome: 'Corriere (BRT, POSTE_ITALIANE, GLS, SDA, DHL, UPS…)' } },
      proponi: ({ vendita, tracking, corriere }, k) => { const v = venditaDa(k, vendita), o = k.sincro.remoto('vendite', v.id);
        return { titolo: 'Spedizione su eBay', righe: [['Ordine eBay', o || '—'], ['Corriere', corriere || '—'], ['Tracking', tracking]], avvisi: o ? [] : ['Questa vendita non viene da eBay'] }; },
      async esegui({ vendita, tracking, corriere }, k) {
        const v = venditaDa(k, vendita), o = k.sincro.remoto('vendite', v.id); if (!o) throw new Error('Questa vendita non viene da eBay');
        const ord = await chiama(k, 'get', `/sell/fulfillment/v1/order/${encodeURIComponent(o)}`);
        const r = await k.http.post(`${host(k)}/sell/fulfillment/v1/order/${encodeURIComponent(o)}/shipping_fulfillment`, { ...(await accesso(k)), json: {
          lineItems: (ord.lineItems || []).map(i => ({ lineItemId: i.lineItemId, quantity: Number(i.quantity) || 1 })), shippedDate: new Date().toISOString(),
          shippingCarrierCode: String(corriere || 'OTHER').toUpperCase().replace(/\s+/g, '_'), trackingNumber: String(tracking) } });
        if (!r.ok) throw errore(r);
        return { ok: true, ordine: o };
      },
    },
  },
  catalogo: {
    categoria: 'marketplace', sito: 'https://www.ebay.it', costo: 'a-consumo',
    costoNota: 'L\'API è gratuita (limiti giornalieri di chiamate generosi). Su eBay paghi le commissioni sul venduto (in Italia per i professionali in genere 4,5–10 % più una quota fissa per ordine) ed eventualmente il Negozio eBay.',
    serve: [
      { cosa: 'Keyset di produzione: App ID (Client ID) e Cert ID (Client secret)', dove: 'developer.ebay.com › Hi <nome> › Application Keysets › Production', link: 'https://developer.ebay.com/my/keys' },
      { cosa: 'Refresh token dell\'utente venditore con gli scope sell.inventory e sell.fulfillment', dove: 'developer.ebay.com › User Tokens › Get a Token from eBay via Your Application › Sign in to Production', link: 'https://developer.ebay.com/my/auth/?env=production&index=0' },
      { cosa: 'Esenzione dalle notifiche di cancellazione account (Kubo non salva dati degli acquirenti)', dove: 'Application Keysets › Notifications › Marketplace Account Deletion › Exempted', link: 'https://developer.ebay.com/marketplace-account-deletion' },
    ],
    passi: [
      'Registrati gratis su developer.ebay.com e crea un keyset di produzione: copia App ID e Cert ID.',
      'Nella pagina del keyset scegli «Exempted» per le notifiche Marketplace Account Deletion: Kubo non salva i dati degli acquirenti.',
      'Apri User Tokens, scegli «Get a Token from eBay via Your Application», accedi con il tuo account venditore e acconsenti.',
      'Copia il refresh token (dura 18 mesi; dopo si rigenera dalla stessa pagina).',
      'In Kubo incolla le tre chiavi, premi «Prova la connessione» e accendi.',
      'Lancia «Inventario eBay ↔ articoli»: si collegano per SKU le inserzioni create con la Inventory API (quelle di Seller Hub vanno migrate o restano solo per gli ordini).',
    ],
    difficolta: 'media', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://developer.ebay.com/api-docs/static/oauth-refresh-token-request.html', 'https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders', 'https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/bulkUpdatePriceQuantity', 'https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/shipping_fulfillment/methods/createShippingFulfillment'],
    prova: 'finto', parole: ['ebay', 'marketplace', 'aste', 'ordini', 'giacenze', 'inventory', 'fulfillment', 'orders', 'tracking'],
  },
  testi: {
    en: { descrizione: 'Paid eBay orders become sales, stock follows Kubo\'s inventory, shipments are marked with tracking.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client secret)', 'imp.refresh_token': 'User refresh token (v^1.1#…)', 'aiuto.refresh_token': 'Developer Program › User Tokens › Get a Token from eBay via Your Application', 'imp.mercato': 'Marketplace', 'imp.ambiente': 'Environment', 'az.spedito': 'Mark as shipped on eBay', 'giro.offerte': 'eBay inventory ↔ items', 'giro.ordini': 'Orders from eBay',
      'cat.costoNota': 'The API is free (generous daily call limits). On eBay you pay final value fees (for Italian business sellers usually 4.5–10% plus a fixed fee per order) and optionally an eBay Store.',
      'cat.serve': [{ cosa: 'Production keyset: App ID (Client ID) and Cert ID (Client secret)', dove: 'developer.ebay.com › Application Keysets › Production' }, { cosa: 'Seller user refresh token with the sell.inventory and sell.fulfillment scopes', dove: 'developer.ebay.com › User Tokens › Get a Token from eBay via Your Application' }, { cosa: 'Exemption from account deletion notifications (Kubo stores no buyer data)', dove: 'Application Keysets › Notifications › Marketplace Account Deletion › Exempted' }],
      'cat.passi': ['Sign up for free at developer.ebay.com and create a production keyset: copy App ID and Cert ID.', 'On the keyset page choose «Exempted» for Marketplace Account Deletion notifications: Kubo stores no buyer data.', 'Open User Tokens, choose «Get a Token from eBay via Your Application», sign in with your seller account and consent.', 'Copy the refresh token (valid 18 months; regenerate it from the same page).', 'In Kubo paste the three keys, press «Test connection» and switch on.', 'Run «eBay inventory ↔ items»: listings created with the Inventory API link by SKU (Seller Hub listings need migrating, otherwise they only bring orders).'] },
    es: { descrizione: 'Los pedidos pagados de eBay pasan a ventas, el stock sigue el almacén de Kubo, el envío se marca con seguimiento.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client secret)', 'imp.refresh_token': 'Refresh token del usuario', 'aiuto.refresh_token': 'Developer Program › User Tokens', 'imp.mercato': 'Marketplace', 'imp.ambiente': 'Entorno', 'az.spedito': 'Marcar como enviado en eBay', 'giro.offerte': 'Inventario de eBay ↔ artículos', 'giro.ordini': 'Pedidos de eBay' },
    fr: { descrizione: 'Les commandes eBay payées deviennent des ventes, le stock suit celui de Kubo, l\'expédition se marque avec le suivi.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client secret)', 'imp.refresh_token': 'Refresh token de l\'utilisateur', 'aiuto.refresh_token': 'Developer Program › User Tokens', 'imp.mercato': 'Marketplace', 'imp.ambiente': 'Environnement', 'az.spedito': 'Marquer comme expédié sur eBay', 'giro.offerte': 'Inventaire eBay ↔ articles', 'giro.ordini': 'Commandes eBay' },
    de: { descrizione: 'Bezahlte eBay-Bestellungen werden Verkäufe, der Bestand folgt Kubo, der Versand wird mit Sendungsnummer markiert.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client Secret)', 'imp.refresh_token': 'Refresh Token des Nutzers', 'aiuto.refresh_token': 'Developer Program › User Tokens', 'imp.mercato': 'Marktplatz', 'imp.ambiente': 'Umgebung', 'az.spedito': 'Auf eBay als versandt markieren', 'giro.offerte': 'eBay-Inventar ↔ Artikel', 'giro.ordini': 'Bestellungen von eBay' },
    pt: { descrizione: 'Os pedidos pagos do eBay viram vendas, o estoque segue o Kubo, o envio é marcado com rastreio.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client secret)', 'imp.refresh_token': 'Refresh token do usuário', 'aiuto.refresh_token': 'Developer Program › User Tokens', 'imp.mercato': 'Marketplace', 'imp.ambiente': 'Ambiente', 'az.spedito': 'Marcar como enviado no eBay', 'giro.offerte': 'Inventário do eBay ↔ artigos', 'giro.ordini': 'Pedidos do eBay' },
  },
};
