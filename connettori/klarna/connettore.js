// Klarna: «paga in 3 rate» o «paga dopo» per vendite e fatture, con la Hosted Payment Page (HPP) sopra Klarna Payments.
// Basic con nome utente e password API (regione UE). Il link: POST /payments/v1/sessions (la sessione KP con importo in
// centesimi e merchant_reference1 = il riferimento di Kubo) → POST /hpp/v1/sessions con payment_session_url, merchant_urls
// e place_order_mode CAPTURE_ORDER (la HPP crea e cattura l'ordine) → redirect_url. L'esito non si crede mai dall'URL:
// si rilegge GET /hpp/v1/sessions/{id} → COMPLETED con order_id → GET /ordermanagement/v1/orders/{id}: CAPTURED si
// incassa, AUTHORIZED si cattura (POST …/captures) e si incassa. Se la HPP desse solo l'authorization_token, Kubo crea
// l'ordine (POST /payments/v1/authorizations/{token}/order). Si guarda solo una sessione creata da Kubo (stato «aperti»):
// dalla rotta pubblica «ritorno» (indirizzo pubblico) o dal giro «controlla» ogni 10 minuti (app sul PC).
// Fonti: https://docs.klarna.com/payments/other-products/hosted-payment-page/api-documentation/create-session/,
// …/read-session/, https://docs.klarna.com/api/payments/, https://docs.klarna.com/api/ordermanagement/
import { azioniLink, testiLink, incassa, RICHIEDE_INCASSI, PERMESSI_INCASSI, pubblicoDi } from '../_soldi/comuni.js';

const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://api.klarna.com' : 'https://api.playground.klarna.com');
const api = (k, metodo, percorso, json, intestazioni = {}) => k.http.richiesta(metodo, base(k) + percorso, { basic: [k.imp.utente, k.segreti.password], json, intestazioni });
const errore = r => new Error(`Klarna ha risposto ${r.stato}: ${String(r.json?.error_messages?.join?.(', ') || r.json?.error_code || r.testo || '').slice(0, 200)}`);
const SID = /^[\w-]{8,80}$/;
const aperti = k => k.stato.leggi('aperti') || [];
const togli = (k, hpp) => k.stato.scrivi('aperti', aperti(k).filter(x => x.hpp !== hpp));
const pubblico = k => pubblicoDi(k);   // il suo indirizzo o, se vuoto, quello https della Libreria (k.pubblico)
// l'ordine come lo vuole Klarna: importi in centesimi, una riga, IVA già dentro il prezzo
const ordine = (x, nome) => ({
  purchase_country: 'IT', purchase_currency: 'EUR', locale: 'it-IT', order_amount: x.cent, order_tax_amount: 0, merchant_reference1: x.rif,
  order_lines: [{ type: 'physical', reference: x.rif, name: String(nome || x.rif).slice(0, 255), quantity: 1, unit_price: x.cent, tax_rate: 0, total_amount: x.cent, total_tax_amount: 0 }],
});

