// Etsy: le ricevute pagate → vendite (con il cliente e l'indirizzo per spedire), la giacenza delle inserzioni da Kubo a
// Etsy, il tracking sulla ricevuta. Open API v3 (https://developer.etsy.com/documentation/): OAuth 2 con PKCE (lo fa il
// nucleo: Collega l'account), access token di un'ora e refresh token di 90 giorni; ogni chiamata porta anche x-api-key.
// Le inserzioni si collegano agli articoli per SKU (una variante = un prodotto dell'inventario). Etsy non ha webhook per
// gli ordini: le ricevute si leggono ogni 15 minuti con min_last_modified. Limite: 10 richieste al secondo per app.
import { importaOrdine, venditaDa } from '../_negozi/comune.js';

const host = k => (k.base || 'https://api.etsy.com').replace(/\/$/, '');
// x-api-key: keystring, oppure «keystring:shared secret» quando c'è il segreto condiviso (le app create dal 2025 lo vogliono)
const chiave = k => (k.segreti.shared_secret ? `${k.segreti.keystring}:${k.segreti.shared_secret}` : k.segreti.keystring);
const errore = r => new Error(`Etsy ha risposto ${r.stato}${r.json?.error ? ': ' + r.json.error : ''}`);
async function chiama(k, metodo, p, json) {
  const r = await k.http[metodo](`${host(k)}/v3/application${p}`, { bearer: await k.oauth.token(), intestazioni: { 'x-api-key': chiave(k) }, ...(json ? { json } : {}) });
  if (!r.ok) throw errore(r); return r.json;
}
async function negozio(k) { let s = k.stato.leggi('negozio'); if (!s) { s = (await chiama(k, 'get', '/users/me')).shop_id; if (!s) throw new Error('Questo account Etsy non ha un negozio'); k.stato.scrivi('negozio', s); } return s; }
async function* pagine(k, p, quanti = 100) {
  for (let da = 0; da < 1e5; da += quanti) {
    const j = await chiama(k, 'get', `${p}${p.includes('?') ? '&' : '?'}limit=${quanti}&offset=${da}`), l = j?.results || [];
    if (l.length) yield l; if (l.length < quanti || da + quanti >= Number(j?.count ?? 0)) return;
  }
}
const soldi = p => (p ? Number(p.amount) / Number(p.divisor || 100) : 0);
// l'inventario come lo vuole updateListingInventory: prezzi decimali, niente id né campi in sola lettura
const perScrivere = inv => ({ price_on_property: inv.price_on_property || [], quantity_on_property: inv.quantity_on_property || [], sku_on_property: inv.sku_on_property || [],
  products: (inv.products || []).map(p => ({ sku: p.sku, property_values: (p.property_values || []).map(v => ({ property_id: v.property_id, value_ids: v.value_ids, scale_id: v.scale_id ?? null, property_name: v.property_name, values: v.values })),
    offerings: (p.offerings || []).map(o => ({ price: soldi(o.price), quantity: o.quantity, is_enabled: o.is_enabled !== false })) })) });

