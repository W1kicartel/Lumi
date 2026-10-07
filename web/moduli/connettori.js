// I connettori nell'interfaccia (il server è in server/moduli/connettori.js). Tutto è generato dal manifesto:
//   #/connettori        il catalogo: installati e disponibili, con lo stato (solo il titolare)
//   #/connettori/<id>   accendi/spegni, impostazioni e segreti («salvato · cambia · togli»), prova la connessione,
//                       indirizzo del webhook, collegamento dell'account (OAuth), abbinamenti dei campi, giri, coda, registro
// Nelle schede: i bottoni delle azioni dei connettori accesi (es. «Link di pagamento»): chi scrive mostra prima l'anteprima.
// Solo testo e h(): i dati (nomi, messaggi dei servizi, registro) non vanno mai in innerHTML.
import { t, dataOra } from '/lingua.js';

let cssCaricato = false, azioni = [];
function caricaCss() { if (cssCaricato) return; cssCaricato = true; document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/connettori.css' })); }
const titolare = k => k.stato.utente?.ruolo === 'titolare';
const quando = v => (v ? dataOra(typeof v === 'number' ? new Date(v).toISOString() : v) : '—');
const copia = async (k, testo) => { try { await navigator.clipboard.writeText(testo); k.toast(t('connettori.copiato')); } catch { k.toast(testo); } };
const COLORI = { ok: 'verde', errore: 'rosso', avviso: 'giallo', ignorato: 'grigio' };

function statoDi(c) {
  if (c.rotto) return { nome: t('connettori.stato-rotto'), colore: 'rosso' };
  if (c.cambiato) return { nome: t('connettori.stato-cambiato'), colore: 'giallo' };
  if (c.attivo && c.mancano?.length) return { nome: t('connettori.stato-incompleto'), colore: 'giallo' };
  return c.attivo ? { nome: t('connettori.stato-acceso'), colore: 'verde' } : { nome: t('connettori.stato-spento'), colore: 'grigio' };
}
const chipDi = (k, s) => k.h('span.chip', { stile: { '--c': `var(--${s.colore})` }, testo: s.nome });

// ---------- catalogo ----------
async function catalogo(contenuto, k) {
  const { h, icona } = k, l = await k.get('/connettori');
  const scheda = c => h('a.conn-carta', { href: `#/connettori/${encodeURIComponent(c.id)}` },
    h('div.conn-carta-testa', icona(c.icona || 'cartella'), h('b', c.nome || c.id), chipDi(k, statoDi(c))),
    h('p', c.rotto ? t('connettori.rotto') : c.descrizione || ''),
    h('span.nota', c.origine === 'ufficiale' ? t('connettori.ufficiale') : t('connettori.locale')));
  contenuto.replaceChildren(h('div.testa', h('h1', t('connettori.titolo'))), h('div.corpo.conn',
    h('p.nota', t('connettori.spiega')),
    h('div.conn-griglia', l.map(scheda)), h('p.nota', t('connettori.terzi'))));
}

// ---------- pagina di un connettore ----------
async function pagina(contenuto, k, id) {
  const { h } = k;
  const c = await k.get(`/connettori/${encodeURIComponent(id)}`);
  const ritorno = new URLSearchParams(location.hash.split('?')[1] || '').get('oauth');
  if (ritorno) { k.toast(t('connettori.oauth-' + (['ok', 'scaduto'].includes(ritorno) ? ritorno : 'errore')), ritorno !== 'ok'); history.replaceState(null, '', `#/connettori/${encodeURIComponent(id)}`); }
  const ricarica = () => pagina(contenuto, k, id);
  // dopo un'accensione o uno spegnimento i bottoni nelle schede cambiano subito, senza ricaricare l'app
  const salva = async corpo => { try { await k.api('PUT', `/connettori/${encodeURIComponent(id)}`, corpo); k.toast(t('connettori.salvato')); azioni = await k.get('/connettori/azioni').catch(() => azioni); ricarica(); } catch (e) { k.toast(e.message, true); } };
  const corpo = h('div.corpo.conn');
  contenuto.replaceChildren(h('div.testa', h('a.btn.nudo', { href: '#/connettori' }, '←'), h('h1', c.nome || c.id), chipDi(k, statoDi(c)), h('div.conn-spazio'), interruttore(k, c, salva)), corpo);
  if (c.rotto) { corpo.append(h('div.avviso', t('connettori.rotto'))); return; }
  if (c.daApprovare) { corpo.append(h('div.avviso', t(c.cambiato ? 'connettori.cambiato' : 'connettori.da-approvare')), h('p', t('connettori.somma'), h('br'), h('code.mono.conn-somma', c.somma))); return; }
  corpo.append(h('p.nota', c.descrizione || ''));
  if (c.mancano?.length) corpo.append(h('div.avviso', t('connettori.mancano', { cosa: c.mancano.join(', ') })));
  if (c.cambiato) corpo.append(h('div.avviso', t('connettori.cambiato')));
  corpo.append(impostazioni(k, c, salva), collegamenti(k, c, ricarica));
  if (c.mappe.length) corpo.append(mappe(k, c, salva));
  corpo.append(lavori(k, c, ricarica), registro(k, c));
}

// accendere chiede conferma con i permessi (e la somma, per un connettore che non è di Kubo)
function interruttore(k, c, salva) {
  const { h } = k;
  if (c.attivo || c.acceso) return h('button.btn', { on: { click: () => salva({ attivo: false }) } }, t('connettori.spegni'));
  return h('button.btn.pieno', { on: { click: () => finestra(k, t('connettori.accendi-titolo', { nome: c.nome }), [
    c.daApprovare ? h('p', t('connettori.da-approvare')) : h('p', t('connettori.potra')),
    h('ul.conn-elenco', c.permessi.map(p => h('li', t('connettori.permesso', { sezione: p.entita, cosa: ['leggi', 'crea', 'modifica', 'elimina'].filter(x => p[x]).map(x => t('connettori.p-' + x)).join(', ') })))),
    c.origine === 'locale' ? h('p', t('connettori.somma'), h('br'), h('code.mono.conn-somma', c.somma)) : null,
  ], t('connettori.accendi'), () => salva({ attivo: true, somma: c.somma })) } }, t('connettori.accendi'));
}

function impostazioni(k, c, salva) {
  const { h } = k, valori = {}, segreti = {};
  const campi = c.impostazioni.map(i => {
    let el;
    if (i.segreto && i.generato) el = h('div.conn-riga', h('code.mono.conn-valore', i.valore || '—'), i.valore ? h('button.btn.piccolo', { type: 'button', on: { click: () => copia(k, i.valore) } }, t('connettori.copia')) : null);
    else if (i.segreto && i.salvato) el = h('div.conn-riga', h('span.conn-salvato', t('connettori.salvato-segreto')),
      h('button.btn.piccolo', { type: 'button', on: { click: ev => { const x = h('input.campo', { type: 'password', autocomplete: 'off' }); segreti[i.id] = x; ev.target.parentNode.replaceWith(x); x.focus(); } } }, t('connettori.cambia')),
      h('button.btn.piccolo.nudo.pericolo', { type: 'button', on: { click: () => salva({ segreti: { [i.id]: null } }) } }, t('connettori.togli')));
    else if (i.segreto) el = segreti[i.id] = h('input.campo', { type: 'password', autocomplete: 'off' });
    else if (i.tipo === 'scelta') el = valori[i.id] = h('select.campo', (i.opzioni || []).map(o => h('option', { value: o.id ?? o, testo: o.nome ?? o, selected: (o.id ?? o) === i.valore })));
    else if (i.tipo === 'si_no') el = valori[i.id] = h('input', { type: 'checkbox', checked: !!i.valore });
    else el = valori[i.id] = h('input.campo', { type: i.tipo === 'numero' ? 'number' : i.tipo === 'url' ? 'url' : 'text', value: i.valore ?? '', autocomplete: 'off' });
    return h('label', h('span.etichetta', i.nome), el, i.aiuto ? h('span.nota', i.aiuto) : null);
  });
  const interni = h('input', { type: 'checkbox', checked: c.interni });
  const esito = h('span.nota');
  const form = h('form', { on: { submit: ev => {
    ev.preventDefault();
    const imp = Object.fromEntries(Object.entries(valori).map(([x, el]) => [x, el.type === 'checkbox' ? el.checked : el.value]));
    const seg = Object.fromEntries(Object.entries(segreti).filter(([, el]) => el.value).map(([x, el]) => [x, el.value]));
    salva({ impostazioni: imp, segreti: seg, interni: interni.checked });
  } } },
    h('div.conn-campi', campi),
    h('label.conn-spunta', interni, h('span', t('connettori.interni'))),
    h('div.conn-riga', h('button.btn.pieno', { type: 'submit' }, t('connettori.salva')),
      h('button.btn', { type: 'button', on: { click: async () => { esito.textContent = t('connettori.provo'); try { const r = await k.api('POST', `/connettori/${encodeURIComponent(c.id)}/prova`); esito.textContent = r.ok ? t('connettori.prova-ok') + (r.messaggio ? ` · ${r.messaggio}` : '') : t('connettori.prova-no', { motivo: r.messaggio || '—' }); } catch (e) { esito.textContent = e.message; } } } }, t('connettori.prova')), esito));
  return h('section.foglio', h('h2', t('connettori.impostazioni')), form);
}

// gli indirizzi da dare al servizio (webhook, feed) e il collegamento dell'account
function collegamenti(k, c, ricarica) {
  const { h } = k, righe = [], gen = c.impostazioni.find(i => i.generato)?.valore;
  if (c.webhook) {
    const u = location.origin + c.webhook.percorso + (c.webhook.firma === 'token' && gen ? '/' + gen : '');   // il codice segreto in fondo all'indirizzo
    righe.push(h('label', h('span.etichetta', t('connettori.webhook')), h('div.conn-riga', h('code.mono.conn-valore', u), h('button.btn.piccolo', { type: 'button', on: { click: () => copia(k, u) } }, t('connettori.copia'))), h('span.nota', t('connettori.webhook-aiuto'))));
  }
  for (const p of c.pubbliche) if (gen) {
    const u = `${location.origin}/api/connettori/${encodeURIComponent(c.id)}/pub/${encodeURIComponent(p)}?t=${encodeURIComponent(gen)}`;
    righe.push(h('label', h('span.etichetta', t('connettori.indirizzo-segreto')), h('div.conn-riga', h('code.mono.conn-valore', u), h('button.btn.piccolo', { type: 'button', on: { click: () => copia(k, u) } }, t('connettori.copia'))), h('span.nota', t('connettori.indirizzo-aiuto'))));
  }
  if (c.oauth) righe.push(h('div.conn-riga', h('span.etichetta', t('connettori.account')),
    c.oauth.collegato ? h('span.chip', { stile: { '--c': 'var(--verde)' }, testo: t('connettori.collegato') }) : h('span.chip', { testo: t('connettori.scollegato') }),
    c.oauth.scade ? h('span.nota', t('connettori.scade', { quando: quando(c.oauth.scade) })) : null,
    c.oauth.tipo === 'codice' && c.attivo ? h('button.btn.piccolo', { on: { click: async () => { try { const r = await k.api('POST', `/connettori/${encodeURIComponent(c.id)}/oauth/inizio`, { base: location.origin }); location.href = r.url; } catch (e) { k.toast(e.message, true); } } } }, c.oauth.collegato ? t('connettori.ricollega') : t('connettori.collega')) : null));
  return righe.length ? h('section.foglio', h('h2', t('connettori.collegamento')), h('div.conn-campi', righe)) : h('div');
}

// i campi che il connettore usa, abbinati ai campi di Kubo per id (una rinomina non rompe niente)
function mappe(k, c, salva) {
  const { h } = k, scelte = {};
  return h('section.foglio', h('h2', t('connettori.abbinamenti')), h('p.nota', t('connettori.abbinamenti-aiuto')),
    c.mappe.map(m => h('div.conn-mappa', h('b', m.nome), !m.entita ? h('p.nota', t('connettori.sezione-manca', { nome: m.sem })) : h('div.conn-campi', m.campi.map(x => {
      const s = scelte[`${m.sem}.${x.sem}`] = h('select.campo', h('option', { value: '', testo: '—' }), x.possibili.map(p => h('option', { value: p.id, testo: p.nome, selected: p.id === x.campo })));
      return h('label', h('span.etichetta', x.sem.replace(/_/g, ' ').replace(/^./, l => l.toUpperCase()), x.facoltativo ? ` (${t('connettori.facoltativo')})` : ''), s);
    })))),
    h('button.btn', { on: { click: () => salva({ mappe: { campi: Object.fromEntries(Object.entries(scelte).map(([x, s]) => [x, s.value || null])) } }) } }, t('connettori.salva-abbinamenti')));
}

function lavori(k, c, ricarica) {
  const { h } = k, parti = [];
  for (const g of c.giri) parti.push(h('div.conn-giro', h('div', h('b', g.nome), h('span.nota', ' · ', g.ogni ? t('connettori.ogni', { ogni: g.ogni }) : t('connettori.alle', { alle: g.alle }))),
    h('span.nota', t('connettori.ultimo', { quando: quando(g.ultimo) }), g.esito ? ' · ' : '', g.esito ? chipDi(k, { nome: g.esito, colore: COLORI[g.esito] || 'grigio' }) : null, ' · ', t('connettori.prossimo', { quando: quando(g.prossimo) })),
    c.attivo ? h('button.btn.piccolo', { on: { click: async ev => { ev.target.disabled = true; try { const r = await k.api('POST', `/connettori/${encodeURIComponent(c.id)}/giri/${encodeURIComponent(g.id)}`); k.toast(r.esito === 'ok' ? t('connettori.giro-ok') : String(r.risultato || r.esito), r.esito !== 'ok'); } catch (e) { k.toast(e.message, true); } ricarica(); } } }, t('connettori.sincronizza')) : null));
  const attesa = c.coda.attesa || 0, fallite = c.coda.fallito || 0;
  if (attesa || fallite) parti.push(h('div.conn-riga', h('span', t('connettori.coda', { attesa, fallite })),
    fallite ? h('button.btn.piccolo', { on: { click: async () => { await k.api('POST', `/connettori/${encodeURIComponent(c.id)}/coda/riprova`); ricarica(); } } }, t('connettori.riprova')) : null));
  return parti.length ? h('section.foglio', h('h2', t('connettori.sincronizzazioni')), parti) : h('div');
}

function registro(k, c) {
  const { h } = k;
  if (!c.registro.length) return h('section.foglio', h('h2', t('connettori.registro')), h('p.nota', t('connettori.registro-vuoto')));
  return h('section.foglio', h('h2', t('connettori.registro')), h('div.conn-scorri', h('table.tabella.conn-tabella',
    h('thead', h('tr', h('th', t('connettori.col-quando')), h('th', t('connettori.col-verso')), h('th', t('connettori.col-esito')), h('th', t('connettori.col-cosa')))),
    h('tbody', c.registro.map(r => h('tr', h('td', quando(r.quando)), h('td', t('connettori.verso-' + r.verso)), h('td', chipDi(k, { nome: r.esito, colore: COLORI[r.esito] || 'grigio' })),
      h('td', h('span', r.titolo || ''), r.dettagli ? h('span.nota', ' · ', r.dettagli) : null)))))));
}

// una finestra di conferma, fatta di soli elementi (niente HTML dai dati)
function finestra(k, titolo, contenuto, bottone, conferma) {
  const { h } = k, velo = h('div.conn-velo'), chiudi = () => velo.remove();
  velo.append(h('div.foglio.conn-finestra', { role: 'dialog', 'aria-modal': 'true' }, h('h2', titolo), contenuto,
    h('div.conn-riga', h('button.btn.pieno', { on: { click: async ev => { ev.target.disabled = true; try { await conferma(); } finally { chiudi(); } } } }, bottone), h('button.btn', { on: { click: chiudi } }, t('connettori.annulla')))));
  velo.addEventListener('click', ev => { if (ev.target === velo) chiudi(); });
  document.body.append(velo); velo.querySelector('.btn.pieno').focus();
}

// un'azione dalla scheda: anteprima (per chi scrive) → conferma → risultato (un link si mostra da copiare)
async function eseguiAzione(k, a, riga) {
  const percorso = `/connettori/${encodeURIComponent(a.connettore)}/azioni/${encodeURIComponent(a.azione)}`, args = { [a.input[0]]: riga.id };
  const vai = async () => {
    try {
      const r = await k.api('POST', percorso, { args });
      if (r?.url) finestra(k, a.nome, [k.h('code.mono.conn-valore', r.url)], t('connettori.copia'), () => copia(k, r.url)); else k.toast(t('connettori.fatto'));
    } catch (e) { k.toast(e.message, true); }
  };
  if (!a.scrive) return vai();
  try {
    const ant = await k.api('POST', percorso, { args, anteprima: true });
    finestra(k, ant.titolo || a.nome, [k.h('dl.conn-anteprima', (ant.righe || []).map(([x, y]) => [k.h('dt', x), k.h('dd', String(y ?? ''))])), ...(ant.avvisi || []).map(x => k.h('div.avviso', x))], t('connettori.conferma'), vai);
  } catch (e) { k.toast(e.message, true); }
}

export default {
  nome: 'connettori',
  async avvio(k) { caricaCss(); try { azioni = await k.get('/connettori/azioni'); } catch { azioni = []; } },
  lato: k => (titolare(k) ? [{ href: '#/connettori', icona: 'ingranaggio', nome: t('connettori.titolo') }] : []),
  rotte: { connettori: (contenuto, k, a) => { caricaCss(); return (a ? pagina(contenuto, k, decodeURIComponent(a.split('?')[0])) : catalogo(contenuto, k)).catch(e => contenuto.replaceChildren(k.h('div.corpo', k.h('div.avviso', e.message)))); } },
  azioniScheda: (def, riga, k) => azioni.filter(a => a.su === def.id).map(a => k.h('button.btn', { on: { click: () => eseguiAzione(k, a, riga) } }, a.nome)),
};
