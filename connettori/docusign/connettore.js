// DocuSign eSignature (REST v2.1): un preventivo di Lumi va in firma; quando il cliente firma diventa «accettato».
// Accesso «JWT Grant» (server-to-server, niente indirizzo di ritorno): Lumi firma in RS256 un'asserzione
// { iss: integration key, sub: user ID, aud: account(-d).docusign.com, scope: 'signature impersonation' } con la chiave
// privata dell'app e la scambia con POST /oauth/token. Una volta sola serve il consenso dell'utente (azione «consenso»).
// L'indirizzo dell'API (base_uri) e il conto vengono da GET /oauth/userinfo. La busta porta il PDF del preventivo (lo stesso
// di Yousign) con la firma ancorata alla scritta «Firma per accettazione» e il campo nascosto «lumi» = lumi-p-<id>.
// Connect (webhook) firma il corpo: X-DocuSign-Signature-1 = base64(HMAC-SHA256(chiave HMAC, corpo grezzo)).
import { createSign } from 'node:crypto';
import { stampa } from '../../server/moduli/documenti.js';
import { meta } from '../_soldi/comuni.js';
import { testoDi, pdfFirma } from '../yousign/connettore.js';

const prod = k => k.imp.ambiente === 'produzione';
const host = k => k.base || (prod(k) ? 'https://account.docusign.com' : 'https://account-d.docusign.com');
const b64u = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const rifP = id => `lumi-p-${id}`, daRifP = s => /lumi-p-([\w-]{1,60})/.exec(String(s ?? ''))?.[1] || null;

// il token: in memoria finché vale (un'ora)
const accessi = new Map();
export async function token(k) {
  const c = `${k.id}|${host(k)}|${k.imp.integrazione}`, t = accessi.get(c);
  if (t && t.scade - Date.now() > 60000) return t.token;
  if (!k.imp.integrazione || !k.imp.utente || !k.segreti.chiave_privata) throw new Error('Mancano integration key, user ID o chiave privata');
  const ora = Math.floor(Date.now() / 1000), corpo = `${b64u({ typ: 'JWT', alg: 'RS256' })}.${b64u({ iss: k.imp.integrazione, sub: k.imp.utente, aud: new URL(host(k)).host, iat: ora, exp: ora + 3600, scope: 'signature impersonation' })}`;
  const jwt = `${corpo}.${createSign('RSA-SHA256').update(corpo).sign(k.segreti.chiave_privata, 'base64url')}`;
  const r = await k.http.post(`${host(k)}/oauth/token`, { form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt } });
  if (r.json?.error === 'consent_required') throw new Error('Manca il consenso: usa l\'azione «Dai il consenso» una volta');
  if (!r.ok || !r.json?.access_token) throw new Error(`DocuSign ha rifiutato l'accesso (${r.stato}): ${r.json?.error || ''}`);
  accessi.set(c, { token: r.json.access_token, scade: Date.now() + Number(r.json.expires_in || 3600) * 1000 });
  return r.json.access_token;
}
// il conto e il suo indirizzo: quello scelto, altrimenti il predefinito dell'utente
async function conto(k) {
  const s = k.stato.leggi('conto'); if (s?.id && (!k.imp.conto || s.id === k.imp.conto)) return s;
  const r = await k.http.get(`${host(k)}/oauth/userinfo`, { bearer: await token(k) });
  if (!r.ok) throw new Error(`DocuSign userinfo: ${r.stato}`);
  const a = (r.json.accounts || []).find(x => k.imp.conto ? x.account_id === k.imp.conto : x.is_default) || r.json.accounts?.[0];
  if (!a) throw new Error('Nessun conto DocuSign per questo utente');
  const x = { id: a.account_id, base: `${String(a.base_uri).replace(/\/$/, '')}/restapi/v2.1/accounts/${a.account_id}` }; k.stato.scrivi('conto', x); return x;
}
function firmatario(k, p, { email, nome }) {
  const cid = k.valore(p, 'preventivi', 'cliente')?.id ?? k.valore(p, 'preventivi', 'cliente');
  let cl = {}; if (cid) { try { cl = k.dati.leggi('clienti', cid); } catch { cl = {}; } }
  return { email: String(email || k.valore(cl, 'clienti', 'email') || '').trim(), nome: String(nome || k.valore(cl, 'clienti', 'referente') || k.valore(cl, 'clienti', 'nome') || '').trim() };
}
const numeroDi = (k, p) => k.valore(p, 'preventivi', 'numero') || p.numero || p.id;

