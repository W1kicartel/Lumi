// Enable Banking: i movimenti dei conti di (quasi) tutte le banche italiane ed europee, con l'open banking PSD2 (AIS).
// Accesso: un JWT RS256 firmato con la chiave privata dell'applicazione, header { typ, alg, kid = id dell'applicazione },
// payload { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp } con durata massima 24 ore
// (https://enablebanking.com/docs/api/reference/). Il collegamento: POST /auth → la persona dà il consenso sul sito della
// banca → la banca torna alla pagina pubblica «ritorno» di Kubo con ?code&state → POST /sessions { code } → la sessione e
// gli uid dei conti. Poi GET /accounts/{uid}/transactions?date_from=… a pagine (continuation_key). Il consenso dura al
// massimo ~180 giorni (dipende dalla banca): una settimana prima Kubo avvisa di rinnovarlo.
import { createSign, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { registraMovimenti, RICHIEDE_BANCA, PERMESSI_BANCA } from '../_soldi/banca.js';
import { giorno } from '../_soldi/comuni.js';

const b64 = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
// il JWT dell'applicazione: vale un'ora (il massimo ammesso è un giorno)
export function jwt(k, adesso = Date.now()) {
  const iat = Math.floor(adesso / 1000), dati = `${b64({ typ: 'JWT', alg: 'RS256', kid: String(k.imp.applicazione || '').trim() })}.${b64({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 3600 })}`;
  return `${dati}.${createSign('RSA-SHA256').update(dati).sign(k.segreti.chiave_privata).toString('base64url')}`;
}
const stesso = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
const errore = (r, cosa) => new Error(`${cosa}: Enable Banking ha risposto ${r.stato}${r.json?.message ? ` (${String(r.json.message).slice(0, 200)})` : ''}`);
const GIORNO = 864e5;
const pagina = (titolo, testo) => ({ tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${titolo}</title>`
  + `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${titolo}</h1><p>${testo}</p><p><a href="/#/connettori/enable-banking">Torna a Kubo</a></p>` });

// un movimento della banca (ISO 20022) nel formato comune di banca.js; solo quelli contabilizzati
function movimento(t, conto) {
  if (t.status && t.status !== 'BOOK') return null;
  const imp = Number(t.transaction_amount?.amount); if (!Number.isFinite(imp)) return null;
  const entra = t.credit_debit_indicator === 'CRDT', rif = t.entry_reference || t.transaction_id
    || createHash('sha256').update(JSON.stringify([t.booking_date, t.transaction_amount, t.remittance_information, t.debtor, t.creditor])).digest('hex').slice(0, 24);
  return { id: `${conto.uid}:${rif}`, data: String(t.booking_date || t.value_date || t.transaction_date || '').slice(0, 10), importo: entra ? Math.abs(imp) : -Math.abs(imp),
    valuta: t.transaction_amount?.currency || 'EUR', descrizione: [].concat(t.remittance_information || []).join(' ').trim(),
    controparte: (entra ? t.debtor?.name : t.creditor?.name) || '', conto: conto.iban || conto.uid };
}

export default {
  id: 'enable-banking', nome: 'Enable Banking', versione: 1, icona: 'cassa', base: 'https://api.enablebanking.com',
  descrizione: 'I movimenti del conto in banca entrano in Kubo e si abbinano alle fatture da incassare e da pagare.',
  impostazioni: [
    { id: 'applicazione', nome: 'ID dell\'applicazione (Application ID)', schema: /^[\w-]{8,80}$/ },
    { id: 'chiave_privata', nome: 'Chiave privata dell\'applicazione (il file .pem)', segreto: true, schema: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { id: 'banca', nome: 'Nome della banca, come nell\'elenco di Enable Banking (es. Intesa Sanpaolo)' },
    { id: 'paese', nome: 'Paese della banca', predefinito: 'IT', schema: /^[A-Z]{2}$/ },
    { id: 'tipo', nome: 'Tipo di conto', tipo: 'scelta', opzioni: ['business', 'personal'], predefinito: 'business' },
  ],
  richiede: RICHIEDE_BANCA,
  permessi: PERMESSI_BANCA,
  prova: async k => { const r = await k.http.get(`${k.base}/application`, { bearer: jwt(k) }); return { ok: r.ok, messaggio: r.ok ? null : r.json?.message || `HTTP ${r.stato}` }; },
  azioni: {
    // senza «su»: solo il titolare
    banche: {
      nome: 'Banche disponibili', descrizione: 'Elenca le banche collegabili nel paese scelto',
      async esegui(_, k) {
        const r = await k.http.get(`${k.base}/aspsps?country=${encodeURIComponent(k.imp.paese || 'IT')}&service=AIS`, { bearer: jwt(k) });
        if (!r.ok) throw errore(r, 'Elenco delle banche');
        return { banche: (r.json?.aspsps || []).map(a => ({ nome: a.name, paese: a.country, bic: a.bic || null, tipi: a.psu_types || [], giorni: a.maximum_consent_validity ? Math.floor(a.maximum_consent_validity / 86400) : null })) };
      },
    },
    collega: {
      nome: 'Collega il conto', descrizione: 'Apre il consenso sul sito della banca',
      input: { indirizzo: { tipo: 'testo', nome: 'L\'indirizzo di Kubo nel browser (vuoto: l\'indirizzo pubblico della Libreria)', facoltativo: true } },
      async esegui({ indirizzo }, k) {
        const base = String(indirizzo || k.pubblico || '').replace(/\/+$/, '');   // vuoto: l'indirizzo pubblico di Kubo (k.pubblico)
        if (!/^https?:\/\/[^/\s]+$/.test(base)) throw new Error('Indirizzo di Kubo non valido');
        if (!k.imp.banca) throw new Error('Scegli prima la banca nelle impostazioni');
        // il consenso più lungo che la banca permette (maximum_consent_validity, in secondi), al massimo 180 giorni
        const el = await k.http.get(`${k.base}/aspsps?country=${encodeURIComponent(k.imp.paese || 'IT')}`, { bearer: jwt(k) });
        const max = Number((el.json?.aspsps || []).find(a => a.name === k.imp.banca)?.maximum_consent_validity) * 1000 || 90 * GIORNO;
        const state = randomBytes(24).toString('base64url'), ritorno = `${base}/api/connettori/enable-banking/pub/ritorno`;
        const r = await k.http.post(`${k.base}/auth`, { bearer: jwt(k), json: {
          access: { valid_until: new Date(Date.now() + Math.min(180 * GIORNO, max) - 6e4).toISOString() }, aspsp: { name: k.imp.banca, country: k.imp.paese || 'IT' },
          state, redirect_url: ritorno, psu_type: k.imp.tipo || 'business' } });
        if (!r.ok || !r.json?.url) throw errore(r, 'Consenso');
        k.stato.scrivi('attesa', { state, scade: Date.now() + 30 * 6e4 });   // il consenso va dato entro mezz'ora
        return { url: r.json.url };
      },
    },
    scollega: {
      nome: 'Scollega il conto', descrizione: 'Chiude la sessione con la banca',
      async esegui(_, k) {
        const s = k.stato.leggi('sessione');
        if (s?.id) await k.http.delete(`${k.base}/sessions/${encodeURIComponent(s.id)}`, { bearer: jwt(k) });
        k.stato.scrivi('sessione', null); return { ok: true };
      },
    },
  },
  // la banca rimanda qui la persona dopo il consenso: lo «state» deve essere quello dato da «collega», una volta sola
  pubbliche: {
    async ritorno({ q, k }) {
      const a = k.stato.leggi('attesa');
      if (!a || !stesso(q.get('state'), a.state) || a.scade < Date.now()) return pagina('Collegamento scaduto', 'Riprova da Kubo con «Collega il conto».');
      k.stato.scrivi('attesa', null);
      if (!q.get('code')) return pagina('Consenso non dato', `La banca dice: ${String(q.get('error_description') || q.get('error') || 'annullato').replace(/[<>&"]/g, '').slice(0, 200)}.`);
      const r = await k.http.post(`${k.base}/sessions`, { bearer: jwt(k), json: { code: q.get('code') } });
      if (!r.ok || !r.json?.session_id) { k.annota('entrata', 'errore', 'sessione', `HTTP ${r.stato}`); return pagina('Collegamento non riuscito', 'La banca non ha confermato il consenso. Riprova.'); }
      const conti = (r.json.accounts || []).map(c => ({ uid: c.uid, iban: c.account_id?.iban || null, nome: c.name || null })).filter(c => c.uid);
      k.stato.scrivi('sessione', { id: r.json.session_id, conti, scade: r.json.access?.valid_until || new Date(Date.now() + 90 * GIORNO).toISOString(), banca: r.json.aspsp?.name || k.imp.banca });
      k.annota('entrata', 'ok', 'collegato', `${conti.length} conti`);
      return pagina('Conto collegato', `${conti.length === 1 ? 'Un conto collegato' : `${conti.length} conti collegati`}: i movimenti arrivano in Kubo da soli.`);
    },
  },
  pianificati: {
    movimenti: {
      nome: 'Movimenti', ogni: '6h',
      async giro(k) {
        const s = k.stato.leggi('sessione'); if (!s?.id) return 'conto non collegato';
        const resta = Date.parse(s.scade) - Date.now();
        if (resta <= 0) { k.avvisa('il consenso della banca è scaduto: ricollega il conto'); return 'consenso scaduto'; }
        if (resta < 7 * GIORNO && k.stato.leggi('avvisato') !== giorno(k)) { k.stato.scrivi('avvisato', giorno(k)); k.avvisa(`il consenso della banca scade fra ${Math.ceil(resta / GIORNO)} giorni: ricollega il conto`); }
        const dal = k.stato.leggi('dal') || {}, lista = [];
        for (const c of s.conti || []) {
          let chiave = null, n = 0;
          const da = dal[c.uid] || giorno(k, Date.now() - 30 * GIORNO);
          do {
            const u = new URL(`${k.base}/accounts/${encodeURIComponent(c.uid)}/transactions`); u.searchParams.set('date_from', da); if (chiave) u.searchParams.set('continuation_key', chiave);
            const r = await k.http.get(u.href, { bearer: jwt(k) });
            if (!r.ok) throw errore(r, 'Movimenti');
            for (const t of r.json?.transactions || []) { const m = movimento(t, c); if (m) lista.push(m); }
            chiave = r.json?.continuation_key || null;
          } while (chiave && ++n < 100);
          dal[c.uid] = giorno(k, Date.now() - 5 * GIORNO);   // qualche giorno di sovrapposizione: i doppioni li toglie banca.js
        }
        const ris = registraMovimenti(k, lista); k.stato.scrivi('dal', dal);
        return ris;
      },
    },
  },
  catalogo: {
    categoria: 'banche',
    sito: 'https://enablebanking.com',
    costo: 'gratis',
    costoNota: 'La sandbox è gratuita. In produzione collegare i conti di cui sei titolare è gratuito (applicazione «ristretta», attivata collegando un tuo conto); per i conti di altri serve un contratto con Enable Banking.',
    serve: [{ cosa: 'L\'ID dell\'applicazione e la sua chiave privata (.pem), creata alla registrazione', dove: 'Control Panel › API applications › Register new application', link: 'https://enablebanking.com/cp/applications' }],
    passi: [
      'Crea un account su enablebanking.com e apri il Control Panel.',
      'Registra una nuova applicazione (ambiente Production) e scarica la chiave privata .pem.',
      'Fra gli indirizzi di ritorno (redirect URL) aggiungi quello che Kubo mostra: <indirizzo di Kubo>/api/connettori/enable-banking/pub/ritorno.',
      'Attiva l\'applicazione collegando un tuo conto, come chiede Enable Banking.',
      'In Kubo incolla l\'ID dell\'applicazione e la chiave privata, scrivi il nome della banca e accendi il connettore.',
      'Premi «Collega il conto» e dai il consenso sul sito della banca: dura fino a 180 giorni, poi Kubo ti avvisa di rinnovarlo.',
      'Prima di accendere, in Tesoreria premi «Prepara»: i movimenti entrano in «Movimenti di banca» e si abbinano alle fatture in Tesoreria › Banca (anche da Lumi).',
    ],
    difficolta: 'media',
    zone: ['IT', 'UE'],
    fonti: ['https://enablebanking.com/docs/api/reference/'],
    prova: 'finto',
    parole: ['banca', 'conto corrente', 'movimenti', 'estratto conto', 'riconciliazione', 'open banking', 'psd2', 'bonifici', 'bank', 'bank account', 'transactions', 'reconciliation'],
  },
  testi: {
    en: { descrizione: 'Your bank account transactions flow into Kubo and get matched to invoices to collect and to pay.',
      'imp.applicazione': 'Application ID', 'imp.chiave_privata': 'Application private key (the .pem file)', 'imp.banca': 'Bank name, as in the Enable Banking list (e.g. Intesa Sanpaolo)', 'imp.paese': 'Bank country', 'imp.tipo': 'Account type',
      'az.banche': 'Available banks', 'az.collega': 'Connect the account', 'az.scollega': 'Disconnect the account', 'giro.movimenti': 'Transactions',
      'cat.costoNota': 'The sandbox is free. In production, linking accounts you own is free (a «restricted» application, activated by linking one of your accounts); other people\'s accounts need a contract with Enable Banking.',
      'cat.serve': [{ cosa: 'The application ID and its private key (.pem), created at registration', dove: 'Control Panel › API applications › Register new application' }],
      'cat.passi': [
        'Create an account on enablebanking.com and open the Control Panel.',
        'Register a new application (Production environment) and download the .pem private key.',
        'Among the redirect URLs add the one Kubo shows: <Kubo address>/api/connettori/enable-banking/pub/ritorno.',
        'Activate the application by linking one of your accounts, as Enable Banking asks.',
        'In Kubo paste the application ID and the private key, type the bank name and switch the connector on.',
        'Press «Connect the account» and give consent on the bank website: it lasts up to 180 days, then Kubo reminds you to renew it.',
        'Before switching it on, press «Prepare» in Treasury: transactions land in «Bank transactions» and are matched to invoices in Treasury › Bank (Lumi can do it too).',
      ] },
    es: { descrizione: 'Los movimientos de tu cuenta bancaria entran en Kubo y se concilian con las facturas por cobrar y por pagar.',
      'imp.applicazione': 'ID de la aplicación', 'imp.chiave_privata': 'Clave privada de la aplicación (el archivo .pem)', 'imp.banca': 'Nombre del banco, como en la lista de Enable Banking', 'imp.paese': 'País del banco', 'imp.tipo': 'Tipo de cuenta',
      'az.banche': 'Bancos disponibles', 'az.collega': 'Conectar la cuenta', 'az.scollega': 'Desconectar la cuenta', 'giro.movimenti': 'Movimientos' },
    fr: { descrizione: 'Les opérations de ton compte bancaire arrivent dans Kubo et sont rapprochées des factures à encaisser et à payer.',
      'imp.applicazione': 'ID de l\'application', 'imp.chiave_privata': 'Clé privée de l\'application (le fichier .pem)', 'imp.banca': 'Nom de la banque, comme dans la liste Enable Banking', 'imp.paese': 'Pays de la banque', 'imp.tipo': 'Type de compte',
      'az.banche': 'Banques disponibles', 'az.collega': 'Connecter le compte', 'az.scollega': 'Déconnecter le compte', 'giro.movimenti': 'Opérations' },
    de: { descrizione: 'Die Umsätze deines Bankkontos kommen in Kubo an und werden offenen Ein- und Ausgangsrechnungen zugeordnet.',
      'imp.applicazione': 'Anwendungs-ID', 'imp.chiave_privata': 'Privater Schlüssel der Anwendung (die .pem-Datei)', 'imp.banca': 'Name der Bank, wie in der Enable-Banking-Liste', 'imp.paese': 'Land der Bank', 'imp.tipo': 'Kontoart',
      'az.banche': 'Verfügbare Banken', 'az.collega': 'Konto verbinden', 'az.scollega': 'Konto trennen', 'giro.movimenti': 'Umsätze' },
    pt: { descrizione: 'Os movimentos da sua conta bancária entram no Kubo e são conciliados com as faturas a receber e a pagar.',
      'imp.applicazione': 'ID da aplicação', 'imp.chiave_privata': 'Chave privada da aplicação (o arquivo .pem)', 'imp.banca': 'Nome do banco, como na lista do Enable Banking', 'imp.paese': 'País do banco', 'imp.tipo': 'Tipo de conta',
      'az.banche': 'Bancos disponíveis', 'az.collega': 'Conectar a conta', 'az.scollega': 'Desconectar a conta', 'giro.movimenti': 'Movimentos' },
  },
};
