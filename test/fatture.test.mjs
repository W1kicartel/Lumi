// Fatture complete: il blocco dopo l'emissione (motore, API, righe), la numerazione senza buchi, i conti scritti dal server,
// la busta .p7m letta senza librerie, l'import delle fatture ricevute con il fornitore, la vista, le integrazioni TD16-TD19,
// il bollo virtuale per trimestre, l'aggiornamento di un gestionale già installato e i codici controllati sullo schema ufficiale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { apri } from '../server/db.js';
import * as S from '../server/schema.js';
import * as D from '../server/dati.js';
import * as A from '../server/automazioni.js';
import * as M from '../server/modelli.js';
import { creaServer } from '../server/api.js';
import { xml } from '../server/moduli/documenti-xml.js';
import { attivaFatture, completaClienti, notaDiCredito } from '../server/moduli/documenti.js';
import { estraiP7m, der, derOid } from '../server/moduli/fatture-p7m.js';
import { leggiFattura, testoXml, vistaHtml } from '../server/moduli/fatture-passive.js';
import { buchiNumerazione, bolloTrimestri } from '../server/moduli/fatture-regole.js';
import { TIPI_CASSA, TIPI_RITENUTA, CAUSALI_RITENUTA, TIPI_DOCUMENTO, tipoIntegrazione } from '../server/moduli/fatture-codici.js';
import { aggiornaModello } from '../server/moduli/fatture.js';

const QUI = dirname(fileURLToPath(import.meta.url));
const XSD = join(QUI, 'documenti', 'xsd', 'fatturapa-locale.xsd');
A.attiva(); attivaFatture(D);

function gestionale() { const db = apri(); M.installa(db, 'negozio'); M.installa(db, 'fatture'); completaClienti(db, S); aggiornaModello(db, S); return db; }
const NOI = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', codice_destinatario: 'M5UXCR1' };

