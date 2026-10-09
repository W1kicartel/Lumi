// Square: link di pagamento online e Square Terminal in negozio, per chi vende in Spagna, Francia e Irlanda (Square non c'è in Italia).
// API: https://developer.squareup.com/reference/square (Bearer, «Square-Version»). Il link crea un ordine con «reference_id» = il
// riferimento di Kubo; il Terminal riceve un checkout con lo stesso «reference_id».
// Webhook: «x-square-hmacsha256-signature» = base64(HMAC-SHA256(signature key, indirizzo di notifica + corpo grezzo))
// (https://developer.squareup.com/docs/webhooks/step3validate): l'indirizzo deve essere identico a quello scritto in Square.
// Il corpo non basta: pagamento, ordine e checkout si rileggono dall'API.
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { RICHIEDE_INCASSI, PERMESSI_INCASSI, azioniLink, testiLink, incassa, daIncassare, daRiferimento, riferimento, nomeRiga, pubblicoDi } from '../_soldi/comuni.js';

const VERSIONE = '2026-09-16';
const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com');
const opz = k => ({ bearer: k.segreti.token, intestazioni: { 'Square-Version': VERSIONE } });
const errore = r => new Error(r.json?.errors?.[0]?.detail || `Square ha risposto ${r.stato}`);
// l'indirizzo di notifica da scrivere in Square: l'indirizzo pubblico di Kubo (il suo o, se vuoto, quello https della Libreria)
// + /api/connettori/square/in
const notifica = k => pubblicoDi(k) ? `${pubblicoDi(k)}/api/connettori/square/in` : null;
const sicuro = id => /^[\w-]{1,192}$/.test(String(id || ''));
const metodo = t => t === 'CASH' ? 'contanti' : t === 'BANK_ACCOUNT' ? 'bonifico' : 'carta';

function verifica({ req, grezzo, segreto, k }) {
  const url = notifica(k), h = String(req.headers['x-square-hmacsha256-signature'] || '');
  if (!url || !h) return false;
  const atteso = createHmac('sha256', segreto).update(url).update(grezzo).digest(), dato = Buffer.from(h, 'base64');
  return dato.length === atteso.length && timingSafeEqual(dato, atteso);
}

async function leggi(k, percorso, cosa) {
  const r = await k.http.get(`${base(k)}${percorso}`, opz(k));
  if (r.stato === 404) return null;
  if (!r.ok) throw errore(r);
  return r.json?.[cosa];
}

// un pagamento COMPLETED: il riferimento sta nel pagamento (Terminal) o nell'ordine del link di pagamento
async function pagamento(k, id) {
  const p = await leggi(k, `/v2/payments/${encodeURIComponent(id)}`, 'payment');
  if (!p) return 'ignorato: pagamento sconosciuto';
  if (p.status !== 'COMPLETED') return `ignorato: ${p.status}`;
  let rif = daRiferimento(p.reference_id) ? p.reference_id : null;
  if (!rif && sicuro(p.order_id)) rif = (await leggi(k, `/v2/orders/${encodeURIComponent(p.order_id)}`, 'order'))?.reference_id;
  if (!daRiferimento(rif)) return 'ignorato: senza riga di Kubo';
  return incassa(k, rif, { importo: Number(p.amount_money?.amount) / 100, valuta: p.amount_money?.currency, quando: Date.parse(p.updated_at || p.created_at) || Date.now(), metodo: metodo(p.source_type), fonte: 'Square' });
}
async function checkout(k, id) {
  const c = await leggi(k, `/v2/terminals/checkouts/${encodeURIComponent(id)}`, 'checkout');
  if (!c) return 'ignorato: checkout sconosciuto';
  if (c.status !== 'COMPLETED') return `ignorato: ${c.status}`;
  return incassa(k, c.reference_id, { importo: Number(c.amount_money?.amount) / 100, valuta: c.amount_money?.currency, quando: Date.parse(c.updated_at) || Date.now(), metodo: 'carta', fonte: 'Square' });
}

