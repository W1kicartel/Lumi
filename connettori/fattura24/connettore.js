// Fattura24: per chi fattura già con Fattura24. La fattura emessa in Kubo si crea in Fattura24 come fattura elettronica
// (cliente, righe con aliquote e nature, pagamento): da lì si manda allo SDI con «Invia a Sdi».
// API v0.3: un solo indirizzo, POST form-encoded con «apiKey» e «xml» (UTF-8, senza BOM), risposte XML
// (<returnCode>, <description>, <docId>, <docNumber>). Metodi usati: TestKey (returnCode 1 = chiave giusta),
// SaveDocument con DocumentType FE (returnCode 0 = creato). Dalla documentazione: l'API NON invia allo SDI, non crea
// documenti con ritenuta, cassa previdenziale o contributo INPS, non modifica un documento creato; niente chiamate in
// parallelo (la numerazione) e al massimo 30 chiamate al minuto, 200 all'ora, 500 al giorno.
// https://www.fattura24.com/api/introduzione/ · https://www.fattura24.com/api/crea-fattura-elettronica/
import { contiFattura, fiscaliCliente } from '../../server/moduli/documenti-xml.js';

const API = 'https://www.app.fattura24.com/api/v0.3';
const base = k => k.base || API;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const d2 = n => (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
// un valore della risposta XML (anche con il tag di chiusura sbagliato dell'esempio ufficiale: «<docNumber>01/YYYY<docNumber>»)
export const tag = (xml, nome) => { const m = new RegExp(`<${nome}>\\s*(?:<!\\[CDATA\\[)?([^<\\]]*)`).exec(String(xml || '')); return m ? m[1].trim() : null; };
async function chiama(k, metodo, xml) {
  const r = await k.http.post(`${base(k)}/${metodo}`, { form: { apiKey: k.segreti.chiave, ...(xml ? { xml } : {}) } });
  if (!r.ok) throw new Error(`Fattura24 ha risposto ${r.stato}`);
  return { codice: Number(tag(r.testo, 'returnCode')), descrizione: tag(r.testo, 'description') || '', testo: r.testo };
}
// un elemento XML; null o '' si salta (gli elementi facoltativi)
const el = (nome, v) => (v == null || v === '' ? '' : `<${nome}>${esc(v)}</${nome}>`);

// il documento FE di Fattura24 da una fattura di Kubo
export function documento(k, f) {
  if (Number(f.ritenuta) || (f.cassa_tipo && Number(f.cassa))) throw new Error('Fattura24 non accetta dall\'API fatture con ritenuta d\'acconto o cassa previdenziale: creala in Fattura24');
  const tipo = f.tipo || 'TD01'; if (!['TD01', 'TD04'].includes(tipo)) throw new Error(`Il tipo ${tipo} non si crea con l'API di Fattura24 (solo fatture e note di credito)`);
  let cl = {}; if (f.cliente?.id) { try { cl = k.dati.leggi('clienti', f.cliente.id); } catch { cl = {}; } }
  const c = fiscaliCliente(cl), conti = contiFattura(f);
  if (!c.nome) throw new Error('La fattura non ha un cliente con il nome');
  // un cliente con partita IVA vuole PEC o codice destinatario; senza nessuno dei due va nel cassetto fiscale (0000000)
  const codice = c.nazione !== 'IT' ? 'XXXXXXX' : c.codice || (!c.pec && c.piva ? '0000000' : '');
  const righe = conti.linee.map(l => {
    const unitario = l.prezzo * (1 - l.sconto / 100) - l.sconto_importo;
    // con uno sconto che lascia più di due decimali si manda la riga intera (quantità 1), perché i totali tornino
    const intero = Math.abs(unitario * 100 - Math.round(unitario * 100)) > 1e-6;
    return `<Row>${el('Description', intero ? `${l.descrizione} (${l.quantita} × ${d2(unitario)})` : l.descrizione)}${el('Qty', intero ? '1' : String(l.quantita))}<Um/>${el('Price', intero ? d2(l.totale) : d2(unitario))}`
      + `${el('VatCode', String(l.aliquota))}${el('VatDescription', l.aliquota ? `${l.aliquota}%` : l.natura || '0%')}${l.aliquota ? '' : el('FeVatNature', l.natura || 'N2.2')}</Row>`;
  }).join('');
  const pagata = k.valore(f, 'fatture', 'stato') === 'pagata';
  const xml = '<?xml version="1.0" encoding="UTF-8"?><Fattura24><Document>'
    + el('DocumentType', 'FE') + (tipo === 'TD04' ? el('FeDocType', 'TD04') : '')
    + el('CustomerName', c.nome) + el('CustomerAddress', c.via) + el('CustomerPostcode', c.cap) + el('CustomerCity', c.comune) + el('CustomerProvince', c.provincia) + el('CustomerCountry', c.nazione)
    + el('CustomerFiscalCode', c.cf) + el('CustomerVatCode', c.piva) + el('CustomerEmail', cl.email) + el('CustomerCellPhone', cl.telefono)
    + el('FeCustomerPec', c.pec) + el('FeDestinationCode', codice)
    + el('Date', f.data) + el('Number', String(k.valore(f, 'fatture', 'numero') || '')) + el('Object', f.causale ? String(f.causale).slice(0, 2000) : '')
    + el('FePaymentCode', f.modalita || 'MP05') + el('VatType', f.esigibilita && f.esigibilita !== 'I' ? f.esigibilita : '') + (f.bollo ? el('FeVirtualStamp', 'V') : '')
    + el('TotalWithoutTax', d2(conti.imponibile)) + el('VatAmount', d2(conti.imposta)) + el('Total', d2(conti.totale)) + el('SendEmail', 'false')
    + `<Payments><Payment>${el('Date', f.scadenza || f.data)}${el('Amount', d2(conti.netto))}${el('Paid', pagata ? 'true' : 'false')}</Payment></Payments>`
    + `<Rows>${righe}</Rows></Document></Fattura24>`;
  return { xml, cliente: c };
}
const emessa = (k, f) => { const s = k.valore(f, 'fatture', 'stato'); if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}`); };

export default {
  id: 'fattura24', nome: 'Fattura24', versione: 1, icona: 'documento',
  descrizione: 'Le fatture di Kubo create in Fattura24 come fatture elettroniche, pronte da inviare allo SDI.',
  impostazioni: [{ id: 'chiave', nome: 'API key di Fattura24', segreto: true }],
  richiede: { fatture: { stato: { tipo: 'stato' }, numero: {}, data: { tipo: 'data' }, cliente: { tipo: 'relazione' } }, clienti: { nome: {} } },
  permessi: { fatture: { leggi: true }, clienti: { leggi: true } },
  prova: async k => { try { const r = await chiama(k, 'TestKey'); return { ok: r.codice === 1, messaggio: r.codice === 1 ? null : r.descrizione || 'Chiave rifiutata' }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    crea: {
      nome: 'Crea in Fattura24', descrizione: 'Crea in Fattura24 la fattura elettronica (cliente, righe, IVA, pagamento); poi si invia allo SDI da Fattura24', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da creare in Fattura24' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Crea in Fattura24', righe: [['Fattura', k.valore(fattura, 'fatture', 'numero') || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)]],
        avvisi: [...(k.sincro.remoto('fatture', fattura.id) ? ['È già in Fattura24'] : []), ...(['bozza', 'annullata'].includes(k.valore(fattura, 'fatture', 'stato')) ? ['La fattura non è emessa'] : []),
          'Fattura24 non la manda allo SDI da sola: aprila in Fattura24 e premi «Invia a Sdi»'] }),
      async esegui({ fattura }, k) {
        if (k.sincro.remoto('fatture', fattura.id)) throw new Error('Fattura già creata in Fattura24');
        emessa(k, fattura);
        const { xml } = documento(k, fattura), r = await chiama(k, 'SaveDocument', xml);
        const id = tag(r.testo, 'docId');
        if (r.codice !== 0 || !id) throw new Error(`Fattura24: ${String(r.descrizione || r.codice).slice(0, 200)}`);
        k.sincro.collega('fatture', fattura.id, id);
        return { documento: id, numero: tag(r.testo, 'docNumber'), passo: 'In Fattura24 apri la fattura e premi «Invia a Sdi»' };
      },
    },
  },
  catalogo: {
    categoria: 'fatturazione', sito: 'https://www.fattura24.com/',
    costo: 'abbonamento', costoNota: 'Serve un abbonamento a Fattura24 (dal sito: a partire da 4 € al mese + IVA); quali piani includono la fattura elettronica e l\'API si vede su fattura24.com/prezzi. Kubo non aggiunge costi.',
    serve: [{ cosa: 'La API key del tuo account', dove: 'Fattura24 › Configurazione › App e servizi esterni › API (gruppo «E-commerce e API»): copia la chiave', link: 'https://www.fattura24.com/api/introduzione/' }],
    passi: ['In Fattura24 apri Configurazione › App e servizi esterni › API e copia la API key.', 'Compila in Kubo i dati dei clienti: partita IVA o codice fiscale, PEC o codice destinatario.', 'Incolla la chiave nella pagina del connettore e premi «Prova la connessione».', 'Accendi: da ogni fattura emessa c\'è «Crea in Fattura24».', 'In Fattura24 apri la fattura creata e premi «Invia a Sdi»: l\'API non la invia da sola.', 'Le fatture con ritenuta d\'acconto o cassa previdenziale vanno create in Fattura24 a mano (limite dell\'API).'],
    difficolta: 'facile', zone: ['IT'],
    fonti: ['https://www.fattura24.com/api/introduzione/', 'https://www.fattura24.com/api/verifica/', 'https://www.fattura24.com/api/crea-fattura-elettronica/', 'https://www.fattura24.com/api/crea-documento/'],
    prova: 'finto', parole: ['fattura24', 'fatturazione elettronica', 'fattura elettronica', 'sdi', 'fatturapa', 'invoicing', 'e-invoice', 'invoices'],
  },
  testi: {
    en: { descrizione: 'Kubo invoices created in Fattura24 as e-invoices, ready to send to SDI.', 'imp.chiave': 'Fattura24 API key', 'az.crea': 'Create in Fattura24',
      'cat.costoNota': 'You need a Fattura24 subscription (per the website: from €4 a month + VAT); which plans include e-invoicing and the API is shown on fattura24.com/prezzi. Kubo adds no costs.',
      'cat.serve': [{ cosa: 'Your account API key', dove: 'Fattura24 › Configuration › External apps and services › API («E-commerce and API» group): copy the key' }],
      'cat.passi': ['In Fattura24 open Configuration › External apps and services › API and copy the API key.', 'Fill in customer data in Kubo: VAT number or tax code, PEC or recipient code.', 'Paste the key on the connector page and press «Test connection».', 'Switch on: every issued invoice gets «Create in Fattura24».', 'In Fattura24 open the created invoice and press «Invia a Sdi»: the API does not send it by itself.', 'Invoices with withholding tax or pension fund contribution must be created in Fattura24 by hand (API limit).'] },
    es: { descrizione: 'Las facturas de Kubo creadas en Fattura24 como facturas electrónicas, listas para enviar al SDI.', 'imp.chiave': 'API key de Fattura24', 'az.crea': 'Crear en Fattura24' },
    fr: { descrizione: 'Les factures de Kubo créées dans Fattura24 comme factures électroniques, prêtes à envoyer au SDI.', 'imp.chiave': 'Clé API Fattura24', 'az.crea': 'Créer dans Fattura24' },
    de: { descrizione: 'Kubo-Rechnungen als E-Rechnungen in Fattura24 angelegt, bereit zum Senden an SDI.', 'imp.chiave': 'Fattura24-API-Schlüssel', 'az.crea': 'In Fattura24 anlegen' },
    pt: { descrizione: 'As faturas do Kubo criadas no Fattura24 como faturas eletrônicas, prontas para enviar ao SDI.', 'imp.chiave': 'API key do Fattura24', 'az.crea': 'Criar no Fattura24' },
  },
};
