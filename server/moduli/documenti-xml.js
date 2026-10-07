// FatturaPA 1.2.2: FPR12 per le fatture tra privati (aziende e consumatori), FPA12 per la Pubblica Amministrazione (codice
// ufficio di 6 caratteri, CIG/CUP, scissione dei pagamenti). Le autofatture e le integrazioni TD16-TD19 hanno il fornitore
// come cedente e la tua azienda come cessionario.
// controlla() elenca in italiano semplice cosa manca prima di poter esportare; xml() scrive il file con gli elementi nell'ordine
// dello schema XSD, gli importi a due decimali e il riepilogo IVA per aliquota e natura calcolato da documenti-calcoli.js.
// Il nome del file è IT<partita IVA>_<progressivo di 5 caratteri>.xml. Niente invio allo SDI: vedi docs/DOCUMENTI.md.
import { totali, NATURE, DICITURA_FORFETTARIO } from './documenti-calcoli.js';
import { TIPI_CASSA, TIPI_RITENUTA, CAUSALI_RITENUTA, AUTOFATTURE, aliquotaCassa } from './fatture-codici.js';
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
  const piva = grezzo.length === 16 ? '' : /^[A-Z]{2}$/.test(nazione) && grezzo.startsWith(nazione) ? grezzo.slice(2) : grezzo.replace(/^IT/, '');   // DE123… → 123…
  return {
    nome: String(c.nome ?? '').trim(), piva, cf: cf || (grezzo.length === 16 ? grezzo : ''), nazione,
    codice: pulito(c.codice_destinatario), pec: String(c.pec ?? '').trim(),
    via: String(c.via || String(c.indirizzo || '').split('\n')[0] || '').trim(), cap: String(c.cap ?? '').trim(), comune: String(c.comune ?? '').trim(),
    provincia: String(c.provincia ?? '').trim().toUpperCase(), privato: !piva,   // senza partita IVA è un consumatore: basta il codice fiscale, codice destinatario 0000000
  };
}

// le righe della fattura, come le vogliono i conti («no_ritenuta» esclude la riga dalla ritenuta d'acconto)
export const lineeFattura = f => (f.righe || []).map(r => ({ descrizione: r.descrizione, quantita: r.quantita, prezzo: r.prezzo, sconto: r.sconto, sconto_importo: r.sconto_importo,
  aliquota: r.aliquota, natura: r.natura, ...(r.no_ritenuta ? { ritenuta: false } : {}) }));
// la ritenuta si applica anche al contributo solo con la rivalsa INPS 4% (TC22), che è parte del compenso; i contributi
// integrativi delle casse professionali (TC01-TC21) non la scontano (prassi: art. 25 DPR 600/73, istruzioni CU «somme non soggette»)
export const cassaDi = f => (f.cassa_tipo && Number(f.cassa) ? { tipo: f.cassa_tipo, aliquota: f.cassa, ...aliquotaCassa(f), ritenuta: f.cassa_tipo === 'TC22' } : null);
export const contiFattura = f => totali(lineeFattura(f), { ritenuta: f.ritenuta, bollo: f.bollo, bolloCliente: !f.bollo_tuo, cassa: cassaDi(f), esigibilita: f.esigibilita || 'I' });
// la fattura va alla Pubblica Amministrazione (FPA12) se il cliente italiano ha un codice ufficio di 6 caratteri
export const perPA = (f, cliente) => !AUTOFATTURE.includes(f.tipo) && fiscaliCliente(cliente).nazione === 'IT' && fiscaliCliente(cliente).codice.length === 6;

