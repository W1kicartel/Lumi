// La tesoreria: termini di pagamento, file per la banca (Ri.Ba. CBI, pain.008, pain.001), estratti conto (CAMT.053, CBI, CSV),
// scadenzario, pagamenti, riconciliazione, distinte, solleciti, previsione di cassa, strumenti di Lumi e rotte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apri, meta } from '../server/db.js';
import * as S from '../server/schema.js';
import * as D from '../server/dati.js';
import * as P from '../server/permessi.js';
import * as M from '../server/modelli.js';
import { creaServer } from '../server/api.js';
import * as R from '../server/moduli/tesoreria-regole.js';
import * as F from '../server/moduli/tesoreria-file.js';
import registraTesoreria, * as T from '../server/moduli/tesoreria.js';
import { attivaFatture, salvaAzienda, completaClienti } from '../server/moduli/documenti.js';

attivaFatture(D);
// dati inventati; IBAN con le cifre di controllo giuste (ABI 03069 e 05034 sono solo numeri di prova)
const IBAN_AZ = 'IT60X0542811101000000123456', IBAN_CL = 'IT42L1234512345123456789012', IBAN_FO = 'IT84S0542811101000000654321';
const AZ = { ragione_sociale: 'Officina Esempio srl', piva: '00743110157', codice_fiscale: '00743110157', via: 'Via Roma 1', cap: '10121', comune: 'Torino', provincia: 'TO', iban: IBAN_AZ };
class ErroreHttp extends Error { constructor(s, m, extra = {}) { super(m); this.stato = s; this.extra = extra; } }
function gestionale() {
  const db = apri(); M.installa(db, 'fatture'); completaClienti(db, S); salvaAzienda(db, meta, AZ);
  const k = { db, S, D, P, meta, ErroreHttp };
  T.prepara(k);
  const cl = D.crea(db, 'clienti', { nome: 'Bianchi Costruzioni srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: '0000000', iban: IBAN_CL, mandato_sdd: 'MAND-001', data_mandato: '2025-03-01' });
  const fattura = (data, prezzo, extra = {}, cliente = cl.id) => D.crea(db, 'fatture', { cliente, data, stato: 'emessa', righe: [{ descrizione: 'Lavoro', quantita: 1, prezzo, aliquota: 22 }], ...extra });
  return { db, k, cl, fattura };
}

test('termini di pagamento all\'italiana: mesi commerciali, fine mese, giorno fisso', () => {
  assert.deepEqual(R.leggiTermini('30/60/90 dffm'), { giorni: [30, 60, 90], fineMese: true, giornoFisso: null, testo: '30/60/90 DFFM' });
  assert.equal(R.leggiTermini('RD').giorni[0], 0);
  assert.equal(R.leggiTermini('90/60 DF'), null);   // giorni che non crescono
  assert.equal(R.leggiTermini('boh'), null);
  assert.equal(R.dataRata('2026-01-15', 30, { fineMese: true }), '2026-02-28');
  assert.equal(R.dataRata('2026-01-15', 30), '2026-02-15');
  assert.equal(R.dataRata('2026-01-15', 45), '2026-03-01');   // non multiplo di 30: giorni di calendario
  assert.equal(R.dataRata('2026-01-15', 60, { fineMese: true, giornoFisso: 10 }), '2026-04-10');
  assert.deepEqual(R.rate('2026-01-31', 10000, '30/60/90 DFFM'), [{ n: 1, data: '2026-02-28', importo: 3333 }, { n: 2, data: '2026-03-31', importo: 3333 }, { n: 3, data: '2026-04-30', importo: 3334 }]);
  assert.throws(() => R.rate('2026-01-31', 100, 'a caso'), /non validi/);
});

test('IBAN e identificativo del creditore SEPA', () => {
  assert.deepEqual(F.partiIban(IBAN_AZ), { iban: IBAN_AZ, cin: 'X', abi: '05428', cab: '11101', conto: '000000123456' });
  assert.equal(F.partiIban('IT60X0542811101000000123457'), null);   // cifre di controllo sbagliate
  assert.ok(F.idCreditoreValido('DE98ZZZ09999999999'));            // l'identificativo di prova della Bundesbank
  const id = F.idCreditore('00743110157');
  assert.match(id, /^IT\d{2}ZZZ00743110157$/); assert.ok(F.idCreditoreValido(id));
  assert.ok(!F.idCreditoreValido(id.replace('ZZZ00743110157', 'ZZZ00743110158')));
  assert.equal(F.testoSepa('Società & Figli — perché €'), 'Societa Figli perche');
});

test('Ri.Ba. CBI: record di 120 caratteri, posizioni e coda con i totali', () => {
  const ric = d => ({ importo: d, scadenza: '2026-11-30', fattura: { numero: '12', data: '2026-10-01' }, debitore: { nome: 'Bianchi Costruzioni srl', cf: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', iban: IBAN_CL } });
  const f = F.riba({ az: AZ, sia: 'A1B2C', ricevute: [ric(122000), ric(5050)], supporto: 'PROVA01', oggi: '2026-10-09' });
  assert.ok(!f.errori);
  const righe = f.testo.split('\r\n').filter(Boolean);
  assert.equal(righe.length, 2 * 7 + 2);
  for (const x of righe) assert.equal(x.length, 120, `record lungo ${x.length}: «${x}»`);
  assert.deepEqual(righe.map(x => x.slice(1, 3)), ['IB', '14', '20', '30', '40', '50', '51', '70', '14', '20', '30', '40', '50', '51', '70', 'EF']);
  const ib = righe[0], r14 = righe[1], ef = righe.at(-1);
  assert.equal(ib.slice(3, 8), 'A1B2C'); assert.equal(ib.slice(8, 13), '05428'); assert.equal(ib.slice(13, 19), '091026'); assert.equal(ib[113], 'E');
  assert.equal(r14.slice(3, 10), '0000001'); assert.equal(r14.slice(22, 28), '301126'); assert.equal(r14.slice(28, 33), '30000');
  assert.equal(r14.slice(33, 46), '0000000122000'); assert.equal(r14[46], '-');
  assert.equal(r14.slice(47, 52), '05428'); assert.equal(r14.slice(52, 57), '11101'); assert.equal(r14.slice(57, 69), '000000123456');
  assert.equal(r14.slice(69, 74), '12345'); assert.equal(r14.slice(74, 79), '12345'); assert.equal(r14.slice(91, 96), 'A1B2C'); assert.equal(r14[96], '4'); assert.equal(r14[119], 'E');
  assert.equal(ef.slice(45, 52), '0000002'); assert.equal(ef.slice(52, 67), '000000000127050'); assert.equal(ef.slice(67, 82), '0'.repeat(15)); assert.equal(ef.slice(82, 89), '0000016');
  assert.ok(righe[5].includes('PER LA FATTURA N. 12 DEL 01/10/2026 IMP 1220.00'));
  // dati mancanti: un elenco, non un file sbagliato
  const e = F.riba({ az: { ...AZ, iban: '' }, sia: '', ricevute: [{ ...ric(100), debitore: { nome: 'X', cf: '', iban: '' } }], oggi: '2026-10-09' });
  assert.deepEqual(e.errori.map(x => x.chiave).sort(), ['banca-debitore', 'cf-debitore', 'iban-azienda', 'sia']);
});

// la sequenza degli elementi come negli schemi XSD ISO 20022 (pain.008.001.02, pain.001.001.03)
const ordine = (n, attesi) => { const nomi = n.figli.map(f => f.nome); let i = 0; for (const x of nomi) { const j = attesi.indexOf(x, i); assert.ok(j >= 0, `${x} fuori posto in ${n.nome}: ${nomi.join(',')}`); i = j; } };
const benFormato = testo => { try { execFileSync('xmllint', ['--noout', '-'], { input: testo, stdio: ['pipe', 'ignore', 'pipe'] }); } catch (e) { if (e.code !== 'ENOENT') throw e; } };

test('SEPA Direct Debit pain.008.001.02: struttura, ordine degli elementi, totali', () => {
  const az = { ...AZ, idCreditore: F.idCreditore(AZ.codice_fiscale) };
  const inc = (imp, data, n) => ({ importo: imp, data, debitore: { nome: `Cliente ${n} è bravo`, iban: IBAN_CL }, mandato: { id: `M-${n}`, data: '2025-01-10' }, e2e: `FT${n}`, causale: `Fattura ${n}` });
  const f = F.pain008({ az, incassi: [inc(10000, '2026-11-02', 1), inc(2550, '2026-11-02', 2), inc(999, '2026-12-01', 3)], adesso: new Date('2026-10-09T10:00:00Z') });
  assert.ok(!f.errori); benFormato(f.testo);
  const doc = F.albero(f.testo).figli[0];
  assert.equal(doc.nome, 'Document'); assert.equal(doc.attr.xmlns, 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02');
  const init = F.figlio(doc, 'CstmrDrctDbtInitn'), gh = F.figlio(init, 'GrpHdr');
  ordine(gh, ['MsgId', 'CreDtTm', 'Authstn', 'NbOfTxs', 'CtrlSum', 'InitgPty', 'FwdgAgt']);
  assert.equal(F.testoDi(gh, 'NbOfTxs'), '3'); assert.equal(F.testoDi(gh, 'CtrlSum'), '135.49');
  const pmt = F.figli(init, 'PmtInf'); assert.equal(pmt.length, 2);   // due date di incasso
  for (const p of pmt) {
    ordine(p, ['PmtInfId', 'PmtMtd', 'BtchBookg', 'NbOfTxs', 'CtrlSum', 'PmtTpInf', 'ReqdColltnDt', 'Cdtr', 'CdtrAcct', 'CdtrAgt', 'CdtrAgtAcct', 'UltmtCdtr', 'ChrgBr', 'ChrgsAcct', 'ChrgsAcctAgt', 'CdtrSchmeId', 'DrctDbtTxInf']);
    assert.equal(F.testoDi(p, 'PmtMtd'), 'DD'); assert.equal(F.testoDi(p, 'PmtTpInf/LclInstrm/Cd'), 'CORE'); assert.equal(F.testoDi(p, 'PmtTpInf/SeqTp'), 'RCUR');
    assert.equal(F.testoDi(p, 'CdtrSchmeId/Id/PrvtId/Othr/Id'), az.idCreditore);
    for (const tx of F.figli(p, 'DrctDbtTxInf')) ordine(tx, ['PmtId', 'PmtTpInf', 'InstdAmt', 'ChrgBr', 'DrctDbtTx', 'UltmtCdtr', 'DbtrAgt', 'DbtrAgtAcct', 'Dbtr', 'DbtrAcct', 'UltmtDbtr', 'InstrForCdtrAgt', 'Purp', 'RgltryRptg', 'Tax', 'RltdRmtInf', 'RmtInf']);
  }
  assert.equal(F.testoDi(pmt[0], 'CtrlSum'), '125.50');
  assert.equal(F.testoDi(F.figli(pmt[0], 'DrctDbtTxInf')[0], 'Dbtr/Nm'), 'Cliente 1 e bravo');
  assert.equal(F.figlio(F.figli(pmt[0], 'DrctDbtTxInf')[0], 'InstdAmt').attr.Ccy, 'EUR');
  assert.deepEqual(F.pain008({ az: { ...az, idCreditore: 'IT00ZZZ1' }, incassi: [{ ...inc(1, '2026-11-02', 1), mandato: {} }] }).errori.map(x => x.chiave), ['id-creditore', 'mandato']);
});

test('bonifici SEPA pain.001.001.03: struttura, ordine degli elementi, totali', () => {
  const f = F.pain001({ az: AZ, adesso: new Date('2026-10-09T10:00:00Z'), bonifici: [{ importo: 48800, data: '2026-10-15', beneficiario: { nome: 'Ferramenta Verdi', iban: IBAN_FO }, e2e: 'FT-88', causale: 'Saldo fattura 88' }] });
  assert.ok(!f.errori); benFormato(f.testo);
  const init = F.figlio(F.albero(f.testo).figli[0], 'CstmrCdtTrfInitn'), p = F.figlio(init, 'PmtInf');
  assert.equal(F.albero(f.testo).figli[0].attr.xmlns, 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03');
  ordine(p, ['PmtInfId', 'PmtMtd', 'BtchBookg', 'NbOfTxs', 'CtrlSum', 'PmtTpInf', 'ReqdExctnDt', 'PoolgAdjstmntDt', 'Dbtr', 'DbtrAcct', 'DbtrAgt', 'DbtrAgtAcct', 'UltmtDbtr', 'ChrgBr', 'ChrgsAcct', 'ChrgsAcctAgt', 'CdtTrfTxInf']);
  ordine(F.figlio(p, 'CdtTrfTxInf'), ['PmtId', 'PmtTpInf', 'Amt', 'XchgRateInf', 'ChrgBr', 'UltmtDbtr', 'IntrmyAgt1', 'CdtrAgt', 'CdtrAgtAcct', 'Cdtr', 'CdtrAcct', 'UltmtCdtr', 'InstrForCdtrAgt', 'InstrForDbtrAgt', 'Purp', 'RgltryRptg', 'Tax', 'RltdRmtInf', 'RmtInf']);
  assert.equal(F.testoDi(p, 'PmtMtd'), 'TRF'); assert.equal(F.testoDi(p, 'DbtrAgt/FinInstnId/Othr/Id'), 'NOTPROVIDED');
  assert.equal(F.testoDi(p, 'CdtTrfTxInf/Amt/InstdAmt'), '488.00'); assert.equal(F.testoDi(init, 'GrpHdr/CtrlSum'), '488.00');
  assert.deepEqual(F.pain001({ az: AZ, bonifici: [{ importo: 1, data: '2026-10-15', beneficiario: { nome: 'X', iban: 'IT00' } }] }).errori.map(x => x.chiave), ['iban-beneficiario']);
});

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>E1</MsgId><CreDtTm>2026-10-08T18:00:00</CreDtTm></GrpHdr>
<Stmt><Id>S1</Id><Acct><Id><IBAN>${IBAN_AZ}</IBAN></Id></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-01</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1732.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-08</Dt></Dt></Bal>
<Ntry><NtryRef>1</NtryRef><Amt Ccy="EUR">1220.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-05</Dt></BookgDt><ValDt><Dt>2026-10-05</Dt></ValDt><AcctSvcrRef>BANCA-0001</AcctSvcrRef>
 <NtryDtls><TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs><RltdPties><Dbtr><Nm>BIANCHI COSTRUZIONI SRL</Nm></Dbtr><DbtrAcct><Id><IBAN>${IBAN_CL}</IBAN></Id></DbtrAcct></RltdPties>
 <RmtInf><Ustrd>SALDO FT 1/2026 &amp; ACCONTI</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">488.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-06</Dt></BookgDt><AcctSvcrRef>BANCA-0002</AcctSvcrRef>
 <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Ferramenta Verdi</Nm></Cdtr><CdtrAcct><Id><IBAN>${IBAN_FO}</IBAN></Id></CdtrAcct></RltdPties><RmtInf><Ustrd>Fattura 88</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-07</Dt></BookgDt><AcctSvcrRef>BANCA-0003</AcctSvcrRef><AddtlNtryInf>COMMISSIONI</AddtlNtryInf></Ntry>
<Ntry><Amt Ccy="EUR">99.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-10-08</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

test('estratti conto: CAMT.053, CBI «RH», CSV con dare e avere', () => {
  const c = F.leggiEstratto(Buffer.from(CAMT), 'estratto.xml');
  assert.equal(c.movimenti.length, 3);   // quello «PDNG» non è contabilizzato
  assert.deepEqual(c.movimenti[0], { data: '2026-10-05', valuta_il: '2026-10-05', importo: 122000, descrizione: 'SALDO FT 1/2026 & ACCONTI', controparte: 'BIANCHI COSTRUZIONI SRL', iban: IBAN_CL, riferimento: '', conto: IBAN_AZ, id_esterno: 'BANCA-0001', fonte: 'camt053' });
  assert.equal(c.movimenti[1].importo, -48800); assert.equal(c.movimenti[1].controparte, 'Ferramenta Verdi'); assert.equal(c.movimenti[2].descrizione, 'COMMISSIONI');
  assert.deepEqual(c.saldi.map(s => [s.tipo, s.importo]), [['OPBD', 100000], ['CLBD', 173200]]);
  const rh = [' RH' + 'X'.repeat(117), ' 620000001001051026051026C000000001220,0048' + ' '.repeat(18) + 'RIF0000000000001' + ' '.repeat(9) + 'BONIFICO DA BIANCHI'.padEnd(34),
    ' 630000001001' + 'SALDO FATTURA 1/2026'.padEnd(107), ' EF'.padEnd(120)].join('\r\n');
  const b = F.leggiEstratto(Buffer.from(rh, 'latin1'), 'estratto.cbi');
  assert.equal(b.movimenti.length, 1); assert.equal(b.movimenti[0].importo, 122000); assert.equal(b.movimenti[0].data, '2026-10-05');
  assert.equal(b.movimenti[0].descrizione, 'BONIFICO DA BIANCHI SALDO FATTURA 1/2026'); assert.equal(b.movimenti[0].riferimento, 'RIF0000000000001');
  const csv = 'Data contabile;Data valuta;Dare;Avere;Descrizione operazione\n05/10/2026;05/10/2026;;1.220,00;BONIFICO DA BIANCHI COSTRUZIONI FT 1\n06/10/2026;06/10/2026;488,00;;BONIFICO A FERRAMENTA VERDI\nsaldo;;;;\n';
  const v = F.leggiEstratto(Buffer.from(csv), 'lista.csv');
  assert.deepEqual(v.movimenti.map(m => [m.data, m.importo]), [['2026-10-05', 122000], ['2026-10-06', -48800]]); assert.deepEqual(v.scartate, [4]);
  assert.throws(() => F.leggiEstratto(Buffer.from('a;b\n1;2\n'), 'x.csv'), /data e dell'importo/);
});

test('abbinamento: importo, numero di fattura, nome, IBAN; più fatture in un bonifico; distinte', () => {
  const sc = [
    { chiave: 'a', verso: 'attiva', residuo: 122000, numero: '1', data: '2026-10-01', controparte: 'Bianchi Costruzioni srl', controparteId: 'c1', iban: IBAN_CL, descrizione: 'Fattura 1' },
    { chiave: 'b', verso: 'attiva', residuo: 122000, numero: '2', data: '2026-10-01', controparte: 'Rossi Impianti snc', controparteId: 'c2', iban: '', descrizione: 'Fattura 2' },
    { chiave: 'c', verso: 'attiva', residuo: 30000, numero: '3', data: '2026-09-01', controparte: 'Rossi Impianti snc', controparteId: 'c2', iban: '', descrizione: 'Fattura 3' },
    { chiave: 'd', verso: 'attiva', residuo: 20000, numero: '4', data: '2026-09-15', controparte: 'Rossi Impianti snc', controparteId: 'c2', iban: '', descrizione: 'Fattura 4' }];
  assert.ok(R.citaNumero('SALDO FT 1/2026', '1')); assert.ok(R.citaNumero('pagamento fattura n.12', '12/B')); assert.ok(!R.citaNumero('pagamento fattura n.12', '1'));
  const p = R.proposte({ importo: 122000, data: '2026-10-05', descrizione: 'SALDO FT 1/2026', controparte: 'BIANCHI COSTRUZIONI SRL', iban: IBAN_CL }, sc);
  assert.deepEqual(p[0].chiavi, ['a']); assert.ok(p[0].punti >= 90); assert.ok(p[0].perche.includes('iban'));
  const q = R.proposte({ importo: 50000, data: '2026-10-05', descrizione: 'BONIFICO ROSSI IMPIANTI', controparte: '' }, sc);
  assert.deepEqual(q[0].chiavi.sort(), ['c', 'd']); assert.ok(q[0].perche.includes('somma'));
  const d = R.proposte({ importo: 172000, data: '2026-10-05', descrizione: 'ACCREDITO EFFETTI SBF' }, sc, [{ id: 'X', nome: 'Ri.Ba. n. 1', totale: 172000, aperte: ['b', 'c', 'd'] }]);
  assert.equal(d[0].distinta, 'X');
  assert.deepEqual(R.proposte({ importo: -122000, data: '2026-10-05', descrizione: 'x' }, sc), []);   // un'uscita non paga le fatture dei clienti
});

test('solleciti, ritardo medio e previsione di cassa (regole)', () => {
  assert.equal(R.livelloSollecito(3, [], '2026-10-09'), 0);
  assert.equal(R.livelloSollecito(10, [], '2026-10-09'), 1);
  assert.equal(R.livelloSollecito(40, [], '2026-10-09'), 2);
  assert.equal(R.livelloSollecito(40, [{ data: '2026-10-01', livello: 1 }], '2026-10-09'), -1);   // sollecitato 8 giorni fa
  assert.equal(R.livelloSollecito(70, [{ data: '2026-09-01', livello: 3 }], '2026-10-09'), 3);
  assert.equal(R.ritardoMedio([{ data: '2026-01-31', pagata_il: '2026-02-20' }, { data: '2026-02-28', pagata_il: '2026-02-20' }]), 10);
  const p = R.previsione({ saldo: 100000, da: '2026-10-07', periodi: 3, passo: 'settimana', voci: [
    { data: '2026-09-01', importo: 50000 }, { data: '2026-10-13', importo: -200000 }, { data: '2026-10-20', importo: 30000 }, { data: '2027-01-01', importo: 1 }] });
  assert.deepEqual(p.periodi.map(x => [x.da, x.a, x.entrate, x.uscite, x.saldo]), [['2026-10-05', '2026-10-11', 50000, 0, 150000], ['2026-10-12', '2026-10-18', 0, 200000, -50000], ['2026-10-19', '2026-10-25', 30000, 0, -20000]]);
  assert.deepEqual(p.minimo, { saldo: -50000, data: '2026-10-18' }); assert.equal(p.scoperto, true); assert.equal(p.oltre, 1);
  assert.deepEqual(R.ripeti('2026-01-31', 'mensile', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('scadenzario dalle fatture: rate vere, termini del cliente, pagamenti e riapertura', () => {
  const { db, k, cl, fattura } = gestionale();
  const ctx = null;
  const f1 = fattura('2026-09-01', 1000, { scadenza: '2026-10-01' });                    // 1220 € con la scadenza
  D.modifica(db, 'clienti', cl.id, { termini_pagamento: '30/60 DFFM' });
  const f2 = fattura('2026-09-10', 500);                                                   // 610 € in due rate dai termini
  const f3 = D.crea(db, 'fatture', { cliente: cl.id, data: '2026-09-20', stato: 'bozza', condizioni: 'TP01', righe: [{ descrizione: 'X', quantita: 1, prezzo: 100, aliquota: 22 }], rate: [{ data: '2026-10-20', importo: 61 }, { data: '2026-11-20', importo: 61 }] });
  D.modifica(db, 'fatture', f3.id, { stato: 'emessa' });
  D.crea(db, 'fatture', { cliente: cl.id, data: '2026-09-25', stato: 'bozza', righe: [{ descrizione: 'Bozza', quantita: 1, prezzo: 10, aliquota: 22 }] });
  const fo = D.crea(db, 'fornitori', { nome: 'Ferramenta Verdi', iban: IBAN_FO, termini_pagamento: '30 DF' });
  const ric = D.crea(db, 'fatture_ricevute', { fornitore: fo.id, numero: '88', data: '2026-09-15', totale: 488, imponibile: 400, imposta: 88 });
  const sc = T.scadenzario(k, ctx, { oggi: '2026-10-09' });
  const att = sc.filter(s => s.verso === 'attiva');
  assert.deepEqual(att.map(s => [s.chiave.split(':')[0], s.data, s.importo]), [['f', '2026-10-01', 122000], ['r', '2026-10-20', 6100], ['f', '2026-10-31', 30500], ['r', '2026-11-20', 6100], ['f', '2026-11-30', 30500]]);
  assert.equal(att[0].scaduta, true); assert.equal(att[0].ritardo, 8); assert.equal(att[2].termini, '30/60 DFFM');
  const pas = sc.find(s => s.verso === 'passiva');
  assert.deepEqual([pas.chiave, pas.data, pas.importo, pas.iban], [`p:${ric.id}:1`, '2026-10-15', 48800, IBAN_FO]);
  // acconto, poi saldo: la fattura diventa «pagata» con la data dell'ultimo pagamento
  T.registraPagamenti(k, ctx, [`f:${f1.id}:1`], { data: '2026-10-03', importo: 200 });
  let s1 = T.scadenzario(k, ctx, { oggi: '2026-10-09' }).find(s => s.chiave === `f:${f1.id}:1`);
  assert.equal(s1.stato, 'parziale'); assert.equal(s1.residuo, 102000);
  T.registraPagamenti(k, ctx, [`f:${f1.id}:1`], { data: '2026-10-05' });
  assert.equal(D.leggi(db, 'fatture', f1.id).stato, 'pagata'); assert.equal(D.leggi(db, 'fatture', f1.id).pagata_il, '2026-10-05');
  // le rate vere: «pagata» sulla rata (permesso anche a fattura emessa), e alla fine la fattura
  const rate3 = att.filter(s => s.origine.id === f3.id).map(s => s.chiave);
  T.registraPagamenti(k, ctx, rate3, { data: '2026-10-08' });
  assert.ok(D.leggi(db, 'fatture', f3.id).rate.every(r => r.pagata)); assert.equal(D.leggi(db, 'fatture', f3.id).stato, 'pagata');
  // annulla: la fattura torna emessa
  T.annullaPagamento(k, ctx, `f:${f1.id}:1`);
  assert.equal(D.leggi(db, 'fatture', f1.id).stato, 'emessa');
  s1 = T.scadenzario(k, ctx, { oggi: '2026-10-09' }).find(s => s.chiave === `f:${f1.id}:1`); assert.equal(s1.residuo, 122000);
  assert.throws(() => T.registraPagamenti(k, ctx, ['f:nessuna:1']), /sconosciuta/);
  // la fattura ricevuta pagata
  T.registraPagamenti(k, ctx, [pas.chiave], { data: '2026-10-06' });
  assert.equal(D.leggi(db, 'fatture_ricevute', ric.id).stato, 'pagata');
  assert.equal(T.riepilogo(T.scadenzario(k, ctx, { oggi: '2026-10-09' }).filter(s => s.residuo > 0)).daPagare, 0);
  void f2;
});

test('estratto conto → movimenti → proposte → abbina, ignora, disabbina; distinte Ri.Ba., SDD e bonifici', () => {
  const { db, k, cl, fattura } = gestionale();
  const ctx = null;
  const f1 = fattura('2026-09-01', 1000, { scadenza: '2026-10-01', numero: '1' });
  const fo = D.crea(db, 'fornitori', { nome: 'Ferramenta Verdi', iban: IBAN_FO });
  D.crea(db, 'fatture_ricevute', { fornitore: fo.id, numero: '88', data: '2026-09-15', scadenza: '2026-10-15', totale: 488 });
  const imp = T.importaEstratto(k, ctx, Buffer.from(CAMT), 'estratto.xml');
  assert.deepEqual([imp.importati, imp.doppi, imp.formato], [3, 0, 'camt053']);
  assert.deepEqual(imp.saldo, { importo: 1732, data: '2026-10-08' });
  assert.equal(T.importaEstratto(k, ctx, Buffer.from(CAMT), 'estratto.xml').doppi, 3);   // la seconda volta niente doppioni
  const b = T.banca(k, ctx, { oggi: '2026-10-09' });
  assert.equal(b.daAbbinare.length, 3);
  const entrata = b.daAbbinare.find(m => m.importo === 1220), uscita = b.daAbbinare.find(m => m.importo === -488), spese = b.daAbbinare.find(m => m.importo === -5);
  assert.deepEqual(entrata.proposte[0].chiavi, [`f:${f1.id}:1`]); assert.ok(entrata.proposte[0].punti >= 90);
  assert.equal(uscita.proposte[0].chiavi[0].split(':')[0], 'p');
  T.abbina(k, ctx, entrata.id, entrata.proposte[0].chiavi);
  assert.equal(D.leggi(db, 'fatture', f1.id).stato, 'pagata'); assert.equal(D.leggi(db, 'fatture', f1.id).pagata_il, '2026-10-05');
  assert.equal(D.leggi(db, 'movimenti_banca', entrata.id).stato, 'abbinato');
  assert.throws(() => T.abbina(k, ctx, entrata.id, entrata.proposte[0].chiavi), /già abbinato/);
  assert.throws(() => T.abbina(k, ctx, uscita.id, [`f:${f1.id}:1`]), /fornitori/);
  T.ignora(k, ctx, spese.id); assert.equal(D.leggi(db, 'movimenti_banca', spese.id).stato, 'ignorato');
  assert.equal(T.banca(k, ctx).daAbbinare.length, 1);
  T.disabbina(k, ctx, entrata.id);
  assert.equal(D.leggi(db, 'fatture', f1.id).stato, 'emessa'); assert.equal(D.leggi(db, 'movimenti_banca', entrata.id).stato, 'da_abbinare');
  // distinte: prima mancano SIA e identificativo creditore… poi il file
  const chiave = `f:${f1.id}:1`;
  assert.deepEqual(T.creaDistinta(k, ctx, { tipo: 'riba', chiavi: [chiave] }).errori.map(e => e.chiave), ['sia']);
  T.salvaImpostazioni(db, meta, { sia: 'A1B2C' });
  const d = T.creaDistinta(k, ctx, { tipo: 'riba', chiavi: [chiave], adesso: new Date('2026-10-09T09:00:00Z') });
  assert.equal(d.totale, 1220); assert.equal(d.file, 'RIBA_20261009_1.txt');
  assert.throws(() => T.creaDistinta(k, ctx, { tipo: 'riba', chiavi: [chiave] }), /già nella distinta/);
  assert.equal(T.scadenzario(k, ctx).find(s => s.chiave === chiave).distinta.id, d.id);
  // l'accredito della distinta si propone da solo
  const e2 = T.banca(k, ctx).daAbbinare.find(m => m.id === entrata.id);
  assert.equal(e2.proposte[0].distinta, d.id);
  T.abbina(k, ctx, entrata.id, e2.proposte[0].chiavi, { distinta: d.id });
  assert.equal(T.distinte(db)[0].incassata, '2026-10-05');
  const sdd = T.creaDistinta(k, ctx, { tipo: 'sdd', chiavi: [`f:${fattura('2026-10-01', 100, { scadenza: '2026-11-02' }).id}:1`] });
  assert.ok(sdd.file.startsWith('SDD_')); assert.ok(db.prepare('SELECT file FROM _tesoreria_distinte WHERE id = ?').get(sdd.id).file.includes('<MndtId>MAND-001</MndtId>'));
  const sct = T.creaDistinta(k, ctx, { tipo: 'sct', chiavi: [T.scadenzario(k, ctx).find(s => s.verso === 'passiva').chiave], data: '2026-10-15' });
  assert.ok(db.prepare('SELECT file FROM _tesoreria_distinte WHERE id = ?').get(sct.id).file.includes(`<IBAN>${IBAN_FO}</IBAN>`));
  assert.throws(() => T.creaDistinta(k, ctx, { tipo: 'sct', chiavi: [chiave] }), /non adatta/);
  void cl;
});

test('solleciti e previsione di cassa dal gestionale', async () => {
  const { db, k, fattura } = gestionale();
  const ctx = null;
  fattura('2026-07-01', 1000, { scadenza: '2026-08-01' });   // 69 giorni di ritardo al 9 ottobre
  const s = T.solleciti(k, ctx, { oggi: '2026-10-09' });
  assert.equal(s.length, 1); assert.equal(s[0].livello, 3); assert.equal(s[0].totale, 1220);
  assert.ok(s[0].testo.includes('€ 1.220,00')); assert.ok(s[0].testo.includes(IBAN_AZ)); assert.ok(s[0].testo.includes('D.Lgs. 231/2002'));
  T.registraSollecito(k, ctx, { cliente: s[0].cliente, livello: 3, oggi: '2026-10-09' });
  assert.equal(T.solleciti(k, ctx, { oggi: '2026-10-12' })[0].livello, -1);   // appena sollecitato
  T.salvaImpostazioni(db, meta, { saldo: 1000, saldoData: '2026-10-01' });
  D.crea(db, 'previsioni_cassa', { descrizione: 'Affitto', tipo: 'uscita', importo: 800, data: '2026-10-10', ripeti: 'mensile' });
  const p = await T.previsioneCassa(k, ctx, { passo: 'mese', periodi: 3, oggi: '2026-10-09' });
  assert.equal(p.saldoIniziale, 1000);
  // a novembre anche l'F24 dell'IVA del terzo trimestre (dal modulo fisco): 220 € più l'1% dei trimestrali
  assert.deepEqual(p.periodi.map(x => [x.da, x.entrate, x.uscite]), [['2026-10-01', 1220, 800], ['2026-11-01', 0, 1022.2], ['2026-12-01', 0, 800]]);
  assert.ok(p.voci.some(v => v.tipo === 'tasse' && v.data === '2026-11-16' && v.importo === -222.2));
  assert.equal(p.saldoFinale, 1000 + 1220 - 2400 - 222.2); assert.equal(p.scoperto, true);
});

test('strumenti di Lumi: registrati, letture, anteprima e scrittura', async () => {
  const strumenti = [];
  const { db, k, fattura } = gestionale();
  registraTesoreria({ ...k, r: () => {}, serve: x => x, lumi: { strumento: s => strumenti.push(s), istruzioni: () => {} } });
  const nomi = strumenti.map(s => s.nome);
  assert.deepEqual(nomi, ['tesoreria_scadenzario', 'tesoreria_previsione_cassa', 'tesoreria_solleciti', 'tesoreria_segna_pagata', 'tesoreria_abbina_movimento', 'tesoreria_termini']);
  for (const s of strumenti) if (s.tipo === 'scrivi') assert.equal(typeof s.anteprima, 'function');
  const f = fattura('2026-09-01', 1000, { scadenza: '2026-10-01' });
  const prendi = n => strumenti.find(s => s.nome === n);
  const l = await prendi('tesoreria_scadenzario').esegui({ ctx: null, args: { verso: 'attiva', solo_scadute: true } });
  assert.equal(l.scadenze.length, 1); assert.equal(l.totali.daIncassare, 1220);
  const numero = D.leggi(db, 'fatture', f.id).numero;
  const a = await prendi('tesoreria_segna_pagata').anteprima({ ctx: null, args: { numero_fattura: numero, verso: 'attiva' } });
  assert.equal(a.titolo, 'Registra un incasso'); assert.ok(a.righe.some(r => r[1] === '€ 1220.00'));
  await prendi('tesoreria_segna_pagata').esegui({ ctx: null, args: { numero_fattura: numero, verso: 'attiva', data: '2026-10-02' } });
  assert.equal(D.leggi(db, 'fatture', f.id).stato, 'pagata');
  assert.deepEqual((await prendi('tesoreria_termini').esegui({ args: { termini: '30/60 DFFM', data: '2026-01-15', importo: 100 } })).rate.map(r => r.data), ['2026-02-28', '2026-03-31']);
  const ctxBanco = { utente: { id: 'x' }, r: { id: 'banco', permessi: { entita: { clienti: { leggi: true } } } } };
  assert.equal(prendi('tesoreria_segna_pagata').permesso(ctxBanco), P.puo(ctxBanco, 'fatture', 'modifica') || P.puo(ctxBanco, 'fatture_ricevute', 'modifica'));
});

test('API: prepara, impostazioni, scadenze, estratto, banca, distinta da scaricare, permessi', async () => {
  const cartella = mkdtempSync(join(tmpdir(), 'kubo-tesoreria-')), db = apri(join(cartella, 'kubo.db'));
  const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch { json = null; }
    return { stato: r.status, tipo: r.headers.get('content-type'), json, buf };
  };
  try {
    assert.equal((await chiama('POST', '/api/configura', { azienda: 'Officina Esempio', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['fatture'] })).stato, 200);
    await chiama('PUT', '/api/documenti/azienda', AZ);
    assert.deepEqual((await chiama('POST', '/api/tesoreria/prepara')).json.fatto.slice(0, 2), ['movimenti_banca', 'previsioni_cassa']);
    assert.deepEqual((await chiama('POST', '/api/tesoreria/prepara')).json.fatto, []);
    assert.equal((await chiama('PUT', '/api/tesoreria/impostazioni', { sia: 'troppo-lungo' })).stato, 422);
    const imp = (await chiama('PUT', '/api/tesoreria/impostazioni', { sia: 'a1b2c' })).json;
    assert.equal(imp.sia, 'A1B2C'); assert.ok(F.idCreditoreValido(imp.idCreditoreProposto));
    const cl = (await chiama('POST', '/api/dati/clienti', { nome: 'Bianchi Costruzioni srl', piva: '00743110157', iban: IBAN_CL, via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO' })).json;
    assert.equal((await chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', scadenza: '2026-10-01', stato: 'emessa', righe: [{ descrizione: 'Lavoro', quantita: 1, prezzo: 1000, aliquota: 22 }] })).stato, 200);
    const sc = (await chiama('GET', '/api/tesoreria/scadenze?verso=attiva')).json;
    assert.equal(sc.scadenze.length, 1); assert.equal(sc.riepilogo.daIncassare, 1220);
    const d = await chiama('POST', '/api/tesoreria/distinte', { tipo: 'riba', chiavi: [sc.scadenze[0].chiave] });
    assert.equal(d.stato, 200);
    const file = await chiama('GET', `/api/tesoreria/distinte/${d.json.id}/file`);
    assert.match(file.tipo, /text\/plain/); assert.equal(file.buf.toString().split('\r\n')[0].slice(1, 3), 'IB');
    assert.equal((await chiama('POST', '/api/tesoreria/distinte', { tipo: 'sdd', chiavi: [sc.scadenze[0].chiave] })).stato, 422);   // già in distinta
    const e = await chiama('POST', '/api/tesoreria/estratto', { nome: 'estratto.xml', dati: Buffer.from(CAMT).toString('base64') });
    assert.equal(e.json.importati, 3);
    const b = (await chiama('GET', '/api/tesoreria/banca')).json;
    assert.equal(b.daAbbinare.length, 3);
    const m = b.daAbbinare.find(x => x.importo === 1220);
    assert.equal((await chiama('POST', '/api/tesoreria/abbina', { movimento: m.id, chiavi: m.proposte[0].chiavi, distinta: m.proposte[0].distinta })).stato, 200);
    assert.equal((await chiama('GET', '/api/tesoreria/scadenze?verso=attiva')).json.scadenze.length, 0);
    assert.equal((await chiama('GET', '/api/tesoreria/previsione?passo=mese')).stato, 200);
    assert.equal((await chiama('GET', '/api/tesoreria/termini?termini=30%20DFFM&data=2026-01-15&importo=10')).json[0].data, '2026-02-28');
    assert.equal((await chiama('GET', '/api/tesoreria/termini?termini=boh')).stato, 422);
    const lumi = (await chiama('GET', '/api/lumi/strumenti')).json.strumenti.map(s => s.nome);
    assert.ok(lumi.includes('tesoreria_scadenzario') && lumi.includes('tesoreria_abbina_movimento'));
    // chi vede le fatture ma non le modifica legge lo scadenzario e non incassa (nemmeno un acconto)
    assert.equal((await chiama('PUT', '/api/ruoli/lettore', { nome: 'Lettore', entita: { fatture: { leggi: true }, clienti: { leggi: true }, rate_fattura: { leggi: true } } })).stato, 200);
    assert.equal((await chiama('POST', '/api/utenti', { nome: 'Lettore', email: 'l@prova.it', password: 'password-lunga-2', ruolo: 'lettore' })).stato, 200);
    const fx = (await chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-02', scadenza: '2026-10-02', stato: 'emessa', righe: [{ descrizione: 'Altro', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
    const titolare = biscotto;
    biscotto = ''; assert.equal((await chiama('POST', '/api/accedi', { email: 'l@prova.it', password: 'password-lunga-2' })).stato, 200);
    assert.equal((await chiama('GET', '/api/tesoreria/scadenze?verso=attiva')).json.scadenze.length, 1);
    assert.equal((await chiama('POST', '/api/tesoreria/pagamenti', { chiavi: [`f:${fx.id}:1`], importo: 10 })).stato, 403);
    assert.equal((await chiama('POST', '/api/tesoreria/distinte', { tipo: 'riba', chiavi: [`f:${fx.id}:1`] })).stato, 403);
    biscotto = titolare;
    // chi non vede le fatture non vede la tesoreria
    assert.equal((await chiama('PUT', '/api/ruoli/banco', { nome: 'Banco', entita: { clienti: { leggi: true } } })).stato, 200);
    assert.equal((await chiama('POST', '/api/utenti', { nome: 'Banco', email: 'b@prova.it', password: 'password-lunga-1', ruolo: 'banco' })).stato, 200);
    biscotto = ''; assert.equal((await chiama('POST', '/api/accedi', { email: 'b@prova.it', password: 'password-lunga-1' })).stato, 200);
    assert.equal((await chiama('GET', '/api/tesoreria/scadenze')).stato, 403);
    assert.equal((await chiama('PUT', '/api/tesoreria/impostazioni', { sia: 'ZZZZZ' })).stato, 403);
  } finally { srv.close(); }
});
