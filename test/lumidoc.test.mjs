// Lumi per i documenti: il contratto «strumenti di Lumi dai moduli» (k.lumi) e gli strumenti delle fatture, senza rete.
// Un finto Claude locale risponde con le chiamate che il modello farebbe (come test/lumi.test.mjs); la richiesta passa dal
// vero /api/lumi, gli strumenti sono quelli veri (generati dallo schema + registrati dai moduli) e si eseguono come fa il
// motore del browser: leggi subito, proponi → scheda → conferma → esegui.
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
import * as P from '../server/permessi.js';
import * as D from '../server/dati.js';
import { strumentiAnthropic } from '../server/moduli/lumi/nucleo.js';
import { registroLumi, controllaArgomenti } from '../server/moduli/lumi/registro.js';
import rotteStrumenti from '../server/moduli/lumi-strumenti.js';
import { cfValido } from '../server/moduli/documenti-italia.js';
import { strumenti, istruzioni } from '../web/moduli/lumi/strumenti.js';

attiva();
delete process.env.ANTHROPIC_API_KEY; delete process.env.DEEPGRAM_API_KEY; delete process.env.KUBO_LUMI_LIMITE;
const CHIAVE = 'sk-ant-prova-0123456789abcdef';
const QUI = dirname(fileURLToPath(import.meta.url)), XSD = join(QUI, 'documenti', 'xsd', 'fatturapa-locale.xsd');

