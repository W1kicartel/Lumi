// I moduli del sito, i lead e le prenotazioni: Typeform, Tally, Jotform, Google Ads (moduli per i lead), Acuity, Jitsi.
// Tutti contro finti servizi locali (o senza servizio), con firme giuste e sbagliate. Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';
import { isoLocale, leggiRisposte } from '../connettori/_comunica/moduli.js';
import { leggiMultipart, risposteGrezze } from '../connettori/jotform/connettore.js';
import { stanza } from '../connettori/jitsi/connettore.js';
import { coda } from './connettori-comunica-coda.mjs';

const righe = async (K, sem) => (await K.chiama('GET', `/api/dati/${sem}?perPagina=100`)).json.righe;

test('moduli.js: ora locale → UTC (legale e solare), risposte → contatto, data e ora, note', () => {
  assert.equal(isoLocale('2026-10-20', '15:30', 'Europe/Rome'), '2026-10-20T13:30:00.000Z');
  assert.equal(isoLocale('2026-12-10', '9.05', 'Europe/Rome'), '2026-12-10T08:05:00.000Z');
  assert.equal(isoLocale('2026-03-29', '10:00', 'Europe/Rome'), '2026-03-29T08:00:00.000Z');   // il giorno del cambio d'ora
  assert.equal(isoLocale('20/10/2026', '10:00'), null);
  const x = leggiRisposte([{ titolo: 'Nome', tipo: 'testo', valore: 'Anna' }, { titolo: 'Cognome', tipo: 'testo', valore: 'Bianchi' }, { titolo: 'La tua email', tipo: 'testo', valore: 'Anna@Esempio.it' },
    { titolo: 'Giorno', tipo: 'data', valore: '2026-10-20' }, { titolo: 'Orario preferito', tipo: 'testo', valore: '10:30' }, { titolo: 'Servizi', tipo: 'testo', valore: ['Taglio', 'Piega'] }, { titolo: 'Vuota', valore: '' }], 'Europe/Rome');
  assert.deepEqual(x, { email: 'anna@esempio.it', telefono: null, nome: 'Anna Bianchi', quando: '2026-10-20T08:30:00.000Z', righe: ['Servizi: Taglio, Piega'] });
});

