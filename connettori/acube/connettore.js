// Fatturazione elettronica tramite A-Cube (API gov-it): Kubo genera l'XML FatturaPA con lo stesso «xmlDi» di Openapi SDI
// e A-Cube lo trasmette allo SDI. Accesso: POST <common>/login { email, password } → { token } JWT valido 24 ore, tenuto in
// memoria (https://docs.acubeapi.com/documentation/common/authentication). Fatture: POST /invoices con l'XML
// (Content-Type application/xml) → { uuid }; GET /invoices/{uuid} con Accept application/xml per scaricare l'XML
// (https://docs.acubeapi.com/documentation/italy/gov-it/invoices/). Notifiche SDI e fatture passive arrivano ai webhook
// configurati in A-Cube (eventi customer-notification e supplier-invoice: https://docs.acubeapi.com/documentation/italy/gov-it/webhooks)
// con il codice segreto in fondo all'indirizzo. Ambienti: api.acubeapi.com / common.api.acubeapi.com e i -sandbox.
// Peppol (A-Cube lo offre con un'altra API) qui non c'è.
import { xmlDi } from '../openapi-sdi/connettore.js';
import { xmlPassiva, PERMESSI_PASSIVE } from '../_soldi/comuni.js';

const prod = k => k.imp.ambiente === 'produzione';
const api = k => k.base || (prod(k) ? 'https://api.acubeapi.com' : 'https://api-sandbox.acubeapi.com');
const comune = k => k.base || (prod(k) ? 'https://common.api.acubeapi.com' : 'https://common-sandbox.api.acubeapi.com');

