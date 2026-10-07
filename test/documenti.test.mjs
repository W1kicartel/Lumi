import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { apri, meta } from '../server/db.js';
import * as S from '../server/schema.js';
import * as D from '../server/dati.js';
import * as A from '../server/automazioni.js';
import * as M from '../server/modelli.js';
import { creaServer } from '../server/api.js';
import { pivaValida, cfValido, ibanValido } from '../server/moduli/documenti-italia.js';
import { totali } from '../server/moduli/documenti-calcoli.js';
import { xml, controlla, testoPA } from '../server/moduli/documenti-xml.js';
import { rendi, modelloPredefinito, singolare } from '../server/moduli/documenti-stampa.js';
import { attivaFatture, salvaAzienda, salvaLogo, leggiLogo, stampa, completaClienti } from '../server/moduli/documenti.js';

const QUI = dirname(fileURLToPath(import.meta.url));
A.attiva(); attivaFatture(D);

test('partita IVA, codice fiscale e IBAN: le cifre di controllo', () => {
  assert.equal(pivaValida('12345678903').valore, '12345678903');
  assert.equal(pivaValida('IT 00743110157').valore, '00743110157');
  assert.ok(pivaValida('12345678901').errore); assert.ok(pivaValida('1234').errore); assert.ok(pivaValida('00000000000').errore);
  assert.equal(cfValido('rssmra85t10a562s').valore, 'RSSMRA85T10A562S');
  assert.equal(cfValido('MRTMTT25D09F205Z').valore, 'MRTMTT25D09F205Z');
  assert.ok(cfValido('RSSMRA85T10A562T').errore);   // ultima lettera sbagliata
  assert.ok(cfValido('RSSMRA85T10A56').errore);
  assert.equal(cfValido('12345678903').valore, '12345678903');   // società: 11 cifre
  assert.ok(cfValido('12345678901').errore);
  assert.equal(ibanValido('IT60 X054 2811 1010 0000 0123 456').valore, 'IT60X0542811101000000123456');
  assert.ok(ibanValido('IT60X0542811101000000123457').errore); assert.ok(ibanValido('IT60X05428').errore);
});

test('il motore controlla i campi con «valida»', () => {
  const db = apri();
  S.applica(db, { id: 'anagrafiche', nome: 'Anagrafiche', campi: [{ id: 'nome', nome: 'Nome', tipo: 'testo' }, { id: 'piva', nome: 'Partita IVA', tipo: 'testo', valida: 'piva' }, { id: 'cf', nome: 'CF', tipo: 'testo', valida: 'codice_fiscale' }] });
  assert.throws(() => D.crea(db, 'anagrafiche', { nome: 'X', piva: '12345678901' }), e => e instanceof D.ErroreDati && /Partita IVA/.test(e.campi.piva));
  const r = D.crea(db, 'anagrafiche', { nome: 'X', piva: 'it 123 456 789 03', cf: 'rssmra85t10a562s' });
  assert.equal(r.piva, '12345678903'); assert.equal(r.cf, 'RSSMRA85T10A562S');
  assert.equal(D.crea(db, 'anagrafiche', { nome: 'Y', piva: '' }).piva, null);   // vuoto: si può
});

