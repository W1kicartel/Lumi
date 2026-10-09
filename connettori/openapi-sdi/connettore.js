// Fatturazione elettronica tramite intermediario: Openapi.it (servizio SDI). Kubo genera l'XML FatturaPA
// (server/moduli/documenti-xml.js) e l'intermediario lo firma/trasmette allo SDI; le notifiche (RC consegna, NS scarto,
// MC mancata consegna…) e le fatture passive tornano con il callback configurato su /api_configurations.
// Endpoint: POST /invoices, GET /business_registry_configurations, eventi «customer-invoice», «customer-notification»,
// «supplier-invoice» (https://console.openapi.com/apis/sdi/documentation). Base: sdi.openapi.it, prova: test.sdi.openapi.it.
// Un altro intermediario (Aruba, A-Cube) è un altro connettore con lo stesso «xmlDi» qui sotto e le sue chiamate.
import * as X from '../../server/moduli/documenti-xml.js';
import { azienda } from '../../server/moduli/documenti.js';

// l'XML di una fattura di Kubo, con gli stessi controlli dell'esportazione (documenti.js) e il progressivo d'invio comune
export function xmlDi(k, f) {
  const az = azienda(k.db, { leggi: (db, c) => db.prepare('SELECT valore FROM _meta WHERE chiave = ?').get(c)?.valore ?? null });
  let cliente = {}; if (f.cliente?.id) { try { cliente = k.dati.leggi('clienti', f.cliente.id); } catch { cliente = {}; } }
  // una nota di credito (TD04) porta i dati della fattura che corregge (DatiFattureCollegate), come nell'esportazione
  if (f.collegata?.id && !f.collegata_dati) { try { const c = k.dati.leggi('fatture', f.collegata.id); f = { ...f, collegata_dati: { numero: c.numero, data: c.data } }; } catch { /* non leggibile: si invia senza */ } }
  const errori = X.controlla(az, f, cliente); if (errori.length) throw new Error(errori[0]);
  const progressivo = X.progressivoDa(Number(k.D.prossimoNumero(k.db, 'fatturapa', '{N}')));
  return X.xml(az, f, cliente, { progressivo });   // → { nome, xml }
}
const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://sdi.openapi.it' : 'https://test.sdi.openapi.it');
// una bozza o una fattura annullata non va allo SDI
const emessa = (k, f) => { const s = k.valore(f, 'fatture', 'stato'); if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}: non si invia allo SDI`); };
// gli esiti SDI che contano per chi ha emesso la fattura
const ESITI = { RC: 'consegnata', MC: 'non consegnata (in cassetto fiscale)', NS: 'scartata', DT: 'decorrenza termini', NE: 'esito committente', AT: 'non recapitabile' };
export default {
  id: 'openapi-sdi', nome: 'Openapi SDI', versione: 1, icona: 'documento',
  descrizione: 'Manda allo SDI le fatture elettroniche di Kubo e ricevi notifiche e fatture dei fornitori.',
  catalogo: { categoria: 'fatturazione', sito: 'https://openapi.com', costo: 'a-consumo', costoNota: 'A consumo per fattura inviata o ricevuta, con credito prepagato: vedi il listino di Openapi', serve: [{ cosa: 'Token Bearer con gli scope dell\'API SDI', dove: 'Console di Openapi → Token', link: 'https://console.openapi.com' }], passi: ['Registrati sulla console di Openapi e attiva l\'API SDI', 'Crea un token con gli scope dell\'API SDI, prima per l\'ambiente di prova', 'Incolla il token qui e lascia l\'ambiente su «prova»', 'Accendi: Kubo genera il codice segreto del callback', 'Copia l\'indirizzo del webhook e registralo come callback nella configurazione SDI di Openapi', 'Quando le prove vanno, passa a «produzione» con un token di produzione'], difficolta: 'media', zone: ['IT'], fonti: ['https://console.openapi.com/apis/sdi/documentation'], prova: 'finto', parole: ['fattura elettronica', 'sdi', 'xml', 'fatturapa', 'agenzia delle entrate', 'e-invoice'] },
  impostazioni: [
    { id: 'token', nome: 'Token Openapi (Bearer)', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'callback', nome: 'Codice segreto del callback (va in fondo all\'indirizzo)', segreto: true, generato: true },
  ],
  richiede: { fatture: { stato: { tipo: 'stato' }, numero: {}, cliente: { tipo: 'relazione' } }, clienti: { nome: {} } },
  permessi: { fatture: { leggi: true }, clienti: { leggi: true } },
  prova: async k => { const r = await k.http.get(`${base(k)}/business_registry_configurations`, { bearer: k.segreti.token }); return { ok: r.ok, messaggio: r.ok ? null : `HTTP ${r.stato}` }; },
  azioni: {
    invia: {
      nome: 'Invia allo SDI', descrizione: 'Manda la fattura elettronica allo SDI tramite Openapi', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da inviare' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Invio allo SDI', righe: [['Fattura', fattura.numero || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)]],
        avvisi: [...(k.sincro.remoto('fatture', fattura.id) ? ['Questa fattura è già stata inviata'] : []),
          ...(['bozza', 'annullata'].includes(k.valore(fattura, 'fatture', 'stato')) ? ['La fattura non è emessa: non si può inviare'] : [])] }),
      async esegui({ fattura }, k) {
        if (k.sincro.remoto('fatture', fattura.id)) throw new Error('Fattura già inviata allo SDI');
        emessa(k, fattura);
        const { xml, nome } = xmlDi(k, fattura);
        const r = await k.http.post(`${base(k)}/invoices`, { bearer: k.segreti.token, testo: xml, intestazioni: { 'Content-Type': 'application/xml' } });
        if (!r.ok) throw new Error(`Openapi ha risposto ${r.stato}: ${String(r.json?.message || r.testo).slice(0, 200)}`);
        const uuid = r.json?.data?.uuid || r.json?.uuid; if (uuid) k.sincro.collega('fatture', fattura.id, uuid);
        return { uuid, file: nome };
      },
    },
  },
  entrata: {
    firma: { tipo: 'token', segreto: 'callback' },   // /api/connettori/openapi-sdi/in/<codice segreto>
    idempotenza: ev => [ev?.event, ev?.data?.uuid || ev?.data?.invoice_uuid || ev?.data?.invoice?.uuid, ev?.data?.notification?.type || ev?.data?.type, ev?.data?.notification?.uuid].join(':'),
    async gestisci(ev, k) {
      const d = ev?.data || {}, uuid = d.invoice_uuid || d.invoice?.uuid || d.uuid;
      if (ev?.event === 'supplier-invoice') { k.avvisa(`nuova fattura passiva da ${d.invoice?.sender?.business_name || d.sender || 'un fornitore'}`); return 'passiva ricevuta'; }
      if (ev?.event !== 'customer-notification') return 'ignorato';
      const tipo = d.notification?.type || d.type, fid = uuid && k.sincro.locale('fatture', uuid);
      if (!fid) return k.avvisa(`notifica SDI ${tipo} per una fattura sconosciuta`);
      const f = k.dati.leggi('fatture', fid), esito = ESITI[tipo] || tipo;
      if (tipo === 'NS' || tipo === 'AT') k.avvisa(`fattura ${k.valore(f, 'fatture', 'numero')} ${esito}: ${String(d.notification?.message || d.message || '').slice(0, 200)}`);
      return `fattura ${k.valore(f, 'fatture', 'numero')} ${esito}`;
    },
  },
  testi: {
    en: { 'cat.costoNota': 'Pay per invoice sent or received, with prepaid credit: see the Openapi price list', 'cat.serve': [{ cosa: 'Bearer token with the SDI API scopes', dove: 'Openapi console → Tokens' }], 'cat.passi': ['Sign up on the Openapi console and enable the SDI API', 'Create a token with the SDI API scopes, first for the test environment', 'Paste the token here and leave the environment on «prova» (test)', 'Switch it on: Kubo generates the callback secret code', 'Copy the webhook address and register it as the callback in the Openapi SDI configuration', 'When the tests work, move to «produzione» with a production token'],
      descrizione: 'Send Kubo e-invoices to SDI and receive notifications and supplier invoices.', 'imp.token': 'Openapi token (Bearer)', 'imp.ambiente': 'Environment', 'imp.callback': 'Callback secret code (goes at the end of the address)', 'az.invia': 'Send to SDI' },
    es: { descrizione: 'Envía al SDI las facturas electrónicas de Kubo y recibe notificaciones y facturas de proveedores.', 'imp.token': 'Token de Openapi (Bearer)', 'imp.ambiente': 'Entorno', 'imp.callback': 'Código secreto del callback (va al final de la dirección)', 'az.invia': 'Enviar al SDI' },
    fr: { descrizione: 'Envoyez au SDI les factures électroniques de Kubo et recevez notifications et factures fournisseurs.', 'imp.token': 'Jeton Openapi (Bearer)', 'imp.ambiente': 'Environnement', 'imp.callback': 'Code secret du callback (à la fin de l\'adresse)', 'az.invia': 'Envoyer au SDI' },
    de: { descrizione: 'Sende Kubos E-Rechnungen an SDI und empfange Meldungen und Lieferantenrechnungen.', 'imp.token': 'Openapi-Token (Bearer)', 'imp.ambiente': 'Umgebung', 'imp.callback': 'Geheimcode des Callbacks (am Ende der Adresse)', 'az.invia': 'An SDI senden' },
    pt: { descrizione: 'Envie ao SDI as faturas eletrônicas do Kubo e receba notificações e faturas de fornecedores.', 'imp.token': 'Token Openapi (Bearer)', 'imp.ambiente': 'Ambiente', 'imp.callback': 'Código secreto do callback (vai no fim do endereço)', 'az.invia': 'Enviar ao SDI' },
  },
};
