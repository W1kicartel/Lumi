// Il registratore telematico Epson contro un finto fpmate.cgi: documento commerciale della vendita (reparti per aliquota,
// sconto, pagamento), niente doppio scontrino, emissione automatica quando la vendita diventa pagata, chiusura giornaliera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';

const risposta = (n, extra = '') => ({ stato: 200, intestazioni: { 'Content-Type': 'text/xml' }, corpo: `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><response success="true" code="" status="2"><addInfo><elementList>fiscalReceiptNumber,zRepNumber</elementList><lastCommand>74</lastCommand><printerStatus>20110</printerStatus><fiscalReceiptNumber>${n}</fiscalReceiptNumber><fiscalReceiptAmount>60,00</fiscalReceiptAmount><zRepNumber>0042</zRepNumber>${extra}</addInfo></response></soapenv:Body></soapenv:Envelope>` });

test('Epson RT: scontrino della vendita (reparto da aliquota, sconto, carta), una volta sola, automatico al «pagata», chiusura', async () => {
  const K = await kubo(); const ricevuti = []; let n = 0;
  const S = await finto({ 'POST /cgi-bin/fpmate.cgi': (p, corpo, { q }) => { assert.equal(q.get('devid'), 'local_printer'); ricevuti.push(String(corpo)); return risposta(String(++n).padStart(4, '0')); } });
  try {
    const a1 = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso <grande> & bello', codice: 'V1', prezzo: 30, giacenza: 5, iva: 22 })).json;
    const a2 = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Libro', codice: 'L1', prezzo: 10, giacenza: 5, iva: 4 })).json;
    const v = (await K.chiama('POST', '/api/dati/vendite', { pagamento: 'carta', righe: [{ articolo: a1.id, quantita: 2, prezzo: 30, sconto: 10 }, { articolo: a2.id, quantita: 1, prezzo: 10 }] })).json;
    await accendi(K, 'epson-rt', { impostazioni: { indirizzo: S.url, reparti: '22:1, 10:2, 4:3, 0:4' } });
    assert.equal((await K.chiama('POST', '/api/connettori/epson-rt/prova')).json.ok, true);
    assert.match(ricevuti[0], /<queryPrinterStatus operator="1" statusType="1" \/>/);
    const r = await K.chiama('POST', '/api/connettori/epson-rt/azioni/scontrino', { args: { vendita: v.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.scontrino, '0042-0002');
    const x = ricevuti[1];
    assert.match(x, /^<\?xml[\s\S]*<s:Body><printerFiscalReceipt><beginFiscalReceipt operator="1" \/>/);
    assert.match(x, /description="VASO &lt;GRANDE&gt; &amp; BELLO" quantity="2,000" unitPrice="30,00" department="1"/);
    assert.match(x, /<printRecItemAdjustment operator="1" adjustmentType="0" description="SCONTO 10%" amount="6,00" department="1"/);
    assert.match(x, /description="LIBRO" quantity="1,000" unitPrice="10,00" department="3"/);
    assert.match(x, /<printRecTotal operator="1" description="PAGAMENTO ELETTRONICO" payment="64,00" paymentType="2" index="1"/);
    assert.equal((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.stato, 'pagata');
    assert.equal((await K.chiama('POST', '/api/connettori/epson-rt/azioni/scontrino', { args: { vendita: v.id } })).stato, 502);   // mai due volte
    assert.equal(ricevuti.length, 2);
    // automatico: la vendita segnata pagata in Kubo va in coda e si stampa una volta
    await K.chiama('PUT', '/api/connettori/epson-rt', { impostazioni: { automatico: true } });
    const v2 = (await K.chiama('POST', '/api/dati/vendite', { righe: [{ articolo: a2.id, quantita: 1, prezzo: 10 }] })).json;
    await K.chiama('PATCH', `/api/dati/vendite/${v2.id}`, { stato: 'pagata', pagamento: 'contanti' });
    for (let i = 0; i < 50 && ricevuti.length < 3; i++) await new Promise(r => setTimeout(r, 20));   // la coda lavora dopo la transazione (al massimo 1 s)
    assert.equal(ricevuti.length, 3); assert.match(ricevuti[2], /description="CONTANTI" payment="10,00" paymentType="0" index="0"/);
    await K.nucleo.lavora(); assert.equal(ricevuti.length, 3);
    const z = await K.chiama('POST', '/api/connettori/epson-rt/azioni/chiusura', { args: {} });
    assert.equal(z.stato, 200, JSON.stringify(z.json)); assert.match(ricevuti[3], /<printerFiscalReport><printZReport operator="1" \/><\/printerFiscalReport>/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Epson RT: il registratore risponde con un errore → nessun collegamento, si può riprovare', async () => {
  const K = await kubo(); let fallisci = true;
  const S = await finto({ 'POST /cgi-bin/fpmate.cgi': () => (fallisci ? { stato: 200, intestazioni: { 'Content-Type': 'text/xml' }, corpo: '<response success="false" code="EPTR_REC_EMPTY" status="2"><addInfo><printerStatus>20080</printerStatus></addInfo></response>' } : risposta('0007')) });
  try {
    const a = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'V1', prezzo: 30, giacenza: 5 })).json;
    const v = (await K.chiama('POST', '/api/dati/vendite', { righe: [{ articolo: a.id, quantita: 1, prezzo: 30 }] })).json;
    await accendi(K, 'epson-rt', { impostazioni: { indirizzo: S.url } });
    const r = await K.chiama('POST', '/api/connettori/epson-rt/azioni/scontrino', { args: { vendita: v.id } });
    assert.equal(r.stato, 502); assert.match(JSON.stringify(r.json), /EPTR_REC_EMPTY/);   // carta finita
    assert.equal((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.stato, 'aperta');
    fallisci = false;
    assert.equal((await K.chiama('POST', '/api/connettori/epson-rt/azioni/scontrino', { args: { vendita: v.id } })).json.scontrino, '0042-0007');
  } finally { await K.chiudi(); await S.chiudi(); }
});
