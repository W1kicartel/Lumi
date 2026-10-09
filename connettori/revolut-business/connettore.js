// Revolut Business: i movimenti dei conti Revolut Business entrano in Lumi e si abbinano alle fatture (Business API,
// https://developer.revolut.com/docs/business/business-api; specifica: github.com/revolut-engineering/revolut-openapi).
// Accesso: un certificato caricato in Revolut (Impostazioni › API › Business API) dà il client_id; Lumi firma con la chiave
// privata un JWT RS256 { iss: dominio dell'indirizzo di ritorno, sub: client_id, aud: 'https://revolut.com' } e lo usa come
// client_assertion su POST /auth/token (grant_type authorization_code, poi refresh_token). Il token d'accesso dura 40 minuti
// e resta in memoria; il codice di rinnovo è un segreto cifrato. GET /transactions dà al massimo 1000 movimenti per volta,
// dal più recente: la pagina dopo si chiede con «to» = created_at dell'ultimo.
import { createSign, randomBytes, timingSafeEqual } from 'node:crypto';
import { registraMovimenti, RICHIEDE_BANCA, PERMESSI_BANCA } from '../_soldi/banca.js';
import { giorno } from '../_soldi/comuni.js';

const PROD = 'https://b2b.revolut.com/api/1.0', SANDBOX = 'https://sandbox-b2b.revolut.com/api/1.0', PAGINA = 1000;
const base = k => k.base || (k.imp.ambiente === 'sandbox' ? SANDBOX : PROD);
const consenso = k => (k.imp.ambiente === 'sandbox' ? 'https://sandbox-business.revolut.com/app-confirm' : 'https://business.revolut.com/app-confirm');
const b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
export function jwt(k, dominio, adesso = Date.now()) {
  const iat = Math.floor(adesso / 1000), dati = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: dominio, sub: String(k.imp.client_id || '').trim(), aud: 'https://revolut.com', iat, exp: iat + 3600 })}`;
  return `${dati}.${createSign('RSA-SHA256').update(dati).sign(k.segreti.chiave_privata).toString('base64url')}`;
}
const stesso = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
const errore = (r, cosa) => new Error(`${cosa}: Revolut ha risposto ${r.stato}${r.json?.message || r.json?.error_description ? ` (${String(r.json.message || r.json.error_description).slice(0, 200)})` : ''}`);
const pagina = (titolo, testo) => ({ tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${titolo}</title>`
  + `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${titolo}</h1><p>${testo}</p><p><a href="/#/connettori/revolut-business">Torna a Lumi</a></p>` });

// il codice d'accesso, in memoria finché vale (meno un minuto); con il codice di rinnovo se è scaduto
const accessi = new Map();
async function chiediToken(k, form) {
  const r = await k.http.post(`${base(k)}/auth/token`, { form: { ...form, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: jwt(k, k.stato.leggi('dominio') || 'localhost') } });
  if (!r.ok || !r.json?.access_token) throw errore(r, 'Accesso');
  if (r.json.refresh_token) k.salvaSegreto('rinnovo', r.json.refresh_token);
  const rinnovo = r.json.refresh_token || k.segreti.rinnovo;
  accessi.set(rinnovo, { token: r.json.access_token, scade: Date.now() + Number(r.json.expires_in || 2400) * 1000 });
  return r.json.access_token;
}
async function token(k) {
  const rinnovo = k.segreti.rinnovo; if (!rinnovo) throw new Error('Conto non collegato: premi «Collega il conto»');
  const t = accessi.get(rinnovo); if (t && t.scade - Date.now() > 60000) return t.token;
  try { return await chiediToken(k, { grant_type: 'refresh_token', refresh_token: rinnovo }); }
  catch (e) { if (/ 40[01]/.test(e.message)) k.avvisa('Revolut non accetta più il codice di rinnovo: ricollega il conto'); throw e; }
}
// i movimenti completati, una riga per «gamba» (un cambio valuta o un giroconto ne ha due); l'importo ha già il segno
const movimenti = (k, t) => (t.state !== 'completed' ? [] : (t.legs || []).map((g, i) => ({
  id: `${t.id}:${g.leg_id || i}`, data: giorno(k, Date.parse(t.completed_at || t.created_at) || Date.now()), importo: Number(g.amount), valuta: g.currency || 'EUR',
  descrizione: [t.reference, g.description].filter(Boolean).join(' · '), controparte: t.merchant?.name || '', conto: g.account_id || '',
})).filter(m => Number.isFinite(m.importo) && m.importo !== 0));

