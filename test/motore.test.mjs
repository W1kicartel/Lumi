import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apri } from '../server/db.js';
import * as S from '../server/schema.js';
import * as D from '../server/dati.js';
import * as A from '../server/automazioni.js';
import * as M from '../server/modelli.js';
import { calcola } from '../server/formule.js';

A.attiva();
const nuovo = () => { const db = apri(); M.installa(db, 'negozio'); return db; };

test('formule', () => {
  assert.equal(calcola('2 + 3 * 4', {}), 14);
  assert.equal(calcola('SE(a > 1; "sì"; "no")', { valori: { a: 2 } }), 'sì');
  assert.equal(calcola('SOMMA(righe.t)', { valori: { righe: [{ t: 2 }, { t: 3.5 }] } }), 5.5);
  assert.equal(calcola('GIORNI("2026-01-01"; "2026-01-31")', {}), 30);
  assert.equal(calcola('"a" & 1', {}), 'a1');
  assert.equal(calcola('NON (1 > 2) E VERO', {}), true);
  assert.throws(() => calcola('SOMMA(1;', {}));
  assert.throws(() => calcola('process.exit()', {}));
});

test('modello negozio: vendita con righe, numeratore, calcolati, scarico e reso', () => {
  const db = nuovo();
  const f = D.crea(db, 'fornitori', { nome: 'Ceramiche Rossi' });
  const a = D.crea(db, 'articoli', { codice: 'T01', nome: 'Tazza blu', prezzo: 12.5, costo: 5, giacenza: 10, soglia: 3, fornitore: f.id });
  assert.equal(a.prezzo, 12.5); assert.equal(a.da_riordinare, false); assert.equal(a.margine, 60); assert.equal(a.fornitore.titolo, 'Ceramiche Rossi');
  const v = D.crea(db, 'vendite', { righe: [{ articolo: a.id, quantita: 8, prezzo: 12.5, sconto: 10 }] });
  assert.match(v.numero, /^V-\d{4}-0001$/); assert.equal(v.stato, 'aperta'); assert.equal(v.totale, 90); assert.equal(v.righe.length, 1);
  D.modifica(db, 'vendite', v.id, { stato: 'pagata' });
  let art = D.leggi(db, 'articoli', a.id); assert.equal(art.giacenza, 2); assert.equal(art.da_riordinare, true);
  assert.throws(() => D.modifica(db, 'vendite', v.id, { stato: 'aperta' }), /non si può passare/);
  D.modifica(db, 'vendite', v.id, { stato: 'annullata' });
  art = D.leggi(db, 'articoli', a.id); assert.equal(art.giacenza, 10);
  const v2 = D.crea(db, 'vendite', {}); assert.match(v2.numero, /0002$/);
});

test('validazione, unicità, filtri, ricerca', () => {
  const db = nuovo();
  assert.throws(() => D.crea(db, 'clienti', {}), /obbligatorio/);
  assert.throws(() => D.crea(db, 'clienti', { nome: 'X', email: 'non-email' }), /email non valida/);
  D.crea(db, 'clienti', { nome: 'Anna Bianchi', email: 'anna@esempio.it', tipo: 'privato' });
  assert.throws(() => D.crea(db, 'clienti', { nome: 'Altra', email: 'ANNA@esempio.it' }), /unico/);
  D.crea(db, 'clienti', { nome: 'Bottega Verdi', tipo: 'azienda' });
  assert.equal(D.elenca(db, 'clienti', { cerca: 'anna' }).totale, 1);
  assert.equal(D.elenca(db, 'clienti', { filtri: [{ campo: 'tipo', op: '=', valore: 'azienda' }] }).righe[0].nome, 'Bottega Verdi');
  for (let i = 0; i < 5; i++) D.crea(db, 'articoli', { nome: 'A' + i, giacenza: i, soglia: 2 });
  assert.equal(D.elenca(db, 'articoli', { filtri: [{ campo: 'da_riordinare', op: '=', valore: true }] }).totale, 3);
  assert.equal(D.elenca(db, 'articoli', { ordina: [{ campo: 'giacenza', dir: 'desc' }] }).righe[0].nome, 'A4');
});

test('lo schema non perde dati: rinomina, archivia, cambio tipo', () => {
  const db = nuovo();
  const c = D.crea(db, 'clienti', { nome: 'Luca', note: '42' });
  const def = S.leggi(db, 'clienti');
  S.applica(db, { ...def, campi: def.campi.map(x => x.id === 'nome' ? { ...x, nome: 'Nome e cognome' } : x).filter(x => x.id !== 'telefono') });
  const d2 = S.leggi(db, 'clienti');
  assert.equal(S.campo(d2, 'nome').nome, 'Nome e cognome'); assert.equal(S.campo(d2, 'telefono').archiviato, true);
  assert.equal(D.leggi(db, 'clienti', c.id).nome, 'Luca');
  S.applica(db, { ...d2, campi: d2.campi.map(x => x.id === 'note' ? { ...x, tipo: 'numero' } : x) });
  assert.equal(D.leggi(db, 'clienti', c.id).note, 42);
});

test('il cambio di tipo che perderebbe valori viene rifiutato', () => {
  const db = nuovo();
  D.crea(db, 'clienti', { nome: 'Luca' });
  const d = S.leggi(db, 'clienti');
  assert.throws(() => S.applica(db, { ...d, campi: d.campi.map(x => x.id === 'nome' ? { ...x, tipo: 'numero' } : x) }), /perderebbe/);
  assert.throws(() => S.applica(db, { ...d, campi: [...d.campi, { id: 'x', nome: 'X', tipo: 'calcolato', formula: 'inesistente + 1' }] }), /non valida/);
});

test('eliminare archivia, ripristina riporta anche le righe', () => {
  const db = nuovo();
  const a = D.crea(db, 'articoli', { nome: 'Vaso' });
  const v = D.crea(db, 'vendite', { righe: [{ articolo: a.id, quantita: 1, prezzo: 10 }] });
  D.elimina(db, 'vendite', v.id);
  assert.equal(D.elenca(db, 'vendite').totale, 0); assert.equal(D.elenca(db, 'vendite', { archiviati: true }).totale, 1);
  assert.equal(D.ripristina(db, 'vendite', v.id).totale, 10);
  assert.ok(D.storia(db, 'vendite', v.id).length >= 3);
});

test('i tre modelli si installano insieme e le automazioni girano', () => {
  const db = apri(); for (const m of ['negozio', 'laboratorio', 'studio']) M.installa(db, m);
  const c = D.crea(db, 'clienti', { nome: 'Marta' });
  const p = D.crea(db, 'preventivi', { cliente: c.id, oggetto: 'Tavolo in noce', voci: [{ descrizione: 'Tavolo', quantita: 1, prezzo: 900 }] });
  assert.equal(p.totale, 1098);
  D.modifica(db, 'preventivi', p.id, { stato: 'inviato' }); D.modifica(db, 'preventivi', p.id, { stato: 'accettato' });
  const comm = D.elenca(db, 'commesse').righe[0]; assert.equal(comm.titolo, 'Tavolo in noce'); assert.equal(comm.prezzo, 900); assert.equal(comm.cliente.titolo, 'Marta');
  const pk = D.crea(db, 'pacchetti', { nome: '10 sedute', cliente: c.id });
  const ap = D.crea(db, 'appuntamenti', { quando: '2026-10-08T09:00:00Z', cliente: c.id, pacchetto: pk.id });
  D.modifica(db, 'appuntamenti', ap.id, { stato: 'fatto' });
  assert.equal(D.leggi(db, 'pacchetti', pk.id).rimaste, 9);
});
