// I punti di contatto fra il fisco e le fatture: una sola sezione «Fatture ricevute» (anche quella vecchia creata dal fisco
// diventa quella del modello fatture), reverse charge ed estero con le integrazioni TD16-TD19 nei due registri IVA, il bollo
// virtuale uguale fra la pagina Fatture e gli F24, l'incassato per cassa del forfettario dai pagamenti delle fatture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apri, meta } from '../server/db.js';
import * as S from '../server/schema.js';
import * as D from '../server/dati.js';
import * as P from '../server/permessi.js';
import * as A from '../server/automazioni.js';
import * as M from '../server/modelli.js';
import * as F from '../server/moduli/fisco.js';
import { calcola } from '../server/formule.js';
import { attivaFatture, salvaAzienda, completaClienti } from '../server/moduli/documenti.js';
import { importa, integrazione, bolloAnno, aggiornaModello } from '../server/moduli/fatture.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

attivaFatture(D); A.attiva();
const QUI = dirname(fileURLToPath(import.meta.url));
const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI' };
class ErroreHttp extends Error { constructor(s, m) { super(m); this.stato = s; } }
function gestionale({ regime = 'RF01', fisco = {} } = {}) {
  const db = apri(); M.installa(db, 'fatture'); completaClienti(db, S); salvaAzienda(db, meta, { ...AZ, regime });
  db.exec('CREATE TABLE IF NOT EXISTS _fatture_xml (id TEXT PRIMARY KEY, nome TEXT, xml TEXT NOT NULL, indice INTEGER NOT NULL DEFAULT 0)');   // come fa il modulo fatture all'avvio
  F.salvaImpostazioni(db, meta, fisco);
  const k = { db, S, D, P, meta, ErroreHttp };
  const cl = D.crea(db, 'clienti', { nome: 'Bianchi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: '0000000' });
  return { db, k, cl };
}
const oggiAzienda = () => calcola('OGGI()', {});   // il giorno dell'azienda (Europe/Rome), quello delle formule e delle automazioni
const anno = Number(oggiAzienda().slice(0, 4)), tuttoAnno = [`${anno}-01-01`, `${anno}-12-31`];

// una fattura ricevuta FatturaPA minima: fornitore, righe e riepilogo
const fatturaPA = ({ paese = 'IT', piva, nome, numero, data, imponibile, aliquota = 0, natura = null }) => {
  const imposta = (imponibile * aliquota / 100).toFixed(2), nat = natura ? `<Natura>${natura}</Natura>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12"><FatturaElettronicaHeader>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>${paese}</IdPaese><IdCodice>${piva}</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>${nome}</Denominazione></Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici>
<Sede><Indirizzo>Via Uno 1</Indirizzo><CAP>00000</CAP><Comune>Città</Comune><Nazione>${paese}</Nazione></Sede></CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>12345678903</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Bottega Prova srl</Denominazione></Anagrafica></DatiAnagrafici>
<Sede><Indirizzo>Via dei Mille 10</Indirizzo><CAP>20121</CAP><Comune>Milano</Comune><Nazione>IT</Nazione></Sede></CessionarioCommittente></FatturaElettronicaHeader>
<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>${data}</Data><Numero>${numero}</Numero></DatiGeneraliDocumento></DatiGenerali>
<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Servizio</Descrizione><PrezzoUnitario>${imponibile.toFixed(2)}</PrezzoUnitario><PrezzoTotale>${imponibile.toFixed(2)}</PrezzoTotale><AliquotaIVA>${aliquota.toFixed(2)}</AliquotaIVA>${nat}</DettaglioLinee>
<DatiRiepilogo><AliquotaIVA>${aliquota.toFixed(2)}</AliquotaIVA>${nat}<ImponibileImporto>${imponibile.toFixed(2)}</ImponibileImporto><Imposta>${imposta}</Imposta></DatiRiepilogo></DatiBeniServizi></FatturaElettronicaBody>
</p:FatturaElettronica>`;
};
const importaXml = (db, x) => importa(db, { S, D, meta }, 'f.xml', Buffer.from(fatturaPA(x)), null).importate[0].id;

test('reverse charge ed estero: da integrare finché non c\'è il TD16-TD19, poi nei registri vendite e acquisti con la stessa IVA', () => {
  const { db, k } = gestionale({ fisco: { regime: 'ordinario', periodicita: 'trimestrale' } });
  const oggi = oggiAzienda();
  // una fattura italiana normale: aliquota dall'XML, partita IVA dal fornitore collegato
  importaXml(db, { piva: '00743110157', nome: 'Carta srl', numero: 'C-1', data: `${anno}-01-10`, imponibile: 100, aliquota: 22 });
  // servizio dall'Irlanda (TD17) e subappalto edile in reverse charge da un fornitore italiano (TD16)
  const ie = importaXml(db, { paese: 'IE', piva: '6388047V', nome: 'Cloud Ltd', numero: 'INV-9', data: oggi, imponibile: 1000 });
  const rc = importaXml(db, { piva: '01234567897', nome: 'Edile snc', numero: '45', data: oggi, imponibile: 500, natura: 'N6.3' });
  let reg = F.registri(k, null, ...tuttoAnno);
  assert.deepEqual(reg.acquisti.map(x => [x.fornitore, x.piva, x.aliquota, x.imposta]), [['Carta srl', '00743110157', 22, 22]]);
  assert.deepEqual(reg.daIntegrare.map(x => x.numero).sort(), ['45', 'INV-9']);
  assert.ok(F.liquidazione(k, null, anno).avvisi.includes('da-integrare'));
  // le integrazioni: in bozza non contano, emesse sì, in tutti e due i registri
  const t17 = integrazione(db, { S, D, P, ErroreHttp }, ie, {}, null), t16 = integrazione(db, { S, D, P, ErroreHttp }, rc, {}, null);
  assert.deepEqual([t17.tipo, t16.tipo], ['TD17', 'TD16']);
  assert.equal(F.registri(k, null, ...tuttoAnno).acquisti.length, 1);
  for (const t of [t17, t16]) D.modifica(db, 'fatture', t.id, { stato: 'emessa' });
  D.modifica(db, 'fatture', t16.id, { stato: 'inviata' });   // inviata allo SDI: conta come emessa
  reg = F.registri(k, null, ...tuttoAnno);
  assert.deepEqual(reg.vendite.map(v => [v.tipo, v.imposta]).sort(), [['TD16', 110], ['TD17', 220]]);
  const integrate = reg.acquisti.filter(x => x.integrazione);
  assert.deepEqual(integrate.map(x => [x.integrazione.tipo, x.imponibile, x.imposta, x.detraibile, x.registrazione]).sort(), [['TD16', 500, 110, 110, oggi], ['TD17', 1000, 220, 220, oggi]]);
  assert.deepEqual(reg.daIntegrare, []);
  assert.equal(reg.totali.acquisti.detraibile, 22 + 330);
  assert.ok(!F.liquidazione(k, null, anno).avvisi.includes('da-integrare'));
  // nella liquidazione l'IVA delle integrazioni è a debito e a credito nello stesso periodo
  const l = F.liquidazione(k, null, anno), p = l.periodi.find(x => x.da <= oggi && x.a >= oggi);
  assert.equal(p.ivaEsigibile, 330); assert.ok(p.ivaDetratta >= 330);
});

test('forfettario: l\'IVA delle integrazioni si versa il 16 del mese dopo e le integrazioni non sono ricavi', () => {
  const { db, k } = gestionale({ regime: 'RF19', fisco: { regime: 'forfettario', ateco: '62.01', gestione: 'nessuna' } });
  const ie = importaXml(db, { paese: 'IE', piva: '6388047V', nome: 'Cloud Ltd', numero: 'INV-1', data: `${anno}-03-02`, imponibile: 100 });
  const t = integrazione(db, { S, D, P, ErroreHttp }, ie, {}, null);
  D.modifica(db, 'fatture', t.id, { data: `${anno}-03-05` }); D.modifica(db, 'fatture', t.id, { stato: 'emessa', pagata_il: `${anno}-03-20` });
  const v = F.versamenti(k, null, anno).voci.filter(x => x.chiave === 'iva-integrazioni');
  assert.deepEqual(v.map(x => [x.codice, x.importo, x.periodo]), [['6003', 22, 3]]);
  assert.ok(v[0].data >= `${anno}-04-16` && v[0].data <= `${anno}-04-18`, v[0].data);   // il 16 aprile, o il primo giorno lavorativo dopo
  assert.equal(F.cruscottoForfettario(k, null, anno).incassato, 0);
});

test('bollo virtuale: lo stesso della pagina Fatture negli F24 del fisco, in ogni regime, con le inviate allo SDI', () => {
  const { db, k, cl } = gestionale({ fisco: { regime: 'ordinario' } });
  const esente = (data, extra = {}) => D.crea(db, 'fatture', { cliente: cl.id, data, stato: 'emessa', bollo: true, righe: [{ descrizione: 'Corso', quantita: 1, prezzo: 100, aliquota: 0, natura: 'N4' }], ...extra });
  esente(`${anno}-01-10`); esente(`${anno}-02-10`); esente(`${anno}-05-10`, { bollo_tuo: true });
  const inv = esente(`${anno}-11-03`); D.modifica(db, 'fatture', inv.id, { stato: 'inviata' });
  D.crea(db, 'fatture', { cliente: cl.id, data: `${anno}-12-01`, bollo: true, righe: [{ descrizione: 'Bozza', quantita: 1, prezzo: 100, aliquota: 0, natura: 'N4' }] });   // bozza: non conta
  const pagina = bolloAnno(db, { D, P }, anno, null).trimestri.filter(t => t.importo).map(t => [t.tributo, t.importo, t.scadenza]);
  const f24 = F.versamenti(k, null, anno).voci.filter(x => x.chiave === 'bollo').map(x => [x.codice, x.importo, x.data]);
  assert.deepEqual(f24, pagina);
  assert.deepEqual(f24.map(x => [x[0], x[1]]), [['2521', 4], ['2522', 2], ['2524', 2]]);
  assert.ok(F.registri(k, null, ...tuttoAnno).vendite.some(v => v.id === inv.id));   // l'inviata è nel registro vendite
});

test('forfettario per cassa: «Pagata il», l\'automazione dello stato, le rate pagate; il bollo che paghi tu non è compenso', () => {
  const { db, k, cl } = gestionale({ regime: 'RF19', fisco: { regime: 'forfettario', ateco: '74.10', gestione: 'nessuna' } });
  const f = (data, prezzo, extra = {}) => D.crea(db, 'fatture', { cliente: cl.id, data, stato: 'emessa', righe: [{ descrizione: 'Lavoro', quantita: 1, prezzo, aliquota: 0, natura: 'N2.2' }], ...extra });
  f(`${anno}-01-10`, 1000, { bollo: true, pagata_il: `${anno}-01-31` });                 // 1.002: il bollo addebitato è compenso
  f(`${anno}-01-12`, 500, { bollo: true, bollo_tuo: true, pagata_il: `${anno}-02-01` });  // 500: il bollo lo paghi tu
  const segnata = f(`${anno}-01-15`, 300); D.modifica(db, 'fatture', segnata.id, { stato: 'pagata' });   // l'automazione scrive la data di oggi
  assert.equal(D.leggi(db, 'fatture', segnata.id).pagata_il, oggiAzienda());
  // a rate: 2.000 in due rate, pagata solo la prima (nell'anno)
  const rate = f(`${anno}-01-20`, 2000, { rate: [{ data: `${anno}-02-20`, importo: 1000 }, { data: `${anno}-03-20`, importo: 1000 }] });
  const r = D.leggi(db, 'fatture', rate.id);
  D.modifica(db, 'fatture', rate.id, { rate: r.rate.map((x, i) => ({ ...x, pagata: i === 0 })) });
  f(`${anno}-01-25`, 700);   // non pagata
  assert.equal(F.cruscottoForfettario(k, null, anno).incassato, 1002 + 500 + 300 + 1000);
});

test('una sola sezione: «Fatture ricevute» creata dal fisco prima dell\'unione diventa quella del modello fatture', () => {
  const vecchio = JSON.parse(readFileSync(join(QUI, 'fatture', 'modello-2af0779.json'), 'utf8'));
  const db = apri(); S.applicaTutte(db, vecchio.entita);
  // la sezione che il fisco aggiungeva con «prepara» (fornitore scritto a mano)
  S.applica(db, { id: 'fatture_ricevute', nome: 'Fatture ricevute', icona: 'documento', titolo: 'fornitore', campi: [
    { id: 'fornitore', nome: 'Fornitore', tipo: 'testo', obbligatorio: true }, { id: 'piva_fornitore', nome: 'Partita IVA del fornitore', tipo: 'testo' },
    { id: 'numero', nome: 'Numero', tipo: 'testo' }, { id: 'data', nome: 'Data fattura', tipo: 'data', obbligatorio: true }, { id: 'data_ricezione', nome: 'Ricevuta il', tipo: 'data' },
    { id: 'imponibile', nome: 'Imponibile', tipo: 'valuta' }, { id: 'aliquota', nome: 'IVA %', tipo: 'percentuale', predefinito: 22 }, { id: 'imposta', nome: 'IVA', tipo: 'valuta' },
    { id: 'detraibile', nome: 'IVA detraibile %', tipo: 'percentuale', predefinito: 100 }, { id: 'pagata_il', nome: 'Pagata il', tipo: 'data' },
    { id: 'ritenuta', nome: 'Ritenuta operata', tipo: 'valuta' }, { id: 'cf_percipiente', nome: 'Codice fiscale del percipiente', tipo: 'testo' },
    { id: 'causale_ritenuta', nome: 'Causale (CU)', tipo: 'scelta', opzioni: [{ id: 'A', nome: 'A' }, { id: 'M', nome: 'M' }] }, { id: 'note', nome: 'Note', tipo: 'testo_lungo' }] });
  const a = D.crea(db, 'fatture_ricevute', { fornitore: 'Carta spa', piva_fornitore: 'IT00743110157', numero: '7', data: '2026-01-15', imponibile: 200, aliquota: 22, detraibile: 50 });
  const b = D.crea(db, 'fatture_ricevute', { fornitore: 'Avv. Verdi', numero: '3', data: '2026-02-01', imponibile: 1000, aliquota: 22, ritenuta: 200, cf_percipiente: 'VRDLGU70A01L219X', causale_ritenuta: 'A', pagata_il: '2026-02-10' });
  D.crea(db, 'fatture_ricevute', { fornitore: 'Carta spa', piva_fornitore: '00743110157', numero: '8', data: '2026-02-15', imponibile: 100 });
  aggiornaModello(db, S, { D });
  const def = S.leggi(db, 'fatture_ricevute');
  assert.equal(S.campo(def, 'fornitore').tipo, 'relazione'); assert.equal(def.titolo, 'nome_documento');
  assert.ok(['inversione', 'integrata', 'stato', 'detraibile', 'cf_percipiente'].every(c => S.campo(def, c)));
  assert.equal(D.elenca(db, 'fornitori', {}).righe.length, 2);   // «Carta spa» una volta sola (stessa partita IVA)
  const ra = D.leggi(db, 'fatture_ricevute', a.id), rb = D.leggi(db, 'fatture_ricevute', b.id);
  assert.deepEqual([ra.fornitore.titolo, ra.detraibile, ra.nome_documento], ['Carta spa', 50, '7 · Carta spa']);
  assert.deepEqual([rb.fornitore.titolo, rb.cf_percipiente, rb.causale_ritenuta], ['Avv. Verdi', 'VRDLGU70A01L219X', 'A']);
  const k = { db, S, D, P, meta, ErroreHttp };
  const ac = F.acquisti(k, null, '2026-01-01', '2026-12-31');
  assert.deepEqual(ac.map(x => [x.fornitore, x.imposta, x.detraibile]), [['Carta spa', 44, 22], ['Avv. Verdi', 220, 220], ['Carta spa', 22, 22]]);
  assert.deepEqual(F.ritenute(k, null, 2026).cu.map(x => [x.cf, x.ritenute]), [['VRDLGU70A01L219X', 200]]);
  assert.deepEqual(aggiornaModello(db, S, { D }).fatto, []);   // la seconda volta non cambia niente
});
