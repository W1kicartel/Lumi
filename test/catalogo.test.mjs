// Il catalogo dei connettori ufficiali: ogni connettore in connettori/ ha un blocco «catalogo» valido (categoria, costo e
// difficoltà ammessi, passi, credenziali e fonti non vuoti, descrizione nelle sei lingue, guida in italiano e in inglese).
// Un connettore nuovo senza il blocco fa fallire questo test con il suo nome e cosa manca (docs/CONNETTORI.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifesti, generaCatalogo } from '../strumenti/catalogo.mjs';
import { controllaCatalogo, vistaCatalogo } from '../server/moduli/connettori-catalogo.js';

const lista = await manifesti();

test('ogni connettore ufficiale ha un blocco «catalogo» valido', () => {
  assert.ok(lista.length >= 13, `trovati solo ${lista.length} connettori`);
  const male = lista.map(x => [x.id, x.rotto ? [`il manifesto non si carica: ${x.rotto}`] : controllaCatalogo(x.man)]).filter(([, p]) => p.length);
  assert.deepEqual(male.map(([id, p]) => `connettori/${id}: ${p.join('; ')}`), [], 'connettori con il catalogo da sistemare (docs/CONNETTORI.md, «Il blocco catalogo»)');
});

test('il controllo del catalogo trova quello che manca, e la vista ripiega lingua → en → it', () => {
  assert.match(controllaCatalogo({ id: 'x' })[0], /manca il blocco «catalogo»/);
  const man = { descrizione: 'Prova', catalogo: { categoria: 'pagamenti', costo: 'gratis', difficolta: 'facile', zone: ['IT'], sito: 'https://esempio.it', prova: 'finto',
    passi: ['Uno', 'Due', 'Tre'], serve: [{ cosa: 'Chiave', dove: 'Impostazioni', link: 'https://esempio.it/chiavi' }], fonti: ['https://esempio.it/doc'] },
  testi: { en: { descrizione: 'Test', 'cat.passi': ['One', 'Two', 'Three'], 'cat.serve': [{ cosa: 'Key', dove: 'Settings' }] }, es: { descrizione: 'Prueba' }, fr: { descrizione: 'Essai' }, de: { descrizione: 'Test' }, pt: { descrizione: 'Teste' } } };
  assert.deepEqual(controllaCatalogo(man), []);
  assert.ok(controllaCatalogo({ ...man, catalogo: { ...man.catalogo, categoria: 'boh', passi: ['uno'] } }).some(p => /categoria «boh»/.test(p)));
  assert.ok(controllaCatalogo({ ...man, testi: { ...man.testi, en: { descrizione: 'Test' } } }).some(p => /cat\.passi/.test(p)));
  assert.ok(controllaCatalogo({ ...man, testi: { en: man.testi.en } }).some(p => /testi\.es\.descrizione/.test(p)));
  const de = vistaCatalogo(man, 'de', true), it = vistaCatalogo(man, 'it', true);
  assert.equal(de.passi[0], 'One'); assert.deepEqual(de.serve[0], { cosa: 'Key', dove: 'Settings', link: 'https://esempio.it/chiavi' });
  assert.equal(it.passi[0], 'Uno');
  assert.ok(!('passi' in vistaCatalogo(man, 'it')));
});

test('npm run catalogo: il Markdown ha tutti i connettori con il catalogo, per categoria, e chi non ce l\'ha', () => {
  const s = generaCatalogo([...lista, { id: 'senza', man: { nome: 'Senza', descrizione: '' } }]);
  for (const { id, man } of lista) if (man?.catalogo) assert.ok(s.includes(`\`${id}\``), id);
  assert.match(s, /## Pagamenti \(\d+\)/); assert.match(s, /## Automazione \(\d+\)/);
  assert.match(s, /## Senza blocco catalogo\n\n- `senza`/);
  assert.match(s, /\| \[Stripe\]\(#stripe\) \| Pagamenti \| A consumo \| Media \| servizio finto \|/);
});
