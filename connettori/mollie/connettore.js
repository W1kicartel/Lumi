// Mollie: link di pagamento (carte, PayPal, bonifico SEPA, Satispay…) e terminale POS; le vendite e le fatture si segnano pagate da sole.
// Il webhook classico dei pagamenti non è firmato: Mollie manda solo «id=tr_…» in form (https://docs.mollie.com/reference/webhooks).
// Quindi: un codice segreto in fondo all'indirizzo (firma «token») e si crede solo all'API, rileggendo GET /v2/payments/{id}.
// Il pagamento porta «metadata.kubo» = il riferimento di Kubo (kubo-v-<id> o kubo-f-<id>).
// Kubo sul computer senza indirizzo pubblico: il giro «controlla» rilegge ogni 15 minuti i pagamenti ancora aperti.
import { RICHIEDE_INCASSI, PERMESSI_INCASSI, azioniLink, testiLink, incassa, daIncassare, riferimento, nomeRiga } from '../_soldi/comuni.js';

const FINITI = ['paid', 'failed', 'canceled', 'expired'];
const valore = n => Number(n).toFixed(2);   // Mollie vuole la stringa con due decimali: «60.00»
// l'indirizzo del webhook: l'indirizzo pubblico di Kubo + il codice segreto generato all'accensione
const webhook = k => k.imp.indirizzo && k.segreti.webhook ? `${String(k.imp.indirizzo).replace(/\/+$/, '')}/api/connettori/mollie/in/${k.segreti.webhook}` : undefined;
// redirectUrl serve quasi sempre (https://docs.mollie.com/reference/create-payment): il sito, se no l'indirizzo di Kubo
const ritorno = k => k.imp.ritorno || k.imp.indirizzo || 'https://www.mollie.com';
const metodo = m => ['banktransfer', 'directdebit'].includes(m) ? 'bonifico' : 'carta';

function ricorda(k, id) { const a = [...(k.stato.leggi('aperti') || []).filter(x => x !== id), id].slice(-200); k.stato.scrivi('aperti', a); }
function dimentica(k, id) { k.stato.scrivi('aperti', (k.stato.leggi('aperti') || []).filter(x => x !== id)); }

async function paga(k, corpo) {
  const r = await k.http.post(`${k.base}/v2/payments`, { bearer: k.segreti.chiave, json: { ...corpo, webhookUrl: webhook(k) } });
  if (!r.ok) throw new Error(r.json?.detail || `Mollie ha risposto ${r.stato}`);
  ricorda(k, r.json.id);
  return r.json;
}

// si crede solo all'API: lo stato e l'importo arrivano da GET /v2/payments/{id}
async function rileggi(k, id) {
  const r = await k.http.get(`${k.base}/v2/payments/${encodeURIComponent(id)}`, { bearer: k.segreti.chiave });
  if (r.stato === 404) { dimentica(k, id); return 'ignorato: pagamento sconosciuto'; }
  if (!r.ok) throw new Error(`Mollie ha risposto ${r.stato}`);
  const p = r.json;
  if (FINITI.includes(p.status)) dimentica(k, id);
  if (p.status !== 'paid') return `ignorato: ${p.status}`;
  return incassa(k, p.metadata?.kubo, { importo: Number(p.amount?.value), valuta: p.amount?.currency, quando: Date.parse(p.paidAt) || Date.now(), metodo: metodo(p.method), fonte: 'Mollie' });
}

