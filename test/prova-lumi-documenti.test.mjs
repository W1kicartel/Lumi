// PROVA (ramo prova-documenti, non per main): Lumi riesce a fare i documenti «a parole»?
// Un finto Claude locale risponde con le chiamate agli strumenti che il modello farebbe (registrate qui sotto, come
// in test/lumi.test.mjs); la richiesta passa dal vero /api/lumi di Kubo, gli strumenti sono quelli VERI generati dallo
// schema (web/moduli/lumi/strumenti.js) e si eseguono come fa il motore del browser: proponi → conferma → esegui.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva } from '../server/automazioni.js';
import { strumentiAnthropic } from '../server/moduli/lumi/nucleo.js';
import { strumenti, istruzioni } from '../web/moduli/lumi/strumenti.js';

attiva();
delete process.env.ANTHROPIC_API_KEY; delete process.env.DEEPGRAM_API_KEY; delete process.env.KUBO_LUMI_LIMITE;
const CHIAVE = 'sk-ant-prova-0123456789abcdef';
const QUI = dirname(fileURLToPath(import.meta.url)), XSD = join(QUI, 'documenti', 'xsd', 'fatturapa-locale.xsd');

// ---------- il finto Claude: a ogni richiesta risponde con la prossima mossa del copione ----------
const sse = evs => evs.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
let copione = [], richieste = [];
const usa = (nome, input) => sse([
  { type: 'message_start', message: { id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${richieste.length}`, name: nome, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } }, { type: 'message_stop' },
]);
const dice = testo => sse([
  { type: 'message_start', message: { id: 'msg_y', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: testo } },
  { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' },
]);
let finto;
before(async () => {
  finto = createServer(async (req, res) => {
    let t = ''; for await (const x of req) t += x; const corpo = JSON.parse(t || '{}'); richieste.push(corpo);
    const mossa = copione.shift(); const testo = typeof mossa === 'function' ? mossa(corpo) : mossa;
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(testo || dice('(copione finito)'));
  });
  await new Promise(r => finto.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${finto.address().port}`;
});
after(() => finto.close());

async function avvia() {
  const srv = creaServer(apri()); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const grezza = (metodo, percorso, corpo) => fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined })
    .then(r => { const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0]; return r; });
  const chiama = async (metodo, percorso, corpo) => { const r = await grezza(metodo, percorso, corpo); return { stato: r.status, json: await r.json().catch(() => null) }; };
  const api = async (metodo, percorso, corpo) => { const r = await chiama(metodo, '/api' + percorso, corpo); if (r.stato >= 400) { const e = new Error(r.json?.errore || `Errore ${r.stato}`); e.corpo = r.json || {}; throw e; } return r.json; };
  return { srv, grezza, chiama, api };
}
const eventi = testo => testo.split('\n\n').filter(Boolean).map(x => JSON.parse(x.replace(/^data: /, '')));

// il giro del motore del browser (web/lumi/motore.js), ridotto: chiede, esegue lo strumento (le scritture solo dopo la
// «conferma», qui automatica ma registrata), rimanda il risultato, finché il modello non risponde a parole
async function conversa(k, lista, domanda, { conferma = () => true } = {}) {
  const per = new Map(lista.map(s => [s.nome, s])), traccia = [];
  const messaggi = [{ role: 'user', content: domanda }];
  const dichiarati = lista.map(s => ({ nome: s.nome, descrizione: s.descrizione, schema: s.schema }));
  for (let giro = 0; giro < 12; giro++) {
    const r = await k.grezza('POST', '/api/lumi', { azione: 'chat', messaggi, strumenti: dichiarati, sistema: istruzioni({ poteri: {} }) });
    assert.equal(r.status, 200);
    const ev = eventi(await r.text()), fine = ev.find(e => e.t === 'fine');
    assert.ok(fine, JSON.stringify(ev.find(e => e.t === 'errore')));
    messaggi.push({ role: 'assistant', content: fine.contenuto });
    const usi = fine.contenuto.filter(b => b.type === 'tool_use');
    if (!usi.length) return { testo: fine.contenuto.map(b => b.text || '').join(''), traccia };
    const risultati = [];
    for (const u of usi) {
      const s = per.get(u.name); let esito;
      if (!s) esito = { errore: `strumento sconosciuto «${u.name}»` };
      else if (s.leggi) esito = await s.leggi(u.input);
      else { const p = await s.proponi(u.input); if (p.errore) esito = p; else if (conferma(u.name, p)) esito = { scheda: p, ...(await s.esegui(u.input)) }; else esito = { annullato: true }; }
      traccia.push({ nome: u.name, input: u.input, esito });
      risultati.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(esito), ...(esito?.errore ? { is_error: true } : {}) });
    }
    messaggi.push({ role: 'user', content: risultati });
  }
  throw new Error('troppi giri');
}