export default {
  id: 'revolut-business', nome: 'Revolut Business', versione: 1, icona: 'cassa',
  descrizione: 'I movimenti dei conti Revolut Business entrano in Lumi e si abbinano alle fatture da incassare e da pagare.',
  impostazioni: [
    { id: 'client_id', nome: 'Client ID del certificato API' },
    { id: 'chiave_privata', nome: 'Chiave privata del certificato (privatecert.pem)', segreto: true, schema: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['produzione', 'sandbox'], predefinito: 'produzione' },
    { id: 'rinnovo', nome: 'Codice di rinnovo (si compila da solo con «Collega il conto»)', segreto: true, obbligatorio: false },
  ],
  richiede: RICHIEDE_BANCA,
  permessi: PERMESSI_BANCA,
  prova: async k => { const r = await k.http.get(`${base(k)}/accounts`, { bearer: await token(k) }); return { ok: r.ok, messaggio: r.ok ? null : `HTTP ${r.stato}` }; },
  azioni: {
    // senza «su»: solo il titolare
    collega: {
      nome: 'Collega il conto', descrizione: 'Apre il consenso su Revolut Business',
      input: { indirizzo: { tipo: 'testo', nome: 'L\'indirizzo di Lumi nel browser (vuoto: l\'indirizzo pubblico della Libreria)', facoltativo: true } },
      async esegui({ indirizzo }, k) {
        const b = String(indirizzo || k.pubblico || '').replace(/\/+$/, '');   // vuoto: l'indirizzo pubblico di Lumi (k.pubblico)
        if (!/^https?:\/\/[^/\s]+$/.test(b)) throw new Error('Indirizzo di Lumi non valido');
        if (!k.imp.client_id) throw new Error('Manca il Client ID');
        const state = randomBytes(24).toString('base64url'), ritorno = `${b}/api/connettori/revolut-business/pub/ritorno`, u = new URL(consenso(k));
        for (const [a, v] of Object.entries({ client_id: k.imp.client_id, redirect_uri: ritorno, response_type: 'code', scope: 'READ', state })) u.searchParams.set(a, v);
        k.stato.scrivi('attesa', { state, scade: Date.now() + 30 * 6e4 }); k.stato.scrivi('dominio', new URL(b).hostname);
        return { url: u.href, ritorno };
      },
    },
    conti: {
      nome: 'Conti Revolut', descrizione: 'Elenca i conti Revolut Business',
      async esegui(_, k) {
        const r = await k.http.get(`${base(k)}/accounts`, { bearer: await token(k) }); if (!r.ok) throw errore(r, 'Conti');
        return { conti: [].concat(r.json || []).filter(c => c.state !== 'inactive').map(c => ({ id: c.id, nome: c.name, saldo: c.balance, valuta: c.currency })) };
      },
    },
  },
  // Revolut rimanda qui dopo il consenso con ?code: si scambia subito (il codice dura pochi minuti)
  pubbliche: {
    async ritorno({ q, k }) {
      const a = k.stato.leggi('attesa'), st = q.get('state');
      if (!a || a.scade < Date.now() || (st != null && !stesso(st, a.state))) return pagina('Collegamento scaduto', 'Riprova da Lumi con «Collega il conto».');
      k.stato.scrivi('attesa', null);
      if (!q.get('code')) return pagina('Consenso non dato', 'Revolut non ha autorizzato Lumi. Riprova.');
      try { await chiediToken(k, { grant_type: 'authorization_code', code: q.get('code') }); }
      catch (e) { k.annota('entrata', 'errore', 'collegamento', String(e.message).slice(0, 300)); return pagina('Collegamento non riuscito', 'Revolut non ha confermato. Controlla Client ID e chiave privata, poi riprova.'); }
      k.annota('entrata', 'ok', 'collegato', null);
      return pagina('Conto collegato', 'I movimenti di Revolut Business arrivano in Lumi da soli.');
    },
  },
  pianificati: {
    movimenti: {
      nome: 'Movimenti', ogni: '2h',
      async giro(k) {
        if (!k.segreti.rinnovo) return 'conto non collegato';
        const tk = await token(k), dal = k.stato.leggi('dal') || new Date(Date.now() - 30 * 864e5).toISOString(), lista = [];
        let a = null;
        for (let n = 0; n < 50; n++) {
          const u = new URL(`${base(k)}/transactions`); u.searchParams.set('from', dal); u.searchParams.set('count', String(PAGINA)); if (a) u.searchParams.set('to', a);
          const r = await k.http.get(u.href, { bearer: tk });
          if (!r.ok) throw errore(r, 'Movimenti');
          const pag = [].concat(r.json || []);
          for (const t of pag) lista.push(...movimenti(k, t));
          if (pag.length < PAGINA || !pag.at(-1)?.created_at || pag.at(-1).created_at === a) break;
          a = pag.at(-1).created_at;
        }
        const ris = registraMovimenti(k, lista); k.stato.scrivi('dal', new Date(Date.now() - 3 * 864e5).toISOString());   // sovrapposizione: i doppioni li toglie banca.js
        return ris;
      },
    },
  },
  catalogo: {
    categoria: 'banche',
    sito: 'https://www.revolut.com/it-IT/business/',
    costo: 'abbonamento',
    costoNota: 'L\'API Business non costa niente in più: è compresa nei piani Revolut Business, che hanno un canone mensile secondo il piano (c\'è anche un piano base senza canone). Prezzi aggiornati su revolut.com/it-IT/business/business-account-plans.',
    serve: [{ cosa: 'Il Client ID del certificato API e la sua chiave privata (privatecert.pem)', dove: 'Revolut Business web › Impostazioni › API › Business API › Aggiungi certificato', link: 'https://business.revolut.com/settings/api' }],
    passi: [
      'Sul computer crea la chiave e il certificato: openssl genrsa -out privatecert.pem 2048 e poi openssl req -new -x509 -key privatecert.pem -out publiccert.cer -days 1825.',
      'In Revolut Business (dal web) apri Impostazioni › API › Business API e aggiungi un certificato: incolla publiccert.cer.',
      'Come «OAuth redirect URI» scrivi quello che Lumi mostra: <indirizzo di Lumi>/api/connettori/revolut-business/pub/ritorno.',
      'Copia il Client ID che Revolut ti dà.',
      'In Lumi incolla Client ID e chiave privata (privatecert.pem) e accendi il connettore.',
      'Premi «Collega il conto» e autorizza Lumi su Revolut: da lì Lumi rinnova l\'accesso da solo.',
      'Prima di accendere, in Tesoreria premi «Prepara»: i movimenti entrano in «Movimenti di banca» e si abbinano alle fatture in Tesoreria › Banca (anche da Lumi).',
    ],
    difficolta: 'difficile',
    zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://developer.revolut.com/docs/business/business-api', 'https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request', 'https://github.com/revolut-engineering/revolut-openapi/blob/master/yaml/business.yaml'],
    prova: 'finto',
    parole: ['revolut', 'revolut business', 'banca', 'conto aziendale', 'movimenti', 'riconciliazione', 'bonifici', 'bank', 'business account', 'transactions', 'reconciliation'],
  },
  testi: {
    en: { descrizione: 'Your Revolut Business transactions flow into Lumi and get matched to invoices to collect and to pay.',
      'imp.client_id': 'API certificate Client ID', 'imp.chiave_privata': 'Certificate private key (privatecert.pem)', 'imp.ambiente': 'Environment', 'imp.rinnovo': 'Refresh token (filled in by «Connect the account»)',
      'az.collega': 'Connect the account', 'az.conti': 'Revolut accounts', 'giro.movimenti': 'Transactions',
      'cat.costoNota': 'The Business API costs nothing extra: it comes with the Revolut Business plans, which have a monthly fee depending on the plan (there is also a basic plan with no fee). Current prices at revolut.com/it-IT/business/business-account-plans.',
      'cat.serve': [{ cosa: 'The API certificate Client ID and its private key (privatecert.pem)', dove: 'Revolut Business web › Settings › APIs › Business API › Add certificate' }],
      'cat.passi': [
        'On your computer create the key and the certificate: openssl genrsa -out privatecert.pem 2048, then openssl req -new -x509 -key privatecert.pem -out publiccert.cer -days 1825.',
        'In Revolut Business (on the web) open Settings › APIs › Business API and add a certificate: paste publiccert.cer.',
        'As «OAuth redirect URI» type the one Lumi shows: <Lumi address>/api/connettori/revolut-business/pub/ritorno.',
        'Copy the Client ID Revolut gives you.',
        'In Lumi paste the Client ID and the private key (privatecert.pem) and switch the connector on.',
        'Press «Connect the account» and authorise Lumi on Revolut: from then on Lumi renews access by itself.',
        'Before switching it on, press «Prepare» in Treasury: transactions land in «Bank transactions» and are matched to invoices in Treasury › Bank (Lumi can do it too).',
      ] },
    es: { descrizione: 'Los movimientos de Revolut Business entran en Lumi y se concilian con las facturas por cobrar y por pagar.',
      'imp.client_id': 'Client ID del certificado API', 'imp.chiave_privata': 'Clave privada del certificado (privatecert.pem)', 'imp.ambiente': 'Entorno', 'imp.rinnovo': 'Token de renovación (se rellena con «Conectar la cuenta»)',
      'az.collega': 'Conectar la cuenta', 'az.conti': 'Cuentas Revolut', 'giro.movimenti': 'Movimientos' },
    fr: { descrizione: 'Les opérations Revolut Business arrivent dans Lumi et sont rapprochées des factures à encaisser et à payer.',
      'imp.client_id': 'Client ID du certificat API', 'imp.chiave_privata': 'Clé privée du certificat (privatecert.pem)', 'imp.ambiente': 'Environnement', 'imp.rinnovo': 'Jeton de renouvellement (rempli par «Connecter le compte»)',
      'az.collega': 'Connecter le compte', 'az.conti': 'Comptes Revolut', 'giro.movimenti': 'Opérations' },
    de: { descrizione: 'Die Umsätze von Revolut Business kommen in Lumi an und werden offenen Ein- und Ausgangsrechnungen zugeordnet.',
      'imp.client_id': 'Client-ID des API-Zertifikats', 'imp.chiave_privata': 'Privater Schlüssel des Zertifikats (privatecert.pem)', 'imp.ambiente': 'Umgebung', 'imp.rinnovo': 'Refresh-Token (wird mit «Konto verbinden» ausgefüllt)',
      'az.collega': 'Konto verbinden', 'az.conti': 'Revolut-Konten', 'giro.movimenti': 'Umsätze' },
    pt: { descrizione: 'Os movimentos do Revolut Business entram no Lumi e são conciliados com as faturas a receber e a pagar.',
      'imp.client_id': 'Client ID do certificado da API', 'imp.chiave_privata': 'Chave privada do certificado (privatecert.pem)', 'imp.ambiente': 'Ambiente', 'imp.rinnovo': 'Token de renovação (preenchido por «Conectar a conta»)',
      'az.collega': 'Conectar a conta', 'az.conti': 'Contas Revolut', 'giro.movimenti': 'Movimentos' },
  },
};
