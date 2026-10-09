// Scalapay: «paga in 3 o 4 rate» per vendite e fatture. Il negozio incassa tutto subito, il cliente paga a rate.
// API v2 con Bearer (la chiave API): POST /v2/orders → { token, checkoutUrl }. Il cliente conferma e Scalapay lo rimanda a
// redirectConfirmUrl?orderToken=…&status=SUCCESS: qui il negozio DEVE catturare (POST /v2/payments/capture → APPROVED),
// altrimenti l'ordine scade. Kubo cattura dalla rotta pubblica «conferma» (con un indirizzo pubblico) o dal giro
// «controlla» ogni 10 minuti (app sul PC): GET /v2/payments/{token} → «authorized» si cattura, «charged» è già incassato.
// Si cattura solo un token creato da Kubo (lo stato «aperti»); l'importo e lo stato si rileggono sempre da Scalapay.
// Fonti: https://developers.scalapay.com/reference/post_v2-orders, …/get_v2-payments-token, …/post_v2-payments-capture
import { azioniLink, testiLink, incassa, RICHIEDE_INCASSI, PERMESSI_INCASSI } from '../_soldi/comuni.js';

const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://api.scalapay.com' : 'https://integration.api.scalapay.com');
const api = (k, metodo, percorso, json) => k.http.richiesta(metodo, base(k) + percorso, { bearer: k.segreti.chiave, json });
const errore = r => new Error(`Scalapay ha risposto ${r.stato}: ${String(r.json?.message || r.json?.errorCode || r.json?.error || r.testo || '').slice(0, 200)}`);
const TOKEN = /^[\w-]{4,80}$/;
const soldi = n => ({ amount: Number(n).toFixed(2), currency: 'EUR' });
const aperti = k => k.stato.leggi('aperti') || [];
const togli = (k, token) => k.stato.scrivi('aperti', aperti(k).filter(x => x.token !== token));

// il cliente della riga (vendita o fattura), se c'è e si può leggere: Scalapay vuole nome, cognome, email e telefono
function cliente(k, r) {
  const id = r.cliente?.id ?? r.cliente; if (!id) return {};
  try { const c = k.dati.leggi('clienti', String(id)); return { nome: k.valore(c, 'clienti', 'nome'), email: k.valore(c, 'clienti', 'email'), telefono: k.valore(c, 'clienti', 'telefono'),
    via: k.valore(c, 'clienti', 'via'), cap: k.valore(c, 'clienti', 'cap'), comune: k.valore(c, 'clienti', 'comune'), nazione: k.valore(c, 'clienti', 'nazione') }; } catch { return {}; }
}

