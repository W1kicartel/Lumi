// SumUp: il webhook CHECKOUT_STATUS_CHANGED non è firmato, quindi il corpo non vale niente: si rilegge il checkout
// dall'API (https://developer.sumup.com/online-payments/webhooks/) e solo se è PAID si segna pagata la vendita.
// Il checkout porta «checkout_reference» = «lumi-<id della vendita>» (lo mette l'azione «checkout»).
export default {
  id: 'sumup', nome: 'SumUp', versione: 1, icona: 'cassa', base: 'https://api.sumup.com',
  descrizione: 'Il POS e i pagamenti SumUp riconciliano gli incassi con le vendite.',
  catalogo: { categoria: 'cassa', sito: 'https://www.sumup.com/it-it/', costo: 'a-consumo', costoNota: 'Una commissione per transazione, senza canone: la tariffa dipende dal piano e dalla carta', serve: [{ cosa: 'Chiave API segreta (sup_sk_…)', dove: 'Dashboard SumUp → Impostazioni → Chiavi API', link: 'https://me.sumup.com/settings/api-keys' }, { cosa: 'Codice esercente (merchant code)', dove: 'Dashboard SumUp → Profilo: il codice che inizia con M', link: 'https://me.sumup.com' }], passi: ['Entra nella dashboard di SumUp', 'Apri Impostazioni → Chiavi API e crea una chiave segreta', 'Incolla la chiave qui e scrivi il codice esercente', 'Salva, prova la connessione e accendi', 'I checkout creati da Lumi avvisano Lumi da soli: non c\'è un webhook da configurare'], difficolta: 'facile', zone: ['IT', 'UE'], fonti: ['https://developer.sumup.com/api', 'https://developer.sumup.com/online-payments/webhooks/'], prova: 'finto', parole: ['pos', 'carta', 'lettore di carte', 'incassi', 'card reader'] },
  impostazioni: [{ id: 'chiave', nome: 'Chiave API (sup_sk_…)', segreto: true }, { id: 'merchant', nome: 'Codice esercente (merchant code)' }],
  richiede: { vendite: { stato: { tipo: 'stato' }, totale: {}, pagamento: { tipo: 'scelta', facoltativo: true } } },
  permessi: { vendite: { leggi: true, modifica: true } },
  prova: async k => { const r = await k.http.get(`${k.base}/v0.1/me`, { bearer: k.segreti.chiave }); return { ok: r.ok, messaggio: r.ok ? null : `HTTP ${r.stato}` }; },
  entrata: {
    firma: { tipo: 'nessuna' },   // «richiama»: si crede solo all'API
    async gestisci(ev, k) {
      if (ev?.event_type !== 'CHECKOUT_STATUS_CHANGED' || !/^[\w-]{1,80}$/.test(String(ev.id || ''))) return 'ignorato';
      const r = await k.http.get(`${k.base}/v0.1/checkouts/${encodeURIComponent(ev.id)}`, { bearer: k.segreti.chiave });
      if (!r.ok) throw new Error(`SumUp ha risposto ${r.stato}`);
      const c = r.json, vid = /^lumi-(\w+)$/.exec(c.checkout_reference || '')?.[1];
      if (c.status !== 'PAID' || !vid) return 'ignorato: ' + c.status;
      let v; try { v = k.dati.leggi('vendite', vid); } catch { return k.avvisa(`checkout ${c.id} per una vendita che non c'è`); }
      if (Math.abs(Number(k.valore(v, 'vendite', 'totale') || 0) - Number(c.amount)) > 0.005 || (c.currency && c.currency !== 'EUR')) return k.avvisa(`checkout ${c.id}: importo ${c.amount} ${c.currency} diverso dalla vendita`);
      k.dati.modifica('vendite', vid, { stato: 'pagata', ...(k.campo('vendite', 'pagamento') ? { pagamento: 'carta' } : {}) });
      return 'pagata';
    },
    idempotenza: ev => `${ev?.id}:${ev?.event_type}`,
  },
  azioni: {
    checkout: {
      nome: 'Checkout SumUp', descrizione: 'Prepara un pagamento SumUp per una vendita', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'relazione', entita: 'vendite', nome: 'La vendita' } },
      proponi: async ({ vendita }, k) => ({ titolo: 'Checkout SumUp', righe: [['Vendita', vendita.numero || vendita.id], ['Importo', k.euro(k.valore(vendita, 'vendite', 'totale'))]], avvisi: [] }),
      async esegui({ vendita }, k) {
        const r = await k.http.post(`${k.base}/v0.1/checkouts`, { bearer: k.segreti.chiave, json: { checkout_reference: `lumi-${vendita.id}`, amount: Number(k.valore(vendita, 'vendite', 'totale') || 0), currency: 'EUR', merchant_code: k.imp.merchant } });
        if (!r.ok) throw new Error(`SumUp ha risposto ${r.stato}`);
        return { checkout: r.json.id };
      },
    },
  },
  testi: {
    en: { 'cat.costoNota': 'A fee per transaction, no monthly fee: the rate depends on the plan and the card', 'cat.serve': [{ cosa: 'Secret API key (sup_sk_…)', dove: 'SumUp dashboard → Settings → API keys' }, { cosa: 'Merchant code', dove: 'SumUp dashboard → Profile: the code starting with M' }], 'cat.passi': ['Sign in to the SumUp dashboard', 'Open Settings → API keys and create a secret key', 'Paste the key here and type your merchant code', 'Save, test the connection and switch it on', 'Checkouts created by Lumi notify Lumi on their own: there is no webhook to set up'],
      descrizione: 'SumUp card reader and payments reconcile takings with sales.', 'imp.chiave': 'API key (sup_sk_…)', 'imp.merchant': 'Merchant code', 'az.checkout': 'SumUp checkout' },
    es: { descrizione: 'El TPV y los pagos de SumUp concilian los cobros con las ventas.', 'imp.chiave': 'Clave API (sup_sk_…)', 'imp.merchant': 'Código de comercio', 'az.checkout': 'Pago SumUp' },
    fr: { descrizione: 'Le TPE et les paiements SumUp rapprochent les encaissements des ventes.', 'imp.chiave': 'Clé API (sup_sk_…)', 'imp.merchant': 'Code marchand', 'az.checkout': 'Paiement SumUp' },
    de: { descrizione: 'SumUp-Kartenleser und -Zahlungen gleichen Einnahmen mit Verkäufen ab.', 'imp.chiave': 'API-Schlüssel (sup_sk_…)', 'imp.merchant': 'Händlercode', 'az.checkout': 'SumUp-Checkout' },
    pt: { descrizione: 'A maquininha e os pagamentos SumUp conciliam os recebimentos com as vendas.', 'imp.chiave': 'Chave de API (sup_sk_…)', 'imp.merchant': 'Código do lojista', 'az.checkout': 'Checkout SumUp' },
  },
};
