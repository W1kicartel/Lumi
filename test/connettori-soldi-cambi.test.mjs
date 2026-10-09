// I cambi BCE contro un finto sito della BCE: ultimo fixing, data passata dal file dei 90 giorni, valute non pubblicate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, gestionale, accendi } from './connettori-finto.mjs';

const cubo = (data, tassi) => `<Cube time='${data}'>${Object.entries(tassi).map(([v, t]) => `<Cube currency='${v}' rate='${t}'/>`).join('')}</Cube>`;
const xml = giorni => ({ stato: 200, intestazioni: { 'Content-Type': 'text/xml' }, corpo: `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject><Cube>${giorni.join('')}</Cube></gesmes:Envelope>` });

test('Cambi BCE: converti con l\'ultimo cambio, una data passata (giorno festivo → il lavorativo prima), valuta sconosciuta', async () => {
  const K = await gestionale(); let giornalieri = 0;
  const S = await finto({
    'GET /stats/eurofxref/eurofxref-daily.xml': () => { giornalieri++; return xml([cubo('2026-10-08', { USD: '1.1000', GBP: '0.8500', CHF: '0.9400' })]); },
    'GET /stats/eurofxref/eurofxref-hist-90d.xml': () => xml([cubo('2026-10-08', { USD: '1.1000' }), cubo('2026-09-04', { USD: '1.2500', GBP: '0.8000' }), cubo('2026-09-03', { USD: '1.2400' })]),
  });
  try {
    await accendi(K, 'bce-cambi', { base: S.url });
    assert.equal((await K.chiama('POST', '/api/connettori/bce-cambi/prova')).json.ok, true);
    const c = (await K.chiama('POST', '/api/connettori/bce-cambi/azioni/converti', { args: { importo: 1100, da: 'usd', a: 'EUR' } })).json;
    assert.deepEqual({ risultato: c.risultato, data: c.data, da: c.da }, { risultato: 1000, data: '2026-10-08', da: 'USD' });
    const g = (await K.chiama('POST', '/api/connettori/bce-cambi/azioni/converti', { args: { importo: '100', da: 'GBP', a: 'USD' } })).json;
    assert.equal(g.risultato, 129.41); assert.equal(giornalieri, 2);   // la prova e la prima conversione; poi il cambio resta in memoria per 6 ore
    // sabato 5 settembre: vale il fixing di venerdì 4
    const p = (await K.chiama('POST', '/api/connettori/bce-cambi/azioni/converti', { args: { importo: 250, da: 'EUR', a: 'USD', data: '2026-09-05' } })).json;
    assert.deepEqual({ risultato: p.risultato, data: p.data }, { risultato: 312.5, data: '2026-09-04' });
    const no = await K.chiama('POST', '/api/connettori/bce-cambi/azioni/converti', { args: { importo: 1, da: 'XYZ', a: 'EUR' } });
    assert.equal(no.stato, 502); assert.match(JSON.stringify(no.json), /XYZ/);
    const t = (await K.chiama('POST', '/api/connettori/bce-cambi/azioni/tassi', { args: {} })).json; assert.equal(t.tassi.CHF, 0.94);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/bce-cambi/giri/tassi')).json.risultato, { data: '2026-10-08', valute: 4 });
  } finally { await K.chiudi(); await S.chiudi(); }
});
