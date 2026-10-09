// I connettori dei messaggi di squadra e del bot: Telegram (titolare e clienti collegati con il codice, getUpdates e
// webhook con il secret_token), Slack, Teams, Discord (avvisi degli eventi, una volta sola). Solo finti server locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda } from './connettori-finto.mjs';

const pausa = (ms = 50) => new Promise(r => setTimeout(r, ms));
const TOKEN = '123456789:AAH' + 'x'.repeat(32);

test('Telegram: il titolare si collega con il codice, il cliente con il suo link, webhook con secret_token, avvisi delle vendite', async () => {
  const K = await kubo(['negozio']), inviati = [], code = [];
  const S = await finto({
    'POST /:bot/getMe': () => ({ ok: true, result: { id: 1, is_bot: true, username: 'bottega_bot' } }),
    'POST /:bot/deleteWebhook': () => ({ ok: true, result: true }),
    'POST /:bot/setWebhook': (p, c) => ({ ok: !!c.secret_token && c.url.endsWith('/api/connettori/telegram/in'), result: true }),
    'POST /:bot/getUpdates': () => ({ ok: true, result: code.splice(0) }),
    'POST /:bot/sendMessage': (p, c) => { inviati.push(c); return { ok: true, result: { message_id: inviati.length } }; },
  });
  try {
    const pag = await accendi(K, 'telegram', { base: S.url, segreti: { token: TOKEN } });
    assert.equal(S.chiamate[0].percorso, `/bot${TOKEN}/getMe`);
    const codice = pag.impostazioni.find(i => i.id === 'codice').valore, sw = pag.impostazioni.find(i => i.id === 'segreto_webhook').valore;
    // il titolare apre t.me/bottega_bot?start=<codice>: lo legge il giro di controllo (getUpdates)
    code.push({ update_id: 10, message: { chat: { id: 111 }, text: `/start ${codice}` } });
    const g = await K.chiama('POST', '/api/connettori/telegram/giri/controlla');
    assert.deepEqual(g.json.risultato, { letti: 1, esiti: ['titolare collegato'] }, JSON.stringify(g.json));
    assert.equal(inviati.at(-1).chat_id, 111);
    assert.equal(S.chiamate.filter(c => c.percorso.endsWith('/getUpdates')).at(-1).corpo.offset, undefined);
    await K.chiama('POST', '/api/connettori/telegram/giri/controlla');
    assert.equal(S.chiamate.filter(c => c.percorso.endsWith('/getUpdates')).at(-1).corpo.offset, 11);
    // il cliente: il link personale, poi il webhook (con l'indirizzo pubblico)
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', telefono: '333 1234567' })).json;
    const link = (await K.chiama('POST', '/api/connettori/telegram/azioni/link_cliente', { args: { cliente: cl.id } })).json;
    assert.match(link.url, new RegExp(`^https://t\\.me/bottega_bot\\?start=${cl.id}-[\\w-]{12}$`)); assert.equal(link.collegato, false);
    assert.equal((await K.chiama('PUT', '/api/connettori/telegram', { impostazioni: { ricezione: 'webhook', pubblico: 'https://kubo.bottega.example' }, attivo: true })).stato, 200);
    assert.ok(S.chiamate.some(c => c.percorso.endsWith('/setWebhook') && c.corpo.secret_token === sw));
    const start = JSON.stringify({ update_id: 20, message: { chat: { id: 222 }, from: { first_name: 'Anna' }, text: `/start ${link.url.split('start=')[1]}` } });
    assert.equal((await manda(K, '/api/connettori/telegram/in', start, { 'X-Telegram-Bot-Api-Secret-Token': 'sbagliato' })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/telegram/in', start)).stato, 401);
    const r = await manda(K, '/api/connettori/telegram/in', start, { 'X-Telegram-Bot-Api-Secret-Token': sw });
    assert.equal(r.json.esito, 'cliente collegato: Anna Bianchi', JSON.stringify(r.json));
    assert.equal((await manda(K, '/api/connettori/telegram/in', start, { 'X-Telegram-Bot-Api-Secret-Token': sw })).json.doppione, true);
    // un codice falsificato (id giusto, firma sbagliata) non collega niente
    const falso = JSON.stringify({ update_id: 21, message: { chat: { id: 333 }, text: `/start ${cl.id}-AAAAAAAAAAAA` } });
    assert.equal((await manda(K, '/api/connettori/telegram/in', falso, { 'X-Telegram-Bot-Api-Secret-Token': sw })).json.esito, 'codice non valido');
    // Lumi: «scrivi ad Anna su Telegram che l'ordine è pronto» (anteprima, poi invio)
    const ant = (await K.chiama('POST', '/api/connettori/telegram/azioni/manda_cliente', { args: { cliente: cl.id, testo: 'Il tuo ordine è pronto' }, anteprima: true })).json;
    assert.deepEqual(ant.avvisi, []);
    assert.equal((await K.chiama('POST', '/api/connettori/telegram/azioni/manda_cliente', { args: { cliente: cl.id, testo: 'Il tuo ordine è pronto' } })).json.inviato, true);
    assert.deepEqual([inviati.at(-1).chat_id, inviati.at(-1).text], [222, 'Il tuo ordine è pronto']);
    // il cliente risponde: il messaggio arriva al titolare
    const risp = JSON.stringify({ update_id: 22, message: { chat: { id: 222 }, text: 'Grazie, passo alle 18' } });
    assert.equal((await manda(K, '/api/connettori/telegram/in', risp, { 'X-Telegram-Bot-Api-Secret-Token': sw })).json.esito, 'messaggio inoltrato');
    assert.deepEqual([inviati.at(-1).chat_id, inviati.at(-1).text], [111, 'Anna Bianchi: Grazie, passo alle 18']);
    // una vendita nuova: un avviso al titolare, una volta sola (anche se la vendita poi cambia)
    const prima = inviati.length;
    const art = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'V1', prezzo: 30, giacenza: 9, soglia: 2 })).json;
    const v = (await K.chiama('POST', '/api/dati/vendite', { cliente: cl.id, righe: [{ articolo: art.id, quantita: 2, prezzo: 30 }] })).json;
    await pausa(); await K.nucleo.lavora();
    await K.chiama('PATCH', `/api/dati/vendite/${v.id}`, { note: 'ritira domani' }); await pausa(); await K.nucleo.lavora();
    const avvisi = inviati.slice(prima).filter(m => /Nuova vendita/.test(m.text));
    assert.equal(avvisi.length, 1, JSON.stringify(inviati.slice(prima))); assert.match(avvisi[0].text, /^Nuova vendita V-\d{4}-0001: 60,00 € · Anna Bianchi$/); assert.equal(avvisi[0].chat_id, 111);
    // /stop scollega il cliente
    await manda(K, '/api/connettori/telegram/in', JSON.stringify({ update_id: 23, message: { chat: { id: 222 }, text: '/stop' } }), { 'X-Telegram-Bot-Api-Secret-Token': sw });
    assert.equal((await K.chiama('POST', '/api/connettori/telegram/azioni/manda_cliente', { args: { cliente: cl.id, testo: 'x' } })).stato, 502);
    assert.ok(!JSON.stringify((await K.chiama('GET', '/api/connettori/telegram')).json).includes(TOKEN));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Slack, Teams e Discord: prova, scorte basse una volta (e di nuovo dopo il riordino), appuntamenti, formato giusto per ognuno', async () => {
  const K = await kubo(['negozio', 'studio']), arrivi = { slack: [], teams: [], discord: [] };
  const S = await finto({
    'POST /slack/T1/B1/x': (p, c) => { arrivi.slack.push(c); return { stato: 200, corpo: 'ok' }; },
    'POST /teams/workflows/1': (p, c) => { arrivi.teams.push(c); return { stato: 202, corpo: '' }; },
    'POST /discord/api/webhooks/1/tok': (p, c) => { arrivi.discord.push(c); return { stato: 204, corpo: '' }; },
  });
  try {
    await accendi(K, 'slack', { segreti: { url: `${S.url}/slack/T1/B1/x` } });
    await accendi(K, 'teams', { segreti: { url: `${S.url}/teams/workflows/1` }, impostazioni: { su_articoli: false } });
    await accendi(K, 'discord', { segreti: { url: `${S.url}/discord/api/webhooks/1/tok` } });
    for (const id of ['slack', 'teams', 'discord']) assert.equal((await K.chiama('POST', `/api/connettori/${id}/prova`)).json.ok, true, id);
    assert.equal(arrivi.slack[0].text, 'Kubo è collegato a questo canale.');
    assert.equal(arrivi.teams[0].attachments[0].contentType, 'application/vnd.microsoft.card.adaptive'); assert.equal(arrivi.teams[0].attachments[0].content.body[0].text, 'Kubo è collegato a questo canale.');
    assert.deepEqual(arrivi.discord[0].allowed_mentions, { parse: [] });
    const giro = async () => { await pausa(); await K.nucleo.lavora(); };
    const a = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Piatto blu', codice: 'P1', prezzo: 12, giacenza: 5, soglia: 3 })).json; await giro();
    const scorte = l => l.map(m => m.text ?? m.content ?? m.attachments?.[0].content.body[0].text).filter(t => /Scorta bassa/.test(t || ''));
    assert.equal(scorte(arrivi.slack).length, 0);
    await K.chiama('PATCH', `/api/dati/articoli/${a.id}`, { giacenza: 2 }); await giro();
    await K.chiama('PATCH', `/api/dati/articoli/${a.id}`, { giacenza: 1 }); await giro();
    assert.deepEqual(scorte(arrivi.slack), ['Scorta bassa: Piatto blu (2 rimasti)']); assert.equal(scorte(arrivi.discord).length, 1);
    assert.equal(scorte(arrivi.teams).length, 0);   // Teams: scorte spente
    await K.chiama('PATCH', `/api/dati/articoli/${a.id}`, { giacenza: 10 }); await giro();
    await K.chiama('PATCH', `/api/dati/articoli/${a.id}`, { giacenza: 3 }); await giro();
    assert.deepEqual(scorte(arrivi.slack), ['Scorta bassa: Piatto blu (2 rimasti)', 'Scorta bassa: Piatto blu (3 rimasti)']);
    // un appuntamento nuovo (modello studio)
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Marco Verdi' })).json;
    await K.chiama('POST', '/api/dati/appuntamenti', { quando: '2026-11-03T14:30:00Z', cliente: cl.id }); await giro();
    assert.match(arrivi.slack.at(-1).text, /^Nuovo appuntamento: .*3.*15:30 · Marco Verdi$/);
    // Lumi scrive nel canale (solo il titolare); un indirizzo che risponde 404 diventa un errore leggibile
    assert.equal((await K.chiama('POST', '/api/connettori/slack/azioni/scrivi', { args: { testo: 'Chiusura alle 17 oggi' } })).json.inviato, true);
    assert.equal(arrivi.slack.at(-1).text, 'Chiusura alle 17 oggi');
    await K.chiama('PUT', '/api/connettori/discord', { segreti: { url: `${S.url}/discord/api/webhooks/2/no` } });
    const no = await K.chiama('POST', '/api/connettori/discord/azioni/scrivi', { args: { testo: 'x' } });
    assert.equal(no.stato, 502); assert.match(no.json.errore, /Discord ha risposto 404/);
  } finally { await K.chiudi(); await S.chiudi(); }
});
