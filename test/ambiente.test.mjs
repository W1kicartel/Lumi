// Lumi prima si chiamava Kubo: le variabili KUBO_* deprecate e il kubo.db di prima (server/ambiente.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { variabiliVecchie, fileDatabase } from '../server/ambiente.js';
import { apri } from '../server/db.js';

test('variabili: KUBO_* vale come LUMI_* solo se il LUMI_* manca, e si dice quali nomi vecchi ci sono', () => {
  const env = { KUBO_PORTA: '5000', KUBO_DATI: '/vecchia', LUMI_DATI: '/nuova', ALTRO: 'x' };
  assert.deepEqual(variabiliVecchie(env), ['KUBO_PORTA']);
  assert.equal(env.LUMI_PORTA, '5000');
  assert.equal(env.LUMI_DATI, '/nuova');   // il nome nuovo vince sempre
  assert.equal(env.ALTRO, 'x');
  assert.deepEqual(variabiliVecchie(env), []);   // la seconda volta non c'è più niente da copiare
  assert.deepEqual(variabiliVecchie({ LUMI_RETE: '1' }), []);
  const e2 = { KUBO_LUMI_LIMITE: '5' }; variabiliVecchie(e2); assert.equal(e2.LUMI_DOMANDE_MINUTO, '5');   // l'unico nome che cambia anche dopo il prefisso
});

test('database: lumi.db di solito; il kubo.db di prima si rinomina se è chiuso, si usa com\'è se forse è aperto', () => {
  const c = mkdtempSync(join(tmpdir(), 'lumi-ambiente-'));
  try {
    // cartella nuova: lumi.db
    assert.equal(fileDatabase(c), join(c, 'lumi.db'));
    // solo kubo.db, chiuso: diventa lumi.db, con i dati dentro
    const vecchio = apri(join(c, 'kubo.db')); vecchio.exec("CREATE TABLE prova (x TEXT); INSERT INTO prova VALUES ('dati di prima')"); vecchio.close();
    assert.equal(existsSync(join(c, 'kubo.db-wal')), false);
    assert.equal(fileDatabase(c), join(c, 'lumi.db'));
    assert.equal(existsSync(join(c, 'kubo.db')), false);
    const db = apri(join(c, 'lumi.db')); assert.equal(db.prepare('SELECT x FROM prova').get().x, 'dati di prima'); db.close();
    // con tutti e due: vince lumi.db e kubo.db resta dov'è
    writeFileSync(join(c, 'kubo.db'), 'vecchio');
    assert.equal(fileDatabase(c), join(c, 'lumi.db'));
    assert.equal(readFileSync(join(c, 'kubo.db'), 'utf8'), 'vecchio');
  } finally { rmSync(c, { recursive: true, force: true }); }
  const d = mkdtempSync(join(tmpdir(), 'lumi-ambiente-'));
  try {
    // kubo.db con il -wal accanto (forse un server vecchio è ancora acceso): non si tocca, si usa così
    writeFileSync(join(d, 'kubo.db'), 'x'); writeFileSync(join(d, 'kubo.db-wal'), 'x');
    assert.equal(fileDatabase(d), join(d, 'kubo.db'));
    assert.equal(existsSync(join(d, 'kubo.db')), true);
    assert.equal(existsSync(join(d, 'lumi.db')), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