export default {
  id: 'mollie', nome: 'Mollie', versione: 1, icona: 'cassa', base: 'https://api.mollie.com',
  descrizione: 'Link di pagamento e POS Mollie: le vendite e le fatture si segnano pagate da sole.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API (test_… o live_…)', segreto: true, schema: /^(test|live)_\w{20,}$/ },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (per il webhook)', tipo: 'url', obbligatorio: false },
    { id: 'webhook', nome: 'Codice segreto del webhook (va in fondo all\'indirizzo)', segreto: true, generato: true },
    { id: 'ritorno', nome: 'Pagina dopo il pagamento (es. il tuo sito)', tipo: 'url', obbligatorio: false },
    { id: 'terminale', nome: 'Terminale POS Mollie (term_…)', obbligatorio: false, schema: /^term_\w+$/ },
  ],
  richiede: RICHIEDE_INCASSI,
  permessi: PERMESSI_INCASSI,
  prova: async k => { const r = await k.http.get(`${k.base}/v2/methods`, { bearer: k.segreti.chiave }); return { ok: r.ok, messaggio: r.ok ? null : r.json?.detail || `HTTP ${r.stato}` }; },
  entrata: {
    firma: { tipo: 'token', segreto: 'webhook' },   // /api/connettori/mollie/in/<codice segreto>
    idempotenza: ev => String(ev?.id || ''),   // un «ignorato» (open, pending) non si segna: il «paid» dello stesso id passa
    async gestisci(ev, k) {
      if (!/^tr_\w{1,60}$/.test(String(ev?.id || ''))) return 'ignorato';
      return rileggi(k, ev.id);
    },
  },
  azioni: {
    ...azioniLink('Mollie', async (k, { importo, rif, descrizione }) => {
      const p = await paga(k, { amount: { currency: 'EUR', value: valore(importo) }, description: descrizione, metadata: { kubo: rif },
        redirectUrl: ritorno(k) });
      return { url: p._links?.checkout?.href, id: p.id };
    }),
    // il pagamento va al terminale Mollie: il cliente appoggia la carta (method «pointofsale» con terminalId)
    terminale: {
      nome: 'Incassa al POS Mollie', descrizione: 'Manda l\'importo di una vendita al terminale POS Mollie', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'relazione', entita: 'vendite', nome: 'La vendita da incassare' } },
      proponi: async ({ vendita }, k) => ({ titolo: 'POS Mollie', righe: [['Vendita', k.valore(vendita, 'vendite', 'numero') || vendita.id], ['Importo', k.euro(daIncassare(k, 'vendite', vendita))], ['Terminale', k.imp.terminale || '—']],
        avvisi: [...(k.imp.terminale ? [] : ['Manca il terminale nelle impostazioni']), ...(k.valore(vendita, 'vendite', 'stato') === 'pagata' ? ['È già pagata'] : [])] }),
      async esegui({ vendita }, k) {
        if (!k.imp.terminale) throw new Error('Manca il terminale POS nelle impostazioni');
        if (k.valore(vendita, 'vendite', 'stato') === 'pagata') throw new Error('È già pagata');
        const importo = daIncassare(k, 'vendite', vendita); if (!(importo > 0)) throw new Error('L\'importo da pagare è zero');
        const p = await paga(k, { amount: { currency: 'EUR', value: valore(importo) }, description: nomeRiga(k, 'vendite', vendita), method: 'pointofsale',
          terminalId: k.imp.terminale, metadata: { kubo: riferimento('vendite', vendita.id) }, redirectUrl: ritorno(k) });
        return { id: p.id, stato: p.status };
      },
    },
  },
  pianificati: {
    controlla: {
      nome: 'Controlla i pagamenti aperti', ogni: '15m',
      async giro(k) {
        const conti = { pagati: 0, aperti: 0 };
        for (const id of (k.stato.leggi('aperti') || []).slice(-50)) (await rileggi(k, id)) === 'pagata' ? conti.pagati++ : conti.aperti++;
        return conti;
      },
    },
  },
  catalogo: {
    categoria: 'pagamenti',
    sito: 'https://www.mollie.com/it',
    costo: 'a-consumo',
    costoNota: 'Nessun canone né costo di attivazione: si paga a transazione riuscita. Prezzi indicativi per l\'Italia: carte europee da 1,8% + 0,25 €, bonifico SEPA 0,25 €, PayPal 0,10 € più la commissione PayPal, Satispay e altri metodi con tariffe proprie; il POS Mollie ha il costo del terminale. Prezzi aggiornati su mollie.com/it/pricing.',
    serve: [
      { cosa: 'Chiave API (test_… per provare, live_… per incassare)', dove: 'Dashboard Mollie → Sviluppatori → Chiavi API', link: 'https://my.mollie.com/dashboard/developers/api-keys' },
      { cosa: 'Codice del terminale POS (term_…), solo se usi il POS', dove: 'Dashboard Mollie → Punto vendita → Terminali', link: 'https://my.mollie.com/dashboard' },
    ],
    passi: [
      'Crea l\'account su mollie.com e completa la verifica dell\'attività.',
      'Attiva i metodi di pagamento che vuoi (carte, PayPal, bonifico, Satispay…).',
      'Copia la chiave API da Sviluppatori → Chiavi API (prima test_…, poi live_…).',
      'In Kubo incollala nella pagina di Mollie con l\'indirizzo pubblico di Kubo, se ce l\'hai.',
      'Accendi il connettore: Kubo crea il codice segreto del webhook e lo mette da solo in ogni pagamento.',
      'Senza indirizzo pubblico Kubo controlla i pagamenti aperti ogni 15 minuti.',
      'Prova con un link di pagamento da una vendita e paga in modalità test.',
    ],
    difficolta: 'facile',
    zone: ['IT', 'UE'],
    fonti: ['https://docs.mollie.com/reference/create-payment', 'https://docs.mollie.com/reference/get-payment', 'https://docs.mollie.com/reference/webhooks', 'https://docs.mollie.com/reference/authentication', 'https://docs.mollie.com/reference/extra-payment-parameters'],
    prova: 'finto',
    parole: ['mollie', 'pagamenti', 'link di pagamento', 'carta', 'satispay', 'paypal', 'pos', 'terminale', 'payment link', 'checkout', 'card payments'],
  },
  testi: {
    en: { descrizione: 'Mollie payment links and card terminal: sales and invoices get marked paid on their own.', 'imp.chiave': 'API key (test_… or live_…)', 'imp.indirizzo': 'Public address of Kubo (for the webhook)', 'imp.webhook': 'Webhook secret code (goes at the end of the address)', 'imp.ritorno': 'Page after payment (e.g. your website)', 'imp.terminale': 'Mollie POS terminal (term_…)',
      ...testiLink('Payment link', 'sale', 'invoice'), 'az.terminale': 'Charge on the Mollie terminal', 'giro.controlla': 'Check open payments',
      'cat.costoNota': 'No monthly fee or setup cost: you pay per successful transaction. Indicative prices for Italy: European cards from 1.8% + €0.25, SEPA bank transfer €0.25, PayPal €0.10 plus the PayPal fee, Satispay and other methods at their own rates; the Mollie POS has the cost of the terminal. Current prices on mollie.com/it/pricing.',
      'cat.serve': [{ cosa: 'API key (test_… to try, live_… to get paid)', dove: 'Mollie Dashboard → Developers → API keys' }, { cosa: 'POS terminal code (term_…), only if you use the POS', dove: 'Mollie Dashboard → Point of sale → Terminals' }],
      'cat.passi': ['Create an account on mollie.com and complete the business verification.', 'Enable the payment methods you want (cards, PayPal, bank transfer, Satispay…).', 'Copy the API key from Developers → API keys (test_… first, then live_…).', 'In Kubo paste it on the Mollie page along with Kubo\'s public address, if you have one.', 'Switch the connector on: Kubo creates the webhook secret code and puts it in every payment by itself.', 'Without a public address Kubo checks open payments every 15 minutes.', 'Try a payment link from a sale and pay in test mode.'] },
    es: { descrizione: 'Enlaces de pago y TPV de Mollie: las ventas y facturas se marcan pagadas solas.', 'imp.chiave': 'Clave API (test_… o live_…)', 'imp.indirizzo': 'Dirección pública de Kubo (para el webhook)', 'imp.webhook': 'Código secreto del webhook (va al final de la dirección)', 'imp.ritorno': 'Página tras el pago (p. ej. tu web)', 'imp.terminale': 'Terminal TPV de Mollie (term_…)',
      ...testiLink('Enlace de pago', 'venta', 'factura'), 'az.terminale': 'Cobrar en el TPV de Mollie', 'giro.controlla': 'Revisar los pagos abiertos' },
    fr: { descrizione: 'Liens de paiement et TPE Mollie : les ventes et factures se marquent payées toutes seules.', 'imp.chiave': 'Clé API (test_… ou live_…)', 'imp.indirizzo': 'Adresse publique de Kubo (pour le webhook)', 'imp.webhook': 'Code secret du webhook (à la fin de l\'adresse)', 'imp.ritorno': 'Page après le paiement (ex. votre site)', 'imp.terminale': 'Terminal TPE Mollie (term_…)',
      ...testiLink('Lien de paiement', 'vente', 'facture'), 'az.terminale': 'Encaisser sur le TPE Mollie', 'giro.controlla': 'Vérifier les paiements ouverts' },
    de: { descrizione: 'Mollie-Zahlungslinks und Kartenterminal: Verkäufe und Rechnungen werden von selbst als bezahlt markiert.', 'imp.chiave': 'API-Schlüssel (test_… oder live_…)', 'imp.indirizzo': 'Öffentliche Adresse von Kubo (für den Webhook)', 'imp.webhook': 'Geheimcode des Webhooks (am Ende der Adresse)', 'imp.ritorno': 'Seite nach der Zahlung (z. B. deine Website)', 'imp.terminale': 'Mollie-Kartenterminal (term_…)',
      ...testiLink('Zahlungslink', 'Verkauf', 'Rechnung'), 'az.terminale': 'Am Mollie-Terminal kassieren', 'giro.controlla': 'Offene Zahlungen prüfen' },
    pt: { descrizione: 'Links de pagamento e maquininha Mollie: vendas e faturas são marcadas como pagas sozinhas.', 'imp.chiave': 'Chave de API (test_… ou live_…)', 'imp.indirizzo': 'Endereço público do Kubo (para o webhook)', 'imp.webhook': 'Código secreto do webhook (vai no fim do endereço)', 'imp.ritorno': 'Página após o pagamento (ex.: seu site)', 'imp.terminale': 'Terminal POS Mollie (term_…)',
      ...testiLink('Link de pagamento', 'venda', 'fatura'), 'az.terminale': 'Cobrar no terminal Mollie', 'giro.controlla': 'Verificar pagamentos em aberto' },
  },
};
