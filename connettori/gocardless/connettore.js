// GoCardless: addebito diretto SEPA (SDD Core). Il cliente firma il mandato una volta (Billing Request + flusso ospitato),
// poi le fatture si addebitano dal suo conto e si segnano pagate quando GoCardless conferma l'incasso.
// API: https://docs.gocardless.com/api-reference (Bearer, «GoCardless-Version: 2015-07-06», «Idempotency-Key» sulle creazioni).
// Webhook (https://docs.gocardless.com/docs/api-reference/webhooks): «Webhook-Signature» = HMAC-SHA256 esadecimale del corpo grezzo
// con il segreto dell'endpoint; il corpo è { events: [...] }, a gruppi
// e porta solo gli id: pagamenti, mandati e billing request si rileggono dall'API. Il mandato ↔ cliente sta nella mappa del connettore.
import { randomUUID } from 'node:crypto';
import { RICHIEDE_INCASSI, PERMESSI_INCASSI, incassa, daIncassare, riferimento, nomeRiga } from '../_soldi/comuni.js';

const VERSIONE = '2015-07-06';
// il token dice l'ambiente: sandbox_… va sulla sandbox, live_… sul conto vero
const base = k => k.base || (/^sandbox_/.test(k.segreti.token || '') ? 'https://api-sandbox.gocardless.com' : 'https://api.gocardless.com');
const opz = (k, extra = {}) => ({ bearer: k.segreti.token, intestazioni: { 'GoCardless-Version': VERSIONE, ...extra } });
const errore = r => new Error(r.json?.error?.message || `GoCardless ha risposto ${r.stato}`);
async function leggi(k, cosa, id) {
  const r = await k.http.get(`${base(k)}/${cosa}/${encodeURIComponent(id)}`, opz(k));
  if (r.stato === 404) return null;
  if (!r.ok) throw errore(r);
  return r.json?.[cosa];
}
const PAGATO = ['confirmed', 'paid_out'], MALE = ['failed', 'charged_back', 'late_failure_settled', 'cancelled'];
const sicuro = id => /^[A-Z]{2}[\w]{1,60}$/.test(String(id || ''));   // PM…, MD…, BRQ…
const clienteDi = (k, f) => { const c = k.valore(f, 'fatture', 'cliente'); return c?.id ?? c ?? null; };

function collega(k, cliente, mandato) {
  if (!cliente || !mandato) return 'ignorato: senza cliente';
  try { k.dati.leggi('clienti', cliente); } catch { return k.avvisa(`mandato ${mandato} per un cliente che non c'è (${cliente})`); }
  k.sincro.collega('clienti', cliente, mandato);
  return 'mandato collegato';
}

async function evento(e, k) {
  const l = e.links || {};
  if (e.resource_type === 'payments' && sicuro(l.payment)) {
    if (MALE.includes(e.action)) return k.avvisa(`addebito ${l.payment} ${e.action}: ${e.details?.description || e.details?.cause || 'controllalo su GoCardless'}`);
    if (!PAGATO.includes(e.action)) return `ignorato: ${e.action}`;
    const p = await leggi(k, 'payments', l.payment);   // si crede solo all'API
    if (!p || !PAGATO.includes(p.status)) return `ignorato: ${p?.status || 'sconosciuto'}`;
    return incassa(k, p.metadata?.lumi, { importo: Number(p.amount) / 100, valuta: p.currency, quando: Date.parse(p.charge_date) || Date.now(), metodo: 'bonifico', fonte: 'GoCardless' });
  }
  if (e.resource_type === 'billing_requests' && e.action === 'fulfilled' && sicuro(l.billing_request)) {
    const b = await leggi(k, 'billing_requests', l.billing_request);
    return collega(k, b?.metadata?.cliente || b?.mandate_request?.metadata?.cliente, b?.links?.mandate_request_mandate);
  }
  if (e.resource_type === 'mandates' && sicuro(l.mandate)) {
    if (['cancelled', 'failed', 'expired'].includes(e.action)) return k.avvisa(`mandato ${l.mandate} ${e.action}: ${e.details?.description || ''}`.trim());
    if (e.action !== 'active') return `ignorato: ${e.action}`;
    const m = await leggi(k, 'mandates', l.mandate);
    return m?.status === 'active' ? collega(k, m.metadata?.cliente, m.id) : `ignorato: ${m?.status || 'sconosciuto'}`;
  }
  return 'ignorato';
}

