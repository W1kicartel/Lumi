// Amazon Seller Central (Selling Partner API): ordini → vendite, giacenza delle offerte gestite dal venditore (non FBA)
// da Kubo ad Amazon, conferma della spedizione con il tracking.
// Accesso: Login with Amazon, refresh token dell'app privata autorizzata da sé (Seller Central › App e servizi › Sviluppa
// app › Autorizza) scambiato per un access token di un'ora, mandato in x-amz-access-token. Dal 2 ottobre 2023 la firma
// AWS SigV4 e i ruoli IAM non servono più (https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api).
// Ordini: Orders API v0 (getOrders con LastUpdatedAfter e NextToken, getOrderItems); giacenze: Listings Items 2021-08-01,
// patch di /attributes/fulfillment_availability. I limiti sono bassi (getOrders 0,0167 richieste/s): il nucleo riprova i 429.
import { importaOrdine, venditaDa, tondo, RICHIEDE_NEGOZI } from '../_negozi/comune.js';
import { token } from '../_negozi/token.js';

const HOST = { eu: 'https://sellingpartnerapi-eu.amazon.com', na: 'https://sellingpartnerapi-na.amazon.com', fe: 'https://sellingpartnerapi-fe.amazon.com' };
const host = k => (k.base || HOST[k.imp.regione] || HOST.eu).replace(/\/$/, '');
const accesso = async k => ({ intestazioni: { 'x-amz-access-token': await token(k, { url: k.base ? `${host(k)}/auth/o2/token` : 'https://api.amazon.com/auth/o2/token',
  form: { grant_type: 'refresh_token', refresh_token: k.segreti.refresh_token, client_id: k.segreti.client_id, client_secret: k.segreti.client_secret } }) } });
const errore = r => new Error(`Amazon ha risposto ${r.stato}${r.json?.errors?.[0] ? ': ' + r.json.errors[0].code + ' ' + (r.json.errors[0].message || '') : ''}`);
async function chiama(k, metodo, p, q = {}, json) {
  const u = new URL(host(k) + p); for (const [a, b] of Object.entries(q)) if (b != null) u.searchParams.set(a, b);
  const r = await k.http[metodo](u.href, { ...(await accesso(k)), ...(json ? { json } : {}) }); if (!r.ok) throw errore(r); return r.json;
}
const mercato = k => k.imp.mercato || 'APJ6JRA9NG5V4';
const PAGATI = ['Unshipped', 'PartiallyShipped', 'Shipped'];