const AZIENDA = { ragione_sociale: 'Studio Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via Roma 1', cap: '20121', comune: 'Milano', provincia: 'MI', iban: 'IT60X0542811101000000123456', banca: 'Banca Prova' };
let k, lista;
before(async () => {
  k = await avvia();
  assert.equal((await k.chiama('POST', '/api/configura', { azienda: 'Studio Prova srl', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga-1', modelli: ['professionista', 'fatture'] })).stato, 200);
  assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { chiave: CHIAVE })).stato, 200);
  assert.equal((await k.chiama('PUT', '/api/documenti/azienda', AZIENDA)).stato, 200);
  await k.api('POST', '/documenti/prepara');
  await k.api('POST', '/dati/clienti', { nome: 'Rossi Srl', piva: '00743110157', codice_destinatario: 'ABC1234', via: 'Via Verdi 2', cap: '00184', comune: 'Roma', provincia: 'RM', nazione: 'IT' });
  const st = await k.api('GET', '/stato');
  lista = strumenti({ schema: await k.api('GET', '/schema'), api: k.api, poteri: st.poteri });
});
after(() => k.srv.close());

test('inventario: cosa vede Lumi per i documenti', () => {
  const nomi = lista.map(s => s.nome);
  for (const n of ['cerca_fatture', 'leggi_fatture', 'crea_fatture', 'modifica_fatture', 'cerca_clienti', 'crea_clienti']) assert.ok(nomi.includes(n), n);
  // gli strumenti passano il controllo del server di Lumi (al massimo 128, schema ≤ 12.000 caratteri)
  assert.ok(strumentiAnthropic(lista.map(s => ({ nome: s.nome, descrizione: s.descrizione, schema: s.schema }))), 'il server rifiuterebbe gli strumenti');
  const crea = lista.find(s => s.nome === 'crea_fatture').schema.properties.valori.properties;
  assert.deepEqual(Object.keys(crea.righe.items.properties).sort(), ['aliquota', 'descrizione', 'natura', 'no_ritenuta', 'prezzo', 'quantita', 'sconto', 'sconto_importo']);
  assert.deepEqual(crea.tipo.enum, ['TD01', 'TD24', 'TD02', 'TD03', 'TD04', 'TD05', 'TD06', 'TD16', 'TD17', 'TD18', 'TD19']);
  // fra quelli generati dallo schema NON ci sono strumenti per le azioni dei documenti: arrivano dal modulo dei documenti con
  // k.lumi (server/moduli/lumidoc.js, provati in test/lumidoc.test.mjs), qui non passati a strumenti()
  const documentali = nomi.filter(n => /fatturapa|xml|stampa|pdf|nota|storna|emetti|controlla|documenti/.test(n));
  console.log(`  strumenti totali: ${nomi.length}; dedicati ai documenti: ${documentali.length ? documentali.join(', ') : 'nessuno'}`);
  assert.deepEqual(documentali, []);
});

test('«fai una fattura a Rossi Srl per 3 ore di consulenza a 80 euro più IVA»: con gli strumenti generati ci riesce (in bozza)', async () => {
  const schede = [];
  copione = [
    usa('cerca_clienti', { testo: 'Rossi' }),
    usa('crea_fatture', { valori: { tipo: 'TD01', cliente: 'Rossi Srl', data: '2026-10-07', righe: [{ descrizione: 'Consulenza', quantita: 3, prezzo: 80, aliquota: 22 }] } }),
    dice('Ho preparato la fattura in bozza: 240 € + IVA 52,80 € = 292,80 €.'),
  ];
  const r = await conversa(k, lista, 'fai una fattura a Rossi Srl per 3 ore di consulenza a 80 euro più IVA', { conferma: (n, p) => { schede.push([n, p]); return true; } });
  assert.equal(r.traccia[0].esito.totale, 1);
  const creata = r.traccia[1].esito; assert.match(creata.testo, /Fatto/); assert.ok(creata.id);
  // la scheda di conferma che la persona vede
  console.log('  scheda di conferma:', JSON.stringify(schede[0][1].righe));
  const f = await k.api('GET', `/dati/fatture/${creata.id}`);
  assert.equal(f.cliente.titolo, 'Rossi Srl'); assert.equal(f.imponibile, 240); assert.equal(f.imposta, 52.8); assert.equal(f.totale, 292.8);
  assert.equal(f.stato, 'bozza'); assert.equal(f.numero, null);
  // il richiesto dal modello passa davvero dal proxy: gli strumenti dichiarati arrivano al «Claude»
  assert.ok(richieste.at(-1).tools.some(t => t.name === 'crea_fatture'));

  // emetterla: c'è solo modifica_fatture { stato: emessa }; il numero lo mette Kubo
  copione = [usa('modifica_fatture', { id: f.id, valori: { stato: 'emessa' } }), dice('Emessa.')];
  await conversa(k, lista, 'emettila');
  const emessa = await k.api('GET', `/dati/fatture/${f.id}`); assert.equal(emessa.numero, '1');

  // il file XML: Lumi non ha uno strumento per farlo; la persona deve premere «FatturaPA» nella scheda
  copione = [dice('Non posso esportare l\'XML: premi «FatturaPA» nella scheda della fattura.')];
  const x = await conversa(k, lista, 'mandami il file XML della fattura');
  assert.equal(x.traccia.length, 0);
  // ma i dati che Lumi ha scritto bastano: dal bottone esce un file valido per lo schema ufficiale
  const file = await k.api('POST', `/documenti/fatturapa/${f.id}`);
  const p = join(mkdtempSync(join(tmpdir(), 'kubo-lumi-xml-')), file.nome); writeFileSync(p, file.xml);
  execFileSync('xmllint', ['--noout', '--nonet', '--schema', XSD, p], { stdio: 'pipe' });
});

test('«fai la nota di credito della fattura 12»: manca lo strumento, il modello deve ricostruirla a mano', async () => {
  const cl = (await k.api('GET', '/dati/clienti?q=Rossi')).righe[0];
  const f12 = await k.api('POST', '/dati/fatture', { cliente: cl.id, numero: '12', data: '2026-09-30', stato: 'emessa', ritenuta: 20, ritenuta_tipo: 'RT01', ritenuta_causale: 'A',
    righe: [{ descrizione: 'Consulenza', quantita: 3, prezzo: 80, aliquota: 22 }] });
  copione = [
    usa('cerca_fatture', { filtri: [{ campo: 'numero', op: '=', valore: '12' }] }),
    c => { const r = JSON.parse(c.messages.at(-1).content[0].content); return usa('leggi_fatture', { id: r.righe[0].id }); },
    // la «ricostruzione» che il modello dovrebbe indovinare: tipo, collegata, stesse righe, stessa ritenuta
    c => usa('crea_fatture', { valori: { tipo: 'TD04', cliente: 'Rossi Srl', collegata: f12.id, data: '2026-10-07', riferimento: 'Storno della fattura 12 del 30/09/2026',
      ritenuta: 20, ritenuta_tipo: 'RT01', ritenuta_causale: 'A', righe: [{ descrizione: 'Consulenza', quantita: 3, prezzo: 80, aliquota: 22 }] } }),
    dice('Ho preparato la nota di credito in bozza collegata alla fattura 12.'),
  ];
  const r = await conversa(k, lista, 'fai la nota di credito della fattura 12');
  assert.equal(r.traccia[0].esito.totale, 1);
  const nc = await k.api('GET', `/dati/fatture/${r.traccia[2].esito.id}`);
  assert.equal(nc.tipo, 'TD04'); assert.equal(nc.collegata.id, f12.id); assert.equal(nc.totale, 292.8);
  // lo stesso con il bottone (rotta dedicata che Lumi non ha): stesso risultato, ma senza che il modello debba ricordarsi niente
  const ufficiale = await k.api('POST', `/documenti/nota-di-credito/${f12.id}`);
  for (const c of ['tipo', 'totale', 'ritenuta', 'ritenuta_tipo', 'ritenuta_causale', 'imposta']) assert.deepEqual(nc[c], ufficiale[c], c);
});

test('i rischi del fare a parole con gli strumenti generici (nessun controllo fiscale prima della conferma)', async () => {
  const cl = (await k.api('GET', '/dati/clienti?q=Rossi')).righe[0];
  // 1) il modello può proporre una fattura che non si potrà mai esportare: IVA 0 senza natura. La scheda di conferma la mostra come buona.
  const crea = lista.find(s => s.nome === 'crea_fatture');
  const inp = { valori: { cliente: cl.id, righe: [{ descrizione: 'Consulenza', quantita: 1, prezzo: 100, aliquota: 0 }] } };
  const scheda = await crea.proponi(inp); assert.ok(!scheda.errore, 'la proposta passa');
  const fatta = await crea.esegui(inp); assert.ok(fatta.id);
  await k.api('PATCH', `/dati/fatture/${fatta.id}`, { stato: 'emessa' });
  const c = await k.api('GET', `/documenti/fatturapa/${fatta.id}`);
  assert.ok(c.errori.some(e => /natura/.test(e)), 'il problema emerge solo all\'esportazione');
  // 2) una fattura già emessa NON si cambia più, nemmeno a parole: il blocco sta nel motore dei dati (giro 3, fatture-regole.js)
  const mod = lista.find(s => s.nome === 'modifica_fatture'), m = { id: fatta.id, valori: { righe: [{ descrizione: 'Consulenza', quantita: 1, prezzo: 150, aliquota: 22 }] } };
  assert.match((await mod.esegui(m)).errore, /è emessa: non si modifica più/);
  assert.equal((await k.api('GET', `/dati/fatture/${fatta.id}`)).imponibile, 100);
  // 3) nemmeno il numero
  assert.match((await mod.esegui({ id: fatta.id, valori: { numero: '12' } })).errore, /è emessa: non si modifica più/);
});

// (era un todo: la scheda mostrava solo «Righe: 1 riga». Ora le righe in più le dà il modulo dei documenti con k.lumi.scheda)
test('la scheda di conferma mostra righe con importi, IVA e totale prima di creare la fattura', async () => {
  const p = await lista.find(s => s.nome === 'crea_fatture').proponi({ valori: { cliente: 'Rossi Srl', righe: [{ descrizione: 'Consulenza', quantita: 3, prezzo: 80, aliquota: 22 }] } });
  const testo = JSON.stringify(p.righe);
  assert.match(testo, /80/); assert.match(testo, /292,80/);
});
