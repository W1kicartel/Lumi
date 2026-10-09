// Il catalogo dei connettori ufficiali: ogni connettore in connettori/ ha un blocco «catalogo» valido (categoria, costo e
// difficoltà ammessi, passi, credenziali e fonti non vuoti, descrizione nelle sei lingue, guida in italiano e in inglese).
// Un connettore nuovo senza il blocco fa fallire questo test con il suo nome e cosa manca (docs/CONNETTORI.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifesti, generaCatalogo, problemi } from '../strumenti/catalogo.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { controllaCatalogo, vistaCatalogo, testoRicerca } from '../server/moduli/connettori-catalogo.js';

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
  // una chiave delle traduzioni scritta male non si perde in silenzio; le voci tradotte sono testi
  const storto = controllaCatalogo({ ...man, testi: { ...man.testi, es: { descrizione: 'Prueba', 'cat.pasi': ['a'], 'cat.serve': [{ cosa: 'Clave' }] }, de: { descrizione: 'Test', cat: { passi: [] } } } });
  assert.ok(storto.some(p => /testi\.es\['cat\.pasi'\]: chiave sconosciuta/.test(p)) && storto.some(p => /testi\.de\['cat'\]/.test(p)) && storto.some(p => /testi\.es\['cat\.serve'\]/.test(p)), storto.join(' | '));
  // un manifesto di terzi con il blocco storto non rompe la vista né la ricerca della libreria
  assert.deepEqual(vistaCatalogo({ catalogo: { serve: 'x', passi: 3, zone: 'IT', parole: 5, fonti: 'f' } }, 'it', true).serve, []);
  assert.equal(testoRicerca({ catalogo: { parole: 5 } }, 'x'), 'x');
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

// «npm run catalogo -- --controlla» fallisce anche quando docs/CATALOGO.md non è quello che si rigenererebbe adesso
test('--controlla: docs/CATALOGO.md vecchio o mancante è un problema', () => {
  const giusto = generaCatalogo(lista);
  assert.deepEqual(problemi(lista, giusto), []);
  assert.deepEqual(problemi(lista, giusto.replace('# Catalogo', '# Catalogo vecchio')), [['docs/CATALOGO.md', ['non è aggiornato: npm run catalogo']]]);
  assert.match(problemi(lista, null)[0][1][0], /manca/);
  // e il comando vero: 1 su un file vecchio o mancante, 0 su quello giusto (scritti in una cartella temporanea)
  const dir = mkdtempSync(join(tmpdir(), 'kubo-catalogo-')), cli = join(import.meta.dirname, '..', 'strumenti', 'catalogo.mjs');
  const esce = file => { try { execFileSync(process.execPath, [cli, '--controlla', '--file', file], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  writeFileSync(join(dir, 'vecchio.md'), giusto + '\nriga in più\n'); writeFileSync(join(dir, 'giusto.md'), giusto);
  assert.equal(esce(join(dir, 'vecchio.md')), 1); assert.equal(esce(join(dir, 'manca.md')), 1); assert.equal(esce(join(dir, 'giusto.md')), 0);
});