// cattura un ordine confermato dal cliente → incasso
async function cattura(k, x) {
  const r = await api(k, 'POST', '/v2/payments/capture', { token: x.token, merchantReference: x.rif });
  if (!r.ok) throw errore(r);
  if (String(r.json?.status).toUpperCase() !== 'APPROVED') return `ignorato: cattura ${r.json?.status}`;
  togli(k, x.token);
  const t = r.json.totalAmount || {};
  return incassa(k, r.json.merchantReference || x.rif, { importo: Number(t.amount ?? x.importo), valuta: t.currency || 'EUR', metodo: 'carta' });
}
// un ordine riletto da Scalapay: autorizzato → si cattura; già catturato → incasso; scaduto o rifiutato → non si guarda più
async function controlla(k, x) {
  const r = await api(k, 'GET', `/v2/payments/${encodeURIComponent(x.token)}`);
  if (!r.ok) return r.stato === 404 || r.stato === 422 ? 'ignorato: non ancora confermato' : Promise.reject(errore(r));
  const p = r.json, st = String(p.status || '').toLowerCase(), cs = String(p.captureStatus || '').toLowerCase();
  if (st === 'charged' || cs === 'captured') { togli(k, x.token); return incassa(k, p.orderDetails?.merchantReference || x.rif, { importo: Number(p.totalAmount?.amount), valuta: p.totalAmount?.currency, metodo: 'carta' }); }
  if (st === 'authorized' || st === 'approved') return cattura(k, x);
  if (['expired', 'declined', 'cancelled', 'canceled', 'refunded', 'voided'].includes(st)) { togli(k, x.token); return `ignorato: ${st}`; }
  return `ignorato: ${st || 'in attesa'}`;
}
const pagina = t => ({ tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${t}</title><p style="font:18px system-ui;margin:3em auto;max-width:30em;text-align:center">${t}</p>` });

export default {
  id: 'scalapay', nome: 'Scalapay', versione: 1, icona: 'cassa',
  descrizione: 'Il cliente paga in 3 o 4 rate con Scalapay, tu incassi subito: Kubo cattura l\'ordine e segna pagata la vendita o la fattura.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API Scalapay', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'rate', nome: 'Rate', tipo: 'scelta', opzioni: ['3', '4'], predefinito: '3' },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (per la conferma immediata, facoltativo)', schema: /^https:\/\/[^\s]+$/, obbligatorio: false },
    { id: 'ritorno', nome: 'Pagina dopo il pagamento (es. il tuo sito)', schema: /^https:\/\/[^\s]+$/, obbligatorio: false },
  ],
  richiede: { ...RICHIEDE_INCASSI, clienti: { nome: { facoltativo: true }, email: { tipo: ['email'], facoltativo: true }, telefono: { facoltativo: true } } },
  permessi: { ...PERMESSI_INCASSI, clienti: { leggi: true } },
  // una GET di un token inesistente: 401 se la chiave è sbagliata, 404/422 se la chiave va bene
  prova: async k => { const r = await api(k, 'GET', '/v2/payments/kubo-prova'); return { ok: r.stato !== 401 && r.stato !== 403 && r.stato < 500, messaggio: r.stato === 401 || r.stato === 403 ? 'Chiave API rifiutata' : null }; },
  azioni: azioniLink('Scalapay', async (k, { riga, importo, rif, descrizione }) => {
    const c = cliente(k, riga), [nome, ...cognome] = String(c.nome || '').trim().split(/\s+/);
    const pub = k.imp.indirizzo ? `${k.imp.indirizzo.replace(/\/$/, '')}/api/connettori/scalapay/pub/conferma` : null;
    const fuori = k.imp.ritorno || 'https://www.scalapay.com';
    const consumatore = { givenNames: nome || undefined, surname: cognome.join(' ') || undefined, email: c.email || undefined, phoneNumber: c.telefono || undefined };
    const spedizione = c.via && c.cap && c.comune ? { name: c.nome, line1: c.via, postcode: c.cap, suburb: c.comune, countryCode: c.nazione || 'IT', phoneNumber: c.telefono || undefined } : undefined;
    const r = await api(k, 'POST', '/v2/orders', {
      totalAmount: soldi(importo), consumer: consumatore, ...(spedizione ? { shipping: spedizione, billing: spedizione } : {}),
      items: [{ name: descrizione.slice(0, 100), category: 'altro', sku: rif, quantity: 1, price: soldi(importo) }],
      merchant: { redirectConfirmUrl: pub || fuori, redirectCancelUrl: pub ? `${pub}?annullato=1` : fuori },
      merchantReference: rif, type: 'online', product: k.imp.rate === '4' ? 'pay-in-4' : 'pay-in-3',
    });
    if (!r.ok || !r.json?.token) throw errore(r);
    k.stato.scrivi('aperti', [...aperti(k), { token: r.json.token, rif, importo, creato: Date.now() }].slice(-500));
    return { url: r.json.checkoutUrl, id: r.json.token };
  }),
  // GET /api/connettori/scalapay/pub/conferma?orderToken=…&status=SUCCESS: il cliente torna da Scalapay, si cattura subito
  pubbliche: {
    async conferma({ q, k }) {
      const token = String(q.get('orderToken') || ''), x = aperti(k).find(a => a.token === token);
      if (q.get('annullato') || String(q.get('status') || '').toUpperCase() !== 'SUCCESS') return pagina('Il pagamento con Scalapay non è stato completato.');
      if (!TOKEN.test(token) || !x) return pagina('Grazie! Il pagamento è in verifica.');
      let esito; try { esito = await cattura(k, x); } catch (e) { k.annota('entrata', 'errore', `conferma ${token}`, String(e.message).slice(0, 300)); return pagina('Grazie! Il pagamento è in verifica.'); }
      k.annota('entrata', 'ok', `conferma ${token}`, esito);
      return pagina(esito === 'pagata' || /già pagata/.test(esito) ? 'Pagamento ricevuto, grazie!' : 'Grazie! Il pagamento è in verifica.');
    },
  },
  pianificati: {
    controlla: { ogni: '10m', async giro(k) {
      const lista = aperti(k).filter(x => Date.now() - x.creato < 3 * 864e5); k.stato.scrivi('aperti', lista);
      const esiti = []; for (const x of lista) { try { esiti.push(await controlla(k, x)); } catch (e) { esiti.push(`errore: ${e.message}`); } }
      return { controllati: lista.length, pagati: esiti.filter(e => e === 'pagata').length };
    } },
  },
  catalogo: {
    categoria: 'pagamenti', sito: 'https://www.scalapay.com/it/business',
    costo: 'contratto', costoNota: 'Nessun canone pubblico: a ogni vendita Scalapay trattiene una commissione concordata nel contratto (non pubblicata, di solito qualche punto percentuale). Il cliente paga in 3 o 4 rate senza interessi, il negozio riceve subito l\'intero importo meno la commissione.',
    serve: [
      { cosa: 'Chiave API (in prova: la chiave di test pubblica della documentazione)', dove: 'Portale merchant Scalapay › Sviluppatori › Chiavi API (si ottiene dopo l\'attivazione del contratto)', link: 'https://developers.scalapay.com/docs' },
      { cosa: 'Un indirizzo pubblico https di Kubo (facoltativo)', dove: 'Il tuo dominio o un tunnel verso il computer di Kubo', link: 'https://developers.scalapay.com/reference/post_v2-payments-capture' },
    ],
    passi: ['Chiedi a Scalapay l\'attivazione come negozio (modulo su scalapay.com/it/business).', 'Per provare usa l\'ambiente «prova» con la chiave di test della documentazione.', 'Incolla la chiave API in Kubo e scegli 3 o 4 rate.', 'Se Kubo ha un indirizzo pubblico https, scrivilo: l\'ordine si cattura appena il cliente conferma; altrimenti Kubo controlla ogni 10 minuti.', 'Premi «Prova la connessione» e accendi.', 'Dalla vendita o dalla fattura crea il link Scalapay e mandalo al cliente.'],
    difficolta: 'media', zone: ['IT', 'UE'],
    fonti: ['https://developers.scalapay.com/reference/post_v2-orders', 'https://developers.scalapay.com/reference/post_v2-payments-capture', 'https://developers.scalapay.com/reference/get_v2-payments-token', 'https://developers.scalapay.com/docs'],
    prova: 'finto', parole: ['scalapay', 'rate', 'paga in 3 rate', 'paga in 4 rate', 'pagamento a rate', 'bnpl', 'buy now pay later', 'pay in 3', 'installments', 'link di pagamento'],
  },
  testi: {
    en: { descrizione: 'The customer pays in 3 or 4 instalments with Scalapay, you get paid at once: Kubo captures the order and marks the sale or invoice paid.', 'imp.chiave': 'Scalapay API key', 'imp.ambiente': 'Environment', 'imp.rate': 'Instalments', 'imp.indirizzo': 'Public Kubo address (for instant confirmation, optional)', 'imp.ritorno': 'Page after payment (e.g. your website)', ...testiLink('Scalapay link', 'sale', 'invoice'), 'giro.controlla': 'Capture confirmed orders',
      'cat.costoNota': 'No public fee: on each sale Scalapay keeps a commission set in the contract (not published, usually a few percent). The customer pays in 3 or 4 interest-free instalments, the shop gets the full amount at once minus the fee.',
      'cat.serve': [{ cosa: 'API key (for tests: the public test key in the documentation)', dove: 'Scalapay merchant portal › Developers › API keys (available once the contract is active)' }, { cosa: 'A public https address for Kubo (optional)', dove: 'Your domain or a tunnel to the Kubo computer' }],
      'cat.passi': ['Ask Scalapay to activate you as a merchant (form on scalapay.com/it/business).', 'To test, use the «prova» environment with the test key from the documentation.', 'Paste the API key in Kubo and choose 3 or 4 instalments.', 'If Kubo has a public https address, enter it: the order is captured as soon as the customer confirms; otherwise Kubo checks every 10 minutes.', 'Press «Test connection» and switch on.', 'From a sale or an invoice create the Scalapay link and send it to the customer.'] },
    es: { descrizione: 'El cliente paga en 3 o 4 plazos con Scalapay y tú cobras al momento: Kubo captura el pedido y marca pagada la venta o la factura.', 'imp.chiave': 'Clave API de Scalapay', 'imp.ambiente': 'Entorno', 'imp.rate': 'Plazos', 'imp.indirizzo': 'Dirección pública de Kubo (para la confirmación inmediata, opcional)', 'imp.ritorno': 'Página tras el pago (p. ej. tu web)', ...testiLink('Enlace Scalapay', 'venta', 'factura'), 'giro.controlla': 'Capturar pedidos confirmados' },
    fr: { descrizione: 'Le client paie en 3 ou 4 fois avec Scalapay, vous êtes payé tout de suite : Kubo capture la commande et marque la vente ou la facture payée.', 'imp.chiave': 'Clé API Scalapay', 'imp.ambiente': 'Environnement', 'imp.rate': 'Échéances', 'imp.indirizzo': 'Adresse publique de Kubo (pour la confirmation immédiate, facultatif)', 'imp.ritorno': 'Page après le paiement (ex. votre site)', ...testiLink('Lien Scalapay', 'vente', 'facture'), 'giro.controlla': 'Capturer les commandes confirmées' },
    de: { descrizione: 'Der Kunde zahlt mit Scalapay in 3 oder 4 Raten, du bekommst sofort das Geld: Kubo erfasst die Bestellung und markiert Verkauf oder Rechnung als bezahlt.', 'imp.chiave': 'Scalapay-API-Schlüssel', 'imp.ambiente': 'Umgebung', 'imp.rate': 'Raten', 'imp.indirizzo': 'Öffentliche Kubo-Adresse (für die sofortige Bestätigung, optional)', 'imp.ritorno': 'Seite nach der Zahlung (z. B. deine Website)', ...testiLink('Scalapay-Link', 'Verkauf', 'Rechnung'), 'giro.controlla': 'Bestätigte Bestellungen erfassen' },
    pt: { descrizione: 'O cliente paga em 3 ou 4 parcelas com a Scalapay e você recebe na hora: o Kubo captura o pedido e marca a venda ou a fatura como paga.', 'imp.chiave': 'Chave API da Scalapay', 'imp.ambiente': 'Ambiente', 'imp.rate': 'Parcelas', 'imp.indirizzo': 'Endereço público do Kubo (para a confirmação imediata, opcional)', 'imp.ritorno': 'Página após o pagamento (ex.: seu site)', ...testiLink('Link Scalapay', 'venda', 'fatura'), 'giro.controlla': 'Capturar pedidos confirmados' },
  },
};
