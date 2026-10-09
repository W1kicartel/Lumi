// eBay: ordini pagati → vendite (Sell Fulfillment API), giacenza degli inventory item da Lumi a eBay (Sell Inventory API,
// bulkUpdatePriceQuantity), spedizione con il tracking (createShippingFulfillment).
// Accesso: user token OAuth; Lumi tiene il refresh token (dura 18 mesi) e chiede l'access token di 2 ore con
// grant_type=refresh_token e Authorization: Basic base64(client_id:client_secret)
// (https://developer.ebay.com/api-docs/static/oauth-refresh-token-request.html). Il refresh token nasce solo dal consenso
// con il codice (la pagina User Tokens dà un token di 2 ore): eBay vuole il RuName come redirect_uri e il Basic anche qui.
// Il consenso lo fa il connettore («Collega l'account» → ritorno su /pub/ritorno, oppure l'indirizzo incollato) e non
// l'OAuth del kit (che pure ha basic, pkce: false e redirect: k => k.imp.runame) per due motivi: eBay vuole lo «scope»
// anche nella richiesta di rinnovo, che il kit non manda; e l'«auth accepted URL» del RuName dev'essere https, quindi
// chi ha Lumi solo in rete locale deve poter incollare l'indirizzo del ritorno («Completa il collegamento»), cosa che
// la rotta di ritorno del kit non permette. In più i refresh token già salvati restano validi.
// Attenzione: la Inventory API vede solo le inserzioni create con la Inventory API (o migrate con bulkMigrateListing);
// quelle create da Seller Hub restano fuori dal collegamento delle giacenze. Gli ordini arrivano comunque tutti.
// Nessun dato personale degli acquirenti entra in Lumi (solo il numero d'ordine): niente obblighi di cancellazione.
import { randomBytes } from 'node:crypto';
import { importaOrdine, venditaDa, RICHIEDE_NEGOZI } from '../_negozi/comune.js';
import { token } from '../_negozi/token.js';

