// I connettori nell'interfaccia (il server è in server/moduli/connettori.js). Tutto è generato dal manifesto:
//   #/connettori        la Libreria delle integrazioni: ricerca, categorie con i conti, filtri rapidi (gratis, facili, Italia),
//                       carte con il monogramma e lo stato. Una sola richiesta (GET /api/connettori/catalogo): i filtri girano
//                       qui (web/libreria.js), mostrando e nascondendo carte già fatte, anche con centinaia di connettori
//   #/connettori/<id>   cosa fa, cosa ti serve e dove trovarlo, passo per passo, costo, difficoltà, fonti, cosa potrà toccare;
//                       poi accendi/spegni, impostazioni e segreti («salvato · cambia · togli»), le ricette (connettore HTTP e
//                       ponti), prova la connessione, indirizzo del webhook, OAuth, abbinamenti dei campi, giri, coda, registro
// Nelle schede: i bottoni delle azioni dei connettori accesi (es. «Link di pagamento»): chi scrive mostra prima l'anteprima.
// Solo testo e h(): i dati (nomi, messaggi dei servizi, registro) non vanno mai in innerHTML.
import { t, dataOra } from '/lingua.js';
import { filtra, conta, iniziali, tinta, statoVoce, CATEGORIE } from '/libreria.js';