test('conti: totali di riga, riepilogo IVA per aliquota e natura, arrotondamenti', () => {
  const t = totali([{ quantita: 3, prezzo: 1.15, sconto: 10, aliquota: 22 }, { quantita: 1, prezzo: 10, aliquota: 10 }, { quantita: 1, prezzo: 100, aliquota: 0, natura: 'N4' }]);
  assert.deepEqual(t.linee.map(l => l.totale), [3.11, 10, 100]);   // 3,105 → 3,11
  assert.deepEqual(t.riepilogo, [{ aliquota: 22, natura: null, imponibile: 3.11, imposta: 0.68 }, { aliquota: 10, natura: null, imponibile: 10, imposta: 1 }, { aliquota: 0, natura: 'N4', imponibile: 100, imposta: 0 }]);
  assert.equal(t.imponibile, 113.11); assert.equal(t.imposta, 1.68); assert.equal(t.totale, 114.79); assert.equal(t.serveBollo, true);
  // l'imposta si arrotonda una volta per aliquota: 3 × 0,10 al 22% = 0,07 (riga per riga sarebbe 0,06)
  assert.equal(totali([{ prezzo: 0.1, aliquota: 22 }, { prezzo: 0.1, aliquota: 22 }, { prezzo: 0.1, aliquota: 22 }]).imposta, 0.07);
  assert.equal(totali([{ prezzo: 0.1 }, { prezzo: 0.2 }]).imponibile, 0.3);
  // prezzi con l'IVA dentro (banco): scorporo per aliquota
  assert.deepEqual(totali([{ prezzo: 12.2, aliquota: 22 }], { prezziIvati: true }).riepilogo[0], { aliquota: 22, natura: null, imponibile: 10, imposta: 2.2 });
  const r = totali([{ prezzo: 1000, aliquota: 22 }], { ritenuta: 20 });
  assert.equal(r.ritenuta, 200); assert.equal(r.totale, 1220); assert.equal(r.netto, 1020);
  assert.equal(totali([{ prezzo: 77.47, aliquota: 0, natura: 'N2.2' }]).serveBollo, false);
});

test('segnaposto e blocchi dei modelli di stampa', () => {
  const pila = [{ cliente: { _: 'Bianchi srl', via: 'Via Roma 1' }, note: '', bollo: 'Sì', linee: [{ d: 'a' }, { d: 'b' }] }];
  assert.equal(rendi('{{cliente}} · {{cliente.via}}', pila), 'Bianchi srl · Via Roma 1');
  assert.equal(rendi('{{#note}}Note: {{note}}{{/note}}{{^note}}niente{{/note}}', pila), 'niente');
  assert.equal(rendi('{{#bollo}}bollo{{/bollo}}|{{#linee}}[{{d}}]{{/linee}}|{{sconosciuto}}', pila), 'bollo|[a][b]|');
  assert.equal(singolare('Vendite'), 'Vendita'); assert.equal(singolare('Preventivi'), 'Preventivo'); assert.equal(singolare('Ordini ai fornitori'), 'Ordine ai fornitori');
});

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI',
  email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
const CLIENTE = { nome: 'Rossi & Figli S.p.A.', tipo: 'azienda', piva: '00743110157', codice_destinatario: 'abc1234', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'to', nazione: 'IT' };
const FATTURA = { tipo: 'TD01', numero: '7', data: '2026-03-15', stato: 'emessa', causale: 'Fornitura “marzo” – lotto 3', modalita: 'MP05', condizioni: 'TP02', scadenza: '2026-04-14',
  ritenuta: 0, bollo: true, righe: [
    { descrizione: 'Vaso in ceramica <grande>', quantita: 3, prezzo: 1.15, sconto: 10, aliquota: 22 },
    { descrizione: 'Libro', quantita: 1, prezzo: 10, aliquota: 4 },
    { descrizione: 'Corso esente', quantita: 2, prezzo: 45, aliquota: 0, natura: 'N4' }] };

