// Qonto: i movimenti del conto Qonto entrano in Kubo e si abbinano alle fatture (Business API v2, https://docs.qonto.com).
// Accesso con la chiave API dell'organizzazione: «Authorization: <login>:<chiave segreta>», senza Base64 e senza «Bearer»
// (https://docs.qonto.com/get-started/business-api/authentication/api-key). GET /v2/organization dà i conti (bank_accounts),
// GET /v2/transactions?bank_account_id=…&settled_at_from=…&status[]=completed&page=N le operazioni contabilizzate, a pagine (meta.next_page).
import { registraMovimenti, RICHIEDE_BANCA, PERMESSI_BANCA } from '../_soldi/banca.js';
import { giorno } from '../_soldi/comuni.js';

const accesso = k => ({ Authorization: `${String(k.imp.login || '').trim()}:${k.segreti.chiave}` });
const errore = (r, cosa) => new Error(`${cosa}: Qonto ha risposto ${r.stato}${r.json?.errors?.[0]?.detail || r.json?.message ? ` (${String(r.json?.errors?.[0]?.detail || r.json.message).slice(0, 200)})` : ''}`);
async function conti(k) {
  const r = await k.http.get(`${k.base}/v2/organization`, { intestazioni: accesso(k) });
  if (!r.ok) throw errore(r, 'Organizzazione');
  return (r.json?.organization?.bank_accounts || []).filter(c => c.id && (!c.status || c.status === 'active'));
}
// un'operazione Qonto nel formato comune di banca.js; il giorno è quello del fuso dell'azienda
const movimento = (k, t, conto) => ({
  id: String(t.id || t.transaction_id), data: giorno(k, Date.parse(t.settled_at || t.emitted_at) || Date.now()), importo: (t.side === 'credit' ? 1 : -1) * Math.abs(Number(t.amount)),
  valuta: t.currency || 'EUR', descrizione: [t.reference, t.note].filter(Boolean).join(' ').trim() || t.label || '', controparte: t.label || '', conto: conto.iban || conto.slug,
});