export default {
  id: 'square', nome: 'Square', versione: 1, icona: 'cassa',
  descrizione: 'Link di pagamento e Square Terminal (Spagna, Francia, Irlanda): le vendite e le fatture si segnano pagate da sole.',
  impostazioni: [
    { id: 'token', nome: 'Access token', segreto: true, schema: /^[\w-]{20,}$/ },
    { id: 'firma', nome: 'Signature key del webhook', segreto: true },
    { id: 'luogo', nome: 'Location ID (il negozio in Square)', schema: /^[\w-]{1,64}$/ },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (per il webhook)', tipo: 'url', obbligatorio: false },
    { id: 'ritorno', nome: 'Pagina dopo il pagamento (es. il tuo sito)', tipo: 'url', obbligatorio: false },
    { id: 'terminale', nome: 'Device ID dello Square Terminal', obbligatorio: false, schema: /^[\w:-]{1,64}$/ },
  ],
  richiede: RICHIEDE_INCASSI,
  permessi: PERMESSI_INCASSI,
  prova: async k => { const r = await k.http.get(`${base(k)}/v2/locations`, opz(k)); return { ok: r.ok, messaggio: r.ok ? null : r.json?.errors?.[0]?.detail || `HTTP ${r.stato}` }; },
  entrata: {
    firma: { tipo: 'verifica', segreto: 'firma', verifica },
    idempotenza: ev => String(ev?.event_id || ''),
    async gestisci(ev, k) {
      const o = ev?.data?.object || {};
      if (ev?.type === 'payment.created' || ev?.type === 'payment.updated') { const id = o.payment?.id || ev.data?.id; return sicuro(id) ? pagamento(k, id) : 'ignorato'; }
      if (ev?.type === 'terminal.checkout.updated') { const id = o.checkout?.id || ev.data?.id; return sicuro(id) ? checkout(k, id) : 'ignorato'; }
      return 'ignorato';
    },
  },
  azioni: {
    ...azioniLink('Square', async (k, { cent, rif, descrizione }) => {
      if (!k.imp.luogo) throw new Error('Manca il Location ID nelle impostazioni');
      const r = await k.http.post(`${base(k)}/v2/online-checkout/payment-links`, { ...opz(k), json: {
        idempotency_key: randomUUID(), payment_note: rif,
        order: { location_id: k.imp.luogo, reference_id: rif, line_items: [{ name: descrizione.slice(0, 500), quantity: '1', base_price_money: { amount: cent, currency: 'EUR' } }] },
        ...(k.imp.ritorno ? { checkout_options: { redirect_url: k.imp.ritorno } } : {}) } });
      if (!r.ok) throw errore(r);
      return { url: r.json.payment_link?.url, id: r.json.payment_link?.id };
    }),
    // l'importo va allo Square Terminal del negozio: il cliente appoggia la carta
    terminale: {
      nome: 'Incassa allo Square Terminal', descrizione: 'Manda l\'importo di una vendita allo Square Terminal', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'relazione', entita: 'vendite', nome: 'La vendita da incassare' } },
      proponi: async ({ vendita }, k) => ({ titolo: 'Square Terminal', righe: [['Vendita', k.valore(vendita, 'vendite', 'numero') || vendita.id], ['Importo', k.euro(daIncassare(k, 'vendite', vendita))]],
        avvisi: [...(k.imp.terminale ? [] : ['Manca il Device ID del Terminal nelle impostazioni']), ...(k.valore(vendita, 'vendite', 'stato') === 'pagata' ? ['È già pagata'] : [])] }),
      async esegui({ vendita }, k) {
        if (!k.imp.terminale) throw new Error('Manca il Device ID dello Square Terminal nelle impostazioni');
        if (k.valore(vendita, 'vendite', 'stato') === 'pagata') throw new Error('È già pagata');
        const importo = daIncassare(k, 'vendite', vendita); if (!(importo > 0)) throw new Error('L\'importo da pagare è zero');
        const r = await k.http.post(`${base(k)}/v2/terminals/checkouts`, { ...opz(k), json: { idempotency_key: randomUUID(), checkout: {
          amount_money: { amount: Math.round(importo * 100), currency: 'EUR' }, reference_id: riferimento('vendite', vendita.id), note: nomeRiga(k, 'vendite', vendita).slice(0, 250),
          device_options: { device_id: k.imp.terminale } } } });
        if (!r.ok) throw errore(r);
        return { id: r.json.checkout?.id, stato: r.json.checkout?.status };
      },
    },
  },
  catalogo: {
    categoria: 'pagamenti',
    sito: 'https://squareup.com/es/es',
    costo: 'a-consumo',
    costoNota: 'Nessun canone: si paga a transazione. Prezzi indicativi con le carte europee: in negozio circa 1,25% in Spagna, 1,65% in Francia e 1,75% in Irlanda; online circa 1,4% + 0,25 €. Il lettore o lo Square Terminal si comprano a parte. Square non è disponibile in Italia. Prezzi aggiornati sul sito Square del tuo Paese.',
    serve: [
      { cosa: 'Access token dell\'applicazione (Sandbox per provare, Production per incassare)', dove: 'Developer Console Square → Applications → la tua app → Credentials', link: 'https://developer.squareup.com/apps' },
      { cosa: 'Location ID del negozio', dove: 'Developer Console Square → la tua app → Locations', link: 'https://developer.squareup.com/apps' },
      { cosa: 'Signature key del webhook', dove: 'Developer Console Square → la tua app → Webhooks → Subscriptions', link: 'https://developer.squareup.com/apps' },
    ],
    passi: [
      'Crea l\'account Square nel tuo Paese (Spagna, Francia o Irlanda) e un\'applicazione nella Developer Console.',
      'Copia l\'access token e il Location ID e incollali in Kubo; scegli l\'ambiente (prova o produzione).',
      'Scrivi in Kubo l\'indirizzo pubblico di Kubo (se hai impostato l\'indirizzo pubblico di Kubo nella Libreria, puoi lasciarlo vuoto).',
      'In Webhooks → Subscriptions aggiungi l\'indirizzo …/api/connettori/square/in, identico, con gli eventi payment.created, payment.updated e terminal.checkout.updated.',
      'Copia la signature key della sottoscrizione in Kubo e accendi il connettore.',
      'Per il negozio, abbina lo Square Terminal e scrivi in Kubo il suo Device ID.',
      'Prova con un link di pagamento da una vendita in Sandbox.',
    ],
    difficolta: 'media',
    zone: ['UE', 'mondo'],
    fonti: ['https://developer.squareup.com/reference/square/checkout-api/create-payment-link', 'https://developer.squareup.com/docs/webhooks/step3validate', 'https://developer.squareup.com/reference/square/payments-api/get-payment', 'https://developer.squareup.com/reference/square/orders-api/retrieve-order', 'https://developer.squareup.com/reference/square/terminal-api/create-terminal-checkout'],
    prova: 'finto',
    parole: ['square', 'pos', 'terminale', 'lettore di carte', 'link di pagamento', 'spagna', 'francia', 'irlanda', 'payment link', 'card reader', 'point of sale'],
  },
  testi: {
    en: { descrizione: 'Payment links and Square Terminal (Spain, France, Ireland): sales and invoices get marked paid on their own.', 'imp.token': 'Access token', 'imp.firma': 'Webhook signature key', 'imp.luogo': 'Location ID (the shop in Square)', 'imp.ambiente': 'Environment', 'imp.indirizzo': 'Public address of Kubo (for the webhook)', 'imp.ritorno': 'Page after payment (e.g. your website)', 'imp.terminale': 'Square Terminal device ID',
      ...testiLink('Payment link', 'sale', 'invoice'), 'az.terminale': 'Charge on the Square Terminal',
      'cat.costoNota': 'No monthly fee: you pay per transaction. Indicative prices with European cards: in store about 1.25% in Spain, 1.65% in France and 1.75% in Ireland; online about 1.4% + €0.25. The reader or Square Terminal is bought separately. Square is not available in Italy. Current prices on the Square site of your country.',
      'cat.serve': [{ cosa: 'Application access token (Sandbox to try, Production to get paid)', dove: 'Square Developer Console → Applications → your app → Credentials' }, { cosa: 'Location ID of the shop', dove: 'Square Developer Console → your app → Locations' }, { cosa: 'Webhook signature key', dove: 'Square Developer Console → your app → Webhooks → Subscriptions' }],
      'cat.passi': ['Create the Square account in your country (Spain, France or Ireland) and an application in the Developer Console.', 'Copy the access token and the Location ID into Kubo; pick the environment (test or production).', 'Enter Kubo\'s public address in Kubo (if you set Kubo\'s public address in the Library, you can leave it empty).', 'In Webhooks → Subscriptions add the address …/api/connettori/square/in, exactly, with the events payment.created, payment.updated and terminal.checkout.updated.', 'Copy the subscription\'s signature key into Kubo and switch the connector on.', 'For the shop, pair the Square Terminal and enter its Device ID in Kubo.', 'Try a payment link from a sale in Sandbox.'] },
    es: { descrizione: 'Enlaces de pago y Square Terminal (España, Francia, Irlanda): las ventas y facturas se marcan pagadas solas.', 'imp.token': 'Access token', 'imp.firma': 'Clave de firma del webhook', 'imp.luogo': 'Location ID (la tienda en Square)', 'imp.ambiente': 'Entorno', 'imp.indirizzo': 'Dirección pública de Kubo (para el webhook)', 'imp.ritorno': 'Página tras el pago (p. ej. tu web)', 'imp.terminale': 'Device ID del Square Terminal',
      ...testiLink('Enlace de pago', 'venta', 'factura'), 'az.terminale': 'Cobrar en el Square Terminal' },
    fr: { descrizione: 'Liens de paiement et Square Terminal (Espagne, France, Irlande) : les ventes et factures se marquent payées toutes seules.', 'imp.token': 'Access token', 'imp.firma': 'Clé de signature du webhook', 'imp.luogo': 'Location ID (la boutique dans Square)', 'imp.ambiente': 'Environnement', 'imp.indirizzo': 'Adresse publique de Kubo (pour le webhook)', 'imp.ritorno': 'Page après le paiement (ex. votre site)', 'imp.terminale': 'Device ID du Square Terminal',
      ...testiLink('Lien de paiement', 'vente', 'facture'), 'az.terminale': 'Encaisser sur le Square Terminal' },
    de: { descrizione: 'Zahlungslinks und Square Terminal (Spanien, Frankreich, Irland): Verkäufe und Rechnungen werden von selbst als bezahlt markiert.', 'imp.token': 'Access Token', 'imp.firma': 'Signaturschlüssel des Webhooks', 'imp.luogo': 'Location ID (das Geschäft in Square)', 'imp.ambiente': 'Umgebung', 'imp.indirizzo': 'Öffentliche Adresse von Kubo (für den Webhook)', 'imp.ritorno': 'Seite nach der Zahlung (z. B. deine Website)', 'imp.terminale': 'Device ID des Square Terminal',
      ...testiLink('Zahlungslink', 'Verkauf', 'Rechnung'), 'az.terminale': 'Am Square Terminal kassieren' },
    pt: { descrizione: 'Links de pagamento e Square Terminal (Espanha, França, Irlanda): vendas e faturas são marcadas como pagas sozinhas.', 'imp.token': 'Access token', 'imp.firma': 'Chave de assinatura do webhook', 'imp.luogo': 'Location ID (a loja no Square)', 'imp.ambiente': 'Ambiente', 'imp.indirizzo': 'Endereço público do Kubo (para o webhook)', 'imp.ritorno': 'Página após o pagamento (ex.: seu site)', 'imp.terminale': 'Device ID do Square Terminal',
      ...testiLink('Link de pagamento', 'venda', 'fatura'), 'az.terminale': 'Cobrar no Square Terminal' },
  },
};