test('Typeform: firma sha256= base64 giusta e sbagliata; risposta → cliente + appuntamento; doppione; stesso cliente, note in coda', async () => {
  const K = await kubo(['studio']);
  try {
    await accendi(K, 'typeform', { impostazioni: { indirizzo: 'https://kubo.studiobianchi.it' } });
    const s = K.nucleo.segreto('typeform', 'segreto'); assert.ok(s?.length >= 20);   // lo genera Kubo
    assert.equal((await K.chiama('POST', '/api/connettori/typeform/azioni/indirizzo_webhook', {})).json.indirizzo, 'https://kubo.studiobianchi.it/api/connettori/typeform/in');
    const risposta = (evento, token, email, extra = []) => JSON.stringify({ event_id: evento, event_type: 'form_response', form_response: { form_id: 'lT4Z3j', token, submitted_at: '2026-10-09T10:00:00Z',
      definition: { id: 'lT4Z3j', title: 'Prenota una visita', fields: [{ id: 'f1', title: 'Come ti chiami?', type: 'short_text' }, { id: 'f2', title: 'Email', type: 'email' }, { id: 'f3', title: 'Telefono', type: 'phone_number' },
        { id: 'f4', title: 'Giorno preferito', type: 'date' }, { id: 'f5', title: 'Ora preferita', type: 'short_text' }, { id: 'f6', title: 'Di cosa hai bisogno?', type: 'multiple_choice' }, { id: 'f7', title: 'Messaggio', type: 'long_text' }] },
      answers: [{ type: 'text', text: 'Giulia Verdi', field: { id: 'f1', type: 'short_text' } }, { type: 'email', email, field: { id: 'f2', type: 'email' } }, { type: 'phone_number', phone_number: '+393331112222', field: { id: 'f3', type: 'phone_number' } }, ...extra],
      hidden: { utm_source: 'newsletter' } } });
    const prima = risposta('01EV1', 'tok-1', 'Giulia.Verdi@esempio.it', [{ type: 'date', date: '2026-10-20', field: { id: 'f4', type: 'date' } }, { type: 'text', text: '15:30', field: { id: 'f5', type: 'short_text' } },
      { type: 'choice', choice: { label: 'Igiene dentale' }, field: { id: 'f6', type: 'multiple_choice' } }, { type: 'text', text: 'Preferisco il pomeriggio', field: { id: 'f7', type: 'long_text' } }]);
    const firma = c => 'sha256=' + firmaHmacDi(s, c, 'base64');
    assert.equal((await manda(K, '/api/connettori/typeform/in', prima, { 'Typeform-Signature': 'sha256=' + firmaHmacDi('altro', prima, 'base64') })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/typeform/in', prima, { 'Typeform-Signature': firma(prima + ' ') })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/typeform/in', prima)).stato, 401);
    const r = await manda(K, '/api/connettori/typeform/in', prima, { 'Typeform-Signature': firma(prima) });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'cliente creato, appuntamento creato');
    assert.equal((await manda(K, '/api/connettori/typeform/in', prima, { 'Typeform-Signature': firma(prima) })).json.doppione, true);
    const [c] = await righe(K, 'clienti');
    assert.equal(c.nome, 'Giulia Verdi'); assert.equal(c.email, 'giulia.verdi@esempio.it'); assert.equal(c.telefono, '+393331112222');
    assert.match(c.note, /^Typeform · modulo «Prenota una visita»/); assert.match(c.note, /Di cosa hai bisogno\?: Igiene dentale/); assert.match(c.note, /Messaggio: Preferisco il pomeriggio/); assert.match(c.note, /utm_source: newsletter/);
    const [a] = await righe(K, 'appuntamenti'); assert.equal(a.quando, '2026-10-20T13:30:00.000Z'); assert.equal(a.cliente?.id ?? a.cliente, c.id); assert.match(a.note, /Typeform/);
    // un'altra richiesta della stessa persona: niente doppione, la richiesta si aggiunge alle note
    const seconda = risposta('01EV2', 'tok-2', 'giulia.verdi@esempio.it', [{ type: 'text', text: 'Avete anche lo sbiancamento?', field: { id: 'f7', type: 'long_text' } }]);
    assert.equal((await manda(K, '/api/connettori/typeform/in', seconda, { 'Typeform-Signature': firma(seconda) })).json.esito, 'cliente già presente');
    const tutti = await righe(K, 'clienti'); assert.equal(tutti.length, 1); assert.match(tutti[0].note, /Preferisco il pomeriggio[\s\S]*sbiancamento/);
    assert.equal((await righe(K, 'appuntamenti')).length, 1);
  } finally { await K.chiudi(); }
});