export default {
  id: 'docusign', nome: 'DocuSign', versione: 1, icona: 'documento',
  descrizione: 'Manda i preventivi in firma con DocuSign: quando il cliente firma, il preventivo diventa «accettato».',
  impostazioni: [
    { id: 'integrazione', nome: 'Integration key (ID dell\'app)', schema: /^[0-9a-f-]{36}$/i },
    { id: 'utente', nome: 'User ID (API Username) di chi manda le buste', schema: /^[0-9a-f-]{36}$/i },
    { id: 'chiave_privata', nome: 'Chiave privata RSA dell\'app (PEM)', segreto: true },
    { id: 'hmac', nome: 'Chiave HMAC di Connect (per il webhook)', segreto: true, obbligatorio: false },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'conto', nome: 'Account ID (vuoto: quello predefinito)', obbligatorio: false },
  ],
  richiede: { preventivi: { stato: { tipo: 'stato', facoltativo: true }, numero: { facoltativo: true }, cliente: { tipo: 'relazione', facoltativo: true } },
    clienti: { nome: { facoltativo: true }, email: { tipo: 'email', facoltativo: true }, referente: { facoltativo: true } } },
  permessi: { preventivi: { leggi: true, modifica: true }, clienti: { leggi: true } },
  prova: async k => { try { const c = await conto(k); return { ok: true, messaggio: `conto ${c.id}` }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    consenso: {
      nome: 'Dai il consenso', descrizione: 'L\'indirizzo per dare una volta il consenso «signature impersonation» all\'app',
      esegui: async (_, k) => ({ url: `${host(k)}/oauth/auth?${new URLSearchParams({ response_type: 'code', scope: 'signature impersonation', client_id: k.imp.integrazione || '', redirect_uri: 'https://www.docusign.com' })}` }),
    },
    firma: {
      nome: 'Manda in firma (DocuSign)', descrizione: 'Manda il preventivo al cliente per la firma con DocuSign', su: 'preventivi', lumi: true, scrive: true,
      input: { preventivo: { tipo: 'relazione', entita: 'preventivi', nome: 'Il preventivo da far firmare' },
        email: { tipo: 'email', nome: 'Email di chi firma (se vuota, quella del cliente)', facoltativo: true }, nome: { tipo: 'testo', nome: 'Nome di chi firma (se vuoto, quello del cliente)', facoltativo: true } },
      proponi: async ({ preventivo, ...x }, k) => {
        const f = firmatario(k, preventivo, x), s = k.valore(preventivo, 'preventivi', 'stato');
        return { titolo: 'Firma con DocuSign', righe: [['Preventivo', numeroDi(k, preventivo)], ['Firma', f.nome || '—'], ['Email', f.email || '—']],
          avvisi: [...(k.sincro.remoto('preventivi', preventivo.id) ? ['Questo preventivo è già in firma'] : []), ...(!f.email ? ['Manca l\'email di chi firma'] : []), ...(['accettato', 'rifiutato'].includes(s) ? [`Il preventivo è già ${s}`] : [])] };
      },
      async esegui({ preventivo, ...x }, k) {
        const id = preventivo.id, s = k.valore(preventivo, 'preventivi', 'stato'), f = firmatario(k, preventivo, x);
        if (k.sincro.remoto('preventivi', id)) throw new Error('Il preventivo è già in firma');
        if (['accettato', 'rifiutato'].includes(s)) throw new Error(`Il preventivo è già ${s}`);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw new Error('Manca un\'email valida di chi firma');
        const st = stampa(k.db, { S: k.S, D: k.D, meta }, k.entita('preventivi'), id, k.ctx), titolo = st.titolo || `Preventivo ${numeroDi(k, preventivo)}`;
        const righe = testoDi(st.html); righe[0] = { testo: righe[0] || titolo, grande: true };
        const { pdf } = pdfFirma(righe, titolo), c = await conto(k);
        const r = await k.http.post(`${c.base}/envelopes`, { bearer: await token(k), json: {
          emailSubject: `Da firmare: ${titolo}`.slice(0, 100), status: 'sent',
          documents: [{ documentId: '1', name: titolo.slice(0, 100), fileExtension: 'pdf', documentBase64: Buffer.from(pdf).toString('base64') }],
          recipients: { signers: [{ recipientId: '1', routingOrder: '1', email: f.email, name: f.nome || f.email,
            tabs: { signHereTabs: [{ anchorString: 'Firma per accettazione', anchorUnits: 'pixels', anchorXOffset: '0', anchorYOffset: '25' }] } }] },
          customFields: { textCustomFields: [{ name: 'lumi', value: rifP(id), show: 'false', required: 'false' }] } } });
        if (!r.ok || !r.json?.envelopeId) throw new Error(`DocuSign ha risposto ${r.stato}: ${String(r.json?.message || r.json?.errorCode || r.testo).slice(0, 200)}`);
        k.sincro.collega('preventivi', id, r.json.envelopeId);
        if (s === 'bozza' && k.campo('preventivi', 'stato')) k.dati.modifica('preventivi', id, { stato: 'inviato' });
        return { busta: r.json.envelopeId, firmatario: f.email };
      },
    },
  },
  // Connect: messaggi JSON firmati con la chiave HMAC
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'x-docusign-signature-1', segreto: 'hmac', formato: 'base64' },
    idempotenza: ev => `${ev?.data?.envelopeId}:${ev?.event}`,
    async gestisci(ev, k) {
      const d = ev?.data || {}, busta = d.envelopeId; if (!busta || !/^envelope-(completed|declined|voided)$/.test(ev.event || '')) return 'ignorato';
      const campi = d.envelopeSummary?.customFields?.textCustomFields || [];
      const pid = k.sincro.locale('preventivi', busta) || daRifP(campi.find(x => x.name === 'lumi')?.value);
      if (!pid) return k.avvisa(`busta ${busta} per un preventivo sconosciuto`);
      let p; try { p = k.dati.leggi('preventivi', pid); } catch { return k.avvisa(`busta ${busta} per un preventivo che non c'è più`); }
      const s = k.valore(p, 'preventivi', 'stato'), n = numeroDi(k, p);
      if (ev.event === 'envelope-voided') return k.avvisa(`la firma del preventivo ${n} è stata annullata`);
      const nuovo = ev.event === 'envelope-completed' ? 'accettato' : 'rifiutato';
      if (s === nuovo) return `ignorato: già ${nuovo}`;
      if (s === 'bozza') k.dati.modifica('preventivi', pid, { stato: 'inviato' });   // le transizioni passano da «inviato»
      k.dati.modifica('preventivi', pid, { stato: nuovo });
      if (nuovo === 'rifiutato') k.avvisa(`il cliente ha rifiutato di firmare il preventivo ${n}`);
      return nuovo;
    },
  },
  catalogo: {
    categoria: 'firma', sito: 'https://www.docusign.com/it-it',
    costo: 'abbonamento', costoNota: 'L\'invio di buste via API richiede un piano DocuSign con API (piani API da circa 50 $ al mese fatturati annualmente; i piani eSignature Standard e Business Pro partono da circa 25–40 € a utente al mese). L\'account sviluppatore per le prove è gratuito.',
    serve: [
      { cosa: 'Integration key e una coppia di chiavi RSA dell\'app', dove: 'DocuSign Admin › Integrations › Apps and Keys › Add App and Integration Key › Generate RSA; aggiungi il Redirect URI https://www.docusign.com', link: 'https://admindemo.docusign.com/apps-and-keys' },
      { cosa: 'User ID (API Username) e, se ne hai più d\'uno, l\'Account ID', dove: 'La stessa pagina Apps and Keys, riquadro «My Account Information»', link: 'https://admindemo.docusign.com/apps-and-keys' },
      { cosa: 'Chiave HMAC di Connect (facoltativa, per sapere subito quando firmano)', dove: 'Admin › Integrations › Connect › Add Configuration (JSON, eventi Envelope Completed/Declined/Voided) › Include HMAC Signature', link: 'https://admindemo.docusign.com/connect' },
    ],
    passi: ['Crea un account sviluppatore DocuSign (gratuito) e un\'app in Apps and Keys.', 'Genera la coppia di chiavi RSA e copia la chiave privata, l\'integration key e lo User ID in Lumi.', 'Premi «Dai il consenso», apri l\'indirizzo e accetta (una volta sola).', 'Premi «Prova la connessione»: Lumi trova il conto e il suo indirizzo.', 'Per gli avvisi immediati crea una configurazione Connect verso l\'indirizzo che mostra Lumi, con la firma HMAC, e incolla la chiave.', 'Dal preventivo usa «Manda in firma (DocuSign)»; per i documenti veri passa all\'ambiente di produzione dopo il «Go-Live».'],
    difficolta: 'difficile', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://developers.docusign.com/platform/auth/jwt/jwt-get-token/', 'https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/create/', 'https://developers.docusign.com/platform/webhooks/connect/hmac/', 'https://developers.docusign.com/platform/auth/reference/user-info/'],
    prova: 'finto', parole: ['docusign', 'firma elettronica', 'firma', 'preventivo', 'contratto', 'busta', 'e-signature', 'esign', 'envelope'],
  },
  testi: {
    en: { descrizione: 'Send quotes for signature with DocuSign: when the customer signs, the quote becomes «accepted».', 'imp.integrazione': 'Integration key (app ID)', 'imp.utente': 'User ID (API Username) of the sender', 'imp.chiave_privata': 'App RSA private key (PEM)', 'imp.hmac': 'Connect HMAC key (for the webhook)', 'imp.ambiente': 'Environment', 'imp.conto': 'Account ID (empty: the default one)', 'az.consenso': 'Give consent', 'az.firma': 'Send for signature (DocuSign)',
      'cat.costoNota': 'Sending envelopes through the API needs a DocuSign plan with API access (API plans from about $50 a month billed yearly; eSignature Standard and Business Pro start at about €25–40 per user a month). The developer account for tests is free.',
      'cat.serve': [{ cosa: 'Integration key and an app RSA key pair', dove: 'DocuSign Admin › Integrations › Apps and Keys › Add App and Integration Key › Generate RSA; add the Redirect URI https://www.docusign.com' }, { cosa: 'User ID (API Username) and, if you have several, the Account ID', dove: 'Same Apps and Keys page, «My Account Information» box' }, { cosa: 'Connect HMAC key (optional, to know at once when they sign)', dove: 'Admin › Integrations › Connect › Add Configuration (JSON, Envelope Completed/Declined/Voided events) › Include HMAC Signature' }],
      'cat.passi': ['Create a free DocuSign developer account and an app in Apps and Keys.', 'Generate the RSA key pair and copy the private key, integration key and User ID into Lumi.', 'Press «Give consent», open the address and accept (only once).', 'Press «Test connection»: Lumi finds the account and its address.', 'For instant notices create a Connect configuration to the address Lumi shows, with HMAC signature, and paste the key.', 'From a quote use «Send for signature (DocuSign)»; for real documents switch to production after the «Go-Live».'] },
    es: { descrizione: 'Envía presupuestos a firmar con DocuSign: cuando el cliente firma, el presupuesto pasa a «aceptado».', 'imp.integrazione': 'Integration key (ID de la app)', 'imp.utente': 'User ID (API Username) del remitente', 'imp.chiave_privata': 'Clave privada RSA de la app (PEM)', 'imp.hmac': 'Clave HMAC de Connect (para el webhook)', 'imp.ambiente': 'Entorno', 'imp.conto': 'Account ID (vacío: el predeterminado)', 'az.consenso': 'Dar el consentimiento', 'az.firma': 'Enviar a firmar (DocuSign)' },
    fr: { descrizione: 'Envoyez les devis en signature avec DocuSign : quand le client signe, le devis devient «accepté».', 'imp.integrazione': 'Integration key (ID de l\'app)', 'imp.utente': 'User ID (API Username) de l\'expéditeur', 'imp.chiave_privata': 'Clé privée RSA de l\'app (PEM)', 'imp.hmac': 'Clé HMAC de Connect (pour le webhook)', 'imp.ambiente': 'Environnement', 'imp.conto': 'Account ID (vide : celui par défaut)', 'az.consenso': 'Donner le consentement', 'az.firma': 'Envoyer en signature (DocuSign)' },
    de: { descrizione: 'Sende Angebote mit DocuSign zur Unterschrift: unterschreibt der Kunde, wird das Angebot «angenommen».', 'imp.integrazione': 'Integration Key (App-ID)', 'imp.utente': 'User ID (API Username) des Absenders', 'imp.chiave_privata': 'Privater RSA-Schlüssel der App (PEM)', 'imp.hmac': 'Connect-HMAC-Schlüssel (für den Webhook)', 'imp.ambiente': 'Umgebung', 'imp.conto': 'Account ID (leer: das Standardkonto)', 'az.consenso': 'Zustimmung geben', 'az.firma': 'Zur Unterschrift senden (DocuSign)' },
    pt: { descrizione: 'Envie orçamentos para assinatura com o DocuSign: quando o cliente assina, o orçamento fica «aceito».', 'imp.integrazione': 'Integration key (ID do app)', 'imp.utente': 'User ID (API Username) do remetente', 'imp.chiave_privata': 'Chave privada RSA do app (PEM)', 'imp.hmac': 'Chave HMAC do Connect (para o webhook)', 'imp.ambiente': 'Ambiente', 'imp.conto': 'Account ID (vazio: o padrão)', 'az.consenso': 'Dar o consentimento', 'az.firma': 'Enviar para assinatura (DocuSign)' },
  },
};
