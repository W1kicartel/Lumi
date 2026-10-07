// FatturaPA 1.2.2, formato FPR12 (fatture tra privati: aziende e consumatori; per la PA serve FPA12, non ancora qui).
// controlla() elenca in italiano semplice cosa manca prima di poter esportare; xml() scrive il file con gli elementi nell'ordine
// dello schema XSD, gli importi a due decimali e il riepilogo IVA per aliquota e natura calcolato da documenti-calcoli.js.
// Il nome del file è IT<partita IVA>_<progressivo di 5 caratteri>.xml. Niente invio allo SDI: vedi docs/DOCUMENTI.md.
import { totali, NATURE, DICITURA_FORFETTARIO } from './documenti-calcoli.js';
import { pivaValida, cfValido } from './documenti-italia.js';

export const REGIMI = {
  RF01: 'Ordinario', RF02: 'Contribuenti minimi', RF04: 'Agricoltura e pesca', RF05: 'Vendita sali e tabacchi', RF10: 'Intrattenimenti e giochi',
  RF11: 'Agenzie di viaggi', RF12: 'Agriturismo', RF13: 'Vendite a domicilio', RF14: 'Rivendita beni usati e d\'arte', RF15: 'Agenzie di vendite all\'asta',
  RF16: 'IVA per cassa P.A.', RF17: 'IVA per cassa', RF18: 'Altro', RF19: 'Forfettario',
};

const pulito = s => String(s ?? '').replace(/[\s.-]/g, '').toUpperCase();
// il cliente: anche dalle anagrafiche dei modelli di settore, dove «piva» può contenere un codice fiscale e l'indirizzo è libero
export function fiscaliCliente(c = {}) {
  const grezzo = pulito(c.piva), cf = pulito(c.codice_fiscale);
  const nazione = (String(c.nazione || 'IT').trim().toUpperCase() || 'IT').slice(0, 2);
  const piva = grezzo.length === 16 ? '' : grezzo.replace(/^IT/, '');
  return {
    nome: String(c.nome ?? '').trim(), piva, cf: cf || (grezzo.length === 16 ? grezzo : ''), nazione,
    codice: pulito(c.codice_destinatario), pec: String(c.pec ?? '').trim(),
    via: String(c.via || String(c.indirizzo || '').split('\n')[0] || '').trim(), cap: String(c.cap ?? '').trim(), comune: String(c.comune ?? '').trim(),
    provincia: String(c.provincia ?? '').trim().toUpperCase(), privato: !piva,   // senza partita IVA è un consumatore: basta il codice fiscale, codice destinatario 0000000
  };
}

// le righe della fattura, come le vogliono i conti
export const lineeFattura = f => (f.righe || []).map(r => ({ descrizione: r.descrizione, quantita: r.quantita, prezzo: r.prezzo, sconto: r.sconto, aliquota: r.aliquota, natura: r.natura }));
export const contiFattura = f => totali(lineeFattura(f), { ritenuta: f.ritenuta, bollo: f.bollo });

