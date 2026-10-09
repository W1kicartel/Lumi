// L'XML FatturaPA: l'invio allo SDI (xmlDi) prende un progressivo nuovo ogni volta, la copia per archivio ed email
// (copiaXmlDi) non tocca il contatore e riusa il nome del file già inviato. Contro un finto Openapi, senza rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';
import * as X from '../server/moduli/documenti-xml.js';
import { xmlDi, copiaXmlDi } from '../connettori/openapi-sdi/connettore.js';
import { documentoDi } from '../connettori/_comunica/documento.js';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234', email: 'rossi@cliente.example' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return e.json;
}
const contatore = K => K.db.prepare("SELECT ultimo FROM _numeratori WHERE serie = 'fatturapa'").get()?.ultimo ?? 0;
const progressivo = x => /<ProgressivoInvio>(\w+)<\/ProgressivoInvio>/.exec(x)?.[1];

test('copia dell\'XML: mai inviata = progressivo fisso dall\'id; dopo l\'invio = stesso file dello SDI; il contatore non si muove', async () => {
  const K = await kubo(['negozio', 'fatture']), n = { uuid: 0 };
  const S = await finto({ 'POST /invoices': () => ({ data: { uuid: `o-${++n.uuid}` } }) });
  try {
    await accendi(K, 'openapi-sdi', { base: S.url, segreti: { token: 'tok-prova' } });
    const f = await fattura(K), k = K.nucleo.k('openapi-sdi'), riga = k.dati.leggi('fatture', f.id), c0 = contatore(K);
    // mai inviata: due copie uguali, progressivo ricavato dall'id, nessun numero consumato
    const a = copiaXmlDi(k, riga), b = copiaXmlDi(k, riga);
    assert.equal(contatore(K), c0); assert.equal(a.nome, b.nome); assert.equal(a.xml, b.xml);
    assert.equal(a.nome, `IT12345678903_${X.progressivoCopia(f.id)}.xml`); assert.equal(progressivo(a.xml), X.progressivoCopia(f.id));
    // l'invio vero: un progressivo nuovo
    const r = await K.chiama('POST', '/api/connettori/openapi-sdi/azioni/invia', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.match(r.json.file, /^IT12345678903_\w{5}\.xml$/);
    assert.equal(contatore(K), c0 + 1);
    const mandato = S.chiamate.find(c => c.percorso === '/invoices').corpo;
    // dopo l'invio: le copie hanno il nome e il contenuto del file mandato allo SDI, e il contatore resta fermo
    const c = copiaXmlDi(k, riga), d = copiaXmlDi(k, riga);
    assert.equal(c.nome, r.json.file); assert.equal(d.nome, r.json.file); assert.equal(c.xml, mandato);
    assert.equal(contatore(K), c0 + 1);
    // la copia per l'archivio (documentoDi, usata da Drive, Dropbox, S3, WebDAV e dalle email): stesso XML, contatore fermo
    const file = documentoDi(k, 'fatture', riga), xml = file.find(x => x.tipo === 'application/xml');
    assert.ok(xml, 'manca l\'XML'); assert.equal(xml.contenuto.toString('utf8'), mandato);
    documentoDi(k, 'fatture', riga); assert.equal(contatore(K), c0 + 1);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('xmlDi (invio allo SDI) consuma un progressivo nuovo a ogni chiamata; la copia segue l\'ultimo invio', async () => {
  const K = await kubo(['negozio', 'fatture']);
  try {
    await accendi(K, 'openapi-sdi', { segreti: { token: 'tok-prova' } });
    const f = await fattura(K), k = K.nucleo.k('openapi-sdi'), riga = k.dati.leggi('fatture', f.id), c0 = contatore(K);
    const uno = xmlDi(k, riga); assert.equal(contatore(K), c0 + 1);
    const due = xmlDi(k, riga); assert.equal(contatore(K), c0 + 2);
    assert.notEqual(uno.nome, due.nome); assert.notEqual(progressivo(uno.xml), progressivo(due.xml));
    assert.equal(progressivo(due.xml), X.progressivoDa(c0 + 2));
    const copia = copiaXmlDi(k, riga); assert.equal(copia.nome, due.nome); assert.equal(copia.xml, due.xml);
    assert.equal(contatore(K), c0 + 2);
  } finally { await K.chiudi(); }
});