test('Typeform senza webhook: giro con token (Bearer, since), titoli dai gruppi di domande, cursore', async () => {
  const K = await kubo(['studio']);
  const S = await finto({
    'GET /me': () => ({ alias: 'Studio Bianchi', email: 'studio@esempio.it' }),
    'GET /forms/:id': () => ({ id: 'lT4Z3j', title: 'Contattaci', fields: [{ id: 'g1', title: 'I tuoi dati', type: 'group', properties: { fields: [{ id: 'f1', title: 'Nome', type: 'short_text' }, { id: 'f2', title: 'Email', type: 'email' }] } }, { id: 'f3', title: 'Richiesta', type: 'long_text' }] }),
    'GET /forms/:id/responses': (p, c, { q }) => ({ total_items: 1, page_count: 1, items: q.get('since') > '2026-10-09T08:00:00Z' ? [] : [{ landing_id: 'tokA', token: 'tokA', response_id: 'tokA', submitted_at: '2026-10-09T08:00:00Z',
      answers: [{ type: 'text', text: 'Rita Sala', field: { id: 'f1', type: 'short_text' } }, { type: 'email', email: 'rita.sala@esempio.it', field: { id: 'f2', type: 'email' } }, { type: 'text', text: 'Un preventivo per due', field: { id: 'f3', type: 'long_text' } }] }] }),
  });
  try {
    await accendi(K, 'typeform', { base: S.url, segreti: { token: 'tfp_prova' }, impostazioni: { moduli: 'lT4Z3j' } });
    assert.equal((await K.chiama('POST', '/api/connettori/typeform/prova')).json.messaggio, 'Studio Bianchi');
    const g = (await K.chiama('POST', '/api/connettori/typeform/giri/risposte')).json; assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { creati: 1, presenti: 0 });
    const x = S.chiamate.find(c => c.percorso.endsWith('/responses')); assert.equal(x.intestazioni.authorization, 'Bearer tfp_prova'); assert.equal(x.q.completed, 'true'); assert.match(x.q.since, /^\d{4}-\d{2}-\d{2}T/);
    const [c] = await righe(K, 'clienti'); assert.equal(c.nome, 'Rita Sala'); assert.match(c.note, /Typeform · modulo «Contattaci»[\s\S]*Richiesta: Un preventivo per due/);
    const ant = (await K.chiama('POST', '/api/connettori/typeform/azioni/leggi_risposte', { args: {}, anteprima: true })).json; assert.deepEqual(ant.righe[0], ['Moduli', 'lT4Z3j']);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/typeform/azioni/leggi_risposte', { args: {} })).json, { creati: 0, presenti: 0 });   // il cursore è andato avanti
    assert.equal((await righe(K, 'clienti')).length, 1);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Tally: Tally-Signature base64 giusta e sbagliata; scelte dagli id ai testi; provenienza «sito»; trovato per telefono', async () => {
  const K = await kubo(['professionista']);
  try {
    await accendi(K, 'tally');
    const s = K.nucleo.segreto('tally', 'segreto');
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Marco Neri', telefono: '+393401234567' });
    const ev = (id, campi) => JSON.stringify({ eventId: id, eventType: 'FORM_RESPONSE', createdAt: '2026-10-09T09:00:00.000Z', data: { responseId: `r-${id}`, submissionId: `r-${id}`, formId: 'mVxQ1a', formName: 'Richiedi un preventivo', createdAt: '2026-10-09T09:00:00.000Z', fields: campi } });
    const prima = ev('e1', [{ key: 'question_1', label: 'Nome e cognome', type: 'INPUT_TEXT', value: 'Sara Galli' }, { key: 'question_2', label: 'Email', type: 'INPUT_EMAIL', value: 'sara.galli@esempio.it' },
      { key: 'question_3', label: 'Che lavoro ti serve?', type: 'DROPDOWN', value: ['o2'], options: [{ id: 'o1', text: 'Sito web' }, { id: 'o2', text: 'Logo e marchio' }] }, { key: 'question_4', label: 'Budget', type: 'INPUT_NUMBER', value: 1500 },
      { key: 'question_5', label: 'Allegato', type: 'FILE_UPLOAD', value: [{ id: 'f', name: 'bozza.pdf', url: 'https://storage.tally.so/bozza.pdf' }] }, { key: 'question_6', label: 'Newsletter', type: 'CHECKBOX', value: false }]);
    assert.equal((await manda(K, '/api/connettori/tally/in', prima, { 'Tally-Signature': firmaHmacDi('sbagliata', prima, 'base64') })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/tally/in', prima, { 'Tally-Signature': firmaHmacDi(s, prima, 'hex') })).stato, 401);
    const r = await manda(K, '/api/connettori/tally/in', prima, { 'Tally-Signature': firmaHmacDi(s, prima, 'base64') });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'cliente creato');
    const sara = (await righe(K, 'clienti')).find(c => c.email === 'sara.galli@esempio.it');
    assert.equal(sara.nome, 'Sara Galli'); assert.equal(sara.provenienza, 'sito');
    assert.match(sara.note, /Tally · modulo «Richiedi un preventivo»/); assert.match(sara.note, /Che lavoro ti serve\?: Logo e marchio/); assert.match(sara.note, /Budget: 1500/); assert.match(sara.note, /Allegato: bozza.pdf/); assert.match(sara.note, /Newsletter: no/);
    const seconda = ev('e2', [{ key: 'q1', label: 'Nome', type: 'INPUT_TEXT', value: 'Marco' }, { key: 'q2', label: 'Telefono', type: 'INPUT_PHONE_NUMBER', value: '+39 340 123 4567' }, { key: 'q3', label: 'Messaggio', type: 'TEXTAREA', value: 'Richiamatemi' }]);
    assert.equal((await manda(K, '/api/connettori/tally/in', seconda, { 'Tally-Signature': firmaHmacDi(s, seconda, 'base64') })).json.esito, 'cliente già presente');
    const tutti = await righe(K, 'clienti'); assert.equal(tutti.length, 2); assert.match(tutti.find(c => c.nome === 'Marco Neri').note, /Richiamatemi/);
    const vuoto = JSON.stringify({ eventId: 'e3', eventType: 'FORM_RESPONSE', data: { responseId: 'r3', fields: [{ label: 'Voto', type: 'RATING', value: 5 }] } });
    assert.equal((await manda(K, '/api/connettori/tally/in', vuoto, { 'Tally-Signature': firmaHmacDi(s, vuoto, 'base64') })).json.esito, 'ignorato: nessun contatto nel modulo');
  } finally { await K.chiudi(); }
});

test('Jotform: codice in fondo all\'indirizzo; multipart con rawRequest → cliente + appuntamento; con la chiave API si rilegge; giro con filter created_at', async () => {
  const K = await kubo(['studio']);
  const risposta = (id, email, creato, tel = '(333) 444-5555') => ({ id, form_id: '242761234567890', created_at: creato, status: 'ACTIVE', answers: {
    1: { name: 'titolo', order: '1', text: 'Prenota', type: 'control_head' },
    3: { name: 'nome', order: '2', text: 'Nome', type: 'control_fullname', answer: { first: 'Luca', last: 'Moretti' }, prettyFormat: 'Luca Moretti' },
    4: { name: 'email', order: '3', text: 'E-mail', type: 'control_email', answer: email },
    5: { name: 'telefono', order: '4', text: 'Telefono', type: 'control_phone', answer: { full: tel }, prettyFormat: tel },
    6: { name: 'appuntamento', order: '5', text: 'Quando vuoi venire?', type: 'control_appointment', answer: { date: '2026-11-03 09:00', duration: '30', timezone: 'Europe/Rome (GMT+01:00)' } },
    7: { name: 'motivo', order: '6', text: 'Motivo della visita', type: 'control_textarea', answer: 'Controllo annuale' } } });
  const S = await finto({
    'GET /submission/:id': p => ({ responseCode: 200, message: 'success', content: risposta(p.id, 'luca.moretti@esempio.it', '2026-10-09 05:00:00') }),
    'GET /form/:id': () => ({ responseCode: 200, content: { id: '242761234567890', title: 'Prenotazioni dal sito' } }),
    'GET /form/:id/submissions': (p, c, { q }) => ({ responseCode: 200, content: JSON.parse(q.get('filter'))['created_at:gt'] >= '2026-10-09 07:00:00' ? []
      : [risposta('5900000000000000002', 'luca.moretti@esempio.it', '2026-10-09 06:00:00'), risposta('5900000000000000003', 'nuova@esempio.it', '2026-10-09 07:00:00', '(345) 000-1111')] }),
    'GET /user': () => ({ responseCode: 200, content: { username: 'studiobianchi', name: 'Studio Bianchi', account_type: 'https://api.jotform.com/system/plan/FREE' } }),
  });
  try {
    await accendi(K, 'jotform', { base: S.url, impostazioni: { indirizzo: 'https://kubo.studiobianchi.it', moduli: '242761234567890' } });
    const codice = K.nucleo.segreto('jotform', 'codice'); assert.ok(codice?.length >= 20);
    assert.equal((await K.chiama('POST', '/api/connettori/jotform/azioni/indirizzo_webhook', {})).json.indirizzo, `https://kubo.studiobianchi.it/api/connettori/jotform/in/${codice}`);
    const raw = { slug: 'submit/242761234567890', q3_nome: { first: 'Luca', last: 'Moretti' }, q4_email: 'luca.moretti@esempio.it', q5_telefono: { full: '(333) 444-5555' },
      q6_quandoVuoi: { month: '11', day: '03', year: '2026', hour: '09', min: '00', ampm: 'AM' }, q7_motivo: 'Controllo annuale', event_id: '1728460000000_242761234567890_abc' };
    const b = '------JotformConfine7MA4YWxkTrZu0gW', parti = { formID: '242761234567890', submissionID: '5900000000000000001', formTitle: 'Prenotazioni dal sito', pretty: 'Nome:Luca Moretti', rawRequest: JSON.stringify(raw) };
    const corpo = Object.entries(parti).map(([n, v]) => `--${b}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`).join('') + `--${b}--\r\n`;
    assert.deepEqual(leggiMultipart(corpo, `multipart/form-data; boundary=${b}`), parti);
    const tipo = { 'Content-Type': `multipart/form-data; boundary=${b}` };
    assert.equal((await manda(K, '/api/connettori/jotform/in/codice-sbagliato', corpo, tipo)).stato, 401);
    assert.equal((await manda(K, '/api/connettori/jotform/in', corpo, tipo)).stato, 401);
    const r = await manda(K, `/api/connettori/jotform/in/${codice}`, corpo, tipo);
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'cliente creato, appuntamento creato');
    assert.equal((await manda(K, `/api/connettori/jotform/in/${codice}`, corpo, tipo)).json.doppione, true);
    let [c] = await righe(K, 'clienti'); assert.equal(c.nome, 'Luca Moretti'); assert.equal(c.telefono, '3334445555'); assert.match(c.note, /motivo: Controllo annuale/);
    const [a] = await righe(K, 'appuntamenti'); assert.equal(a.quando, '2026-11-03T08:00:00.000Z');
    assert.equal(S.chiamate.length, 0);   // senza chiave API nessuna chiamata
    // con la chiave API: il webhook rilegge la risposta (etichette vere), il giro legge le nuove
    await accendi(K, 'jotform', { base: S.url, segreti: { chiave: 'jf-chiave-prova' }, impostazioni: { indirizzo: 'https://kubo.studiobianchi.it', moduli: '242761234567890' } });
    assert.equal(K.nucleo.segreto('jotform', 'codice'), codice);
    assert.equal((await K.chiama('POST', '/api/connettori/jotform/prova')).json.messaggio, 'Studio Bianchi (FREE)');
    const corpo2 = corpo.replace('5900000000000000001', '5900000000000000004');
    assert.equal((await manda(K, `/api/connettori/jotform/in/${codice}`, corpo2, tipo)).json.esito, 'cliente già presente');
    assert.equal(S.chiamate.find(x => x.percorso === '/submission/5900000000000000004').intestazioni.apikey, 'jf-chiave-prova');
    [c] = await righe(K, 'clienti'); assert.match(c.note, /Motivo della visita: Controllo annuale/);
    const g = (await K.chiama('POST', '/api/connettori/jotform/giri/risposte')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { creati: 1, presenti: 1 });
    const q = S.chiamate.find(x => x.percorso.endsWith('/submissions')).q; assert.deepEqual(JSON.parse(q.filter), { 'created_at:gt': '2000-01-01 00:00:00' }); assert.equal(q.orderby, 'created_at');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/jotform/giri/risposte')).json.risultato, { creati: 0, presenti: 0 });   // il cursore è andato avanti
    assert.equal((await righe(K, 'clienti')).length, 2); assert.equal((await righe(K, 'appuntamenti')).length, 2);   // Luca alla stessa ora non si raddoppia; la nuova ha il suo
    assert.deepEqual(risposteGrezze({ q2_email: 'x@y.it', q3_n: { first: 'A', last: 'B' }, altro: 1 }, { fuso: () => 'Europe/Rome' }).map(x => x.tipo), ['email', 'nome']);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Google Ads: google_key a tempo costante (giusta, sbagliata, assente); is_test solo avviso; lead → cliente; lead_id doppione', async () => {
  const K = await kubo(['negozio']);
  try {
    await accendi(K, 'google-ads-lead', { impostazioni: { indirizzo: 'https://kubo.bottega.it' } });
    const chiave = K.nucleo.segreto('google-ads-lead', 'chiave');
    const dati = (await K.chiama('POST', '/api/connettori/google-ads-lead/azioni/indirizzo_webhook', {})).json;
    assert.equal(dati.indirizzo, 'https://kubo.bottega.it/api/connettori/google-ads-lead/in'); assert.equal(dati.chiave, chiave);
    const lead = (id, key, extra = {}) => JSON.stringify({ lead_id: id, api_version: '1.0', form_id: 40000000001, campaign_id: 21000000002, google_key: key, gcl_id: 'EAIaIQobChMI-finto', lead_submit_time: '2026-10-09T10:30:00Z',
      user_column_data: [{ column_id: 'FULL_NAME', column_name: 'Full Name', string_value: 'Paolo Russo' }, { column_id: 'EMAIL', string_value: 'paolo.russo@esempio.it' }, { column_id: 'PHONE_NUMBER', string_value: '+393479998877' },
        { column_id: 'PHONE_NUMBER_VERIFIED', string_value: 'true' }, { column_id: 'CITY', string_value: 'Torino' }, { column_id: 'quale_prodotto_ti_interessa', column_name: 'Quale prodotto ti interessa?', string_value: 'Anelli' }], ...extra });
    assert.equal((await manda(K, '/api/connettori/google-ads-lead/in', lead('L1', 'sbagliata'))).stato, 401);
    assert.equal((await manda(K, '/api/connettori/google-ads-lead/in', lead('L1', chiave + 'x'))).stato, 401);
    assert.equal((await manda(K, '/api/connettori/google-ads-lead/in', JSON.stringify({ lead_id: 'L1' }))).stato, 401);
    const t = await manda(K, '/api/connettori/google-ads-lead/in', lead('T1', chiave, { is_test: true }));
    assert.equal(t.stato, 200); assert.equal(t.json.esito, 'ignorato: lead di prova'); assert.equal((await righe(K, 'clienti')).length, 0);
    assert.ok(K.db.prepare("SELECT 1 FROM _connettori_registro WHERE connettore = 'google-ads-lead' AND esito = 'avviso' AND titolo LIKE '%collegamento funziona%'").get());
    const r = await manda(K, '/api/connettori/google-ads-lead/in', lead('L1', chiave));
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'cliente creato');
    assert.equal((await manda(K, '/api/connettori/google-ads-lead/in', lead('L1', chiave))).json.doppione, true);
    const [c] = await righe(K, 'clienti');
    assert.equal(c.nome, 'Paolo Russo'); assert.equal(c.email, 'paolo.russo@esempio.it'); assert.equal(c.telefono, '+393479998877');
    assert.match(c.note, /Google Ads · modulo «40000000001»/); assert.match(c.note, /Città: Torino/); assert.match(c.note, /Quale prodotto ti interessa\?: Anelli/); assert.match(c.note, /campagna 21000000002/);
    assert.doesNotMatch(c.note, /VERIFIED|true/);
  } finally { await K.chiudi(); }
});

