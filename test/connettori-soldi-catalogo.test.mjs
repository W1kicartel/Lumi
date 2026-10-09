// Il contratto del catalogo per i connettori dei soldi (pagamenti, cassa, fatturazione, contabilità, banche, dati delle
// aziende, firma): la scheda della libreria, la guida in italiano e in inglese, le traduzioni brevi nelle cinque lingue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { kubo } from './connettori-finto.mjs';

const CARTELLA = new URL('../connettori/', import.meta.url);
const CATEGORIE = ['pagamenti', 'cassa', 'fatturazione', 'contabilita', 'banche', 'dati-aziende', 'firma'];
const ATTESI = ['satispay', 'paypal', 'nexi-xpay', 'mollie', 'square', 'gocardless', 'vies', 'openapi-imprese', 'fatture-in-cloud', 'aruba-fe', 'acube', 'invoicetronic', 'enable-banking', 'qonto', 'revolut-business', 'yousign'];
const LINGUE = ['en', 'es', 'fr', 'de', 'pt'];
const https = s => typeof s === 'string' && /^https:\/\/[^\s]+$/.test(s);

const tutti = [];
for (const n of readdirSync(CARTELLA).filter(n => /^[a-z][a-z0-9-]{1,40}$/.test(n)).sort()) {
  if (!existsSync(new URL(`${n}/connettore.js`, CARTELLA))) continue;
  const man = (await import(new URL(`${n}/connettore.js`, CARTELLA).href)).default;
  if (CATEGORIE.includes(man?.catalogo?.categoria) || ATTESI.includes(n)) tutti.push([n, man]);
}

test('i connettori dei soldi ci sono tutti', () => {
  const ids = tutti.map(([n]) => n);
  for (const id of ATTESI) assert.ok(ids.includes(id), `manca ${id}`);
});

for (const [n, man] of tutti) test(`catalogo e testi: ${n}`, () => {
  assert.equal(man.id, n); assert.ok(man.nome && man.descrizione && man.icona && man.versione);
  const c = man.catalogo; assert.ok(c, 'manca il catalogo');
  assert.ok(CATEGORIE.includes(c.categoria), c.categoria);
  assert.ok(https(c.sito), 'sito');
  assert.ok(['gratis', 'a-consumo', 'abbonamento', 'contratto'].includes(c.costo), c.costo);
  assert.ok(typeof c.costoNota === 'string' && c.costoNota.length > 20, 'costoNota');
  assert.ok(Array.isArray(c.serve) && c.serve.length >= 1);
  for (const s of c.serve) { assert.ok(s.cosa && s.dove, JSON.stringify(s)); assert.ok(https(s.link), `link di «${s.cosa}»`); }
  assert.ok(Array.isArray(c.passi) && c.passi.length >= 3 && c.passi.length <= 8, `passi: ${c.passi?.length}`);
  assert.ok(['facile', 'media', 'difficile'].includes(c.difficolta));
  assert.ok(Array.isArray(c.zone) && c.zone.length && c.zone.every(z => ['IT', 'UE', 'mondo'].includes(z)), JSON.stringify(c.zone));
  assert.ok(Array.isArray(c.fonti) && c.fonti.length && c.fonti.every(https), 'fonti');
  assert.equal(c.prova, 'finto');
  assert.ok(Array.isArray(c.parole) && c.parole.length >= 3);
  // la guida in inglese, con le stesse voci
  const en = man.testi?.en || {};
  assert.ok(typeof en['cat.costoNota'] === 'string' && en['cat.costoNota'].length > 20, 'en cat.costoNota');
  assert.equal(en['cat.passi']?.length, c.passi.length, 'en cat.passi');
  assert.equal(en['cat.serve']?.length, c.serve.length, 'en cat.serve');
  for (const s of en['cat.serve']) assert.ok(s.cosa && s.dove);
  // le stringhe brevi in tutte le lingue
  const chiavi = ['descrizione', ...(man.impostazioni || []).map(i => `imp.${i.id}`), ...Object.keys(man.azioni || {}).map(a => `az.${a}`), ...Object.keys(man.pianificati || {}).map(g => `giro.${g}`)];
  for (const l of LINGUE) for (const k of chiavi) assert.ok(man.testi?.[l]?.[k], `${n}: manca ${l}.${k}`);
  // gli strumenti di Lumi: nomi validi per i modelli (al massimo 64 caratteri) e una descrizione
  for (const [a, d] of Object.entries(man.azioni || {})) if (d.lumi) {
    assert.match(`connettore_${n}_${a}`.replace(/-/g, '_'), /^[a-z0-9_]{1,64}$/);
    assert.ok(d.descrizione, `${n}.${a}: lo strumento di Lumi senza descrizione`);
    if (d.scrive) assert.equal(typeof d.proponi, 'function', `${n}.${a}: scrive senza anteprima`);
  }
});

test('il nucleo li carica tutti, senza manifesti rotti, con le traduzioni nella pagina', async () => {
  const K = await kubo(['negozio', 'fatture']);
  try {
    const l = (await K.chiama('GET', '/api/connettori')).json;
    for (const [n] of tutti) { const x = l.find(c => c.id === n); assert.ok(x && !x.rotto, `${n}: ${x?.rotto}`); }
    const en = (await K.chiama('GET', '/api/connettori/satispay', null, { intestazioni: { 'Accept-Language': 'en' } })).json;
    assert.ok(en.descrizione);
  } finally { await K.chiudi(); }
});