test('FatturaPA FPR12: il file è quello atteso, ben formato, con il nome giusto', () => {
  assert.deepEqual(controlla(AZ, FATTURA, CLIENTE), []);
  const { nome, xml: x } = xml(AZ, FATTURA, CLIENTE, { progressivo: '0000A' });
  assert.equal(nome, 'IT12345678903_0000A.xml');
  const atteso = join(QUI, 'documenti', 'fattura-attesa.xml');
  if (process.env.KUBO_AGGIORNA_ATTESI) writeFileSync(atteso, x);
  assert.equal(x, readFileSync(atteso, 'utf8'));
  // l'ordine degli elementi che lo schema XSD pretende
  const ordine = (padre, figli) => { const blocco = x.slice(x.indexOf(`<${padre}>`), x.indexOf(`</${padre}>`)); const pos = figli.map(f => blocco.indexOf(`<${f}>`)); assert.ok(pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), `${padre}: ${figli}`); };
  ordine('DatiTrasmissione', ['IdTrasmittente', 'ProgressivoInvio', 'FormatoTrasmissione', 'CodiceDestinatario']);
  ordine('DatiGeneraliDocumento', ['TipoDocumento', 'Divisa', 'Data', 'Numero', 'DatiBollo', 'ImportoTotaleDocumento', 'Causale']);
  ordine('DettaglioLinee', ['NumeroLinea', 'Descrizione', 'Quantita', 'PrezzoUnitario', 'ScontoMaggiorazione', 'PrezzoTotale', 'AliquotaIVA']);
  ordine('DatiAnagrafici', ['IdFiscaleIVA', 'CodiceFiscale', 'Anagrafica', 'RegimeFiscale']);
  assert.match(x, /<ImportoTotaleDocumento>104\.19<\/ImportoTotaleDocumento>/);   // 3,11 + 0,68 + 10 + 0,40 + 90
  assert.match(x, /<Natura>N4<\/Natura>\s*<ImponibileImporto>90\.00<\/ImponibileImporto>\s*<Imposta>0\.00<\/Imposta>\s*<RiferimentoNormativo>/);
  assert.match(x, /<CodiceDestinatario>ABC1234<\/CodiceDestinatario>/); assert.match(x, /Rossi &amp; Figli/); assert.match(x, /&lt;grande&gt;/);
  assert.match(x, /Fornitura "marzo" - lotto 3/);   // niente caratteri tipografici
  try { execFileSync('xmllint', ['--noout', atteso], { stdio: 'pipe' }); } catch (e) { if (e.code !== 'ENOENT') throw new Error('xmllint: ' + e.stderr); }
});

test('FatturaPA: i controlli dicono cosa manca', () => {
  const e = controlla({}, { ...FATTURA, stato: 'bozza', righe: [{ descrizione: '', prezzo: 100, aliquota: 0 }] }, { nome: 'Tizio', piva: '00743110157' });
  const tutto = e.join('\n');
  for (const m of ['ragione sociale', 'partita IVA della tua azienda', 'regime fiscale', 'in bozza', 'codice destinatario del cliente', 'indirizzo completo del cliente', 'Riga 1: manca la descrizione', 'Riga 1: IVA a 0 senza natura'])
    assert.ok(tutto.includes(m), `manca il messaggio «${m}» in:\n${tutto}`);
  assert.ok(controlla(AZ, { ...FATTURA, bollo: false }, CLIENTE).some(x => x.includes('Bollo virtuale')));
  // privato con il solo codice fiscale: va bene senza codice destinatario (0000000)
  const privato = { nome: 'Mario Rossi', tipo: 'privato', codice_fiscale: 'RSSMRA85T10A562S', via: 'Via Po 1', cap: '00100', comune: 'Roma', provincia: 'RM' };
  assert.deepEqual(controlla(AZ, FATTURA, privato), []);
  const x = xml(AZ, FATTURA, privato).xml;
  assert.match(x, /<CodiceDestinatario>0000000<\/CodiceDestinatario>/); assert.doesNotMatch(x, /<CessionarioCommittente>[\s\S]*IdFiscaleIVA[\s\S]*<\/CessionarioCommittente>/);
  assert.equal(testoPA('caffè ☕ “buono”'), 'caffè "buono"');
});

function gestionale() { const db = apri(); M.installa(db, 'negozio'); M.installa(db, 'fatture'); completaClienti(db, S); return db; }