test('i codici di cassa, ritenuta, causale e tipo documento sono tutti nello schema ufficiale 1.2.2', () => {
  const x = readFileSync(XSD, 'utf8');
  const valori = tipo => [...x.slice(x.indexOf(`name="${tipo}"`), x.indexOf('</xs:simpleType>', x.indexOf(`name="${tipo}"`))).matchAll(/enumeration value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(Object.keys(TIPI_CASSA), valori('TipoCassaType'));
  assert.deepEqual(Object.keys(TIPI_RITENUTA), valori('TipoRitenutaType'));
  assert.deepEqual(CAUSALI_RITENUTA, valori('CausalePagamentoType'));
  for (const t of Object.keys(TIPI_DOCUMENTO)) assert.ok(valori('TipoDocumentoType').includes(t), t);
  assert.ok(!valori('TipoDocumentoType').includes('TD29'), 'TD29 non è nello schema 1.2.2: quando arriva lo schema nuovo, si aggiunge');
  assert.equal(tipoIntegrazione({ nazione: 'IE' }), 'TD17'); assert.equal(tipoIntegrazione({ nazione: 'DE', beni: true, ue: true }), 'TD18');
  assert.equal(tipoIntegrazione({ nazione: 'CH', beni: true, ue: false }), 'TD19'); assert.equal(tipoIntegrazione({ nazione: 'IT' }), 'TD16');
});

test('fattura emessa = bloccata: righe, prezzi, cliente e numero non si toccano più; pagamento e note interne sì', () => {
  const db = gestionale();
  const cl = D.crea(db, 'clienti', { nome: 'Rossi' }), altro = D.crea(db, 'clienti', { nome: 'Verdi' });
  const f = D.crea(db, 'fatture', { cliente: cl.id, data: '2026-03-02', righe: [{ descrizione: 'x', prezzo: 10, aliquota: 22 }], rate: [{ data: '2026-04-01', importo: 12.2 }] });
  D.modifica(db, 'fatture', f.id, { righe: [{ descrizione: 'x', prezzo: 20, aliquota: 22 }] });   // in bozza si cambia tutto
  D.modifica(db, 'fatture', f.id, { stato: 'emessa' });
  const em = D.leggi(db, 'fatture', f.id); assert.equal(em.numero, '1'); assert.equal(em.imposta, 4.4);
  for (const v of [{ righe: [{ descrizione: 'x', prezzo: 30, aliquota: 22 }] }, { cliente: altro.id }, { numero: '7' }, { data: '2026-03-05' }, { ritenuta: 20 }, { tipo: 'TD04' }])
    assert.throws(() => D.modifica(db, 'fatture', f.id, v), e => e instanceof D.ErroreDati && /La fattura 1 è emessa: non si modifica più/.test(e.message), JSON.stringify(v));
  // le righe e le rate da sole (le API delle sezioni nascoste) sono bloccate anche loro, tranne «pagata» sulle rate
  assert.throws(() => D.modifica(db, 'righe_fattura', em.righe[0].id, { prezzo: 1 }), /è emessa/);
  assert.throws(() => D.crea(db, 'righe_fattura', { fattura: f.id, descrizione: 'y', prezzo: 1 }), /è emessa/);
  assert.throws(() => D.elimina(db, 'righe_fattura', em.righe[0].id), /è emessa/);
  // nemmeno dalle strade «interne» (l'import da file scrive così), spostando una riga su una bozza o ripristinandone una vecchia
  assert.throws(() => D.modifica(db, 'righe_fattura', em.righe[0].id, { prezzo: 1 }, null, { interno: true }), /è emessa/);
  assert.throws(() => D.crea(db, 'righe_fattura', { fattura: f.id, descrizione: 'y', prezzo: 1 }, null, { interno: true }), /è emessa/);
  const bozza = D.crea(db, 'fatture', { cliente: cl.id, righe: [{ descrizione: 'b', prezzo: 1, aliquota: 22 }] });
  assert.throws(() => D.modifica(db, 'righe_fattura', em.righe[0].id, { fattura: bozza.id }), /è emessa/);
  assert.throws(() => D.ripristina(db, 'righe_fattura', db.prepare("SELECT id FROM d_righe_fattura WHERE c_fattura = ? AND archiviato = 1").get(f.id).id), /è emessa/);
  assert.equal(D.leggi(db, 'fatture', f.id).righe.length, 1);
  // una fattura che nasce già emessa (con il suo numero, per esempio riportata da un altro programma) porta le sue righe
  const gia = D.crea(db, 'fatture', { cliente: cl.id, data: '2025-12-30', numero: '90', stato: 'emessa', righe: [{ descrizione: 'r', prezzo: 5, aliquota: 22 }] });
  assert.equal(D.leggi(db, 'fatture', gia.id).righe.length, 1);
  D.modifica(db, 'rate_fattura', em.rate[0].id, { pagata: true });
  assert.throws(() => D.modifica(db, 'rate_fattura', em.rate[0].id, { importo: 1 }), /è emessa/);
  // quello che si può: note interne, stato del pagamento e dell'invio, rate pagate passando dalla fattura
  D.modifica(db, 'fatture', f.id, { note_interne: 'chiamare il lunedì', stato: 'inviata', inviata_il: '2026-03-03' });
  D.modifica(db, 'fatture', f.id, { rate: [{ id: em.rate[0].id, data: '2026-04-01', importo: 12.2, pagata: false }] });
  D.modifica(db, 'fatture', f.id, { stato: 'pagata' });
  const pg = D.leggi(db, 'fatture', f.id); assert.equal(pg.stato, 'pagata'); assert.match(pg.pagata_il, /^\d{4}-/); assert.equal(pg.righe[0].prezzo, 20);
  // non si elimina (buco nella numerazione); si storna con la nota di credito
  assert.throws(() => D.elimina(db, 'fatture', f.id), /non si elimina, lascerebbe un buco/);
  const nc = notaDiCredito(db, { S, D, P: { verifica: () => {} }, ErroreHttp: Error }, f.id, null);
  assert.equal(D.leggi(db, 'fatture', nc.id).tipo, 'TD04');
  // una bozza invece si elimina
  const bz = D.crea(db, 'fatture', { cliente: cl.id, righe: [{ descrizione: 'z', prezzo: 1, aliquota: 22 }] }); D.elimina(db, 'fatture', bz.id);
});

test('i conti scritti dal server: ritenuta solo sulle righe soggette, cassa, bollo addebitato, scissione dei pagamenti', () => {
  const db = gestionale(), cl = D.crea(db, 'clienti', { nome: 'Rossi' });
  const f = D.crea(db, 'fatture', { cliente: cl.id, ritenuta: 20, cassa_tipo: 'TC22', cassa: 4, righe: [{ descrizione: 'Consulenza', prezzo: 1000, aliquota: 22 }, { descrizione: 'Marche', prezzo: 50, aliquota: 0, natura: 'N1' }] });
  const l = D.leggi(db, 'fatture', f.id);
  assert.equal(l.contributo_cassa, 40); assert.equal(l.imponibile, 1090); assert.equal(l.imposta, 228.8); assert.equal(l.totale, 1318.8);
  assert.equal(l.importo_ritenuta, 208); assert.equal(l.netto, 1110.8);
  const pa = D.crea(db, 'fatture', { cliente: cl.id, esigibilita: 'S', righe: [{ descrizione: 'Servizio', prezzo: 0.125, quantita: 1000, aliquota: 22 }] });
  const lp = D.leggi(db, 'fatture', pa.id); assert.equal(lp.righe[0].prezzo, 0.125); assert.equal(lp.imponibile, 125); assert.equal(lp.totale, 152.5); assert.equal(lp.netto, 125);
  const fo = D.crea(db, 'fatture', { cliente: cl.id, bollo: true, righe: [{ descrizione: 'Corso', prezzo: 100, aliquota: 0, natura: 'N4' }] });
  assert.equal(D.leggi(db, 'fatture', fo.id).totale, 102);
  D.modifica(db, 'fatture', fo.id, { bollo_tuo: true }); assert.equal(D.leggi(db, 'fatture', fo.id).totale, 100);
});

test('numerazione: i buchi per serie e anno; il bollo per trimestre con scadenze e codici tributo', () => {
  const b = buchiNumerazione([{ numero: '1', data: '2026-01-02' }, { numero: '2', data: '2026-01-03' }, { numero: '5', data: '2026-02-01' }, { numero: '1/B', serie: 'B', data: '2026-02-01' }, { numero: '3', data: '2025-12-30' }]);
  assert.deepEqual(b.find(x => x.anno === '2026' && !x.serie).mancano, [3, 4]);
  assert.deepEqual(b.find(x => x.serie === 'B').mancano, []); assert.deepEqual(b.find(x => x.anno === '2025').mancano, [1, 2]);
  const f = (data, bollo = true, stato = 'emessa') => ({ data, bollo, stato, numero: '1' });
  const t = bolloTrimestri([f('2026-01-10'), f('2026-02-10'), f('2026-05-10'), f('2026-08-01'), f('2026-11-30'), f('2026-12-01', false), f('2026-12-02', true, 'annullata'), f('2025-12-31')], 2026);
  assert.deepEqual(t.map(x => [x.fatture, x.importo, x.tributo]), [[2, 4, '2521'], [1, 2, '2522'], [1, 2, '2523'], [1, 2, '2524']]);
  // piccoli importi: il 1° e il 2° trimestre si versano entro il 30 novembre (art. 17 DL 124/2019, guida AdE 2024)
  // 28/02/2027 è domenica: slitta a lunedì 1° marzo, come le altre scadenze del fisco (art. 7 c. 1 lett. h DL 70/2011)
  assert.deepEqual(t.map(x => x.scadenza), ['2026-11-30', '2026-11-30', '2026-11-30', '2027-03-01']);
  assert.equal(bolloTrimestri([], 2027)[3].scadenza, '2028-02-29');   // anno bisestile
  assert.equal(bolloTrimestri(Array.from({ length: 2600 }, () => f('2026-02-01')), 2026)[0].scadenza, '2026-06-01');   // 5.200 €: niente rinvio; il 31/05/2026 è domenica
});

// ---------- le fatture ricevute ----------
const FORNITORE_IT = { ragione_sociale: 'Carta & Penne srl', piva: '00743110157', regime: 'RF01', via: 'Via Torino 3', cap: '10121', comune: 'Torino', provincia: 'TO', iban: 'IT60X0542811101000000123456' };
const NOI_CLIENTE = { nome: NOI.ragione_sociale, piva: NOI.piva, codice_destinatario: NOI.codice_destinatario, via: NOI.via, cap: NOI.cap, comune: NOI.comune, provincia: NOI.provincia };
const ricevutaIt = () => xml(FORNITORE_IT, { stato: 'emessa', numero: 'A-77', data: '2026-09-15', modalita: 'MP05', scadenza: '2026-10-15',
  righe: [{ descrizione: 'Risme di carta <A4>', quantita: 10, prezzo: 4.5, aliquota: 22 }, { descrizione: 'Penne', quantita: 20, prezzo: 0.75, aliquota: 22 }] }, NOI_CLIENTE).xml;
// un servizio dall'estero, scritto a mano come lo manderebbe un altro programma (prefisso ns2, entità, codifica latin-1, due fatture)
const ESTERO = `<?xml version="1.0" encoding="ISO-8859-1"?>
<ns2:FatturaElettronica xmlns:ns2="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12"><FatturaElettronicaHeader>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IE</IdPaese><IdCodice>6388047V</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Cloud &amp; Co Ltd</Denominazione></Anagrafica><RegimeFiscale>RF18</RegimeFiscale></DatiAnagrafici>
<Sede><Indirizzo>1 Grand Canal</Indirizzo><CAP>00000</CAP><Comune>Dublin</Comune><Nazione>IE</Nazione></Sede></CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>12345678903</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Bottega Prova srl</Denominazione></Anagrafica></DatiAnagrafici>
<Sede><Indirizzo>Via dei Mille 10</Indirizzo><CAP>20121</CAP><Comune>Milano</Comune><Nazione>IT</Nazione></Sede></CessionarioCommittente></FatturaElettronicaHeader>
${['INV-1', 'INV-2'].map((n, i) => `<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>2026-09-3${i}</Data><Numero>${n}</Numero><ImportoTotaleDocumento>250.00</ImportoTotaleDocumento><Causale>Abbonamento caff\xe8</Causale></DatiGeneraliDocumento></DatiGenerali>
<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Software &lt;cloud&gt;</Descrizione><PrezzoUnitario>250.00</PrezzoUnitario><PrezzoTotale>250.00</PrezzoTotale><AliquotaIVA>0.00</AliquotaIVA><Natura>N2.1</Natura></DettaglioLinee>
<DatiRiepilogo><AliquotaIVA>0.00</AliquotaIVA><Natura>N2.1</Natura><ImponibileImporto>250.00</ImponibileImporto><Imposta>0.00</Imposta></DatiRiepilogo></DatiBeniServizi></FatturaElettronicaBody>`).join('\n')}
</ns2:FatturaElettronica>`;

// la busta CAdES (CMS SignedData) intorno all'XML: DER con lunghezze definite, e BER indefinito con l'OCTET STRING a pezzi
const SIGNED = '1.2.840.113549.1.7.2', DATA = '1.2.840.113549.1.7.1';
const p7mDer = contenuto => der(0x30, derOid(SIGNED), der(0xa0, der(0x30, der(0x02, [1]), der(0x31, der(0x30, derOid('2.16.840.1.101.3.4.2.1'))),
  der(0x30, derOid(DATA), der(0xa0, der(0x04, contenuto))), der(0xa0, Buffer.from([0x30, 0x00])), der(0x31))));
function p7mBer(contenuto) {
  const pezzi = []; for (let i = 0; i < contenuto.length; i += 1000) pezzi.push(der(0x04, contenuto.subarray(i, i + 1000)));
  const ind = (tag, ...x) => Buffer.concat([Buffer.from([tag, 0x80]), ...x, Buffer.from([0, 0])]);
  return ind(0x30, derOid(SIGNED), ind(0xa0, ind(0x30, der(0x02, [1]), der(0x31), ind(0x30, derOid(DATA), ind(0xa0, ind(0x24, ...pezzi))), der(0x31))));
}

test('.p7m: il lettore ASN.1 tira fuori l\'XML (DER, BER a pezzi, base64) e rifiuta il resto', () => {
  const x = Buffer.from(ricevutaIt());
  assert.ok(estraiP7m(p7mDer(x)).equals(x));
  assert.ok(estraiP7m(p7mBer(x)).equals(x));
  assert.ok(estraiP7m(Buffer.from(p7mDer(x).toString('base64').replace(/(.{64})/g, '$1\r\n'))).equals(x));
  // firma staccata (niente contenuto), file troncato, file che non è CMS
  const staccata = der(0x30, derOid(SIGNED), der(0xa0, der(0x30, der(0x02, [1]), der(0x31), der(0x30, derOid(DATA)), der(0x31))));
  assert.throws(() => estraiP7m(staccata), /staccata/);
  assert.throws(() => estraiP7m(p7mDer(x).subarray(0, 300)), /rovinato o incompleto/);
  assert.throws(() => estraiP7m(Buffer.from('ciao, non sono una fattura!')), /non è una fattura firmata/);
  assert.throws(() => estraiP7m(der(0x30, derOid(DATA), der(0xa0, der(0x04, x)))), /non è una fattura firmata/);
});

test('lettura della fattura ricevuta: prefissi, entità, latin-1, più fatture nello stesso file, niente DTD', () => {
  const l = leggiFattura(testoXml(Buffer.from(ESTERO, 'latin1')));
  assert.equal(l.fornitore.nome, 'Cloud & Co Ltd'); assert.equal(l.fornitore.paese, 'IE'); assert.equal(l.cliente.piva, '12345678903');
  assert.equal(l.fatture.length, 2); assert.equal(l.fatture[1].numero, 'INV-2'); assert.equal(l.fatture[0].causale, 'Abbonamento caffè');
  assert.equal(l.fatture[0].righe[0].descrizione, 'Software <cloud>'); assert.equal(l.fatture[0].inversione, true);
  const it = leggiFattura(testoXml(Buffer.from(ricevutaIt())));
  assert.deepEqual([it.fatture[0].imponibile, it.fatture[0].imposta, it.fatture[0].totale, it.fatture[0].netto, it.fatture[0].scadenza], [60, 13.2, 73.2, 73.2, '2026-10-15']);
  assert.equal(it.fatture[0].inversione, false);
  assert.throws(() => testoXml(Buffer.from('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x/>')), /non è una fattura elettronica/);
  assert.throws(() => leggiFattura('<a/>'), /non è una fattura elettronica/);
  // la vista: tutto passa dall'escape
  const v = vistaHtml(testoXml(Buffer.from(ricevutaIt())));
  assert.ok(v.includes('Risme di carta &lt;A4&gt;')); assert.ok(!v.includes('<A4>')); assert.ok(!/<script/i.test(v));
});

test('API: import XML e .p7m, fornitore creato e poi abbinato, doppioni saltati, vista, integrazione TD17 valida per lo schema', async () => {
  const cartella = mkdtempSync(join(tmpdir(), 'lumi-fatture-')), db = apri(join(cartella, 'lumi.db'));
  const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Lumi': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  try {
    assert.equal((await chiama('POST', '/api/configura', { azienda: 'Bottega Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['negozio', 'fatture'] })).stato, 200);
    const prep = await chiama('POST', '/api/documenti/prepara'); assert.equal(prep.stato, 200, JSON.stringify(prep.json));   // aggiorna anche il modello: i fornitori del negozio prendono via, CAP, comune…
    const sch = (await chiama('GET', '/api/schema')).json; assert.ok(sch.find(e => e.id === 'fornitori').campi.some(c => c.id === 'nazione'), JSON.stringify(sch.find(e => e.id === 'fornitori').campi.map(c => c.id)) + JSON.stringify(sch.map(e => e.id)));
    assert.equal((await chiama('PUT', '/api/documenti/azienda', NOI)).stato, 200);
    const b64 = b => Buffer.from(b).toString('base64');
    const uno = await chiama('POST', '/api/fatture/ricevute', { nome: 'IT00743110157_00001.xml', dati: b64(ricevutaIt()) });
    assert.equal(uno.stato, 200, JSON.stringify(uno.json)); assert.equal(uno.json.fornitore.nuovo, true); assert.equal(uno.json.importate.length, 1);
    const r1 = (await chiama('GET', `/api/dati/fatture_ricevute/${uno.json.importate[0].id}`)).json;
    assert.deepEqual([r1.numero, r1.data, r1.totale, r1.netto, r1.scadenza, r1.stato, r1.fornitore.titolo], ['A-77', '2026-09-15', 73.2, 73.2, '2026-10-15', 'da_pagare', 'Carta & Penne srl']);
    // lo stesso file firmato: stesso fornitore, fattura già importata
    const due = await chiama('POST', '/api/fatture/ricevute', { nome: 'IT00743110157_00001.xml.p7m', dati: b64(p7mDer(Buffer.from(ricevutaIt()))) });
    assert.equal(due.json.fornitore.nuovo, false); assert.equal(due.json.importate.length, 0); assert.equal(due.json.saltate.length, 1);
    // il servizio estero: due fatture, da integrare
    const est = await chiama('POST', '/api/fatture/ricevute', { nome: 'estero.xml.p7m', dati: b64(p7mBer(Buffer.from(ESTERO, 'latin1'))) });
    assert.equal(est.json.importate.length, 2); assert.ok(est.json.importate.every(x => x.inversione));
    assert.equal((await chiama('POST', '/api/fatture/ricevute', { nome: 'x.xml', dati: b64('non è xml') })).stato, 422);
    // la vista leggibile
    const v = await chiama('GET', `/api/fatture/ricevute/${uno.json.importate[0].id}/vista?lingua=en`);
    assert.ok(v.json.html.includes('Supplier')); assert.ok(v.json.html.includes('Risme di carta &lt;A4&gt;'));
    // l'integrazione TD17, in bozza, poi emessa ed esportata: il file passa lo schema ufficiale
    const integ = await chiama('POST', `/api/fatture/integrazione/${est.json.importate[0].id}`, {});
    assert.equal(integ.stato, 200, JSON.stringify(integ.json)); assert.equal(integ.json.tipo, 'TD17'); assert.equal(integ.json.imposta, 55);
    assert.equal((await chiama('POST', `/api/fatture/integrazione/${est.json.importate[0].id}`, {})).stato, 409);
    assert.equal((await chiama('PATCH', `/api/dati/fatture/${integ.json.id}`, { stato: 'emessa' })).json.numero, '1/AF');
    const x = await chiama('POST', `/api/documenti/fatturapa/${integ.json.id}`); assert.equal(x.stato, 200, JSON.stringify(x.json));
    const f = join(cartella, 'td17.xml'); writeFileSync(f, x.json.xml);
    try { execFileSync('xmllint', ['--noout', '--nonet', '--schema', XSD, f], { stdio: 'pipe' }); } catch (e) { if (e.code !== 'ENOENT') throw new Error('xmllint: ' + e.stderr); }
    assert.match(x.json.xml, /<CedentePrestatore>[\s\S]*<IdPaese>IE<\/IdPaese>[\s\S]*<\/CedentePrestatore>/); assert.match(x.json.xml, /<IdDocumento>INV-1<\/IdDocumento>/);
    // l'emessa via API è bloccata; il bollo e la numerazione hanno le loro rotte
    assert.equal((await chiama('PATCH', `/api/dati/fatture/${integ.json.id}`, { riferimento: 'altro' })).stato, 422);
    assert.equal((await chiama('DELETE', `/api/dati/fatture/${integ.json.id}`)).stato, 422);
    const bollo = (await chiama('GET', '/api/fatture/bollo?anno=2026')).json; assert.equal(bollo.trimestri.length, 4); assert.equal(bollo.totale, 0);
    const num = (await chiama('GET', `/api/fatture/numerazione?anno=${new Date().getFullYear()}`)).json; assert.deepEqual(num.serie.find(s => s.serie === 'AF').mancano, []);
  } finally { srv.close(); }
});

test('un gestionale installato col modello vecchio si aggiorna senza perdere niente (prezzo da centesimi a 8 decimali)', () => {
  const db = apri(); M.installa(db, 'fatture');
  // il modello com'era prima: prezzo in valuta, niente campi nuovi
  const rf = S.leggi(db, 'righe_fattura'); S.applica(db, { ...rf, campi: rf.campi.filter(c => !['sconto_importo', 'no_ritenuta'].includes(c.id)).map(c => (c.id === 'prezzo' ? { ...c, tipo: 'valuta' } : c.id === 'totale' ? { ...c, formula: 'ARROTONDA(quantita * prezzo * (1 - sconto / 100); 2)' } : c)) });
  const fa = S.leggi(db, 'fatture'); S.applica(db, { ...fa, campi: fa.campi.map(c => (c.id === 'importo_ritenuta' ? { id: c.id, nome: c.nome, tipo: 'calcolato', formula: 'ARROTONDA(imponibile * ritenuta / 100; 2)', formato: 'valuta' } : c)) });
  const cl = D.crea(db, 'clienti', { nome: 'Rossi' }), f = D.crea(db, 'fatture', { cliente: cl.id, ritenuta: 20, righe: [{ descrizione: 'x', prezzo: 12.5, aliquota: 22 }, { descrizione: 'spese', prezzo: 10, aliquota: 0, natura: 'N1' }] });
  D.modifica(db, 'fatture', f.id, { stato: 'emessa' });
  assert.equal(S.leggi(db, 'righe_fattura').campi.find(c => c.id === 'prezzo').tipo, 'valuta');
  const r = aggiornaModello(db, S); assert.ok(r.fatto.includes('righe_fattura'));
  assert.equal(S.leggi(db, 'righe_fattura').campi.find(c => c.id === 'prezzo').tipo, 'numero');
  assert.equal(D.leggi(db, 'fatture', f.id).righe[0].prezzo, 12.5);
  // l'emessa tiene la ritenuta con cui è uscita (20% di 22,50, spese comprese come faceva la formula di prima)
  assert.equal(D.leggi(db, 'fatture', f.id).importo_ritenuta, 4.5);
  assert.ok(S.leggi(db, 'righe_fattura').campi.some(c => c.id === 'sconto_importo'));
  assert.deepEqual(aggiornaModello(db, S).fatto, [], 'la seconda volta non c\'è niente da fare');
});

test('bollo: il contributo della cassa senza IVA conta per la soglia di 77,47 € (forfettario con rivalsa INPS)', async () => {
  const { totali } = await import('../server/moduli/documenti-calcoli.js');
  const riga = [{ descrizione: 'Consulenza', prezzo: 75, aliquota: 0, natura: 'N2.2' }];
  assert.equal(totali(riga).serveBollo, false);
  const t = totali(riga, { cassa: { tipo: 'TC22', aliquota: 4, aliquotaIva: 0, natura: 'N2.2' } });
  assert.equal(t.cassa.importo, 3); assert.equal(t.serveBollo, true);
  assert.equal(totali(riga, { cassa: { tipo: 'TC22', aliquota: 4, aliquotaIva: 22 } }).serveBollo, false);
});

test('cassa con IVA a 0: la natura viene dalle righe senza IVA, così la fattura del forfettario si esporta', async () => {
  const { contiFattura, controlla } = await import('../server/moduli/documenti-xml.js');
  const f = { stato: 'emessa', numero: '1', data: '2026-10-07', cassa_tipo: 'TC22', cassa: 4, cassa_iva: 0, righe: [{ descrizione: 'Lezione', quantita: 1, prezzo: 75, aliquota: 0, natura: 'N2.2' }] };
  const c = contiFattura(f); assert.equal(c.cassa.natura, 'N2.2'); assert.equal(c.serveBollo, true);
  const e = controlla(NOI, f, { nome: 'Rossi', piva: '00743110157', codice_destinatario: 'ABC1234', via: 'Via Verdi 2', cap: '00184', comune: 'Roma' });
  assert.ok(!e.some(x => /cassa previdenziale è senza IVA/.test(x)), e.join(' | ')); assert.ok(e.some(x => /77,47/.test(x)));
});

test('aggiornamento dal modello fatture vero di prima (2af0779): niente errori, le emesse col bollo restano com\'erano', () => {
  const vecchio = JSON.parse(readFileSync(join(QUI, 'fatture', 'modello-2af0779.json'), 'utf8'));
  const db = apri(); S.applicaTutte(db, vecchio.entita); for (const a of vecchio.automazioni || []) A.salva(db, a);
  const cl = D.crea(db, 'clienti', { nome: 'Rossi' });
  const em = D.crea(db, 'fatture', { cliente: cl.id, bollo: true, ritenuta: 20, righe: [{ descrizione: 'Corso', prezzo: 100, aliquota: 0, natura: 'N4' }] });
  D.modifica(db, 'fatture', em.id, { stato: 'emessa' });
  // fatture e fatture_ricevute si citano a vicenda: entrano insieme, con l'automazione della data di pagamento
  const r = aggiornaModello(db, S); assert.ok(['fatture_ricevute', 'ddt_fattura', 'fatture', 'righe_fattura'].every(x => r.fatto.includes(x)), JSON.stringify(r));
  const dopo = D.leggi(db, 'fatture', em.id);
  assert.equal(dopo.totale, 100); assert.equal(dopo.netto, 80); assert.equal(dopo.importo_ritenuta, 20); assert.equal(dopo.bollo_tuo, true);
  const fo = D.crea(db, 'fornitori', { nome: 'Carta srl' }), fr = D.crea(db, 'fatture_ricevute', { fornitore: fo.id, numero: 'A1', data: '2026-01-10', totale: 10 }); D.modifica(db, 'fatture_ricevute', fr.id, { stato: 'pagata' });
  assert.match(D.leggi(db, 'fatture_ricevute', fr.id).pagata_il || '', /^\d{4}-/);
  assert.deepEqual(aggiornaModello(db, S).fatto, []);
});
