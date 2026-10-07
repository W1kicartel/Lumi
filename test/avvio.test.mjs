import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apri, meta } from '../server/db.js';
import * as D from '../server/dati.js';
import * as M from '../server/modelli.js';
import * as S from '../server/schema.js';
import * as A from '../server/automazioni.js';
import * as P from '../server/permessi.js';
import * as U from '../server/auth.js';
import { attiva } from '../server/automazioni.js';
import { creaServer } from '../server/api.js';
import { SETTORI, DOMANDE, piano, installaPiano, mettiEsempi, togliEsempi, quantiEsempi, cruscotto } from '../server/moduli/avvio-piano.js';
import { aggrega } from '../server/moduli/agenda-aggregati.js';

attiva();
const NUOVI = ['ristorante', 'officina', 'palestra', 'professionista', 'noleggio', 'beauty', 'vuoto'];
const conCruscotto = db => { db.exec('CREATE TABLE IF NOT EXISTS _agenda_cruscotti (id TEXT PRIMARY KEY, utente TEXT, def TEXT NOT NULL, modificato TEXT NOT NULL)'); return db; };
// un gestionale preparato con l'avvio guidato, con il titolare e (se si vuole) i dati d'esempio
function prepara(risposte) {
  const db = conCruscotto(apri()), t = U.creaUtente(db, { nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', ruolo: 'titolare' });
  const ctx = { utente: t, r: P.ruolo(db, 'titolare') }, pl = piano(risposte), esito = installaPiano(db, pl, { utente: t.id });
  const esempi = pl.esempi ? mettiEsempi(db, ctx) : null;
  const tutti = (e, filtri = []) => D.elenca(db, e, { filtri, perPagina: 500 }, ctx).righe;
  return { db, ctx, pl, esito, esempi, tutti, uno: (e, campo, valore) => tutti(e).find(x => x[campo] === valore) };
}

test('ogni modello si installa da solo, con le sue automazioni valide', () => {
  for (const m of M.elenco()) {
    const db = apri(); const x = M.installa(db, m.id);
    assert.ok(x.entita.length || m.id === 'vuoto', m.id);
    for (const a of M.leggi(m.id).automazioni || []) assert.deepEqual(A.valida(db, a), [], `${m.id}/${a.id}`);
    for (const e of S.elenco(db)) for (const c of e.campi.filter(c => c.tipo === 'calcolato')) assert.ok(c.formula, `${m.id}/${e.id}.${c.id}`);
  }
});

test('tutti i modelli insieme nello stesso gestionale, in qualsiasi ordine', () => {
  for (const ordine of [M.elenco().map(m => m.id), M.elenco().map(m => m.id).reverse()]) {
    const db = apri(); for (const id of ordine) M.installa(db, id);
    assert.deepEqual(JSON.parse(meta.leggi(db, 'modelli')).sort(), ordine.slice().sort());
    for (const id of NUOVI.filter(x => x !== 'vuoto')) for (const e of M.leggi(id).entita) assert.ok(S.leggi(db, e.id), `${id}: manca ${e.id}`);
  }
});

test('ogni settore: il piano si installa, i dati d\'esempio entrano tutti, il cruscotto si calcola senza errori', () => {
  for (const s of SETTORI) {
    const { db, ctx, esempi, esito } = prepara({ settore: s.id, esempi: true, fatture: false });
    assert.deepEqual(esempi.saltati, [], s.id);
    if (s.id !== 'altro') assert.ok(esempi.creati >= 10, `${s.id}: ${esempi.creati} righe d'esempio`);
    assert.ok(esito.automazioni.length >= (s.id === 'altro' ? 0 : 1), s.id);
    const w = cruscotto(db);
    assert.ok(w.some(x => x.tipo === 'ultime'));
    if (s.id !== 'altro') assert.ok(w.filter(x => x.tipo === 'numero').length >= 2, `${s.id}: pochi numeri nel cruscotto`);
    for (const x of w.filter(x => ['numero', 'grafico'].includes(x.tipo))) assert.doesNotThrow(() => aggrega(db, x, ctx), `${s.id}: ${x.titolo}`);
    for (const v of w.find(x => x.tipo === 'attenzione')?.voci || []) assert.ok(S.leggi(db, v.entita), `${s.id}: ${v.titolo}`);
  }
});

test('formule e automazioni dei modelli sui dati d\'esempio', () => {
  { // negozio: la vendita pagata ha scalato il magazzino, il totale tiene conto dello sconto
    const { uno, tutti } = prepara({ settore: 'negozio' });
    assert.equal(uno('articoli', 'codice', 'PS-NERA').giacenza, 6 - 2);
    assert.ok(tutti('vendite').some(v => v.totale === 97.2));   // 6 × 18 − 10%
    assert.equal(uno('articoli', 'codice', 'TZ-BLU').da_riordinare, true);
  }
  { // ristorante: coperto nel totale, tavolo occupato dalla comanda aperta, food cost
    const { uno, tutti } = prepara({ settore: 'ristorante' });
    assert.equal(uno('tavoli', 'nome', '3').stato, 'occupato');
    assert.equal(uno('tavoli', 'nome', '1').stato, 'da_pulire'); assert.equal(uno('tavoli', 'nome', 'D1').stato, 'libero');
    const c = tutti('comande').find(x => x.stato === 'in_cucina'); assert.equal(c.consumato, 15 + 26 + 18 + 5); assert.equal(c.totale, 64 + 7.5); assert.equal(c.a_testa, 23.83);
    assert.equal(uno('piatti', 'nome', 'Tortelli di zucca al burro e salvia').food_cost, 23.8);
    assert.deepEqual(uno('piatti', 'nome', 'Tortelli di zucca al burro e salvia').allergeni, ['glutine', 'uova', 'latte']);
  }
  { // officina: ricambi scalati una volta sola, manodopera e garanzia
    const { db, ctx, uno, tutti } = prepara({ settore: 'officina' });
    assert.equal(uno('ricambi', 'codice', 'PF-ANT').giacenza, 1);
    const i = tutti('interventi').find(x => x.fase === 'in_lavorazione');
    assert.equal(i.scaricato, true); assert.equal(i.manodopera, 90); assert.equal(i.totale, 148);
    D.modifica(db, 'interventi', i.id, { fase: 'attesa_ricambi' }, ctx); D.modifica(db, 'interventi', i.id, { fase: 'in_lavorazione' }, ctx);
    assert.equal(uno('ricambi', 'codice', 'PF-ANT').giacenza, 1);
    const g = tutti('interventi').find(x => x.garanzia); assert.equal(g.totale, 67.5 + 62); assert.equal(g.da_pagare, 0);
    assert.equal(tutti('interventi').find(x => x.fase === 'in_lavorazione').in_ritardo, true);
  }
  { // palestra: l'abbonamento crea la quota, il mensile senza fine scade dopo 30 giorni, presenze contate
    const { tutti } = prepara({ settore: 'palestra' });
    assert.equal(tutti('quote').filter(q => q.causale === 'abbonamento').length, 6);
    const senzaFine = tutti('abbonamenti').find(a => a.socio.titolo === 'Federica Rizzi'); assert.ok(senzaFine.al); assert.equal(senzaFine.attivo, true);
    assert.equal(tutti('abbonamenti').find(a => a.socio.titolo === 'Roberto Sala').rimasti, 3);
    assert.equal(tutti('abbonamenti').find(a => a.socio.titolo === 'Andrea Villa').attivo, false);
    assert.ok(tutti('lezioni').some(l => l.quanti === 4));
    assert.equal(tutti('soci').find(x => x.nome === 'Luca Ferrara').certificato_ok, false);
  }
  { // professionista: il preventivo accettato apre il progetto, quello inviato il promemoria; ore e budget
    const { tutti } = prepara({ settore: 'professionista' });
    const p = tutti('progetti').find(x => x.nome === 'Nuovo sito e catalogo prodotti'); assert.ok(p); assert.equal(p.budget, 2790);
    assert.ok(tutti('attivita').some(a => a.titolo.startsWith('Risentire il cliente per P-')));
    const arch = tutti('progetti').find(x => x.nome === 'Riordino archivio fotografico');
    assert.equal(arch.ore_fatte, 29.5); assert.equal(arch.valore, 1475); assert.equal(arch.residuo, 25); assert.equal(arch.in_ritardo, true); assert.equal(arch.avanzamento, 98);
  }
  { // noleggio: beni fuori e rientrati, giorni e totale con lo sconto
    const { uno, tutti } = prepara({ settore: 'noleggio' });
    assert.equal(uno('beni', 'codice', 'EB-01').stato, 'noleggiato'); assert.equal(uno('beni', 'codice', 'GZ-3x6').stato, 'noleggiato');
    assert.equal(uno('beni', 'codice', 'PJ-4K').stato, 'disponibile');
    const pr = tutti('contratti').find(x => x.stato === 'prenotato'); assert.equal(pr.giorni, 3); assert.equal(pr.totale, 121.5);
    assert.equal(tutti('contratti').filter(x => x.in_ritardo).length, 1);
    assert.ok(tutti('contratti').filter(x => x.stato === 'riconsegnato').every(x => x.riconsegnato_il));
  }
  { // beauty: la seduta fatta dal pacchetto conta, la scheda si apre da sola
    const { uno, tutti } = prepara({ settore: 'beauty' });
    assert.equal(uno('pacchetti', 'nome', '6 sedute laser').usate, 3); assert.equal(uno('pacchetti', 'nome', '6 sedute laser').rimaste, 3);
    assert.equal(tutti('schede').length, 1 + 4);
  }
  { // laboratorio: il preventivo accettato apre la commessa, l'avvio scala i materiali
    const { uno, tutti } = prepara({ settore: 'laboratorio', fatture: false });
    assert.ok(tutti('commesse').some(c => c.titolo === 'Tavolo da pranzo in rovere 200x90' && c.prezzo === 1630));
    assert.equal(uno('materiali', 'nome', 'Olio di lino cotto').giacenza, 5);
  }
  { // studio: la seduta dal pacchetto
    const { uno } = prepara({ settore: 'studio', fatture: false });
    assert.equal(uno('pacchetti', 'nome', '10 sedute').usate, 4);
  }
});

test('le domande e il piano: due profili diversi', () => {
  assert.ok(DOMANDE.length >= 10 && DOMANDE.every(d => d.id && d.testo));
  // un negozio senza magazzino e senza fornitori, con due persone e senza Lumi
  const a = piano({ settore: 'negozio', magazzino: false, fornitori: false, persone: 'poche', lumi: false, esempi: false,
    squadra: [{ nome: 'Giulia', email: 'Giulia@Prova.it', ruolo: 'banco' }, { nome: 'Pietro', email: 'pietro@prova.it', ruolo: 'inventato' }, { nome: '', email: 'x@y.it' }] });
  assert.deepEqual(a.modelli.map(m => m.id), ['negozio']);
  assert.deepEqual(a.spenti.entita.sort(), ['fornitori', 'ordini', 'righe_ordine']);
  assert.ok(a.spenti.campi.includes('articoli.giacenza'));
  assert.deepEqual(a.persone, [{ nome: 'Giulia', email: 'giulia@prova.it', ruolo: 'banco' }, { nome: 'Pietro', email: 'pietro@prova.it', ruolo: 'collaboratore' }]);
  assert.deepEqual(a.sezioni, ['Clienti', 'Articoli', 'Vendite']);
  // una palestra che fa anche preventivi e fatture, da solo
  const b = piano({ settore: 'palestra', su_misura: true, fatture: true, persone: 'solo', squadra: [{ nome: 'X', email: 'x@prova.it' }] });
  assert.deepEqual(b.modelli.map(m => m.id), ['palestra', 'laboratorio', 'fatture']);
  assert.deepEqual(b.persone, []); assert.equal(b.lumi, true); assert.equal(b.esempi, true);
  assert.ok(b.sezioni.includes('Lezioni') && b.sezioni.includes('Preventivi') && b.sezioni.includes('Fatture'));
  // senza appuntamenti la palestra non ha le lezioni; con gli appuntamenti un negozio prende l'agenda dello studio
  assert.ok(!piano({ settore: 'palestra', appuntamenti: false }).sezioni.includes('Lezioni'));
  assert.deepEqual(piano({ settore: 'negozio', appuntamenti: true }).modelli.at(-1), { id: 'studio', entita: ['clienti', 'servizi', 'appuntamenti'] });
});

test('campi spenti archiviati, automazioni che li toccano escluse: il magazzino spento non blocca le vendite', () => {
  const { db, ctx } = prepara({ settore: 'negozio', magazzino: false, esempi: false });
  const art = S.leggi(db, 'articoli');
  for (const k of ['giacenza', 'soglia', 'da_riordinare']) assert.equal(S.campo(art, k).archiviato, true, k);
  assert.ok(!A.elenco(db).some(a => a.id === 'scarico_vendita'));
  const x = D.crea(db, 'articoli', { nome: 'Vaso', prezzo: 20 }, ctx);
  const v = D.crea(db, 'vendite', { righe: [{ articolo: x.id, quantita: 2, prezzo: 20 }] }, ctx);
  assert.equal(D.modifica(db, 'vendite', v.id, { stato: 'pagata' }, ctx).totale, 40);
  // e si riaccende da Personalizza: il campo torna attivo
  S.applica(db, { ...art, campi: art.campi.map(c => ({ ...c, archiviato: undefined })) });
  assert.equal(D.modifica(db, 'articoli', x.id, { giacenza: 5 }, ctx).giacenza, 5);
});

test('i dati d\'esempio si tolgono con un clic: righe, righe figlie, registro e numerazione', () => {
  const { db, ctx, esempi } = prepara({ settore: 'negozio' });
  assert.equal(quantiEsempi(db), esempi.creati);
  const vero = D.crea(db, 'clienti', { nome: 'Cliente vero' }, ctx);
  const x = togliEsempi(db);
  assert.ok(x.tolti >= esempi.creati - 1);
  assert.equal(quantiEsempi(db), 0);
  for (const e of ['articoli', 'vendite', 'righe_vendita', 'ordini', 'fornitori']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM d_${e}`).get().n, 0, e);
  assert.deepEqual(D.elenca(db, 'clienti', {}, ctx).righe.map(c => c.nome), ['Cliente vero']);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM _registro WHERE entita = 'vendite' AND tipo IN ('crea', 'modifica')").get().n, 0);
  assert.match(D.crea(db, 'vendite', {}, ctx).numero, /^V-\d{4}-0001$/);   // la prima vendita vera è la numero 1
  assert.ok(vero.id);
});

async function avvia() {
  const db = apri(), srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  return { db, srv, chiama, esci: () => { biscotto = ''; } };
}

test('API: avvio guidato completo, persone con il ruolo, Lumi spento, cruscotto, esempi via e di nuovo', async () => {
  const { db, srv, chiama, esci } = await avvia();
  try {
    const d = (await chiama('GET', '/api/avvio/domande')).json; assert.ok(d.domande.length >= 10); assert.equal(d.tipiche.negozio.magazzino, true);
    const risposte = { settore: 'negozio', magazzino: false, persone: 'poche', lumi: false, esempi: true, squadra: [{ nome: 'Giulia', email: 'giulia@prova.it', ruolo: 'banco' }] };
    assert.deepEqual((await chiama('POST', '/api/avvio/piano', { risposte })).json.sezioni, ['Clienti', 'Fornitori', 'Articoli', 'Vendite', 'Ordini ai fornitori']);
    assert.ok([400, 401].includes((await chiama('POST', '/api/avvio/configura', { azienda: 'Bottega', nome: 'T', email: 't@prova.it', password: 'corta', risposte })).stato));
    assert.equal(U.quanti(db), 0);   // niente a metà
    const c = await chiama('POST', '/api/avvio/configura', { azienda: 'Bottega Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', risposte });
    assert.equal(c.stato, 200, JSON.stringify(c.json)); assert.ok(c.json.esempi > 10);
    assert.equal(c.json.persone[0].ruolo, 'banco'); assert.match(c.json.persone[0].password, /^kubo-/);
    assert.equal((await chiama('POST', '/api/avvio/configura', { azienda: 'x' })).stato, 409);
    const schema = (await chiama('GET', '/api/schema')).json;
    assert.ok(!schema.find(e => e.id === 'articoli').campi.some(k => k.id === 'giacenza'));
    assert.equal(meta.leggi(db, 'lumi.attivo'), '0');
    assert.deepEqual((await chiama('GET', '/api/avvio/stato')).json, { giro: true, esempi: c.json.esempi, titolare: true });
    const cr = (await chiama('GET', '/api/cruscotto')).json;
    assert.ok(cr.widget.length >= 4); for (const w of cr.widget) assert.ok(!cr.dati[w.id]?.errore, w.titolo);
    assert.ok(cr.dati[cr.widget.find(w => w.titolo === 'Incassato questo mese').id].totali[0] > 0);
    assert.equal((await chiama('POST', '/api/avvio/giro', { fatto: true })).stato, 200);
    assert.equal((await chiama('GET', '/api/avvio/stato')).json.giro, false);
    // la persona creata entra con la password provvisoria e non può togliere gli esempi
    esci(); assert.equal((await chiama('POST', '/api/accedi', { email: 'giulia@prova.it', password: c.json.persone[0].password })).stato, 200);
    assert.equal((await chiama('DELETE', '/api/avvio/esempi')).stato, 403);
    assert.ok(!(await chiama('GET', '/api/schema')).json.some(e => e.id === 'ordini'));
    esci(); await chiama('POST', '/api/accedi', { email: 't@prova.it', password: 'password-lunga' });
    assert.ok((await chiama('DELETE', '/api/avvio/esempi')).json.tolti > 10);
    assert.equal((await chiama('GET', '/api/dati/vendite')).json.totale, 0);
    assert.ok((await chiama('POST', '/api/avvio/esempi')).json.creati > 10);
    assert.equal((await chiama('POST', '/api/avvio/esempi')).stato, 409);
  } finally { srv.close(); }
});

test('API: secondo profilo, una palestra con le fatture, da sola, senza esempi', async () => {
  const { srv, chiama } = await avvia();
  try {
    const c = await chiama('POST', '/api/avvio/configura', { azienda: 'Palestra Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga',
      risposte: { settore: 'palestra', fatture: true, persone: 'solo', esempi: false } });
    assert.equal(c.stato, 200, JSON.stringify(c.json));
    const ids = (await chiama('GET', '/api/schema')).json.map(e => e.id);
    for (const e of ['soci', 'abbonamenti', 'corsi', 'lezioni', 'quote', 'fatture', 'clienti']) assert.ok(ids.includes(e), e);
    assert.ok(!ids.includes('articoli'));
    assert.equal((await chiama('GET', '/api/avvio/stato')).json.esempi, 0);
    assert.equal((await chiama('GET', '/api/utenti')).json.length, 1);
    const ab = (await chiama('POST', '/api/dati/soci', { nome: 'Nuovo socio' })).json;
    await chiama('POST', '/api/dati/abbonamenti', { socio: ab.id, tipo: 'mensile', prezzo: 50 });
    assert.equal((await chiama('GET', '/api/dati/quote')).json.righe[0].importo, 50);
  } finally { srv.close(); }
});