test('fatture: numero all\'emissione, per anno e per serie, niente doppioni', () => {
  const db = gestionale();
  const cl = D.crea(db, 'clienti', { nome: 'Rossi' });
  const nuova = (v) => D.crea(db, 'fatture', { cliente: cl.id, righe: [{ descrizione: 'x', prezzo: 10, aliquota: 22 }], ...v });
  const b = nuova({ data: '2025-12-31' }), letta = D.leggi(db, 'fatture', b.id); assert.equal(letta.numero, null); assert.equal(letta.imposta, 2.2); assert.equal(letta.totale, 12.2);
  const numero = x => D.leggi(db, 'fatture', x.id).numero;   // senza utente, crea e modifica restituiscono la riga prima degli ascoltatori
  D.modifica(db, 'fatture', b.id, { stato: 'emessa' }); assert.equal(numero(b), '1');
  assert.equal(numero(nuova({ data: '2025-12-30', stato: 'emessa' })), '2');
  assert.equal(numero(nuova({ data: '2026-01-02', stato: 'emessa' })), '1');   // anno nuovo, si riparte
  assert.equal(numero(nuova({ data: '2026-01-03', stato: 'emessa', serie: 'B' })), '1/B');
  assert.equal(numero(nuova({ data: '2026-01-04', stato: 'emessa' })), '2');
  assert.throws(() => nuova({ data: '2026-05-01', numero: '2' }), /già una fattura numero 2 nel 2026/);
  // l'IVA segue le righe a ogni salvataggio
  const f = D.leggi(db, 'fatture', b.id);
  D.modifica(db, 'fatture', b.id, { righe: [{ id: f.righe[0].id, descrizione: 'x', prezzo: 10, aliquota: 22 }, { descrizione: 'y', prezzo: 5, aliquota: 10 }] });
  assert.equal(D.leggi(db, 'fatture', b.id).imposta, 2.7);
  // pagata: la data si mette da sola
  D.modifica(db, 'fatture', b.id, { stato: 'pagata' }); assert.match(D.leggi(db, 'fatture', b.id).pagata_il, /^\d{4}-\d{2}-\d{2}$/);
});

test('dati dell\'azienda, logo e stampa', () => {
  const db = gestionale();
  assert.throws(() => salvaAzienda(db, meta, { piva: '12345678901' }), /Partita IVA/);
  assert.equal(salvaAzienda(db, meta, { ...AZ, provincia: 'mi' }).provincia, 'MI');
  assert.throws(() => salvaLogo(db, meta, 'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64')), /PNG o un JPEG/);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  salvaLogo(db, meta, png); assert.equal(leggiLogo(db, meta), png);
  const cl = D.crea(db, 'clienti', { nome: '<script>alert(1)</script>', via: 'Via Po 1', cap: '00100', comune: 'Roma' });
  const art = D.crea(db, 'articoli', { nome: 'Tazza', prezzo: 12.2, iva: 22 });
  const v = D.crea(db, 'vendite', { cliente: cl.id, righe: [{ articolo: art.id, quantita: 2, prezzo: 12.2 }] });
  const s = stampa(db, { S, D, meta }, 'vendite', v.id, null);
  assert.ok(!s.html.includes('<script>alert')); assert.ok(s.html.includes('&lt;script&gt;'));
  assert.ok(s.html.includes('Tazza')); assert.ok(s.html.includes('Bottega Prova srl')); assert.ok(s.html.includes('<img src="data:image/png'));
  assert.equal(s.totali.totale, 24.4); assert.equal(s.totali.imponibile, 20);   // al banco i prezzi comprendono l'IVA
  const m = modelloPredefinito(S.leggi(db, 'vendite'), S.elenco(db)); assert.equal(m.prezziIvati, true);
  assert.equal(modelloPredefinito(S.leggi(db, 'fatture'), S.elenco(db)).prezziIvati, false);
});

