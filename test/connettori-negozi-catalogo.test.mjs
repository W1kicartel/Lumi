// I connettori dei negozi, dei marketplace e delle spedizioni rispettano il contratto del catalogo e hanno i testi brevi
// nelle sei lingue (nome, descrizione, impostazioni, aiuti, azioni, giri) e le guide almeno in inglese.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CARTELLA = join(dirname(fileURLToPath(import.meta.url)), '..', 'connettori');
const NOSTRI = ['prestashop', 'magento', 'bigcommerce', 'ecwid', 'squarespace', 'wix', 'amazon', 'ebay', 'etsy', 'sendcloud', 'qapla', 'packlink', 'dhl', 'ups', 'fedex'];
const LINGUE = ['en', 'es', 'fr', 'de', 'pt'];

test('negozi e spedizioni: catalogo completo e testi nelle sei lingue', async () => {
  for (const id of NOSTRI) {
    const f = join(CARTELLA, id, 'connettore.js'); assert.ok(existsSync(f), id);
    const m = (await import(pathToFileURL(f).href)).default, c = m.catalogo, dove = `${id}:`;
    assert.equal(m.id, id);
    assert.ok(['negozi-online', 'marketplace', 'spedizioni'].includes(c?.categoria), dove + ' categoria');
    assert.match(c.sito, /^https:\/\//, dove + ' sito');
    assert.ok(['gratis', 'a-consumo', 'abbonamento', 'contratto'].includes(c.costo), dove + ' costo');
    assert.ok(c.costoNota?.length > 20, dove + ' costoNota');
    assert.ok(c.serve?.length && c.serve.every(s => s.cosa && s.dove && /^https:\/\//.test(s.link)), dove + ' serve');
    assert.ok(c.passi?.length >= 3 && c.passi.length <= 8, dove + ' passi');
    assert.ok(['facile', 'media', 'difficile'].includes(c.difficolta), dove + ' difficoltà');
    assert.ok(c.zone?.length && c.zone.every(z => ['IT', 'UE', 'mondo'].includes(z)), dove + ' zone');
    assert.ok(c.fonti?.length && c.fonti.every(u => /^https:\/\//.test(u)), dove + ' fonti');
    assert.equal(c.prova, 'finto'); assert.ok(c.parole?.length >= 4, dove + ' parole');
    const en = m.testi?.en || {};
    assert.equal(typeof en['cat.costoNota'], 'string', dove + ' cat.costoNota');
    assert.equal(en['cat.passi']?.length, c.passi.length, dove + ' cat.passi');
    assert.equal(en['cat.serve']?.length, c.serve.length, dove + ' cat.serve'); assert.ok(en['cat.serve'].every(s => s.cosa && s.dove), dove + ' cat.serve');
    const chiavi = ['descrizione', ...(m.impostazioni || []).map(i => `imp.${i.id}`), ...(m.impostazioni || []).filter(i => i.aiuto).map(i => `aiuto.${i.id}`),
      ...Object.keys(m.azioni || {}).map(a => `az.${a}`), ...Object.keys(m.pianificati || {}).map(g => `giro.${g}`)];
    for (const l of LINGUE) for (const k of chiavi) assert.ok(typeof m.testi?.[l]?.[k] === 'string' && m.testi[l][k], `${dove} manca ${l}.${k}`);
  }
  // nessun connettore in più di quelli elencati qui senza un controllo (le cartelle «_» sono attrezzi, non connettori)
  assert.ok(readdirSync(CARTELLA).includes('_negozi'));
});