export default {
  id: 'amazon', nome: 'Amazon Seller Central', versione: 1, icona: 'scatola',
  descrizione: 'Gli ordini Amazon diventano vendite, la giacenza delle tue offerte segue il magazzino di Kubo, la spedizione si conferma con il tracking.',
  impostazioni: [
    { id: 'client_id', nome: 'LWA Client ID (amzn1.application-oa2-client…)', segreto: true },
    { id: 'client_secret', nome: 'LWA Client secret', segreto: true },
    { id: 'refresh_token', nome: 'Refresh token (Atzr|…)', segreto: true, aiuto: 'Developer Central › la tua app › Autorizza' },
    { id: 'venditore', nome: 'Merchant Token (ID venditore)', schema: /^[A-Z0-9]{8,20}$/, aiuto: 'Impostazioni › Info account › Informazioni sul venditore' },
    { id: 'regione', nome: 'Regione', tipo: 'scelta', opzioni: ['eu', 'na', 'fe'], predefinito: 'eu' },
    { id: 'mercato', nome: 'Marketplace ID', predefinito: 'APJ6JRA9NG5V4', aiuto: 'Amazon.it = APJ6JRA9NG5V4' },
  ],
  richiede: RICHIEDE_NEGOZI,
  permessi: { articoli: { leggi: true }, vendite: { leggi: true, crea: true } },
  prova: async k => { const j = await chiama(k, 'get', '/sellers/v1/marketplaceParticipations'); const m = (j.payload || []).map(x => x.marketplace?.id);
    return { ok: m.includes(mercato(k)), messaggio: m.includes(mercato(k)) ? null : `Il venditore non è su ${mercato(k)} (ha: ${m.join(', ')})` }; },
  pianificati: {
    // le offerte del venditore si collegano agli articoli con lo stesso codice (SKU): solo a queste va la giacenza
    offerte: { nome: 'Offerte Amazon ↔ articoli', ogni: '6h', async giro(k) {
      if (!k.imp.venditore) throw new Error('Manca il Merchant Token nelle impostazioni');
      const tipi = {}, conti = { collegati: 0, sconosciuti: 0 };
      for (let pagina = null, n = 0; n < 500; n++) {
        const j = await chiama(k, 'get', `/listings/2021-08-01/items/${encodeURIComponent(k.imp.venditore)}`, { marketplaceIds: mercato(k), includedData: 'summaries', pageSize: 20, pageToken: pagina });
        for (const it of j.items || []) {
          const a = k.dati.trova('articoli', 'codice', it.sku); tipi[it.sku] = it.summaries?.[0]?.productType || 'PRODUCT';
          if (a) { k.sincro.collega('articoli', a.id, it.sku); conti.collegati++; } else conti.sconosciuti++;
        }
        pagina = j.pagination?.nextToken; if (!pagina) break;
      }
      k.stato.scrivi('tipi', tipi);
      return conti;
    } },
    ordini: { nome: 'Ordini da Amazon', ogni: '15m', async giro(k) {
      // LastUpdatedAfter deve stare almeno 2 minuti prima di adesso
      const da = k.stato.leggi('ordini') || new Date(Date.now() - 7 * 864e5).toISOString(), conti = { vendite: 0, ignorati: 0 }; let ultimo = da;
      for (let prossimo = null, n = 0; n < 200; n++) {
        const j = (await chiama(k, 'get', '/orders/v0/orders', prossimo ? { MarketplaceIds: mercato(k), NextToken: prossimo } : { MarketplaceIds: mercato(k), LastUpdatedAfter: da })).payload || {};
        for (const o of j.Orders || []) {
          if (o.LastUpdateDate > ultimo) ultimo = o.LastUpdateDate;
          if (!PAGATI.includes(o.OrderStatus) || k.sincro.locale('vendite', o.AmazonOrderId)) { conti.ignorati++; continue; }
          const righe = [];
          for (let t = null, m = 0; m < 20; m++) {
            const x = (await chiama(k, 'get', `/orders/v0/orders/${o.AmazonOrderId}/orderItems`, { NextToken: t })).payload || {};
            righe.push(...(x.OrderItems || [])); t = x.NextToken; if (!t) break;
          }
          // ItemPrice è il prezzo della riga (quantità compresa), IVA inclusa in Europa; lo sconto della promozione si toglie
          const e = importaOrdine(k, { id: o.AmazonOrderId, numero: o.AmazonOrderId, canale: 'Amazon',
            linee: righe.map(i => { const q = Number(i.QuantityOrdered) || 1; return { sku: i.SellerSKU, nome: i.Title, q, prezzo: (Number(i.ItemPrice?.Amount || 0) - Number(i.PromotionDiscount?.Amount || 0)) / q }; }) });
          if (e === 'vendita creata') conti.vendite++; else conti.ignorati++;
        }
        prossimo = j.NextToken; if (!prossimo) break;
      }
      k.stato.scrivi('ordini', new Date(Math.min(Date.parse(ultimo) + 1000, Date.now() - 120000)).toISOString());
      return conti;
    } },
  },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const sku = k.sincro.remoto('articoli', riga.id); if (!sku) return;   // un articolo che su Amazon non è in vendita
    const tipo = k.stato.leggi('tipi')?.[sku] || 'PRODUCT', q = Math.max(0, Math.round(Number(k.valore(riga, 'articoli', 'giacenza') || 0)));
    const j = await chiama(k, 'patch', `/listings/2021-08-01/items/${encodeURIComponent(k.imp.venditore)}/${encodeURIComponent(sku)}`, { marketplaceIds: mercato(k) },
      { productType: tipo, patches: [{ op: 'replace', path: '/attributes/fulfillment_availability', value: [{ fulfillment_channel_code: 'DEFAULT', quantity: q }] }] });
    if (j?.status && j.status !== 'ACCEPTED') throw new Error(`Amazon non ha accettato la giacenza di ${sku}: ${(j.issues || []).map(i => i.message).join('; ')}`);
  } } },
  azioni: {
    spedito: {
      nome: 'Conferma la spedizione su Amazon', descrizione: 'conferma la spedizione di un ordine Amazon (non FBA) con corriere e tracking', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, tracking: { tipo: 'testo', nome: 'Numero di tracking' }, corriere: { tipo: 'testo', nome: 'Corriere (BRT, Poste Italiane, GLS…)' } },
      proponi: ({ vendita, tracking, corriere }, k) => { const v = venditaDa(k, vendita), o = k.sincro.remoto('vendite', v.id);
        return { titolo: 'Spedizione su Amazon', righe: [['Ordine Amazon', o || '—'], ['Corriere', corriere || '—'], ['Tracking', tracking]], avvisi: o ? [] : ['Questa vendita non viene da Amazon'] }; },
      async esegui({ vendita, tracking, corriere }, k) {
        const v = venditaDa(k, vendita), o = k.sincro.remoto('vendite', v.id); if (!o) throw new Error('Questa vendita non viene da Amazon');
        const righe = (await chiama(k, 'get', `/orders/v0/orders/${o}/orderItems`)).payload?.OrderItems || [];
        await chiama(k, 'post', `/orders/v0/orders/${o}/shipmentConfirmation`, {}, { marketplaceId: mercato(k), packageDetail: {
          packageReferenceId: '1', carrierCode: 'Other', carrierName: corriere || 'Corriere', trackingNumber: String(tracking), shipDate: new Date().toISOString(),
          orderItems: righe.map(i => ({ orderItemId: i.OrderItemId, quantity: Number(i.QuantityOrdered) || 1 })) } });
        return { ok: true, ordine: o };
      },
    },
  },
  catalogo: {
    categoria: 'marketplace', sito: 'https://sellercentral.amazon.it', costo: 'a-consumo',
    costoNota: 'L\'API è gratuita per i venditori. Su Amazon paghi il piano Professionale (39 € al mese + IVA) e le commissioni per categoria (in genere 7–15 %). Dal 2026 Amazon può addebitare un canone annuale agli sviluppatori di app pubbliche; un\'app privata per il tuo account no.',
    serve: [
      { cosa: 'Profilo sviluppatore privato e un\'app SP-API (LWA Client ID e Client secret) con i ruoli Inventario e Prezzi, Gestione ordini', dove: 'Seller Central › App e servizi › Sviluppa app (Solution Provider Portal) › Aggiungi nuova app client', link: 'https://developer-docs.amazon.com/sp-api/docs/registering-your-application' },
      { cosa: 'Refresh token dell\'autorizzazione dell\'app sul tuo account', dove: 'Sviluppa app › la tua app › Autorizza › Genera refresh token', link: 'https://developer-docs.amazon.com/sp-api/docs/self-authorization' },
      { cosa: 'Merchant Token (ID venditore)', dove: 'Seller Central › Impostazioni › Info account › Informazioni sul venditore', link: 'https://sellercentral.amazon.it/sw/AccountInfo/MerchantToken/step/MerchantToken' },
    ],
    passi: [
      'In Seller Central apri App e servizi › Sviluppa app e registrati come sviluppatore privato (solo per il tuo account).',
      'Crea un\'app client «SP API» con i ruoli Gestione ordini e Inventario e Prezzi.',
      'Apri l\'app: copia LWA Client ID e Client secret, poi premi «Autorizza» e copia il refresh token.',
      'In Kubo incolla le tre chiavi e il Merchant Token; per Amazon.it lascia regione «eu» e marketplace APJ6JRA9NG5V4.',
      'Premi «Prova la connessione», accendi e lancia «Offerte Amazon ↔ articoli»: le offerte si collegano agli articoli con lo stesso SKU.',
      'Da qui gli ordini arrivano ogni 15 minuti e la giacenza delle offerte non FBA segue Kubo.',
    ],
    difficolta: 'difficile', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api', 'https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference', 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference', 'https://developer-docs.amazon.com/sp-api/docs/marketplace-ids'],
    prova: 'finto', parole: ['amazon', 'seller central', 'sp-api', 'selling partner', 'marketplace', 'ordini', 'giacenze', 'fba', 'orders', 'inventory'],
  },
  testi: {
    en: { nome: 'Amazon Seller Central', descrizione: 'Amazon orders become sales, the stock of your offers follows Kubo\'s inventory, shipments are confirmed with tracking.', 'imp.client_id': 'LWA Client ID (amzn1.application-oa2-client…)', 'imp.client_secret': 'LWA Client secret', 'imp.refresh_token': 'Refresh token (Atzr|…)', 'aiuto.refresh_token': 'Developer Central › your app › Authorize', 'imp.venditore': 'Merchant Token (seller ID)', 'aiuto.venditore': 'Settings › Account Info › Your Merchant Token', 'imp.regione': 'Region', 'imp.mercato': 'Marketplace ID', 'aiuto.mercato': 'Amazon.it = APJ6JRA9NG5V4', 'az.spedito': 'Confirm the shipment on Amazon', 'giro.offerte': 'Amazon offers ↔ items', 'giro.ordini': 'Orders from Amazon',
      'cat.costoNota': 'The API is free for sellers. On Amazon you pay the Professional plan (€39 a month + VAT) and referral fees per category (usually 7–15%). From 2026 Amazon may charge public app developers a yearly fee; a private app for your own account is not charged.',
      'cat.serve': [{ cosa: 'Private developer profile and an SP-API app (LWA Client ID and Client secret) with the Inventory and Order Management roles', dove: 'Seller Central › Apps and Services › Develop Apps › Add new app client' }, { cosa: 'Refresh token from authorizing the app on your account', dove: 'Develop Apps › your app › Authorize › Generate refresh token' }, { cosa: 'Merchant Token (seller ID)', dove: 'Seller Central › Settings › Account Info › Your Merchant Token' }],
      'cat.passi': ['In Seller Central open Apps and Services › Develop Apps and register as a private developer (your own account only).', 'Create an «SP API» app client with the Order Management and Inventory and Pricing roles.', 'Open the app: copy the LWA Client ID and Client secret, then press «Authorize» and copy the refresh token.', 'In Kubo paste the three keys and the Merchant Token; for Amazon.it keep region «eu» and marketplace APJ6JRA9NG5V4.', 'Press «Test connection», switch on and run «Amazon offers ↔ items»: offers link to items with the same SKU.', 'From then on orders arrive every 15 minutes and the stock of non-FBA offers follows Kubo.'] },
    es: { nome: 'Amazon Seller Central', descrizione: 'Los pedidos de Amazon pasan a ventas, el stock de tus ofertas sigue el almacén de Kubo, el envío se confirma con el seguimiento.', 'imp.client_id': 'LWA Client ID', 'imp.client_secret': 'LWA Client secret', 'imp.refresh_token': 'Refresh token (Atzr|…)', 'aiuto.refresh_token': 'Developer Central › tu app › Autorizar', 'imp.venditore': 'Merchant Token (ID de vendedor)', 'aiuto.venditore': 'Configuración › Información de la cuenta', 'imp.regione': 'Región', 'imp.mercato': 'Marketplace ID', 'aiuto.mercato': 'Amazon.it = APJ6JRA9NG5V4', 'az.spedito': 'Confirmar el envío en Amazon', 'giro.offerte': 'Ofertas de Amazon ↔ artículos', 'giro.ordini': 'Pedidos de Amazon' },
    fr: { nome: 'Amazon Seller Central', descrizione: 'Les commandes Amazon deviennent des ventes, le stock de vos offres suit celui de Kubo, l\'expédition se confirme avec le suivi.', 'imp.client_id': 'LWA Client ID', 'imp.client_secret': 'LWA Client secret', 'imp.refresh_token': 'Refresh token (Atzr|…)', 'aiuto.refresh_token': 'Developer Central › votre app › Autoriser', 'imp.venditore': 'Merchant Token (ID vendeur)', 'aiuto.venditore': 'Paramètres › Informations sur le compte', 'imp.regione': 'Région', 'imp.mercato': 'Marketplace ID', 'aiuto.mercato': 'Amazon.it = APJ6JRA9NG5V4', 'az.spedito': 'Confirmer l\'expédition sur Amazon', 'giro.offerte': 'Offres Amazon ↔ articles', 'giro.ordini': 'Commandes Amazon' },
    de: { nome: 'Amazon Seller Central', descrizione: 'Amazon-Bestellungen werden Verkäufe, der Bestand deiner Angebote folgt Kubo, der Versand wird mit Sendungsnummer bestätigt.', 'imp.client_id': 'LWA Client ID', 'imp.client_secret': 'LWA Client Secret', 'imp.refresh_token': 'Refresh Token (Atzr|…)', 'aiuto.refresh_token': 'Developer Central › deine App › Autorisieren', 'imp.venditore': 'Merchant Token (Verkäufer-ID)', 'aiuto.venditore': 'Einstellungen › Kontoinformationen', 'imp.regione': 'Region', 'imp.mercato': 'Marketplace-ID', 'aiuto.mercato': 'Amazon.it = APJ6JRA9NG5V4', 'az.spedito': 'Versand auf Amazon bestätigen', 'giro.offerte': 'Amazon-Angebote ↔ Artikel', 'giro.ordini': 'Bestellungen von Amazon' },
    pt: { nome: 'Amazon Seller Central', descrizione: 'Os pedidos da Amazon viram vendas, o estoque das suas ofertas segue o Kubo, o envio é confirmado com o rastreio.', 'imp.client_id': 'LWA Client ID', 'imp.client_secret': 'LWA Client secret', 'imp.refresh_token': 'Refresh token (Atzr|…)', 'aiuto.refresh_token': 'Developer Central › seu app › Autorizar', 'imp.venditore': 'Merchant Token (ID do vendedor)', 'aiuto.venditore': 'Configurações › Informações da conta', 'imp.regione': 'Região', 'imp.mercato': 'Marketplace ID', 'aiuto.mercato': 'Amazon.it = APJ6JRA9NG5V4', 'az.spedito': 'Confirmar o envio na Amazon', 'giro.offerte': 'Ofertas da Amazon ↔ artigos', 'giro.ordini': 'Pedidos da Amazon' },
  },
};