test('API: crea fattura da una vendita, stampa, controlli e XML; permessi rispettati', async () => {
  const cartella = mkdtempSync(join(tmpdir(), 'kubo-doc-')), db = apri(join(cartella, 'kubo.db'));
  const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  try {
    assert.equal((await chiama('POST', '/api/configura', { azienda: 'Bottega Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['negozio', 'fatture'] })).stato, 200);
    assert.deepEqual((await chiama('GET', '/api/modelli')).json.map(m => m.id).slice(-1), ['fatture']);   // dopo i modelli di settore
    await chiama('POST', '/api/documenti/prepara');
    const schema = (await chiama('GET', '/api/schema')).json;
    assert.ok(schema.find(e => e.id === 'clienti').campi.some(c => c.id === 'codice_destinatario'));
    assert.equal((await chiama('PUT', '/api/documenti/azienda', { ...AZ, piva: '123' })).stato, 422);
    assert.equal((await chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    assert.equal((await chiama('PUT', '/api/documenti/logo', { dati: png })).stato, 200);
    assert.ok(existsSync(join(cartella, 'documenti', 'logo.png')));
    assert.equal((await chiama('POST', '/api/dati/clienti', { nome: 'X', codice_fiscale: 'RSSMRA85T10A562T' })).stato, 422);   // campo aggiunto con «valida»
    const cl = (await chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO' })).json;
    const art = (await chiama('POST', '/api/dati/articoli', { nome: 'Vaso', prezzo: 24.4, iva: 22 })).json;
    const v = (await chiama('POST', '/api/dati/vendite', { cliente: cl.id, righe: [{ articolo: art.id, quantita: 2, prezzo: 24.4 }] })).json;
    const f = (await chiama('POST', `/api/documenti/fattura-da/vendite/${v.id}`)).json;
    assert.equal(f.cliente.id, cl.id); assert.equal(f.righe.length, 1); assert.equal(f.righe[0].prezzo, 20); assert.equal(f.righe[0].descrizione, 'Vaso');
    assert.equal(f.totale, 48.8); assert.equal(f.stato, 'bozza'); assert.match(f.riferimento, /^Vendita V-/);
    const st = (await chiama('GET', `/api/documenti/stampa/fatture/${f.id}`)).json; assert.ok(st.html.includes('Rossi srl')); assert.ok(st.html.includes('48,80'), st.html.slice(-1500));
    let c = (await chiama('GET', `/api/documenti/fatturapa/${f.id}`)).json.errori;
    assert.ok(c.some(x => x.includes('in bozza'))); assert.ok(c.some(x => x.includes('codice destinatario del cliente')));
    assert.equal((await chiama('POST', `/api/documenti/fatturapa/${f.id}`)).stato, 422);
    await chiama('PATCH', `/api/dati/clienti/${cl.id}`, { codice_destinatario: 'ABC1234' });
    assert.equal((await chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' })).json.numero, '1');
    const x = await chiama('POST', `/api/documenti/fatturapa/${f.id}`); assert.equal(x.stato, 200, JSON.stringify(x.json));
    assert.equal(x.json.nome, 'IT12345678903_00001.xml'); assert.match(x.json.xml, /<ImportoTotaleDocumento>48\.80</);
    assert.equal((await chiama('POST', `/api/documenti/fatturapa/${f.id}`)).json.nome, 'IT12345678903_00002.xml');   // mai lo stesso nome due volte
    // modello di stampa: si cambia, si vede in anteprima, si torna al predefinito
    const m = (await chiama('GET', '/api/documenti/modelli/fatture')).json;
    assert.equal((await chiama('PUT', '/api/documenti/modelli/fatture', { ...m, piede: 'Grazie da {{azienda.ragione_sociale}}', colore: '#123456' })).stato, 200);
    assert.ok((await chiama('GET', `/api/documenti/stampa/fatture/${f.id}`)).json.html.includes('Grazie da Bottega Prova srl'));
    assert.equal((await chiama('PUT', '/api/documenti/modelli/fatture', { ...m, colonne: [] })).stato, 422);
    assert.equal((await chiama('DELETE', '/api/documenti/modelli/fatture')).json.personalizzato, undefined);
    // un collaboratore che non vede le fatture non le stampa e non le esporta
    await chiama('PUT', '/api/ruoli/banco', { nome: 'Banco', entita: { '*': { leggi: true, crea: true, modifica: true }, fatture: { leggi: false, crea: false } } });
    await chiama('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'password-giulia', ruolo: 'banco' });
    biscotto = ''; await chiama('POST', '/api/accedi', { email: 'g@prova.it', password: 'password-giulia' });
    assert.equal((await chiama('GET', `/api/documenti/stampa/fatture/${f.id}`)).stato, 403);
    assert.equal((await chiama('POST', `/api/documenti/fatturapa/${f.id}`)).stato, 403);
    assert.equal((await chiama('POST', `/api/documenti/fattura-da/vendite/${v.id}`)).stato, 403);
    assert.equal((await chiama('PUT', '/api/documenti/azienda', AZ)).stato, 403);
    assert.equal((await chiama('GET', `/api/documenti/stampa/vendite/${v.id}`)).stato, 200);
  } finally { srv.close(); }
});
