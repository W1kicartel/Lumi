// Wise Business: gli estratti dei saldi in euro entrano in Kubo come movimenti e si abbinano alle fatture (banca.js).
// Accesso con il token API personale (Bearer). Gli estratti conto sono protetti dalla SCA: la prima risposta è 403 con
// «x-2fa-approval: <one-time token>»; si firma il token con la chiave privata (RSA-SHA256, base64) e si ripete la
// richiesta con «x-2fa-approval» e «X-Signature». La chiave pubblica si carica una volta su Wise (Kubo la crea).
// https://docs.wise.com/api-docs/features/strong-customer-authentication-2fa/personal-token-sca
// https://docs.wise.com/api-docs/api-reference/balance-statement
import { createSign, generateKeyPairSync } from 'node:crypto';
import { registraMovimenti, RICHIEDE_BANCA, PERMESSI_BANCA } from '../_soldi/banca.js';
import { giorno } from '../_soldi/comuni.js';

const base = k => k.base || (k.imp.ambiente === 'prova' ? 'https://api.wise-sandbox.com' : 'https://api.wise.com');
// una GET con la SCA: se Wise chiede l'approvazione, si firma il token e si ripete una volta
export async function leggi(k, percorso) {
  const url = base(k) + percorso, h = { bearer: k.segreti.token };
  let r = await k.http.get(url, h);
  const ott = r.intestazioni?.['x-2fa-approval'];
  if (r.stato === 403 && ott) {
    if (!k.segreti.chiave_privata) throw new Error('Wise chiede la firma SCA: crea le chiavi con «Chiavi per la SCA» e carica la pubblica su Wise');
    const firma = createSign('RSA-SHA256').update(ott).sign(k.segreti.chiave_privata, 'base64');
    r = await k.http.get(url, { ...h, intestazioni: { 'x-2fa-approval': ott, 'X-Signature': firma } });
  }
  if (!r.ok) throw new Error(`Wise ha risposto ${r.stato}${r.stato === 403 ? ': la chiave pubblica caricata su Wise non corrisponde' : ''}`);
  return r.json;
}
async function profilo(k) {
  if (k.imp.profilo) return k.imp.profilo;
  const l = await leggi(k, '/v2/profiles'), p = l.find(x => /business/i.test(x.type)) || l[0];
  if (!p) throw new Error('Nessun profilo Wise per questo token'); return String(p.id);
}
// una riga dell'estratto nel formato di banca.js
const movimento = (k, t, saldo) => ({
  id: String(t.referenceNumber || `${saldo}:${t.date}:${t.amount?.value}`), data: giorno(k, Date.parse(t.date) || Date.now()),
  importo: (t.type === 'DEBIT' ? -1 : 1) * Math.abs(Number(t.amount?.value || 0)), valuta: t.amount?.currency || 'EUR',
  descrizione: [t.details?.paymentReference, t.details?.description].filter(Boolean).join(' · '),
  controparte: t.details?.senderName || t.details?.recipient?.name || t.details?.merchant?.name || '', conto: `Wise ${saldo}`,
});