test('Acuity: X-Acuity-Signature giusta e sbagliata; scheduled → appuntamento (rilettura Basic), rescheduled sposta, canceled annulla; giro e webhook registrati', async () => {
  const K = await kubo(['studio']); const app = { id: 1001, firstName: 'Chiara', lastName: 'Fontana', email: 'chiara.fontana@esempio.it', phone: '3471112233', datetime: '2026-10-21T10:00:00+0200',
    type: 'Prima visita', calendar: 'Dott.ssa Bianchi', notes: 'Prima volta', canceled: false, forms: [{ id: 1, name: 'Anamnesi', values: [{ fieldID: 1, name: 'Allergie', value: 'Penicillina' }, { fieldID: 2, name: 'Vuoto', value: '' }] }] };
  const iscritti = [];
  const S = await finto({
    'GET /api/v1/me': () => ({ id: 123456, email: 'studio@esempio.it', name: 'Studio Bianchi', timezone: 'Europe/Rome' }),
    'GET /api/v1/appointments/:id': p => (p.id === '1001' ? app : { stato: 404, corpo: { status_code: 404, message: 'Appointment not found.', error: 'not_found' } }),
    'GET /api/v1/appointments': (p, c, { q }) => (q.get('canceled') === 'true' ? [] : [app, { ...app, canceled: false, id: 1002, email: 'altro@esempio.it', phone: '3489990000', firstName: 'Ugo', lastName: 'Riva', datetime: '2026-10-22T09:00:00+0200', forms: [] }]),
    'POST /api/v1/webhooks': (p, c) => { iscritti.push(c); return { id: iscritti.length, ...c, status: 'active' }; },
  });
  try {
    await accendi(K, 'acuity', { base: S.url, segreti: { chiave: 'acuity-chiave-api' }, impostazioni: { utente: '123456', indirizzo: 'https://kubo.studiobianchi.it' } });
    assert.equal((await K.chiama('POST', '/api/connettori/acuity/prova')).json.messaggio, 'Studio Bianchi (Europe/Rome)');
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Basic ' + Buffer.from('123456:acuity-chiave-api').toString('base64'));
    const avvisa = async azione => { const corpo = `action=${azione}&id=1001&calendarID=7&appointmentTypeID=9`;
      return manda(K, '/api/connettori/acuity/in', corpo, { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Acuity-Signature': firmaHmacDi('acuity-chiave-api', corpo, 'base64') }); };
    const corpo = 'action=scheduled&id=1001&calendarID=7&appointmentTypeID=9';
    assert.equal((await manda(K, '/api/connettori/acuity/in', corpo, { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Acuity-Signature': firmaHmacDi('altra', corpo, 'base64') })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/acuity/in', corpo, { 'Content-Type': 'application/x-www-form-urlencoded' })).stato, 401);
    let r = await avvisa('scheduled'); assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'creato');
    const [c] = await righe(K, 'clienti'); assert.equal(c.nome, 'Chiara Fontana'); assert.equal(c.email, 'chiara.fontana@esempio.it');
    let [a] = await righe(K, 'appuntamenti'); assert.equal(a.quando, '2026-10-21T08:00:00.000Z'); assert.match(a.note, /Acuity: Prima visita · Dott.ssa Bianchi/); assert.match(a.note, /Allergie: Penicillina/); assert.doesNotMatch(a.note, /Vuoto/);
    app.datetime = '2026-10-23T15:00:00+0200';
    assert.equal((await avvisa('rescheduled')).json.esito, 'spostato');
    [a] = await righe(K, 'appuntamenti'); assert.equal(a.quando, '2026-10-23T13:00:00.000Z');
    assert.equal((await avvisa('canceled')).json.esito, 'annullato');
    [a] = await righe(K, 'appuntamenti'); assert.equal(a.stato, 'annullato');
    app.canceled = true;   // il giro: la nuova di Ugo entra, quella annullata resta annullata
    const g = (await K.chiama('POST', '/api/connettori/acuity/giri/appuntamenti')).json; assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.equal(g.risultato.creati, 1, JSON.stringify(g));
    assert.equal((await righe(K, 'appuntamenti')).length, 2); assert.equal((await righe(K, 'clienti')).length, 2);
    const w = (await K.chiama('POST', '/api/connettori/acuity/azioni/registra_webhook', { args: {} })).json;
    assert.deepEqual(w.webhook, [1, 2, 3]); assert.deepEqual(iscritti.map(x => x.event), ['appointment.scheduled', 'appointment.rescheduled', 'appointment.canceled']);
    assert.equal(iscritti[0].target, 'https://kubo.studiobianchi.it/api/connettori/acuity/in');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Jitsi: stanza lunga e casuale; crea_riunione con anteprima scrive il link nelle note (una volta sola); «automatico» per gli appuntamenti nuovi; server proprio', async () => {
  const K = await kubo(['studio']);
  try {
    const x = stanza('Studio Rossi!'), y = stanza(); assert.match(x, /^studiorossi-[a-z2-9]{24}$/); assert.notEqual(stanza(), y);
    await accendi(K, 'jitsi', { impostazioni: { prefisso: 'studiobianchi' } });
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Elena Rossi' })).json;
    const a = (await K.chiama('POST', '/api/dati/appuntamenti', { quando: '2026-10-15T14:00:00.000Z', cliente: cl.id, note: 'Portare gli esami' })).json;
    await coda(K); assert.equal((await K.chiama('GET', `/api/dati/appuntamenti/${a.id}`)).json.note, 'Portare gli esami');   // automatico spento
    const ant = (await K.chiama('POST', '/api/connettori/jitsi/azioni/crea_riunione', { args: { appuntamento: a.id }, anteprima: true })).json;
    assert.deepEqual(ant.righe[2], ['Server', 'https://meet.jit.si']); assert.ok(ant.avvisi.some(v => /Google, GitHub o Facebook/.test(v)));
    const r = (await K.chiama('POST', '/api/connettori/jitsi/azioni/crea_riunione', { args: { appuntamento: a.id } })).json;
    assert.match(r.link, /^https:\/\/meet\.jit\.si\/studiobianchi-[a-z2-9]{24}$/);
    const n = (await K.chiama('GET', `/api/dati/appuntamenti/${a.id}`)).json.note; assert.equal(n, `Portare gli esami\nVideochiamata Jitsi: ${r.link}`);
    const di = (await K.chiama('POST', '/api/connettori/jitsi/azioni/crea_riunione', { args: { appuntamento: a.id } })).json; assert.deepEqual(di, { link: r.link, gia: true });
    // automatico e server proprio: ogni appuntamento nuovo prende il link da solo
    await accendi(K, 'jitsi', { impostazioni: { automatico: true, server: 'https://video.studiobianchi.it/' } });
    const b = (await K.chiama('POST', '/api/dati/appuntamenti', { quando: '2026-10-16T09:00:00.000Z', cliente: cl.id })).json;
    await coda(K);
    const nb = (await K.chiama('GET', `/api/dati/appuntamenti/${b.id}`)).json.note; assert.match(nb, /^Videochiamata Jitsi: https:\/\/video\.studiobianchi\.it\/studiobianchi-[a-z2-9]{24}$/);
    await K.chiama('PATCH', `/api/dati/appuntamenti/${b.id}`, { quando: '2026-10-17T09:00:00.000Z' }); await coda(K);
    assert.equal((await K.chiama('GET', `/api/dati/appuntamenti/${b.id}`)).json.note, nb);   // spostato: il link resta quello
  } finally { await K.chiudi(); }
});

test('moduli e prenotazioni: il contratto del catalogo e le traduzioni nelle sei lingue', async () => {
  const CHIAVI = ['categoria', 'sito', 'costo', 'costoNota', 'serve', 'passi', 'difficolta', 'zone', 'fonti', 'prova', 'parole'];
  for (const id of ['typeform', 'tally', 'jotform', 'google-ads-lead', 'acuity', 'jitsi']) {
    const m = (await import(`../connettori/${id}/connettore.js`)).default, c = m.catalogo;
    assert.equal(m.id, id); assert.deepEqual(CHIAVI.filter(x => c[x] == null), [], id);
    assert.ok(['marketing', 'prenotazioni', 'calendario'].includes(c.categoria), id);
    assert.ok(['gratis', 'a-consumo', 'abbonamento', 'contratto'].includes(c.costo) && ['facile', 'media', 'difficile'].includes(c.difficolta), id);
    assert.ok(c.passi.length >= 3 && c.passi.length <= 8, id); assert.ok(c.serve.every(s => s.cosa && s.dove && /^https:\/\//.test(s.link)), id);
    assert.ok(c.fonti.length && c.fonti.every(f => /^https:\/\//.test(f)) && /^https:\/\//.test(c.sito) && c.prova === 'finto', id);
    const en = m.testi.en; assert.equal(typeof en['cat.costoNota'], 'string', id);
    assert.equal(en['cat.passi'].length, c.passi.length, id); assert.equal(en['cat.serve'].length, c.serve.length, id);
    const brevi = ['nome', 'descrizione', ...(m.impostazioni || []).map(i => `imp.${i.id}`), ...Object.keys(m.azioni || {}).map(a => `az.${a}`), ...Object.keys(m.pianificati || {}).map(g => `giro.${g}`)];
    for (const l of ['en', 'es', 'fr', 'de', 'pt']) assert.deepEqual(brevi.filter(x => !m.testi[l]?.[x]), [], `${id} ${l}`);
  }
});
