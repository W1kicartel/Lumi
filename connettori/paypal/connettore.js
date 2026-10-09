// PayPal: link di pagamento (Orders v2) per vendite e fatture; l'ordine approvato si cattura e l'incasso segna pagata la riga.
// Accesso: client credentials con Basic (POST /v1/oauth2/token). L'ordine porta custom_id = «lumi-v-<id>» / «lumi-f-<id>».
// Webhook verificati con l'API verify-webhook-signature (le intestazioni PAYPAL-TRANSMISSION-* e il webhook_id del pannello):
// CHECKOUT.ORDER.APPROVED → capture; PAYMENT.CAPTURE.COMPLETED → incasso. Senza indirizzo pubblico basta il giro «controlla».
import { azioniLink, testiLink, incassa, tokenClient, RICHIEDE_INCASSI, PERMESSI_INCASSI } from '../_soldi/comuni.js';

const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
const token = k => tokenClient(k, `${base(k)}/v1/oauth2/token`, k.segreti.client_id, k.segreti.segreto);
const api = async (k, metodo, percorso, json, intestazioni = {}) => k.http.richiesta(metodo, base(k) + percorso, { bearer: await token(k), json, intestazioni });
const errore = r => new Error(`PayPal ha risposto ${r.stato}: ${String(r.json?.message || r.json?.error_description || r.testo || '').slice(0, 200)}`);
const ORDINE = /^[A-Z0-9]{8,40}$/;

// l'incasso da una cattura completata
const daCattura = (k, c) => c?.status !== 'COMPLETED' ? `ignorato: cattura ${c?.status}` : incassa(k, c.custom_id, { importo: Number(c.amount?.value), valuta: c.amount?.currency_code, quando: Date.parse(c.create_time) || Date.now(), metodo: 'carta' });
// un ordine: approvato → si cattura (una volta: PayPal-Request-Id); completato → incasso
async function ordine(k, id) {
  let o = await api(k, 'GET', `/v2/checkout/orders/${id}`); if (!o.ok) throw errore(o);
  if (o.json.status === 'APPROVED') { o = await api(k, 'POST', `/v2/checkout/orders/${id}/capture`, {}, { 'PayPal-Request-Id': `lumi-cattura-${id}` }); if (!o.ok) throw errore(o); }
  if (['COMPLETED', 'VOIDED'].includes(o.json.status)) k.stato.scrivi('aperti', (k.stato.leggi('aperti') || []).filter(x => x.id !== id));
  const c = o.json.purchase_units?.[0]?.payments?.captures?.[0];
  return c ? daCattura(k, { ...c, custom_id: c.custom_id || o.json.purchase_units[0].custom_id }) : `ignorato: ordine ${o.json.status}`;
}

