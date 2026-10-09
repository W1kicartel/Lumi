// Il webhook generico (n8n, Make, Zapier: eventi firmati in uscita, clienti e appuntamenti in entrata con il codice)
// e le notifiche push (ntfy, Pushover) e Google Chat. Solo finti server locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { finto, kubo, accendi, manda } from './connettori-finto.mjs';
import { coda } from './connettori-comunica-coda.mjs';


test('Webhook: eventi delle sezioni scelte firmati come Stripe, creato/modificato, entrata con il codice che non duplica i clienti', async () => {
  const K = await kubo(['negozio', 'studio']), arrivi = [];
  const S = await finto({ 'POST /hook/n8n': (p, c, { intestazioni }) => { arrivi.push({ c, h: intestazioni }); return { ok: true }; } });
  try {
    const pag = await accendi(K, 'webhook', { segreti: { url: `${S.url}/hook/n8n` }, impostazioni: { sezioni: 'clienti, appuntamenti' } });
    const firma = pag.impostazioni.find(i => i.id === 'firma').valore, codice = pag.impostazioni.find(i => i.id === 'codice').valore;
    assert.equal((await K.chiama('POST', '/api/connettori/webhook/prova')).json.ok, true); assert.equal(arrivi[0].c.evento, 'prova');
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Sara Galli', email: 'sara@esempio.it' })).json; await coda(K);
    await K.chiama('PATCH', `/api/dati/clienti/${cl.id}`, { telefono: '3331112222' }); await coda(K);
    await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'V1', prezzo: 3 }); await coda(K);   // sezione non scelta
    const ev = arrivi.slice(1);
    assert.deepEqual(ev.map(x => x.c.evento), ['clienti.creato', 'clienti.modificato']);
    assert.equal(ev[0].c.riga.nome, 'Sara Galli'); assert.equal(ev[1].c.riga.telefono, '3331112222'); assert.equal(ev[0].h['x-kubo-evento'], 'clienti.creato');
    // la firma: t=<secondi>,v1=HMAC-SHA256(segreto, "t.corpo") sul corpo esatto
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(ev[0].h['x-kubo-firma']);
    assert.equal(createHmac('sha256', firma).update(`${t}.${JSON.stringify(ev[0].c)}`).digest('hex'), v1);
    // in entrata: Make crea un appuntamento e un cliente; lo stesso cliente non si duplica; una sezione non permessa no
    assert.equal((await manda(K, '/api/connettori/webhook/in/sbagliato', '{}')).stato, 401);
    const r = await manda(K, `/api/connettori/webhook/in/${codice}`, JSON.stringify({ id: 'make-1', azione: 'crea', sezione: 'clienti', valori: { nome: 'Piero Sala', email: 'piero@esempio.it' } }));
    assert.match(r.json.esito, /^creato: clienti \w+$/);
    assert.equal((await manda(K, `/api/connettori/webhook/in/${codice}`, JSON.stringify({ id: 'make-1', azione: 'crea', sezione: 'clienti', valori: { nome: 'Piero Sala' } }))).json.doppione, true);
    assert.match((await manda(K, `/api/connettori/webhook/in/${codice}`, JSON.stringify({ azione: 'crea', sezione: 'clienti', valori: { nome: 'Sara G.', email: 'sara@esempio.it' } }))).json.esito, /^cliente già presente/);
    const a = await manda(K, `/api/connettori/webhook/in/${codice}`, JSON.stringify({ azione: 'crea', sezione: 'appuntamenti', valori: { quando: '2026-11-05T09:00:00Z', cliente: cl.id } }));
    assert.match(a.json.esito, /^creato: appuntamenti/, JSON.stringify(a.json));
    assert.match((await manda(K, `/api/connettori/webhook/in/${codice}`, JSON.stringify({ azione: 'crea', sezione: 'fatture', valori: {} }))).json.esito, /^ignorato: sezione non permessa/);
    const app = (await K.chiama('GET', '/api/dati/appuntamenti')).json.righe; assert.equal(app.length, 1); assert.equal(app[0].creato_da, 'servizio:webhook');
    assert.equal((await manda(K, `/api/connettori/webhook/in/${codice}`, JSON.stringify({ azione: 'avvisa', testo: 'Nuovo lead da Facebook' }))).json.esito, 'avvisato');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('ntfy, Pushover e Google Chat: argomento segreto generato, priorità, chiavi nel form, avvisi delle vendite', async () => {
  const K = await kubo(['negozio']), push = [];
  const S = await finto({
    'POST /:topic': (p, c, { intestazioni }) => { push.push({ topic: p.topic, c, h: intestazioni }); return { id: 'n1', event: 'message' }; },
    'POST /1/messages.json': c => ({}),
    'POST /v1/spaces/AAA/messages': (p, c) => { push.push({ chat: c }); return { name: 'spaces/AAA/messages/1' }; },
  });
  const P = await finto({ 'POST /1/messages.json': (p, c) => (c.token === 'a'.repeat(30) ? (push.push({ pushover: c }), { status: 1, request: 'r1' }) : { stato: 400, corpo: { status: 0, errors: ['application token is invalid'] } }) });
  try {
    const pag = await accendi(K, 'ntfy', { base: S.url, segreti: { token: 'tk_prova' }, impostazioni: { priorita: '4' } });
    const topic = pag.impostazioni.find(i => i.id === 'argomento').valore; assert.match(topic, /^[\w-]{30,64}$/);
    assert.equal((await K.chiama('POST', '/api/connettori/ntfy/prova')).json.ok, true);
    assert.deepEqual([push[0].topic, push[0].c, push[0].h.priority, push[0].h.title, push[0].h.authorization], [topic, 'Kubo è collegato a questo canale.', '4', 'Kubo', 'Bearer tk_prova']);
    await accendi(K, 'pushover', { base: P.url, segreti: { token: 'a'.repeat(30), utente: 'u'.repeat(30) } });
    await accendi(K, 'google-chat', { segreti: { url: `${S.url}/v1/spaces/AAA/messages?key=k&token=t` } });
    const art = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'V1', prezzo: 25, giacenza: 9 })).json;
    await K.chiama('POST', '/api/dati/vendite', { righe: [{ articolo: art.id, quantita: 1, prezzo: 25 }] }); await coda(K);
    const vend = push.filter(x => /Nuova vendita/.test(x.c || x.pushover?.message || x.chat?.text || ''));
    assert.equal(vend.length, 3, JSON.stringify(push));
    assert.deepEqual(Object.keys(vend.find(x => x.pushover).pushover).sort(), ['message', 'title', 'token', 'user']);
    await K.chiama('PUT', '/api/connettori/pushover', { segreti: { token: 'b'.repeat(30) } });
    const no = await K.chiama('POST', '/api/connettori/pushover/azioni/scrivi', { args: { testo: 'x' } });
    assert.equal(no.stato, 502); assert.match(no.json.errore, /application token is invalid/);
  } finally { await K.chiudi(); await S.chiudi(); await P.chiudi(); }
});
