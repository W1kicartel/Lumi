// I connettori di attività, CRM e newsletter (Todoist, Trello, Asana, Pipedrive, MailerLite, Baserow) contro finti
// servizi locali: niente rete vera, dati inventati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, gestionale, accendi } from './connettori-finto.mjs';
import { coda } from './connettori-comunica-coda.mjs';

const pausa = ms => new Promise(r => setTimeout(r, ms));

test('Todoist: Lumi crea il compito con la scadenza a parole nel progetto chiesto; un\'attività nuova diventa un compito una volta sola', async () => {
  const K = await gestionale(['professionista']); let n = 0;
  const S = await finto({
    'GET /api/v1/projects': () => ({ results: [{ id: '6Jf8VQXxpwv56VQ7', name: 'Lavoro' }, { id: '6Jf8VQXxpwv56VQ8', name: 'Casa' }], next_cursor: null }),
    'POST /api/v1/tasks': (p, c) => ({ id: `t${++n}`, content: c.content, due: c.due_date ? { date: c.due_date } : { date: '2026-10-16', string: c.due_string }, url: `https://app.todoist.com/app/task/t${n}` }),
  });
  try {
    await accendi(K, 'todoist', { base: S.url, segreti: { token: '0123456789abcdef0123456789abcdef01234567' }, impostazioni: { da_attivita: true, pubblico: 'https://lumi.bottega.it' } });
    assert.equal((await K.chiama('POST', '/api/connettori/todoist/prova')).json.messaggio, '2 progetti');
    const args = { contenuto: 'Chiamare Rossi', scadenza: 'venerdì', progetto: 'lavoro' };
    const ant = (await K.chiama('POST', '/api/connettori/todoist/azioni/crea_compito', { args, anteprima: true })).json;
    assert.deepEqual(ant.righe.find(r => r[0] === 'Scadenza'), ['Scadenza', 'venerdì']); assert.deepEqual(ant.avvisi, []);
    const a = (await K.chiama('POST', '/api/connettori/todoist/azioni/crea_compito', { args })).json;
    assert.equal(a.ok, true); assert.equal(a.id, 't1'); assert.equal(a.scadenza, '2026-10-16');
    const t = S.chiamate.find(c => c.metodo === 'POST');
    assert.deepEqual(t.corpo, { content: 'Chiamare Rossi', due_string: 'venerdì', due_lang: 'it', project_id: '6Jf8VQXxpwv56VQ7' });
    assert.equal(t.intestazioni.authorization, 'Bearer 0123456789abcdef0123456789abcdef01234567');
    // un progetto che non c'è: errore chiaro, nessun compito
    const x = await K.chiama('POST', '/api/connettori/todoist/azioni/crea_compito', { args: { contenuto: 'Prova', progetto: 'Ufficio' } });
    assert.equal(x.stato, 502); assert.match(JSON.stringify(x.json), /Ufficio/);
    // un'attività nuova → un compito con data esatta, note e link alla riga; modificarla non ne crea un altro
    const riga = (await K.chiama('POST', '/api/dati/attivita', { titolo: 'Preparare l\'offerta', scadenza: '2026-10-20', note: 'Per lo studio Bianchi' })).json;
    await coda(K);
    const u = S.chiamate.filter(c => c.metodo === 'POST' && c.percorso === '/api/v1/tasks').at(-1).corpo;
    assert.equal(u.content, 'Preparare l\'offerta'); assert.equal(u.due_date, '2026-10-20'); assert.equal(u.due_string, undefined);
    assert.match(u.description, /Per lo studio Bianchi/); assert.ok(u.description.includes(`https://lumi.bottega.it/#/e/attivita/${riga.id}`));
    assert.equal(K.nucleo.k('todoist').sincro.remoto('attivita', riga.id), 't2');
    await K.chiama('PATCH', `/api/dati/attivita/${riga.id}`, { note: 'cambiata' }); await coda(K);
    assert.equal(S.chiamate.filter(c => c.percorso === '/api/v1/tasks').length, 2);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Trello: un intervento nuovo dell\'officina diventa una scheda con il link alla riga; Lumi crea una scheda con la scadenza', async () => {
  const K = await gestionale(['officina']); let n = 0;
  const S = await finto({
    'GET /1/lists/:id': p => ({ id: p.id, name: 'Officina' }),
    'POST /1/cards': () => ({ id: `card${++n}`, shortUrl: `https://trello.com/c/abc${n}` }),
  });
  try {
    const chiave = '0123456789abcdef0123456789abcdef', token = 'ATTA' + 'a1b2c3d4'.repeat(9), lista = '5f1e2d3c4b5a69788796a5b4';
    await accendi(K, 'trello', { base: S.url, segreti: { chiave, token }, impostazioni: { lista, da_interventi: true, pubblico: 'https://lumi.officina.it/' } });
    assert.equal((await K.chiama('POST', '/api/connettori/trello/prova')).json.messaggio, 'Lista «Officina»');
    const auth = S.chiamate[0].intestazioni.authorization;
    assert.equal(auth, `OAuth oauth_consumer_key="${chiave}", oauth_token="${token}"`); assert.deepEqual(S.chiamate[0].q, { fields: 'name' });   // i segreti non stanno nell'indirizzo
    const cli = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Mario Rossi', telefono: '+39 333 1234567' })).json;
    const mezzo = (await K.chiama('POST', '/api/dati/mezzi', { targa: 'AB123CD', tipo: 'auto', marca: 'Fiat', cliente: cli.id })).json;
    const int = (await K.chiama('POST', '/api/dati/interventi', { mezzo: mezzo.id, cliente: cli.id, problema: 'Rumore ai freni anteriori', consegna_prevista: '2026-10-15' })).json;
    assert.ok(int.id, JSON.stringify(int));
    await coda(K);
    const c = S.chiamate.find(x => x.metodo === 'POST').corpo;
    assert.equal(c.idList, lista); assert.match(c.name, /^Intervento .*AB123CD/); assert.equal(c.due, '2026-10-15');
    assert.match(c.desc, /Cliente: Mario Rossi/); assert.match(c.desc, /Rumore ai freni/);
    assert.equal(c.urlSource, `https://lumi.officina.it/#/e/interventi/${int.id}`);
    await K.chiama('PATCH', `/api/dati/interventi/${int.id}`, { lavoro_fatto: 'Pastiglie cambiate' }); await coda(K);
    assert.equal(S.chiamate.filter(x => x.metodo === 'POST').length, 1);
    const ant = (await K.chiama('POST', '/api/connettori/trello/azioni/crea_compito', { args: { nome: 'Ordinare le pastiglie', scadenza: '15/10/2026' }, anteprima: true })).json;
    assert.deepEqual(ant.righe.find(r => r[0] === 'Scadenza'), ['Scadenza', '2026-10-15']);
    const a = (await K.chiama('POST', '/api/connettori/trello/azioni/crea_compito', { args: { nome: 'Ordinare le pastiglie', scadenza: '15/10/2026' } })).json;
    assert.deepEqual(a, { ok: true, id: 'card2', link: 'https://trello.com/c/abc2' });
    assert.deepEqual(S.chiamate.at(-1).corpo, { idList: lista, name: 'Ordinare le pastiglie', pos: 'top', due: '2026-10-15' });
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Asana: compito nel progetto con due_on; con la sezione spenta le attività non partono', async () => {
  const K = await gestionale(['professionista']);
  const S = await finto({
    'GET /api/1.0/users/me': () => ({ data: { gid: '1', name: 'Titolare' } }),
    'POST /api/1.0/tasks': (p, c) => ({ data: { gid: '1209000000000001', name: c.data.name, permalink_url: 'https://app.asana.com/0/1209876543210/1209000000000001' } }),
  });
  try {
    await accendi(K, 'asana', { base: S.url, segreti: { token: '2/1209999999999/1209888888888:0123456789abcdef0123456789abcdef' }, impostazioni: { progetto: '1209876543210' } });
    assert.equal((await K.chiama('POST', '/api/connettori/asana/prova')).json.messaggio, 'Collegato come Titolare');
    await K.chiama('POST', '/api/dati/attivita', { titolo: 'Rinnovo dominio' }); await coda(K);
    assert.equal(S.chiamate.filter(c => c.metodo === 'POST').length, 0);   // «da_attivita» spento
    const a = (await K.chiama('POST', '/api/connettori/asana/azioni/crea_compito', { args: { nome: 'Preparare l\'offerta per Bianchi', note: 'Sito e logo', scadenza: '2026-10-15' } })).json;
    assert.deepEqual(a, { ok: true, id: '1209000000000001', link: 'https://app.asana.com/0/1209876543210/1209000000000001' });
    const p = S.chiamate.find(c => c.metodo === 'POST');
    assert.deepEqual(p.corpo, { data: { name: 'Preparare l\'offerta per Bianchi', notes: 'Sito e logo', due_on: '2026-10-15', projects: ['1209876543210'] } });
    assert.equal(p.intestazioni.authorization, 'Bearer 2/1209999999999/1209888888888:0123456789abcdef0123456789abcdef');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Pipedrive: cliente con P.IVA → organizzazione + persona, poi PATCH; giro delle persone in Lumi senza eco; preventivo → trattativa', async () => {
  const K = await gestionale(['professionista']); let np = 100;
  const S = await finto({
    'GET /api/v1/users/me': () => ({ data: { name: 'Titolare', company_name: 'Bottega' } }),
    'GET /api/v2/persons/search': () => ({ success: true, data: { items: [] } }),
    'POST /api/v2/organizations': () => ({ success: true, data: { id: 77 } }),
    'POST /api/v2/persons': () => ({ success: true, data: { id: ++np } }),
    'PATCH /api/v2/persons/:id': p => ({ success: true, data: { id: Number(p.id) } }),
    'PATCH /api/v2/organizations/:id': p => ({ success: true, data: { id: Number(p.id) } }),
    'GET /api/v2/persons': () => ({ success: true, data: [{ id: 500, name: 'Marta Neri', emails: [{ value: 'marta@esempio.it', primary: true, label: 'work' }], phones: [{ value: '+39 333 2222222', primary: true }], update_time: '2026-10-01T10:00:00Z' }], additional_data: { next_cursor: null } }),
    'POST /api/v2/deals': () => ({ success: true, data: { id: 900 } }),
  });
  try {
    await accendi(K, 'pipedrive', { base: S.url, segreti: { token: 'abcdef0123456789abcdef0123456789abcdef01' }, impostazioni: { dominio: 'bottega' } });
    assert.equal((await K.chiama('POST', '/api/connettori/pipedrive/prova')).json.messaggio, 'Collegato come Titolare (Bottega)');
    assert.equal(S.chiamate[0].intestazioni['x-api-token'], 'abcdef0123456789abcdef0123456789abcdef01');
    const cli = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Studio Bianchi', email: 'Info@Bianchi.example', piva: '01234567890' })).json;
    await coda(K);
    assert.deepEqual(S.chiamate.find(c => c.metodo === 'POST' && c.percorso === '/api/v2/organizations').corpo, { name: 'Studio Bianchi' });
    assert.equal(S.chiamate.find(c => c.percorso === '/api/v2/persons/search').q.term, 'info@bianchi.example');
    const pers = S.chiamate.find(c => c.metodo === 'POST' && c.percorso === '/api/v2/persons').corpo;
    assert.deepEqual(pers, { name: 'Studio Bianchi', emails: [{ value: 'info@bianchi.example', primary: true, label: 'work' }], org_id: 77 });
    await K.chiama('PATCH', `/api/dati/clienti/${cli.id}`, { telefono: '+39 02 1234567' }); await coda(K);
    const patch = S.chiamate.find(c => c.metodo === 'PATCH' && c.percorso === '/api/v2/persons/101');
    assert.deepEqual(patch.corpo.phones, [{ value: '+39 02 1234567', primary: true, label: 'work' }]);
    // Pipedrive → Lumi
    const g = (await K.chiama('POST', '/api/connettori/pipedrive/giri/persone')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { creati: 1, aggiornati: 0, uguali: 0 });
    const marta = (await K.chiama('GET', '/api/dati/clienti?perPagina=50')).json.righe.find(r => r.email === 'marta@esempio.it');
    assert.equal(marta.nome, 'Marta Neri'); assert.equal(marta.telefono, '+39 333 2222222');
    await coda(K);
    assert.equal(S.chiamate.filter(c => c.metodo === 'POST' && c.percorso === '/api/v2/persons').length, 1);   // niente eco
    const g2 = (await K.chiama('POST', '/api/connettori/pipedrive/giri/persone')).json;
    assert.deepEqual(g2.risultato, { creati: 0, aggiornati: 0, uguali: 1 });
    assert.equal(S.chiamate.filter(c => c.metodo === 'GET' && c.percorso === '/api/v2/persons').at(-1).q.updated_since, '2026-10-01T10:00:00Z');
    // un preventivo diventa una trattativa
    const prev = (await K.chiama('POST', '/api/dati/preventivi', { cliente: cli.id, oggetto: 'Sito nuovo', valido_fino: '2026-11-30' })).json;
    const ant = (await K.chiama('POST', '/api/connettori/pipedrive/azioni/crea_trattativa', { args: { preventivo: prev.id }, anteprima: true })).json;
    assert.match(ant.righe[0][1], /Sito nuovo/); assert.deepEqual(ant.avvisi, []);
    const a = (await K.chiama('POST', '/api/connettori/pipedrive/azioni/crea_trattativa', { args: { preventivo: prev.id } })).json;
    assert.deepEqual(a, { ok: true, id: 900, aggiornata: false, link: 'https://bottega.pipedrive.com/deal/900' });
    const d = S.chiamate.find(c => c.percorso === '/api/v2/deals').corpo;
    assert.match(d.title, /^Preventivo .* · Sito nuovo$/); assert.equal(d.currency, 'EUR'); assert.equal(d.person_id, 101); assert.equal(d.org_id, 77); assert.equal(typeof d.value, 'number'); assert.equal(d.expected_close_date, '2026-11-30');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('MailerLite: solo i clienti con il consenso, nel gruppo; i disiscritti perdono il consenso; consenso tolto in Lumi → unsubscribed', async () => {
  const K = await gestionale(['studio']); let n = 0;
  const S = await finto({
    'GET /api/groups': () => ({ data: [{ id: '123456789', name: 'Clienti Lumi' }] }),
    'POST /api/subscribers': (p, c) => ({ data: { id: `s${++n}`, email: c.email, status: c.status || 'active' } }),
    'GET /api/subscribers': (p, c, { q }) => (q.get('filter[status]') === 'unsubscribed' ? { data: [{ id: 's1', email: 'anna@esempio.it', status: 'unsubscribed', unsubscribed_at: '2026-10-08 10:00:00' }], meta: { next_cursor: null } } : { data: [] }),
  });
  try {
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Maria Bianchi', email: 'Anna@Esempio.it', telefono: '+39 333 1111111', consenso: true });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Luca Verdi', email: 'luca@esempio.it', consenso: false });
    await accendi(K, 'mailerlite', { base: S.url, segreti: { token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.finto.0123456789abcdef' }, impostazioni: { gruppo: '123456789' } });
    assert.equal((await K.chiama('POST', '/api/connettori/mailerlite/prova')).json.messaggio, 'Gruppo «Clienti Lumi»');
    const g = (await K.chiama('POST', '/api/connettori/mailerlite/giri/sincronizza')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { iscritti: 1, saltati: 1, disiscritti: 1 });
    const iscr = S.chiamate.filter(c => c.metodo === 'POST');
    assert.equal(iscr.length, 1);
    assert.deepEqual(iscr[0].corpo, { email: 'anna@esempio.it', fields: { name: 'Anna', last_name: 'Maria Bianchi', phone: '+39 333 1111111' }, groups: ['123456789'] });
    assert.equal(iscr[0].intestazioni.authorization, 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.finto.0123456789abcdef');
    const anna = (await K.chiama('GET', '/api/dati/clienti?perPagina=50')).json.righe.find(r => r.nome === 'Anna Maria Bianchi');
    assert.equal(anna.consenso, false);
    await coda(K); assert.equal(S.chiamate.filter(c => c.metodo === 'POST').length, 1);   // il consenso tolto da MailerLite non torna indietro
    // in Lumi: un cliente nuovo con il consenso va subito; poi il consenso tolto lo disiscrive
    const carla = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Carla Neri', email: 'carla@esempio.it', consenso: true })).json; await coda(K);
    assert.equal(S.chiamate.filter(c => c.metodo === 'POST').at(-1).corpo.email, 'carla@esempio.it');
    await K.chiama('PATCH', `/api/dati/clienti/${carla.id}`, { consenso: false }); await coda(K);
    assert.deepEqual(S.chiamate.filter(c => c.metodo === 'POST').at(-1).corpo, { email: 'carla@esempio.it', status: 'unsubscribed' });
    const g2 = (await K.chiama('POST', '/api/connettori/mailerlite/giri/sincronizza')).json;
    assert.equal(g2.risultato.disiscritti, 0);   // Anna è già senza consenso
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Baserow: righe nuove a lotti con user_field_names, solo le colonne scrivibili con lo stesso nome; poi PATCH delle cambiate', async () => {
  const K = await gestionale(['studio']); let n = 0; const lotti = [];
  const S = await finto({
    'GET /api/database/fields/table/:id/': () => [{ id: 1, name: 'Nome', type: 'text', primary: true }, { id: 2, name: 'Email', type: 'email' }, { id: 3, name: 'Data di nascita', type: 'date' }, { id: 4, name: 'Consenso al trattamento', type: 'boolean' }, { id: 5, name: 'Lumi ID', type: 'text' }, { id: 6, name: 'Telefono', type: 'formula', read_only: true }],
    'POST /api/database/rows/table/:id/batch/': (p, c) => { lotti.push(['POST', c]); return { items: c.items.map(x => ({ id: ++n, ...x })) }; },
    'PATCH /api/database/rows/table/:id/batch/': (p, c) => { lotti.push(['PATCH', c]); return { items: c.items }; },
  });
  try {
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', email: 'anna@esempio.it', nascita: '1990-05-04', consenso: true, telefono: '+39 333 1111111' });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Luca Verdi' });
    await accendi(K, 'baserow', { base: S.url, segreti: { token: 'Abcdefghijklmnopqrstuvwxyz012345' }, impostazioni: { tabella: '42', sezione: 'clienti' } });
    assert.match((await K.chiama('POST', '/api/connettori/baserow/prova')).json.messaggio, /^6 colonne: Nome, Email/);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Token Abcdefghijklmnopqrstuvwxyz012345');
    const g = (await K.chiama('POST', '/api/connettori/baserow/giri/sincronizza')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { creati: 2, aggiornati: 0, campi: 4 });
    const post = S.chiamate.find(c => c.metodo === 'POST');
    assert.equal(post.percorso, '/api/database/rows/table/42/batch/'); assert.equal(post.q.user_field_names, 'true');
    const anna = post.corpo.items.find(x => x.Nome === 'Anna Bianchi');
    assert.deepEqual(Object.keys(anna).sort(), ['Consenso al trattamento', 'Data di nascita', 'Email', 'Lumi ID', 'Nome']);   // «Telefono» è una formula: non si scrive
    assert.equal(anna['Data di nascita'], '1990-05-04'); assert.equal(anna['Consenso al trattamento'], true);
    assert.equal(post.corpo.items.find(x => x.Nome === 'Luca Verdi').Email, null);
    assert.equal((await K.chiama('POST', '/api/connettori/baserow/giri/sincronizza')).json.risultato.creati, 0);   // niente di nuovo
    const uno = (await K.chiama('GET', '/api/dati/clienti?perPagina=50')).json.righe.find(r => r.nome === 'Luca Verdi');
    await pausa(5); await K.chiama('PATCH', `/api/dati/clienti/${uno.id}`, { email: 'luca@esempio.it' });
    const g2 = (await K.chiama('POST', '/api/connettori/baserow/giri/sincronizza')).json;
    assert.deepEqual(g2.risultato, { creati: 0, aggiornati: 1, campi: 4 });
    const [metodo, corpo] = lotti.at(-1);
    assert.equal(metodo, 'PATCH'); assert.equal(corpo.items.length, 1); assert.equal(corpo.items[0].Email, 'luca@esempio.it');
    assert.equal(String(corpo.items[0].id), K.nucleo.k('baserow').sincro.remoto(K.nucleo.k('baserow').entita('clienti'), uno.id));
  } finally { await K.chiudi(); await S.chiudi(); }
});