export function controlla(az = {}, f = {}, cliente = {}) {
  const e = [], c = fiscaliCliente(cliente), conti = contiFattura(f);
  // la tua azienda
  if (!String(az.ragione_sociale || '').trim()) e.push('Mancano i dati della tua azienda: la ragione sociale (Documenti → Dati dell\'azienda).');
  if (!az.piva) e.push('Manca la partita IVA della tua azienda.'); else if (pivaValida(az.piva).errore) e.push(`La partita IVA della tua azienda non va: ${pivaValida(az.piva).errore}.`);
  if (!REGIMI[az.regime]) e.push('Manca il regime fiscale della tua azienda (per esempio RF01 ordinario o RF19 forfettario).');
  if (!az.via || !az.comune || !/^\d{5}$/.test(String(az.cap || ''))) e.push('Manca l\'indirizzo completo della tua azienda (via, CAP di 5 cifre, comune).');
  // la fattura
  if (f.stato === 'bozza' || !f.stato) e.push('La fattura è ancora in bozza: emettila, così prende il suo numero.');
  else if (!f.numero || !/\d/.test(String(f.numero))) e.push('Manca il numero della fattura.');
  if (!f.data) e.push('Manca la data della fattura.');
  if (!(f.righe || []).length) e.push('La fattura non ha righe.');
  // il cliente
  if (!c.nome) e.push('Manca il nome o la ragione sociale del cliente.');
  if (!c.piva && !c.cf) e.push('Manca la partita IVA o il codice fiscale del cliente.');
  if (c.piva && c.nazione === 'IT' && pivaValida(c.piva).errore) e.push(`La partita IVA del cliente non va: ${pivaValida(c.piva).errore}.`);
  if (c.cf && c.nazione === 'IT' && cfValido(c.cf).errore) e.push(`Il codice fiscale del cliente non va: ${cfValido(c.cf).errore}.`);
  if (c.nazione === 'IT') {
    if (c.codice && c.codice.length === 6) e.push('Il codice destinatario ha 6 caratteri: è una Pubblica Amministrazione, serve il formato FPA12 (non ancora supportato).');
    else if (c.codice && !/^[A-Z0-9]{7}$/.test(c.codice)) e.push('Il codice destinatario del cliente deve avere 7 caratteri.');
    else if (!c.codice && !c.pec && !c.privato) e.push('Manca il codice destinatario del cliente: scrivilo nella sua scheda (oppure la PEC; se non ce l\'ha, scrivi 0000000).');
    if (!c.via || !c.comune || !/^\d{5}$/.test(c.cap)) e.push('Manca l\'indirizzo completo del cliente (via, CAP di 5 cifre, comune).');
    if (c.provincia && !/^[A-Z]{2}$/.test(c.provincia)) e.push('La provincia del cliente va scritta con la sigla di 2 lettere (es. MI).');
  } else if (!c.via || !c.comune) e.push('Manca l\'indirizzo del cliente (via e città).');
  // le righe e i conti
  (f.righe || []).forEach((r, i) => {
    if (!String(r.descrizione || '').trim()) e.push(`Riga ${i + 1}: manca la descrizione.`);
    if (!Number(r.aliquota) && !r.natura) e.push(`Riga ${i + 1}: IVA a 0 senza natura. Scegli perché non c'è IVA (es. N2.2 forfettario, N4 esente).`);
    if (az.regime === 'RF19' && Number(r.aliquota)) e.push(`Riga ${i + 1}: nel regime forfettario non si applica l'IVA (metti 0 e natura N2.2).`);
  });
  if (conti.serveBollo && !f.bollo) e.push('Le righe senza IVA superano 77,47 €: spunta «Bollo virtuale da 2 €».');
  if (Number(f.ritenuta) && (!f.ritenuta_tipo || !f.ritenuta_causale)) e.push('Con la ritenuta servono il tipo e la causale.');
  if (conti.totale <= 0) e.push('Il totale della fattura è zero o negativo (per uno storno usa una nota di credito con importi positivi).');
  if (f.condizioni === 'TP01' && !(f.rate || []).length) e.push('Pagamento a rate senza rate: aggiungile, o scegli «Pagamento completo».');
  return e;
}