export function controlla(az = {}, f = {}, cliente = {}) {
  const e = [], auto = AUTOFATTURE.includes(f.tipo), c = fiscaliCliente(auto ? f.fornitore_dati || {} : cliente), conti = contiFattura(f), pa = perPA(f, cliente);
  // la tua azienda
  if (!String(az.ragione_sociale || '').trim()) e.push('Mancano i dati della tua azienda: la ragione sociale (Documenti → Dati dell\'azienda).');
  if (!az.piva) e.push('Manca la partita IVA della tua azienda.'); else if (pivaValida(az.piva).errore) e.push(`La partita IVA della tua azienda non va: ${pivaValida(az.piva).errore}.`);
  if (!REGIMI[az.regime]) e.push('Manca il regime fiscale della tua azienda (per esempio RF01 ordinario o RF19 forfettario).');
  if (!az.via || !az.comune || !/^\d{5}$/.test(String(az.cap || ''))) e.push('Manca l\'indirizzo completo della tua azienda (via, CAP di 5 cifre, comune).');
  // la fattura
  if (f.stato === 'bozza' || !f.stato) e.push('La fattura è ancora in bozza: emettila, così prende il suo numero.');
  else if (f.stato === 'annullata') e.push('La fattura è annullata: non si manda allo SDI. Se era già stata mandata, stornala con una nota di credito.');
  else if (!f.numero || !/\d/.test(String(f.numero))) e.push('Manca il numero della fattura.');
  if (!f.data) e.push('Manca la data della fattura.');
  if (!(f.righe || []).length) e.push('La fattura non ha righe.');
  // il cliente (o, nelle autofatture, il fornitore)
  if (auto) {
    if (!c.nome) e.push('Manca il fornitore dell\'autofattura.');
    if (!f.collegata_dati?.numero) e.push('Manca la fattura del fornitore da integrare (numero e data).');
  } else {
    if (!c.nome) e.push('Manca il nome o la ragione sociale del cliente.');
    if (!c.piva && !c.cf && c.nazione === 'IT') e.push('Manca la partita IVA o il codice fiscale del cliente.');
    if (c.piva && c.nazione === 'IT' && pivaValida(c.piva).errore) e.push(`La partita IVA del cliente non va: ${pivaValida(c.piva).errore}.`);
    if (c.cf && c.nazione === 'IT' && cfValido(c.cf).errore) e.push(`Il codice fiscale del cliente non va: ${cfValido(c.cf).errore}.`);
  }
  if (!auto && c.nazione === 'IT') {
    if (c.codice && c.codice.length === 6 && !/^[A-Z0-9]{6}$/.test(c.codice)) e.push('Il codice ufficio della Pubblica Amministrazione ha 6 lettere o cifre.');
    else if (c.codice && c.codice.length !== 6 && !/^[A-Z0-9]{7}$/.test(c.codice)) e.push('Il codice destinatario del cliente deve avere 7 caratteri.');
    else if (!c.codice && !c.pec && !c.privato) e.push('Manca il codice destinatario del cliente: scrivilo nella sua scheda (oppure la PEC; se non ce l\'ha, scrivi 0000000).');
    if (!c.via || !c.comune || !/^\d{5}$/.test(c.cap)) e.push('Manca l\'indirizzo completo del cliente (via, CAP di 5 cifre, comune).');
    if (c.provincia && !/^[A-Z]{2}$/.test(c.provincia)) e.push('La provincia del cliente va scritta con la sigla di 2 lettere (es. MI).');
  } else if (!auto && (!c.via || !c.comune)) e.push('Manca l\'indirizzo del cliente (via e città).');
  // la Pubblica Amministrazione: CIG (10 caratteri) e CUP (15) vanno con il numero dell'ordine o del contratto
  if (f.cig && !/^[A-Z0-9]{10}$/.test(pulito(f.cig))) e.push('Il CIG ha 10 lettere o cifre.');
  if (f.cup && !/^[A-Z0-9]{15}$/.test(pulito(f.cup))) e.push('Il CUP ha 15 lettere o cifre.');
  if ((f.cig || f.cup) && !String(f.pa_documento_id || '').trim()) e.push('Con il CIG o il CUP serve il numero dell\'ordine o del contratto.');
  if (f.esigibilita === 'S' && az.regime === 'RF19') e.push('Nel regime forfettario non c\'è IVA: niente scissione dei pagamenti.');
  // le righe e i conti
  (f.righe || []).forEach((r, i) => {
    if (!String(r.descrizione || '').trim()) e.push(`Riga ${i + 1}: manca la descrizione.`);
    if (!Number(r.aliquota) && !r.natura) e.push(`Riga ${i + 1}: IVA a 0 senza natura. Scegli perché non c'è IVA (es. N2.2 forfettario, N4 esente).`);
    if (az.regime === 'RF19' && Number(r.aliquota) && !auto) e.push(`Riga ${i + 1}: nel regime forfettario non si applica l'IVA (metti 0 e natura N2.2).`);
  });
  if (conti.serveBollo && !f.bollo) e.push('Le righe senza IVA superano 77,47 €: spunta «Bollo virtuale da 2 €».');
  if (Number(f.ritenuta) && (!TIPI_RITENUTA[f.ritenuta_tipo] || !CAUSALI_RITENUTA.includes(f.ritenuta_causale))) e.push('Con la ritenuta servono il tipo e la causale.');
  if (Number(f.ritenuta) && !conti.ritenuta) e.push('La ritenuta non ha righe a cui applicarsi: togli «esclusa dalla ritenuta» da almeno una riga.');
  if (Number(f.cassa) && !TIPI_CASSA[f.cassa_tipo]) e.push('Scegli la cassa previdenziale (per esempio TC22 INPS).');
  if (conti.cassa && !conti.cassa.aliquotaIva && !conti.cassa.natura) e.push('La cassa previdenziale è senza IVA: scegli la natura (es. N4 o N2.2).');
  if (f.tipo === 'TD24' && !(f.ddt || []).some(d => d.numero && d.data)) e.push('La fattura differita deve citare i DDT: aggiungi numero e data di almeno un DDT.');
  if (conti.totale <= 0) e.push('Il totale della fattura è zero o negativo (per uno storno usa una nota di credito con importi positivi).');
  if (f.condizioni === 'TP01' && !(f.rate || []).length) e.push('Pagamento a rate senza rate: aggiungile, o scegli «Pagamento completo».');
  if (pa && !auto && f.tipo !== 'TD04' && !f.esigibilita) e.push('Fattura alla PA: scegli l\'esigibilità IVA (di solito «scissione dei pagamenti»).');
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
// il prezzo unitario: da 2 a 8 decimali (Amount8DecimalType)
const d8 = n => { const [i, d = ''] = Number(n).toFixed(8).replace(/0+$/, '').split('.'); return `${i}.${d.padEnd(2, '0')}`; };
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
  const auto = AUTOFATTURE.includes(f.tipo), pa = perPA(f, cliente), conti = contiFattura(f), pivaAz = pulito(az.piva).replace(/^IT/, '');
  // nelle autofatture il «cliente» del file sei tu e il cedente è il fornitore
  const noi = { nome: az.ragione_sociale, piva: pivaAz, codice_fiscale: az.codice_fiscale, via: az.via, cap: az.cap, comune: az.comune, provincia: az.provincia, nazione: 'IT', codice_destinatario: az.codice_destinatario, pec: az.pec };
  const c = fiscaliCliente(auto ? noi : cliente), forn = auto ? fiscaliCliente(f.fornitore_dati || {}) : null;
  const estero = c.nazione !== 'IT', formato = pa ? 'FPA12' : 'FPR12';
  const codice = estero ? 'XXXXXXX' : c.codice || '0000000';
  const sede = (via, cap, comune, provincia, nazione) => ['Sede', [['Indirizzo', testoPA(via, 60) || '-'], ['CAP', /^\d{5}$/.test(cap) ? cap : '00000'], ['Comune', testoPA(comune, 60) || '-'],
    se(nazione === 'IT' && /^[A-Z]{2}$/.test(provincia), ['Provincia', provincia]), ['Nazione', nazione]]];
  const forfettario = az.regime === 'RF19';
  const causali = [];
  for (let t = testoPA(f.causale, 2000); t; t = t.slice(200)) causali.push(['Causale', t.slice(0, 200)]);
  const rate = f.condizioni === 'TP01' && (f.rate || []).length ? f.rate : null;
  const pagamento = (scadenza, importo) => ['DettaglioPagamento', [['ModalitaPagamento', f.modalita || 'MP05'], se(scadenza, ['DataScadenzaPagamento', scadenza]),
    ['ImportoPagamento', d2(importo)], se(az.banca && f.modalita === 'MP05', ['IstitutoFinanziario', testoPA(az.banca, 80)]), se(az.iban && ['MP05', 'MP19', 'MP12'].includes(f.modalita || 'MP05'), ['IBAN', pulito(az.iban)])]];
  // il cedente: la tua azienda, o il fornitore nelle autofatture (estero: RF18 «altro», perché il suo regime italiano non c'è)
  const cedente = auto
    ? ['CedentePrestatore', [['DatiAnagrafici', [['IdFiscaleIVA', [['IdPaese', forn.nazione], ['IdCodice', forn.piva || testoPA(forn.cf, 28).replace(/\s/g, '') || '99999999999']]],
        se(forn.cf && forn.nazione === 'IT', ['CodiceFiscale', forn.cf]), ['Anagrafica', [['Denominazione', testoPA(forn.nome, 80)]]], ['RegimeFiscale', forn.nazione === 'IT' ? 'RF01' : 'RF18']]],
      sede(forn.via, forn.cap, forn.comune, forn.provincia, forn.nazione)]]
    : ['CedentePrestatore', [
      ['DatiAnagrafici', [['IdFiscaleIVA', [['IdPaese', 'IT'], ['IdCodice', pivaAz]]], se(az.codice_fiscale, ['CodiceFiscale', pulito(az.codice_fiscale)]),
        ['Anagrafica', [['Denominazione', testoPA(az.ragione_sociale, 80)]]], ['RegimeFiscale', az.regime]]],
      sede(az.via, String(az.cap || ''), az.comune, String(az.provincia || '').toUpperCase(), 'IT'),
      se(az.telefono || az.email, ['Contatti', [se(az.telefono, ['Telefono', testoPA(String(az.telefono).replace(/\s/g, ''), 12)]), se(az.email, ['Email', testoPA(az.email, 256)])]])]];
  const albero = ['FatturaElettronicaHeader', [
    ['DatiTrasmissione', [['IdTrasmittente', [['IdPaese', 'IT'], ['IdCodice', pulito(az.codice_fiscale) || pivaAz]]], ['ProgressivoInvio', progressivo],
      ['FormatoTrasmissione', formato], ['CodiceDestinatario', codice], se(!estero && !c.codice && c.pec, ['PECDestinatario', c.pec])]],
    cedente,
    ['CessionarioCommittente', [
      // un cliente estero ha sempre l'IdFiscaleIVA: la sua partita IVA, o il codice fiscale, o 99999999999 se è un privato senza codice
      ['DatiAnagrafici', [se(c.piva || estero, ['IdFiscaleIVA', [['IdPaese', c.nazione], ['IdCodice', c.piva || testoPA(c.cf, 28).replace(/\s/g, '') || '99999999999']]]), se(c.cf && !estero, ['CodiceFiscale', c.cf]),
        ['Anagrafica', [['Denominazione', testoPA(c.nome, 80)]]]]],
      sede(c.via, String(c.cap || ''), c.comune, c.provincia, c.nazione)]],
  ]];
  // l'ordine, il contratto o la convenzione della PA, con CIG e CUP (DatiDocumentiCorrelatiType)
  const docPA = f.pa_documento_id ? [{ ordine: 'DatiOrdineAcquisto', contratto: 'DatiContratto', convenzione: 'DatiConvenzione' }[f.pa_documento] || 'DatiOrdineAcquisto', [
    ['IdDocumento', testoPA(f.pa_documento_id, 20)], se(f.pa_documento_data, ['Data', f.pa_documento_data]),
    se(f.cup, ['CodiceCUP', pulito(f.cup).slice(0, 15)]), se(f.cig, ['CodiceCIG', pulito(f.cig).slice(0, 15)])]] : null;
  const k = conti.cassa;
  const corpo = ['FatturaElettronicaBody', [
    ['DatiGenerali', [['DatiGeneraliDocumento', [
      ['TipoDocumento', f.tipo || 'TD01'], ['Divisa', 'EUR'], ['Data', f.data], ['Numero', testoPA(f.numero, 20)],
      se(conti.ritenuta > 0, ['DatiRitenuta', [['TipoRitenuta', f.ritenuta_tipo || 'RT01'], ['ImportoRitenuta', d2(conti.ritenuta)], ['AliquotaRitenuta', d2(f.ritenuta)], ['CausalePagamento', f.ritenuta_causale || 'A']]]),
      se(f.bollo, ['DatiBollo', [['BolloVirtuale', 'SI'], ['ImportoBollo', '2.00']]]),
      se(k, ['DatiCassaPrevidenziale', [['TipoCassa', k?.tipo], ['AlCassa', d2(k?.aliquota)], ['ImportoContributoCassa', d2(k?.importo)], ['ImponibileCassa', d2(k?.imponibile)],
        ['AliquotaIVA', d2(k?.aliquotaIva)], se(k?.ritenuta && conti.ritenuta > 0, ['Ritenuta', 'SI']), se(k?.natura, ['Natura', k?.natura])]]),
      ['ImportoTotaleDocumento', d2(conti.totale)], ...causali]],
      docPA,
      // la fattura che una nota di credito storna, o quella del fornitore che un'autofattura integra (preparate da documenti.js)
      se(f.collegata_dati?.numero, ['DatiFattureCollegate', [['IdDocumento', testoPA(f.collegata_dati?.numero, 20)], se(f.collegata_dati?.data, ['Data', f.collegata_dati?.data])]]),
      // la fattura differita cita i DDT
      ...(f.tipo === 'TD24' ? (f.ddt || []).filter(d => d.numero && d.data).map(d => ['DatiDDT', [['NumeroDDT', testoPA(d.numero, 20)], ['DataDDT', d.data]]]) : [])]],
    ['DatiBeniServizi', [
      ...conti.linee.map(l => ['DettaglioLinee', [['NumeroLinea', String(l.n)], ['Descrizione', testoPA(l.descrizione, 1000) || '-'], ['Quantita', qta(l.quantita)],
        ['PrezzoUnitario', d8(l.prezzo)], se(l.sconto, ['ScontoMaggiorazione', [['Tipo', l.sconto > 0 ? 'SC' : 'MG'], ['Percentuale', d2(Math.abs(l.sconto))]]]),
        se(l.sconto_importo, ['ScontoMaggiorazione', [['Tipo', l.sconto_importo > 0 ? 'SC' : 'MG'], ['Importo', d8(Math.abs(l.sconto_importo))]]]),
        ['PrezzoTotale', d2(l.totale)], ['AliquotaIVA', d2(l.aliquota)], se(conti.ritenuta > 0 && l.ritenuta, ['Ritenuta', 'SI']), se(l.natura, ['Natura', l.natura])]]),
      ...conti.riepilogo.map(g => ['DatiRiepilogo', [['AliquotaIVA', d2(g.aliquota)], se(g.natura, ['Natura', g.natura]), ['ImponibileImporto', d2(g.imponibile)], ['Imposta', d2(g.imposta)],
        se(g.aliquota > 0, ['EsigibilitaIVA', ['D', 'S'].includes(f.esigibilita) ? f.esigibilita : 'I']), se(g.natura, ['RiferimentoNormativo', testoPA(forfettario && g.natura === 'N2.2' ? DICITURA_FORFETTARIO : NATURE[g.natura] || g.natura, 100)])]]),
    ]],
    // nelle autofatture non c'è niente da incassare
    auto ? null : ['DatiPagamento', [['CondizioniPagamento', rate ? 'TP01' : f.condizioni === 'TP03' ? 'TP03' : 'TP02'],
      ...(rate ? rate.map(r => pagamento(r.data, r.importo)) : [pagamento(f.scadenza, conti.netto)])]],
  ]];
  const testa = `<?xml version="1.0" encoding="UTF-8"?>\n<p:FatturaElettronica versione="${formato}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ` +
    'xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">\n';
  return { nome: nomeFile(az, progressivo), formato, xml: testa + scrivi(albero, '  ') + scrivi(corpo, '  ') + '</p:FatturaElettronica>\n' };
}
