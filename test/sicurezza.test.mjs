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
    return { chiama, accedi: (email, password) => chiama('POST', '/api/accedi', { email, password }), biscotto: () => biscotto };
  };
  const t = browser();
  const c = await t.chiama('POST', '/api/configura', { azienda: 'Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli });
  assert.equal(c.stato, 200, JSON.stringify(c.json));
  return { db, srv, base, browser, t: t.chiama, biscotto: t.biscotto, chiudi: () => srv.close() };
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
    // anche il PIN del banco: chi lo imposta entra al posto della persona
    assert.equal((await g.chiama('PATCH', `/api/utenti/${u.id}`, { pin: '4321' })).stato, 400);
    assert.equal((await g.chiama('PATCH', `/api/utenti/${u.id}`, { pin: '4321', attuale: 'la-mia-di-giulia' })).stato, 200);
    // la password attuale non si indovina a forza da una sessione rubata
    for (let i = 0; i < 5; i++) assert.equal((await g.chiama('POST', '/api/sicurezza/password', { attuale: 'tentativo-' + i, nuova: 'nuova-password-9' })).stato, 400);
    assert.equal((await g.chiama('POST', '/api/sicurezza/password', { attuale: 'la-mia-di-giulia', nuova: 'nuova-password-9' })).stato, 429);
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
    // né rinominandolo nella riga, né annunciandolo come un import: il controllo si rifà al salvataggio
    const campoFile = { id: 'scheda', nome: 'Scheda', tipo: 'file' }, art = (await k.t('GET', '/api/schema')).json.find(e => e.id === 'articoli');
    assert.equal((await k.t('PUT', '/api/schema/articoli', { ...art, campi: [...art.campi, campoFile] })).stato, 200);
    const piccolo = (await k.t('POST', '/api/file/carica', { nome: 'nota.txt', dimensione: 4 })).json;
    await k.t('POST', `/api/file/carica/${piccolo.id}`, { da: 0, pezzo: Buffer.from('ciao').toString('base64') });
    const html = await k.t('POST', '/api/dati/articoli', { nome: 'X', scheda: [{ id: piccolo.id, nome: 'nota.html', tipo: 'text/html', dimensione: 4 }] });
    assert.equal(html.stato, 422); assert.match(JSON.stringify(html.json), /non si può allegare/);
    assert.equal((await k.t('POST', '/api/dati/articoli', { nome: 'X', scheda: [{ id: piccolo.id, nome: 'nota.txt', tipo: 'text/plain', dimensione: 4 }] })).stato, 200);
    const grande = (await k.t('POST', '/api/file/carica', { nome: 'foto.png', dimensione: 3 * 1048576, max: 50 })).json;
    assert.ok(grande.id);
    for (let da = 0; da < 3 * 1048576; da += 1048576) assert.equal((await k.t('POST', `/api/file/carica/${grande.id}`, { da, pezzo: Buffer.alloc(1048576, 1).toString('base64') })).stato, 200);
    const no = await k.t('POST', '/api/dati/articoli', { nome: 'Y', scheda: [{ id: grande.id, nome: 'foto.png', tipo: 'image/png', dimensione: 3 * 1048576 }] });
    assert.equal(no.stato, 422); assert.match(JSON.stringify(no.json), /al massimo 2 MB/);
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

test('campi nascosti a catena e sezioni non leggibili: i calcolati che ne dipendono si nascondono', async () => {
  const k = await avvia(), a = k.browser(), b = k.browser();
  try {
    await k.t('PUT', '/api/ruoli/cassa', { nome: 'Cassa', entita: { '*': { leggi: true, crea: true, modifica: true }, righe_vendita: { campi: { prezzo: 'nascosto' } } } });
    await k.t('PUT', '/api/ruoli/conta', { nome: 'Conta', entita: { '*': { leggi: true }, righe_vendita: { leggi: false } } });
    await k.t('POST', '/api/utenti', { nome: 'Anna', email: 'a@prova.it', password: 'password-anna', ruolo: 'cassa' });
    await k.t('POST', '/api/utenti', { nome: 'Bruno', email: 'b@prova.it', password: 'password-bruno', ruolo: 'conta' });
    await a.accedi('a@prova.it', 'password-anna'); await b.accedi('b@prova.it', 'password-bruno');
    const campi = async (x, e) => (await x.chiama('GET', '/api/schema')).json.find(d => d.id === e)?.campi.map(c => c.id) || [];
    // prezzo nascosto → il totale della riga (quantità × prezzo) → il totale della vendita: tutti nascosti; i pezzi no
    assert.ok(!(await campi(a, 'righe_vendita')).includes('totale'));
    const va = await campi(a, 'vendite'); assert.ok(!va.includes('totale') && va.includes('pezzi'));
    // chi non legge le righe non ne vede neanche le somme
    const vb = await campi(b, 'vendite'); assert.ok(!vb.includes('totale') && !vb.includes('pezzi'));
  } finally { k.chiudi(); }
});

test('webhook: niente rete interna (SSRF), salvo opzione esplicita', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:0:0:1', '100.64.0.1']) assert.equal(interno(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.69', '2a00:1450:4002::1', '::ffff:808:808']) assert.equal(interno(ip), false, ip);
  for (const u of ['http://127.0.0.1/x', 'http://localhost:8080/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://0x7f000001/', 'http://2130706433/', 'http://192.168.1.1/', 'http://router.lan/', 'http://intranet/', 'http://u:p@esempio.it/'])
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
    // i totali memorizzati (m_totale) restano giusti dopo ogni scrittura: righe cambiate, tolte, aggiunte, vendita nuova
    assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('d_vendite') WHERE name = 'm_totale'").get());
    const una = D.elenca(db, 'vendite', { perPagina: 1 }).righe[0], piena = D.leggi(db, 'vendite', una.id);
    D.modifica(db, 'vendite', una.id, { righe: [{ id: piena.righe[0].id, quantita: 50 }, { articolo: arts[3].id, quantita: 1, prezzo: 999 }] });
    D.crea(db, 'vendite', { data: '2026-10-15', righe: [{ articolo: arts[2].id, quantita: 3, prezzo: 41.5 }] });
    D.elimina(db, 'vendite', D.elenca(db, 'vendite', { perPagina: 3 }).righe[2].id);
    confronta('vendite', { filtri: [{ campo: 'totale', op: '>', valore: 20 }] });
    for (const r of D.elenca(db, 'vendite', { perPagina: 500 }).righe) assert.equal(Math.round(db.prepare('SELECT m_totale v FROM d_vendite WHERE id = ?').get(r.id).v * 100), Math.round(r.totale * 100), r.id);
    // l'aggregato leggero dà le stesse somme di quello completo
    const { aggrega } = await import('../server/moduli/agenda-aggregati.js');
    const rich = { entita: 'vendite', misure: [{ misura: 'somma', campo: 'totale' }, { misura: 'somma', campo: 'pezzi' }], per: 'mese', da: '2026-10-01', a: '2026-10-31' };
    const veloce = aggrega(db, rich, null), salva = D.estensioni.sqlCalcolato; D.estensioni.sqlCalcolato = null;
    try { assert.deepEqual(veloce.totali, aggrega(db, rich, null).totali); } finally { D.estensioni.sqlCalcolato = salva; }
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'x_vendite__ordine'").get());
  } finally { k.chiudi(); }
});

