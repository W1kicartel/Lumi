// WhatsApp: regole (numeri, finestra, silenzio, STOP, variabili, costi), i tre servizi contro finti server locali
// (Meta Cloud API, Twilio, 360dialog), firme dei webhook, consensi, modelli, Lumi, automazioni. Nessuna chiamata vera in rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { finto, kubo, accendi, manda } from './connettori-finto.mjs';
import * as R from '../server/moduli/whatsapp-regole.js';
import { TESTI } from '../server/moduli/whatsapp-lingue.js';
import { istanzeWa } from '../server/moduli/whatsapp.js';
import { firmaTwilio } from '../connettori/twilio-whatsapp/connettore.js';
import * as A from '../server/automazioni.js';

const meta = (await import('../connettori/whatsapp/connettore.js')).default;
const twilio = (await import('../connettori/twilio-whatsapp/connettore.js')).default;
const d360 = (await import('../connettori/dialog360/connettore.js')).default;
const firmaMeta = (s, corpo) => 'sha256=' + createHmac('sha256', s).update(corpo).digest('hex');
const aspetta = async (f, ms = 3000) => { const fine = Date.now() + ms; while (Date.now() < fine) { const x = f(); if (x) return x; await new Promise(r => setTimeout(r, 20)); } return f(); };
const entrata = (da, testo, id = `wamid.${Math.random().toString(36).slice(2)}`) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '222', changes: [{ field: 'messages',
  value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1065403522' }, contacts: [{ wa_id: da, profile: { name: 'Mario' } }], messages: [{ from: da, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: testo } }] } }] }] });
const statoMeta = (id, status) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '222', changes: [{ field: 'messages', value: { statuses: [{ id, status, timestamp: '1760000000', recipient_id: '393331234567' }] } }] }] });
const MODELLI = [
  { id: '1', name: 'promemoria_appuntamento', language: 'it', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Ciao {{1}}, ti ricordiamo l\'appuntamento di {{2}} da {{3}}.' }] },
  { id: '2', name: 'ordine_pronto', language: 'it', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Ciao {{1}}, il tuo ordine è pronto. Ti aspettiamo!' }] },
  { id: '3', name: 'offerta_autunno', language: 'it', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Ciao {{1}}, questa settimana sconto del 10%!' }] },
  { id: '4', name: 'vecchio', language: 'it', status: 'REJECTED', category: 'UTILITY', rejected_reason: 'INVALID_FORMAT', components: [{ type: 'BODY', text: 'x' }] },
];
const fintoMeta = (modelli = MODELLI) => finto({
  'GET /v24.0/1065403522': () => ({ verified_name: 'Bottega', display_phone_number: '+39 02 0000000', quality_rating: 'GREEN' }),
  'POST /v24.0/1065403522/messages': (p, c) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.out${Math.random().toString(36).slice(2, 8)}` }] }),
  'POST /v24.0/1065403522/media': () => ({ id: 'media-1' }),
  'GET /v24.0/1022901293/message_templates': () => ({ data: modelli }),
  'POST /v24.0/1022901293/message_templates': (p, c) => ({ id: '99', status: 'PENDING', category: c.category }),
  'POST /v24.0/1022901293/subscribed_apps': () => ({ success: true }),
});
async function conMeta(modelli = ['studio']) {
  const K = await kubo(modelli), S = await fintoMeta();
  await accendi(K, 'whatsapp', { base: S.url, segreti: { token: 'EAAtoken', segreto_app: 'app-segreta' }, impostazioni: { numero_id: '1065403522', waba_id: '1022901293' } });
  return { K, S, W: istanzeWa.get(K.db), chiudi: async () => { await K.chiudi(); await S.chiudi(); } };
}
const cliente = async (K, nome, telefono) => (await K.chiama('POST', '/api/dati/clienti', { nome, telefono })).json;

test('regole: numeri E.164, finestra di 24 ore, ore di silenzio, STOP, variabili, costi, scelta del modello', () => {
  assert.equal(R.e164('333 123 4567'), '+393331234567');
  assert.equal(R.e164('+39 333-123-4567'), '+393331234567');
  assert.equal(R.e164('0039 333 1234567'), '+393331234567');
  assert.equal(R.e164('393331234567'), '+393331234567');           // il wa_id di Meta, senza «+»
  assert.equal(R.e164('06 1234 5678'), '+390612345678');           // i fissi tengono lo zero
  assert.equal(R.e164('whatsapp:+14155238886'), '+14155238886');
  assert.equal(R.e164('123'), null); assert.equal(R.e164(''), null);
  const t = Date.parse('2026-10-09T10:00:00Z');
  assert.deepEqual(R.finestra('2026-10-09T09:00:00Z', t), { aperta: true, scade: '2026-10-10T09:00:00.000Z' });
  assert.equal(R.finestra('2026-10-08T09:59:59Z', t).aperta, false); assert.equal(R.finestra(null, t).aperta, false);
  const sil = { da: '21:00', a: '09:00' };   // Roma in ottobre = UTC+2
  assert.equal(R.inSilenzio(Date.parse('2026-10-09T20:30:00Z'), sil, 'Europe/Rome'), true);    // 22:30
  assert.equal(R.inSilenzio(Date.parse('2026-10-09T05:00:00Z'), sil, 'Europe/Rome'), true);    // 07:00
  assert.equal(R.inSilenzio(Date.parse('2026-10-09T08:00:00Z'), sil, 'Europe/Rome'), false);   // 10:00
  assert.equal(new Date(R.fineSilenzio(Date.parse('2026-10-09T20:30:00Z'), sil, 'Europe/Rome')).toISOString(), '2026-10-10T07:00:00.000Z');
  assert.equal(R.aperto(Date.parse('2026-10-11T10:00:00Z'), { apre: '09:00', chiude: '19:00', giorni: [1, 2, 3, 4, 5, 6] }, 'Europe/Rome'), false);   // domenica
  for (const s of ['STOP', 'stop', ' Basta! ', 'ANNULLA', 'Stop per favore']) assert.equal(R.parolaChiave(s), 'stop', s);
  assert.equal(R.parolaChiave('non fermatevi, va tutto bene'), null); assert.equal(R.parolaChiave('START'), 'ripresa');
  const m = { corpo: 'Ciao {{1}}, il {{2}} da {{3}}. {{4}}' };
  const x = R.valoriModello(m, { 1: 'cliente.nome', 2: 'riga.quando', 3: 'azienda.nome', 4: 'riga.tracking|fisso:A presto' },
    { cliente: { nome: 'Mario Rossi' }, riga: { quando: '2026-10-10T13:30:00.000Z' }, azienda: { nome: 'Bottega' } }, { lingua: 'it', fuso: 'Europe/Rome' });
  assert.deepEqual(x.mancano, []); assert.equal(x.valori[0], 'Mario Rossi'); assert.match(x.valori[1], /sabato 10 ottobre.*15:30/); assert.equal(x.valori[3], 'A presto');
  assert.deepEqual(R.valoriModello(m, { 1: 'cliente.nome' }, { cliente: {} }).mancano, [1, 2, 3, 4]);
  assert.equal(R.riempi('Ciao {{1}}', ['Anna']), 'Ciao Anna');
  assert.equal(R.costo('marketing'), R.TARIFFE.marketing); assert.equal(R.costo('utility', { inFinestra: true }), 0); assert.equal(R.costo('utility'), R.TARIFFE.utility);
  assert.equal(R.costo('servizio'), 0); assert.equal(R.costo('servizio', { tariffe: { servizioGratisMese: 1000, servizio: 0.0248 }, servizioGiaNelMese: 1000 }), 0.0248);
  assert.equal(R.costo('utility', { provider: 'twilio-whatsapp' }), Math.round((R.TARIFFE.utility + R.TARIFFE.twilio) * 1e5) / 1e5);
  const lista = MODELLI.map(t => ({ nome: t.name, lingua: t.language, stato: t.status === 'APPROVED' ? 'approvato' : 'rifiutato', categoria: t.category.toLowerCase(), corpo: t.components[0].text }));
  assert.equal(R.scegliModello('il tuo ordine è pronto', lista).nome, 'ordine_pronto');
  assert.equal(R.scegliModello('ti ricordo l\'appuntamento di domani', lista).nome, 'promemoria_appuntamento');
  assert.equal(R.scegliModello('qualcosa di diverso', lista), null);
});

test('Meta: verifica GET del webhook, firma X-Hub-Signature-256, messaggio in arrivo abbinato al cliente, risposta nella finestra, stati', async () => {
  const { K, S, W, chiudi } = await conMeta();
  try {
    const c = await cliente(K, 'Mario Rossi', '333 123 4567');
    const tok = K.nucleo.segreto('whatsapp', 'verifica'); assert.ok(tok && tok.length > 20);
    assert.equal(S.chiamate.find(x => x.percorso === '/v24.0/1022901293/subscribed_apps')?.intestazioni.authorization, 'Bearer EAAtoken');   // iscritta all'accensione
    const no = await fetch(`${K.base}/api/connettori/whatsapp/in?hub.mode=subscribe&hub.verify_token=sbagliato&hub.challenge=123`); assert.equal(no.status, 403);
    const si = await fetch(`${K.base}/api/connettori/whatsapp/in?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(tok)}&hub.challenge=1158201444`);
    assert.equal(si.status, 200); assert.equal(await si.text(), '1158201444');
    const corpo = entrata('393331234567', 'Buongiorno, a che ora aprite domani?');
    assert.equal((await manda(K, '/api/connettori/whatsapp/in', corpo, { 'X-Hub-Signature-256': 'sha256=00' })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/whatsapp/in', corpo, { 'X-Hub-Signature-256': firmaMeta('altra', corpo) })).stato, 401);
    const r = await manda(K, '/api/connettori/whatsapp/in', corpo, { 'X-Hub-Signature-256': firmaMeta('app-segreta', corpo) }); assert.equal(r.stato, 200, JSON.stringify(r.json));
    assert.equal((await manda(K, '/api/connettori/whatsapp/in', corpo, { 'X-Hub-Signature-256': firmaMeta('app-segreta', corpo) })).json.doppione, true);
    const conv = (await K.chiama('GET', '/api/whatsapp/conversazioni')).json;
    assert.equal(conv.length, 1); assert.equal(conv[0].numero, '+393331234567'); assert.equal(conv[0].cliente, c.id); assert.equal(conv[0].nome, 'Mario Rossi');
    assert.equal(conv[0].nonLetti, 1); assert.equal(conv[0].finestra.aperta, true);
    assert.equal((await K.chiama('GET', '/api/whatsapp/stato')).json.nonLetti, 1);
    await K.chiama('POST', '/api/whatsapp/conversazioni/+393331234567/letti');
    assert.equal((await K.chiama('GET', '/api/whatsapp/stato')).json.nonLetti, 0);
    // dentro la finestra: testo libero, gratis
    const inv = await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, testo: 'Apriamo alle 9, a domani!' }); assert.equal(inv.stato, 200, JSON.stringify(inv.json));
    const chiamata = S.chiamate.find(x => x.percorso === '/v24.0/1065403522/messages');
    assert.equal(chiamata.intestazioni.authorization, 'Bearer EAAtoken');
    assert.deepEqual(chiamata.corpo, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '393331234567', type: 'text', text: { preview_url: false, body: 'Apriamo alle 9, a domani!' } });
    assert.equal(inv.json.costo, 0);
    // gli stati arrivano dal webhook e non tornano indietro (letto non diventa consegnato)
    const wamid = K.db.prepare("SELECT id_remoto FROM _whatsapp_messaggi WHERE verso = 'out'").get().id_remoto;
    for (const s of ['read', 'delivered']) { const b = statoMeta(wamid, s); await manda(K, '/api/connettori/whatsapp/in', b, { 'X-Hub-Signature-256': firmaMeta('app-segreta', b) }); }
    assert.equal(K.db.prepare("SELECT stato FROM _whatsapp_messaggi WHERE verso = 'out'").get().stato, 'letto');
    // la storia sulla scheda del cliente
    const st = (await K.chiama('GET', `/api/whatsapp/cliente/${c.id}`)).json; assert.equal(st.messaggi.length, 2); assert.equal(st.finestra.aperta, true);
    // un solo servizio WhatsApp acceso
    const tw = await K.chiama('PUT', '/api/connettori/twilio-whatsapp', { attivo: true }); assert.equal(tw.stato, 409); assert.match(tw.json.errore, /WhatsApp \(Meta Cloud API\)/);
    // STOP: rispettato ovunque, e il motivo si legge
    const stop = entrata('393331234567', 'STOP'); await manda(K, '/api/connettori/whatsapp/in', stop, { 'X-Hub-Signature-256': firmaMeta('app-segreta', stop) });
    const dopo = await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, testo: 'Ultima cosa' }); assert.equal(dopo.stato, 409); assert.equal(dopo.json.motivo, 'stop'); assert.match(dopo.json.errore, /STOP/);
    assert.equal(W.consenso('+393331234567').marketing.stato, 'no');
  } finally { await chiudi(); }
});

test('Meta: consensi, modelli fuori dalla finestra, marketing, silenzio e limiti; sincronizza, crea e abbina le variabili', async () => {
  const { K, S, W, chiudi } = await conMeta();
  try {
    const c = await cliente(K, 'Anna Bianchi', '+39 347 000 1111');
    const sinc = await K.chiama('POST', '/api/whatsapp/modelli/sincronizza'); assert.equal(sinc.stato, 200, JSON.stringify(sinc.json));
    assert.deepEqual(sinc.json.map(m => `${m.nome}:${m.stato}`), ['offerta_autunno:approvato', 'ordine_pronto:approvato', 'promemoria_appuntamento:approvato', 'vecchio:rifiutato']);
    assert.equal(sinc.json.find(m => m.nome === 'vecchio').motivo, 'INVALID_FORMAT');
    let x = await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, testo: 'Ciao' }); assert.equal(x.json.motivo, 'finestra-chiusa');
    x = await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, modello: { nome: 'ordine_pronto', lingua: 'it' } }); assert.equal(x.json.motivo, 'consenso-servizio');
    x = await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, modello: { nome: 'vecchio' } }); assert.equal(x.json.motivo, 'modello-sconosciuto');
    // il consenso con data, fonte e parole mostrate
    const cs = await K.chiama('POST', '/api/whatsapp/consensi', { cliente: c.id, categoria: 'servizio', stato: 'si', fonte: 'modulo in negozio', testo: 'Acconsento a ricevere su WhatsApp promemoria e avvisi sui miei ordini.' });
    assert.equal(cs.json.servizio.stato, 'si'); assert.equal(cs.json.servizio.fonte, 'modulo in negozio'); assert.match(cs.json.servizio.testo, /promemoria/);
    const ant = await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, modello: { nome: 'ordine_pronto' }, anteprima: true });
    assert.equal(ant.json.no, null); assert.equal(ant.json.testo, 'Ciao Anna Bianchi, il tuo ordine è pronto. Ti aspettiamo!'); assert.equal(ant.json.costo, R.TARIFFE.utility);
    x = await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, modello: { nome: 'ordine_pronto' } }); assert.equal(x.stato, 200, JSON.stringify(x.json));
    const t = S.chiamate.filter(y => y.percorso === '/v24.0/1065403522/messages').at(-1).corpo;
    assert.deepEqual(t.template, { name: 'ordine_pronto', language: { code: 'it' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Anna Bianchi' }] }] });
    // marketing: serve il suo consenso
    x = await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, modello: { nome: 'offerta_autunno' } }); assert.equal(x.json.motivo, 'consenso-marketing');
    await K.chiama('POST', '/api/whatsapp/consensi', { cliente: c.id, categoria: 'marketing', stato: 'si', fonte: 'sito', testo: 'Sì, voglio ricevere le offerte su WhatsApp.' });
    const sera = Date.parse('2026-10-09T20:30:00Z'), mattina = Date.parse('2026-10-09T08:30:00Z');
    assert.equal(W.controlla({ numero: '+393470001111', categoria: 'marketing', tipo: 'modello', adesso: sera }).motivo, 'silenzio');
    assert.equal(W.controlla({ numero: '+393470001111', categoria: 'utility', tipo: 'modello', adesso: sera }), null);   // un promemoria di servizio sì
    assert.equal(W.controlla({ numero: '+393470001111', categoria: 'marketing', tipo: 'modello', adesso: mattina }), null);
    // i limiti: per cliente al giorno, e un promozionale ogni N giorni
    K.db.prepare("INSERT INTO _whatsapp_messaggi (numero, verso, tipo, categoria, stato, quando) VALUES ('+393470001111', 'out', 'modello', 'marketing', 'inviato', ?)").run(new Date().toISOString());
    assert.equal(W.controlla({ numero: '+393470001111', categoria: 'marketing', tipo: 'modello', adesso: Date.now() + 36e5 }).motivo, 'limite-marketing');
    await K.chiama('PUT', '/api/whatsapp/impostazioni', { maxClienteGiorno: 2 });
    assert.equal(W.controlla({ numero: '+393470001111', categoria: 'utility', tipo: 'modello' }).motivo, 'limite-cliente');
    await K.chiama('PUT', '/api/whatsapp/impostazioni', { maxClienteGiorno: 5, limiteGiorno: 2 });
    assert.equal(W.controlla({ numero: '+393470001111', categoria: 'utility', tipo: 'modello' }).motivo, 'limite-giorno');
    // costi del mese: solo quello partito
    const st = (await K.chiama('GET', '/api/whatsapp/stato')).json; assert.equal(st.provider, 'whatsapp'); assert.ok(st.costi.some(z => z.categoria === 'utility' && z.n === 1));
    // nuovo modello da Kubo: Meta lo riceve con gli esempi; poi la mappa delle variabili
    const nuovo = await K.chiama('POST', '/api/whatsapp/modelli', { nome: 'promemoria_kubo', categoria: 'utility', corpo: 'Ciao {{1}}, ci vediamo {{2}}.', esempi: ['Anna', 'domani alle 10'] });
    assert.equal(nuovo.stato, 200, JSON.stringify(nuovo.json)); assert.equal(nuovo.json.stato, 'in_attesa');
    const inviato = S.chiamate.find(y => y.metodo === 'POST' && y.percorso === '/v24.0/1022901293/message_templates').corpo;
    assert.deepEqual(inviato, { name: 'promemoria_kubo', language: 'it', category: 'UTILITY', components: [{ type: 'BODY', text: 'Ciao {{1}}, ci vediamo {{2}}.', example: { body_text: [['Anna', 'domani alle 10']] } }] });
    assert.equal((await K.chiama('POST', '/api/whatsapp/modelli', { nome: 'Nome Sbagliato', corpo: 'x' })).json.motivo, 'modello-nome');
    const mp = await K.chiama('PUT', '/api/whatsapp/modelli/promemoria_appuntamento/it/mappa', { mappa: { 1: 'cliente.nome', 2: 'riga.quando', 3: 'azienda.nome' } });
    assert.deepEqual(mp.json.mappa, { 1: 'cliente.nome', 2: 'riga.quando', 3: 'azienda.nome' });
    // un webhook del modello approvato aggiorna lo stato
    const ap = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '222', time: 1, changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'promemoria_kubo', message_template_language: 'it', reason: 'NONE' } }] }] });
    await manda(K, '/api/connettori/whatsapp/in', ap, { 'X-Hub-Signature-256': firmaMeta('app-segreta', ap) });
    assert.equal((await K.chiama('GET', '/api/whatsapp/modelli')).json.find(m => m.nome === 'promemoria_kubo').stato, 'approvato');
  } finally { await chiudi(); }
});

test('Lumi: whatsapp_scrivi trova il cliente, scrive nella finestra, sceglie il modello fuori, rifiuta senza consenso; whatsapp_leggi', async () => {
  const { K, S, chiudi } = await conMeta();
  try {
    await cliente(K, 'Mario Rossi', '3331234567'); const b = await cliente(K, 'Anna Bianchi', '3470001111');
    await K.chiama('POST', '/api/whatsapp/modelli/sincronizza');
    const nomi = (await K.chiama('GET', '/api/lumi/strumenti')).json.strumenti.map(s => s.nome); assert.ok(nomi.includes('whatsapp_scrivi') && nomi.includes('whatsapp_leggi'));
    // senza consenso e senza finestra: rifiuto con il motivo
    let a = await K.chiama('POST', '/api/lumi/strumenti/whatsapp_scrivi/anteprima', { args: { cliente: 'Bianchi', messaggio: 'il tuo ordine è pronto' }, lingua: 'it' });
    assert.match(a.json.errore, /consenso/); assert.ok(!a.json.gettone);
    a = await K.chiama('POST', '/api/lumi/strumenti/whatsapp_scrivi/anteprima', { args: { cliente: 'Verdi', messaggio: 'ciao' } }); assert.match(a.json.errore, /non trovato/);
    // Rossi ha scritto: finestra aperta, testo libero
    const corpo = entrata('393331234567', 'Il mio ordine è pronto?'); await manda(K, '/api/connettori/whatsapp/in', corpo, { 'X-Hub-Signature-256': firmaMeta('app-segreta', corpo) });
    const args = { cliente: 'Rossi', messaggio: 'Sì Mario, il tuo ordine è pronto: passa quando vuoi!' };
    a = await K.chiama('POST', '/api/lumi/strumenti/whatsapp_scrivi/anteprima', { args, lingua: 'it' });
    assert.equal(a.stato, 200, JSON.stringify(a.json)); assert.ok(a.json.gettone);
    assert.deepEqual(a.json.righe.map(r => r[0]), ['A', 'Finestra di 24 ore', 'Messaggio', 'Costo stimato']); assert.match(a.json.righe[1][1], /^aperta fino a/);
    assert.equal((await K.chiama('POST', '/api/lumi/strumenti/whatsapp_scrivi/esegui', { args, gettone: 'falso' })).stato, 409);
    const e = await K.chiama('POST', '/api/lumi/strumenti/whatsapp_scrivi/esegui', { args, gettone: a.json.gettone }); assert.equal(e.json.inviato, true);
    assert.equal(S.chiamate.filter(x => x.percorso === '/v24.0/1065403522/messages').at(-1).corpo.text.body, args.messaggio);
    // Bianchi con il consenso, finestra chiusa: il modello «ordine_pronto», in inglese la scheda
    await K.chiama('POST', '/api/whatsapp/consensi', { cliente: b.id, categoria: 'servizio', stato: 'si', fonte: 'a voce', testo: 'Ok ai messaggi di servizio.' });
    const args2 = { cliente: 'Anna Bianchi', messaggio: 'Il tuo ordine è pronto' };
    a = await K.chiama('POST', '/api/lumi/strumenti/whatsapp_scrivi/anteprima', { args: args2, lingua: 'en' });
    assert.equal(a.json.righe[1][1], 'closed: an approved template is used'); assert.match(a.json.righe[2][1], /^ordine_pronto \(utility, it\)$/);
    await K.chiama('POST', '/api/lumi/strumenti/whatsapp_scrivi/esegui', { args: args2, gettone: a.json.gettone });
    assert.equal(S.chiamate.filter(x => x.percorso === '/v24.0/1065403522/messages').at(-1).corpo.template.name, 'ordine_pronto');
    // whatsapp_leggi: la conversazione e i non letti
    const l = (await K.chiama('POST', '/api/lumi/strumenti/whatsapp_leggi', { args: { cliente: 'Rossi' } })).json;
    assert.equal(l.messaggi.length, 2); assert.equal(l.finestra.aperta, true);
    const nl = (await K.chiama('POST', '/api/lumi/strumenti/whatsapp_leggi', { args: {} })).json; assert.equal(nl.non_letti[0].cliente, 'Mario Rossi');
  } finally { await chiudi(); }
});

test('automazioni: promemoria 24 h dal giro, conferma dal motore, azione «whatsapp» generica che senza consenso si ferma, fuori orario', async () => {
  const { K, S, W, chiudi } = await conMeta();
  try {
    const c = await cliente(K, 'Mario Rossi', '3331234567');
    await K.chiama('POST', '/api/whatsapp/consensi', { cliente: c.id, categoria: 'servizio', stato: 'si', fonte: 'modulo', testo: 'Ok ai promemoria.' });
    await K.chiama('POST', '/api/whatsapp/modelli/sincronizza');
    const ric = (await K.chiama('GET', '/api/whatsapp/ricette')).json; assert.equal(ric.length, 9); assert.equal(ric.find(r => r.id === 'promemoria').sezione, 'appuntamenti');
    assert.equal(ric.find(r => r.id === 'compleanno').possibile, true);   // studio: i clienti hanno la data di nascita
    const p = await K.chiama('PUT', '/api/whatsapp/ricette/promemoria', { attiva: true, modello: 'promemoria_appuntamento', lingua: 'it', opzioni: { ore: [24, 2] } }); assert.equal(p.stato, 200, JSON.stringify(p.json));
    const app = (await K.chiama('POST', '/api/dati/appuntamenti', { quando: new Date(Date.now() + 20 * 36e5).toISOString(), cliente: c.id, stato: 'prenotato' })).json;
    const pre = (await K.chiama('POST', '/api/whatsapp/ricette/promemoria/anteprima', {})).json; assert.match(pre.testo, /^Ciao Mario Rossi, ti ricordiamo l'appuntamento di .+ da Bottega\.$/);
    assert.equal(W.giro().fatti, 1); assert.equal(W.giro().fatti, 0);   // una volta sola
    const t = await aspetta(() => S.chiamate.find(x => x.corpo?.template?.name === 'promemoria_appuntamento'));
    assert.ok(t, 'il promemoria è partito'); assert.equal(t.corpo.template.components[0].parameters[0].text, 'Mario Rossi');
    // conferma prenotazione: un'automazione del motore con l'azione «whatsapp»
    await K.chiama('PUT', '/api/whatsapp/ricette/conferma', { attiva: true, modello: 'promemoria_appuntamento', lingua: 'it' });
    assert.ok(A.elenco(K.db).some(a => a.id === 'whatsapp-conferma' && a.attiva && a.azioni[0].tipo === 'whatsapp'));
    const prima = S.chiamate.length;
    await K.chiama('POST', '/api/dati/appuntamenti', { quando: new Date(Date.now() + 72 * 36e5).toISOString(), cliente: c.id, stato: 'prenotato' });
    assert.ok(await aspetta(() => S.chiamate.length > prima), 'la conferma è partita');
    // un'automazione scritta a mano: «quando nasce un cliente, mandagli ordine_pronto» → senza consenso si ferma, con il motivo
    A.salva(K.db, { id: 'prova-wa', nome: 'benvenuto', entita: 'clienti', quando: 'creato', azioni: [{ tipo: 'whatsapp', modello: 'ordine_pronto', variabili: { 1: 'nome' } }] });
    await cliente(K, 'Luca Neri', '3489998887');
    const bloccato = await aspetta(() => K.db.prepare("SELECT * FROM _whatsapp_messaggi WHERE numero = '+393489998887' AND stato = 'bloccato'").get());
    assert.ok(bloccato, 'fermato'); assert.match(bloccato.motivo, /consenso/);
    assert.ok((await K.chiama('GET', '/api/whatsapp/registro')).json.some(x => x.numero === '+393489998887'));
    // fuori orario: risposta automatica una volta sola, nella finestra appena aperta
    await K.chiama('PUT', '/api/whatsapp/impostazioni', { orari: { apre: '00:00', chiude: '00:01', giorni: [] } });
    await K.chiama('PUT', '/api/whatsapp/ricette/fuori_orario', { attiva: true, opzioni: { testo: 'Siamo chiusi, rispondiamo domani.' } });
    for (const testo of ['Ciao?', 'C\'è qualcuno?']) { const b = entrata('393331234567', testo); await manda(K, '/api/connettori/whatsapp/in', b, { 'X-Hub-Signature-256': firmaMeta('app-segreta', b) }); }
    assert.equal(S.chiamate.filter(x => x.corpo?.text?.body === 'Siamo chiusi, rispondiamo domani.').length, 1);
  } finally { await chiudi(); }
});

test('Twilio: firma X-Twilio-Signature, messaggio in arrivo (form), testo, modello con ContentSid, PDF con link pubblico, Content API', async () => {
  const K = await kubo(['professionista']);
  const S = await finto({
    'POST /2010-04-01/Accounts/:sid/Messages.json': () => ({ sid: `SM${Math.random().toString(16).slice(2, 10)}`, status: 'queued' }),
    'GET /v1/ContentAndApprovals': () => ({ contents: [{ sid: 'HX111', friendly_name: 'preventivo_pronto', language: 'it', types: { 'twilio/text': { body: 'Ciao {{1}}, ecco il preventivo.' } }, approval_requests: { name: 'preventivo_pronto', category: 'UTILITY', status: 'approved' } }], meta: { next_page_url: null } }),
    'POST /v1/Content': () => ({ sid: 'HX222' }),
    'POST /v1/Content/:sid/ApprovalRequests/whatsapp': () => ({ status: 'received' }),
  });
  try {
    await accendi(K, 'twilio-whatsapp', { base: S.url, segreti: { token: 'auth-token-prova' }, impostazioni: { sid: 'AC' + 'a'.repeat(32), mittente: '+14155238886', indirizzo: K.base } });
    const c = await cliente(K, 'Giulia Verdi', '3401112222');
    const campi = { MessageSid: 'SM900', From: 'whatsapp:+393401112222', To: 'whatsapp:+14155238886', Body: 'Mi mandate il preventivo?', NumMedia: '0', ProfileName: 'Giulia', SmsStatus: 'received' };
    const url = `${K.base}/api/connettori/twilio-whatsapp/in`, corpo = new URLSearchParams(campi).toString();
    const invia = firma => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': firma }, body: corpo });
    assert.equal((await invia('sbagliata')).status, 401);
    const ok = await invia(firmaTwilio('auth-token-prova', url, campi)); assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal((await K.chiama('GET', '/api/whatsapp/conversazioni')).json[0].cliente, c.id);
    // testo nella finestra
    assert.equal((await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, testo: 'Certo, arriva subito.' })).stato, 200);
    const m = S.chiamate.find(x => x.percorso.endsWith('/Messages.json'));
    assert.equal(m.percorso, `/2010-04-01/Accounts/AC${'a'.repeat(32)}/Messages.json`);
    assert.equal(m.corpo.From, 'whatsapp:+14155238886'); assert.equal(m.corpo.To, 'whatsapp:+393401112222'); assert.equal(m.corpo.Body, 'Certo, arriva subito.');
    assert.equal(m.corpo.StatusCallback, `${K.base}/api/connettori/twilio-whatsapp/in`);
    assert.equal(m.intestazioni.authorization, 'Basic ' + Buffer.from(`AC${'a'.repeat(32)}:auth-token-prova`).toString('base64'));
    // modelli dalla Content API, invio con ContentSid e ContentVariables, e il PDF del preventivo con un link pubblico
    await K.chiama('POST', '/api/whatsapp/modelli/sincronizza');
    await K.chiama('POST', '/api/whatsapp/consensi', { cliente: c.id, categoria: 'servizio', stato: 'si', fonte: 'email', testo: 'Ok' });
    const prev = (await K.chiama('POST', '/api/dati/preventivi', { data: '2026-10-09', cliente: c.id, oggetto: 'Sito vetrina', voci: [{ descrizione: 'Progetto grafico', quantita: 1, prezzo: 800 }] })).json;
    const r = await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, modello: { nome: 'preventivo_pronto' }, documento: { entita: 'preventivi', id: prev.id } }); assert.equal(r.stato, 200, JSON.stringify(r.json));
    const tm = S.chiamate.filter(x => x.percorso.endsWith('/Messages.json'));
    assert.equal(tm.at(-2).corpo.ContentSid, 'HX111'); assert.equal(tm.at(-2).corpo.ContentVariables, JSON.stringify({ 1: 'Giulia Verdi' }));
    assert.match(tm.at(-1).corpo.MediaUrl, new RegExp(`^${K.base}/api/whatsapp/file/[\\w-]{20,}$`));
    const pdf = await fetch(tm.at(-1).corpo.MediaUrl); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.match(Buffer.from(await pdf.arrayBuffer()).toString('latin1'), /^%PDF-1\.4/);
    assert.equal((await fetch(`${K.base}/api/whatsapp/file/inventato`)).status, 404);
    // stato dal richiamo firmato
    const sid = K.db.prepare("SELECT id_remoto FROM _whatsapp_messaggi WHERE verso = 'out' ORDER BY id LIMIT 1").get().id_remoto;
    const st = { MessageSid: sid, MessageStatus: 'delivered' };
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': firmaTwilio('auth-token-prova', url, st) }, body: new URLSearchParams(st).toString() });
    assert.equal(K.db.prepare('SELECT stato FROM _whatsapp_messaggi WHERE id_remoto = ?').get(sid).stato, 'consegnato');
    // un modello nuovo: contenuto + richiesta di approvazione a Meta
    const n = await K.chiama('POST', '/api/whatsapp/modelli', { nome: 'fattura_pronta', corpo: 'Ciao {{1}}, la fattura è pronta.', esempi: ['Giulia'] });
    assert.equal(n.json.stato, 'in_attesa'); assert.equal(n.json.idRemoto, 'HX222');
    assert.deepEqual(S.chiamate.find(x => x.percorso === '/v1/Content').corpo.types, { 'twilio/text': { body: 'Ciao {{1}}, la fattura è pronta.' } });
    assert.deepEqual(S.chiamate.find(x => x.percorso === '/v1/Content/HX222/ApprovalRequests/whatsapp').corpo, { name: 'fattura_pronta', category: 'UTILITY' });
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('360dialog: webhook registrato all\'accensione con il codice segreto, eventi della Cloud API, D360-API-KEY, modelli', async () => {
  const K = await kubo(['studio']);
  const S = await finto({
    'POST /v1/configs/webhook': () => ({ url: 'ok' }),
    'POST /messages': () => ({ messages: [{ id: 'wamid.360' }] }),
    'GET /v1/configs/templates': () => ({ waba_templates: [MODELLI[1]] }),
  });
  try {
    await accendi(K, 'dialog360', { base: S.url, segreti: { chiave: 'chiave-360' }, impostazioni: { indirizzo: K.base } });
    const codice = K.nucleo.segreto('dialog360', 'codice');
    const reg = S.chiamate.find(x => x.percorso === '/v1/configs/webhook');
    assert.equal(reg.corpo.url, `${K.base}/api/connettori/dialog360/in/${codice}`); assert.equal(reg.intestazioni['d360-api-key'], 'chiave-360');
    const c = await cliente(K, 'Sara Galli', '3209876543');
    const corpo = entrata('393209876543', 'Posso spostare l\'appuntamento?');
    assert.equal((await manda(K, '/api/connettori/dialog360/in/sbagliato', corpo)).stato, 401);
    assert.equal((await manda(K, `/api/connettori/dialog360/in/${codice}`, corpo)).stato, 200);
    assert.equal((await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, testo: 'Certo, quando ti va bene?' })).stato, 200);
    const m = S.chiamate.find(x => x.percorso === '/messages'); assert.equal(m.intestazioni['d360-api-key'], 'chiave-360'); assert.equal(m.corpo.to, '393209876543');
    const sinc = (await K.chiama('POST', '/api/whatsapp/modelli/sincronizza')).json; assert.equal(sinc[0].nome, 'ordine_pronto'); assert.equal(sinc[0].stato, 'approvato');
    assert.equal((await K.chiama('GET', '/api/whatsapp/stato')).json.nome, 'WhatsApp (360dialog)');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('cataloghi: messaggi del modulo nelle sei lingue, contratto del catalogo dei tre connettori', () => {
  const par = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const l of ['en', 'es', 'fr', 'de', 'pt']) {
    assert.deepEqual(Object.keys(TESTI[l]).sort(), Object.keys(TESTI.it).sort(), l);
    for (const [k, v] of Object.entries(TESTI.it)) assert.deepEqual(par(TESTI[l][k]), par(v), `${l} ${k}`);
  }
  for (const c of [meta, twilio, d360]) {
    const k = c.catalogo; assert.equal(k.categoria, 'whatsapp', c.id);
    assert.ok(['gratis', 'a-consumo', 'abbonamento', 'contratto'].includes(k.costo)); assert.ok(['facile', 'media', 'difficile'].includes(k.difficolta));
    assert.ok(k.passi.length >= 3 && k.passi.length <= 8); assert.ok(k.serve.every(s => s.cosa && s.dove && /^https:/.test(s.link)));
    assert.ok(k.fonti.length && k.fonti.every(u => /^https:\/\//.test(u))); assert.equal(k.prova, 'finto'); assert.deepEqual(k.zone, ['mondo']);
    assert.ok(k.sito && k.costoNota && k.parole.length);
    for (const l of ['en', 'es', 'fr', 'de', 'pt']) assert.ok(c.testi[l]?.nome && c.testi[l]?.descrizione, `${c.id} ${l}`);
    assert.equal(c.testi.en['cat.passi'].length, k.passi.length); assert.equal(c.testi.en['cat.serve'].length, k.serve.length); assert.ok(c.testi.en['cat.costoNota']);
    for (const i of c.impostazioni) for (const l of ['en', 'es', 'fr', 'de', 'pt']) assert.ok(c.testi[l][`imp.${i.id}`], `${c.id} ${l} imp.${i.id}`);
    for (const f of ['testo', 'modello', 'documento', 'modelli', 'creaModello']) assert.equal(typeof c.whatsapp[f], 'function', `${c.id}.${f}`);
  }
});

test('preventivo con PDF: la ricetta sul motore manda il modello con il documento nell\'intestazione; sconosciuti come contatti; permessi', async () => {
  const K = await kubo(['professionista']);
  const S = await fintoMeta([...MODELLI, { id: '5', name: 'preventivo_pdf', language: 'it', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'HEADER', format: 'DOCUMENT' }, { type: 'BODY', text: 'Ciao {{1}}, ti mandiamo il preventivo {{2}}.' }] }]);
  try {
    await accendi(K, 'whatsapp', { base: S.url, segreti: { token: 'EAAtoken', segreto_app: 'app-segreta' }, impostazioni: { numero_id: '1065403522', waba_id: '1022901293' } });
    const c = await cliente(K, 'Paolo Gialli', '335 123 4567');
    await K.chiama('POST', '/api/whatsapp/consensi', { cliente: c.id, categoria: 'servizio', stato: 'si', fonte: 'contratto', testo: 'Ok a preventivi e fatture su WhatsApp.' });
    const mod = (await K.chiama('POST', '/api/whatsapp/modelli/sincronizza')).json; assert.equal(mod.find(m => m.nome === 'preventivo_pdf').intestazione, 'DOCUMENT');
    const r = await K.chiama('PUT', '/api/whatsapp/ricette/documento', { attiva: true, modello: 'preventivo_pdf', lingua: 'it' }); assert.equal(r.json.sezione, 'preventivi');
    const prev = (await K.chiama('POST', '/api/dati/preventivi', { data: '2026-10-09', cliente: c.id, oggetto: 'Logo', stato: 'bozza', voci: [{ descrizione: 'Logo e marchio', quantita: 1, prezzo: 450 }] })).json;
    await K.chiama('PATCH', `/api/dati/preventivi/${prev.id}`, { stato: 'inviato' });
    const t = await aspetta(() => S.chiamate.find(x => x.corpo?.template?.name === 'preventivo_pdf'));
    assert.ok(t, 'il preventivo è partito');
    assert.deepEqual(t.corpo.template.components[0], { type: 'header', parameters: [{ type: 'document', document: { id: 'media-1', filename: t.corpo.template.components[0].parameters[0].document.filename } }] });
    assert.match(t.corpo.template.components[0].parameters[0].document.filename, /\.pdf$/); assert.equal(t.corpo.template.components[1].parameters[0].text, 'Paolo Gialli');
    const up = S.chiamate.find(x => x.percorso === '/v24.0/1065403522/media'); assert.match(up.intestazioni['content-type'], /^multipart\/form-data; boundary=/); assert.match(String(up.corpo), /%PDF-1\.4/);
    // una seconda modifica non lo rimanda
    await K.chiama('PATCH', `/api/dati/preventivi/${prev.id}`, { oggetto: 'Logo e biglietti' });
    await new Promise(r => setTimeout(r, 150)); assert.equal(S.chiamate.filter(x => x.corpo?.template?.name === 'preventivo_pdf').length, 1);
    // chi scrive e non è in rubrica: con «lead» diventa un contatto da qualificare
    await K.chiama('PUT', '/api/whatsapp/impostazioni', { sconosciuti: 'lead' });
    const b = entrata('393390000001', 'Vorrei un preventivo per un sito'); await manda(K, '/api/connettori/whatsapp/in', b, { 'X-Hub-Signature-256': firmaMeta('app-segreta', b) });
    const nuovo = (await K.chiama('GET', '/api/whatsapp/conversazioni')).json.find(x => x.numero === '+393390000001');
    assert.equal(nuovo.nome, 'Mario'); assert.ok(nuovo.cliente); assert.match((await K.chiama('GET', `/api/dati/clienti/${nuovo.cliente}`)).json.note, /da qualificare/);
    // permessi: un utente senza la modifica dei clienti legge ma non scrive, e non vede le impostazioni
    assert.equal((await K.chiama('POST', '/api/utenti', { nome: 'Ospite', email: 'ospite@esempio.it', password: 'password-ospite', ruolo: 'lettura' })).stato, 200);
    await K.chiama('POST', '/api/esci'); await K.chiama('POST', '/api/accedi', { email: 'ospite@esempio.it', password: 'password-ospite' });
    const st = await K.chiama('GET', '/api/whatsapp/stato');
    assert.equal(st.stato, 200); assert.equal(st.json.titolare, false);
    assert.equal((await K.chiama('POST', '/api/whatsapp/invia', { cliente: c.id, testo: 'ciao' })).stato, 403);
    assert.equal((await K.chiama('PUT', '/api/whatsapp/impostazioni', { limiteGiorno: 1 })).stato, 403);
    assert.ok(!(await K.chiama('GET', '/api/lumi/strumenti')).json.strumenti.some(x => x.nome === 'whatsapp_scrivi'));
  } finally { await K.chiudi(); await S.chiudi(); }
});