export default {
  id: 'etsy', nome: 'Etsy', versione: 1, icona: 'scatola',
  descrizione: 'Gli ordini Etsy diventano vendite con il cliente, la giacenza delle inserzioni segue Kubo, il tracking va sulla ricevuta.',
  impostazioni: [
    { id: 'keystring', nome: 'Keystring dell\'app (API key)', segreto: true },
    { id: 'shared_secret', nome: 'Shared secret dell\'app', segreto: true, obbligatorio: false },
  ],
  oauth: { tipo: 'codice', autorizza: 'https://www.etsy.com/oauth/connect', token: k => `${host(k)}/v3/public/oauth/token`, scope: 'listings_r listings_w transactions_r transactions_w shops_r', client: 'keystring', segreto: '_nessuno' },
  richiede: {
    articoli: { codice: { tipo: 'testo', alias: ['sku'] }, giacenza: { tipo: 'numero' } },
    vendite: { stato: { tipo: 'stato' }, righe: { tipo: 'righe' }, cliente: { tipo: 'relazione', facoltativo: true }, note: { tipo: 'testo_lungo', facoltativo: true } },
    clienti: { nome: { tipo: 'testo', facoltativo: true }, email: { tipo: 'email', facoltativo: true } },
  },
  permessi: { articoli: { leggi: true }, vendite: { leggi: true, crea: true }, clienti: { leggi: true, crea: true } },
  prova: async k => { const u = await chiama(k, 'get', '/users/me'); return { ok: !!u?.user_id, messaggio: u?.shop_id ? `negozio ${u.shop_id}` : 'account senza negozio' }; },
  pianificati: {
    offerte: { nome: 'Inserzioni Etsy ↔ articoli', ogni: '6h', async giro(k) {
      const s = await negozio(k), conti = { collegati: 0, sconosciuti: 0 };
      for await (const l of pagine(k, `/shops/${s}/listings?state=active&includes=Inventory`)) for (const x of l) for (const p of x.inventory?.products || []) {
        if (!p.sku) continue; const a = k.dati.trova('articoli', 'codice', p.sku);
        if (a) { k.sincro.collega('articoli', a.id, `${x.listing_id}:${p.sku}`); conti.collegati++; } else conti.sconosciuti++;
      }
      return conti;
    } },
    ordini: { nome: 'Ordini da Etsy', ogni: '15m', async giro(k) {
      const s = await negozio(k), da = Number(k.stato.leggi('ordini') || Math.floor(Date.now() / 1000) - 7 * 86400), conti = { vendite: 0, ignorati: 0 }; let ultimo = da;
      for await (const l of pagine(k, `/shops/${s}/receipts?was_paid=true&min_last_modified=${da}`)) for (const r of l) {
        ultimo = Math.max(ultimo, Number(r.updated_timestamp || 0));
        if (!r.is_paid || /cancel/i.test(r.status || '')) { conti.ignorati++; continue; }
        const e = importaOrdine(k, { id: r.receipt_id, numero: r.receipt_id, canale: 'Etsy',
          cliente: { nome: r.name, email: r.buyer_email, via: [r.first_line, r.second_line].filter(Boolean).join(' '), cap: r.zip, comune: r.city, provincia: r.state },
          linee: (r.transactions || []).map(t => ({ sku: t.sku, nome: t.title, q: t.quantity, prezzo: soldi(t.price) })) });
        if (e === 'vendita creata') conti.vendite++; else conti.ignorati++;
      }
      k.stato.scrivi('ordini', ultimo);
      return conti;
    } },
  },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const rid = k.sincro.remoto('articoli', riga.id); if (!rid) return;
    const [listing, ...resto] = String(rid).split(':'), sku = resto.join(':');
    const inv = await chiama(k, 'get', `/listings/${listing}/inventory`), corpo = perScrivere(inv), p = corpo.products.find(x => x.sku === sku);
    if (!p) throw new Error(`SKU ${sku} sparito dall'inserzione ${listing}`);
    for (const o of p.offerings) o.quantity = Math.max(0, Math.round(Number(k.valore(riga, 'articoli', 'giacenza') || 0)));
    await chiama(k, 'put', `/listings/${listing}/inventory`, corpo);
  } } },
  azioni: {
    spedito: {
      nome: 'Tracking su Etsy', descrizione: 'manda il tracking di un ordine Etsy (la ricevuta diventa spedita e il cliente riceve l\'avviso)', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, tracking: { tipo: 'testo', nome: 'Numero di tracking' }, corriere: { tipo: 'testo', nome: 'Corriere' } },
      proponi: ({ vendita, tracking, corriere }, k) => { const v = venditaDa(k, vendita), o = k.sincro.remoto('vendite', v.id);
        return { titolo: 'Tracking su Etsy', righe: [['Ricevuta Etsy', o || '—'], ['Corriere', corriere || '—'], ['Tracking', tracking]], avvisi: o ? [] : ['Questa vendita non viene da Etsy'] }; },
      async esegui({ vendita, tracking, corriere }, k) {
        const v = venditaDa(k, vendita), o = k.sincro.remoto('vendite', v.id); if (!o) throw new Error('Questa vendita non viene da Etsy');
        await chiama(k, 'post', `/shops/${await negozio(k)}/receipts/${o}/tracking`, { tracking_code: String(tracking), carrier_name: corriere || 'other' });
        return { ok: true, ricevuta: o };
      },
    },
  },
  catalogo: {
    categoria: 'marketplace', sito: 'https://www.etsy.com/it/sell', costo: 'a-consumo',
    costoNota: 'L\'API è gratuita. Su Etsy paghi 0,20 $ per inserzione (dura 4 mesi), il 6,5 % di commissione sulla transazione e la commissione di pagamento (in Italia 4 % + 0,30 €).',
    serve: [
      { cosa: 'Un\'app Etsy: Keystring e Shared secret', dove: 'etsy.com/developers › Your Apps › Create a New App', link: 'https://www.etsy.com/developers/your-apps' },
      { cosa: 'L\'indirizzo di ritorno di Kubo tra i Callback URLs dell\'app (…/api/connettori/etsy/oauth/ritorno)', dove: 'Your Apps › la tua app › Edit › Callback URLs', link: 'https://developer.etsy.com/documentation/essentials/authentication/' },
    ],
    passi: [
      'Su etsy.com/developers crea una nuova app (uso personale per il tuo negozio): copia Keystring e Shared secret.',
      'Nella stessa app aggiungi come Callback URL l\'indirizzo di ritorno che Kubo mostra in questa pagina (finisce con /api/connettori/etsy/oauth/ritorno).',
      'In Kubo incolla Keystring e Shared secret e accendi il connettore.',
      'Premi «Collega l\'account», accedi a Etsy e consenti: Kubo riceve il token e lo rinnova da solo.',
      'Lancia «Inserzioni Etsy ↔ articoli»: le varianti si collegano agli articoli con lo stesso SKU.',
      'Da qui gli ordini pagati arrivano ogni 15 minuti; il tracking si manda dalla vendita o chiedendolo a Lumi.',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developer.etsy.com/documentation/essentials/authentication/', 'https://developer.etsy.com/documentation/reference/#operation/getShopReceipts', 'https://developer.etsy.com/documentation/tutorials/listings/#updating-a-listings-inventory', 'https://developer.etsy.com/documentation/reference/#operation/createReceiptShipment'],
    prova: 'finto', parole: ['etsy', 'marketplace', 'artigianato', 'handmade', 'vintage', 'ordini', 'ricevute', 'giacenze', 'receipts', 'inventory'],
  },
  testi: {
    en: { descrizione: 'Etsy orders become sales with the customer, listing stock follows Kubo, tracking goes on the receipt.', 'imp.keystring': 'App keystring (API key)', 'imp.shared_secret': 'App shared secret', 'az.spedito': 'Tracking on Etsy', 'giro.offerte': 'Etsy listings ↔ items', 'giro.ordini': 'Orders from Etsy',
      'cat.costoNota': 'The API is free. On Etsy you pay $0.20 per listing (lasts 4 months), a 6.5% transaction fee and the payment processing fee (in Italy 4% + €0.30).',
      'cat.serve': [{ cosa: 'An Etsy app: Keystring and Shared secret', dove: 'etsy.com/developers › Your Apps › Create a New App' }, { cosa: 'Kubo\'s return address among the app Callback URLs (…/api/connettori/etsy/oauth/ritorno)', dove: 'Your Apps › your app › Edit › Callback URLs' }],
      'cat.passi': ['On etsy.com/developers create a new app (personal use for your shop): copy Keystring and Shared secret.', 'In the same app add as Callback URL the return address Kubo shows on this page (it ends with /api/connettori/etsy/oauth/ritorno).', 'In Kubo paste Keystring and Shared secret and switch the connector on.', 'Press «Connect account», sign in to Etsy and allow: Kubo gets the token and renews it by itself.', 'Run «Etsy listings ↔ items»: variations link to items with the same SKU.', 'From then on paid orders arrive every 15 minutes; send tracking from the sale or ask Lumi.'] },
    es: { descrizione: 'Los pedidos de Etsy pasan a ventas con el cliente, el stock de los anuncios sigue a Kubo, el seguimiento va al recibo.', 'imp.keystring': 'Keystring de la app (API key)', 'imp.shared_secret': 'Shared secret de la app', 'az.spedito': 'Seguimiento en Etsy', 'giro.offerte': 'Anuncios de Etsy ↔ artículos', 'giro.ordini': 'Pedidos de Etsy' },
    fr: { descrizione: 'Les commandes Etsy deviennent des ventes avec le client, le stock des annonces suit Kubo, le suivi va sur le reçu.', 'imp.keystring': 'Keystring de l\'app (clé API)', 'imp.shared_secret': 'Shared secret de l\'app', 'az.spedito': 'Suivi sur Etsy', 'giro.offerte': 'Annonces Etsy ↔ articles', 'giro.ordini': 'Commandes Etsy' },
    de: { descrizione: 'Etsy-Bestellungen werden Verkäufe mit Kunde, der Bestand der Angebote folgt Kubo, die Sendungsnummer geht auf die Quittung.', 'imp.keystring': 'Keystring der App (API-Schlüssel)', 'imp.shared_secret': 'Shared Secret der App', 'az.spedito': 'Sendungsnummer an Etsy', 'giro.offerte': 'Etsy-Angebote ↔ Artikel', 'giro.ordini': 'Bestellungen von Etsy' },
    pt: { descrizione: 'Os pedidos da Etsy viram vendas com o cliente, o estoque dos anúncios segue o Kubo, o rastreio vai para o recibo.', 'imp.keystring': 'Keystring do app (API key)', 'imp.shared_secret': 'Shared secret do app', 'az.spedito': 'Rastreio na Etsy', 'giro.offerte': 'Anúncios da Etsy ↔ artigos', 'giro.ordini': 'Pedidos da Etsy' },
  },
};
