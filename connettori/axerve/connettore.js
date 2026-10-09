// Axerve Ecommerce Solutions (ex Banca Sella GestPay, oggi Fabrick Payment Orchestra): link di pagamento sulla pagina
// sicura di Axerve. REST con «Authorization: apikey <chiave>»: POST /api/v1/payment/create { shopLogin, amount '60.00',
// currency, shopTransactionID unico per tentativo, responseURLs } → payload { paymentToken, paymentID, userRedirect.href };
// il cliente paga su pagam.aspx?a=<shopLogin>&b=<paymentToken>. L'esito non si crede mai dai parametri: arriva (GET o POST)
// sull'URL di notifica o con il ritorno del cliente, e Kubo lo rilegge con POST /api/v1/payment/detail { shopLogin,
// shopTransactionID } → transactionResult «OK» = pagato, «KO» = rifiutato. Si guarda solo un tentativo creato da Kubo
// (stato «aperti»); senza indirizzo pubblico c'è il giro «controlla» ogni 10 minuti (app sul PC).
// Fonti: https://api.axerve.com/ (oggi https://api.paymentorchestra.fabrick.com/): base URL, apikey, payment/create, payment/detail, responseURLs
import { randomBytes } from 'node:crypto';
import { azioniLink, testiLink, incassa, RICHIEDE_INCASSI, PERMESSI_INCASSI } from '../_soldi/comuni.js';

const prod = k => k.imp.ambiente === 'produzione';
const base = k => k.base || (prod(k) ? 'https://ecomms2s.sella.it' : 'https://sandbox.gestpay.net');
const PAGAM = { produzione: 'https://ecomm.sella.it/pagam/pagam.aspx', prova: 'https://sandbox.gestpay.net/pagam/pagam.aspx' };
const api = (k, metodo, json) => k.http.post(`${base(k)}/api/v1/payment/${metodo}`, { json, intestazioni: { Authorization: `apikey ${k.segreti.chiave}` } });
const riuscita = r => r.ok && String(r.json?.error?.code ?? '') === '0';
const errore = r => new Error(`Axerve ha risposto ${r.stato}: ${String(r.json?.error?.description || r.json?.error?.code || r.testo || '').slice(0, 200)}`);
const ST = /^K[0-9A-Z]{6,30}$/;
const aperti = k => k.stato.leggi('aperti') || [];
const togli = (k, st) => k.stato.scrivi('aperti', aperti(k).filter(x => x.st !== st));
const pubblico = k => String(k.imp.indirizzo || '').replace(/\/$/, '');

