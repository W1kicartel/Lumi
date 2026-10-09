// La libreria delle integrazioni e gli attrezzi per smanettoni: il catalogo (ricerca, filtri, conti), il connettore
// HTTP / API REST con le ricette (uscita, azione con anteprima, entrata con codice e HMAC), i ponti verso le piattaforme di
// automazione, i filtri del browser. Tutto contro finti servizi locali: nessuna chiamata vera in rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';
import { filtra, conta, iniziali, tinta, statoVoce, normalizza } from '../web/libreria.js';
import { corpoDi, riempi, controllaRicette, permessiRicette } from '../server/moduli/connettori-ricette.js';
import { firma as firmaKubo } from '../server/moduli/import-api.js';

const aspetta = async (f, ms = 3000) => { const t0 = Date.now(); for (;;) { const x = await f(); if (x) return x; if (Date.now() - t0 > ms) return x; await new Promise(r => setTimeout(r, 25)); } };

test('libreria: catalogo con ricerca, filtri e conti per categoria; solo il titolare; viste con il blocco catalogo', async () => {
  const K = await kubo();
  try {
    const tutto = (await K.chiama('GET', '/api/connettori/catalogo')).json;
    assert.ok(tutto.totale >= 13, JSON.stringify(tutto).slice(0, 200));
    assert.equal(tutto.categorie.tutte, tutto.voci.length);
    const stripe = tutto.voci.find(v => v.id === 'stripe');
    assert.equal(stripe.catalogo.categoria, 'pagamenti'); assert.equal(stripe.catalogo.prova, 'finto'); assert.ok(!('passi' in stripe.catalogo));   // le carte sono leggere
    assert.ok(tutto.categorie.automazione >= 6);
    // ricerca senza accenti e su parole chiave, nome e descrizione; anche in inglese
    assert.deepEqual((await K.chiama('GET', '/api/connettori/catalogo?q=fatturazione%20elettronica')).json.voci.map(v => v.id), ['openapi-sdi']);
    assert.ok((await K.chiama('GET', '/api/connettori/catalogo?q=zap')).json.voci.some(v => v.id === 'zapier'));
    assert.ok((await K.chiama('GET', '/api/connettori/catalogo?q=online%20shop')).json.voci.some(v => v.id === 'woocommerce'));
    // filtri: i conti per categoria seguono la ricerca e gli altri filtri, non la categoria scelta
    const gratis = (await K.chiama('GET', '/api/connettori/catalogo?costo=gratis&categoria=automazione')).json;
    assert.ok(gratis.voci.every(v => v.catalogo.costo === 'gratis' && v.catalogo.categoria === 'automazione'));
    assert.ok(!gratis.voci.some(v => v.id === 'zapier'));
    assert.ok(gratis.categorie['negozi-online'] >= 1);   // WooCommerce è gratis
    const it = (await K.chiama('GET', '/api/connettori/catalogo?zona=IT&difficolta=facile')).json.voci;
    assert.ok(it.length && it.every(v => v.catalogo.zone.includes('IT') && v.catalogo.difficolta === 'facile'));
    // la pagina del connettore: guida, credenziali con i link, fonti; in inglese per chi usa l'inglese
    const pag = (await K.chiama('GET', '/api/connettori/stripe')).json.catalogo;
    assert.ok(pag.passi.length >= 3 && pag.serve[0].link.startsWith('https://') && pag.fonti.length);
    assert.equal((await K.chiama('PUT', '/api/lingua', { lingua: 'en' })).stato, 200);
    const en = (await K.chiama('GET', '/api/connettori/stripe')).json.catalogo;
    assert.match(en.passi[0], /Stripe Dashboard/); assert.equal(en.serve[0].link, pag.serve[0].link); assert.match(en.costoNota, /European cards/);
    // es: la guida non è tradotta, si ripiega sull'inglese; la descrizione invece c'è
    await K.chiama('PUT', '/api/lingua', { lingua: 'es' });
    const es = (await K.chiama('GET', '/api/connettori/catalogo?q=stripe')).json.voci[0];
    assert.match(es.descrizione, /Pagos/); assert.match((await K.chiama('GET', '/api/connettori/stripe')).json.catalogo.passi[0], /Stripe Dashboard/);
    // un collaboratore non sfoglia la libreria
    await K.chiama('POST', '/api/utenti', { nome: 'Commessa', email: 'commessa@esempio.it', password: 'password-lunga', ruolo: 'collaboratore' });
    await K.chiama('POST', '/api/esci'); await K.chiama('POST', '/api/accedi', { email: 'commessa@esempio.it', password: 'password-lunga' });
    assert.equal((await K.chiama('GET', '/api/connettori/catalogo')).stato, 403);
  } finally { await K.chiudi(); }
});

