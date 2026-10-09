// Stripe Terminal, integrazione «server-driven»: dalla vendita di Kubo l'importo va dritto sul lettore di carte del negozio
// (Stripe Reader S700, BBPOS WisePOS E), senza ribatterlo. Kubo crea il PaymentIntent card_present con metadata[vendita]
// e lo manda al lettore (POST /v1/terminal/readers/{id}/process_payment_intent). L'incasso arriva dal webhook del connettore
// Stripe (payment_intent.succeeded, stessa metadata) oppure, senza webhook, dal giro «controlla» che rilegge il PaymentIntent.
// https://docs.stripe.com/terminal/payments/setup-integration?terminal-sdk-platform=server-driven
import { incassa, daIncassare, RICHIEDE_INCASSI, PERMESSI_INCASSI } from '../_soldi/comuni.js';

const api = (k, metodo, percorso, form) => k.http.richiesta(metodo, `${k.base}${percorso}`, { bearer: k.segreti.chiave, form });
const errore = r => new Error(`Stripe ha risposto ${r.stato}: ${String(r.json?.error?.message || r.testo || '').slice(0, 200)}`);
const lettore = (k, x) => String(x || k.imp.lettore || '');
// un PaymentIntent riletto: riuscito → incasso della vendita (o della fattura) nella metadata
async function controlla(k, id) {
  const r = await api(k, 'GET', `/v1/payment_intents/${encodeURIComponent(id)}`); if (!r.ok) throw errore(r);
  const pi = r.json, aperti = (k.stato.leggi('aperti') || []).filter(x => x.id !== id || !['succeeded', 'canceled'].includes(pi.status));
  k.stato.scrivi('aperti', aperti);
  if (pi.status !== 'succeeded') return `ignorato: ${pi.status}`;
  const md = pi.metadata || {}, rif = md.fattura ? { sem: 'fatture', id: md.fattura } : { sem: 'vendite', id: md.vendita };
  return incassa(k, rif, { importo: (pi.amount_received ?? pi.amount) / 100, valuta: pi.currency, quando: (pi.created || 0) * 1000 || Date.now(), metodo: 'carta' });
}