export default {
  id: 'gocardless', nome: 'GoCardless', versione: 1, icona: 'cassa',
  descrizione: 'Addebito diretto SEPA: il cliente firma il mandato una volta e le fatture si incassano da sole.',
  impostazioni: [
    { id: 'token', nome: 'Access token (sandbox_… o live_…)', segreto: true, schema: /^(sandbox|live)_[\w-]{10,}$/ },
    { id: 'webhook', nome: 'Segreto dell\'endpoint webhook', segreto: true },
    { id: 'ritorno', nome: 'Pagina dopo la firma del mandato (es. il tuo sito)', tipo: 'url', obbligatorio: false },
  ],
  richiede: { ...RICHIEDE_INCASSI, fatture: { ...RICHIEDE_INCASSI.fatture, cliente: { tipo: 'relazione', facoltativo: true } }, clienti: { nome: { facoltativo: true }, email: { tipo: 'email', facoltativo: true } } },
  permessi: { ...PERMESSI_INCASSI, clienti: { leggi: true } },
  prova: async k => { const r = await k.http.get(`${base(k)}/creditors`, opz(k)); return { ok: r.ok, messaggio: r.ok ? null : r.json?.error?.message || `HTTP ${r.stato}` }; },
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'webhook-signature', segreto: 'webhook', formato: 'hex' },
    idempotenza: ev => (ev?.events || []).map(e => e.id).join(',').slice(0, 400),
    async gestisci(ev, k) {
      const esiti = [];
      for (const e of [].concat(ev?.events || []).slice(0, 250)) esiti.push(await evento(e, k));
      // prima quelli che hanno fatto qualcosa: solo se sono tutti ignorati l'esito comincia con «ignorato» e la consegna non si segna
      const ign = x => /^ignorato/.test(String(x));
      return esiti.length ? [...esiti.filter(x => !ign(x)), ...esiti.filter(ign)].join('; ').slice(0, 300) : 'ignorato';
    },
  },
  azioni: {
    mandato: {
      nome: 'Chiedi il mandato SEPA', descrizione: 'Crea il link GoCardless per far firmare al cliente il mandato di addebito SEPA', su: 'clienti', lumi: true, scrive: true,
      input: { cliente: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' } },
      proponi: async ({ cliente }, k) => ({ titolo: 'Mandato SEPA GoCardless', righe: [['Cliente', k.valore(cliente, 'clienti', 'nome') || cliente.id], ['Schema', 'SEPA Core (EUR)']],
        avvisi: k.sincro.remoto('clienti', cliente.id) ? ['Il cliente ha già un mandato: se ne firma uno nuovo'] : [] }),
      async esegui({ cliente }, k) {
        const md = { cliente: String(cliente.id) };
        const b = await k.http.post(`${base(k)}/billing_requests`, { ...opz(k, { 'Idempotency-Key': randomUUID() }),
          json: { billing_requests: { mandate_request: { scheme: 'sepa_core', currency: 'EUR', metadata: md }, metadata: md } } });
        if (!b.ok) throw errore(b);
        const email = k.valore(cliente, 'clienti', 'email'), nome = k.valore(cliente, 'clienti', 'nome');
        const f = await k.http.post(`${base(k)}/billing_request_flows`, { ...opz(k, { 'Idempotency-Key': randomUUID() }), json: { billing_request_flows: {
          ...(k.imp.ritorno ? { redirect_uri: k.imp.ritorno, exit_uri: k.imp.ritorno } : {}),
          prefilled_customer: { ...(email ? { email } : {}), ...(nome ? { company_name: String(nome).slice(0, 100) } : {}) },
          links: { billing_request: b.json.billing_requests.id } } } });
        if (!f.ok) throw errore(f);
        return { url: f.json.billing_request_flows.authorisation_url, id: b.json.billing_requests.id };
      },
    },
    addebita: {
      nome: 'Addebita la fattura (SEPA)', descrizione: 'Addebita una fattura sul conto del cliente con il suo mandato SEPA GoCardless', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da addebitare' } },
      proponi: async ({ fattura }, k) => {
        const imp = daIncassare(k, 'fatture', fattura), md = k.sincro.remoto('clienti', clienteDi(k, fattura));
        return { titolo: 'Addebito SEPA GoCardless', righe: [['Fattura', k.valore(fattura, 'fatture', 'numero') || fattura.id], ['Importo', k.euro(imp)], ['Mandato', md || '—']],
          avvisi: [...(md ? [] : ['Il cliente non ha un mandato: chiedilo prima']), ...(k.valore(fattura, 'fatture', 'stato') === 'pagata' ? ['È già pagata'] : []), ...(imp <= 0 ? ['L\'importo è zero'] : [])] };
      },
      async esegui({ fattura }, k) {
        const importo = daIncassare(k, 'fatture', fattura), mandato = k.sincro.remoto('clienti', clienteDi(k, fattura));
        if (k.valore(fattura, 'fatture', 'stato') === 'pagata') throw new Error('È già pagata');
        if (!(importo > 0)) throw new Error('L\'importo da addebitare è zero');
        if (!mandato) throw new Error('Il cliente non ha un mandato SEPA: chiedilo prima');
        const r = await k.http.post(`${base(k)}/payments`, { ...opz(k, { 'Idempotency-Key': randomUUID() }), json: { payments: {
          amount: Math.round(importo * 100), currency: 'EUR', description: nomeRiga(k, 'fatture', fattura).slice(0, 100),
          metadata: { lumi: riferimento('fatture', fattura.id) }, links: { mandate: mandato } } } });
        if (!r.ok) throw errore(r);
        return { id: r.json.payments.id, addebito: r.json.payments.charge_date, stato: r.json.payments.status };
      },
    },
  },
  catalogo: {
    categoria: 'pagamenti',
    sito: 'https://gocardless.com/it/',
    costo: 'a-consumo',
    costoNota: 'Nessun canone con il piano Standard: circa 1% + 0,20 € per addebito, con un tetto di 4 € per gli addebiti nazionali in euro; gli addebiti internazionali costano di più. Prezzi aggiornati su gocardless.com/it/prezzi.',
    serve: [
      { cosa: 'Access token (sandbox_… per provare, live_… per incassare), con accesso in lettura e scrittura', dove: 'Dashboard GoCardless → Developers → Create → Access token', link: 'https://manage.gocardless.com/developers' },
      { cosa: 'Segreto dell\'endpoint webhook', dove: 'Dashboard GoCardless → Developers → Create → Webhook endpoint', link: 'https://manage.gocardless.com/developers' },
    ],
    passi: [
      'Crea l\'account su gocardless.com (o prima la sandbox su manage-sandbox.gocardless.com) e verifica l\'attività.',
      'In Developers crea un access token con lettura e scrittura e incollalo in Lumi.',
      'In Developers crea un webhook endpoint con l\'indirizzo che Lumi mostra (…/api/connettori/gocardless/in).',
      'Copia il segreto dell\'endpoint e incollalo in Lumi, poi accendi il connettore.',
      'Dalla scheda di un cliente usa «Chiedi il mandato SEPA» e mandagli il link da firmare.',
      'Quando il mandato è attivo, dalla fattura usa «Addebita la fattura»: si segna pagata quando GoCardless conferma l\'incasso.',
    ],
    difficolta: 'media',
    zone: ['IT', 'UE'],
    fonti: ['https://docs.gocardless.com/api-reference', 'https://docs.gocardless.com/docs/api-reference/webhooks', 'https://docs.gocardless.com/docs/api-reference/events/payment', 'https://docs.gocardless.com/docs/api-reference/events/mandate', 'https://docs.gocardless.com/docs/api-reference/events/billing-request'],
    prova: 'finto',
    parole: ['gocardless', 'sepa', 'sdd', 'addebito diretto', 'rid', 'mandato', 'domiciliazione', 'direct debit', 'mandate', 'recurring payments'],
  },
  testi: {
    en: { descrizione: 'SEPA Direct Debit: the customer signs the mandate once and invoices get collected on their own.', 'imp.token': 'Access token (sandbox_… or live_…)', 'imp.webhook': 'Webhook endpoint secret', 'imp.ritorno': 'Page after signing the mandate (e.g. your website)',
      'az.mandato': 'Request the SEPA mandate', 'az.addebita': 'Collect the invoice (SEPA)',
      'cat.costoNota': 'No monthly fee on the Standard plan: about 1% + €0.20 per collection, capped at €4 for domestic euro collections; international collections cost more. Current prices on gocardless.com/it/prezzi.',
      'cat.serve': [{ cosa: 'Access token (sandbox_… to try, live_… to get paid), with read-write access', dove: 'GoCardless Dashboard → Developers → Create → Access token' }, { cosa: 'Webhook endpoint secret', dove: 'GoCardless Dashboard → Developers → Create → Webhook endpoint' }],
      'cat.passi': ['Create an account on gocardless.com (or the sandbox first, on manage-sandbox.gocardless.com) and verify the business.', 'In Developers create a read-write access token and paste it into Lumi.', 'In Developers create a webhook endpoint with the address Lumi shows (…/api/connettori/gocardless/in).', 'Copy the endpoint secret, paste it into Lumi, then switch the connector on.', 'From a customer\'s card use «Request the SEPA mandate» and send them the link to sign.', 'Once the mandate is active, use «Collect the invoice» on the invoice: it is marked paid when GoCardless confirms the collection.'] },
    es: { descrizione: 'Adeudo directo SEPA: el cliente firma el mandato una vez y las facturas se cobran solas.', 'imp.token': 'Access token (sandbox_… o live_…)', 'imp.webhook': 'Secreto del endpoint del webhook', 'imp.ritorno': 'Página tras firmar el mandato (p. ej. tu web)', 'az.mandato': 'Pedir el mandato SEPA', 'az.addebita': 'Cobrar la factura (SEPA)' },
    fr: { descrizione: 'Prélèvement SEPA : le client signe le mandat une fois et les factures s\'encaissent toutes seules.', 'imp.token': 'Access token (sandbox_… ou live_…)', 'imp.webhook': 'Secret du point de terminaison webhook', 'imp.ritorno': 'Page après la signature du mandat (ex. votre site)', 'az.mandato': 'Demander le mandat SEPA', 'az.addebita': 'Prélever la facture (SEPA)' },
    de: { descrizione: 'SEPA-Lastschrift: Der Kunde unterschreibt das Mandat einmal, und Rechnungen werden von selbst eingezogen.', 'imp.token': 'Access Token (sandbox_… oder live_…)', 'imp.webhook': 'Geheimnis des Webhook-Endpunkts', 'imp.ritorno': 'Seite nach der Mandatsunterschrift (z. B. deine Website)', 'az.mandato': 'SEPA-Mandat anfordern', 'az.addebita': 'Rechnung einziehen (SEPA)' },
    pt: { descrizione: 'Débito direto SEPA: o cliente assina o mandato uma vez e as faturas são cobradas sozinhas.', 'imp.token': 'Access token (sandbox_… ou live_…)', 'imp.webhook': 'Segredo do endpoint do webhook', 'imp.ritorno': 'Página após assinar o mandato (ex.: seu site)', 'az.mandato': 'Pedir o mandato SEPA', 'az.addebita': 'Cobrar a fatura (SEPA)' },
  },
};
