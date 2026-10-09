// Fatturazione elettronica tramite Invoicetronic: Lumi genera l'XML FatturaPA con lo stesso «xmlDi» di Openapi SDI e
// Invoicetronic lo trasmette allo SDI. API REST su https://api.invoicetronic.com/v1, Basic con la chiave API come utente
// e password vuota; la chiave di prova (sandbox) e quella vera usano lo stesso indirizzo (https://invoicetronic.com/en/docs/apikeys/,
// https://invoicetronic.com/en/docs/sandbox/). Invio: POST /send/xml con l'XML (application/xml) → { id }. Esiti SDI: GET /update
// (send_id, state, description). Fatture passive: GET /receive con include_payload (payload, encoding Xml|Base64, file_name).
// Riferimento: https://api.invoicetronic.com/v1/docs. Qui niente webhook: due giri pianificati leggono esiti e passive.
import { xmlDi } from '../openapi-sdi/connettore.js';
import { xmlPassiva, PERMESSI_PASSIVE } from '../_soldi/comuni.js';

const base = k => k.base || 'https://api.invoicetronic.com/v1';
const auth = k => ({ basic: [k.segreti.chiave, ''] });
const emessa = (k, f) => { const s = k.valore(f, 'fatture', 'stato'); if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}: non si invia allo SDI`); };
// gli stati SDI di Invoicetronic (nomi delle notifiche): solo quelli che chiedono di intervenire diventano avvisi
const ESITI = [[/scart/i, 'scartata', true], [/nonconsegn|mancata/i, 'non consegnata (in cassetto fiscale)', false], [/impossibilit/i, 'non recapitabile', true],
  [/rifiutat/i, 'rifiutata dal cliente', true], [/accettat/i, 'accettata dal cliente', false], [/decorr/i, 'decorrenza termini', false], [/consegn/i, 'consegnata', false], [/inviat/i, 'inviata', false]];
const esitoDi = s => ESITI.find(([re]) => re.test(String(s || ''))) || [null, String(s || '?'), false];
const PAGINA = 100, PAGINE = 20;
const lista = j => (Array.isArray(j) ? j : j?.items || j?.data || []);
// tutte le pagine dopo un cursore (id crescente): gli elementi già visti si saltano anche se tornano
async function* nuovi(k, percorso, cursore, extra = {}) {
  for (let pag = 1; pag <= PAGINE; pag++) {
    const q = new URLSearchParams({ page: String(pag), page_size: String(PAGINA), ...extra });
    const r = await k.http.get(`${base(k)}${percorso}?${q}`, auth(k));
    if (!r.ok) throw new Error(`Invoicetronic ha risposto ${r.stato} su ${percorso}`);
    const l = lista(r.json);
    for (const x of l) if (Number(x.id) > cursore) yield x;
    if (l.length < PAGINA) return;
  }
}

export default {
  id: 'invoicetronic', nome: 'Invoicetronic', versione: 1, icona: 'documento',
  descrizione: 'Manda allo SDI le fatture elettroniche di Lumi con Invoicetronic e scarica esiti e fatture dei fornitori.',
  catalogo: { categoria: 'fatturazione', sito: 'https://invoicetronic.com', costo: 'a-consumo', costoNota: 'A pacchetti di fatture (inviate e ricevute), con la sandbox gratuita per le prove: vedi il listino aggiornato sul sito di Invoicetronic',
    serve: [{ cosa: 'Chiave API (di prova per la sandbox, poi quella vera)', dove: 'Dashboard Invoicetronic → API Keys', link: 'https://dashboard.invoicetronic.com' }],
    passi: ['Registrati su Invoicetronic e apri la dashboard', 'Aggiungi la tua azienda (partita IVA) e completa la delega per lo SDI', 'Copia la chiave API di prova', 'Incollala qui e accendi il connettore', 'Prova l\'invio di una fattura emessa e «Sincronizza ora» per esiti e passive', 'Quando le prove vanno, sostituisci la chiave con quella vera'],
    difficolta: 'facile', zone: ['IT'], fonti: ['https://invoicetronic.com/en/docs/', 'https://invoicetronic.com/en/docs/apikeys/', 'https://api.invoicetronic.com/v1/docs'], prova: 'finto',
    parole: ['fattura elettronica', 'sdi', 'xml', 'fatturapa', 'fatture passive', 'agenzia delle entrate', 'e-invoice', 'invoicetronic'] },
  impostazioni: [{ id: 'chiave', nome: 'Chiave API Invoicetronic', segreto: true }],
  richiede: { fatture: { stato: { tipo: 'stato' }, numero: {}, cliente: { tipo: 'relazione' } }, clienti: { nome: {} } },
  permessi: { fatture: { leggi: true }, clienti: { leggi: true }, ...PERMESSI_PASSIVE },
  prova: async k => { const r = await k.http.get(`${base(k)}/update?page=1&page_size=1`, auth(k)); return { ok: r.ok, messaggio: r.ok ? null : `HTTP ${r.stato}` }; },
  azioni: {
    invia: {
      nome: 'Invia allo SDI', descrizione: 'Manda la fattura elettronica allo SDI tramite Invoicetronic', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da inviare' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Invio allo SDI con Invoicetronic', righe: [['Fattura', fattura.numero || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)]],
        avvisi: [...(k.sincro.remoto('fatture', fattura.id) ? ['Questa fattura è già stata inviata'] : []),
          ...(['bozza', 'annullata'].includes(k.valore(fattura, 'fatture', 'stato')) ? ['La fattura non è emessa: non si può inviare'] : [])] }),
      async esegui({ fattura }, k) {
        if (k.sincro.remoto('fatture', fattura.id)) throw new Error('Fattura già inviata allo SDI');
        emessa(k, fattura);
        const { xml, nome } = xmlDi(k, fattura);
        const r = await k.http.post(`${base(k)}/send/xml`, { ...auth(k), testo: xml, intestazioni: { 'Content-Type': 'application/xml' } });
        if (!r.ok) throw new Error(`Invoicetronic ha risposto ${r.stato}: ${String(r.json?.detail || r.json?.title || r.testo).slice(0, 200)}`);
        const id = r.json?.id; if (id != null) k.sincro.collega('fatture', fattura.id, String(id));
        return { id, file: nome };
      },
    },
  },
  pianificati: {
    esiti: { ogni: '15m', async giro(k) {
      let cur = Number(k.stato.leggi('esiti') || 0), n = 0, ignote = 0;
      for await (const u of nuovi(k, '/update', cur)) {
        cur = Math.max(cur, Number(u.id)); const fid = k.sincro.locale('fatture', String(u.send_id));
        if (!fid) { ignote++; continue; }
        const f = k.dati.leggi('fatture', fid), [, esito, avviso] = esitoDi(u.state); n++;
        k.annota('entrata', 'ok', `esito ${u.id}`, `fattura ${k.valore(f, 'fatture', 'numero')} ${esito}`);
        if (avviso) k.avvisa(`fattura ${k.valore(f, 'fatture', 'numero')} ${esito}: ${String(u.description || '').slice(0, 200)}`);
      }
      k.stato.scrivi('esiti', cur);
      return { esiti: n, ignote };
    } },
    passive: { ogni: '30m', async giro(k) {
      let cur = Number(k.stato.leggi('passive') || 0); const conti = { importate: 0, saltate: 0, errori: 0 };
      for await (const p of nuovi(k, '/receive', cur, { include_payload: 'true' })) {
        try {
          const nome = String(p.file_name || `invoicetronic-${p.id}.xml`).replace(/[^\w.-]+/g, '_');
          const b = /base64/i.test(p.encoding || '') ? Buffer.from(String(p.payload || ''), 'base64') : Buffer.from(String(p.payload || ''));
          const x = xmlPassiva(k, nome, b);
          conti.importate += x.importate.length; conti.saltate += x.saltate.length;
          if (x.importate.length) k.avvisa(`nuova fattura passiva da ${x.fornitore.nome}${x.fornitore.nuovo ? ' (fornitore nuovo)' : ''}`);
        } catch (e) { conti.errori++; k.avvisa(`fattura passiva ${p.file_name || p.id} non importata: ${String(e.message).slice(0, 200)}`); }
        cur = Math.max(cur, Number(p.id));
      }
      k.stato.scrivi('passive', cur);
      return conti;
    } },
  },
  testi: {
    en: { descrizione: 'Send Lumi e-invoices to SDI with Invoicetronic and download outcomes and supplier invoices.', 'imp.chiave': 'Invoicetronic API key', 'az.invia': 'Send to SDI', 'giro.esiti': 'SDI outcomes', 'giro.passive': 'Supplier invoices',
      'cat.costoNota': 'In bundles of invoices (sent and received), with a free sandbox for testing: see the current price list on the Invoicetronic website',
      'cat.serve': [{ cosa: 'API key (test key for the sandbox, then the live one)', dove: 'Invoicetronic dashboard → API Keys' }],
      'cat.passi': ['Sign up to Invoicetronic and open the dashboard', 'Add your company (VAT number) and complete the SDI delegation', 'Copy the test API key', 'Paste it here and switch the connector on', 'Try sending an issued invoice and «Sync now» for outcomes and supplier invoices', 'When the tests work, replace the key with the live one'] },
    es: { descrizione: 'Envía al SDI las facturas electrónicas de Lumi con Invoicetronic y descarga resultados y facturas de proveedores.', 'imp.chiave': 'Clave API de Invoicetronic', 'az.invia': 'Enviar al SDI', 'giro.esiti': 'Resultados del SDI', 'giro.passive': 'Facturas de proveedores' },
    fr: { descrizione: 'Envoyez au SDI les factures électroniques de Lumi avec Invoicetronic et téléchargez résultats et factures fournisseurs.', 'imp.chiave': 'Clé API Invoicetronic', 'az.invia': 'Envoyer au SDI', 'giro.esiti': 'Résultats du SDI', 'giro.passive': 'Factures fournisseurs' },
    de: { descrizione: 'Sende Lumis E-Rechnungen mit Invoicetronic an SDI und lade Ergebnisse und Lieferantenrechnungen herunter.', 'imp.chiave': 'Invoicetronic-API-Schlüssel', 'az.invia': 'An SDI senden', 'giro.esiti': 'SDI-Ergebnisse', 'giro.passive': 'Lieferantenrechnungen' },
    pt: { descrizione: 'Envie ao SDI as faturas eletrônicas do Lumi com Invoicetronic e baixe resultados e faturas de fornecedores.', 'imp.chiave': 'Chave API da Invoicetronic', 'az.invia': 'Enviar ao SDI', 'giro.esiti': 'Resultados do SDI', 'giro.passive': 'Faturas de fornecedores' },
  },
};
