// Satispay Business: link di pagamento per vendite e fatture, incasso segnato quando il pagamento è ACCEPTED.
// Ogni richiesta è firmata in RSA (HTTP Signature): Digest «SHA-256=<base64>», Date, e
// «Authorization: Signature keyId="…", algorithm="rsa-sha256", headers="(request-target) host date digest", signature="…"».
// Il KeyId si ottiene una volta: Kubo genera la coppia di chiavi e manda la pubblica con il codice di attivazione del
// pannello (POST /g_business/v1/authentication_keys). La chiave privata resta cifrata in Kubo.
// Il callback di Satispay è una GET su callback_url ({uuid} = id del pagamento) e non è firmato: si rilegge il pagamento
// dall'API e si crede solo a quello. Senza un indirizzo pubblico (app sul PC) basta il giro «controlla» ogni 10 minuti.
import { createHash, createSign, generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { azioniLink, testiLink, incassa, RICHIEDE_INCASSI, PERMESSI_INCASSI } from '../_soldi/comuni.js';
import { stessoSegreto } from '../../server/moduli/connettori-rete.js';

const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://authservices.satispay.com' : 'https://staging.authservices.satispay.com');
const ID = /^[\w-]{6,80}$/;

// la richiesta firmata. → la risposta di k.http
export async function firmata(k, metodo, percorso, json) {
  const s = k.segreti; if (!s.key_id || !s.chiave_privata) throw new Error('Satispay non è attivato: usa «Attiva con il codice»');
  const u = new URL(base(k) + percorso), corpo = json === undefined ? '' : JSON.stringify(json);
  const data = new Date().toUTCString().replace('GMT', '+0000'), digest = 'SHA-256=' + createHash('sha256').update(corpo).digest('base64');
  const firmare = `(request-target): ${metodo.toLowerCase()} ${u.pathname}${u.search}\nhost: ${u.host}\ndate: ${data}\ndigest: ${digest}`;
  const firma = createSign('RSA-SHA256').update(firmare).sign(s.chiave_privata, 'base64');
  return k.http.richiesta(metodo, u.href, { testo: corpo || undefined, intestazioni: { Host: u.host, Date: data, Digest: digest, ...(corpo ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Signature keyId="${s.key_id}", algorithm="rsa-sha256", headers="(request-target) host date digest", signature="${firma}"` } });
}
const errore = r => new Error(`Satispay ha risposto ${r.stato}: ${String(r.json?.message || r.testo || '').slice(0, 200)}`);

// un pagamento letto dall'API: ACCEPTED → incasso; finale → non si controlla più
async function controlla(k, id) {
  const r = await firmata(k, 'GET', `/g_business/v1/payments/${encodeURIComponent(id)}`); if (!r.ok) throw errore(r);
  const p = r.json, aperti = (k.stato.leggi('aperti') || []).filter(x => x.id !== id || p.status === 'PENDING');
  k.stato.scrivi('aperti', aperti);
  if (p.status !== 'ACCEPTED' || p.type === 'REFUND_TO_BUSINESS') return `ignorato: ${p.status}`;
  return incassa(k, p.external_code || p.metadata?.kubo, { importo: Number(p.amount_unit) / 100, valuta: p.currency, quando: Date.parse(p.insert_date) || Date.now(), metodo: 'carta' });
}

export default {
  id: 'satispay', nome: 'Satispay', versione: 1, icona: 'cassa',
  descrizione: 'Link di pagamento Satispay per vendite e fatture: quando il cliente paga, Kubo le segna pagate.',
  impostazioni: [
    { id: 'codice', nome: 'Codice di attivazione (dal pannello Satispay Business)', segreto: true, obbligatorio: false },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (per il callback, facoltativo)', schema: /^https:\/\/[^\s]+$/, obbligatorio: false },
    { id: 'ritorno', nome: 'Pagina dopo il pagamento (es. il tuo sito)', schema: /^https:\/\/[^\s]+$/, obbligatorio: false },
    { id: 'key_id', nome: 'KeyId (lo scrive Kubo all\'attivazione)', segreto: true, obbligatorio: false },
    { id: 'chiave_privata', nome: 'Chiave privata RSA (la crea Kubo all\'attivazione)', segreto: true, obbligatorio: false },
    { id: 'callback', nome: 'Codice segreto del callback', segreto: true, generato: true },
  ],
  richiede: RICHIEDE_INCASSI,
  permessi: PERMESSI_INCASSI,
  prova: async k => { const r = await firmata(k, 'GET', '/g_business/v1/payments?limit=1'); return { ok: r.ok, messaggio: r.ok ? null : `HTTP ${r.stato}` }; },
  azioni: {
    attiva: {
      nome: 'Attiva con il codice', descrizione: 'Crea le chiavi RSA e ottiene il KeyId da Satispay con il codice di attivazione',
      proponi: async (_, k) => ({ titolo: 'Attiva Satispay', righe: [['Ambiente', k.imp.ambiente]], avvisi: k.segreti.codice ? [] : ['Prima incolla il codice di attivazione'] }),
      async esegui(_, k) {
        const codice = k.segreti.codice; if (!codice) throw new Error('Manca il codice di attivazione');
        const { publicKey, privateKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 4096, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
        const r = await k.http.post(`${base(k)}/g_business/v1/authentication_keys`, { json: { public_key: publicKey, token: codice } });
        if (!r.ok || !r.json?.key_id) throw new Error(`Satispay non ha accettato il codice (${r.stato}): i codici valgono una volta e scadono`);
        k.salvaSegreto('chiave_privata', privateKey); k.salvaSegreto('key_id', r.json.key_id); k.salvaSegreto('codice', null);
        return { ok: true, key_id: r.json.key_id };
      },
    },
    ...azioniLink('Satispay', async (k, { importo, cent, rif, descrizione }) => {
      const cb = k.imp.indirizzo ? `${k.imp.indirizzo.replace(/\/$/, '')}/api/connettori/satispay/pub/callback?payment_id={uuid}&c=${encodeURIComponent(k.segreti.callback || '')}` : undefined;
      const r = await firmata(k, 'POST', '/g_business/v1/payments', { flow: 'MATCH_CODE', amount_unit: cent, currency: 'EUR', external_code: rif.slice(0, 50),
        ...(cb ? { callback_url: cb } : {}), ...(k.imp.ritorno ? { redirect_url: k.imp.ritorno } : {}), metadata: { kubo: rif, descrizione: descrizione.slice(0, 500) } });
      if (!r.ok) throw errore(r);
      k.stato.scrivi('aperti', [...(k.stato.leggi('aperti') || []), { id: r.json.id, rif, creato: Date.now() }].slice(-500));
      return { url: r.json.redirect_url || `https://online.satispay.com/pay/${r.json.id}`, id: r.json.id, codice: r.json.code_identifier, importo };
    }),
  },
  // GET /api/connettori/satispay/pub/callback?payment_id=…&c=<codice>: il corpo non conta, si rilegge il pagamento
  pubbliche: {
    async callback({ q, k }) {
      const id = String(q.get('payment_id') || ''), c = String(q.get('c') || '');
      if (!k.segreti.callback || !stessoSegreto(c, k.segreti.callback) || !ID.test(id)) return null;
      const esito = await controlla(k, id); k.annota('entrata', 'ok', `callback ${id}`, esito);
      return { corpo: 'ok' };
    },
  },
  pianificati: {
    controlla: { ogni: '10m', async giro(k) {
      const aperti = (k.stato.leggi('aperti') || []).filter(x => Date.now() - x.creato < 3 * 864e5); k.stato.scrivi('aperti', aperti);
      const esiti = []; for (const x of aperti) esiti.push(await controlla(k, x.id));
      return { controllati: aperti.length, pagati: esiti.filter(e => e === 'pagata').length };
    } },
  },
  catalogo: {
    categoria: 'pagamenti', sito: 'https://www.satispay.com/it-it/business/',
    costo: 'a-consumo', costoNota: 'Nessun canone. Pagamenti fino a 10 € senza commissione, sopra 10 € 0,20 € fissi a transazione (listino Satispay Business per i negozi; per l\'online verifica la tua offerta).',
    serve: [{ cosa: 'Codice di attivazione API (6 caratteri, vale una volta)', dove: 'Pannello Satispay Business › Negozi online › Crea codice di attivazione', link: 'https://business.satispay.com/' }],
    passi: ['Apri un conto Satispay Business e crea un negozio online.', 'Nel pannello genera un codice di attivazione (per le prove: ambiente sandbox).', 'In Kubo incolla il codice, scegli «prova» o «produzione» e salva.', 'Premi «Attiva con il codice»: Kubo crea le chiavi RSA e ottiene il KeyId.', 'Se Kubo ha un indirizzo pubblico https, scrivilo: Satispay avvisa subito; altrimenti Kubo controlla ogni 10 minuti.', 'Accendi il connettore e crea il primo link da una vendita o da una fattura.'],
    difficolta: 'media', zone: ['IT', 'UE'],
    fonti: ['https://developers.satispay.com/reference/create-a-payment', 'https://developers.satispay.com/reference/conventions', 'https://developers.satispay.com/reference/get-the-details-of-a-payment'],
    prova: 'finto', parole: ['satispay', 'pagamento', 'link di pagamento', 'qr', 'smartphone', 'payment link', 'mobile payment', 'incasso'],
  },
  testi: {
    en: { descrizione: 'Satispay payment links for sales and invoices: when the customer pays, Kubo marks them paid.', 'imp.codice': 'Activation code (from the Satispay Business dashboard)', 'imp.ambiente': 'Environment', 'imp.indirizzo': 'Public Kubo address (for the callback, optional)', 'imp.ritorno': 'Page after payment (e.g. your website)', 'imp.key_id': 'KeyId (written by Kubo on activation)', 'imp.chiave_privata': 'RSA private key (created by Kubo on activation)', 'imp.callback': 'Callback secret code', 'az.attiva': 'Activate with the code', ...testiLink('Payment link', 'sale', 'invoice'), 'giro.controlla': 'Check pending payments',
      'cat.costoNota': 'No monthly fee. Payments up to €10 are free, above €10 a flat €0.20 per transaction (Satispay Business store price list; check your offer for online).',
      'cat.serve': [{ cosa: 'API activation code (6 characters, single use)', dove: 'Satispay Business dashboard › Online shops › Create activation code' }],
      'cat.passi': ['Open a Satispay Business account and create an online shop.', 'Generate an activation code in the dashboard (for tests: sandbox).', 'Paste the code in Kubo, choose «prova» or «produzione» and save.', 'Press «Activate with the code»: Kubo creates the RSA keys and gets the KeyId.', 'If Kubo has a public https address, enter it so Satispay notifies at once; otherwise Kubo checks every 10 minutes.', 'Switch the connector on and create the first link from a sale or an invoice.'] },
    es: { descrizione: 'Enlaces de pago Satispay para ventas y facturas: cuando el cliente paga, Kubo las marca pagadas.', 'imp.codice': 'Código de activación (del panel Satispay Business)', 'imp.ambiente': 'Entorno', 'imp.indirizzo': 'Dirección pública de Kubo (para el callback, opcional)', 'imp.ritorno': 'Página tras el pago (p. ej. tu web)', 'imp.key_id': 'KeyId (lo escribe Kubo al activar)', 'imp.chiave_privata': 'Clave privada RSA (la crea Kubo al activar)', 'imp.callback': 'Código secreto del callback', 'az.attiva': 'Activar con el código', ...testiLink('Enlace de pago', 'venta', 'factura'), 'giro.controlla': 'Revisar pagos pendientes' },
    fr: { descrizione: 'Liens de paiement Satispay pour ventes et factures : quand le client paie, Kubo les marque payées.', 'imp.codice': 'Code d\'activation (du tableau de bord Satispay Business)', 'imp.ambiente': 'Environnement', 'imp.indirizzo': 'Adresse publique de Kubo (pour le callback, facultatif)', 'imp.ritorno': 'Page après le paiement (ex. votre site)', 'imp.key_id': 'KeyId (écrit par Kubo à l\'activation)', 'imp.chiave_privata': 'Clé privée RSA (créée par Kubo à l\'activation)', 'imp.callback': 'Code secret du callback', 'az.attiva': 'Activer avec le code', ...testiLink('Lien de paiement', 'vente', 'facture'), 'giro.controlla': 'Vérifier les paiements en attente' },
    de: { descrizione: 'Satispay-Zahlungslinks für Verkäufe und Rechnungen: zahlt der Kunde, markiert Kubo sie als bezahlt.', 'imp.codice': 'Aktivierungscode (aus dem Satispay-Business-Dashboard)', 'imp.ambiente': 'Umgebung', 'imp.indirizzo': 'Öffentliche Kubo-Adresse (für den Callback, optional)', 'imp.ritorno': 'Seite nach der Zahlung (z. B. deine Website)', 'imp.key_id': 'KeyId (schreibt Kubo bei der Aktivierung)', 'imp.chiave_privata': 'Privater RSA-Schlüssel (erstellt Kubo bei der Aktivierung)', 'imp.callback': 'Geheimcode des Callbacks', 'az.attiva': 'Mit dem Code aktivieren', ...testiLink('Zahlungslink', 'Verkauf', 'Rechnung'), 'giro.controlla': 'Offene Zahlungen prüfen' },
    pt: { descrizione: 'Links de pagamento Satispay para vendas e faturas: quando o cliente paga, o Kubo marca como pagas.', 'imp.codice': 'Código de ativação (do painel Satispay Business)', 'imp.ambiente': 'Ambiente', 'imp.indirizzo': 'Endereço público do Kubo (para o callback, opcional)', 'imp.ritorno': 'Página após o pagamento (ex.: seu site)', 'imp.key_id': 'KeyId (o Kubo escreve ao ativar)', 'imp.chiave_privata': 'Chave privada RSA (o Kubo cria ao ativar)', 'imp.callback': 'Código secreto do callback', 'az.attiva': 'Ativar com o código', ...testiLink('Link de pagamento', 'venda', 'fatura'), 'giro.controlla': 'Verificar pagamentos pendentes' },
  },
};