// testo accettato dallo SDI: caratteri latini di base, niente simboli tipografici, lunghezza massima
const SOSTITUZIONI = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '€': 'EUR', '•': '-' };
export function testoPA(s, max = 200) {
  const t = String(s ?? '').replace(/[‘’“”–—…€•]/g, c => SOSTITUZIONI[c]).replace(/[^\s -~ -ÿ]/g, '')
    .replace(/\s+/g, ' ').trim();
  return t.slice(0, max);
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const d2 = n => (Math.round(Number(n) * 100) / 100).toFixed(2);
const qta = n => { const x = Number(n); return Number.isInteger(Math.round(x * 100 * 1e6) / 1e6) ? x.toFixed(2) : String(Number(x.toFixed(8))); };

// albero → XML indentato: [nome, figli | testo] ; i figli null/undefined si saltano (elementi facoltativi)
function scrivi(nodo, rientro = '') {
  if (!nodo) return '';
  const [nome, dentro] = nodo;
  if (Array.isArray(dentro)) { const f = dentro.filter(Boolean); return `${rientro}<${nome}>\n${f.map(x => scrivi(x, rientro + '  ')).join('')}${rientro}</${nome}>\n`; }
  return `${rientro}<${nome}>${esc(dentro)}</${nome}>\n`;
}
const se = (cond, nodo) => (cond ? nodo : null);

export const progressivoDa = n => Number(n).toString(36).toUpperCase().padStart(5, '0').slice(-5);
export const nomeFile = (az, progressivo) => `IT${pulito(az.piva).replace(/^IT/, '')}_${progressivo}.xml`;

export function xml(az, f, cliente, { progressivo = '00001' } = {}) {
  const c = fiscaliCliente(cliente), conti = contiFattura(f), pivaAz = pulito(az.piva).replace(/^IT/, '');
  const estero = c.nazione !== 'IT';
  const codice = estero ? 'XXXXXXX' : c.codice || '0000000';
  const sede = (via, cap, comune, provincia, nazione) => ['Sede', [['Indirizzo', testoPA(via, 60)], ['CAP', /^\d{5}$/.test(cap) ? cap : '00000'], ['Comune', testoPA(comune, 60)],
    se(nazione === 'IT' && /^[A-Z]{2}$/.test(provincia), ['Provincia', provincia]), ['Nazione', nazione]]];
  const forfettario = az.regime === 'RF19';
  const causali = [];
  for (let t = testoPA(f.causale, 2000); t; t = t.slice(200)) causali.push(['Causale', t.slice(0, 200)]);
  const rate = f.condizioni === 'TP01' && (f.rate || []).length ? f.rate : null;
  const pagamento = (scadenza, importo) => ['DettaglioPagamento', [['ModalitaPagamento', f.modalita || 'MP05'], se(scadenza, ['DataScadenzaPagamento', scadenza]),
    ['ImportoPagamento', d2(importo)], se(az.banca && f.modalita === 'MP05', ['IstitutoFinanziario', testoPA(az.banca, 80)]), se(az.iban && ['MP05', 'MP19', 'MP12'].includes(f.modalita || 'MP05'), ['IBAN', pulito(az.iban)])]];
  const albero = ['FatturaElettronicaHeader', [
    ['DatiTrasmissione', [['IdTrasmittente', [['IdPaese', 'IT'], ['IdCodice', pulito(az.codice_fiscale) || pivaAz]]], ['ProgressivoInvio', progressivo],
      ['FormatoTrasmissione', 'FPR12'], ['CodiceDestinatario', codice], se(!estero && !c.codice && c.pec, ['PECDestinatario', c.pec])]],
    ['CedentePrestatore', [
      ['DatiAnagrafici', [['IdFiscaleIVA', [['IdPaese', 'IT'], ['IdCodice', pivaAz]]], se(az.codice_fiscale, ['CodiceFiscale', pulito(az.codice_fiscale)]),
        ['Anagrafica', [['Denominazione', testoPA(az.ragione_sociale, 80)]]], ['RegimeFiscale', az.regime]]],
      sede(az.via, String(az.cap || ''), az.comune, String(az.provincia || '').toUpperCase(), 'IT'),
      se(az.telefono || az.email, ['Contatti', [se(az.telefono, ['Telefono', testoPA(az.telefono, 12)]), se(az.email, ['Email', testoPA(az.email, 256)])]])]],
    ['CessionarioCommittente', [
      ['DatiAnagrafici', [se(c.piva, ['IdFiscaleIVA', [['IdPaese', c.nazione], ['IdCodice', c.piva]]]), se(c.cf && !estero, ['CodiceFiscale', c.cf]),
        ['Anagrafica', [['Denominazione', testoPA(c.nome, 80)]]]]],
      sede(c.via, c.cap, c.comune, c.provincia, c.nazione)]],
  ]];
  const corpo = ['FatturaElettronicaBody', [
    ['DatiGenerali', [['DatiGeneraliDocumento', [
      ['TipoDocumento', f.tipo || 'TD01'], ['Divisa', 'EUR'], ['Data', f.data], ['Numero', testoPA(f.numero, 20)],
      se(conti.ritenuta > 0, ['DatiRitenuta', [['TipoRitenuta', f.ritenuta_tipo || 'RT01'], ['ImportoRitenuta', d2(conti.ritenuta)], ['AliquotaRitenuta', d2(f.ritenuta)], ['CausalePagamento', f.ritenuta_causale || 'A']]]),
      se(f.bollo, ['DatiBollo', [['BolloVirtuale', 'SI'], ['ImportoBollo', '2.00']]]),
      ['ImportoTotaleDocumento', d2(conti.totale)], ...causali]]]],
    ['DatiBeniServizi', [
      ...conti.linee.map(l => ['DettaglioLinee', [['NumeroLinea', String(l.n)], ['Descrizione', testoPA(l.descrizione, 1000) || '-'], ['Quantita', qta(l.quantita)],
        ['PrezzoUnitario', d2(l.prezzo)], se(l.sconto, ['ScontoMaggiorazione', [['Tipo', l.sconto > 0 ? 'SC' : 'MG'], ['Percentuale', d2(Math.abs(l.sconto))]]]),
        ['PrezzoTotale', d2(l.totale)], ['AliquotaIVA', d2(l.aliquota)], se(conti.ritenuta > 0, ['Ritenuta', 'SI']), se(l.natura, ['Natura', l.natura])]]),
      ...conti.riepilogo.map(g => ['DatiRiepilogo', [['AliquotaIVA', d2(g.aliquota)], se(g.natura, ['Natura', g.natura]), ['ImponibileImporto', d2(g.imponibile)], ['Imposta', d2(g.imposta)],
        se(g.aliquota > 0, ['EsigibilitaIVA', 'I']), se(g.natura, ['RiferimentoNormativo', testoPA(forfettario && g.natura === 'N2.2' ? DICITURA_FORFETTARIO : NATURE[g.natura] || g.natura, 100)])]]),
    ]],
    ['DatiPagamento', [['CondizioniPagamento', rate ? 'TP01' : f.condizioni === 'TP03' ? 'TP03' : 'TP02'],
      ...(rate ? rate.map(r => pagamento(r.data, r.importo)) : [pagamento(f.scadenza, conti.netto)])]],
  ]];
  const testa = '<?xml version="1.0" encoding="UTF-8"?>\n<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ' +
    'xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">\n';
  return { nome: nomeFile(az, progressivo), xml: testa + scrivi(albero, '  ') + scrivi(corpo, '  ') + '</p:FatturaElettronica>\n' };
}