test('libreria nel browser: filtri, conti, monogrammi e stati senza richieste', () => {
  const voci = [
    { id: 'stripe', nome: 'Stripe', descrizione: 'Pagamenti online', attivo: true, mancano: [], catalogo: { categoria: 'pagamenti', costo: 'a-consumo', difficolta: 'media', zone: ['IT', 'UE'], parole: ['carta'] } },
    { id: 'posta', nome: 'Email e PEC', descrizione: 'Fatture per email', attivo: true, mancano: ['Password'], catalogo: { categoria: 'email', costo: 'gratis', difficolta: 'facile', zone: ['IT'] } },
    { id: 'x', nome: 'Città', descrizione: '', catalogo: null },
  ];
  assert.deepEqual(filtra(voci, { q: 'CARTA' }).map(v => v.id), ['stripe']);
  assert.deepEqual(filtra(voci, { q: 'citta' }).map(v => v.id), ['x']);
  assert.deepEqual(filtra(voci, { costo: 'gratis', zona: 'IT' }).map(v => v.id), ['posta']);
  assert.deepEqual(conta(voci), { tutte: 3, pagamenti: 1, email: 1, altro: 1 });
  assert.equal(iniziali('Email e PEC'), 'EE'); assert.equal(iniziali('Stripe'), 'ST'); assert.equal(iniziali('HTTP / API REST'), 'HA'); assert.equal(iniziali(''), '?');
  assert.equal(tinta('stripe'), tinta('stripe')); assert.ok(tinta('stripe') >= 0 && tinta('stripe') < 360);
  assert.deepEqual(voci.map(statoVoce), ['acceso', 'da-configurare', 'spento']);
  assert.equal(normalizza('Perché'), 'perche');
});

test('ricette: segnaposto nel percorso e nel corpo, tipi conservati, controllo delle ricette', () => {
  const v = { id: 'r1', nome: 'Anna Bianchi', email: 'anna@esempio.it', totale: 12.5, cliente: { id: 'c1', titolo: 'Bottega' }, consenso: true };
  const campi = [{ id: 'nome', nome: 'Nome e cognome' }];
  assert.equal(riempi('/contatti/{id}?e={email}', v, campi, true), '/contatti/r1?e=anna%40esempio.it');
  assert.equal(riempi('Ciao {Nome e cognome} di {cliente}', v, campi), 'Ciao Anna Bianchi di Bottega');
  assert.deepEqual(corpoDi('{"n":"{nome}","t":"{totale}","ok":"{consenso}","c":"{cliente.titolo}","x":"{manca}","s":"A {email}"}', v).json,
    { n: 'Anna Bianchi', t: 12.5, ok: true, c: 'Bottega', x: null, s: 'A anna@esempio.it' });
  assert.deepEqual(corpoDi('', v).json, v);
  assert.equal(corpoDi('nome={nome}', v).testo, 'nome=Anna Bianchi');
  assert.throws(() => controllaRicette([{ tipo: 'uscita', sezione: 'clienti', percorso: 'contatti' }]), /inizia con/);
  assert.throws(() => controllaRicette([{ tipo: 'uscita', sezione: 'clienti', percorso: 'http://127.0.0.1/x' }]), /Ricetta 1/);
  assert.throws(() => controllaRicette([{ tipo: 'uscita', sezione: 'clienti', percorso: '/x' }], { assoluti: true }), /indirizzo completo/);
  assert.throws(() => controllaRicette([{ tipo: 'entrata', sezione: 'clienti', modo: 'aggiorna' }]), /campo chiave/);
  assert.throws(() => controllaRicette([{ tipo: 'boh', sezione: 'clienti' }]), /tipo/);
  assert.deepEqual(permessiRicette({ ricette: [{ tipo: 'uscita', sezione: 'clienti' }, { tipo: 'entrata', sezione: 'articoli', modo: 'aggiorna' }, { tipo: 'entrata', sezione: 'fornitori', attiva: false }] }),
    { clienti: { leggi: true }, articoli: { leggi: true, modifica: true } });
});