export default {
  id: 'paypal', nome: 'PayPal', versione: 1, icona: 'cassa',
  descrizione: 'Link di pagamento PayPal per vendite e fatture: l\'ordine pagato segna pagata la riga.',
  impostazioni: [
    { id: 'client_id', nome: 'Client ID dell\'app REST', segreto: true },
    { id: 'segreto', nome: 'Secret dell\'app REST', segreto: true },
    { id: 'webhook_id', nome: 'Webhook ID (dal pannello sviluppatori, facoltativo)', obbligatorio: false },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'ritorno', nome: 'Pagina dopo il pagamento (es. il tuo sito)', schema: /^https:\/\/[^\s]+$/, obbligatorio: false },
  ],
  richiede: RICHIEDE_INCASSI,
  permessi: PERMESSI_INCASSI,
  prova: async k => { try { await token(k); return { ok: true }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: azioniLink('PayPal', async (k, { importo, rif, descrizione }) => {
    const ritorno = k.imp.ritorno || 'https://www.paypal.com';
    const r = await api(k, 'POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: rif, custom_id: rif, description: descrizione.slice(0, 127), amount: { currency_code: 'EUR', value: importo.toFixed(2) } }],
      payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: ritorno, cancel_url: ritorno } } },
    }, { 'PayPal-Request-Id': `${rif}-${Date.now()}` });
    if (!r.ok) throw errore(r);
    const url = (r.json.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve')?.href;
    k.stato.scrivi('aperti', [...(k.stato.leggi('aperti') || []), { id: r.json.id, rif, creato: Date.now() }].slice(-500));
    return { url, id: r.json.id };
  }),
  entrata: {
    // la firma la controlla PayPal stesso: POST /v1/notifications/verify-webhook-signature con l'evento e le intestazioni
    firma: { tipo: 'verifica', async verifica({ req, grezzo, k }) {
      const h = n => req.headers[n]; if (!k.imp.webhook_id || !h('paypal-transmission-sig')) return false;
      let ev; try { ev = JSON.parse(grezzo.toString('utf8')); } catch { return false; }
      const r = await api(k, 'POST', '/v1/notifications/verify-webhook-signature', { auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'), webhook_id: k.imp.webhook_id, webhook_event: ev });
      return r.ok && r.json?.verification_status === 'SUCCESS';
    } },
    idempotenza: ev => ev.id,
    async gestisci(ev, k) {
      const o = ev.resource || {};
      if (ev.event_type === 'PAYMENT.CAPTURE.COMPLETED') return daCattura(k, o);
      if (ev.event_type === 'CHECKOUT.ORDER.APPROVED' && ORDINE.test(String(o.id || ''))) return ordine(k, o.id);
      if (ev.event_type === 'PAYMENT.CAPTURE.DENIED' || ev.event_type === 'PAYMENT.CAPTURE.REVERSED' || ev.event_type === 'PAYMENT.CAPTURE.REFUNDED') return k.avvisa(`pagamento ${o.id} ${ev.event_type.split('.').pop().toLowerCase()} (${o.custom_id || '—'}): controllalo`);
      return 'ignorato';
    },
  },
  pianificati: {
    controlla: { ogni: '10m', async giro(k) {
      const aperti = (k.stato.leggi('aperti') || []).filter(x => Date.now() - x.creato < 3 * 864e5); k.stato.scrivi('aperti', aperti);
      const esiti = []; for (const x of aperti) esiti.push(await ordine(k, x.id));
      return { controllati: aperti.length, pagati: esiti.filter(e => e === 'pagata').length };
    } },
  },
  catalogo: {
    categoria: 'pagamenti', sito: 'https://www.paypal.com/it/business',
    costo: 'a-consumo', costoNota: 'Nessun canone. Commissione per le vendite nazionali con PayPal 3,40% + 0,35 € a transazione; altri metodi e Paesi su paypal.com/it/business/paypal-business-fees.',
    serve: [
      { cosa: 'Client ID e Secret di un\'app REST', dove: 'developer.paypal.com › Apps & Credentials › Create App (scheda Sandbox per le prove, Live per i pagamenti veri)', link: 'https://developer.paypal.com/dashboard/applications' },
      { cosa: 'Webhook ID (facoltativo, per l\'avviso immediato)', dove: 'La stessa app › Webhooks › Add Webhook con l\'indirizzo che mostra Lumi, eventi Checkout order approved e Payment capture completed', link: 'https://developer.paypal.com/dashboard/applications' },
    ],
    passi: ['Accedi a developer.paypal.com con il conto PayPal Business.', 'Crea un\'app REST (prima in Sandbox per provare).', 'Copia Client ID e Secret in Lumi e scegli l\'ambiente.', 'Se Lumi ha un indirizzo pubblico, aggiungi il webhook con l\'indirizzo mostrato da Lumi e incolla il Webhook ID.', 'Senza webhook Lumi controlla gli ordini aperti ogni 10 minuti.', 'Premi «Prova la connessione», accendi e crea il primo link da una vendita o da una fattura.'],
    difficolta: 'media', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://developer.paypal.com/docs/api/orders/v2/', 'https://developer.paypal.com/api/rest/authentication/', 'https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post', 'https://www.paypal.com/it/business/paypal-business-fees'],
    prova: 'finto', parole: ['paypal', 'link di pagamento', 'pagamento online', 'carta', 'payment link', 'checkout', 'incasso'],
  },
  testi: {
    en: { descrizione: 'PayPal payment links for sales and invoices: the paid order marks the record paid.', 'imp.client_id': 'REST app Client ID', 'imp.segreto': 'REST app Secret', 'imp.webhook_id': 'Webhook ID (from the developer dashboard, optional)', 'imp.ambiente': 'Environment', 'imp.ritorno': 'Page after payment (e.g. your website)', ...testiLink('Payment link', 'sale', 'invoice'), 'giro.controlla': 'Check open orders',
      'cat.costoNota': 'No monthly fee. Domestic PayPal sales cost 3.40% + €0.35 per transaction; other methods and countries at paypal.com/it/business/paypal-business-fees.',
      'cat.serve': [{ cosa: 'Client ID and Secret of a REST app', dove: 'developer.paypal.com › Apps & Credentials › Create App (Sandbox tab for tests, Live for real payments)' }, { cosa: 'Webhook ID (optional, for instant notice)', dove: 'Same app › Webhooks › Add Webhook with the address Lumi shows, events Checkout order approved and Payment capture completed' }],
      'cat.passi': ['Sign in to developer.paypal.com with the PayPal Business account.', 'Create a REST app (Sandbox first, to test).', 'Copy Client ID and Secret into Lumi and pick the environment.', 'If Lumi has a public address, add the webhook with the address Lumi shows and paste the Webhook ID.', 'Without a webhook Lumi checks open orders every 10 minutes.', 'Press «Test connection», switch on and create the first link from a sale or an invoice.'] },
    es: { descrizione: 'Enlaces de pago PayPal para ventas y facturas: el pedido pagado marca la fila como pagada.', 'imp.client_id': 'Client ID de la app REST', 'imp.segreto': 'Secret de la app REST', 'imp.webhook_id': 'Webhook ID (del panel de desarrolladores, opcional)', 'imp.ambiente': 'Entorno', 'imp.ritorno': 'Página tras el pago (p. ej. tu web)', ...testiLink('Enlace de pago', 'venta', 'factura'), 'giro.controlla': 'Revisar pedidos abiertos' },
    fr: { descrizione: 'Liens de paiement PayPal pour ventes et factures : la commande payée marque la ligne payée.', 'imp.client_id': 'Client ID de l\'app REST', 'imp.segreto': 'Secret de l\'app REST', 'imp.webhook_id': 'Webhook ID (du tableau de bord développeur, facultatif)', 'imp.ambiente': 'Environnement', 'imp.ritorno': 'Page après le paiement (ex. votre site)', ...testiLink('Lien de paiement', 'vente', 'facture'), 'giro.controlla': 'Vérifier les commandes ouvertes' },
    de: { descrizione: 'PayPal-Zahlungslinks für Verkäufe und Rechnungen: die bezahlte Bestellung markiert den Datensatz als bezahlt.', 'imp.client_id': 'Client-ID der REST-App', 'imp.segreto': 'Secret der REST-App', 'imp.webhook_id': 'Webhook-ID (aus dem Entwickler-Dashboard, optional)', 'imp.ambiente': 'Umgebung', 'imp.ritorno': 'Seite nach der Zahlung (z. B. deine Website)', ...testiLink('Zahlungslink', 'Verkauf', 'Rechnung'), 'giro.controlla': 'Offene Bestellungen prüfen' },
    pt: { descrizione: 'Links de pagamento PayPal para vendas e faturas: o pedido pago marca o registro como pago.', 'imp.client_id': 'Client ID do app REST', 'imp.segreto': 'Secret do app REST', 'imp.webhook_id': 'Webhook ID (do painel de desenvolvedores, opcional)', 'imp.ambiente': 'Ambiente', 'imp.ritorno': 'Página após o pagamento (ex.: seu site)', ...testiLink('Link de pagamento', 'venda', 'fatura'), 'giro.controlla': 'Verificar pedidos abertos' },
  },
};