// ---------- il contratto, da solo: un modulo finto registra due strumenti ----------
test('contratto k.lumi: registrazione, permessi, leggi subito, scrivi solo con il gettone della sua anteprima, errori leggibili', async () => {
  const lumi = registroLumi(), rotte = {}, eseguiti = [];
  class ErroreHttp extends Error { constructor(stato, m) { super(m); this.stato = stato; } }
  rotteStrumenti({ r: (m, p, f) => { rotte[`${m} ${p}`] = f; }, lumi, P, D, serve: ctx => ctx, ErroreHttp });
  assert.throws(() => lumi.strumento({ nome: 'senza tipo', esegui() {} }), /nome di strumento non valido/);
  assert.throws(() => lumi.strumento({ nome: 'scrive', tipo: 'scrivi', esegui() {} }), /serve anteprima/);
  lumi.strumento({ nome: 'conta', tipo: 'leggi', descrizione: 'conta', schema: { type: 'object', properties: { n: { type: 'integer', maximum: 10 } }, required: ['n'] }, esegui: async ({ args }) => ({ doppio: args.n * 2 }) });
  lumi.strumento({ nome: 'segna', tipo: 'scrivi', permesso: ctx => ctx.r.id === 'titolare', schema: { type: 'object', properties: { cosa: { type: 'string', enum: ['a', 'b'] } }, required: ['cosa'] },
    anteprima: async ({ args }) => ({ titolo: 'Segno', righe: [['Cosa', args.cosa]], avvisi: ['attento'] }), esegui: async ({ args, ctx }) => { eseguiti.push([args.cosa, ctx.utente.id]); return { testo: 'Fatto' }; } });
  lumi.istruzioni('usa conta per contare'); lumi.sostituisce('crea_x');
  const tit = { utente: { id: 'u1' }, r: { id: 'titolare' } }, col = { utente: { id: 'u2' }, r: { id: 'lettura', entita: {} } };
  const chiama = (k, ctx, p, corpo) => rotte[k]({ ctx, p, corpo });
  const elenco = chiama('GET /api/lumi/strumenti', tit, {});
  assert.deepEqual(elenco.strumenti.map(s => [s.nome, s.tipo]), [['conta', 'leggi'], ['segna', 'scrivi']]);
  assert.deepEqual(elenco.istruzioni, ['usa conta per contare']); assert.deepEqual(elenco.sostituiti, ['crea_x']);
  assert.deepEqual(chiama('GET /api/lumi/strumenti', col, {}).strumenti.map(s => s.nome), ['conta']);   // il permesso nasconde
  // leggi: subito; argomenti sbagliati → un messaggio che il modello capisce
  assert.deepEqual(await chiama('POST /api/lumi/strumenti/:nome', tit, { nome: 'conta' }, { args: { n: 4 } }), { doppio: 8 });
  await assert.rejects(chiama('POST /api/lumi/strumenti/:nome', tit, { nome: 'conta' }, { args: { n: 40 } }), /Argomenti non validi per conta: args.n: fuori dai limiti/);
  await assert.rejects(chiama('POST /api/lumi/strumenti/:nome', tit, { nome: 'conta' }, { args: {} }), /args.n: obbligatorio/);
  await assert.rejects(chiama('POST /api/lumi/strumenti/:nome', tit, { nome: 'nessuno' }, {}), e => e.stato === 404);
  await assert.rejects(chiama('POST /api/lumi/strumenti/:nome', tit, { nome: 'segna' }, { args: { cosa: 'a' } }), /prima la scheda di conferma/);
  // scrivi: chi non ha il permesso non arriva nemmeno alla scheda
  await assert.rejects(chiama('POST /api/lumi/strumenti/:nome/anteprima', col, { nome: 'segna' }, { args: { cosa: 'a' } }), P.ErrorePermesso);
  // senza gettone, con il gettone di altri argomenti, di un'altra persona o già usato: niente
  await assert.rejects(chiama('POST /api/lumi/strumenti/:nome/esegui', tit, { nome: 'segna' }, { args: { cosa: 'a' } }), e => e.stato === 409);
  const sch = await chiama('POST /api/lumi/strumenti/:nome/anteprima', tit, { nome: 'segna' }, { args: { cosa: 'a' } });
  assert.deepEqual([sch.titolo, sch.righe, sch.avvisi], ['Segno', [['Cosa', 'a']], ['attento']]); assert.ok(sch.gettone);
  await assert.rejects(chiama('POST /api/lumi/strumenti/:nome/esegui', tit, { nome: 'segna' }, { args: { cosa: 'b' }, gettone: sch.gettone }), e => e.stato === 409);
  const sch2 = await chiama('POST /api/lumi/strumenti/:nome/anteprima', tit, { nome: 'segna' }, { args: { cosa: 'a' } });
  assert.equal(eseguiti.length, 0);
  assert.deepEqual(await chiama('POST /api/lumi/strumenti/:nome/esegui', tit, { nome: 'segna' }, { args: { cosa: 'a' }, gettone: sch2.gettone }), { testo: 'Fatto' });
  await assert.rejects(chiama('POST /api/lumi/strumenti/:nome/esegui', tit, { nome: 'segna' }, { args: { cosa: 'a' }, gettone: sch2.gettone }), e => e.stato === 409);
  assert.deepEqual(eseguiti, [['a', 'u1']]);
  // il controllo degli argomenti
  assert.equal(controllaArgomenti({ a: [1, 'x'] }, { type: 'object', properties: { a: { type: 'array', items: { type: 'number' } } } }), 'args.a[1]: serve number, non string');
  assert.equal(controllaArgomenti({ z: 1 }, { type: 'object', properties: {}, additionalProperties: false }), 'args.z: campo sconosciuto');
});