export default {
  id: 'stripe-terminal', nome: 'Stripe Terminal', versione: 1, icona: 'cassa', base: 'https://api.stripe.com',
  descrizione: 'Manda l\'importo della vendita al lettore di carte Stripe del negozio: il cliente avvicina la carta e la vendita si segna pagata.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave segreta (sk_…) o con restrizioni (rk_…)', segreto: true, schema: /^(sk|rk)_(live|test)_\w+$/ },
    { id: 'lettore', nome: 'ID del lettore (tmr_…)', schema: /^tmr_\w+$/ },
  ],
  richiede: RICHIEDE_INCASSI,
  permessi: PERMESSI_INCASSI,
  prova: async k => { const r = await api(k, 'GET', `/v1/terminal/readers/${encodeURIComponent(lettore(k))}`); return { ok: r.ok && r.json?.status !== 'offline', messaggio: !r.ok ? `HTTP ${r.stato}` : r.json?.status === 'offline' ? 'Il lettore è spento o senza rete' : r.json?.label || null }; },
  azioni: {
    incassa: {
      nome: 'Incassa con il lettore', descrizione: 'Manda l\'importo della vendita al lettore di carte Stripe del negozio', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'relazione', entita: 'vendite', nome: 'La vendita da incassare' } },
      proponi: async ({ vendita }, k) => ({ titolo: 'Pagamento con carta al lettore', righe: [['Vendita', vendita.numero || vendita.id], ['Importo', k.euro(daIncassare(k, 'vendite', vendita))], ['Lettore', lettore(k)]],
        avvisi: k.valore(vendita, 'vendite', 'stato') === 'pagata' ? ['È già pagata'] : [] }),
      async esegui({ vendita }, k) {
        if (k.valore(vendita, 'vendite', 'stato') === 'pagata') throw new Error('È già pagata');
        const cent = Math.round(daIncassare(k, 'vendite', vendita) * 100); if (!(cent > 0)) throw new Error('L\'importo è zero');
        const pi = await api(k, 'POST', '/v1/payment_intents', { amount: cent, currency: 'eur', 'payment_method_types[0]': 'card_present', capture_method: 'automatic',
          'metadata[vendita]': vendita.id, description: `Vendita ${vendita.numero || vendita.id}` });
        if (!pi.ok) throw errore(pi);
        const r = await api(k, 'POST', `/v1/terminal/readers/${encodeURIComponent(lettore(k))}/process_payment_intent`, { payment_intent: pi.json.id });
        if (!r.ok) { await api(k, 'POST', `/v1/payment_intents/${pi.json.id}/cancel`, {}); throw errore(r); }   // lettore occupato o spento: niente intent appeso
        k.stato.scrivi('aperti', [...(k.stato.leggi('aperti') || []), { id: pi.json.id, vendita: vendita.id, creato: Date.now() }].slice(-200));
        return { pagamento: pi.json.id, lettore: r.json?.id, stato: r.json?.action?.status || 'in_progress' };
      },
    },
    annulla: {
      nome: 'Annulla sul lettore', descrizione: 'Ferma il pagamento in corso sul lettore (se il cliente ci ripensa)', su: 'vendite', scrive: true,
      input: { vendita: { tipo: 'relazione', entita: 'vendite', nome: 'La vendita' } },
      proponi: async (_, k) => ({ titolo: 'Annulla il pagamento sul lettore', righe: [['Lettore', lettore(k)]], avvisi: [] }),
      async esegui(_, k) { const r = await api(k, 'POST', `/v1/terminal/readers/${encodeURIComponent(lettore(k))}/cancel_action`, {}); if (!r.ok) throw errore(r); return { ok: true }; },
    },
  },
  // senza il webhook del connettore Stripe: ogni minuto si rileggono i pagamenti mandati al lettore nell'ultima ora
  pianificati: {
    controlla: { ogni: '1m', async giro(k) {
      const aperti = (k.stato.leggi('aperti') || []).filter(x => Date.now() - x.creato < 36e5); k.stato.scrivi('aperti', aperti);
      const esiti = []; for (const x of aperti) esiti.push(await controlla(k, x.id));
      return { controllati: aperti.length, pagati: esiti.filter(e => e === 'pagata').length };
    } },
  },
  catalogo: {
    categoria: 'cassa', sito: 'https://stripe.com/it/terminal',
    costo: 'a-consumo', costoNota: 'Commissione Stripe Terminal per le carte dello Spazio economico europeo: 1,4% + 0,10 € a transazione, nessun canone. Il lettore si compra a parte (Stripe Reader S700 o BBPOS WisePOS E, da circa 250 €).',
    serve: [
      { cosa: 'Chiave segreta (o con restrizioni: PaymentIntents e Terminal in scrittura)', dove: 'Dashboard Stripe › Sviluppatori › Chiavi API', link: 'https://dashboard.stripe.com/apikeys' },
      { cosa: 'L\'ID del lettore registrato (tmr_…)', dove: 'Dashboard Stripe › Terminal › Lettori › il tuo lettore (registralo con il codice che mostra sullo schermo)', link: 'https://dashboard.stripe.com/terminal' },
    ],
    passi: ['Compra un lettore Stripe compatibile con l\'integrazione server (S700 o WisePOS E).', 'Nel Dashboard registralo in una «location» del negozio con il codice che mostra sullo schermo.', 'Copia in Kubo la chiave segreta e l\'ID del lettore (tmr_…), poi premi «Prova la connessione».', 'Per l\'incasso immediato accendi anche il connettore Stripe con il suo webhook (evento payment_intent.succeeded); senza, Kubo controlla ogni minuto.', 'Dalla vendita premi «Incassa con il lettore»: il cliente avvicina la carta e la vendita diventa pagata.'],
    difficolta: 'media', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://docs.stripe.com/terminal/payments/setup-integration?terminal-sdk-platform=server-driven', 'https://docs.stripe.com/api/terminal/readers/process_payment_intent', 'https://docs.stripe.com/api/payment_intents/create', 'https://stripe.com/it/pricing'],
    prova: 'finto', parole: ['stripe', 'terminal', 'pos', 'lettore di carte', 'contactless', 'carta', 'tap to pay', 'card reader', 'in-person payments'],
  },
  testi: {
    en: { descrizione: 'Sends the sale amount to the shop\'s Stripe card reader: the customer taps the card and the sale is marked paid.', 'imp.chiave': 'Secret key (sk_…) or restricted key (rk_…)', 'imp.lettore': 'Reader ID (tmr_…)', 'az.incassa': 'Collect with the reader', 'az.annulla': 'Cancel on the reader', 'giro.controlla': 'Check reader payments',
      'cat.costoNota': 'Stripe Terminal fee for EEA cards: 1.4% + €0.10 per transaction, no monthly fee. The reader is bought separately (Stripe Reader S700 or BBPOS WisePOS E, from about €250).',
      'cat.serve': [{ cosa: 'Secret key (or restricted: write on PaymentIntents and Terminal)', dove: 'Stripe Dashboard › Developers › API keys' }, { cosa: 'The registered reader ID (tmr_…)', dove: 'Stripe Dashboard › Terminal › Readers › your reader (register it with the code shown on its screen)' }],
      'cat.passi': ['Buy a Stripe reader that supports the server-driven integration (S700 or WisePOS E).', 'Register it in the Dashboard to a shop «location» with the code shown on its screen.', 'Copy the secret key and reader ID (tmr_…) into Kubo, then press «Test connection».', 'For instant payment notice also switch on the Stripe connector with its webhook (payment_intent.succeeded); without it Kubo checks every minute.', 'From a sale press «Collect with the reader»: the customer taps the card and the sale becomes paid.'] },
    es: { descrizione: 'Envía el importe de la venta al lector de tarjetas Stripe de la tienda: el cliente acerca la tarjeta y la venta queda pagada.', 'imp.chiave': 'Clave secreta (sk_…) o restringida (rk_…)', 'imp.lettore': 'ID del lector (tmr_…)', 'az.incassa': 'Cobrar con el lector', 'az.annulla': 'Cancelar en el lector', 'giro.controlla': 'Revisar pagos del lector' },
    fr: { descrizione: 'Envoie le montant de la vente au lecteur de cartes Stripe du magasin : le client approche sa carte et la vente est payée.', 'imp.chiave': 'Clé secrète (sk_…) ou restreinte (rk_…)', 'imp.lettore': 'ID du lecteur (tmr_…)', 'az.incassa': 'Encaisser avec le lecteur', 'az.annulla': 'Annuler sur le lecteur', 'giro.controlla': 'Vérifier les paiements du lecteur' },
    de: { descrizione: 'Schickt den Verkaufsbetrag an das Stripe-Kartenlesegerät des Ladens: der Kunde hält die Karte hin und der Verkauf ist bezahlt.', 'imp.chiave': 'Geheimer Schlüssel (sk_…) oder eingeschränkter (rk_…)', 'imp.lettore': 'Lesegerät-ID (tmr_…)', 'az.incassa': 'Mit dem Lesegerät kassieren', 'az.annulla': 'Am Lesegerät abbrechen', 'giro.controlla': 'Zahlungen am Lesegerät prüfen' },
    pt: { descrizione: 'Envia o valor da venda para o leitor de cartões Stripe da loja: o cliente aproxima o cartão e a venda fica paga.', 'imp.chiave': 'Chave secreta (sk_…) ou restrita (rk_…)', 'imp.lettore': 'ID do leitor (tmr_…)', 'az.incassa': 'Cobrar com o leitor', 'az.annulla': 'Cancelar no leitor', 'giro.controlla': 'Verificar pagamentos do leitor' },
  },
};
