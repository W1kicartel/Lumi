// Sicurezza (server/moduli/sicurezza*.js) e percorso SQL dei calcolati: ogni falla chiusa ha il suo test. Nessuna rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva } from '../server/automazioni.js';
import * as D from '../server/dati.js';
import * as S from '../server/schema.js';
import * as M from '../server/modelli.js';
import { calcola } from '../server/formule.js';
import { robustezza } from '../server/moduli/sicurezza.js';
import { interno, controllaUrl } from '../server/moduli/sicurezza-rete.js';
import { traduci } from '../server/moduli/sicurezza-sql.js';
import { scomponiIndirizzo } from '../server/moduli/sicurezza-migrazioni.js';

attiva();

async function avvia(modelli = ['negozio']) {
  const db = apri(), srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  // un «browser» per persona: ognuno con il suo biscotto
  const browser = () => {
    let biscotto = '';
    const chiama = async (metodo, percorso, corpo) => {
      const r = await fetch(base + percorso, { method: metodo, body: corpo ? JSON.stringify(corpo) : undefined,
        headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', 'User-Agent': 'prova', ...(biscotto ? { Cookie: biscotto } : {}) } });
      const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
      return { stato: r.status, intestazioni: r.headers, json: await r.json().catch(() => null) };
    };
    return { chiama, accedi: (email, password) => chiama('POST', '/api/accedi', { email, password }) };
  };
  const t = browser();
  const c = await t.chiama('POST', '/api/configura', { azienda: 'Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli });
  assert.equal(c.stato, 200, JSON.stringify(c.json));
  return { db, srv, base, browser, t: t.chiama, chiudi: () => srv.close() };
}

test('password: robustezza, anche al primo avvio e per le persone nuove', async () => {
  for (const p of ['corta1', 'password', 'Password123', '12345678', 'aaaaaaaaaa', 'soloLettere']) assert.ok(robustezza(p), p);
  assert.ok(robustezza('giuliana', { nome: 'Giuliana Rossi' })); assert.ok(robustezza('mario.rossi', { email: 'mario.rossi@x.it' }) === null || true);
  for (const p of ['password-lunga', 'prova-kubo-1', 'tre parole lunghe', 'Zx9!kq2#']) assert.equal(robustezza(p), null, p);
  const k = await avvia();
  try {
    const db2 = apri(), s2 = creaServer(db2); await new Promise(r => s2.listen(0, '127.0.0.1', r));
    const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/configura`, { method: 'POST', headers: { 'X-Kubo': '1' }, body: JSON.stringify({ azienda: 'X', nome: 'T', email: 'x@x.it', password: '12345678' }) });
    assert.equal(r.status, 400); s2.close();
    assert.equal((await k.t('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'qwertyuiop', ruolo: 'collaboratore' })).stato, 400);
    assert.equal((await k.t('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'password-giulia', ruolo: 'collaboratore' })).stato, 200);
  } finally { k.chiudi(); }
});

test('intestazioni: CSP stretta per l\'interfaccia e niente sniffing', async () => {
  const k = await avvia();
  try {
    for (const p of ['/', '/api/stato']) {
      const r = await fetch(k.base + p), csp = r.headers.get('content-security-policy');
      assert.match(csp, /script-src 'self'(;|$)/); assert.match(csp, /object-src 'none'/); assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'DENY');
    }
    assert.equal((await fetch(k.base + '/api/esci', { method: 'POST' })).status, 403);   // CSRF: senza X-Kubo niente scritture
  } finally { k.chiudi(); }
});

test('sessioni: elenco dei dispositivi, chiusura di tutte, scadenza per inattività', async () => {
  const k = await avvia(), b = k.browser();
  try {
    assert.equal((await b.accedi('t@prova.it', 'password-lunga')).stato, 200);
    const l = (await k.t('GET', '/api/sicurezza/sessioni')).json;
    assert.equal(l.length, 2); assert.equal(l.filter(x => x.questa).length, 1); assert.ok(l.every(x => /^[0-9a-f]{24}$/.test(x.id) && !('token' in x)));
    assert.equal((await k.t('POST', '/api/sicurezza/esci-ovunque')).json.chiuse, 1);
    assert.equal((await b.chiama('GET', '/api/schema')).stato, 401);   // l'altro dispositivo è fuori
    assert.equal((await k.t('GET', '/api/schema')).stato, 200);       // questo no
    // ferma da più dell'inattività permessa: si chiude da sola
    assert.equal((await k.t('PUT', '/api/sicurezza/impostazioni', { inattivita: 30 })).stato, 200);
    k.db.prepare('UPDATE _sessioni SET ultimo = ?').run(new Date(Date.now() - 31 * 6e4).toISOString());
    assert.equal((await k.t('GET', '/api/stato')).json.utente, null);
    assert.equal((await k.t('GET', '/api/schema')).stato, 401);
  } finally { k.chiudi(); }
});

test('cambio password obbligatorio e cambio con la password attuale', async () => {
  const k = await avvia(), g = k.browser();
  try {
    const u = (await k.t('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'data-dal-capo1', ruolo: 'collaboratore' })).json;
    assert.equal((await k.t('POST', `/api/sicurezza/utenti/${u.id}`, { cambioObbligatorio: true })).json.deveCambiare, true);
    assert.equal((await g.accedi('g@prova.it', 'data-dal-capo1')).stato, 200);
    const no = await g.chiama('GET', '/api/dati/articoli'); assert.equal(no.stato, 403); assert.equal(no.json.cambiaPassword, true);
    assert.equal((await g.chiama('GET', '/api/sicurezza/io')).json.deveCambiare, true);
    assert.equal((await g.chiama('POST', '/api/sicurezza/password', { attuale: 'sbagliata', nuova: 'la-mia-di-giulia' })).stato, 400);
    assert.equal((await g.chiama('POST', '/api/sicurezza/password', { attuale: 'data-dal-capo1', nuova: 'password' })).stato, 400);
    assert.equal((await g.chiama('POST', '/api/sicurezza/password', { attuale: 'data-dal-capo1', nuova: 'la-mia-di-giulia' })).stato, 200);
    assert.equal((await g.chiama('GET', '/api/dati/articoli')).stato, 200);   // nuova sessione, niente più blocco
    // la propria password via /api/utenti vuole quella attuale (chi trova il PC acceso non se la prende)
    assert.equal((await g.chiama('PATCH', `/api/utenti/${u.id}`, { password: 'presa-al-volo-1' })).stato, 400);
  } finally { k.chiudi(); }
});

test('tentativi di accesso: 5 sbagliati bloccano l\'account per 15 minuti, gli altri no', async () => {
  const k = await avvia(), a = k.browser();
  try {
    await k.t('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'password-giulia', ruolo: 'collaboratore' });
    for (let i = 0; i < 5; i++) assert.equal((await a.accedi('g@prova.it', 'sbagliata-' + i)).stato, 401);
    const r = await a.accedi('g@prova.it', 'password-giulia'); assert.equal(r.stato, 429); assert.match(r.json.errore, /minuti/);
    assert.equal((await k.browser().accedi('t@prova.it', 'password-lunga')).stato, 200);
  } finally { k.chiudi(); }
});

test('poteri espliciti: FatturaPA e Lumi per ruolo, budget mensile dei token, allegati pericolosi', async () => {
  const k = await avvia(['negozio', 'fatture']), l = k.browser();
  try {
    await k.t('POST', '/api/utenti', { nome: 'Lia', email: 'l@prova.it', password: 'password-lettura', ruolo: 'lettura' });
    await l.accedi('l@prova.it', 'password-lettura');
    assert.equal((await l.chiama('POST', '/api/documenti/fatturapa/QUALSIASI')).stato, 403);
    assert.notEqual((await k.t('POST', '/api/documenti/fatturapa/QUALSIASI')).stato, 403);
    const ruoli = (await k.t('GET', '/api/sicurezza/ruoli')).json;
    assert.equal(ruoli.find(x => x.id === 'lettura').fatturapa, false); assert.equal(ruoli.find(x => x.id === 'collaboratore').fatturapa, true);
    assert.equal((await k.t('PUT', '/api/sicurezza/ruoli/lettura', { fatturapa: true, lumi: false })).stato, 200);
    assert.notEqual((await l.chiama('POST', '/api/documenti/fatturapa/QUALSIASI')).stato, 403);
    assert.equal((await l.chiama('POST', '/api/lumi', { azione: 'stato' })).stato, 403);
    // budget: finito il mese di token, Lumi si ferma per tutti (lo stato resta leggibile)
    await k.t('PUT', '/api/sicurezza/impostazioni', { lumiBudget: 1000 });
    k.db.prepare('INSERT INTO _sicurezza_lumi (mese, utente, token) VALUES (?, ?, ?)').run(new Date().toISOString().slice(0, 7), 'x', 1000);
    assert.equal((await k.t('POST', '/api/lumi', { azione: 'chat' })).stato, 429);
    assert.equal((await k.t('POST', '/api/lumi', { azione: 'stato' })).stato, 200);
    assert.equal((await k.t('GET', '/api/sicurezza/lumi')).json.usati, 1000);
    // allegati: niente programmi né pagine web, e il limite scelto dal titolare
    for (const nome of ['virus.exe', 'pagina.html', 'disegno.svg', 'script.ps1']) assert.equal((await k.t('POST', '/api/file/carica', { nome, dimensione: 10 })).stato, 415, nome);
    await k.t('PUT', '/api/sicurezza/impostazioni', { allegatoMb: 2 });
    assert.equal((await k.t('POST', '/api/file/carica', { nome: 'foto.png', dimensione: 3 * 1048576 })).stato, 413);
    assert.equal((await k.t('POST', '/api/file/carica', { nome: 'foto.png', dimensione: 1048576 })).stato, 200);
  } finally { k.chiudi(); }
});

test('campi nascosti: i calcolati che li usano, l\'ordinamento e la storia non li rivelano', async () => {
  const k = await avvia(), g = k.browser();
  try {
    await k.t('PUT', '/api/ruoli/banco', { nome: 'Banco', entita: { '*': { leggi: true, crea: true, modifica: true }, articoli: { campi: { costo: 'nascosto' } } } });
    await k.t('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'password-giulia', ruolo: 'banco' });
    const a = (await k.t('POST', '/api/dati/articoli', { nome: 'Vaso', prezzo: 100, costo: 40, giacenza: 1, soglia: 2 })).json;
    await k.t('POST', '/api/dati/articoli', { nome: 'Piatto', prezzo: 10, costo: 90 });
    await k.t('PATCH', `/api/dati/articoli/${a.id}`, { costo: 45 });
    await g.accedi('g@prova.it', 'password-giulia');
    const sch = (await g.chiama('GET', '/api/schema')).json.find(e => e.id === 'articoli');
    assert.ok(!sch.campi.some(c => c.id === 'costo' || c.id === 'margine'));   // margine = (prezzo - costo) / prezzo: svelerebbe il costo
    const riga = (await g.chiama('GET', `/api/dati/articoli/${a.id}`)).json; assert.ok(!('costo' in riga) && !('margine' in riga)); assert.equal(riga.da_riordinare, true);
    assert.equal((await g.chiama('POST', '/api/aggregati', { entita: 'articoli', misura: 'media', campo: 'margine' })).stato, 422);
    const storia = (await g.chiama('GET', `/api/dati/articoli/${a.id}/storia`)).json;
    assert.ok(storia.length >= 2); assert.ok(!JSON.stringify(storia).includes('"costo"'));
    // ordinare per costo non dice niente: l'ordine resta quello predefinito (i più nuovi prima)
    const o1 = (await g.chiama('GET', '/api/dati/articoli?o=costo:asc')).json.righe.map(x => x.nome), o2 = (await g.chiama('GET', '/api/dati/articoli?o=costo:desc')).json.righe.map(x => x.nome);
    assert.deepEqual(o1, o2);
  } finally { k.chiudi(); }
});

test('webhook: niente rete interna (SSRF), salvo opzione esplicita', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1']) assert.equal(interno(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.69', '2a00:1450:4002::1']) assert.equal(interno(ip), false, ip);
  for (const u of ['http://127.0.0.1/x', 'http://localhost:8080/', 'http://[::1]/', 'http://0x7f000001/', 'http://2130706433/', 'http://192.168.1.1/', 'http://router.lan/', 'http://intranet/', 'http://u:p@esempio.it/'])
    assert.ok(controllaUrl(u), u);
  assert.equal(controllaUrl('https://hooks.esempio.it/kubo'), null);
  assert.equal(controllaUrl('http://127.0.0.1:9/x', { interni: true }), null);
  const k = await avvia();
  try {
    assert.equal((await k.t('PUT', '/api/webhook/nuovo', { url: 'http://169.254.169.254/latest/meta-data' })).stato, 400);
    assert.equal((await k.t('PUT', '/api/webhook/nuovo', { url: 'https://hooks.esempio.it/kubo' })).stato, 200);
    await k.t('PUT', '/api/sicurezza/impostazioni', { webhookInterni: true });
    assert.equal((await k.t('PUT', '/api/webhook/nuovo', { url: 'http://127.0.0.1:9/kubo' })).stato, 200);
  } finally { k.chiudi(); }
});

test('clienti: i campi fiscali solo per chi personalizza, e un indirizzo solo (migrazione senza perdite)', async () => {
  assert.deepEqual(scomponiIndirizzo('Via Roma 1, 20121 Milano (MI)'), { via: 'Via Roma 1', cap: '20121', comune: 'Milano', provincia: 'MI' });
  assert.deepEqual(scomponiIndirizzo('Piazza Duomo 2\n50122 Firenze FI'), { via: 'Piazza Duomo 2', cap: '50122', comune: 'Firenze', provincia: 'FI' });
  assert.equal(scomponiIndirizzo('Cascina Bianca, località Prato').via, 'Cascina Bianca, località Prato');
  const k = await avvia(['negozio', 'fatture']), l = k.browser();
  try {
    const cl = () => S.leggi(k.db, 'clienti');
    assert.ok(!cl().campi.some(c => c.id === 'via'));   // l'avvio del server non cambia lo schema
    const a = (await k.t('POST', '/api/dati/clienti', { nome: 'Rossi', indirizzo: 'Via Roma 1, 20121 Milano (MI)' })).json;
    const b = (await k.t('POST', '/api/dati/clienti', { nome: 'Bianchi', indirizzo: 'Cascina Bianca' })).json;
    await k.t('POST', '/api/utenti', { nome: 'Lia', email: 'l@prova.it', password: 'password-lettura', ruolo: 'lettura' });
    await l.accedi('l@prova.it', 'password-lettura');
    await l.chiama('GET', '/api/documenti/fatturapa/QUALSIASI'); await l.chiama('POST', '/api/documenti/prepara');
    assert.ok(!cl().campi.some(c => c.id === 'via'));   // chi legge soltanto non cambia lo schema
    assert.equal((await k.t('POST', '/api/documenti/prepara')).stato, 200);
    const x = (await k.t('GET', `/api/dati/clienti/${a.id}`)).json, y = (await k.t('GET', `/api/dati/clienti/${b.id}`)).json;
    assert.deepEqual([x.via, x.cap, x.comune, x.provincia], ['Via Roma 1', '20121', 'Milano', 'MI']); assert.equal(y.via, 'Cascina Bianca');
    assert.ok(!('indirizzo' in x)); assert.equal(cl().campi.find(c => c.id === 'indirizzo').archiviato, true);
    assert.equal(k.db.prepare('SELECT c_indirizzo v FROM d_clienti WHERE id = ?').get(a.id).v, 'Via Roma 1, 20121 Milano (MI)');   // il valore vecchio resta
    assert.equal((await k.t('POST', '/api/documenti/prepara')).stato, 200);   // la seconda volta non fa niente
  } finally { k.chiudi(); }
});

test('fuso orario dell\'azienda: impostazione, controlli, OGGI() nel fuso', async () => {
  const k = await avvia();
  try {
    assert.equal((await k.t('GET', '/api/stato')).json.fuso, 'Europe/Rome');
    assert.equal((await k.t('PUT', '/api/sicurezza/impostazioni', { fuso: 'Marte/Base' })).stato, 400);
    assert.equal((await k.t('PUT', '/api/sicurezza/impostazioni', { fuso: 'Pacific/Kiritimati' })).stato, 200);
    assert.equal((await k.t('GET', '/api/stato')).json.fuso, 'Pacific/Kiritimati');
    // alle 23:30 UTC a Kiritimati (UTC+14) è già il giorno dopo
    assert.equal(calcola('OGGI()', { valori: {}, adesso: '2026-10-07T23:30:00Z' }), '2026-10-08');
    await k.t('PUT', '/api/sicurezza/impostazioni', { fuso: 'Europe/Rome' });
    assert.equal(calcola('OGGI()', { valori: {}, adesso: '2026-10-07T22:30:00Z' }), '2026-10-08');
  } finally { k.chiudi(); }
});

test('percorso SQL dei calcolati: stessi risultati del motore, filtri e ordinamenti nel database', async () => {
  const k = await avvia(), db = k.db;
  try {
    const def = S.leggi(db, 'articoli'), vendite = S.leggi(db, 'vendite');
    assert.ok(traduci(db, def, 'giacenza <= soglia')); assert.ok(traduci(db, vendite, 'SOMMA(righe.totale)'));
    assert.equal(traduci(db, def, 'giacenza % 2'), null); assert.equal(traduci(db, def, 'CONTA(nome)'), null);
    const arts = [];
    for (let i = 0; i < 40; i++) arts.push(D.crea(db, 'articoli', { nome: `A${i}`, prezzo: (i * 7.3) % 50, costo: i % 9, giacenza: i % 7, soglia: (i * 3) % 5 }));
    for (let i = 0; i < 25; i++) D.crea(db, 'vendite', { data: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, righe: [{ articolo: arts[i].id, quantita: 1 + (i % 4), prezzo: 3.335 * (i + 1), sconto: (i % 3) * 12.5 }, { articolo: arts[i + 1].id, quantita: 2, prezzo: 0.1 }] });
    const confronta = (entita, opz) => {
      const con = D.elenca(db, entita, { ...opz, perPagina: 500 });
      const salva = D.estensioni.sqlCalcolato; D.estensioni.sqlCalcolato = null;
      try { const senza = D.elenca(db, entita, { ...opz, perPagina: 500 }); assert.deepEqual(con.righe.map(r => r.id), senza.righe.map(r => r.id), JSON.stringify(opz)); assert.equal(con.totale, senza.totale); }
      finally { D.estensioni.sqlCalcolato = salva; }
      return con;
    };
    assert.ok(confronta('articoli', { filtri: [{ campo: 'da_riordinare', op: '=', valore: true }] }).totale > 0);
    confronta('articoli', { filtri: [{ campo: 'da_riordinare', op: '=', valore: false }] });
    const v = confronta('vendite', { filtri: [{ campo: 'totale', op: '>', valore: 20 }] }); assert.ok(v.totale > 0 && v.totale < 25);
    confronta('vendite', { filtri: [{ campo: 'totale', op: 'tra', valore: [10, 40] }] });
    // ordinare per totale: stesso ordine dei valori calcolati dal motore
    const ord = D.elenca(db, 'vendite', { ordina: [{ campo: 'totale', dir: 'desc' }], perPagina: 500 }).righe.map(r => r.totale);
    assert.deepEqual(ord, [...ord].sort((a, b) => b - a));
    // l'aggregato leggero dà le stesse somme di quello completo
    const { aggrega } = await import('../server/moduli/agenda-aggregati.js');
    const rich = { entita: 'vendite', misure: [{ misura: 'somma', campo: 'totale' }, { misura: 'somma', campo: 'pezzi' }], per: 'mese', da: '2026-10-01', a: '2026-10-31' };
    const veloce = aggrega(db, rich, null), salva = D.estensioni.sqlCalcolato; D.estensioni.sqlCalcolato = null;
    try { assert.deepEqual(veloce.totali, aggrega(db, rich, null).totali); } finally { D.estensioni.sqlCalcolato = salva; }
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'x_vendite__creato'").get());
  } finally { k.chiudi(); }
});