test('HTTP / API REST: ricette in uscita (coda), azione con anteprima, entrata con codice e HMAC, permessi dalle ricette', async () => {
  const K = await kubo();
  const S = await finto({ 'GET /v1/me': () => ({ ok: true }), 'POST /v1/contatti': (p, c) => ({ id: 'ext-' + c.email }), 'PUT /v1/contatti/:id': () => ({ ok: true }),
    'POST /v1/link': (p, c) => ({ url: `https://pay.esempio.it/${c.rif}` }) });
  try {
    const ricette = [
      { id: 'nuovo', nome: 'Nuovo cliente al CRM', tipo: 'uscita', sezione: 'clienti', eventi: ['crea'], metodo: 'POST', percorso: '/contatti', corpo: '{"name":"{nome}","email":"{email}","vip":"{consenso}"}' },
      { id: 'cambio', nome: 'Cliente modificato', tipo: 'uscita', sezione: 'clienti', eventi: ['modifica'], metodo: 'PUT', percorso: '/contatti/{email}', corpo: '' },
      { id: 'link', nome: 'Crea il link', tipo: 'azione', sezione: 'clienti', metodo: 'POST', percorso: '/link', corpo: '{"rif":"{id}","chi":"{nome}"}' },
      { id: 'ordini', nome: 'Clienti dal sito', tipo: 'entrata', sezione: 'clienti', modo: 'crea-o-aggiorna', chiave: 'email', campi: [{ da: 'cliente.mail', a: 'email' }, { da: 'cliente.nome', a: 'nome' }, { da: 'cliente.tel', a: 'telefono' }], idEvento: 'id' },
    ];
    // una ricetta verso la rete interna senza il permesso: rifiutata al salvataggio
    const no = await K.chiama('PUT', '/api/connettori/http', { impostazioni: { ricette: [{ tipo: 'uscita', sezione: 'clienti', percorso: 'http://127.0.0.1:9/x' }] } });
    assert.equal(no.stato, 400); assert.match(no.json.errore, /Ricetta 1/);
    const pag = await accendi(K, 'http', { segreti: { chiave: 'chiave-segreta-1', firma_entrata: 'segreto-hmac' },
      impostazioni: { base: S.url + '/v1', accesso: 'intestazione', accesso_nome: 'X-Api-Key', prova_percorso: '/me', intestazioni: '{"Accept-Language":"it"}', ricette } });
    // l'identità del connettore: legge e scrive i clienti (per le ricette), non tocca il resto
    assert.deepEqual(pag.permessi.map(p => p.entita), ['Clienti']);
    assert.ok(!JSON.stringify(pag).includes('chiave-segreta-1'));
    assert.equal(pag.oauth, null);   // l'OAuth si mostra solo con l'accesso «oauth2»
    assert.equal((await K.chiama('POST', '/api/connettori/http/prova')).json.ok, true);
    assert.equal(S.chiamate[0].intestazioni['x-api-key'], 'chiave-segreta-1'); assert.equal(S.chiamate[0].intestazioni['accept-language'], 'it');
    // uscita: un cliente nuovo parte verso il servizio, con il corpo dal modello (il sì/no resta un sì/no)
    const c = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', email: 'anna@esempio.it', consenso: true })).json;
    const post = await aspetta(() => S.chiamate.find(x => x.percorso === '/v1/contatti'));
    assert.deepEqual(post.corpo, { name: 'Anna Bianchi', email: 'anna@esempio.it', vip: true });
    await K.chiama('PATCH', `/api/dati/clienti/${c.id}`, { telefono: '333 1234567' });
    const put = await aspetta(() => S.chiamate.find(x => x.metodo === 'PUT'));
    assert.equal(put.percorso, '/v1/contatti/anna%40esempio.it'); assert.equal(put.corpo.dati?.telefono ?? put.corpo.telefono, '333 1234567');
    // azione: anteprima senza chiamare il servizio, poi la chiamata vera; il link della risposta torna da copiare
    const prima = S.chiamate.length;
    const ant = (await K.chiama('POST', '/api/connettori/http/azioni/link', { args: { riga: c.id }, anteprima: true })).json;
    assert.equal(ant.titolo, 'Crea il link'); assert.match(ant.righe[1][1], /\/v1\/link$/); assert.match(ant.righe[2][1], /Anna Bianchi/);
    assert.equal(S.chiamate.length, prima);
    const az = (await K.chiama('POST', '/api/connettori/http/azioni/link', { args: { riga: c.id } })).json;
    assert.equal(az.url, `https://pay.esempio.it/${c.id}`);
    assert.ok((await K.chiama('GET', '/api/connettori/azioni')).json.some(a => a.connettore === 'http' && a.azione === 'link' && a.su === 'clienti'));
    // la stessa ricetta è uno strumento di Lumi: scheda di conferma, poi l'esecuzione con il gettone
    const lumi = (await K.chiama('GET', '/api/lumi/strumenti')).json.strumenti.find(x => x.nome === 'connettore_http_link');
    assert.ok(lumi && lumi.tipo === 'scrivi', 'strumento di Lumi della ricetta');
    const sch = (await K.chiama('POST', '/api/lumi/strumenti/connettore_http_link/anteprima', { args: { riga: c.id } })).json;
    assert.equal(sch.titolo, 'Crea il link');
    assert.equal((await K.chiama('POST', '/api/lumi/strumenti/connettore_http_link/esegui', { args: { riga: c.id }, gettone: sch.gettone })).json.url, `https://pay.esempio.it/${c.id}`);
    // entrata: codice nell'indirizzo + HMAC; aggiorna per email, crea se non c'è, idempotente per id
    const codice = pag.impostazioni.find(i => i.id === 'codice').valore;
    const corpo = JSON.stringify({ id: 'ev1', cliente: { mail: 'anna@esempio.it', nome: 'Anna Bianchi Rossi', tel: '06 123' } });
    assert.equal((await manda(K, `/api/connettori/http/in/${codice}`, corpo)).stato, 401);   // senza firma
    assert.equal((await manda(K, '/api/connettori/http/in/sbagliato', corpo, { 'X-Signature': firmaHmacDi('segreto-hmac', corpo, 'hex') })).stato, 401);
    const r = await manda(K, `/api/connettori/http/in/${codice}`, corpo, { 'X-Signature': firmaHmacDi('segreto-hmac', corpo, 'hex') });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'creati 0, aggiornati 1');
    const dopo = (await K.chiama('GET', `/api/dati/clienti/${c.id}`)).json;
    assert.equal(dopo.nome, 'Anna Bianchi Rossi'); assert.equal(dopo.modificato_da, 'servizio:http');
    assert.equal((await manda(K, `/api/connettori/http/in/${codice}?ricetta=ordini`, corpo, { 'X-Signature': firmaHmacDi('segreto-hmac', corpo, 'base64') })).json.doppione, true);
    const nuovo = JSON.stringify({ id: 'ev2', cliente: { mail: 'luca@esempio.it', nome: 'Luca Verdi' } });
    assert.equal((await manda(K, `/api/connettori/http/in/${codice}`, nuovo, { 'X-Signature': firmaHmacDi('segreto-hmac', nuovo, 'hex') })).json.esito, 'creati 1, aggiornati 0');
    // anti-eco: le righe arrivate dal servizio non ripartono verso lo stesso servizio
    await new Promise(r => setTimeout(r, 150));
    assert.equal(S.chiamate.filter(x => x.percorso === '/v1/contatti' && x.corpo.email === 'luca@esempio.it').length, 0);
    // un campo obbligatorio che manca: errore chiaro, niente di scritto
    const rotto = JSON.stringify({ id: 'ev3', cliente: { mail: 'x@esempio.it' } });
    assert.equal((await manda(K, `/api/connettori/http/in/${codice}`, rotto, { 'X-Signature': firmaHmacDi('segreto-hmac', rotto, 'hex') })).stato, 422);
    // l'identità del connettore non scrive nelle sezioni che le ricette non toccano
    assert.throws(() => K.nucleo.k('http').dati.crea('articoli', { nome: 'x' }));
    // una ricetta tolta non c'è più, né come bottone né come azione
    await K.chiama('PUT', '/api/connettori/http', { impostazioni: { ricette: ricette.filter(x => x.id !== 'link') } });
    assert.equal((await K.chiama('POST', '/api/connettori/http/azioni/link', { args: { riga: c.id } })).stato, 404);
    assert.ok(!(await K.chiama('GET', '/api/connettori/azioni')).json.some(a => a.azione === 'link'));
    assert.ok(!(await K.chiama('GET', '/api/lumi/strumenti')).json.strumenti.some(x => x.nome === 'connettore_http_link'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('HTTP / API REST: OAuth2 client credentials, chiave nella query, Basic', async () => {
  const K = await kubo(); let n = 0;
  const S = await finto({ 'POST /token': (p, c) => { n++; return { access_token: `tok-${c.client_id}-${c.scope}`, expires_in: 3600 }; }, 'GET /me': () => ({ ok: 1 }) });
  try {
    await accendi(K, 'http', { segreti: { client_id: 'cid', client_secret: 'csec' }, impostazioni: { base: S.url, accesso: 'oauth2', token_url: S.url + '/token', scope: 'leggi', prova_percorso: '/me' } });
    assert.equal((await K.chiama('POST', '/api/connettori/http/prova')).json.ok, true);
    assert.equal((await K.chiama('POST', '/api/connettori/http/prova')).json.ok, true);
    assert.equal(n, 1);   // il token si riusa finché vale
    assert.equal(S.chiamate.find(x => x.percorso === '/me').intestazioni.authorization, 'Bearer tok-cid-leggi');
    assert.equal((await K.chiama('GET', '/api/connettori/http')).json.oauth.collegato, true);
    await K.chiama('PUT', '/api/connettori/http', { impostazioni: { accesso: 'query', accesso_nome: 'apikey' }, segreti: { chiave: 'q-123' } });
    await K.chiama('POST', '/api/connettori/http/prova');
    assert.equal(S.chiamate.at(-1).q.apikey, 'q-123');
    await K.chiama('PUT', '/api/connettori/http', { impostazioni: { accesso: 'basic', utente: 'mario' } });
    await K.chiama('POST', '/api/connettori/http/prova');
    assert.equal(S.chiamate.at(-1).intestazioni.authorization, 'Basic ' + Buffer.from('mario:q-123').toString('base64'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('ponti: Zapier riceve gli eventi della sezione e scrive in Kubo; il webhook generico firma come i webhook di Kubo', async () => {
  const K = await kubo();
  const Z = await finto({ 'POST /hooks/catch/1/abc': () => ({ status: 'success' }), 'POST /ricevi': () => ({ ok: true }) });
  try {
    // un ponte vuole l'indirizzo completo della piattaforma
    assert.equal((await K.chiama('PUT', '/api/connettori/zapier', { interni: true, impostazioni: { ricette: [{ tipo: 'uscita', sezione: 'articoli', percorso: '/hooks' }] } })).stato, 400);
    const pag = await accendi(K, 'zapier', { impostazioni: { ricette: [
      { id: 'art', nome: 'Articoli a Zapier', tipo: 'uscita', sezione: 'articoli', eventi: ['crea', 'elimina'], percorso: Z.url + '/hooks/catch/1/abc' },
      { id: 'dazap', nome: 'Da Zapier', tipo: 'entrata', sezione: 'articoli', modo: 'crea-o-aggiorna', chiave: 'codice' },
    ] } });
    assert.equal(pag.webhook.nelPercorso, true);
    const a = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso blu', codice: 'VB1', prezzo: 12 })).json;
    const ev = await aspetta(() => Z.chiamate.find(x => x.percorso === '/hooks/catch/1/abc'));
    assert.equal(ev.corpo.evento, 'crea'); assert.equal(ev.corpo.nome, 'Vaso blu'); assert.equal(ev.corpo.sezione, 'articoli'); assert.equal(ev.corpo.id, a.id);
    await K.chiama('DELETE', `/api/dati/articoli/${a.id}`);
    const el = await aspetta(() => Z.chiamate.find(x => x.corpo?.evento === 'elimina'));
    assert.equal(el.corpo.nome, 'Vaso blu');
    // Zapier scrive: le chiavi del JSON con i nomi o gli id dei campi, abbinate per codice
    const codice = pag.impostazioni.find(i => i.id === 'codice').valore;
    const r = await manda(K, `/api/connettori/zapier/in/${codice}`, JSON.stringify({ codice: 'P1', Nome: 'Piatto', prezzo: 9.5, ignoto: 1 }));
    assert.equal(r.json.esito, 'creati 1, aggiornati 0', JSON.stringify(r.json));
    const p = (await K.chiama('GET', '/api/dati/articoli?q=Piatto')).json.righe[0]; assert.equal(p.prezzo, 9.5); assert.equal(p.creato_da, 'servizio:zapier');
    // webhook generico: X-Kubo-Firma come i webhook di Kubo (sha256 su «tempo.corpo»)
    await accendi(K, 'webhook', { segreti: { firma_uscita: 'whsec_prova' }, impostazioni: { ricette: [{ id: 'cli', tipo: 'uscita', sezione: 'clienti', eventi: ['crea'], percorso: Z.url + '/ricevi', corpo: '{"chi":"{nome}"}' }] } });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Gianni' });
    const w = await aspetta(() => Z.chiamate.find(x => x.percorso === '/ricevi'));
    assert.deepEqual(w.corpo, { chi: 'Gianni' });
    assert.equal(w.intestazioni['x-kubo-firma'], firmaKubo('whsec_prova', w.intestazioni['x-kubo-tempo'], JSON.stringify({ chi: 'Gianni' })));
    assert.equal(w.intestazioni['x-kubo-firma'], 'sha256=' + createHmac('sha256', 'whsec_prova').update(`${w.intestazioni['x-kubo-tempo']}.{"chi":"Gianni"}`).digest('hex'));
  } finally { await K.chiudi(); await Z.chiudi(); }
});

test('OpenAPI 3.1 dallo schema: tipi con null, webhooks, permessi di chi chiede, token, ricette in entrata', async () => {
  const K = await kubo();
  try {
    await accendi(K, 'make', { impostazioni: { ricette: [{ id: 'damake', tipo: 'entrata', sezione: 'clienti', modo: 'crea' }] } });
    const tok = (await K.chiama('POST', '/api/token', { nome: 'n8n' })).json.token;
    const r = await fetch(K.base + '/api/openapi-3.1.json', { headers: { Authorization: `Bearer ${tok}` } }), oa = await r.json();
    assert.equal(r.status, 200); assert.equal(oa.openapi, '3.1.0'); assert.equal(oa.info.license.identifier, 'MIT');
    assert.ok(oa.paths['/api/dati/clienti'].post && oa.paths['/api/dati/clienti/{id}'].patch && oa.paths['/api/dati/clienti/{id}/storia'].get);
    assert.deepEqual(oa.components.schemas.clienti.properties.email.type, ['string', 'null']);
    assert.equal(oa.components.schemas.clienti.properties.email.format, 'email');
    assert.deepEqual(oa.components.schemas.clienti.required, ['nome']);
    assert.equal(oa.components.schemas.vendite.properties.totale.readOnly, true);
    assert.equal(oa.webhooks['kubo.clienti'].post.requestBody.content['application/json'].schema.properties.entita.const, 'clienti');
    assert.match(oa.paths['/api/connettori/make/in/{codice}'].post.description, /damake → clienti/);
    assert.deepEqual(oa.paths['/api/connettori/make/in/{codice}'].post.security, []);
    // ogni $ref porta a uno schema che c'è; gli operationId sono unici
    const refs = [...JSON.stringify(oa).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map(m => m[1]);
    assert.ok(refs.length > 10 && refs.every(x => oa.components.schemas[x]), refs.find(x => !oa.components.schemas[x]));
    const ids = Object.values(oa.paths).flatMap(p => Object.values(p).filter(o => o?.operationId).map(o => o.operationId));
    assert.equal(new Set(ids).size, ids.length);
    // chi è in sola lettura vede solo le letture, e niente indirizzi dei connettori
    await K.chiama('POST', '/api/utenti', { nome: 'Lia', email: 'lia@esempio.it', password: 'password-lunga', ruolo: 'lettura' });
    await K.chiama('POST', '/api/esci'); await K.chiama('POST', '/api/accedi', { email: 'lia@esempio.it', password: 'password-lunga' });
    const ol = (await K.chiama('GET', '/api/openapi-3.1.json')).json;
    assert.ok(ol.paths['/api/dati/clienti'].get && !ol.paths['/api/dati/clienti'].post && !ol.paths['/api/dati/clienti/{id}'].patch);
    assert.ok(!Object.keys(ol.paths).some(p => p.startsWith('/api/connettori')));
    await K.chiama('POST', '/api/esci');
    assert.equal((await K.chiama('GET', '/api/openapi-3.1.json')).stato, 401);
  } finally { await K.chiudi(); }
});

test('copie del connettore HTTP: due servizi REST con indirizzo, accesso e ricette propri; si toglie solo spenta', async () => {
  const K = await kubo();
  const A = await finto({ 'GET /me': () => ({ ok: 1 }) }), B = await finto({ 'GET /stato': () => ({ ok: 1 }) });
  try {
    assert.equal((await K.chiama('POST', '/api/connettori/stripe/copie', { nome: 'Altro' })).stato, 400);
    assert.equal((await K.chiama('POST', '/api/connettori/http/copie', { nome: '  ' })).stato, 400);
    const crm = (await K.chiama('POST', '/api/connettori/http/copie', { nome: 'CRM Città' })).json;
    assert.equal(crm.id, 'http-crm-citta'); assert.equal(crm.nome, 'CRM Città'); assert.equal(crm.copiaDi, 'http');
    assert.equal((await K.chiama('POST', '/api/connettori/http/copie', { nome: 'crm città' })).stato, 409);
    assert.equal((await K.chiama('POST', '/api/connettori/http-crm-citta/copie', { nome: 'x' })).stato, 400);   // niente copie di copie
    await accendi(K, 'http', { segreti: { chiave: 'chiave-a' }, impostazioni: { base: A.url, accesso: 'bearer', prova_percorso: '/me' } });
    await accendi(K, 'http-crm-citta', { segreti: { chiave: 'chiave-b' }, impostazioni: { base: B.url, accesso: 'intestazione', accesso_nome: 'X-Token', prova_percorso: '/stato' } });
    assert.equal((await K.chiama('POST', '/api/connettori/http/prova')).json.ok, true);
    assert.equal((await K.chiama('POST', '/api/connettori/http-crm-citta/prova')).json.ok, true);
    assert.equal(A.chiamate[0].intestazioni.authorization, 'Bearer chiave-a'); assert.equal(B.chiamate[0].intestazioni['x-token'], 'chiave-b');
    assert.ok((await K.chiama('GET', '/api/connettori/catalogo?q=crm')).json.voci.some(v => v.id === 'http-crm-citta'));
    assert.equal((await K.chiama('DELETE', '/api/connettori/http-crm-citta')).stato, 409);   // accesa
    await K.chiama('PUT', '/api/connettori/http-crm-citta', { attivo: false });
    assert.equal((await K.chiama('DELETE', '/api/connettori/http-crm-citta')).json.ok, true);
    assert.equal((await K.chiama('GET', '/api/connettori/http-crm-citta')).stato, 404);
    assert.equal(K.db.prepare("SELECT COUNT(*) n FROM _connettori_segreti WHERE connettore = 'http-crm-citta'").get().n, 0);
    assert.equal((await K.chiama('DELETE', '/api/connettori/http')).stato, 400);   // l'originale non si toglie
  } finally { await K.chiudi(); await A.chiudi(); await B.chiudi(); }
});
