// Stripe: i pagamenti segnano pagate le vendite (o le fatture), e Lumi crea i link di pagamento.
// Webhook firmati (Stripe-Signature, HMAC sul corpo grezzo: https://docs.stripe.com/webhooks#verify-manually).
// Il pagamento porta «metadata[vendita]» o «metadata[fattura]» con l'id della riga di Kubo; l'importo deve tornare.
// checkout.session.completed arriva anche con un bonifico SEPA non ancora incassato (payment_status «unpaid»): pagata solo con
// «paid»; quei pagamenti arrivano dopo con checkout.session.async_payment_succeeded (https://docs.stripe.com/checkout/fulfillment)
const eventoPagato = ev => ev.type === 'payment_intent.succeeded' || ev.type === 'checkout.session.async_payment_succeeded'
  || (ev.type === 'checkout.session.completed' && ev.data?.object?.payment_status === 'paid');
export default {
  id: 'stripe', nome: 'Stripe', versione: 1, icona: 'cassa', base: 'https://api.stripe.com',
  descrizione: 'Pagamenti online e POS: le vendite e le fatture si segnano pagate da sole.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave segreta (sk_…) o con restrizioni (rk_…)', segreto: true, schema: /^(sk|rk)_(live|test)_\w+$/ },
    { id: 'firma', nome: 'Segreto del webhook (whsec_…)', segreto: true, schema: /^whsec_\w+$/ },
  ],
  richiede: { vendite: { stato: { tipo: 'stato' }, totale: {}, pagamento: { tipo: 'scelta', facoltativo: true } }, fatture: { stato: { tipo: 'stato', facoltativo: true }, totale: { facoltativo: true }, netto: { facoltativo: true }, pagata_il: { tipo: 'data', facoltativo: true } } },
  permessi: { vendite: { leggi: true, modifica: true }, fatture: { leggi: true, modifica: true } },
  prova: async k => { const r = await k.http.get(`${k.base}/v1/balance`, { bearer: k.segreti.chiave }); return { ok: r.ok, messaggio: r.ok ? null : r.json?.error?.message || `HTTP ${r.stato}` }; },
  entrata: {
    firma: { tipo: 'stripe', segreto: 'firma' },
    idempotenza: ev => ev.id,
    async gestisci(ev, k) {
      if (!eventoPagato(ev)) return 'ignorato';
      const o = ev.data?.object || {}, md = o.metadata || {}, sem = md.fattura ? 'fatture' : 'vendite', id = md.fattura || md.vendita;
      if (!id) return 'ignorato: senza riga di Kubo';
      if (o.currency && o.currency !== 'eur') return k.avvisa(`pagamento ${o.id} in ${o.currency}: controllalo a mano`);
      let r; try { r = k.dati.leggi(sem, id); } catch { return k.avvisa(`pagamento ${o.id} per una riga che non c'è (${id})`); }
      if (k.valore(r, sem, 'stato') === 'pagata') return 'ignorato: già pagata';   // il PaymentIntent e la Checkout Session dello stesso pagamento
      // una fattura con la ritenuta d'acconto si incassa al netto (totale − ritenuta): il cliente versa la ritenuta all'Erario
      const netto = sem === 'fatture' && k.campo('fatture', 'netto') ? k.valore(r, sem, 'netto') : null;
      const pagato = (o.amount_received ?? o.amount_total ?? o.amount ?? 0) / 100, totale = Number(netto ?? k.valore(r, sem, 'totale') ?? 0);
      if (Math.abs(totale - pagato) > 0.005) return k.avvisa(`pagamento di ${k.euro(pagato)} diverso dal totale di ${k.euro(totale)}`);
      // la data dell'incasso serve (criterio di cassa, forfettari): quella del pagamento su Stripe, nel fuso dell'azienda
      const il = new Date(((o.created || ev.created) * 1000) || Date.now()).toLocaleDateString('sv-SE', { timeZone: k.fuso() });
      await k.dati.modifica(sem, id, { stato: 'pagata', ...(sem === 'vendite' && k.campo('vendite', 'pagamento') ? { pagamento: 'carta' } : {}),
        ...(sem === 'fatture' && k.campo('fatture', 'pagata_il') ? { pagata_il: il } : {}) });
      return 'pagata';
    },
  },
  azioni: {
    link_pagamento: {
      nome: 'Link di pagamento', descrizione: 'Crea un link Stripe per far pagare una vendita al cliente', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'relazione', entita: 'vendite', nome: 'La vendita da far pagare' } },
      proponi: async ({ vendita }, k) => ({ titolo: 'Link di pagamento Stripe', righe: [['Vendita', vendita.numero || vendita.id], ['Importo', k.euro(k.valore(vendita, 'vendite', 'totale'))]], avvisi: [] }),
      async esegui({ vendita }, k) {
        const cent = Math.round(Number(k.valore(vendita, 'vendite', 'totale') || 0) * 100);
        const r = await k.http.post(`${k.base}/v1/checkout/sessions`, { bearer: k.segreti.chiave, form: {
          mode: 'payment', 'line_items[0][quantity]': 1, 'line_items[0][price_data][currency]': 'eur', 'line_items[0][price_data][unit_amount]': cent,
          'line_items[0][price_data][product_data][name]': `Vendita ${vendita.numero || vendita.id}`, 'metadata[vendita]': vendita.id, 'payment_intent_data[metadata][vendita]': vendita.id,
          success_url: 'https://checkout.stripe.com/success' } });
        if (!r.ok) throw new Error(r.json?.error?.message || `Stripe ha risposto ${r.stato}`);
        return { url: r.json.url };
      },
    },
  },
  testi: {
    en: { descrizione: 'Online and in-person payments: sales and invoices get marked paid on their own.', 'imp.chiave': 'Secret key (sk_…) or restricted key (rk_…)', 'imp.firma': 'Webhook secret (whsec_…)', 'az.link_pagamento': 'Payment link' },
    es: { descrizione: 'Pagos online y TPV: las ventas y facturas se marcan pagadas solas.', 'imp.chiave': 'Clave secreta (sk_…) o restringida (rk_…)', 'imp.firma': 'Secreto del webhook (whsec_…)', 'az.link_pagamento': 'Enlace de pago' },
    fr: { descrizione: 'Paiements en ligne et TPE : les ventes et factures se marquent payées toutes seules.', 'imp.chiave': 'Clé secrète (sk_…) ou restreinte (rk_…)', 'imp.firma': 'Secret du webhook (whsec_…)', 'az.link_pagamento': 'Lien de paiement' },
    de: { descrizione: 'Online- und Kartenzahlungen: Verkäufe und Rechnungen werden von selbst als bezahlt markiert.', 'imp.chiave': 'Geheimer Schlüssel (sk_…) oder eingeschränkter (rk_…)', 'imp.firma': 'Webhook-Geheimnis (whsec_…)', 'az.link_pagamento': 'Zahlungslink' },
    pt: { descrizione: 'Pagamentos online e maquininha: vendas e faturas são marcadas como pagas sozinhas.', 'imp.chiave': 'Chave secreta (sk_…) ou restrita (rk_…)', 'imp.firma': 'Segredo do webhook (whsec_…)', 'az.link_pagamento': 'Link de pagamento' },
  },
};
