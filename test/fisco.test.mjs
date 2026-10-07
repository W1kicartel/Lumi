// Il fisco: regole (date, codici, soglie, conti), liquidazione IVA, LIPE, forfettario, F24, ritenute, pacchetto e strumenti di Lumi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apri, meta } from '../server/db.js';
import * as S from '../server/schema.js';
import * as D from '../server/dati.js';
import * as P from '../server/permessi.js';
import * as M from '../server/modelli.js';
import { creaServer } from '../server/api.js';
import * as R from '../server/moduli/fisco-regole.js';
import { lipe, pdfTesto, NS_LIPE } from '../server/moduli/fisco-file.js';
import registraFisco, * as F from '../server/moduli/fisco.js';
import { attivaFatture, salvaAzienda, completaClienti } from '../server/moduli/documenti.js';
import { leggiZip } from '../server/moduli/import-formati.js';

attivaFatture(D);
const AZ = { ragione_sociale: 'Mario Rossi', piva: '00743110157', codice_fiscale: 'RSSMRA85T10A562S', via: 'Via Roma 1', cap: '10121', comune: 'Torino', provincia: 'TO' };
class ErroreHttp extends Error { constructor(s, m) { super(m); this.stato = s; } }
function gestionale({ regime = 'RF01', fisco = {} } = {}) {
  const db = apri(); M.installa(db, 'fatture'); completaClienti(db, S); salvaAzienda(db, meta, { ...AZ, regime });
  const k = { db, S, D, P, meta, ErroreHttp };
  S.applica(db, F.SEZIONE_RICEVUTE); F.salvaImpostazioni(db, meta, fisco);
  const cl = D.crea(db, 'clienti', { nome: 'Bianchi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: '0000000' });
  const fattura = (data, prezzo, extra = {}) => D.crea(db, 'fatture', { cliente: cl.id, data, stato: 'emessa', righe: [{ descrizione: 'Lavoro', quantita: 1, prezzo, aliquota: regime === 'RF19' ? 0 : 22, ...(regime === 'RF19' ? { natura: 'N2.2' } : {}) }], ...extra });
  return { db, k, fattura };
}

const reg0 = db => D.elenca(db, 'clienti', {}).righe[0].id;

test('date: sabato, domenica e festivi slittano al primo giorno lavorativo', () => {
  assert.equal(R.lavorativo('2026-05-16'), '2026-05-18');   // sabato
  assert.equal(R.lavorativo('2026-05-31'), '2026-06-01');   // domenica (LIPE del primo trimestre 2026)
  assert.equal(R.lavorativo('2026-04-06'), '2026-04-07');   // lunedì dell'Angelo 2026
  assert.equal(R.lavorativo('2026-06-02'), '2026-06-03');   // festa della Repubblica
  assert.equal(R.scad(2027, 2, 29), '2027-03-01');          // «fine febbraio» in un anno non bisestile, poi lunedì
  assert.equal(R.scadenzaIva('trimestrale', 2026, 2), '2026-08-20');
  assert.equal(R.scadenzaIva('mensile', 2026, 12), '2027-01-18');
  assert.equal(R.scadenzaRitenuta('2026-03-10'), '2026-04-16');
});

test('coefficienti di redditività dal codice ATECO (allegato 4 L. 190/2014)', () => {
  assert.equal(R.coefficienteAteco('69.20.11').coeff, 78);   // commercialisti
  assert.equal(R.coefficienteAteco('62.01.00').coeff, 67);   // programmazione: «altre attività»
  assert.equal(R.coefficienteAteco('46.18.99').coeff, 62);   // intermediari del commercio
  assert.equal(R.coefficienteAteco('46.90').coeff, 40);      // ingrosso
  assert.equal(R.coefficienteAteco('47.81').coeff, 40);
  assert.equal(R.coefficienteAteco('47.89.01').coeff, 54);
  assert.equal(R.coefficienteAteco('43.21.01').coeff, 86);
  assert.equal(R.coefficienteAteco('56.10').coeff, 40);
  assert.equal(R.coefficienteAteco('x'), null);
});

test('liquidazione trimestrale: 1% di interessi, riporto sotto 100 €, credito, acconto e saldo 6099', () => {
  const l = R.liquida({ periodicita: 'trimestrale', anno: 2026, acconto: 200, periodi: [{ ivaVendite: 2200, ivaAcquisti: 500 }, { ivaVendite: 100, ivaAcquisti: 50 }, { ivaVendite: 100, ivaAcquisti: 900 }, { ivaVendite: 3000, ivaAcquisti: 0 }] });
  const [q1, q2, q3, q4] = l.periodi;
  assert.deepEqual([q1.interessi, q1.daVersare, q1.codice, q1.scadenza], [17, 1717, '6031', '2026-05-18']);
  assert.deepEqual([q2.riportato, q2.daVersare, q2.interessi], [true, 0, 0]);          // 50 € si riportano
  assert.equal(q3.debitoPrecedente, 50); assert.equal(q3.importoACredito, 750);      // 100 − 900 + 50
  assert.equal(q4.creditoPeriodoPrecedente, 750);
  assert.equal(q4.acconto, 200); assert.equal(q4.codice, '6099'); assert.equal(q4.scadenza, '2027-03-16');
  assert.equal(q4.daVersare, 2050 + 22.5);   // (3000 − 750 − 200) + 1% sul dovuto del quarto trimestre
  const m = R.liquida({ periodicita: 'mensile', anno: 2026, creditoAnnoPrecedente: 300, periodi: [{ ivaVendite: 1000 }] });
  assert.deepEqual([m.periodi[0].creditoAnnoPrecedente, m.periodi[0].daVersare, m.periodi[0].codice, m.periodi[0].interessi], [300, 700, '6001', 0]);
});

test('acconto IVA: 88% storico o previsionale, il minore; niente sotto 103,29 €', () => {
  const a = R.accontoIva({ periodicita: 'trimestrale', anno: 2026, storico: 1000, previsto: 500 });
  assert.deepEqual([a.scelto.metodo, a.importo, a.codice, a.scadenza], ['previsionale', 440, '6035', '2026-12-28']);
  assert.equal(R.accontoIva({ periodicita: 'mensile', anno: 2026, storico: 100 }).dovuto, false);
});

test('forfettario: reddito, INPS, imposta 5/15%, acconti e soglie', () => {
  const f = R.forfettario({ anno: 2026, incassato: 70000, coefficiente: 78, gestione: 'separata', impostaAnnoPrecedente: 3000 });
  assert.equal(f.redditoLordo, 54600);
  assert.equal(f.inps.totale, 14234.22);                         // 26,07% di 54.600
  assert.equal(f.imposta, Math.round((54600 - 14234.22) * 15) / 100);
  assert.ok(f.avvisi.includes('vicino-85') && f.avvisi.includes('contributi-stimati'));
  assert.deepEqual(f.accontiQuestAnno.map(x => [x.codice, x.importo, x.scadenza]), [['1790', 1500, '2026-07-20'], ['1791', 1500, '2026-11-30']]);
  const art = R.contributiInps({ gestione: 'artigiani', reddito: 30000, riduzione35: true });
  assert.equal(art.fissi, 2938.65); assert.equal(art.eccedenza, Math.round((30000 - 18808) * 24 * 0.65) / 100);
  assert.equal(R.forfettario({ anno: 2026, incassato: 101000, aliquotaRidotta: true }).aliquota, 5);
  assert.ok(R.forfettario({ anno: 2026, incassato: 101000 }).avvisi.includes('oltre-100'));
  assert.deepEqual(R.accontiForfettario(50, 2026), []);
  assert.deepEqual(R.accontiForfettario(200, 2026).map(x => x.codice), ['1791']);
});

test('bollo virtuale: codici 2521-2524 e rinvio sotto 5.000 €', () => {
  const b = R.bolli(2026, { 1: 40, 2: 30, 4: 6 });
  assert.deepEqual(b.map(x => [x.codice, x.scadenza]), [['2521', '2026-11-30'], ['2522', '2026-11-30'], ['2524', '2027-03-01']]);
  assert.equal(R.bolli(2026, { 1: 6000 })[0].scadenza, '2026-06-01');
});

test('LIPE: XML nell\'ordine delle specifiche IVP18, importi con la virgola, quarto trimestre = 5', () => {
  const l = R.liquida({ periodicita: 'trimestrale', anno: 2026, periodi: [{ ivaVendite: 2200, ivaAcquisti: 500, attive: 10000, passive: 2272.73 }] });
  const { xml } = lipe({ cf: AZ.codice_fiscale, piva: AZ.piva, anno: 2026, periodicita: 'trimestrale', trimestre: 1, periodi: [l.periodi[0]] });
  assert.ok(xml.includes(`xmlns:iv="${NS_LIPE}"`) && xml.includes('<iv:CodiceFornitura>IVP18</iv:CodiceFornitura>'));
  const ordine = ['NumeroModulo', 'Trimestre', 'TotaleOperazioniAttive', 'TotaleOperazioniPassive', 'IvaEsigibile', 'IvaDetratta', 'IvaDovuta', 'InteressiDovuti', 'ImportoDaVersare'];
  const pos = ordine.map(n => xml.indexOf(`<iv:${n}>`)); assert.ok(pos.every((p, i) => p > 0 && (!i || p > pos[i - 1])), pos.join(','));
  assert.ok(xml.includes('<iv:TotaleOperazioniAttive>10000,00<') && xml.includes('<iv:InteressiDovuti>17,00<') && xml.includes('<iv:ImportoDaVersare>1717,00<'));
  const q4 = lipe({ cf: AZ.codice_fiscale, piva: AZ.piva, anno: 2026, periodicita: 'trimestrale', trimestre: 4, periodi: [{ ...l.periodi[0], acconto: 200 }] }).xml;
  assert.ok(q4.includes('<iv:Trimestre>5<') && !q4.includes('ImportoDaVersare') && !q4.includes('InteressiDovuti') && q4.includes('<iv:Metodo>1<'));
  // se c'è xmllint, l'XML è ben formato
  try { const f = join(mkdtempSync(join(tmpdir(), 'kubo-lipe-')), 'l.xml'); writeFileSync(f, xml); execFileSync('xmllint', ['--noout', f], { stdio: 'pipe' }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
});

test('PDF di testo: intestazione, pagine e caratteri accentati', () => {
  const b = pdfTesto(['Perché € 1.000,00', ...Array.from({ length: 120 }, (_, i) => `riga ${i}`)], { titolo: 'Prova' });
  const s = b.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF') && /\/Count 3 /.test(s));
  assert.ok(s.includes('Perch\xe9 \x80 1.000,00'));
});

test('registri, liquidazione e LIPE dalle fatture emesse e ricevute', () => {
  const { db, k, fattura } = gestionale({ fisco: { regime: 'ordinario', periodicita: 'trimestrale' } });
  fattura('2026-02-10', 1000); fattura('2026-03-05', 500);
  D.crea(db, 'fatture', { cliente: reg0(db), data: '2026-03-20', stato: 'bozza', righe: [{ descrizione: 'x', quantita: 1, prezzo: 9999, aliquota: 22 }] });   // le bozze non contano
  D.crea(db, 'fatture_ricevute', { fornitore: 'Carta spa', data: '2026-01-15', imponibile: 200, aliquota: 22 });
  D.crea(db, 'fatture_ricevute', { fornitore: 'Auto', data: '2026-02-01', imponibile: 100, aliquota: 22, detraibile: 40 });
  const reg = F.registri(k, null, '2026-01-01', '2026-03-31');
  assert.equal(reg.vendite.length, 2); assert.deepEqual(reg.totali.vendite, { imponibile: 1500, imposta: 330 });
  assert.equal(reg.totali.acquisti.detraibile, 44 + 8.8);
  const l = F.liquidazione(k, null, 2026);
  assert.equal(l.periodi[0].ivaEsigibile, 330); assert.equal(l.periodi[0].daVersare, Math.round((330 - 52.8) * 101) / 100);
  const f = F.fileLipe(k, null, 2026, 1);
  assert.ok(f.nome.endsWith('_2026_T1.xml') && f.xml.includes('<iv:IvaDetratta>52,80<'));
  const v = F.versamenti(k, null, 2026);
  assert.ok(v.voci.some(x => x.codice === '6031' && x.data === '2026-05-18'));
  assert.ok(v.avvisi.includes('redditi-professionista'));
});

test('forfettario dal gestionale: incassato per cassa, bollo, versamenti di giugno e novembre', () => {
  const { db, k, fattura } = gestionale({ regime: 'RF19', fisco: { regime: 'forfettario', ateco: '74.10.10', gestione: 'separata', impostaAnnoPrecedente: 1200 } });
  fattura('2025-12-20', 2000, { pagata_il: '2026-01-10', bollo: true });   // fatturata nel 2025, incassata nel 2026
  fattura('2026-04-02', 3000, { pagata_il: '2026-04-30', bollo: true });
  fattura('2026-05-02', 1000, { bollo: true });                              // non ancora incassata
  const c = F.cruscottoForfettario(k, null, 2026, { piu: 10000 });
  assert.equal(c.incassato, 5000); assert.equal(c.coefficiente, 78); assert.equal(c.redditoLordo, 3900);
  assert.ok(c.simulazione.diPiu > 0 && c.simulazione.restaInTasca < 10000);
  const v = F.versamenti(k, null, 2026);
  assert.deepEqual(v.voci.filter(x => x.chiave === 'forf-acconto').map(x => [x.codice, x.importo, x.anno]), [['1790', 600, 2026], ['1791', 600, 2026]]);
  assert.ok(v.voci.some(x => x.codice === '2522' && x.importo === 4));   // due bolli nel secondo trimestre
  assert.throws(() => F.fileLipe(k, null, 2026, 1), /forfettario/);
  const f = F.f24(k, null, 2026, '2026-07-20');
  assert.ok(f.html.includes('1790') && f.html.includes('home banking') && !f.html.includes('<script'));
});

test('ritenute come sostituto: versamento il 16 del mese dopo, riepilogo per la CU', () => {
  const { db, k } = gestionale({ fisco: { regime: 'semplificato', sostituto: true } });
  D.crea(db, 'fatture_ricevute', { fornitore: 'Avv. Verdi', cf_percipiente: 'VRDLGU70A01L219X', causale_ritenuta: 'A', data: '2026-03-01', imponibile: 1000, aliquota: 22, ritenuta: 200, pagata_il: '2026-03-20' });
  const r = F.ritenute(k, null, 2026);
  assert.deepEqual([r.righe[0].versamento, r.righe[0].codice, r.perMese[3].ritenute], ['2026-04-16', '1040', 200]);
  assert.deepEqual(r.cu.map(x => [x.cf, x.compensi, x.ritenute]), [['VRDLGU70A01L219X', 1000, 200]]);
  assert.ok(F.versamenti(k, null, 2026).voci.some(x => x.codice === '1040' && x.data === '2026-04-16'));
  assert.ok(F.scadenze(k, null, 2026).some(s => s.chiave === 'modello-770'));
});

test('pacchetto per il commercialista: XML, registri CSV e XLSX, prima nota e riepilogo PDF', () => {
  const { db, k, fattura } = gestionale({ fisco: { regime: 'ordinario' } });
  fattura('2026-02-10', 1000, { pagata_il: '2026-02-20' });
  D.crea(db, 'fatture_ricevute', { fornitore: 'Carta spa', numero: '7', data: '2026-01-15', imponibile: 200, aliquota: 22, pagata_il: '2026-01-31' });
  const p = F.pacchetto(k, null, '2026-01-01', '2026-03-31'), z = leggiZip(p.dati);
  for (const n of ['registro-iva-vendite.csv', 'registro-iva-acquisti.xlsx', 'liquidazioni-iva.csv', 'prima-nota.csv', 'riepilogo.pdf', 'LEGGIMI.txt']) assert.ok(z.nomi.includes(n), n);
  assert.ok(z.nomi.some(n => /^fatture-emesse\/IT00743110157_\w{5}\.xml$/.test(n)), z.nomi.join(','));
  const nota = z.leggi('prima-nota.csv').toString('utf8');
  assert.ok(nota.includes('1220,00') && nota.includes('244,00'));
});

test('strumenti di Lumi: si registrano con k.lumi e rispettano i permessi', async () => {
  const { db, k, fattura } = gestionale({ regime: 'RF19', fisco: { regime: 'forfettario', ateco: '74.10', gestione: 'nessuna' } });
  const anno = new Date().getFullYear(); fattura(`${anno}-01-10`, 2000, { pagata_il: `${anno}-01-15` });
  const registrati = [];
  registraFisco({ ...k, r: () => {}, serve: x => x, lumi: { strumento: s => registrati.push(s) } });
  assert.deepEqual(registrati.map(s => s.nome), ['fisco_quanto_pagare', 'fisco_stima_forfettario', 'fisco_liquidazione_iva', 'fisco_prepara_f24', 'fisco_scadenze_mese']);
  for (const s of registrati) { assert.equal(s.tipo, 'leggi'); assert.equal(s.schema.type, 'object'); assert.ok(s.descrizione.length > 20); }
  const stima = await registrati[1].esegui({ ctx: null, args: { incasso_in_piu: 5000 } });
  assert.equal(stima.incassato, 2000); assert.ok(stima.simulazione && stima.professionista.length);
  assert.ok((await registrati[2].esegui({ ctx: null, args: {} })).errore);   // niente IVA nel forfettario
  const scad = await registrati[4].esegui({ ctx: null, args: { mese: 6, anno } });
  assert.ok(Array.isArray(scad.scadenze));
  // senza k.lumi non si rompe niente
  registraFisco({ ...k, r: () => {}, serve: x => x });
  // un ruolo che non vede le fatture non può usarli
  const ctx = { utente: { id: 'x' }, r: { id: 'magazzino', permessi: {} } };
  assert.equal(registrati[0].permesso(ctx), P.puo(ctx, 'fatture', 'leggi'));
});

test('API: impostazioni, prepara, permessi, LIPE da scaricare e pacchetto', async () => {
  const cartella = mkdtempSync(join(tmpdir(), 'kubo-fisco-')), db = apri(join(cartella, 'kubo.db'));
  const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo, testo = false) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, tipo: r.headers.get('content-type'), json: testo ? null : await r.clone().json().catch(() => null), buf: Buffer.from(await r.arrayBuffer()) };
  };
  try {
    assert.equal((await chiama('POST', '/api/configura', { azienda: 'Rossi', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['fatture'] })).stato, 200);
    await chiama('POST', '/api/documenti/prepara'); await chiama('PUT', '/api/documenti/azienda', AZ);
    assert.equal((await chiama('PUT', '/api/fisco/impostazioni', { regime: 'boh' })).stato, 422);
    const imp = (await chiama('PUT', '/api/fisco/impostazioni', { regime: 'semplificato', periodicita: 'mensile', ateco: '43.21.01' })).json;
    assert.equal(imp.coefficienteAteco, 86);
    assert.deepEqual((await chiama('POST', '/api/fisco/prepara', { corrispettivi: true })).json.aggiunte, ['fatture_ricevute', 'corrispettivi']);
    await chiama('POST', '/api/dati/corrispettivi', { data: '2026-01-31', totale: 122, aliquota: 22 });
    const l = (await chiama('GET', '/api/fisco/liquidazione?anno=2026')).json;
    assert.equal(l.periodi[0].ivaEsigibile, 22); assert.equal(l.periodi[0].riportato, true);
    assert.equal((await chiama('GET', '/api/fisco/liquidazione?anno=abc')).stato, 400);
    const x = await chiama('GET', '/api/fisco/lipe?anno=2026&trimestre=1&scarica=1', null, true);
    assert.equal(x.stato, 200); assert.ok(x.buf.toString().includes('<iv:Mese>3</iv:Mese>'));
    const z = await chiama('GET', '/api/fisco/pacchetto?da=2026-01-01&a=2026-03-31', null, true);
    assert.equal(z.tipo, 'application/zip'); assert.ok(leggiZip(z.buf).nomi.includes('registro-corrispettivi.csv'));
    assert.equal((await chiama('GET', '/api/fisco/pacchetto?da=2026-04-01&a=2026-03-31')).stato, 400);
    // un ruolo che non vede le fatture non vede il fisco; un collaboratore lo vede ma non cambia le impostazioni
    assert.equal((await chiama('PUT', '/api/ruoli/banco', { nome: 'Banco', entita: { clienti: { leggi: true } } })).stato, 200);
    assert.equal((await chiama('POST', '/api/utenti', { nome: 'Banco', email: 'b@prova.it', password: 'password-lunga-1', ruolo: 'banco' })).stato, 200);
    assert.equal((await chiama('POST', '/api/utenti', { nome: 'Collab', email: 'c@prova.it', password: 'password-lunga-1', ruolo: 'collaboratore' })).stato, 200);
    biscotto = ''; assert.equal((await chiama('POST', '/api/accedi', { email: 'b@prova.it', password: 'password-lunga-1' })).stato, 200);
    assert.equal((await chiama('GET', '/api/fisco/versamenti?anno=2026')).stato, 403);
    assert.equal((await chiama('GET', '/api/fisco/pacchetto?da=2026-01-01&a=2026-03-31', null, true)).stato, 403);
    assert.deepEqual((await chiama('GET', '/api/fisco/promemoria')).json, []);
    biscotto = ''; assert.equal((await chiama('POST', '/api/accedi', { email: 'c@prova.it', password: 'password-lunga-1' })).stato, 200);
    assert.equal((await chiama('GET', '/api/fisco/versamenti?anno=2026')).stato, 200);
    assert.equal((await chiama('PUT', '/api/fisco/impostazioni', { regime: 'ordinario' })).stato, 403);
    assert.equal((await chiama('PUT', '/api/fisco/impostazioni', { regime: 'ordinario' }, false)).json.errore, 'Solo chi può personalizzare cambia le impostazioni fiscali');
  } finally { srv.close(); }
});
