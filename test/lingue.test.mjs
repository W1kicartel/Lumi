// Le sei lingue: parità dei cataloghi (stesse chiavi, stessi parametri, plurali), testi del codice tutti nel catalogo,
// messaggi del server riconosciuti e tradotti, modelli installati nella lingua dell'azienda, formati e nomi delle formule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva } from '../server/automazioni.js';
import { calcola } from '../server/formule.js';
import * as L from '../server/moduli/lingue.js';
import { AREE } from '../web/lingue/indice.js';
import * as W from '../web/lingua.js';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
const LINGUE = ['it', 'en', 'es', 'fr', 'de', 'pt'];
const parametri = v => [...new Set([...(typeof v === 'object' ? Object.values(v).join(' ') : String(v)).matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();
const catalogoWeb = async cod => Object.assign({}, ...await Promise.all(AREE.map(a => import(`../web/lingue/${cod}/${a}.js`).then(m => m.default))));
// i file dell'interfaccia, tranne Lumi (web/lumi ha i suoi cataloghi, web/lumi/lingua.js)
const fileWeb = () => [...readdirSync(join(RADICE, 'web')).filter(f => f.endsWith('.js')).map(f => join(RADICE, 'web', f)),
  ...readdirSync(join(RADICE, 'web', 'moduli')).filter(f => f.endsWith('.js')).map(f => join(RADICE, 'web', 'moduli', f))];

test('cataloghi dell\'interfaccia: stesse chiavi, stessi parametri, plurali con other in tutte le lingue', async () => {
  const it = await catalogoWeb('it');
  assert.ok(Object.keys(it).length > 150);
  for (const cod of LINGUE.slice(1)) {
    const c = await catalogoWeb(cod);
    assert.deepEqual(Object.keys(c).sort(), Object.keys(it).sort(), `chiavi diverse in ${cod}`);
    for (const [k, v] of Object.entries(it)) {
      assert.deepEqual(parametri(c[k]), parametri(v), `parametri diversi in ${cod}: ${k}`);
      assert.equal(typeof c[k], typeof v, `forma diversa in ${cod}: ${k}`);
      if (typeof v === 'object') { assert.ok('other' in c[k], `${cod} ${k} senza other`); if (String(v.other).includes('{n}')) assert.ok(String(c[k].other).includes('{n}'), `${cod} ${k}: other senza {n}`); }
      assert.ok(String(typeof c[k] === 'object' ? c[k].other : c[k]).trim(), `${cod} ${k} vuoto`);
    }
  }
});

test('ogni t() del codice ha la sua chiave in italiano, e ogni chiave italiana serve', async () => {
  const it = await catalogoWeb('it'), usate = new Set(), prefissi = [];
  for (const f of fileWeb()) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.split('\n').filter(r => !/^\s*\/\//.test(r)).join('\n').matchAll(/\bt\('([a-z]+\.[a-z0-9_-]+)'/g)) { if (m[1].endsWith('-')) prefissi.push(m[1]); else usate.add(m[1]); }
  }
  for (const k of usate) assert.ok(k in it, `manca nel catalogo: ${k}`);
  const nonUsate = Object.keys(it).filter(k => !usate.has(k) && !prefissi.some(p => k.startsWith(p)));
  assert.deepEqual(nonUsate, [], 'chiavi che nessun file usa');
});

test('ogni file dell\'interfaccia toccato dalle lingue si legge (sintassi)', () => {
  for (const f of [...fileWeb(), join(RADICE, 'web', 'lumi', 'lingua.js'), join(RADICE, 'web', 'lumi', 'motore.js')]) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('i testi del motore web passano tutti da t(): niente frasi italiane scritte a mano', () => {
  // le stringhe fra apici con una parola italiana maiuscola seguita da altre parole sono frasi per chi usa Kubo
  const frase = /(['`])(?:Salva|Crea|Nuov[oa]|Archivia|Ripristina|Elimina|Togli|Aggiungi|Cerca|Nessun|Accedi|Benvenuto|Personalizza|Colonne|Filtri?|Persone|Gestione|Esci|Vista|Ruol[oi])\b[^'`]*\1/;
  for (const f of ['app.js', 'viste.js', 'campi.js', 'filtri.js', 'personalizza.js', 'utenti.js', 'ui.js'].map(x => join(RADICE, 'web', x))) {
    readFileSync(f, 'utf8').split('\n').forEach((riga, i) => {
      if (/^\s*\/\//.test(riga)) return;
      assert.ok(!frase.test(riga.replace(/t\('[^']*'/g, '')), `${f.split('/').pop()}:${i + 1} ha un testo fuori dal catalogo: ${riga.trim().slice(0, 90)}`);
    });
  }
});

test('nei moduli tradotti (agenda, cruscotto, Lumi, lingua) bottoni, titoli e segnaposto passano da t()', () => {
  const scritto = /\b(testo|title|placeholder|nome): '(?:\+ )?[A-ZÀ-Úa-zà-ú][a-zà-ú]+[ '][^']*'/;
  for (const f of ['agenda.js', 'lumi.js', 'lingue.js'].map(x => join(RADICE, 'web', 'moduli', x))) {
    readFileSync(f, 'utf8').split('\n').forEach((riga, i) => {
      if (/^\s*\/\//.test(riga)) return;
      assert.ok(!scritto.test(riga), `${f.split('/').pop()}:${i + 1}: ${riga.trim().slice(0, 100)}`);
    });
  }
});

test('chi usa t() non ha variabili locali chiamate t (coprirebbero la funzione)', () => {
  const ombra = /\b(?:let|const|var)\s+(?:[^;=]*,\s*)?t\s*[,;=]|[(,]\s*t\s*[,)]\s*=>|\bt\s*=>|\[[^\]]*\bt\]\)\s*=>/;
  for (const f of fileWeb()) {
    const s = readFileSync(f, 'utf8'); if (!/import \{ t\b/.test(s)) continue;
    s.split('\n').forEach((riga, i) => { if (!/^\s*(\/\/|import )/.test(riga)) assert.ok(!ombra.test(riga), `${f.split('/').pop()}:${i + 1}: ${riga.trim().slice(0, 100)}`); });
  }
});

test('lingua.js: scelta della lingua, plurali, numeri, valuta e primo giorno della settimana', async () => {
  assert.equal(W.iniziale({ utente: 'fr', salvata: 'de', browser: ['en-US'] }), 'fr');
  assert.equal(W.iniziale({ salvata: 'de', browser: ['en-US'] }), 'de');
  assert.equal(W.iniziale({ browser: ['ja-JP', 'pt-BR'] }), 'pt');
  assert.equal(W.iniziale({ browser: ['ja'] }), 'it');
  assert.equal(W.localeDi('en', ['en-US']), 'en-US');
  assert.equal(W.localeDi('pt', ['pt-PT']), 'pt-BR');
  await W.usa('it', { valuta: 'EUR' });
  assert.equal(W.t('viste.in-tutto', { n: 1 }), '1 in tutto');
  assert.equal(W.t('viste.cerca-in', { nome: 'clienti' }), 'Cerca in clienti…');
  assert.equal(W.soldi(12345.5).replace(/\s/g, ' '), '12.345,50 €');
  assert.equal(W.leggiNumero('1.234,5'), 1234.5); assert.equal(W.leggiNumero('12.5'), 12.5); assert.equal(W.leggiNumero('1.250'), 1250); assert.equal(W.leggiNumero('x'), null);
  assert.equal(W.primoGiorno('it-IT'), 1); assert.equal(W.primoGiorno('en-US'), 7); assert.equal(W.primoGiorno('pt-BR'), 7);
  assert.equal(W.giorniSettimana('it-IT')[0].dow, 1); assert.equal(W.giorniSettimana('en-US')[0].dow, 0);
  await W.usa('en', { valuta: 'USD' });
  assert.equal(W.t('viste.cerca-in', { nome: 'customers' }), 'Search customers…');
  assert.equal(W.soldi(1234.5), 'US$1,234.50');
  assert.equal(W.leggiNumero('1,234.5'), 1234.5);
  await W.usa('pt', { valuta: 'BRL' });
  assert.equal(W.forma({ one: '{n} item', other: '{n} itens' }, 0), '{n} itens');   // in Brasile «0 itens»
  assert.equal(W.forma({ one: '{n} item', other: '{n} itens' }, 1), '{n} item');
  assert.match(W.soldi(10), /R\$\s?10,00/);
  await W.usa('de', { valuta: 'CHF' });
  assert.equal(W.minuscole('Kunden'), 'Kunden');
  await W.usa('it', { valuta: 'EUR' });
  assert.equal(W.minuscole('Clienti'), 'clienti');
});

test('cataloghi del server: stesse chiavi e stessi parametri in tutte le lingue', () => {
  const it = L.CATALOGHI.it;
  for (const cod of LINGUE.slice(1)) {
    const c = L.CATALOGHI[cod];
    assert.deepEqual(Object.keys(c).sort(), Object.keys(it).sort(), `chiavi diverse in ${cod}`);
    for (const [k, v] of Object.entries(it)) assert.deepEqual(parametri(c[k]), parametri(v), `parametri diversi in ${cod}: ${k}`);
  }
});

test('ogni messaggio di errore del server è nel catalogo (si riconosce e si traduce)', () => {
  const file = [...readdirSync(join(RADICE, 'server')).filter(f => f.endsWith('.js')).map(f => join(RADICE, 'server', f)),
    ...readdirSync(join(RADICE, 'server', 'moduli')).filter(f => f.endsWith('.js') && f !== 'lingue.js').map(f => join(RADICE, 'server', 'moduli', f))];
  const re = /(?:new (?:\w+\.)?(?:ErroreHttp\(\d+, |ErroreDati\(|ErroreSchema\(|ErroreAccesso\(|ErrorePermesso\(|ErroreFormula\()|\bno\(|\b(?:err|e|problemi|errori)\.push\()(['`])((?:\\.|(?!\1).)*)\1/g;
  const mancano = [];
  let quanti = 0;
  for (const f of file) for (const m of readFileSync(f, 'utf8').matchAll(re)) {
    // un modello `…${x}…` diventa un messaggio d'esempio con «x» al posto delle variabili
    const testo = m[2].replace(/\$\{[^}]*\}\}?|\$\{[^}]*\}/g, 'x').replace(/\\'/g, '\'');
    if (/^x(: x)?$/.test(testo) || /^Deepgram|x\[azione\]|^«x» non è x$/.test(testo)) continue;   // composti (coperti dai modelli con le varianti) o di servizi esterni
    quanti++;
    if (!L.riconosci(testo)) mancano.push(`${f.split('/').slice(-2).join('/')}: ${testo}`);
  }
  assert.ok(quanti > 100, `trovati solo ${quanti} messaggi`);
  assert.deepEqual(mancano, []);
});

test('traduzione dei messaggi: parametri, messaggi annidati, intestazione Accept-Language', () => {
  assert.equal(L.traduci('Accedi per continuare', 'en'), 'Sign in to continue');
  assert.equal(L.traduci('«Prezzo» deve essere un numero', 'es'), '«Prezzo» debe ser un número');
  assert.equal(L.traduci('campo «totale»: formula non valida (Funzione sconosciuta PIPPO)', 'de'), 'Feld „totale“: ungültige Formel (Unbekannte Funktion PIPPO)');
  assert.equal(L.traduci('un testo che nessuno conosce', 'fr'), 'un testo che nessuno conosce');
  assert.equal(L.traduci('Accedi per continuare', 'it'), 'Accedi per continuare');
  assert.deepEqual(L.traduciCorpo({ errore: '«Email» è obbligatorio', campi: { email: '«Email» è obbligatorio' } }, 'pt'), { errore: '«Email» é obrigatório', campi: { email: '«Email» é obrigatório' } });
  assert.equal(L.daIntestazione('fr-CH, fr;q=0.9, en;q=0.8'), 'fr');
  assert.equal(L.daIntestazione('ja, en;q=0.5'), 'en');
  assert.equal(L.daIntestazione('de;q=0.2, es;q=0.9'), 'es');
  assert.equal(L.daIntestazione('*'), null);
});

test('formule: nomi delle funzioni in spagnolo, francese, tedesco e portoghese, con «;» o «,»', () => {
  const c = (f, valori = {}) => calcola(f, { valori });
  assert.equal(c('SUMA(1; 2; 3)'), 6);
  assert.equal(c('SOMME(righe.x)', { righe: [{ x: 2 }, { x: 3 }] }), 5);
  assert.equal(c('SUMME(1, 2)'), 3);
  assert.equal(c('soma(4; 5)'), 9);
  assert.equal(c('WENN(1 > 2; "a"; "b")'), 'b');
  assert.equal(c('SI(VRAI; "oui"; "non")'), 'oui');
  assert.equal(c('SE(FALSO; 1; 2)'), 2);
  assert.equal(c('MITTELWERT(2; 4)'), 3);
  assert.equal(c('MÊS("2026-03-04")') + c('MES("2026-03-04")') + c('MOIS("2026-03-04")') + c('MONAT("2026-03-04")'), 12);
  assert.equal(c('AÑO("2026-03-04")'), 2026); assert.equal(c('ANNEE("2026-03-04")'), 2026);
  assert.equal(c('DÍAS("2026-03-01"; "2026-03-04")'), 3); assert.equal(c('DIAS("2026-03-01"; "2026-03-04")'), 3);
  assert.equal(c('LÄNGE("abc") + LARGO("ab") + NBCAR("a")'), 6);
  assert.equal(c('ARRED(2.5; 0) + REDONDEAR(1.4; 0) + RUNDEN(0.6; 0)'), 5);
  assert.throws(() => c('FUNZIONEINVENTATA(1)'));
});

attiva();
async function avvia() {
  const srv = creaServer(apri()); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo, { lingua } = {}) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(lingua ? { 'Accept-Language': lingua } : {}), ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  return { srv, chiama };
}

test('API: lingua dell\'utente salvata, errori nella sua lingua, modelli nella lingua dell\'azienda', async () => {
  const { srv, chiama } = await avvia();
  try {
    // prima dell'accesso: la lingua viene dall'intestazione del browser
    assert.equal((await chiama('GET', '/api/schema', null, { lingua: 'de-DE,de;q=0.9' })).json.errore, 'Melde dich an, um fortzufahren');
    assert.equal((await chiama('GET', '/api/schema')).json.errore, 'Accedi per continuare');
    const l0 = (await chiama('GET', '/api/lingua', null, { lingua: 'es' })).json;
    assert.equal(l0.proposta, 'es'); assert.equal(l0.lingua, null); assert.deepEqual(l0.azienda, { lingua: 'it', valuta: 'EUR' }); assert.equal(l0.lingue.length, 6);
    // il primo avvio in inglese, in dollari: il modello arriva con i nomi inglesi e gli stessi id
    assert.equal((await chiama('PUT', '/api/lingua/azienda', { lingua: 'en', valuta: 'USD' })).stato, 200);
    assert.equal((await chiama('PUT', '/api/lingua/azienda', { valuta: 'XYZ' })).stato, 400);
    const mod = (await chiama('GET', '/api/lingua/modelli?l=en')).json; assert.ok(mod.find(m => m.id === 'negozio').nome !== 'Negozio e bottega');
    const c = await chiama('POST', '/api/configura', { azienda: 'Shop', nome: 'Owner', email: 'o@prova.it', password: 'password-lunga', modelli: ['negozio'] });
    assert.equal(c.stato, 200, JSON.stringify(c.json));
    const schema = (await chiama('GET', '/api/schema')).json, clienti = schema.find(e => e.id === 'clienti');
    assert.equal(clienti.nome, 'Customers'); assert.ok(clienti.campi.some(x => x.id === 'nome' && x.nome === 'Name'));
    assert.equal((await chiama('GET', '/api/lingua')).json.azienda.valuta, 'USD');
    // dopo il primo avvio, la lingua dell'azienda la cambia solo chi personalizza
    assert.equal((await chiama('PUT', '/api/lingua', { lingua: 'xx' })).stato, 400);
    assert.equal((await chiama('PUT', '/api/lingua', { lingua: 'fr' })).json.lingua, 'fr');
    assert.equal((await chiama('GET', '/api/lingua')).json.lingua, 'fr');
    // la lingua dell'utente vale più dell'intestazione del browser
    const e = await chiama('POST', '/api/dati/clienti', { email: 'no' }, { lingua: 'de' });
    assert.equal(e.stato, 422); assert.match(e.json.errore, /^« .+ » /); assert.ok(Object.values(e.json.campi).every(m => !/obbligatorio|non valida/.test(m)), JSON.stringify(e.json));
    const s = await chiama('PUT', '/api/schema/clienti', { id: 'clienti', nome: 'X', campi: [{ id: 'a', nome: 'A', tipo: 'boh' }] });
    assert.equal(s.stato, 422); assert.equal(s.json.errore, 'Définition non valide'); assert.deepEqual(s.json.dettagli, ['champ « a » : type inconnu « boh »']);
  } finally { srv.close(); }
});

test('modelli tradotti: ogni nome tradotto punta a un id che esiste, in tutte le lingue', () => {
  const modelli = readdirSync(join(RADICE, 'modelli')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(RADICE, 'modelli', f), 'utf8')));
  for (const cod of LINGUE.slice(1)) {
    const f = join(RADICE, 'modelli', 'lingue', cod + '.json'); assert.ok(existsSync(f), `manca modelli/lingue/${cod}.json`);
    const n = JSON.parse(readFileSync(f, 'utf8'));
    for (const m of modelli) {
      const tm = n[m.id]; assert.ok(tm?.nome && tm?.descrizione, `${cod}: manca il modello ${m.id}`);
      for (const e of m.entita) {
        const te = tm.entita?.[e.id]; assert.ok(te?.nome, `${cod}: manca ${m.id}.${e.id}`);
        for (const c of e.campi) {
          const tc = te.campi?.[c.id]; assert.ok(typeof tc === 'string' ? tc : tc?.nome, `${cod}: manca ${m.id}.${e.id}.${c.id}`);
          for (const o of c.opzioni || []) assert.ok(tc.opzioni?.[o.id], `${cod}: manca l'opzione ${m.id}.${e.id}.${c.id}.${o.id}`);
        }
      }
      for (const a of m.automazioni || []) if (a.nome) assert.ok(tm.automazioni?.[a.id], `${cod}: manca l'automazione ${m.id}.${a.id}`);
      for (const k of Object.keys(tm.entita || {})) assert.ok(m.entita.some(e => e.id === k), `${cod}: ${m.id}.${k} non esiste`);
    }
  }
});