// il JWT vale 24 ore: si tiene in memoria per 23, e un 401 lo fa richiedere una volta
const tokens = new Map();
async function token(k, nuovo = false) {
  const c = `${k.id}|${comune(k)}|${k.imp.email}`, t = tokens.get(c);
  if (!nuovo && t && t.scade > Date.now()) return t.token;
  const r = await k.http.post(`${comune(k)}/login`, { json: { email: k.imp.email, password: k.segreti.password } });
  if (!r.ok || !r.json?.token) throw new Error(`A-Cube ha rifiutato l'accesso (${r.stato}): controlla email e password`);
  tokens.set(c, { token: r.json.token, scade: Date.now() + 23 * 3600e3 });
  return r.json.token;
}
async function chiama(k, metodo, url, opz = {}) {
  let r = await k.http[metodo](url, { ...opz, bearer: await token(k) });
  if (r.stato === 401) r = await k.http[metodo](url, { ...opz, bearer: await token(k, true) });
  return r;
}
const emessa = (k, f) => { const s = k.valore(f, 'fatture', 'stato'); if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}: non si invia allo SDI`); };
const ESITI = { RC: 'consegnata', MC: 'non consegnata (in cassetto fiscale)', NS: 'scartata', DT: 'decorrenza termini', NE: 'esito committente', AT: 'non recapitabile', EC: 'esito committente' };
// l'evento: «?evento=» nell'indirizzo (un webhook A-Cube per evento), altrimenti dalla forma del corpo
const notifica = ev => ev?.notification || (ev?.invoice_uuid && ev?.type ? ev : null);
function evento(ev, req) {
  let q = null; try { q = new URL(req?.url || '/', 'http://x').searchParams.get('evento'); } catch { q = null; }
  return q || ev?.event || (notifica(ev) ? 'customer-notification' : (ev?.uuid || ev?.invoice?.uuid) ? 'supplier-invoice' : '');
}
const xmlIn = p => typeof p === 'string' && /^\s*(<\?xml|<[\w:]*FatturaElettronica)/.test(p) ? p : null;

export default {
  id: 'acube', nome: 'A-Cube', versione: 1, icona: 'documento',
  descrizione: 'Manda allo SDI le fatture elettroniche di Kubo con A-Cube e ricevi esiti e fatture dei fornitori.',
  catalogo: { categoria: 'fatturazione', sito: 'https://www.acubeapi.com', costo: 'a-consumo', costoNota: 'A consumo, a pacchetti di fatture inviate e ricevute, con sandbox gratuita: il listino è sul sito di A-Cube o su richiesta',
    serve: [{ cosa: 'Email e password dell\'account A-Cube (sandbox o produzione)', dove: 'Dashboard A-Cube → registrazione e onboarding (ricevi utente, password e codice destinatario)', link: 'https://dashboard.acubeapi.com' },
      { cosa: 'Due webhook (customer-notification e supplier-invoice) verso l\'indirizzo che mostra Kubo', dove: 'Dashboard A-Cube → Configurazioni API (ApiConfiguration)', link: 'https://docs.acubeapi.com/documentation/italy/gov-it/webhooks' }],
    passi: ['Registrati ad A-Cube e chiedi l\'accesso alla sandbox dell\'API gov-it', 'Completa l\'onboarding della tua azienda: A-Cube ti dà il codice destinatario per le fatture passive', 'Inserisci qui l\'email dell\'account e la password, e lascia l\'ambiente su «prova»', 'Accendi: Kubo genera il codice segreto dei webhook', 'Nella dashboard di A-Cube crea un webhook customer-notification verso l\'indirizzo di Kubo seguito da ?evento=customer-notification', 'Crea un webhook supplier-invoice verso lo stesso indirizzo seguito da ?evento=supplier-invoice', 'Prova l\'invio di una fattura emessa; quando va, passa a «produzione» con l\'account di produzione'],
    difficolta: 'media', zone: ['IT'], fonti: ['https://docs.acubeapi.com/documentation/common/authentication', 'https://docs.acubeapi.com/documentation/italy/gov-it/invoices/', 'https://docs.acubeapi.com/documentation/italy/gov-it/webhooks'], prova: 'finto',
    parole: ['fattura elettronica', 'sdi', 'xml', 'fatturapa', 'fatture passive', 'agenzia delle entrate', 'e-invoice', 'peppol', 'acube'] },
  impostazioni: [
    { id: 'email', nome: 'Email dell\'account A-Cube', tipo: 'testo' },
    { id: 'password', nome: 'Password dell\'account A-Cube', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'callback', nome: 'Codice segreto dei webhook (va in fondo all\'indirizzo)', segreto: true, generato: true },
  ],
  richiede: { fatture: { stato: { tipo: 'stato' }, numero: {}, cliente: { tipo: 'relazione' } }, clienti: { nome: {} } },
  permessi: { fatture: { leggi: true }, clienti: { leggi: true }, ...PERMESSI_PASSIVE },
  prova: async k => { try { await token(k, true); return { ok: true, messaggio: null }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    invia: {
      nome: 'Invia allo SDI', descrizione: 'Manda la fattura elettronica allo SDI tramite A-Cube', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da inviare' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Invio allo SDI con A-Cube', righe: [['Fattura', fattura.numero || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)]],
        avvisi: [...(k.sincro.remoto('fatture', fattura.id) ? ['Questa fattura è già stata inviata'] : []),
          ...(['bozza', 'annullata'].includes(k.valore(fattura, 'fatture', 'stato')) ? ['La fattura non è emessa: non si può inviare'] : [])] }),
      async esegui({ fattura }, k) {
        if (k.sincro.remoto('fatture', fattura.id)) throw new Error('Fattura già inviata allo SDI');
        emessa(k, fattura);
        const { xml, nome } = xmlDi(k, fattura);
        const r = await chiama(k, 'post', `${api(k)}/invoices`, { testo: xml, intestazioni: { 'Content-Type': 'application/xml' } });
        if (!r.ok) throw new Error(`A-Cube ha risposto ${r.stato}: ${String(r.json?.['hydra:description'] || r.json?.detail || r.json?.message || r.testo).slice(0, 200)}`);
        const uuid = r.json?.uuid; if (uuid) k.sincro.collega('fatture', fattura.id, uuid);
        return { uuid, file: nome };
      },
    },
  },
  entrata: {
    firma: { tipo: 'token', segreto: 'callback' },   // /api/connettori/acube/in/<codice segreto>?evento=…
    idempotenza: (ev, req) => { const n = notifica(ev); return [evento(ev, req), n ? n.uuid || `${n.invoice_uuid || n.invoice?.uuid}:${n.type}` : ev?.uuid || ev?.invoice?.uuid].join(':'); },
    async gestisci(ev, k, { req } = {}) {
      const tipoE = evento(ev, req);
      if (tipoE === 'supplier-invoice') {
        const uuid = ev?.uuid || ev?.invoice?.uuid;
        let xml = xmlIn(ev?.payload) || xmlIn(ev?.invoice?.payload);
        if (!xml) {
          if (!uuid) return k.avvisa('fattura passiva senza uuid: scaricala dalla dashboard di A-Cube');
          const r = await chiama(k, 'get', `${api(k)}/invoices/${encodeURIComponent(uuid)}`, { intestazioni: { Accept: 'application/xml' } });
          if (!r.ok) throw new Error(`A-Cube ha risposto ${r.stato} scaricando la fattura passiva ${uuid}`);   // 500: A-Cube riprova
          xml = r.testo;
        }
        const x = xmlPassiva(k, `${ev?.file_name || ev?.filename || uuid || 'acube'}`.replace(/[^\w.-]+/g, '_').replace(/(\.xml)?$/i, '.xml'), Buffer.from(xml));
        if (!x.importate.length) return `passiva già presente (${x.fornitore.nome})`;
        k.avvisa(`nuova fattura passiva da ${x.fornitore.nome}${x.fornitore.nuovo ? ' (fornitore nuovo)' : ''}`);
        return `passiva importata: ${x.importate.map(f => f.numero).join(', ')}`;
      }
      if (tipoE !== 'customer-notification') return 'ignorato';
      const n = notifica(ev) || {}, uuid = n.invoice_uuid || n.invoice?.uuid, tipo = n.type, fid = uuid && k.sincro.locale('fatture', uuid);
      if (!fid) return k.avvisa(`notifica SDI ${tipo} per una fattura sconosciuta`);
      const f = k.dati.leggi('fatture', fid), esito = ESITI[tipo] || tipo, msg = typeof n.message === 'string' ? n.message : JSON.stringify(n.message ?? '');
      if (tipo === 'NS' || tipo === 'AT') k.avvisa(`fattura ${k.valore(f, 'fatture', 'numero')} ${esito}: ${msg.slice(0, 200)}`);
      return `fattura ${k.valore(f, 'fatture', 'numero')} ${esito}`;
    },
  },
  testi: {
    en: { descrizione: 'Send Kubo e-invoices to SDI with A-Cube and receive outcomes and supplier invoices.', 'imp.email': 'A-Cube account email', 'imp.password': 'A-Cube account password', 'imp.ambiente': 'Environment', 'imp.callback': 'Webhook secret code (goes at the end of the address)', 'az.invia': 'Send to SDI',
      'cat.costoNota': 'Pay as you go, in bundles of sent and received invoices, with a free sandbox: the price list is on the A-Cube website or on request',
      'cat.serve': [{ cosa: 'Email and password of the A-Cube account (sandbox or production)', dove: 'A-Cube dashboard → sign-up and onboarding (you get user, password and recipient code)' }, { cosa: 'Two webhooks (customer-notification and supplier-invoice) to the address Kubo shows', dove: 'A-Cube dashboard → API configurations (ApiConfiguration)' }],
      'cat.passi': ['Sign up to A-Cube and ask for access to the gov-it API sandbox', 'Complete your company onboarding: A-Cube gives you the recipient code for supplier invoices', 'Enter the account email and password here, and leave the environment on «prova» (test)', 'Switch it on: Kubo generates the webhook secret code', 'In the A-Cube dashboard create a customer-notification webhook to the Kubo address followed by ?evento=customer-notification', 'Create a supplier-invoice webhook to the same address followed by ?evento=supplier-invoice', 'Try sending an issued invoice; when it works, move to «produzione» with the production account'] },
    es: { descrizione: 'Envía al SDI las facturas electrónicas de Kubo con A-Cube y recibe resultados y facturas de proveedores.', 'imp.email': 'Email de la cuenta A-Cube', 'imp.password': 'Contraseña de la cuenta A-Cube', 'imp.ambiente': 'Entorno', 'imp.callback': 'Código secreto de los webhooks (va al final de la dirección)', 'az.invia': 'Enviar al SDI' },
    fr: { descrizione: 'Envoyez au SDI les factures électroniques de Kubo avec A-Cube et recevez résultats et factures fournisseurs.', 'imp.email': 'E-mail du compte A-Cube', 'imp.password': 'Mot de passe du compte A-Cube', 'imp.ambiente': 'Environnement', 'imp.callback': 'Code secret des webhooks (à la fin de l\'adresse)', 'az.invia': 'Envoyer au SDI' },
    de: { descrizione: 'Sende Kubos E-Rechnungen mit A-Cube an SDI und empfange Ergebnisse und Lieferantenrechnungen.', 'imp.email': 'E-Mail des A-Cube-Kontos', 'imp.password': 'Passwort des A-Cube-Kontos', 'imp.ambiente': 'Umgebung', 'imp.callback': 'Geheimcode der Webhooks (am Ende der Adresse)', 'az.invia': 'An SDI senden' },
    pt: { descrizione: 'Envie ao SDI as faturas eletrônicas do Kubo com A-Cube e receba resultados e faturas de fornecedores.', 'imp.email': 'Email da conta A-Cube', 'imp.password': 'Senha da conta A-Cube', 'imp.ambiente': 'Ambiente', 'imp.callback': 'Código secreto dos webhooks (vai no fim do endereço)', 'az.invia': 'Enviar ao SDI' },
  },
};