// un tentativo riletto da Axerve: OK → incasso; KO → non si guarda più; il resto aspetta
async function controlla(k, x) {
  const r = await api(k, 'detail', { shopLogin: k.imp.shop, shopTransactionID: x.st });
  if (!riuscita(r)) return r.ok || r.stato === 404 ? `ignorato: non ancora pagato (${String(r.json?.error?.code ?? r.stato)})` : Promise.reject(errore(r));
  const p = r.json.payload || {}, esito = String(p.transactionResult || '').toUpperCase();
  if (p.shopTransactionID && p.shopTransactionID !== x.st) return 'ignorato: altra transazione';
  if (esito === 'OK') { togli(k, x.st); return incassa(k, x.rif, { importo: Number(p.amount ?? x.importo), valuta: p.currency || 'EUR', metodo: 'carta' }); }
  if (esito === 'KO') { togli(k, x.st); return 'ignorato: KO'; }
  return `ignorato: ${esito.toLowerCase() || 'in attesa'}`;
}
// il tentativo dietro una notifica: il codice «t» messo da Kubo negli URL, o il paymentToken / paymentID / shopTransactionID
const trova = (k, p) => {
  const v = n => String(p[n] ?? '');
  return aperti(k).find(x => (v('t') && x.st === v('t')) || (v('shopTransactionID') && x.st === v('shopTransactionID')) || (v('b') && x.token === v('b')) || (v('paymentToken') && x.token === v('paymentToken')) || (v('paymentID') && x.pid === v('paymentID')));
};
const pagina = t => ({ tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${t}</title><p style="font:18px system-ui;margin:3em auto;max-width:30em;text-align:center">${t}</p>` });
async function notifica(k, p, da) {
  const x = trova(k, p); if (!x) return null;
  let esito; try { esito = await controlla(k, x); } catch (e) { k.annota('entrata', 'errore', `${da} ${x.st}`, String(e.message).slice(0, 300)); return 'errore'; }
  k.annota('entrata', /^ignorato/.test(String(esito)) ? 'ignorato' : 'ok', `${da} ${x.st}`, esito);
  return esito;
}

export default {
  id: 'axerve', nome: 'Axerve', versione: 1, icona: 'cassa',
  descrizione: 'Link di pagamento sulla pagina sicura Axerve (ex Banca Sella GestPay): Kubo rilegge l\'esito dall\'API e segna pagate vendite e fatture.',
  impostazioni: [
    { id: 'shop', nome: 'Shop login (es. GESPAY12345)', schema: /^[\w-]{3,40}$/ },
    { id: 'chiave', nome: 'API key Axerve', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (per l\'esito immediato, facoltativo)', schema: /^https:\/\/[^\s]+$/, obbligatorio: false },
  ],
  richiede: RICHIEDE_INCASSI,
  permessi: PERMESSI_INCASSI,
  // il dettaglio di una transazione inesistente: 401/403 se la chiave è sbagliata, un errore «non trovata» se va bene
  prova: async k => { const r = await api(k, 'detail', { shopLogin: k.imp.shop, shopTransactionID: 'KUBOPROVA' }); return { ok: r.stato !== 401 && r.stato !== 403 && r.stato < 500, messaggio: r.stato === 401 || r.stato === 403 ? 'API key rifiutata' : null }; },
  azioni: azioniLink('Axerve', async (k, { importo, rif }) => {
    if (!k.imp.shop || !k.segreti.chiave) throw new Error('Mancano shop login e API key');
    const st = `K${Date.now().toString(36)}${randomBytes(4).toString('hex')}`.toUpperCase();
    const pub = pubblico(k) ? `${pubblico(k)}/api/connettori/axerve/pub/esito?t=${st}` : null;
    const r = await api(k, 'create', { shopLogin: k.imp.shop, amount: Number(importo).toFixed(2), currency: 'EUR', shopTransactionID: st, languageId: '1',
      ...(pub ? { responseURLs: { buyerOK: pub, buyerKO: `${pub}&ko=1`, serverNotificationURL: pub } } : {}) });
    if (!riuscita(r) || !r.json?.payload?.paymentToken) throw errore(r);
    const p = r.json.payload;
    k.stato.scrivi('aperti', [...aperti(k), { st, token: String(p.paymentToken), pid: String(p.paymentID ?? ''), rif, importo, creato: Date.now() }].slice(-500));
    const url = p.userRedirect?.href || `${PAGAM[prod(k) ? 'produzione' : 'prova']}?${new URLSearchParams({ a: k.imp.shop, b: p.paymentToken })}`;
    return { url, id: st };
  }),
  // la notifica server-to-server in POST (se il back office la manda così): nessuna firma, l'esito si rilegge dall'API
  entrata: {
    firma: { tipo: 'nessuna' },
    idempotenza: (ev, req) => { const t = new URL(req.url, 'http://x').searchParams.get('t'); return t && ST.test(t) ? `esito:${t}` : ''; },
    async gestisci(ev, k, { req }) {
      const p = { ...(ev && typeof ev === 'object' ? ev : {}), ...Object.fromEntries(new URL(req.url, 'http://x').searchParams) };
      return (await notifica(k, p, 'notifica')) ?? 'ignorato: transazione sconosciuta';
    },
  },
  // GET /api/connettori/axerve/pub/esito?t=…: la notifica in GET e il ritorno del cliente, con la pagina di cortesia
  pubbliche: {
    async esito({ q, k }) {
      const esito = await notifica(k, Object.fromEntries(q), 'esito');
      if (esito === 'pagata' || /già pagata/.test(String(esito))) return pagina('Pagamento ricevuto, grazie!');
      return pagina(q.get('ko') || esito === 'ignorato: KO' ? 'Il pagamento non è andato a buon fine.' : 'Grazie! Il pagamento è in verifica.');
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
    categoria: 'pagamenti', sito: 'https://www.axerve.com/',
    costo: 'contratto', costoNota: 'Le commissioni dipendono dal contratto con Axerve o con Banca Sella (di solito una percentuale per transazione, a volte con un canone mensile; le offerte e-commerce sono sul sito Axerve). Kubo non aggiunge costi.',
    serve: [
      { cosa: 'Shop login e API key (in prova: quelli dell\'ambiente di test sandbox)', dove: 'Back office Axerve › Configurazione › Ambiente › Sicurezza › API key', link: 'https://www.axerve.com/' },
      { cosa: 'Un indirizzo pubblico https di Kubo (facoltativo)', dove: 'Il tuo dominio o un tunnel verso il computer di Kubo', link: 'https://api.axerve.com/' },
    ],
    passi: ['Chiedi ad Axerve (o a Banca Sella) l\'attivazione del pagamento online, oppure apri un account di test sandbox.', 'Nel back office genera l\'API key e copia lo shop login (prima quelli di test).', 'In Kubo incolla shop login e API key e scegli l\'ambiente.', 'Se Kubo ha un indirizzo pubblico https, scrivilo: Kubo lo manda ad Axerve per ogni link e vede l\'esito subito; altrimenti controlla ogni 10 minuti.', 'Premi «Prova la connessione» e accendi.', 'Dalla vendita o dalla fattura crea il link Axerve e mandalo al cliente.'],
    difficolta: 'media', zone: ['IT'],
    fonti: ['https://api.axerve.com/', 'https://api.paymentorchestra.fabrick.com/', 'https://docs.axerve.com/'],
    prova: 'finto', parole: ['axerve', 'gestpay', 'banca sella', 'sella', 'fabrick', 'pos virtuale', 'carta di credito', 'pay by link', 'link di pagamento', 'virtual pos'],
  },
  testi: {
    en: { descrizione: 'Payment links on the secure Axerve page (formerly Banca Sella GestPay): Kubo reads the outcome back from the API and marks sales and invoices paid.', 'imp.shop': 'Shop login (e.g. GESPAY12345)', 'imp.chiave': 'Axerve API key', 'imp.ambiente': 'Environment', 'imp.indirizzo': 'Public Kubo address (for the instant outcome, optional)', ...testiLink('Axerve link', 'sale', 'invoice'), 'giro.controlla': 'Check Axerve payments',
      'cat.costoNota': 'Fees depend on your contract with Axerve or Banca Sella (usually a percentage per transaction, sometimes with a monthly fee; the e-commerce offers are on the Axerve website). Kubo adds no costs.',
      'cat.serve': [{ cosa: 'Shop login and API key (for tests: the sandbox ones)', dove: 'Axerve back office › Configuration › Environment › Security › API key' }, { cosa: 'A public https address for Kubo (optional)', dove: 'Your domain or a tunnel to the Kubo computer' }],
      'cat.passi': ['Ask Axerve (or Banca Sella) to enable online payments, or open a sandbox test account.', 'In the back office generate the API key and copy the shop login (test ones first).', 'Paste shop login and API key into Kubo and choose the environment.', 'If Kubo has a public https address, enter it: Kubo sends it to Axerve with each link and sees the outcome at once; otherwise it checks every 10 minutes.', 'Press «Test connection» and switch on.', 'From a sale or an invoice create the Axerve link and send it to the customer.'] },
    es: { descrizione: 'Enlaces de pago en la página segura de Axerve (antes Banca Sella GestPay): Kubo relee el resultado en la API y marca pagadas ventas y facturas.', 'imp.shop': 'Shop login (p. ej. GESPAY12345)', 'imp.chiave': 'Clave API de Axerve', 'imp.ambiente': 'Entorno', 'imp.indirizzo': 'Dirección pública de Kubo (para el resultado inmediato, opcional)', ...testiLink('Enlace Axerve', 'venta', 'factura'), 'giro.controlla': 'Comprobar pagos Axerve' },
    fr: { descrizione: 'Liens de paiement sur la page sécurisée Axerve (ex Banca Sella GestPay) : Kubo relit le résultat via l\'API et marque ventes et factures payées.', 'imp.shop': 'Shop login (ex. GESPAY12345)', 'imp.chiave': 'Clé API Axerve', 'imp.ambiente': 'Environnement', 'imp.indirizzo': 'Adresse publique de Kubo (pour le résultat immédiat, facultatif)', ...testiLink('Lien Axerve', 'vente', 'facture'), 'giro.controlla': 'Vérifier les paiements Axerve' },
    de: { descrizione: 'Zahlungslinks auf der sicheren Axerve-Seite (früher Banca Sella GestPay): Kubo liest das Ergebnis über die API nach und markiert Verkäufe und Rechnungen als bezahlt.', 'imp.shop': 'Shop-Login (z. B. GESPAY12345)', 'imp.chiave': 'Axerve-API-Schlüssel', 'imp.ambiente': 'Umgebung', 'imp.indirizzo': 'Öffentliche Kubo-Adresse (für das sofortige Ergebnis, optional)', ...testiLink('Axerve-Link', 'Verkauf', 'Rechnung'), 'giro.controlla': 'Axerve-Zahlungen prüfen' },
    pt: { descrizione: 'Links de pagamento na página segura Axerve (antiga Banca Sella GestPay): o Kubo relê o resultado na API e marca vendas e faturas como pagas.', 'imp.shop': 'Shop login (ex.: GESPAY12345)', 'imp.chiave': 'Chave API da Axerve', 'imp.ambiente': 'Ambiente', 'imp.indirizzo': 'Endereço público do Kubo (para o resultado imediato, opcional)', ...testiLink('Link Axerve', 'venda', 'fatura'), 'giro.controlla': 'Verificar pagamentos Axerve' },
  },
};