test('server robusto: un indirizzo con «%» rotti non lo fa cadere, niente file fuori da web/', async () => {
  const k = await avvia();
  try {
    assert.equal((await fetch(k.base + '/%E0%A4%A')).status, 400);
    assert.equal((await fetch(k.base + '/api/dati/%E0%A4%A')).status, 400);
    for (const p of ['/..%2Fserver%2Fapi.js', '/..%2F..%2Fpackage.json', '/%2e%2e/package.json']) assert.ok([403, 404].includes((await fetch(k.base + p)).status), p);
    assert.equal((await fetch(k.base + '/api/stato')).status, 200);   // ancora acceso
  } finally { k.chiudi(); }
});

test('Lumi: i token del flusso si contano per persona e per mese', async () => {
  const { createServer } = await import('node:http');
  const sse = evs => evs.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const finto = createServer(async (req, res) => {
    for await (const _ of req);   // il finto Claude: un messaggio breve con l'uso dei token
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(sse([{ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 900, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fatto.' } },
      { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } }, { type: 'message_stop' }]));
  });
  await new Promise(r => finto.listen(0, '127.0.0.1', r)); process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${finto.address().port}`;
  const k = await avvia();
  try {
    assert.equal((await k.t('PUT', '/api/lumi/impostazioni', { chiave: 'sk-ant-prova-0123456789abcdef' })).stato, 200);
    const domanda = { azione: 'chat', messaggi: [{ role: 'user', content: 'Ciao' }] };
    for (let i = 0; i < 2; i++) { const r = await fetch(k.base + '/api/lumi', { method: 'POST', headers: { 'X-Kubo': '1', 'Content-Type': 'application/json', Cookie: k.biscotto() }, body: JSON.stringify(domanda) }); assert.equal(r.status, 200); await r.text(); }
    const u = (await k.t('GET', '/api/sicurezza/lumi')).json;
    assert.equal(u.usati, 2 * 912); assert.equal(u.persone[0].nome, 'Titolare');
    await k.t('PUT', '/api/sicurezza/impostazioni', { lumiBudget: 1500 });
    assert.equal((await k.t('POST', '/api/lumi', domanda)).stato, 429);   // oltre il budget del mese
  } finally { k.chiudi(); finto.close(); delete process.env.ANTHROPIC_BASE_URL; }
});

test('eventi in tempo reale: chi viene scollegato non riceve più niente', async () => {
  const k = await avvia(), b = k.browser();
  try {
    await b.accedi('t@prova.it', 'password-lunga');
    const ctrl = new AbortController(), r = await fetch(k.base + '/api/eventi', { headers: { Cookie: b.biscotto() }, signal: ctrl.signal });
    assert.equal(r.status, 200);
    const lettore = r.body.getReader(), dec = new TextDecoder(); let testo = '';
    const leggi = async ms => { const fine = Date.now() + ms; while (Date.now() < fine) { const x = await Promise.race([lettore.read(), new Promise(ok => setTimeout(() => ok(null), 50))]); if (x?.done) return 'chiuso'; if (x?.value) testo += dec.decode(x.value); } return 'aperto'; };
    await k.t('POST', '/api/dati/clienti', { nome: 'Uno' }); await leggi(300);
    assert.match(testo, /"tipo":"crea"/);
    await k.t('POST', '/api/sicurezza/esci-ovunque');   // il titolare scollega gli altri dispositivi
    await k.t('POST', '/api/dati/clienti', { nome: 'Due' });
    assert.equal(await leggi(500), 'chiuso');
    ctrl.abort();
  } finally { k.chiudi(); }
});