let cssCaricato = false, azioni = [];
function caricaCss() { if (cssCaricato) return; cssCaricato = true; document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/connettori.css' })); }
const titolare = k => k.stato.utente?.ruolo === 'titolare';
const quando = v => (v ? dataOra(typeof v === 'number' ? new Date(v).toISOString() : v) : '—');
const copia = async (k, testo) => { try { await navigator.clipboard.writeText(testo); k.toast(t('connettori.copiato')); } catch { k.toast(testo); } };
const COLORI = { ok: 'verde', errore: 'rosso', avviso: 'giallo', ignorato: 'grigio' };
const esitoDi = e => (COLORI[e] ? t('connettori.esito-' + e) : e);   // l'esito nel registro, nella lingua di chi guarda

const STATI = { rotto: ['rotto', 'rosso'], cambiato: ['cambiato', 'giallo'], 'da-approvare': ['da-approvare', 'giallo'], 'da-configurare': ['incompleto', 'giallo'], acceso: ['acceso', 'verde'], spento: ['spento', 'grigio'] };
function statoDi(c) { const [n, colore] = STATI[statoVoce(c)]; return { nome: t('connettori.stato-' + n), colore }; }
const nomeCat = c => (c ? t('connettori.cat-' + (CATEGORIE.includes(c) ? c : 'altro')) : t('connettori.cat-altro'));
// il monogramma: le iniziali su una tessera colorata (niente loghi dei marchi), la tinta sempre uguale per lo stesso id
const monogramma = (k, c, grande = false) => k.h(grande ? 'span.conn-mono.grande' : 'span.conn-mono', { stile: { '--t': tinta(c.id) }, 'aria-hidden': 'true', testo: iniziali(c.nome || c.id) });
const chipDi = (k, s) => k.h('span.chip', { stile: { '--c': `var(--${s.colore})` }, testo: s.nome });

// l'indirizzo pubblico di Lumi: uno solo per tutti i webhook e i ritorni dei connettori (k.pubblico)
function indirizzoPubblico(k) {
  const { h } = k, campo = h('input.campo', { type: 'url', placeholder: 'https://lumi.esempio.it', autocomplete: 'off', 'aria-label': t('connettori.pubblico-titolo') }), esito = h('span.nota');
  k.get('/connettori/impostazioni').then(x => { campo.value = x.pubblico || ''; }).catch(() => {});
  return h('section.foglio.conn-pubblico', h('h2', t('connettori.pubblico-titolo')), h('p.nota', t('connettori.pubblico-aiuto')),
    h('form.conn-riga', { on: { submit: async ev => { ev.preventDefault(); try { const x = await k.api('PUT', '/connettori/impostazioni', { pubblico: campo.value }); campo.value = x.pubblico; esito.textContent = t('connettori.pubblico-salvato'); } catch (e) { esito.textContent = e.message; } } } },
      campo, h('button.btn', { type: 'submit' }, t('connettori.salva')), esito));
}

// ---------- la libreria ----------
// i filtri restano tornando dalla pagina di un connettore
const filtri = { q: '', categoria: '', costo: '', difficolta: '', zona: '' };
async function libreria(contenuto, k) {
  const { h } = k, dati = await k.get('/connettori/catalogo'), voci = dati.voci;
  const carte = new Map(voci.map(v => [v.id, carta(k, v)]));
  const griglia = h('div.conn-griglia', [...carte.values()]);
  const accese = voci.filter(v => v.attivo || v.acceso);
  const tue = accese.length ? h('section.conn-tue', h('h2', t('connettori.le-tue')), h('div.conn-griglia.conn-griglia-tue', accese.map(v => carta(k, v)))) : null;
  const vuoto = h('div.vuoto.conn-vuoto', h('p', t('connettori.nessuna')), h('a.btn', { href: '#/connettori/http' }, t('connettori.prova-http')));
  const cerca = h('input.campo.conn-cerca', { type: 'search', placeholder: t('connettori.cerca'), value: filtri.q, autocomplete: 'off', 'aria-label': t('connettori.cerca'),
    on: { input: ev => { filtri.q = ev.target.value; aggiorna(); } } });
  // i filtri rapidi: un clic accende, un altro spegne
  const rapidi = [['costo', 'gratis', 'gratis'], ['difficolta', 'facile', 'facili'], ['zona', 'IT', 'italia']].map(([campo, val, chiave]) =>
    h('button.conn-filtro', { type: 'button', 'aria-pressed': String(filtri[campo] === val), on: { click: ev => { filtri[campo] = filtri[campo] === val ? '' : val; ev.currentTarget.setAttribute('aria-pressed', String(filtri[campo] === val)); aggiorna(); } } }, t('connettori.f-' + chiave)));
  const categorie = h('div.conn-categorie', { role: 'toolbar', 'aria-label': t('connettori.categorie') });
  const conteggio = h('span.nota');
  function aggiorna() {
    const senza = filtra(voci, { ...filtri, categoria: '' }), mostrate = new Set(filtra(senza, { categoria: filtri.categoria }).map(v => v.id)), n = conta(senza);
    for (const [id, el] of carte) el.hidden = !mostrate.has(id);
    vuoto.hidden = mostrate.size > 0;
    if (tue) tue.hidden = !!(filtri.q || filtri.categoria || filtri.costo || filtri.difficolta || filtri.zona);
    conteggio.textContent = t('connettori.trovate', { n: mostrate.size });
    // le categorie con almeno una voce (e quella scelta, anche a zero), nell'ordine del catalogo
    const cat = [['', n.tutte, t('connettori.tutte')], ...[...CATEGORIE, 'altro'].filter(c => n[c] || c === filtri.categoria).map(c => [c, n[c] || 0, nomeCat(c)])];
    categorie.replaceChildren(...cat.map(([c, x, nome]) => h('button.conn-cat', { type: 'button', 'aria-pressed': String(filtri.categoria === c),
      on: { click: () => { filtri.categoria = c; aggiorna(); } } }, nome, h('span.conn-cat-n', String(x)))));
  }
  contenuto.replaceChildren(h('div.testa', h('h1', t('connettori.libreria'))), h('div.corpo.conn.conn-libreria',
    h('p.conn-sotto', t('connettori.libreria-sotto', { n: dati.totale, accese: accese.filter(v => v.attivo).length })),
    h('div.conn-barra', cerca, h('div.conn-rapidi', rapidi)), categorie, tue, h('div.conn-riga', conteggio), griglia, vuoto,
    indirizzoPubblico(k), h('p.nota', t('connettori.terzi'), ' ', t('connettori.smanettoni'))));
  aggiorna();
  if (matchMedia('(pointer: fine)').matches) cerca.focus();
}
// una carta: monogramma, nome, categoria, stato; descrizione; costo, difficoltà e «provato con un servizio finto»
function carta(k, v) {
  const { h } = k, c = v.catalogo || {};
  return h('a.conn-carta', { href: `#/connettori/${encodeURIComponent(v.id)}` },
    h('div.conn-carta-testa', monogramma(k, v), h('div.conn-carta-nome', h('b', v.nome || v.id), h('span.nota', nomeCat(c.categoria))), chipDi(k, statoDi(v))),
    h('p', v.rotto ? t('connettori.rotto') : v.descrizione || ''),
    h('div.conn-carta-piede',
      c.costo ? h('span.conn-tag', t('connettori.costo-' + c.costo)) : null,
      c.difficolta ? h('span.conn-tag', t('connettori.diff-' + c.difficolta)) : null,
      c.prova === 'finto' ? h('span.conn-tag.finto', { title: t('connettori.prova-finto-aiuto') }, t('connettori.prova-finto')) : null,
      v.origine === 'locale' ? h('span.conn-tag', t('connettori.locale')) : null));
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
  contenuto.replaceChildren(h('div.testa', h('a.btn.nudo', { href: '#/connettori', 'aria-label': t('connettori.libreria') }, '←'), monogramma(k, c), h('h1', c.nome || c.id), chipDi(k, statoDi(c)), h('div.conn-spazio'), interruttore(k, c, salva)), corpo);
  if (c.rotto) { corpo.append(h('div.avviso', t('connettori.rotto'))); return; }
  if (c.daApprovare) { corpo.append(h('div.avviso', t(c.cambiato ? 'connettori.cambiato' : 'connettori.da-approvare')), h('p', t('connettori.somma'), h('br'), h('code.mono.conn-somma', c.somma))); return; }
  corpo.append(guida(k, c));
  if (c.copie || c.copiaDi) corpo.append(copie(k, c));
  if (c.mancano?.length) corpo.append(h('div.avviso', t('connettori.mancano', { cosa: c.mancano.join(', ') })));
  if (c.cambiato) corpo.append(h('div.avviso', t('connettori.cambiato')));
  corpo.append(impostazioni(k, c, salva), collegamenti(k, c, ricarica));
  if (c.mappe.length) corpo.append(mappe(k, c, salva));
  corpo.append(lavori(k, c, ricarica), registro(k, c));
}

// ---------- la guida dal catalogo: cosa fa, cosa serve e dove, passo per passo, costo, difficoltà, permessi, fonti ----------
const sicuro = u => (/^https?:\/\//i.test(String(u || '')) ? u : null);   // i link vengono dai manifesti: solo http(s)
const fuori = (k, href, ...figli) => (sicuro(href) ? k.h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, ...figli) : null);
const cosaPuo = p => ['leggi', 'crea', 'modifica', 'elimina'].filter(x => p[x]).map(x => t('connettori.p-' + x)).join(', ');
// «*» (permessi: { '*': { leggi: true } }) è «tutte le sezioni (sola lettura)», non una sezione che si chiama «*»
const vocePermesso = p => (p.tutte && p.leggi && !p.crea && !p.modifica && !p.elimina ? t('connettori.tutte-lettura')
  : t('connettori.permesso', { sezione: p.tutte ? t('connettori.tutte-sezioni') : p.entita, cosa: cosaPuo(p) }));
function guida(k, c) {
  const { h } = k, g = c.catalogo;
  const permessi = h('section.foglio', h('h2', t('connettori.permessi-titolo')), c.permessi?.length
    ? h('ul.conn-elenco', c.permessi.map(p => h('li', vocePermesso(p))))
    : h('p.nota', t('connettori.nessun-permesso')));
  if (!g) return h('div.conn-guida', h('p.conn-sotto', c.descrizione || ''), permessi);
  const tag = (x, finto) => h(finto ? 'span.conn-tag.finto' : 'span.conn-tag', x);
  return h('div.conn-guida',
    h('section.conn-eroe', h('p.conn-sotto', c.descrizione || ''),
      h('div.conn-carta-piede', tag(nomeCat(g.categoria)), tag(t('connettori.costo-' + g.costo)), tag(t('connettori.diff-' + g.difficolta)),
        (g.zone || []).map(z => tag(t('connettori.zona-' + z))), tag(t('connettori.prova-' + (g.prova === 'vero' ? 'vero' : 'finto')), g.prova !== 'vero')),
      fuori(k, g.sito, t('connettori.sito'), ' ↗')),
    h('div.conn-due',
      h('section.foglio', h('h2', t('connettori.cosa-serve')), h('ul.conn-serve', (g.serve || []).map(x => h('li', h('b', x.cosa), h('span.nota', x.dove), fuori(k, x.link, t('connettori.apri'), ' ↗'))))),
      h('section.foglio', h('h2', t('connettori.passi')), h('ol.conn-passi', (g.passi || []).map(x => h('li', x))))),
    h('div.conn-due',
      h('section.foglio', h('h2', t('connettori.costo')), h('p', h('b', t('connettori.costo-' + g.costo))), g.costoNota ? h('p.nota', g.costoNota) : null,
        h('p', h('b', t('connettori.difficolta')), ' · ', t('connettori.diff-' + g.difficolta))),
      permessi),
    h('details.conn-fonti', h('summary', t('connettori.fonti', { n: (g.fonti || []).length })),
      h('ul', (g.fonti || []).map(f => h('li', fuori(k, f, f)))), h('p.nota', t(g.prova === 'vero' ? 'connettori.prova-vero-aiuto' : 'connettori.prova-finto-aiuto'))));
}

// ---------- le ricette (connettore HTTP e ponti): un editor fatto di campi, niente codice ----------
// Tiene l'elenco in memoria; «Salva» delle impostazioni lo manda al server, che lo controlla (connettori-ricette.js).
const TIPI_RICETTA = ['uscita', 'azione', 'entrata'], EVENTI = ['crea', 'modifica', 'elimina', 'ripristina'], METODI = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
function editorRicette(k, c, i) {
  const { h } = k, lista = JSON.parse(JSON.stringify(Array.isArray(i.valore) ? i.valore : [])), el = h('div.conn-ricette');
  const sezioni = k.schema.filter(e => !e.nascosta), campiDi = id => (k.schema.find(e => e.id === id)?.campi || []).filter(x => !x.archiviato);
  const gen = c.impostazioni.find(x => x.generato)?.valore, salvate = new Set(lista.map(r => r.id));
  const nuovoId = () => { let n = lista.length + 1; while (lista.some(r => r.id === `r${n}`)) n++; return `r${n}`; };
  const campo = (etichetta, input, nota) => h('label', h('span.etichetta', etichetta), input, nota ? h('span.nota', nota) : null);
  const scrivi = (r, chiave, { area = false, ph = '' } = {}) => h(area ? 'textarea.campo.mono' : 'input.campo', { value: r[chiave] ?? '', placeholder: ph, rows: area ? 4 : null, spellcheck: false, on: { input: ev => { r[chiave] = ev.target.value; } } });
  const scegli = (r, chiave, opzioni, poi) => h('select.campo', { on: { change: ev => { r[chiave] = ev.target.value; poi?.(); } } }, opzioni.map(([v, n]) => h('option', { value: v, testo: n, selected: (r[chiave] ?? '') === v })));
  const spunta = (acceso, testo, f) => h('label.conn-spunta', h('input', { type: 'checkbox', checked: acceso, on: { change: ev => f(ev.target.checked) } }), h('span', testo));
  function ricetta(r, n) {
    const campi = campiDi(r.sezione);
    const testa = h('div.conn-ricetta-testa', h('span.conn-tag', t('connettori.r-tipo-' + r.tipo)),
      h('input.campo.conn-ricetta-nome', { value: r.nome || '', placeholder: t('connettori.r-nome'), 'aria-label': t('connettori.r-nome'), on: { input: ev => { r.nome = ev.target.value; } } }),
      spunta(r.attiva !== false, t('connettori.r-attiva'), v => { r.attiva = v; }),
      h('button.btn.piccolo.nudo.pericolo', { type: 'button', on: { click: () => { lista.splice(n, 1); disegna(); } } }, t('connettori.togli')));
    const parti = [campo(t('connettori.r-sezione'), scegli(r, 'sezione', sezioni.map(e => [e.id, e.nome]), disegna))];
    if (r.tipo === 'entrata') {
      r.campi ||= [];
      parti.push(campo(t('connettori.r-modo'), scegli(r, 'modo', ['crea-o-aggiorna', 'crea', 'aggiorna'].map(m => [m, t('connettori.modo-' + m)]))),
        campo(t('connettori.r-chiave'), scegli(r, 'chiave', [['', '—'], ...campi.map(x => [x.id, x.nome])])),
        campo(t('connettori.r-elenco'), scrivi(r, 'elenco', { ph: 'items' })), campo(t('connettori.r-idevento'), scrivi(r, 'idEvento', { ph: 'id' })));
      const abbinamenti = h('div.conn-abbinamenti', r.campi.map((x, j) => h('div.conn-riga',
        h('input.campo.mono', { value: x.da || '', placeholder: t('connettori.r-da'), 'aria-label': t('connettori.r-da'), on: { input: ev => { x.da = ev.target.value; } } }), h('span', '→'),
        h('select.campo', { 'aria-label': t('connettori.r-a'), on: { change: ev => { x.a = ev.target.value; } } }, h('option', { value: '', testo: t('connettori.r-a') }), campi.map(f => h('option', { value: f.id, testo: f.nome, selected: f.id === x.a }))),
        h('button.btn.piccolo.nudo', { type: 'button', 'aria-label': t('connettori.togli'), on: { click: () => { r.campi.splice(j, 1); disegna(); } } }, '×'))),
        h('button.btn.piccolo', { type: 'button', on: { click: () => { r.campi.push({ da: '', a: '' }); disegna(); } } }, '+ ', t('connettori.r-aggiungi-campo')));
      const u = salvate.has(r.id) && gen ? `${location.origin}/api/connettori/${encodeURIComponent(c.id)}/in/${gen}?ricetta=${encodeURIComponent(r.id)}` : null;
      return h('div.conn-ricetta', testa, h('div.conn-campi', parti), h('span.etichetta', t('connettori.r-campi')), abbinamenti,
        h('div.conn-indirizzo', h('span.etichetta', t('connettori.r-indirizzo-entrata')),
          u ? h('div.conn-riga', h('code.mono.conn-valore', u), h('button.btn.piccolo', { type: 'button', on: { click: () => copia(k, u) } }, t('connettori.copia'))) : h('span.nota', t('connettori.r-salva-prima'))));
    }
    parti.push(campo(t('connettori.r-metodo'), scegli(r, 'metodo', METODI.map(m => [m, m]))),
      campo(i.assoluti ? t('connettori.r-indirizzo') : t('connettori.r-percorso'), scrivi(r, 'percorso', { ph: i.assoluti ? 'https://hooks.esempio.com/…' : '/contatti/{id}' })));
    if (r.tipo === 'uscita') parti.push(h('fieldset.conn-eventi', h('legend.etichetta', t('connettori.r-eventi')),
      EVENTI.map(e => spunta((r.eventi || []).includes(e), t('connettori.ev-' + e), v => { r.eventi = EVENTI.filter(x => (x === e ? v : (r.eventi || []).includes(x))); }))));
    else parti.push(spunta(r.scrive !== false, t('connettori.r-scrive'), v => { r.scrive = v; }));
    // un indirizzo completo su un altro sito riceve la chiave o il token solo con questa spunta (connettore HTTP)
    if (!i.assoluti) parti.push(spunta(!!r.conAccesso, t('connettori.r-con-accesso'), v => { if (v) r.conAccesso = true; else delete r.conAccesso; }));
    return h('div.conn-ricetta', testa, h('div.conn-campi', parti),
      campo(t('connettori.r-corpo'), scrivi(r, 'corpo', { area: true, ph: '{"email":"{email}"}' }), t('connettori.r-segnaposto', { campi: ['id', ...campi.map(x => x.id)].map(x => `{${x}}`).join(' ') })));
  }
  function disegna() {
    el.replaceChildren(...(lista.length ? lista.map(ricetta) : [h('p.nota', t('connettori.r-nessuna'))]),
      h('div.conn-riga', TIPI_RICETTA.map(tipo => h('button.btn.piccolo', { type: 'button', on: { click: () => {
        lista.push({ id: nuovoId(), nome: '', tipo, sezione: sezioni[0]?.id || '', attiva: true,
          ...(tipo === 'entrata' ? { modo: 'crea-o-aggiorna', campi: [] } : { metodo: 'POST', percorso: '', corpo: '', ...(tipo === 'uscita' ? { eventi: ['crea', 'modifica'] } : { scrive: true }) }) });
        disegna();
      } } }, '+ ', t('connettori.r-tipo-' + tipo)))));
  }
  disegna();
  return { el, get value() { return lista; } };
}

// le copie (HTTP, webhook): un secondo servizio con indirizzo, accesso e ricette suoi; una copia spenta si toglie
function copie(k, c) {
  const { h } = k, id = encodeURIComponent(c.id);
  if (c.copiaDi) return h('div.conn-riga', h('span.nota', t('connettori.copia-di', { nome: c.copiaDi })), !c.acceso ? h('button.btn.piccolo.nudo.pericolo', { on: { click: () =>
    finestra(k, t('connettori.togli-copia'), [h('p', t('connettori.togli-copia-conferma', { nome: c.nome }))], t('connettori.togli'), async () => {
      try { await k.api('DELETE', `/connettori/${id}`); location.hash = '#/connettori'; } catch (e) { k.toast(e.message, true); } }) } }, t('connettori.togli-copia')) : null);
  return h('div.conn-riga', h('button.btn.piccolo', { on: { click: () => {
    const nome = h('input.campo', { autocomplete: 'off', placeholder: t('connettori.copia-nome'), 'aria-label': t('connettori.copia-nome') });
    finestra(k, t('connettori.copia'), [h('p.nota', t('connettori.copia-aiuto')), nome], t('connettori.copia-crea'), async () => {
      try { const x = await k.api('POST', `/connettori/${id}/copie`, { nome: nome.value }); location.hash = `#/connettori/${encodeURIComponent(x.id)}`; } catch (e) { k.toast(e.message, true); } });
    nome.focus();
  } } }, '+ ', t('connettori.copia')), h('span.nota', t('connettori.copia-aiuto')));
}

// accendere chiede conferma con i permessi (e la somma, per un connettore che non è di Lumi)
function interruttore(k, c, salva) {
  const { h } = k;
  if (c.attivo || c.acceso) return h('button.btn', { on: { click: () => salva({ attivo: false }) } }, t('connettori.spegni'));
  return h('button.btn.pieno', { on: { click: () => finestra(k, t('connettori.accendi-titolo', { nome: c.nome }), [
    c.daApprovare ? h('p', t('connettori.da-approvare')) : h('p', t('connettori.potra')),
    h('ul.conn-elenco', c.permessi.map(p => h('li', vocePermesso(p)))),
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
    else if (i.tipo === 'ricette') { const ed = editorRicette(k, c, i); valori[i.id] = ed; return h('div.conn-ricette-campo', h('span.etichetta', i.nome), ed.el); }
    else if (i.tipo === 'json') el = valori[i.id] = h('textarea.campo.mono', { rows: 3, spellcheck: false, value: i.valore == null ? '' : JSON.stringify(i.valore, null, 2) });
    else if (i.tipo === 'scelta') el = valori[i.id] = h('select.campo', (i.opzioni || []).map(o => h('option', { value: o.id ?? o, testo: o.nome ?? o, selected: (o.id ?? o) === i.valore })));
    else if (i.tipo === 'si_no') el = valori[i.id] = h('input', { type: 'checkbox', checked: !!i.valore });
    else el = valori[i.id] = h('input.campo', { type: i.tipo === 'numero' ? 'number' : i.tipo === 'url' ? 'url' : 'text', value: i.valore ?? '', autocomplete: 'off' });
    return h('label', h('span.etichetta', i.nome), el, i.aiuto ? h('span.nota', i.aiuto) : null);
  });
  const interni = h('input', { type: 'checkbox', checked: c.interni });
  const esito = h('span.nota');
  const form = h('form', { on: { submit: ev => {
    ev.preventDefault();
    const imp = Object.fromEntries(Object.entries(valori).map(([x, el]) => [x, el.type === 'checkbox' ? el.checked : el.value]));   // le ricette danno l'elenco
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
    // l'indirizzo pubblico di Lumi (Libreria › Indirizzo pubblico), se c'è; altrimenti quello del browser
    const u = (c.webhook.url || location.origin + c.webhook.percorso) + ((c.webhook.firma === 'token' || c.webhook.nelPercorso) && gen ? '/' + gen : '');   // il codice segreto in fondo all'indirizzo
    righe.push(h('label', h('span.etichetta', t('connettori.webhook')), h('div.conn-riga', h('code.mono.conn-valore', u), h('button.btn.piccolo', { type: 'button', on: { click: () => copia(k, u) } }, t('connettori.copia'))), h('span.nota', t('connettori.webhook-aiuto'))));
  }
  for (const p of c.pubbliche) if (gen) {
    const u = `${location.origin}/api/connettori/${encodeURIComponent(c.id)}/pub/${encodeURIComponent(p)}?t=${encodeURIComponent(gen)}`;
    righe.push(h('label', h('span.etichetta', t('connettori.indirizzo-segreto')), h('div.conn-riga', h('code.mono.conn-valore', u), h('button.btn.piccolo', { type: 'button', on: { click: () => copia(k, u) } }, t('connettori.copia'))), h('span.nota', t('connettori.indirizzo-aiuto'))));
  }
  if (c.oauth) righe.push(h('div.conn-riga', h('span.etichetta', t('connettori.account')),
    c.oauth.collegato ? h('span.chip', { stile: { '--c': 'var(--verde)' }, testo: t('connettori.collegato') }) : h('span.chip', { testo: t('connettori.scollegato') }),
    c.oauth.scade ? h('span.nota', t('connettori.scade', { quando: quando(c.oauth.scade) })) : null,
    c.oauth.tipo === 'codice' && c.attivo ? h('button.btn.piccolo', { on: { click: async () => { try { const r = await k.api('POST', `/connettori/${encodeURIComponent(c.id)}/oauth/inizio`, { base: location.origin }); location.href = r.url; } catch (e) { k.toast(e.message, true); } } } }, c.oauth.collegato ? t('connettori.ricollega') : t('connettori.collega')) : null,
    c.oauth.dispositivo && c.attivo ? h('button.btn.piccolo', { on: { click: () => dispositivo(k, c, ricarica) } }, t('connettori.dispositivo')) : null));
  // l'indirizzo di ritorno da registrare nel servizio (lo stesso che Lumi manda come redirect_uri)
  if (c.oauth?.tipo === 'codice' && c.oauth.ritorno) { const u = (c.pubblico || location.origin) + c.oauth.ritorno;
    righe.push(h('label', h('span.etichetta', t('connettori.ritorno')), h('div.conn-riga', h('code.mono.conn-valore', u), h('button.btn.piccolo', { type: 'button', on: { click: () => copia(k, u) } }, t('connettori.copia'))))); }
  return righe.length ? h('section.foglio', h('h2', t('connettori.collegamento')), h('div.conn-campi', righe)) : h('div');
}

// il collegamento con un codice (device code): il codice e l'indirizzo del servizio, poi Lumi controlla da solo finché
// la persona conferma, il codice scade o la finestra si chiude
async function dispositivo(k, c, ricarica) {
  const { h } = k, base = `/connettori/${encodeURIComponent(c.id)}/oauth/dispositivo`;
  let d; try { d = await k.api('POST', base); } catch (e) { k.toast(e.message, true); return; }
  const stato = h('p.nota', { 'aria-live': 'polite' }, t('connettori.dispositivo-attesa')), fine = Date.now() + d.scade * 1000;
  let aperta = true;
  finestra(k, t('connettori.dispositivo-titolo', { nome: c.nome }), [
    h('p', t('connettori.dispositivo-passi')),
    d.indirizzo ? h('p', h('a', { href: d.indirizzo, target: '_blank', rel: 'noopener noreferrer' }, d.indirizzo)) : null,
    h('div.conn-riga', h('code.mono.conn-codice', d.codice), h('button.btn.piccolo', { type: 'button', on: { click: () => copia(k, d.codice) } }, t('connettori.copia'))), stato,
  ], t('connettori.dispositivo-chiudi'), () => { aperta = false; });
  while (aperta && Date.now() < fine && document.body.contains(stato)) {
    await new Promise(r => setTimeout(r, d.intervallo * 1000));
    if (!document.body.contains(stato)) break;
    try { const r = await k.api('POST', `${base}/controlla`); if (r.collegato) { stato.closest('.conn-velo')?.remove(); k.toast(t('connettori.collegato')); ricarica(); return; } }
    catch (e) { stato.textContent = e.message; return; }
  }
  if (document.body.contains(stato)) stato.textContent = t('connettori.dispositivo-scaduto');
}

// i campi che il connettore usa, abbinati ai campi di Lumi per id (una rinomina non rompe niente)
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
    h('span.nota', t('connettori.ultimo', { quando: quando(g.ultimo) }), g.esito ? ' · ' : '', g.esito ? chipDi(k, { nome: esitoDi(g.esito), colore: COLORI[g.esito] || 'grigio' }) : null, ' · ', t('connettori.prossimo', { quando: quando(g.prossimo) })),
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
    h('tbody', c.registro.map(r => h('tr', h('td', quando(r.quando)), h('td', t('connettori.verso-' + r.verso)), h('td', chipDi(k, { nome: esitoDi(r.esito), colore: COLORI[r.esito] || 'grigio' })),
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
  lato: k => (titolare(k) ? [{ href: '#/connettori', icona: 'ingranaggio', nome: t('connettori.libreria') }] : []),
  rotte: { connettori: (contenuto, k, a) => { caricaCss(); return (a ? pagina(contenuto, k, decodeURIComponent(a.split('?')[0])) : libreria(contenuto, k)).catch(e => contenuto.replaceChildren(k.h('div.corpo', k.h('div.avviso', e.message)))); } },
  azioniScheda: (def, riga, k) => azioni.filter(a => a.su === def.id).map(a => k.h('button.btn', { on: { click: () => eseguiAzione(k, a, riga) } }, a.nome)),
};