// ---------- il finto Claude: a ogni richiesta risponde con la prossima mossa del copione ----------
const sse = evs => evs.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
let copione = [], richieste = [];
const avvio = { type: 'message_start', message: { id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1, output_tokens: 1 } } };
const usa = (nome, input) => sse([avvio,
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${richieste.length}`, name: nome, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } }, { type: 'message_stop' }]);
const dice = testo => sse([avvio,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: testo } },
  { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
// l'ultimo risultato di strumento che il «modello» ha ricevuto
const ultimo = c => JSON.parse(c.messages.at(-1).content.find(b => b.type === 'tool_result').content);
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
  const accedi = (email, password) => { biscotto = ''; return chiama('POST', '/api/accedi', { email, password }); };
  return { srv, grezza, chiama, api, accedi };
}
const eventi = testo => testo.split('\n\n').filter(Boolean).map(x => JSON.parse(x.replace(/^data: /, '')));

// gli strumenti come li costruisce il browser: quelli dello schema + quelli dei moduli, con i file «scaricati» qui
const file = [];
async function genera(k) {
  const st = await k.api('GET', '/stato'), moduli = await k.api('GET', '/lumi/strumenti');
  return { moduli, lista: strumenti({ schema: await k.api('GET', '/schema'), api: k.api, poteri: st.poteri, moduli, scarica: f => file.push(f) }), poteri: st.poteri };
}
// il giro del motore del browser (web/lumi/motore.js), ridotto: le scritture passano dalla scheda e dalla «conferma»
async function conversa(k, domanda, { conferma = () => true } = {}) {
  const { lista, moduli, poteri } = await genera(k), per = new Map(lista.map(s => [s.nome, s])), traccia = [], schede = [];
  const messaggi = [{ role: 'user', content: domanda }];
  const dichiarati = lista.map(s => ({ nome: s.nome, descrizione: (s.proponi ? '[PROPOSAL: runs only after the person confirms] ' : '') + s.descrizione, schema: s.schema }));
  for (let giro = 0; giro < 12; giro++) {
    const r = await k.grezza('POST', '/api/lumi', { azione: 'chat', messaggi, strumenti: dichiarati, istruzioni: istruzioni({ poteri, moduli }) });
    assert.equal(r.status, 200);
    const ev = eventi(await r.text()), fine = ev.find(e => e.t === 'fine');
    assert.ok(fine, JSON.stringify(ev.find(e => e.t === 'errore')));
    messaggi.push({ role: 'assistant', content: fine.contenuto });
    const usi = fine.contenuto.filter(b => b.type === 'tool_use');
    if (!usi.length) return { testo: fine.contenuto.map(b => b.text || '').join(''), traccia, schede };
    const risultati = [];
    for (const u of usi) {
      const s = per.get(u.name); let esito;
      if (!s) esito = { errore: `strumento sconosciuto «${u.name}»` };
      else if (s.leggi) esito = await s.leggi(u.input);
      else {
        const p = await s.proponi(u.input);
        if (p.errore) esito = p;
        else { schede.push({ nome: u.name, ...p }); esito = conferma(u.name, p) ? { esito: 'confermato', risultato: await s.esegui(u.input) } : { esito: 'annullato' }; }
      }
      traccia.push({ nome: u.name, input: u.input, esito });
      risultati.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(esito), ...(esito?.errore ? { is_error: true } : {}) });
    }
    messaggi.push({ role: 'user', content: risultati });
  }
  throw new Error('troppi giri');
}
const testoScheda = s => s.righe.map(([a, b]) => `${a}: ${b}`).join('\n').replace(/\s/g, c => (c === '\n' ? c : ' '));   // Intl usa spazi non separabili
// un codice fiscale con il carattere di controllo giusto (per un cliente privato di prova)
const cf = base => base + [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find(c => !cfValido(base + c).errore);

const AZIENDA = { ragione_sociale: 'Studio Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via Roma 1', cap: '20121', comune: 'Milano', provincia: 'MI', iban: 'IT60X0542811101000000123456', banca: 'Banca Prova' };
let k, rossi;
before(async () => {
  k = await avvia();
  assert.equal((await k.chiama('POST', '/api/configura', { azienda: 'Studio Prova srl', nome: 'Titolare', email: 'titolare@esempio.it', password: 'prova-kubo-1', modelli: ['professionista', 'fatture'] })).stato, 200);
  assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { chiave: CHIAVE })).stato, 200);
  await k.api('PUT', '/documenti/azienda', AZIENDA);
  await k.api('POST', '/documenti/prepara');
  rossi = await k.api('POST', '/dati/clienti', { nome: 'Rossi Srl', piva: '00743110157', codice_destinatario: 'ABC1234', via: 'Via Verdi 2', cap: '00184', comune: 'Roma', provincia: 'RM', nazione: 'IT' });
  await k.api('POST', '/dati/clienti', { nome: 'Mario Bianchi', codice_fiscale: cf('BNCMRA80A01H501'), via: 'Via Po 3', cap: '10121', comune: 'Torino', provincia: 'TO', nazione: 'IT' });
});
after(() => k.srv.close());

test('inventario: gli strumenti dei documenti arrivano dal modulo, crea_fatture lascia il posto a fattura_nuova, il server di Lumi li accetta', async () => {
  const { lista, moduli } = await genera(k), nomi = lista.map(s => s.nome);
  for (const n of ['fattura_nuova', 'fattura_emetti', 'fattura_nota_di_credito', 'fattura_controlla', 'fattura_esporta_xml', 'fattura_stampa', 'fatture_da_incassare', 'fatture_da_pagare', 'modifica_fatture', 'cerca_fatture'])
    assert.ok(nomi.includes(n), n);
  assert.ok(!nomi.includes('crea_fatture'));
  assert.ok(strumentiAnthropic(lista.map(s => ({ nome: s.nome, descrizione: s.descrizione, schema: s.schema }))), 'il server di Lumi rifiuterebbe gli strumenti');
  // le istruzioni: niente dati inventati, il professionista quando serve; e stanno nel limite del server (4000 caratteri)
  const testo = istruzioni({ poteri: {}, moduli });
  assert.match(testo, /Non inventare mai partite IVA/); assert.match(testo, /commercialista o un CAF/); assert.ok(testo.length < 4000, `istruzioni lunghe ${testo.length}`);
});

test('«fai una fattura a Rossi Srl per 3 ore di consulenza a 80 euro più IVA»: scheda con cliente, righe, IVA e totale; poi «emettila»', async () => {
  richieste = [];
  copione = [
    usa('fattura_nuova', { cliente: 'Rossi Srl', righe: [{ descrizione: 'Consulenza', quantita: 3, prezzo: 80 }] }),
    c => dice(`Ho preparato la fattura: **${ultimo(c).risultato.totale} €**. La emetto?`),
  ];
  const r = await conversa(k, 'fai una fattura a Rossi Srl per 3 ore di consulenza a 80 euro più IVA');
  const s = r.schede[0], t = testoScheda(s);
  assert.equal(s.titolo, 'Nuova fattura');
  assert.match(t, /Cliente: Rossi Srl/); assert.match(t, /Consulenza: 3 × 80,00 € · IVA 22% = 240,00 €/);
  assert.match(t, /Imponibile: 240,00 €/); assert.match(t, /IVA: 52,80 €/); assert.match(t, /Totale: 292,80 €/);
  assert.deepEqual(s.avvisi, []);   // Rossi ha tutto: nessun controllo dello SDI da segnalare
  const fatta = r.traccia[0].esito.risultato, f = await k.api('GET', `/dati/fatture/${fatta.id}`);
  assert.equal(f.stato, 'bozza'); assert.equal(f.cliente.titolo, 'Rossi Srl'); assert.equal(f.totale, 292.8); assert.equal(f.righe[0].aliquota, 22);
  assert.match(r.testo, /292.8/);
  // il system prompt arrivato a «Claude» contiene le istruzioni dei documenti
  assert.match(richieste[0].system[0].text, /fattura_nuova/); assert.match(richieste[0].system[0].text, /commercialista o un CAF/);
  // emetterla: la scheda dice che non si torna indietro, il numero lo mette Kubo
  copione = [usa('fattura_emetti', { fattura: f.id }), c => dice(`Emessa: numero ${ultimo(c).risultato.numero}.`)];
  const e = await conversa(k, 'emettila');
  assert.match(e.schede[0].nota, /nota di credito/); assert.match(e.testo, /numero 1\./);
  // già emessa: il modello lo legge e propone la nota di credito
  const di = await (await genera(k)).lista.find(x => x.nome === 'fattura_emetti').proponi({ fattura: f.id });
  assert.match(di.errore, /già emessa.*nota di credito/);
});

test('«fattura a Mario Bianchi forfettario, 500 euro, senza IVA»: in ordinario chiede la natura, in forfettario N2.2 e bollo', async () => {
  copione = [
    usa('fattura_nuova', { cliente: 'Mario Bianchi', righe: [{ descrizione: 'Prestazione', prezzo: 500, aliquota: 0 }] }),
    c => { assert.match(ultimo(c).errore, /manca la natura.*non sceglierla tu/); return dice('Perché è senza IVA? Mi serve il motivo (la natura), oppure chiedilo al tuo commercialista.'); },
  ];
  const r = await conversa(k, 'fattura a Mario Bianchi forfettario, 500 euro, senza IVA');
  assert.equal(r.schede.length, 0); assert.match(r.testo, /natura/);
  // l'azienda è in forfettario: niente IVA, natura N2.2, bollo da 2 € (sopra 77,47 €) addebitato al cliente
  await k.api('PUT', '/documenti/azienda', { ...AZIENDA, regime: 'RF19' });
  try {
    copione = [usa('fattura_nuova', { cliente: 'Mario Bianchi', righe: [{ descrizione: 'Prestazione', prezzo: 500 }] }), dice('Fattura pronta in bozza.')];
    const r2 = await conversa(k, 'fattura a Mario Bianchi forfettario, 500 euro, senza IVA');
    const s = r2.schede[0], t = testoScheda(s);
    assert.match(t, /Prestazione: 1 × 500,00 € · IVA N2.2 = 500,00 €/); assert.match(t, /IVA: 0,00 €/); assert.match(t, /Bollo: 2,00 €/); assert.match(t, /Totale: 502,00 €/);
    assert.ok(s.avvisi.some(a => /forfettario/.test(a))); assert.ok(s.avvisi.some(a => /77,47/.test(a)));
    const f = await k.api('GET', `/dati/fatture/${r2.traccia[0].esito.risultato.id}`);
    assert.equal(f.righe[0].natura, 'N2.2'); assert.equal(f.righe[0].aliquota, 0); assert.equal(f.bollo, true); assert.ok(!f.ritenuta);
  } finally { await k.api('PUT', '/documenti/azienda', AZIENDA); }
});

test('«nota di credito della fattura 12»: lo strumento dedicato, uguale al bottone; la modifica a parole di una emessa è ferma', async () => {
  const f12 = await k.api('POST', '/dati/fatture', { cliente: rossi.id, numero: '12', data: '2026-09-30', stato: 'emessa', ritenuta: 20, ritenuta_tipo: 'RT01', ritenuta_causale: 'A',
    righe: [{ descrizione: 'Consulenza', quantita: 3, prezzo: 80, aliquota: 22 }, { descrizione: 'Trasferta', quantita: 1, prezzo: 50, aliquota: 22 }] });
  // «cambia il prezzo della 12»: la scheda generica non parte, il modello legge di proporre la nota di credito
  const { lista } = await genera(k);
  const no = await lista.find(s => s.nome === 'modifica_fatture').proponi({ id: f12.id, valori: { righe: [{ descrizione: 'Consulenza', quantita: 3, prezzo: 90, aliquota: 22 }] } });
  assert.match(no.errore, /è emessa: non si modifica più, nemmeno a parole.*fattura_nota_di_credito/);
  // segnare pagata una rata invece si può (lo permette il motore): la scheda non la ferma
  assert.ok(!(await k.api('POST', '/lumi/scheda/fatture', { id: f12.id, valori: { rate: [{ data: '2026-10-30', importo: 100, pagata: true }], pagata_il: '2026-10-30' } })).errore);
  // la nota di credito parziale: solo la trasferta
  copione = [usa('fattura_nota_di_credito', { fattura: '12', righe: [{ n: 2 }], motivo: 'trasferta non dovuta' }), dice('Preparata.')];
  const p = await conversa(k, 'fai una nota di credito della fattura 12 solo per la trasferta');
  assert.equal(p.schede[0].titolo, 'Nota di credito parziale');
  assert.match(testoScheda(p.schede[0]), /Storna: fattura 12 del 30\/09\/2026/); assert.match(testoScheda(p.schede[0]), /Totale: 61,00 €/);
  assert.match(testoScheda(p.schede[0]), /Ritenuta d'acconto 20%: − 10,00 €/);
  // uno storno negativo o a quantità zero aumenterebbe il credito invece di toglierlo: si ferma
  const ncp = (await genera(k)).lista.find(s => s.nome === 'fattura_nota_di_credito');
  assert.match((await ncp.proponi({ fattura: '12', righe: [{ descrizione: 'Abbuono', prezzo: -50 }] })).errore, /più di zero/);
  assert.match((await ncp.proponi({ fattura: '12', righe: [{ n: 1, quantita: 0 }] })).errore, /più di zero/);
  assert.match((await ncp.proponi({ fattura: '12', righe: [{ n: 1, quantita: -1 }] })).errore, /più di zero/);
  // ora la totale: supererebbe quello che resta (la parziale è già lì) → il modello lo legge
  copione = [usa('fattura_nota_di_credito', { fattura: '12' }), c => { assert.match(ultimo(c).errore, /supera quello che resta/); return dice('Della 12 resta da stornare meno del totale.'); }];
  await conversa(k, 'nota di credito della fattura 12');
  // su una fattura nuova uguale, la nota totale è identica a quella del bottone
  const f13 = await k.api('POST', '/dati/fatture', { cliente: rossi.id, numero: '13', data: '2026-09-30', stato: 'emessa', ritenuta: 20, ritenuta_tipo: 'RT01', ritenuta_causale: 'A',
    righe: [{ descrizione: 'Consulenza', quantita: 3, prezzo: 80, aliquota: 22 }] });
  copione = [usa('fattura_nota_di_credito', { fattura: '13' }), dice('Nota di credito pronta in bozza.')];
  const r = await conversa(k, 'nota di credito della fattura 13');
  assert.match(testoScheda(r.schede[0]), /Totale: 292,80 €/); assert.match(testoScheda(r.schede[0]), /Netto a credito del cliente: 244,80 €/);
  const nc = await k.api('GET', `/dati/fatture/${r.traccia[0].esito.risultato.id}`), ufficiale = await k.api('POST', `/documenti/nota-di-credito/${f13.id}`);
  for (const c of ['tipo', 'totale', 'ritenuta', 'ritenuta_tipo', 'ritenuta_causale', 'imposta', 'stato']) assert.deepEqual(nc[c], ufficiale[c], c);
  assert.equal(nc.collegata.id, f13.id);
});

test('«quanto mi devono i clienti?»: emesse non pagate, al netto della ritenuta, per cliente', async () => {
  copione = [usa('fatture_da_incassare', {}), c => { const x = ultimo(c); return dice(`Ti devono **${x.totale} €** su ${x.documenti} fatture.`); }];
  const r = await conversa(k, 'quanto mi devono i clienti?');
  const x = r.traccia[0].esito;
  // da test precedenti: la fattura 1 (292,80), la 12 (353,80 - 58 di ritenuta = 295,80), la 13 (244,80); le note in bozza non contano
  const attese = (await k.api('GET', '/dati/fatture?n=100')).righe.filter(f => ['emessa', 'inviata'].includes(f.stato));
  assert.equal(x.documenti, attese.length);
  assert.equal(x.totale, Math.round(attese.reduce((s, f) => s + (f.tipo === 'TD04' ? -1 : 1) * f.netto, 0) * 100) / 100);
  assert.ok(x.elenco.some(e => e.documento === 'Fattura 12' && e.importo === 295.8));
  assert.equal(x.per_cliente[0].cliente, 'Rossi Srl');
  assert.match(r.testo, new RegExp(`${x.totale} €`));
  // una fattura pagata in parte (una rata segnata pagata): resta da incassare solo il resto
  await k.api('POST', '/dati/fatture', { cliente: rossi.id, numero: '14', data: '2026-10-02', stato: 'emessa', righe: [{ descrizione: 'Assistenza', quantita: 1, prezzo: 100, aliquota: 22 }],
    rate: [{ data: '2026-10-02', importo: 100, pagata: true }, { data: '2026-11-02', importo: 22 }] });
  const dopo = await (await genera(k)).lista.find(s => s.nome === 'fatture_da_incassare').leggi({ cliente: 'Rossi Srl' });
  assert.equal(dopo.elenco.find(e => e.documento === 'Fattura 14').importo, 22);
  // e i fornitori: nessuna fattura ricevuta da pagare; poi una da 100 € e una nota di credito ricevuta da 30 € (importo positivo, come nell'XML)
  assert.deepEqual((await (await genera(k)).lista.find(s => s.nome === 'fatture_da_pagare').leggi({})).totale, 0);
  const forn = await k.api('POST', '/dati/fornitori', { nome: 'Carta Srl' });
  await k.api('POST', '/dati/fatture_ricevute', { fornitore: forn.id, tipo: 'TD01', numero: 'A1', data: '2026-09-01', stato: 'da_pagare', totale: 100, netto: 100 });
  await k.api('POST', '/dati/fatture_ricevute', { fornitore: forn.id, tipo: 'TD04', numero: 'A2', data: '2026-09-05', stato: 'da_pagare', totale: 30, netto: 30 });
  const pagare = await (await genera(k)).lista.find(s => s.nome === 'fatture_da_pagare').leggi({});
  assert.equal(pagare.totale, 70); assert.equal(pagare.per_fornitore[0].fornitore, 'Carta Srl');
});

test('«esporta l\'XML della fattura 15»: il file arriva al browser (valido per lo schema ufficiale), al modello solo il nome', async () => {
  await k.api('POST', '/dati/fatture', { cliente: rossi.id, numero: '15', data: '2026-10-01', stato: 'emessa', righe: [{ descrizione: 'Consulenza', quantita: 2, prezzo: 100, aliquota: 22 }] });
  file.length = 0; richieste = [];
  copione = [usa('fattura_esporta_xml', { fattura: '15' }), c => dice(`Ecco il file ${ultimo(c).nome}.`)];
  const r = await conversa(k, 'esporta l\'XML della fattura 15');
  assert.equal(file.length, 1); assert.equal(file[0].tipo, 'application/xml'); assert.match(file[0].nome, /^IT12345678903_\w{5}\.xml$/);
  assert.equal(r.traccia[0].esito.scaricato, file[0].nome);
  assert.ok(!JSON.stringify(richieste.at(-1).messages).includes('<?xml'), 'il contenuto del file non va al modello');
  const p = join(mkdtempSync(join(tmpdir(), 'kubo-lumidoc-')), file[0].nome); writeFileSync(p, file[0].contenuto);
  execFileSync('xmllint', ['--noout', '--nonet', '--schema', XSD, p], { stdio: 'pipe' });
  // una bozza non si esporta: il modello legge cosa fare
  const { lista } = await genera(k);
  const bozza = (await k.api('GET', '/dati/fatture?n=100')).righe.find(f => f.stato === 'bozza' && f.tipo === 'TD01');
  assert.match((await lista.find(s => s.nome === 'fattura_esporta_xml').leggi({ fattura: bozza.id })).errore, /in bozza: emettila/);
  // la stampa: un file HTML da aprire e salvare in PDF
  const st = await lista.find(s => s.nome === 'fattura_stampa').leggi({ fattura: '15' });
  assert.match(st.scaricato, /\.html$/); assert.match(file.at(-1).contenuto, /Consulenza/);
});

test('controlli prima della conferma: un cliente senza dati fiscali si vede nella scheda e ferma l\'emissione', async () => {
  await k.api('POST', '/dati/clienti', { nome: 'Verdi Snc' });
  const { lista } = await genera(k);
  const s = await lista.find(x => x.nome === 'fattura_nuova').proponi({ cliente: 'Verdi Snc', righe: [{ descrizione: 'Riparazione', prezzo: 100 }] });
  assert.ok(s.avvisi.some(a => /Per la fattura elettronica: Manca la partita IVA o il codice fiscale del cliente/.test(a)), JSON.stringify(s.avvisi));
  const fatta = await lista.find(x => x.nome === 'fattura_nuova').esegui({ cliente: 'Verdi Snc', righe: [{ descrizione: 'Riparazione', prezzo: 100 }] });
  assert.ok(fatta.da_sistemare_prima_di_emettere.length);
  assert.match((await lista.find(x => x.nome === 'fattura_emetti').proponi({ fattura: fatta.id })).errore, /Prima di emetterla va sistemato/);
  // un cliente che non c'è: non si inventa, si chiede
  assert.match((await lista.find(x => x.nome === 'fattura_nuova').proponi({ cliente: 'Gialli Spa', righe: [{ descrizione: 'X', prezzo: 1 }] })).errore, /Non trovo il cliente «Gialli Spa».*Non inventare/);
  // la scheda in un'altra lingua: le etichette e gli avvisi del server si traducono
  const en = await k.api('POST', '/lumi/strumenti/fattura_nuova/anteprima', { args: { cliente: 'Verdi Snc', righe: [{ descrizione: 'Riparazione', prezzo: 100 }] }, lingua: 'en' });
  assert.equal(en.titolo, 'New invoice'); assert.ok(en.righe.some(([a, b]) => a === 'Total' && /122\.00/.test(b)));
  assert.ok(en.avvisi.some(a => /^For the e-invoice: /.test(a)));
});

test('permessi: chi ha solo la lettura vede gli strumenti che leggono, e il server rifiuta comunque le scritture', async () => {
  await k.chiama('POST', '/api/utenti', { nome: 'Lia', email: 'lia@esempio.it', password: 'password-lia-1', ruolo: 'lettura' });
  await k.accedi('lia@esempio.it', 'password-lia-1');
  try {
    const nomi = (await k.api('GET', '/lumi/strumenti')).strumenti.map(s => s.nome);
    assert.ok(nomi.includes('fatture_da_incassare') && nomi.includes('fattura_controlla'));
    assert.ok(!nomi.includes('fattura_nuova') && !nomi.includes('fattura_emetti') && !nomi.includes('fattura_nota_di_credito'));
    const r = await k.chiama('POST', '/api/lumi/strumenti/fattura_nuova/anteprima', { args: { cliente: 'Rossi Srl', righe: [{ descrizione: 'X', prezzo: 1 }] } });
    assert.equal(r.stato, 403);
  } finally { await k.accedi('titolare@esempio.it', 'prova-kubo-1'); }
});

test('forfettario: la cassa dedotta da una fattura fatta in ordinario (IVA 22% sul contributo) qui è senza IVA', async () => {
  await k.api('POST', '/dati/fatture', { cliente: rossi.id, numero: '90', data: new Date().toLocaleDateString('sv'), stato: 'emessa', cassa_tipo: 'TC22', cassa: 4, cassa_iva: 22,
    righe: [{ descrizione: 'Consulenza', quantita: 1, prezzo: 100, aliquota: 22 }] });
  await k.api('PUT', '/documenti/azienda', { ...AZIENDA, regime: 'RF19' });
  try {
    const p = await (await genera(k)).lista.find(s => s.nome === 'fattura_nuova').proponi({ cliente: 'Rossi Srl', righe: [{ descrizione: 'Consulenza', prezzo: 1000 }] });
    const t = testoScheda(p);
    assert.match(t, /Contributo cassa 4%: 40,00 €/); assert.match(t, /IVA: 0,00 €/); assert.ok(p.avvisi.some(a => /cassa del 4%/.test(a))); assert.match(t, /Totale: 1042,00 €/);
  } finally { await k.api('PUT', '/documenti/azienda', AZIENDA); }
});