const SCOPE = 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment';
const host = k => (k.base || (k.imp.ambiente === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com')).replace(/\/$/, '');
const accesso = async k => ({ bearer: await token(k, { url: `${host(k)}/identity/v1/oauth2/token`, basic: [k.segreti.client_id, k.segreti.client_secret],
  form: { grant_type: 'refresh_token', refresh_token: k.segreti.refresh_token, scope: SCOPE } }), intestazioni: { 'X-EBAY-C-MARKETPLACE-ID': k.imp.mercato || 'EBAY_IT', 'Accept-Language': 'it-IT' } });
const consenso = k => (k.base || (k.imp.ambiente === 'sandbox' ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com')).replace(/\/$/, '');
// il codice del consenso → refresh token salvato cifrato. «indirizzo»: l'URL su cui eBay ha rimandato, o il solo codice
async function scambia(k, indirizzo) {
  let codice = String(indirizzo || '').trim(), state = null;
  if (/^https?:\/\//.test(codice)) { const u = new URL(codice); codice = u.searchParams.get('code'); state = u.searchParams.get('state'); }
  const c = k.stato.leggi('consenso');
  if (!codice) throw new Error('Nell\'indirizzo non c\'è il codice di eBay');
  if (state !== null && (!c || c.state !== state || c.scade < Date.now())) throw new Error('Consenso scaduto o non chiesto da Lumi: ripeti «Collega l\'account»');
  const r = await k.http.post(`${host(k)}/identity/v1/oauth2/token`, { basic: [k.segreti.client_id, k.segreti.client_secret], form: { grant_type: 'authorization_code', code: codice, redirect_uri: k.imp.runame } });
  if (!r.ok || !r.json?.refresh_token) throw new Error(`eBay non ha dato l'accesso (${r.stato}${r.json?.error_description ? ': ' + r.json.error_description : ''})`);
  k.salvaSegreto('refresh_token', r.json.refresh_token); k.stato.scrivi('consenso', null);
  return { ok: true, scade: new Date(Date.now() + Number(r.json.refresh_token_expires_in || 47304000) * 1000).toISOString().slice(0, 10) };
}
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
  descrizione: 'Gli ordini eBay pagati diventano vendite, la giacenza segue il magazzino di Lumi, la spedizione si segna con il tracking.',
  impostazioni: [
    { id: 'client_id', nome: 'App ID (Client ID)', segreto: true },
    { id: 'client_secret', nome: 'Cert ID (Client secret)', segreto: true },
    { id: 'runame', nome: 'RuName (eBay Redirect URL name)', aiuto: 'User Tokens › Get a Token from eBay via Your Application › Add eBay Redirect URL' },
    { id: 'refresh_token', nome: 'Refresh token dell\'utente (lo salva «Collega l\'account»)', segreto: true, obbligatorio: false },
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
    collega: {
      nome: 'Collega l\'account eBay', descrizione: 'l\'indirizzo del consenso di eBay: aprilo, accedi come venditore e consenti',
      async esegui(x, k) {
        if (!k.imp.runame) throw new Error('Manca il RuName nelle impostazioni');
        const state = randomBytes(18).toString('base64url'); k.stato.scrivi('consenso', { state, scade: Date.now() + 6e5 });
        const u = new URL(`${consenso(k)}/oauth2/authorize`);
        for (const [a, b] of Object.entries({ client_id: k.segreti.client_id, redirect_uri: k.imp.runame, response_type: 'code', scope: SCOPE, state })) u.searchParams.set(a, b);
        return { indirizzo: u.href };
      },
    },
    codice: {
      nome: 'Completa il collegamento', descrizione: 'incolla l\'indirizzo su cui eBay ti ha rimandato dopo il consenso (se non è quello di Lumi)',
      input: { indirizzo: { tipo: 'testo', nome: 'Indirizzo con ?code=…' } },
      esegui: ({ indirizzo }, k) => scambia(k, indirizzo),
    },
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
          shippingCarrierCode: String(corriere || 'OTHER').toUpperCase().replace(/\s+/g, '_'), trackingNumber: String(tracking).replace(/[^A-Za-z0-9]/g, '') } });
        if (!r.ok) throw errore(r);
        return { ok: true, ordine: o };
      },
    },
  },
  // l'«auth accepted URL» del RuName, se Lumi è raggiungibile in https: eBay rimanda qui il browser con code e state
  pubbliche: {
    async ritorno({ q, k }) {
      let testo; try { if (!q.get('state')) throw new Error('manca lo state'); await scambia(k, `https://x/?${q.toString()}`); testo = 'eBay collegato a Lumi: puoi chiudere questa pagina.'; } catch (e) { testo = `Collegamento non riuscito: ${e.message}`; }
      return { tipo: 'text/plain; charset=utf-8', corpo: testo };
    },
  },
  catalogo: {
    categoria: 'marketplace', sito: 'https://www.ebay.it', costo: 'a-consumo',
    costoNota: 'L\'API è gratuita (limiti giornalieri di chiamate generosi). Su eBay paghi le commissioni sul venduto (in Italia per i professionali in genere 4,5–10 % più una quota fissa per ordine) ed eventualmente il Negozio eBay.',
    serve: [
      { cosa: 'Keyset di produzione: App ID (Client ID) e Cert ID (Client secret)', dove: 'developer.ebay.com › Hi <nome> › Application Keysets › Production', link: 'https://developer.ebay.com/my/keys' },
      { cosa: 'RuName (eBay Redirect URL name) con OAuth abilitato; come «auth accepted URL» l\'indirizzo …/api/connettori/ebay/pub/ritorno di Lumi (o una pagina qualsiasi, poi incolli l\'indirizzo)', dove: 'developer.ebay.com › User Tokens › Get a Token from eBay via Your Application › Add eBay Redirect URL', link: 'https://developer.ebay.com/api-docs/static/oauth-redirect-uri.html' },
      { cosa: 'Esenzione dalle notifiche di cancellazione account (Lumi non salva dati degli acquirenti)', dove: 'Application Keysets › Notifications › Marketplace Account Deletion › Exempted', link: 'https://developer.ebay.com/marketplace-account-deletion' },
    ],
    passi: [
      'Registrati gratis su developer.ebay.com e crea un keyset di produzione: copia App ID e Cert ID.',
      'Nella pagina del keyset scegli «Exempted» per le notifiche Marketplace Account Deletion: Lumi non salva i dati degli acquirenti.',
      'Apri User Tokens › Get a Token from eBay via Your Application › Add eBay Redirect URL: abilita OAuth e come «auth accepted URL» metti l\'indirizzo pubblico di Lumi seguito da /api/connettori/ebay/pub/ritorno. Copia il RuName.',
      'In Lumi incolla App ID, Cert ID e RuName e accendi il connettore.',
      'Premi «Collega l\'account eBay», apri l\'indirizzo, accedi come venditore e consenti. Se Lumi non è raggiungibile da internet, copia l\'indirizzo su cui eBay ti rimanda e incollalo in «Completa il collegamento».',
      'Il collegamento dura 18 mesi: poi si ripete il consenso. Premi «Prova la connessione».',
      'Lancia «Inventario eBay ↔ articoli»: si collegano per SKU le inserzioni create con la Inventory API (quelle di Seller Hub vanno migrate o restano solo per gli ordini).',
    ],
    difficolta: 'media', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://developer.ebay.com/api-docs/static/oauth-refresh-token-request.html', 'https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html', 'https://developer.ebay.com/api-docs/static/oauth-ui-tokens.html', 'https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders', 'https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/bulkUpdatePriceQuantity', 'https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/shipping_fulfillment/methods/createShippingFulfillment'],
    prova: 'finto', parole: ['ebay', 'marketplace', 'aste', 'ordini', 'giacenze', 'inventory', 'fulfillment', 'orders', 'tracking'],
  },
  testi: {
    en: { descrizione: 'Paid eBay orders become sales, stock follows Lumi\'s inventory, shipments are marked with tracking.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client secret)', 'imp.runame': 'RuName (eBay Redirect URL name)', 'aiuto.runame': 'User Tokens › Get a Token from eBay via Your Application › Add eBay Redirect URL', 'imp.refresh_token': 'User refresh token (saved by «Connect the account»)', 'az.collega': 'Connect the eBay account', 'az.codice': 'Complete the connection', 'imp.mercato': 'Marketplace', 'imp.ambiente': 'Environment', 'az.spedito': 'Mark as shipped on eBay', 'giro.offerte': 'eBay inventory ↔ items', 'giro.ordini': 'Orders from eBay',
      'cat.costoNota': 'The API is free (generous daily call limits). On eBay you pay final value fees (for Italian business sellers usually 4.5–10% plus a fixed fee per order) and optionally an eBay Store.',
      'cat.serve': [{ cosa: 'Production keyset: App ID (Client ID) and Cert ID (Client secret)', dove: 'developer.ebay.com › Application Keysets › Production' }, { cosa: 'RuName (eBay Redirect URL name) with OAuth enabled; as «auth accepted URL» Lumi\'s …/api/connettori/ebay/pub/ritorno address (or any page, then paste the address)', dove: 'developer.ebay.com › User Tokens › Get a Token from eBay via Your Application › Add eBay Redirect URL' }, { cosa: 'Exemption from account deletion notifications (Lumi stores no buyer data)', dove: 'Application Keysets › Notifications › Marketplace Account Deletion › Exempted' }],
      'cat.passi': ['Sign up for free at developer.ebay.com and create a production keyset: copy App ID and Cert ID.', 'On the keyset page choose «Exempted» for Marketplace Account Deletion notifications: Lumi stores no buyer data.', 'Open User Tokens › Get a Token from eBay via Your Application › Add eBay Redirect URL: enable OAuth and set Lumi\'s public address followed by /api/connettori/ebay/pub/ritorno as «auth accepted URL». Copy the RuName.', 'In Lumi paste App ID, Cert ID and RuName and switch the connector on.', 'Press «Connect the eBay account», open the address, sign in as seller and consent. If Lumi is not reachable from the internet, copy the address eBay sends you to and paste it in «Complete the connection».', 'The connection lasts 18 months, then repeat the consent. Press «Test connection».', 'Run «eBay inventory ↔ items»: listings created with the Inventory API link by SKU (Seller Hub listings need migrating, otherwise they only bring orders).'] },
    es: { descrizione: 'Los pedidos pagados de eBay pasan a ventas, el stock sigue el almacén de Lumi, el envío se marca con seguimiento.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client secret)', 'imp.runame': 'RuName (eBay Redirect URL name)', 'aiuto.runame': 'User Tokens › Add eBay Redirect URL', 'imp.refresh_token': 'Refresh token del usuario (lo guarda «Conectar la cuenta»)', 'az.collega': 'Conectar la cuenta de eBay', 'az.codice': 'Completar la conexión', 'imp.mercato': 'Marketplace', 'imp.ambiente': 'Entorno', 'az.spedito': 'Marcar como enviado en eBay', 'giro.offerte': 'Inventario de eBay ↔ artículos', 'giro.ordini': 'Pedidos de eBay' },
    fr: { descrizione: 'Les commandes eBay payées deviennent des ventes, le stock suit celui de Lumi, l\'expédition se marque avec le suivi.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client secret)', 'imp.runame': 'RuName (eBay Redirect URL name)', 'aiuto.runame': 'User Tokens › Add eBay Redirect URL', 'imp.refresh_token': 'Refresh token de l\'utilisateur (enregistré par «Connecter le compte»)', 'az.collega': 'Connecter le compte eBay', 'az.codice': 'Terminer la connexion', 'imp.mercato': 'Marketplace', 'imp.ambiente': 'Environnement', 'az.spedito': 'Marquer comme expédié sur eBay', 'giro.offerte': 'Inventaire eBay ↔ articles', 'giro.ordini': 'Commandes eBay' },
    de: { descrizione: 'Bezahlte eBay-Bestellungen werden Verkäufe, der Bestand folgt Lumi, der Versand wird mit Sendungsnummer markiert.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client Secret)', 'imp.runame': 'RuName (eBay Redirect URL name)', 'aiuto.runame': 'User Tokens › Add eBay Redirect URL', 'imp.refresh_token': 'Refresh Token des Nutzers (speichert «Konto verbinden»)', 'az.collega': 'eBay-Konto verbinden', 'az.codice': 'Verbindung abschließen', 'imp.mercato': 'Marktplatz', 'imp.ambiente': 'Umgebung', 'az.spedito': 'Auf eBay als versandt markieren', 'giro.offerte': 'eBay-Inventar ↔ Artikel', 'giro.ordini': 'Bestellungen von eBay' },
    pt: { descrizione: 'Os pedidos pagos do eBay viram vendas, o estoque segue o Lumi, o envio é marcado com rastreio.', 'imp.client_id': 'App ID (Client ID)', 'imp.client_secret': 'Cert ID (Client secret)', 'imp.runame': 'RuName (eBay Redirect URL name)', 'aiuto.runame': 'User Tokens › Add eBay Redirect URL', 'imp.refresh_token': 'Refresh token do usuário (salvo por «Conectar a conta»)', 'az.collega': 'Conectar a conta do eBay', 'az.codice': 'Concluir a conexão', 'imp.mercato': 'Marketplace', 'imp.ambiente': 'Ambiente', 'az.spedito': 'Marcar como enviado no eBay', 'giro.offerte': 'Inventário do eBay ↔ artigos', 'giro.ordini': 'Pedidos do eBay' },
  },
};