export default {
  id: 'wise', nome: 'Wise Business', versione: 1, icona: 'cassa',
  descrizione: 'I movimenti dei saldi in euro di Wise entrano in Kubo e si abbinano alle fatture da incassare e da pagare.',
  impostazioni: [
    { id: 'token', nome: 'Token API personale (sola lettura)', segreto: true },
    { id: 'chiave_privata', nome: 'Chiave privata per la SCA (la crea Kubo)', segreto: true, obbligatorio: false },
    { id: 'profilo', nome: 'ID del profilo (vuoto: quello business)', schema: /^\d{1,15}$/, obbligatorio: false },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['produzione', 'prova'], predefinito: 'produzione' },
  ],
  richiede: RICHIEDE_BANCA,
  permessi: PERMESSI_BANCA,
  prova: async k => { try { await profilo(k); return { ok: true }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    chiavi: {
      nome: 'Chiavi per la SCA', descrizione: 'Crea la coppia di chiavi RSA e mostra la pubblica da caricare su Wise',
      async esegui(_, k) {
        const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
        k.salvaSegreto('chiave_privata', privateKey);
        return { chiave_pubblica: publicKey, dove: 'Wise › Impostazioni › Integrazioni e strumenti › Token API › Gestisci le chiavi pubbliche › Aggiungi' };
      },
    },
  },
  pianificati: {
    // dal giorno dopo l'ultimo giro (con due giorni di margine); la prima volta gli ultimi 30 giorni. Solo i saldi in euro
    movimenti: { ogni: '6h', async giro(k) {
      const p = await profilo(k), fine = new Date(), lista = [];
      const saldi = (await leggi(k, `/v4/profiles/${p}/balances?types=STANDARD`)).filter(s => (s.currency || s.amount?.currency) === 'EUR');
      const fino = Date.parse(k.stato.leggi('fino') || ''), trenta = Date.now() - 30 * 864e5;
      const inizio = new Date(Number.isFinite(fino) ? Math.max(fino - 2 * 864e5, trenta) : trenta);
      for (const s of saldi) {
        const q = new URLSearchParams({ currency: 'EUR', intervalStart: inizio.toISOString(), intervalEnd: fine.toISOString(), type: 'COMPACT' });
        const e = await leggi(k, `/v1/profiles/${p}/balance-statements/${s.id}/statement.json?${q}`);
        for (const t of e.transactions || []) lista.push(movimento(k, t, s.id));
      }
      const r = registraMovimenti(k, lista); k.stato.scrivi('fino', fine.toISOString());
      return { saldi: saldi.length, ...r };
    } },
  },
  catalogo: {
    categoria: 'banche', sito: 'https://wise.com/it/business/',
    costo: 'a-consumo', costoNota: 'Apertura del conto Business una tantum (circa 50 € in Italia), nessun canone mensile; ricevere euro con le coordinate locali è gratis, i cambi e i bonifici in uscita hanno la commissione mostrata da Wise. L\'API è gratuita.',
    serve: [
      { cosa: 'Token API personale in sola lettura', dove: 'Wise › Impostazioni › Integrazioni e strumenti › Token API › Aggiungi token (permessi: sola lettura)', link: 'https://wise.com/settings/api-tokens' },
      { cosa: 'La chiave pubblica per la SCA, creata da Kubo', dove: 'Wise › Impostazioni › Integrazioni e strumenti › Token API › Gestisci le chiavi pubbliche › Aggiungi', link: 'https://wise.com/settings/public-keys' },
    ],
    passi: ['Nel conto Wise Business crea un token API in sola lettura.', 'Incollalo in Kubo e premi «Prova la connessione».', 'Premi «Chiavi per la SCA»: Kubo crea le chiavi e mostra la pubblica.', 'Carica la chiave pubblica su Wise (Gestisci le chiavi pubbliche): serve per leggere gli estratti.', 'In Tesoreria premi «Prepara», poi accendi: ogni 6 ore i movimenti in euro entrano in «Movimenti di banca» e si abbinano alle fatture in Tesoreria › Banca.', 'Se vuoi tenere tutti i movimenti, crea una sezione «Movimenti» (data, importo, descrizione, controparte, conto, fattura).'],
    difficolta: 'media', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://docs.wise.com/api-docs/features/strong-customer-authentication-2fa/personal-token-sca', 'https://docs.wise.com/api-docs/api-reference/balance-statement', 'https://docs.wise.com/api-docs/api-reference/balance', 'https://docs.wise.com/api-docs/api-reference/profile'],
    prova: 'finto', parole: ['wise', 'transferwise', 'conto', 'banca', 'movimenti', 'estratto conto', 'riconciliazione', 'bank statement', 'reconciliation', 'multi-currency'],
  },
  testi: {
    en: { descrizione: 'Transactions of the Wise euro balances enter Kubo and are matched with invoices to collect and to pay.', 'imp.token': 'Personal API token (read only)', 'imp.chiave_privata': 'Private key for SCA (Kubo creates it)', 'imp.profilo': 'Profile ID (empty: the business one)', 'imp.ambiente': 'Environment', 'az.chiavi': 'Keys for SCA', 'giro.movimenti': 'Transactions',
      'cat.costoNota': 'One-off fee to open the Business account (about €50 in Italy), no monthly fee; receiving euros with local details is free, conversions and outgoing transfers carry the fee Wise shows. The API is free.',
      'cat.serve': [{ cosa: 'Read-only personal API token', dove: 'Wise › Settings › Integrations and tools › API tokens › Add token (read only)' }, { cosa: 'The public key for SCA, created by Kubo', dove: 'Wise › Settings › Integrations and tools › API tokens › Manage public keys › Add' }],
      'cat.passi': ['Create a read-only API token in the Wise Business account.', 'Paste it into Kubo and press «Test connection».', 'Press «Keys for SCA»: Kubo creates the keys and shows the public one.', 'Upload the public key to Wise (Manage public keys): it is needed to read statements.', 'Press «Prepare» in Treasury, then switch on: every 6 hours the euro transactions land in «Bank transactions» and are matched to invoices in Treasury › Bank.', 'To keep every transaction, create a «Movimenti» section (date, amount, description, counterparty, account, invoice).'] },
    es: { descrizione: 'Los movimientos de los saldos en euros de Wise entran en Kubo y se concilian con las facturas por cobrar y por pagar.', 'imp.token': 'Token API personal (solo lectura)', 'imp.chiave_privata': 'Clave privada para la SCA (la crea Kubo)', 'imp.profilo': 'ID del perfil (vacío: el de empresa)', 'imp.ambiente': 'Entorno', 'az.chiavi': 'Claves para la SCA', 'giro.movimenti': 'Movimientos' },
    fr: { descrizione: 'Les opérations des soldes en euros de Wise entrent dans Kubo et sont rapprochées des factures à encaisser et à payer.', 'imp.token': 'Jeton API personnel (lecture seule)', 'imp.chiave_privata': 'Clé privée pour la SCA (créée par Kubo)', 'imp.profilo': 'ID du profil (vide : le profil entreprise)', 'imp.ambiente': 'Environnement', 'az.chiavi': 'Clés pour la SCA', 'giro.movimenti': 'Opérations' },
    de: { descrizione: 'Die Umsätze der Wise-Euro-Guthaben kommen in Kubo und werden mit offenen Ausgangs- und Eingangsrechnungen abgeglichen.', 'imp.token': 'Persönliches API-Token (nur lesen)', 'imp.chiave_privata': 'Privater Schlüssel für die SCA (erstellt Kubo)', 'imp.profilo': 'Profil-ID (leer: das Geschäftsprofil)', 'imp.ambiente': 'Umgebung', 'az.chiavi': 'Schlüssel für die SCA', 'giro.movimenti': 'Umsätze' },
    pt: { descrizione: 'Os movimentos dos saldos em euros da Wise entram no Kubo e são conciliados com as faturas a receber e a pagar.', 'imp.token': 'Token de API pessoal (só leitura)', 'imp.chiave_privata': 'Chave privada para a SCA (o Kubo cria)', 'imp.profilo': 'ID do perfil (vazio: o empresarial)', 'imp.ambiente': 'Ambiente', 'az.chiavi': 'Chaves para a SCA', 'giro.movimenti': 'Movimentos' },
  },
};