export default {
  id: 'qonto', nome: 'Qonto', versione: 1, icona: 'cassa', base: 'https://thirdparty.qonto.com',
  descrizione: 'I movimenti del conto Qonto entrano in Kubo e si abbinano alle fatture da incassare e da pagare.',
  impostazioni: [
    { id: 'login', nome: 'Login dell\'organizzazione (es. bottega-1234)', schema: /^[\w.-]{2,80}$/ },
    { id: 'chiave', nome: 'Chiave segreta API', segreto: true },
  ],
  richiede: RICHIEDE_BANCA,
  permessi: PERMESSI_BANCA,
  prova: async k => { const r = await k.http.get(`${k.base}/v2/organization`, { intestazioni: accesso(k) }); return { ok: r.ok, messaggio: r.ok ? null : `HTTP ${r.stato}` }; },
  azioni: {
    conti: { nome: 'Conti Qonto', descrizione: 'Elenca i conti dell\'organizzazione', esegui: async (_, k) => ({ conti: (await conti(k)).map(c => ({ nome: c.name, iban: c.iban, saldo: c.balance, valuta: c.currency })) }) },
  },
  pianificati: {
    movimenti: {
      nome: 'Movimenti', ogni: '2h',
      async giro(k) {
        const dal = k.stato.leggi('dal') || {}, lista = [];
        for (const c of await conti(k)) {
          const da = dal[c.id] || new Date(Date.now() - 30 * 864e5).toISOString();
          for (let pagina = 1, n = 0; pagina && n < 200; n++) {
            const u = new URL(`${k.base}/v2/transactions`);
            u.searchParams.set('bank_account_id', c.id); u.searchParams.append('status[]', 'completed'); u.searchParams.set('settled_at_from', da);
            u.searchParams.set('sort_by', 'settled_at:asc'); u.searchParams.set('per_page', '100'); u.searchParams.set('page', String(pagina));
            const r = await k.http.get(u.href, { intestazioni: accesso(k) });
            if (!r.ok) throw errore(r, 'Movimenti');
            for (const t of r.json?.transactions || []) if ((!t.status || t.status === 'completed') && Number.isFinite(Number(t.amount))) lista.push(movimento(k, t, c));
            pagina = Number(r.json?.meta?.next_page) || 0;
          }
          dal[c.id] = new Date(Date.now() - 3 * 864e5).toISOString();   // un po' di sovrapposizione: i doppioni li toglie banca.js
        }
        const ris = registraMovimenti(k, lista); k.stato.scrivi('dal', dal); k.stato.scrivi('ultimo', giorno(k));
        return ris;
      },
    },
  },
  catalogo: {
    categoria: 'banche',
    sito: 'https://qonto.com/it',
    costo: 'abbonamento',
    costoNota: 'L\'API è compresa nel conto Qonto, senza costi in più; il conto ha un canone mensile che dipende dal piano (i prezzi aggiornati sono su qonto.com/it/pricing).',
    serve: [{ cosa: 'Il login dell\'organizzazione e la chiave segreta API', dove: 'App Qonto › Impostazioni › Integrazioni e partner › Chiave API', link: 'https://app.qonto.com' }],
    passi: [
      'Accedi a app.qonto.com con un utente titolare o amministratore.',
      'Apri Impostazioni › Integrazioni e partner › Chiave API e premi «Genera».',
      'Copia il login (es. bottega-1234) e la chiave segreta.',
      'In Kubo incolla login e chiave e accendi il connettore: i movimenti arrivano ogni due ore, o subito con «Sincronizza ora».',
      'Prima di accendere, in Tesoreria premi «Prepara»: i movimenti entrano in «Movimenti di banca» e si abbinano alle fatture in Tesoreria › Banca (anche da Lumi).',
    ],
    difficolta: 'facile',
    zone: ['IT', 'UE'],
    fonti: ['https://docs.qonto.com/get-started/business-api/authentication/api-key', 'https://docs.qonto.com/api-reference/business-api/transactions-statements/transactions/list-transactions', 'https://docs.qonto.com/api-reference/business-api/accounts-organizations/organizations/retrieve-the-authenticated-organization-and-list-bank-accounts'],
    prova: 'finto',
    parole: ['qonto', 'banca', 'conto aziendale', 'movimenti', 'riconciliazione', 'bonifici', 'bank', 'business account', 'transactions', 'reconciliation'],
  },
  testi: {
    en: { descrizione: 'Your Qonto account transactions flow into Kubo and get matched to invoices to collect and to pay.',
      'imp.login': 'Organization login (e.g. bottega-1234)', 'imp.chiave': 'API secret key', 'az.conti': 'Qonto accounts', 'giro.movimenti': 'Transactions',
      'cat.costoNota': 'The API comes with the Qonto account at no extra cost; the account has a monthly fee depending on the plan (current prices at qonto.com/it/pricing).',
      'cat.serve': [{ cosa: 'The organization login and the API secret key', dove: 'Qonto app › Settings › Integrations & partnerships › API key' }],
      'cat.passi': [
        'Sign in to app.qonto.com as an owner or admin.',
        'Open Settings › Integrations & partnerships › API key and press «Generate».',
        'Copy the login (e.g. bottega-1234) and the secret key.',
        'In Kubo paste login and key and switch the connector on: transactions arrive every two hours, or right away with «Sync now».',
        'Before switching it on, press «Prepare» in Treasury: transactions land in «Bank transactions» and are matched to invoices in Treasury › Bank (Lumi can do it too).',
      ] },
    es: { descrizione: 'Los movimientos de tu cuenta Qonto entran en Kubo y se concilian con las facturas por cobrar y por pagar.',
      'imp.login': 'Login de la organización (p. ej. bottega-1234)', 'imp.chiave': 'Clave secreta de la API', 'az.conti': 'Cuentas Qonto', 'giro.movimenti': 'Movimientos' },
    fr: { descrizione: 'Les opérations de ton compte Qonto arrivent dans Kubo et sont rapprochées des factures à encaisser et à payer.',
      'imp.login': 'Identifiant de l\'organisation (ex. bottega-1234)', 'imp.chiave': 'Clé secrète API', 'az.conti': 'Comptes Qonto', 'giro.movimenti': 'Opérations' },
    de: { descrizione: 'Die Umsätze deines Qonto-Kontos kommen in Kubo an und werden offenen Ein- und Ausgangsrechnungen zugeordnet.',
      'imp.login': 'Login der Organisation (z. B. bottega-1234)', 'imp.chiave': 'Geheimer API-Schlüssel', 'az.conti': 'Qonto-Konten', 'giro.movimenti': 'Umsätze' },
    pt: { descrizione: 'Os movimentos da sua conta Qonto entram no Kubo e são conciliados com as faturas a receber e a pagar.',
      'imp.login': 'Login da organização (ex.: bottega-1234)', 'imp.chiave': 'Chave secreta da API', 'az.conti': 'Contas Qonto', 'giro.movimenti': 'Movimentos' },
  },
};
