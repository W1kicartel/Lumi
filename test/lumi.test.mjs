// Prove di Lumi dentro Kubo, senza rete: un finto Claude locale (risposte SSE registrate) fa la parte dell'API di
// Anthropic. Si provano la chiave (mai al browser, file 600), la chat in streaming, il limite per utente, gli strumenti
// generati dallo schema dei tre modelli, letture e proposte con i permessi, la modifica dello schema e le automazioni
// applicate solo dopo la conferma, «Da vedere» e il riepilogo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, statSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva, suAvviso } from '../server/automazioni.js';
import { strumentiAnthropic } from '../server/moduli/lumi/nucleo.js';
import { strumenti } from '../web/moduli/lumi/strumenti.js';

attiva();
delete process.env.ANTHROPIC_API_KEY; delete process.env.DEEPGRAM_API_KEY; delete process.env.KUBO_LUMI_LIMITE;
const CHIAVE = 'sk-ant-prova-0123456789abcdef';

// ---------- il finto Claude: registra le richieste e risponde con un flusso SSE come quello vero ----------
const sse = evs => evs.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const RISPOSTA = sse([
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 900, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'firma' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Questa settimana hai venduto ' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '**120 €**.' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } },
  { type: 'message_stop' },
]);
let finto, richieste = [];
before(async () => {
  finto = createServer(async (req, res) => {
    let t = ''; for await (const x of req) t += x;
    richieste.push({ url: req.url, intestazioni: req.headers, corpo: JSON.parse(t || '{}') });
    if (req.headers['x-api-key'] !== CHIAVE) { res.writeHead(401, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"authentication_error","message":"chiave"}}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(RISPOSTA);
  });
  await new Promise(r => finto.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${finto.address().port}`;
});
after(() => finto.close());

// ---------- Kubo, come in api.test.mjs ----------
async function avvia(db = apri()) {
  const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const grezza = (metodo, percorso, corpo) => fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined })
    .then(r => { const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0]; return r; });
  const chiama = async (metodo, percorso, corpo) => { const r = await grezza(metodo, percorso, corpo); return { stato: r.status, json: await r.json().catch(() => null) }; };
  // la stessa api() del browser (web/ui.js), per gli strumenti
  const api = async (metodo, percorso, corpo) => { const r = await chiama(metodo, '/api' + percorso, corpo); if (r.stato >= 400) { const e = new Error(r.json?.errore || `Errore ${r.stato}`); e.corpo = r.json || {}; throw e; } return r.json; };
  const accedi = (email, password) => { biscotto = ''; return chiama('POST', '/api/accedi', { email, password }); };
  return { srv, db, grezza, chiama, api, accedi };
}
const configura = (k, modelli = ['negozio']) => k.chiama('POST', '/api/configura', { azienda: 'Bottega Prova', nome: 'Titolare', email: 'titolare@esempio.it', password: 'prova-kubo-1', modelli });
const eventi = testo => testo.split('\n\n').filter(Boolean).map(x => JSON.parse(x.replace(/^data: /, '')));
const domanda = { azione: 'chat', messaggi: [{ role: 'user', content: 'Quanto ho venduto questa settimana?' }], strumenti: [{ nome: 'riepilogo', descrizione: 'conti', schema: { type: 'object', properties: {} } }] };
const genera = async (k, extra = {}) => { const st = await k.api('GET', '/stato'); return strumenti({ schema: await k.api('GET', '/schema'), api: k.api, poteri: st.poteri, ...extra }); };
const perNome = (lista, n) => lista.find(s => s.nome === n);

test('chiave mai al browser, chat in streaming verso il finto Claude, limite per utente, permessi', async () => {
  const k = await avvia();
  try {
    assert.equal((await configura(k)).stato, 200);
    let st = (await k.chiama('POST', '/api/lumi', { azione: 'stato' })).json;
    assert.equal(st.claude, false); assert.equal(st.chiave, false);
    const senza = await k.chiama('POST', '/api/lumi', domanda);
    assert.equal(senza.stato, 400); assert.match(senza.json.errore, /chiave di Claude.*Gestione → Lumi/);
    assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { chiave: 'non-una-chiave' })).stato, 400);
    const salvata = await k.chiama('PUT', '/api/lumi/impostazioni', { chiave: CHIAVE });
    assert.equal(salvata.stato, 200); assert.equal(salvata.json.chiave, true); assert.equal(salvata.json.fonte, 'impostazioni');
    assert.ok(!JSON.stringify(salvata.json).includes('sk-ant'));
    assert.ok(!JSON.stringify((await k.chiama('GET', '/api/lumi/impostazioni')).json).includes('sk-ant'));
    assert.ok(!JSON.stringify((await k.chiama('GET', '/api/stato')).json).includes('sk-ant'));
    st = (await k.chiama('POST', '/api/lumi', { azione: 'stato' })).json; assert.equal(st.claude, true); assert.equal(st.modello, 'claude-opus-5-5');

    // la chat: SSE dal finto Claude, tradotta negli eventi di Lumi
    richieste = [];
    const r = await k.grezza('POST', '/api/lumi', domanda);
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const ev = eventi(await r.text());
    assert.deepEqual(ev.filter(e => e.t === 'testo').map(e => e.d).join(''), 'Questa settimana hai venduto **120 €**.');
    const fine = ev.find(e => e.t === 'fine'); assert.equal(fine.stop, 'end_turn'); assert.equal(fine.contenuto[0].signature, 'firma');
    const inviata = richieste[0];
    assert.equal(inviata.url, '/v1/messages'); assert.equal(inviata.intestazioni['x-api-key'], CHIAVE);
    assert.equal(inviata.corpo.model, 'claude-opus-5-5'); assert.deepEqual(inviata.corpo.thinking, { type: 'adaptive' });
    assert.equal(inviata.corpo.output_config.effort, 'low'); assert.equal(inviata.corpo.stream, true);
    assert.match(inviata.corpo.system[0].text, /Bottega Prova/); assert.equal(inviata.corpo.tools[0].name, 'riepilogo');

    // il limite: 2 domande al minuto per persona
    assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { limite: 2 })).stato, 200);
    assert.equal((await k.grezza('POST', '/api/lumi', domanda).then(x => x.text().then(() => x.status))), 200);
    assert.equal((await k.chiama('POST', '/api/lumi', domanda)).stato, 429);

    // un collaboratore usa Lumi (ha il suo conto), ma non tocca le impostazioni
    assert.equal((await k.chiama('POST', '/api/utenti', { nome: 'Giulia', email: 'giulia@esempio.it', password: 'password-giulia', ruolo: 'collaboratore' })).stato, 200);
    await k.accedi('giulia@esempio.it', 'password-giulia');
    assert.equal((await k.chiama('GET', '/api/lumi/impostazioni')).stato, 403);
    assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { chiave: CHIAVE })).stato, 403);
    assert.equal((await k.grezza('POST', '/api/lumi', domanda).then(x => x.text().then(() => x.status))), 200);
    assert.equal((await k.chiama('POST', '/api/lumi/verifica', { entita: [] })).stato, 403);

    // spento dal titolare: nessuno chiede più a Claude
    await k.accedi('titolare@esempio.it', 'prova-kubo-1');
    await k.chiama('PUT', '/api/lumi/impostazioni', { attivo: false, limite: 50 });
    assert.equal((await k.chiama('POST', '/api/lumi', { azione: 'stato' })).json.claude, false);
    assert.equal((await k.chiama('POST', '/api/lumi', domanda)).stato, 400);
    // senza sessione niente
    await k.accedi('', ''); assert.equal((await k.chiama('POST', '/api/lumi', { azione: 'stato' })).stato, 401);
  } finally { k.srv.close(); }
});

test('la chiave sta in un file con permessi 600 accanto al database, non nel database', async () => {
  const cartella = mkdtempSync(join(tmpdir(), 'kubo-lumi-'));
  const k = await avvia(apri(join(cartella, 'kubo.db')));
  try {
    await configura(k);
    assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { chiave: CHIAVE })).stato, 200);
    assert.ok(readdirSync(cartella).includes('lumi-chiave'));
    assert.equal(statSync(join(cartella, 'lumi-chiave')).mode & 0o777, 0o600);
    assert.equal(k.db.prepare("SELECT COUNT(*) n FROM _meta WHERE valore LIKE '%sk-ant%'").get().n, 0);
    assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { togliChiave: true })).json.chiave, false);
    assert.ok(!readdirSync(cartella).includes('lumi-chiave'));
  } finally { k.srv.close(); k.db.close(); rmSync(cartella, { recursive: true, force: true }); }
});

test('strumenti generati dallo schema dei tre modelli, accettati dal server di Lumi', async () => {
  for (const modello of ['negozio', 'laboratorio', 'studio']) {
    const k = await avvia();
    try {
      await configura(k, [modello]);
      const schema = await k.api('GET', '/schema'), lista = await genera(k);
      const nomi = lista.map(s => s.nome);
      for (const e of schema.filter(e => !e.nascosta)) for (const p of ['cerca', 'leggi', 'crea', 'modifica']) assert.ok(nomi.includes(`${p}_${e.id}`), `${modello}: manca ${p}_${e.id}`);
      for (const e of schema.filter(e => e.nascosta)) assert.ok(!nomi.includes(`cerca_${e.id}`));
      for (const n of ['riepilogo', 'da_vedere', 'proponi_modifica_schema', 'proponi_automazione']) assert.ok(nomi.includes(n), `${modello}: manca ${n}`);
      assert.ok(strumentiAnthropic(lista.map(s => ({ nome: s.nome, descrizione: s.descrizione, schema: s.schema }))), `${modello}: il server di Lumi rifiuta gli strumenti`);
      for (const s of lista) assert.equal(typeof (s.leggi || s.proponi), 'function');
    } finally { k.srv.close(); }
  }
  // lo schema dei valori viene dai campi: tipi, opzioni, obbligatori, niente calcolati
  const k = await avvia();
  try {
    await configura(k);
    const lista = await genera(k), crea = perNome(lista, 'crea_articoli').schema.properties.valori;
    assert.equal(crea.properties.prezzo.type, 'number'); assert.deepEqual(crea.properties.categoria.enum, ['generale']);
    assert.deepEqual(crea.required, ['nome']); assert.equal(crea.properties.da_riordinare, undefined); assert.equal(crea.additionalProperties, false);
    const vendita = perNome(lista, 'crea_vendite').schema.properties.valori.properties;
    assert.equal(vendita.righe.type, 'array'); assert.ok(vendita.righe.items.properties.articolo); assert.equal(vendita.righe.items.properties.vendita, undefined);
    assert.deepEqual(vendita.stato.enum, ['aperta', 'pagata', 'annullata']);
    // chi può solo leggere non riceve strumenti di scrittura né di personalizzazione
    await k.chiama('POST', '/api/utenti', { nome: 'Ospite', email: 'ospite@esempio.it', password: 'password-ospite', ruolo: 'lettura' });
    await k.accedi('ospite@esempio.it', 'password-ospite');
    const sola = (await genera(k)).map(s => s.nome);
    assert.ok(sola.includes('cerca_articoli')); assert.ok(!sola.some(n => /^(crea|modifica|proponi)_/.test(n)));
  } finally { k.srv.close(); }
});

test('letture e proposte passano dalle API con la sessione: niente scritto prima del Conferma', async () => {
  const k = await avvia();
  try {
    await configura(k);
    let lista = await genera(k);
    const conta = async e => (await k.api('GET', `/dati/${e}`)).totale;
    const nuovo = { valori: { nome: 'Vaso blu', prezzo: 30, costo: 12, giacenza: 1, soglia: 3 } };
    const p = await perNome(lista, 'crea_articoli').proponi(nuovo);
    assert.equal(p.titolo, 'Nuovo in Articoli'); assert.ok(p.righe.some(([n, v]) => n === 'Prezzo' && /30,00/.test(v)));
    assert.equal(await conta('articoli'), 0, 'la proposta non scrive');
    const fatto = await perNome(lista, 'crea_articoli').esegui(nuovo); assert.ok(fatto.id); assert.equal(await conta('articoli'), 1);
    assert.match((await perNome(lista, 'crea_articoli').proponi({ valori: { prezzo: 3 } })).errore, /mancano: Nome/);
    await perNome(lista, 'crea_clienti').esegui({ valori: { nome: 'Marta Ferri' } });
    // una vendita con il cliente e l'articolo dati per nome
    const vendita = { valori: { cliente: 'Marta', pagamento: 'carta', righe: [{ articolo: 'vaso blu', quantita: 2, prezzo: 30 }] } };
    const pv = await perNome(lista, 'crea_vendite').proponi(vendita);
    assert.ok(pv.righe.some(([n, v]) => n === 'Cliente' && v === 'Marta Ferri'), JSON.stringify(pv));
    assert.ok(pv.righe.some(([n, v]) => n === 'Articoli' && /Vaso blu × 2/.test(v)), JSON.stringify(pv));
    assert.equal(await conta('vendite'), 0);
    const v = await perNome(lista, 'crea_vendite').esegui(vendita); assert.ok(v.id);
    assert.equal((await k.api('GET', `/dati/vendite/${v.id}`)).totale, 60);
    assert.match((await perNome(lista, 'crea_vendite').proponi({ valori: { cliente: 'Nessuno Così' } })).errore, /non trovo/);
    // modifica: prima → dopo, e solo dopo il Conferma
    const pm = await perNome(lista, 'modifica_articoli').proponi({ id: fatto.id, valori: { prezzo: 35 } });
    assert.ok(pm.righe.some(([n, x]) => n === 'Prezzo' && /30,00.*→.*35,00/.test(x)));
    assert.equal((await k.api('GET', `/dati/articoli/${fatto.id}`)).prezzo, 30);
    await perNome(lista, 'modifica_articoli').esegui({ id: fatto.id, valori: { prezzo: 35 } });
    assert.equal((await k.api('GET', `/dati/articoli/${fatto.id}`)).prezzo, 35);
    const trovati = await perNome(lista, 'cerca_articoli').leggi({ filtri: [{ campo: 'da_riordinare', op: '=', valore: true }] });
    assert.equal(trovati.totale, 1); assert.equal(trovati.righe[0].nome, 'Vaso blu'); assert.equal(trovati.righe[0].costo, 12);
    // un ruolo che non vede il costo: niente costo negli strumenti né nei risultati, e il server lo rifiuta comunque
    await k.chiama('PUT', '/api/ruoli/banco', { nome: 'Banco', entita: { '*': { leggi: true, crea: true, modifica: true }, articoli: { campi: { costo: 'nascosto' } } } });
    await k.chiama('POST', '/api/utenti', { nome: 'Banco', email: 'banco@esempio.it', password: 'password-banco', ruolo: 'banco' });
    await k.accedi('banco@esempio.it', 'password-banco');
    lista = await genera(k);
    assert.equal(perNome(lista, 'crea_articoli').schema.properties.valori.properties.costo, undefined);
    assert.equal((await perNome(lista, 'leggi_articoli').leggi({ id: fatto.id })).costo, undefined);
    assert.match((await perNome(lista, 'modifica_articoli').proponi({ id: fatto.id, valori: { costo: 1 } })).errore, /costo/);
    assert.equal(perNome(lista, 'proponi_modifica_schema'), undefined);
    assert.ok((await perNome(lista, 'riepilogo').leggi({ entita: 'articoli', somma: ['costo'] })).errore);
  } finally { k.srv.close(); }
});

test('personalizzare a parole: taglia, sezione noleggi e automazione, applicate solo dopo il Conferma', async () => {
  const k = await avvia(); const avvisi = []; suAvviso(a => avvisi.push(a));
  try {
    await configura(k);
    let lista = await genera(k);
    const campiDi = async e => (await k.api('GET', '/schema')).find(x => x.id === e)?.campi.map(c => c.id) || [];
    // «aggiungi la taglia agli articoli con S M L XL»
    const taglia = { operazioni: [{ tipo: 'aggiungi_campo', sezione: 'articoli', nome: 'Taglia', tipo_campo: 'scelta', opzioni: ['S', 'M', 'L', 'XL'] }] };
    const pt = await perNome(lista, 'proponi_modifica_schema').proponi(taglia);
    assert.deepEqual(pt.righe, [['Articoli · + Taglia', 'scelta: S, M, L, XL']]);
    assert.ok(!(await campiDi('articoli')).includes('taglia'), 'la proposta (e la sua verifica) non cambia lo schema');
    assert.equal((await perNome(lista, 'proponi_modifica_schema').esegui(taglia)).testo, 'Fatto: il gestionale è cambiato.');
    const art = (await k.api('GET', '/schema')).find(x => x.id === 'articoli');
    assert.deepEqual(art.campi.find(c => c.id === 'taglia').opzioni.map(o => o.id), ['s', 'm', 'l', 'xl']);
    // una modifica sbagliata si ferma alla verifica e non lascia tracce
    lista = await genera(k);
    const sbagliata = await perNome(lista, 'proponi_modifica_schema').proponi({ operazioni: [{ tipo: 'aggiungi_campo', sezione: 'articoli', nome: 'Valore', tipo_campo: 'calcolato', formula: 'prezzo * inesistente' }] });
    assert.match(sbagliata.errore, /inesistente/); assert.ok(!(await campiDi('articoli')).includes('valore'));
    // «fammi una sezione per i noleggi con cliente, attrezzo, dal, al e stato»
    const noleggi = { operazioni: [{ tipo: 'nuova_sezione', sezione: 'Noleggi', nome: 'Noleggi', icona: 'calendario', campi: [
      { nome: 'Cliente', tipo_campo: 'relazione', collegato_a: 'clienti' }, { nome: 'Attrezzo', tipo_campo: 'testo', obbligatorio: true },
      { nome: 'Dal', tipo_campo: 'data' }, { nome: 'Al', tipo_campo: 'data' }, { nome: 'Stato', tipo_campo: 'stato', opzioni: ['Prenotato', 'In corso', 'Restituito'] }] }] };
    const pn = await perNome(lista, 'proponi_modifica_schema').proponi(noleggi);
    assert.equal(pn.righe[0][1], 'Noleggi'); assert.ok(pn.righe.some(([n, v]) => n === 'Noleggi · Cliente' && v === 'collegamento → Clienti'));
    assert.equal((await k.api('GET', '/schema')).some(e => e.id === 'noleggi'), false);
    await perNome(lista, 'proponi_modifica_schema').esegui(noleggi);
    const def = (await k.api('GET', '/schema')).find(e => e.id === 'noleggi');
    assert.equal(def.titolo, 'attrezzo'); assert.equal(def.campi.find(c => c.id === 'cliente').entita, 'clienti');
    assert.equal(def.campi.find(c => c.id === 'stato').opzioni.find(o => o.id === 'restituito').colore, 'verde');
    // i suoi strumenti arrivano subito
    lista = await genera(k); assert.ok(perNome(lista, 'crea_noleggi'));
    // «quando un noleggio passa a restituito avvisami»
    const auto = { nome: 'Noleggio restituito', sezione: 'noleggi', quando: 'campo_cambia', campo: 'stato', diventa: 'Restituito', azioni: [{ tipo: 'avvisa', testo: '"Rientrato: " & attrezzo' }] };
    const pa = await perNome(lista, 'proponi_automazione').proponi(auto);
    assert.ok(pa.righe.some(([n, v]) => n === 'Quando' && /Stato.*Restituito/.test(v)), JSON.stringify(pa));
    assert.equal((await k.api('GET', '/automazioni')).some(a => a.entita === 'noleggi'), false);
    await perNome(lista, 'proponi_automazione').esegui(auto);
    const salvata = (await k.api('GET', '/automazioni')).find(a => a.entita === 'noleggi');
    assert.equal(salvata.a, 'restituito'); assert.equal(salvata.attiva, true);
    await perNome(lista, 'crea_clienti').esegui({ valori: { nome: 'Luca Neri' } });
    const n = await perNome(lista, 'crea_noleggi').esegui({ valori: { cliente: 'Luca Neri', attrezzo: 'Trapano', stato: 'prenotato' } });
    await perNome(lista, 'modifica_noleggi').esegui({ id: n.id, valori: { stato: 'restituito' } });
    assert.ok(avvisi.some(a => a.testo === 'Rientrato: Trapano'), JSON.stringify(avvisi));
    // un avviso scritto come testo semplice diventa una formula di testo
    assert.equal((await perNome(lista, 'proponi_automazione').proponi({ ...auto, nome: 'Altro', quando: 'creato', campo: undefined, diventa: undefined, azioni: [{ tipo: 'avvisa', testo: 'Nuovo noleggio' }] })).errore, undefined);
  } finally { k.srv.close(); }
});

test('«Da vedere» dallo schema e riepilogo per periodo, con i permessi', async () => {
  const k = await avvia();
  try {
    await configura(k);
    const lista = await genera(k), oggi = new Date().toISOString().slice(0, 10), ieri = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    await k.api('POST', '/dati/articoli', { nome: 'Tazza', prezzo: 8, giacenza: 1, soglia: 5 });
    await k.api('POST', '/dati/articoli', { nome: 'Piatto', prezzo: 12, giacenza: 9, soglia: 2 });
    const forn = await k.api('POST', '/dati/fornitori', { nome: 'Fornace srl' });
    await k.api('POST', '/dati/ordini', { fornitore: forn.id, consegna_prevista: ieri });
    const cose = await k.api('GET', '/lumi/da-vedere');
    const riordino = cose.find(c => c.entita === 'articoli' && c.campo === 'da_riordinare');
    assert.equal(riordino.numero, 1); assert.equal(riordino.testo, 'Articoli: da riordinare');
    const ritardo = cose.find(c => c.entita === 'ordini' && c.campo === 'consegna_prevista');
    assert.equal(ritardo?.livello, 'urgente', JSON.stringify(cose)); assert.equal(cose[0].livello, 'urgente');
    assert.deepEqual((await perNome(lista, 'da_vedere').leggi({})).cose.map(c => c.testo), cose.map(c => c.testo));
    // «quanto ho venduto questa settimana»
    const tazza = (await k.api('GET', '/dati/articoli?q=tazza')).righe[0];
    for (const [stato, pagamento, q] of [['pagata', 'carta', 2], ['pagata', 'contanti', 1], ['aperta', 'carta', 5]])
      await k.api('POST', '/dati/vendite', { stato, pagamento, righe: [{ articolo: tazza.id, quantita: q, prezzo: 8 }] });
    const r = await perNome(lista, 'riepilogo').leggi({ entita: 'vendite', filtri: [{ campo: 'stato', op: '=', valore: 'pagata' }], dal: ieri, al: oggi, somma: ['totale', 'pezzi'], raggruppa: 'pagamento' });
    assert.equal(r.conteggio, 2); assert.deepEqual(r.somme, { totale: 24, pezzi: 3 });
    assert.deepEqual(r.gruppi.map(g => [g.valore, g.conteggio, g.somme.totale]).sort(), [['Carta', 1, 16], ['Contanti', 1, 8]]);
    assert.equal((await perNome(lista, 'riepilogo').leggi({ entita: 'vendite', dal: '2001-01-01', al: '2001-12-31' })).conteggio, 0);
    // un ruolo senza le vendite non le vede né in «Da vedere» né nel riepilogo
    await k.chiama('PUT', '/api/ruoli/magazzino', { nome: 'Magazzino', entita: { '*': { leggi: true }, vendite: { leggi: false }, ordini: { leggi: false } } });
    await k.chiama('POST', '/api/utenti', { nome: 'Piero', email: 'piero@esempio.it', password: 'password-piero', ruolo: 'magazzino' });
    await k.accedi('piero@esempio.it', 'password-piero');
    assert.ok(!(await k.api('GET', '/lumi/da-vedere')).some(c => ['vendite', 'ordini'].includes(c.entita)));
    assert.equal((await k.chiama('POST', '/api/lumi/riepilogo', { entita: 'vendite' })).stato, 403);
  } finally { k.srv.close(); }
});

test('archiviare a parole: solo i campi chiesti, mai quelli nascosti a chi propone', async () => {
  const k = await avvia();
  try {
    await configura(k);
    let lista = await genera(k);
    const via = { operazioni: [{ tipo: 'archivia_campo', sezione: 'clienti', campo: 'consenso' }] };
    const p = await perNome(lista, 'proponi_modifica_schema').proponi(via);
    assert.match(p.righe[0][1], /archiviato/);
    await perNome(lista, 'proponi_modifica_schema').esegui(via);
    assert.ok(!(await k.api('GET', '/schema')).find(e => e.id === 'clienti').campi.some(c => c.id === 'consenso'));
    // un responsabile che personalizza ma non vede il costo: una sua modifica degli articoli non deve archiviarlo
    await k.chiama('PUT', '/api/ruoli/responsabile', { nome: 'Responsabile', schema: true, entita: { '*': { leggi: true, crea: true, modifica: true }, articoli: { campi: { costo: 'nascosto' } } } });
    await k.chiama('POST', '/api/utenti', { nome: 'Rita', email: 'rita@esempio.it', password: 'password-rita', ruolo: 'responsabile' });
    await k.accedi('rita@esempio.it', 'password-rita');
    lista = await genera(k);
    const r = await perNome(lista, 'proponi_modifica_schema').proponi({ operazioni: [{ tipo: 'aggiungi_campo', sezione: 'articoli', nome: 'Colore', tipo_campo: 'testo' }] });
    assert.match(r.errore, /articoli\.costo.*titolare/);
    await k.accedi('titolare@esempio.it', 'prova-kubo-1');
    assert.ok((await k.api('GET', '/schema')).find(e => e.id === 'articoli').campi.some(c => c.id === 'costo'));
  } finally { k.srv.close(); }
});

test('«Da vedere» negli altri modelli: commesse in ritardo senza doppioni, pacchetti scaduti', async () => {
  const k = await avvia();
  try {
    await configura(k, ['laboratorio', 'studio']);
    const ieri = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const schema = await k.api('GET', '/schema'), commesse = schema.find(e => e.id === 'commesse'), pacchetti = schema.find(e => e.id === 'pacchetti');
    const minimo = def => Object.fromEntries(def.campi.filter(c => c.obbligatorio && c.tipo === 'testo').map(c => [c.id, 'Prova']));
    const cliente = (await k.api('POST', '/dati/clienti', { nome: 'Studio Bianchi' })).id;
    const conCliente = def => Object.fromEntries(def.campi.filter(c => c.obbligatorio && c.tipo === 'relazione' && c.entita === 'clienti').map(c => [c.id, cliente]));
    await k.api('POST', '/dati/commesse', { ...minimo(commesse), ...conCliente(commesse), consegna: ieri });
    await k.api('POST', '/dati/pacchetti', { ...minimo(pacchetti), ...conCliente(pacchetti), scadenza: ieri });
    const cose = await k.api('GET', '/lumi/da-vedere');
    assert.ok(cose.some(c => c.entita === 'commesse' && c.campo === 'in_ritardo'), JSON.stringify(cose));
    assert.ok(!cose.some(c => c.entita === 'commesse' && c.campo === 'consegna'), 'la consegna passata è già «in ritardo»');
    assert.ok(cose.some(c => c.entita === 'pacchetti' && c.campo === 'scadenza' && c.livello === 'urgente'), JSON.stringify(cose));
  } finally { k.srv.close(); }
});