// un ordine di Order Management: catturato → incasso; autorizzato e accettato → si cattura e si incassa
async function daOrdine(k, x, idOrdine) {
  const r = await api(k, 'GET', `/ordermanagement/v1/orders/${encodeURIComponent(idOrdine)}`);
  if (!r.ok) throw errore(r);
  const o = r.json || {}, st = String(o.status || '').toUpperCase();
  if (String(o.purchase_currency || 'EUR').toUpperCase() !== 'EUR') { togli(k, x.hpp); return k.avvisa(`ordine Klarna ${idOrdine} in ${o.purchase_currency}: controllalo a mano`); }
  if (st === 'CAPTURED') { togli(k, x.hpp); return incassa(k, x.rif, { importo: Number(o.captured_amount ?? o.order_amount) / 100, metodo: 'carta' }); }
  if (st === 'AUTHORIZED' && (!o.fraud_status || String(o.fraud_status).toUpperCase() === 'ACCEPTED')) {
    const c = await api(k, 'POST', `/ordermanagement/v1/orders/${encodeURIComponent(idOrdine)}/captures`, { captured_amount: Number(o.remaining_authorized_amount ?? o.order_amount), description: x.rif },
      { 'Klarna-Idempotency-Key': `kubo-cattura-${idOrdine}` });
    if (!c.ok) throw errore(c);
    togli(k, x.hpp);
    return incassa(k, x.rif, { importo: Number(o.order_amount) / 100, metodo: 'carta' });
  }
  if (['CANCELLED', 'EXPIRED', 'CLOSED'].includes(st)) { togli(k, x.hpp); return `ignorato: ordine ${st.toLowerCase()}`; }
  return `ignorato: ordine ${st.toLowerCase() || 'in attesa'}${o.fraud_status ? ` (${String(o.fraud_status).toLowerCase()})` : ''}`;
}
// una sessione HPP riletta da Klarna
async function controlla(k, x) {
  const r = await api(k, 'GET', `/hpp/v1/sessions/${encodeURIComponent(x.hpp)}`);
  if (!r.ok) return r.stato === 404 ? (togli(k, x.hpp), 'ignorato: sessione scaduta') : Promise.reject(errore(r));
  const s = r.json || {}, st = String(s.status || '').toUpperCase();
  if (st === 'COMPLETED' && s.order_id) return daOrdine(k, x, s.order_id);
  if (st === 'COMPLETED' && s.authorization_token) {
    const o = await api(k, 'POST', `/payments/v1/authorizations/${encodeURIComponent(s.authorization_token)}/order`, ordine(x, x.nome), { 'Klarna-Idempotency-Key': `kubo-ordine-${x.hpp}` });
    if (!o.ok || !o.json?.order_id) throw errore(o);
    return daOrdine(k, x, o.json.order_id);
  }
  if (['FAILED', 'CANCELLED', 'ERROR', 'DISABLED'].includes(st)) { togli(k, x.hpp); return `ignorato: ${st.toLowerCase()}`; }
  return `ignorato: ${st.toLowerCase() || 'in attesa'}`;
}
const pagina = t => ({ tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${t}</title><p style="font:18px system-ui;margin:3em auto;max-width:30em;text-align:center">${t}</p>` });

export default {
  id: 'klarna', nome: 'Klarna', versione: 1, icona: 'cassa',
  descrizione: 'Il cliente paga in 3 rate o dopo con Klarna, tu incassi subito: Kubo rilegge l\'ordine da Klarna e segna pagata la vendita o la fattura.',
  impostazioni: [
    { id: 'utente', nome: 'Nome utente API Klarna (UID)', schema: /^[\w.-]{3,80}$/ },
    { id: 'password', nome: 'Password API Klarna', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (per la conferma immediata, facoltativo)', schema: /^https:\/\/[^\s]+$/, obbligatorio: false },
    { id: 'ritorno', nome: 'Pagina dopo il pagamento (es. il tuo sito)', schema: /^https:\/\/[^\s]+$/, obbligatorio: false },
  ],
  richiede: RICHIEDE_INCASSI,
  permessi: PERMESSI_INCASSI,
  // la lettura di una sessione inesistente: 401/403 se le credenziali sono sbagliate, 404 se vanno bene
  prova: async k => { const r = await api(k, 'GET', '/payments/v1/sessions/kubo-prova'); return { ok: r.stato !== 401 && r.stato !== 403 && r.stato < 500, messaggio: r.stato === 401 || r.stato === 403 ? 'Credenziali API rifiutate' : null }; },
  azioni: azioniLink('Klarna', async (k, { cent, rif, descrizione }) => {
    if (!k.imp.utente || !k.segreti.password) throw new Error('Mancano nome utente e password API');
    const x = { cent, rif, nome: descrizione };
    const kp = await api(k, 'POST', '/payments/v1/sessions', { ...ordine(x, descrizione), acquiring_channel: 'ECOMMERCE', intent: 'buy' });
    if (!kp.ok || !kp.json?.session_id) throw errore(kp);
    const pub = pubblico(k) ? `${pubblico(k)}/api/connettori/klarna/pub/ritorno?sid={{session_id}}` : null, fuori = k.imp.ritorno || null;
    const urls = pub ? { success: pub, cancel: `${pub}&annullato=1`, back: `${pub}&annullato=1`, failure: `${pub}&annullato=1`, error: `${pub}&annullato=1` }
      : fuori ? { success: fuori, cancel: fuori, back: fuori, failure: fuori, error: fuori } : {};
    const h = await api(k, 'POST', '/hpp/v1/sessions', { payment_session_url: `${base(k)}/payments/v1/sessions/${kp.json.session_id}`, merchant_urls: urls, options: { place_order_mode: 'CAPTURE_ORDER' } });
    if (!h.ok || !h.json?.session_id || !h.json?.redirect_url) throw errore(h);
    k.stato.scrivi('aperti', [...aperti(k), { hpp: h.json.session_id, kp: kp.json.session_id, rif, cent, importo: cent / 100, nome: descrizione, creato: Date.now() }].slice(-500));
    return { url: h.json.redirect_url, id: h.json.session_id };
  }),
  // GET /api/connettori/klarna/pub/ritorno?sid=…: il cliente torna dalla HPP. L'esito si rilegge sempre dall'API
  pubbliche: {
    async ritorno({ q, k }) {
      const sid = String(q.get('sid') || ''), x = aperti(k).find(a => a.hpp === sid);
      if (q.get('annullato')) return pagina('Il pagamento con Klarna non è stato completato.');
      if (!SID.test(sid) || !x) return pagina('Grazie! Il pagamento è in verifica.');
      let esito; try { esito = await controlla(k, x); } catch (e) { k.annota('entrata', 'errore', `ritorno ${sid}`, String(e.message).slice(0, 300)); return pagina('Grazie! Il pagamento è in verifica.'); }
      k.annota('entrata', /^ignorato/.test(String(esito)) ? 'ignorato' : 'ok', `ritorno ${sid}`, esito);
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
    categoria: 'pagamenti', sito: 'https://www.klarna.com/it/business/',
    costo: 'contratto', costoNota: 'Nessun canone: Klarna trattiene una commissione su ogni vendita, fissata nel contratto (in Italia di solito una percentuale più una quota fissa per transazione; il listino aggiornato è nel portale commercianti). Il cliente paga in 3 rate senza interessi o dopo 30 giorni, il negozio riceve l\'intero importo meno la commissione.',
    serve: [
      { cosa: 'Nome utente (UID) e password API Klarna (in prova: quelli dell\'ambiente Playground)', dove: 'Klarna Merchant Portal › Impostazioni › Credenziali API Klarna › Genera nuove credenziali', link: 'https://portal.klarna.com/' },
      { cosa: 'Un indirizzo pubblico https di Kubo (facoltativo)', dove: 'Il tuo dominio o un tunnel verso il computer di Kubo', link: 'https://docs.klarna.com/payments/other-products/hosted-payment-page/api-documentation/create-session/' },
    ],
    passi: ['Chiedi a Klarna l\'attivazione come commerciante (klarna.com/it/business) e verifica che Klarna Payments e la Hosted Payment Page siano attivi.', 'Per provare crea un account Playground e genera lì le credenziali API.', 'Nel Merchant Portal genera nome utente e password API della regione Europa.', 'Incollali in Kubo e scegli l\'ambiente.', 'Se Kubo ha un indirizzo pubblico https, scrivilo (se hai impostato l\'indirizzo pubblico di Kubo nella Libreria, puoi lasciarlo vuoto): l\'incasso si vede appena il cliente torna; altrimenti Kubo controlla ogni 10 minuti.', 'Premi «Prova la connessione» e accendi.', 'Dalla vendita o dalla fattura crea il link Klarna e mandalo al cliente.'],
    difficolta: 'media', zone: ['IT', 'UE'],
    fonti: ['https://docs.klarna.com/payments/other-products/hosted-payment-page/api-documentation/create-session/', 'https://docs.klarna.com/payments/other-products/hosted-payment-page/api-documentation/read-session/', 'https://docs.klarna.com/payments/other-products/hosted-payment-page/api-documentation/status-callbacks/', 'https://docs.klarna.com/api/payments/', 'https://docs.klarna.com/api/ordermanagement/'],
    prova: 'finto', parole: ['klarna', 'paga in 3 rate', 'paga dopo', 'rate', 'pagamento a rate', 'bnpl', 'buy now pay later', 'pay later', 'pay in 3', 'installments', 'link di pagamento'],
  },
  testi: {
    en: { descrizione: 'The customer pays in 3 instalments or later with Klarna, you get paid at once: Kubo reads the order back from Klarna and marks the sale or invoice paid.', 'imp.utente': 'Klarna API username (UID)', 'imp.password': 'Klarna API password', 'imp.ambiente': 'Environment', 'imp.indirizzo': 'Public Kubo address (for instant confirmation, optional)', 'imp.ritorno': 'Page after payment (e.g. your website)', ...testiLink('Klarna link', 'sale', 'invoice'), 'giro.controlla': 'Check Klarna payments',
      'cat.costoNota': 'No monthly fee: Klarna keeps a commission on each sale, set in the contract (in Italy usually a percentage plus a fixed fee per transaction; the current price list is in the merchant portal). The customer pays in 3 interest-free instalments or after 30 days, the shop gets the full amount minus the fee.',
      'cat.serve': [{ cosa: 'Klarna API username (UID) and password (for tests: the Playground ones)', dove: 'Klarna Merchant Portal › Settings › Klarna API credentials › Generate new credentials' }, { cosa: 'A public https address for Kubo (optional)', dove: 'Your domain or a tunnel to the Kubo computer' }],
      'cat.passi': ['Ask Klarna to activate you as a merchant (klarna.com/it/business) and check that Klarna Payments and the Hosted Payment Page are enabled.', 'To test, create a Playground account and generate API credentials there.', 'In the Merchant Portal generate the API username and password for the Europe region.', 'Paste them in Kubo and choose the environment.', 'If Kubo has a public https address, enter it (if you set Kubo\'s public address in the Library, you can leave it empty): the payment shows up as soon as the customer returns; otherwise Kubo checks every 10 minutes.', 'Press «Test connection» and switch on.', 'From a sale or an invoice create the Klarna link and send it to the customer.'] },
    es: { descrizione: 'El cliente paga en 3 plazos o más tarde con Klarna y tú cobras al momento: Kubo relee el pedido en Klarna y marca pagada la venta o la factura.', 'imp.utente': 'Usuario API de Klarna (UID)', 'imp.password': 'Contraseña API de Klarna', 'imp.ambiente': 'Entorno', 'imp.indirizzo': 'Dirección pública de Kubo (para la confirmación inmediata, opcional)', 'imp.ritorno': 'Página tras el pago (p. ej. tu web)', ...testiLink('Enlace Klarna', 'venta', 'factura'), 'giro.controlla': 'Comprobar pagos Klarna' },
    fr: { descrizione: 'Le client paie en 3 fois ou plus tard avec Klarna, vous êtes payé tout de suite : Kubo relit la commande chez Klarna et marque la vente ou la facture payée.', 'imp.utente': 'Identifiant API Klarna (UID)', 'imp.password': 'Mot de passe API Klarna', 'imp.ambiente': 'Environnement', 'imp.indirizzo': 'Adresse publique de Kubo (pour la confirmation immédiate, facultatif)', 'imp.ritorno': 'Page après le paiement (ex. votre site)', ...testiLink('Lien Klarna', 'vente', 'facture'), 'giro.controlla': 'Vérifier les paiements Klarna' },
    de: { descrizione: 'Der Kunde zahlt mit Klarna in 3 Raten oder später, du bekommst sofort das Geld: Kubo liest die Bestellung bei Klarna nach und markiert Verkauf oder Rechnung als bezahlt.', 'imp.utente': 'Klarna-API-Benutzername (UID)', 'imp.password': 'Klarna-API-Passwort', 'imp.ambiente': 'Umgebung', 'imp.indirizzo': 'Öffentliche Kubo-Adresse (für die sofortige Bestätigung, optional)', 'imp.ritorno': 'Seite nach der Zahlung (z. B. deine Website)', ...testiLink('Klarna-Link', 'Verkauf', 'Rechnung'), 'giro.controlla': 'Klarna-Zahlungen prüfen' },
    pt: { descrizione: 'O cliente paga em 3 parcelas ou depois com a Klarna e você recebe na hora: o Kubo relê o pedido na Klarna e marca a venda ou a fatura como paga.', 'imp.utente': 'Usuário API da Klarna (UID)', 'imp.password': 'Senha API da Klarna', 'imp.ambiente': 'Ambiente', 'imp.indirizzo': 'Endereço público do Kubo (para a confirmação imediata, opcional)', 'imp.ritorno': 'Página após o pagamento (ex.: seu site)', ...testiLink('Link Klarna', 'venda', 'fatura'), 'giro.controlla': 'Verificar pagamentos Klarna' },
  },
};
