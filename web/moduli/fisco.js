// Il fisco nell'interfaccia (#/fisco/<scheda>): cosa pagare e quando, IVA e LIPE, cruscotto del forfettario con la
// simulazione, F24 pronti da ricopiare o stampare, ritenute, scadenze, pacchetto per il commercialista e impostazioni.
// I conti li fa il server (server/moduli/fisco.js); qui si mostrano. Niente dati degli utenti in innerHTML: l'F24 arriva
// dal server già «escapato» e si mostra in un iframe sandbox senza script, come le stampe dei documenti.
import { t, soldi, data, numero } from '../lingua.js';

const SCHEDE = ['', 'iva', 'forfettario', 'f24', 'ritenute', 'scadenze', 'commercialista', 'impostazioni'];
let cssCaricato = false;
const caricaCss = () => { if (cssCaricato) return; cssCaricato = true; document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/fisco.css' })); };
const annoOra = () => new Date().getFullYear();
const oggi = () => new Date().toISOString().slice(0, 10);
let annoScelto = annoOra();

// i nomi delle voci (versamenti, scadenze, avvisi) vengono dal server come chiavi
const nomeVoce = v => t('fisco.v-' + v.chiave, { periodo: v.periodo ?? '', anno: v.anno ?? '' });
const nomeScadenza = s => t('fisco.sc-' + s.chiave, { periodo: s.periodo ?? '', anno: s.anno ?? '' });
const avviso = (k, a) => k.h('div.fisco-avviso', { class: a.startsWith('oltre') || a === 'fuori-dal-regime' ? 'forte' : '' }, t('fisco.av-' + a));

function pagina(contenuto, k, scheda = '', a, b) {
  caricaCss();
  const { h, get } = k;
  const corpo = h('div.corpo.fisco');
  const anni = h('select.campo.piccolo', { 'aria-label': t('fisco.anno'), on: { change: ev => { annoScelto = Number(ev.target.value); pagina(contenuto, k, scheda); } } },
    [annoOra() + 1, annoOra(), annoOra() - 1, annoOra() - 2].map(y => h('option', { value: y, testo: y, selected: y === annoScelto })));
  const schede = h('nav.fisco-schede', SCHEDE.map(s => h('a', { href: '#/fisco' + (s ? '/' + s : ''), class: s === scheda ? 'si' : '', testo: t('fisco.scheda-' + (s || 'riepilogo')) })));
  contenuto.replaceChildren(h('div.testa', h('h1', t('fisco.titolo')), anni), h('div.fisco-barra', schede), corpo);
  corpo.append(h('p.fisco-responsabilita', t('fisco.responsabilita')));
  const dove = h('div'); corpo.append(dove);
  const mostra = f => get('/fisco/impostazioni').then(imp => f(dove, k, imp, a, b)).catch(e => metti(dove, h('div.avviso', e.message)));
  const viste = { '': riepilogo, iva, forfettario, f24, ritenute, scadenze, commercialista, impostazioni };
  mostra(viste[scheda] || riepilogo);
}

// riempie un contenitore saltando i pezzi assenti (null, false)
const metti = (dove, ...x) => dove.replaceChildren(...x.flat().filter(Boolean));

// una tabella semplice: intestazioni e righe di celle (testo o nodi)
function tabella(k, intest, righe, { destra = [] } = {}) {
  const { h } = k;
  return h('div.fisco-tabella', h('table.tabella', h('thead', h('tr', intest.map((x, i) => h('th', { class: destra.includes(i) ? 'num' : '' }, x)))),
    h('tbody', righe.map(r => h('tr', r.map((c, i) => h('td', { class: destra.includes(i) ? 'num' : '' }, c ?? '')))))));
}
const scheda = (k, titolo, ...figli) => k.h('section.fisco-scheda', titolo ? k.h('h2', titolo) : null, ...figli);
const cifra = (k, etichetta, valore, nota) => k.h('div.fisco-cifra', k.h('span', etichetta), k.h('b', valore), nota ? k.h('small', nota) : null);

// ---------- riepilogo: cosa pagare e quando ----------
async function riepilogo(dove, k, imp) {
  const { h, get } = k;
  const [v, sc] = await Promise.all([get(`/fisco/versamenti?anno=${annoScelto}`), get(`/fisco/scadenze?anno=${annoScelto}`)]);
  const prossimi = v.voci.filter(x => annoScelto !== annoOra() || x.data >= oggi());
  const totale = prossimi.reduce((s, x) => s + Math.round(x.importo * 100), 0) / 100;
  const primo = prossimi[0];
  metti(dove, 
    h('div.fisco-cifre', cifra(k, t('fisco.da-pagare-anno'), soldi(totale)), cifra(k, t('fisco.prossimo'), primo ? soldi(primo.importo) : '—', primo ? `${data(primo.data)} · ${nomeVoce(primo)}` : t('fisco.niente')),
      cifra(k, t('fisco.regime'), t('fisco.regime-' + imp.regime), imp.regime === 'forfettario' ? t('fisco.coeff', { n: numero(imp.coefficienteUsato) }) : t('fisco.periodicita-' + imp.periodicita))),
    !imp.sezioni.ricevute && k.stato.poteri?.schema ? h('div.fisco-avviso', t('fisco.manca-ricevute'), ' ', h('a', { href: '#/fisco/impostazioni', testo: t('fisco.apri-impostazioni') })) : null,
    scheda(k, t('fisco.prossimi-versamenti'), prossimi.length ? tabella(k, [t('fisco.data'), t('fisco.cosa'), t('fisco.codice'), t('fisco.anno-rif'), t('fisco.importo'), ''],
      prossimi.map(x => [data(x.data), nomeVoce(x), h('span.mono', x.codice || x.causale), x.anno, soldi(x.importo), h('a', { href: `#/fisco/f24/${x.data}`, testo: t('fisco.vedi-f24') })]), { destra: [4] }) : h('p.nota', t('fisco.niente'))),
    scheda(k, t('fisco.prossime-scadenze'), elencoScadenze(k, sc.filter(s => annoScelto !== annoOra() || s.data >= oggi()).slice(0, 8))),
    ...v.avvisi.map(a => avviso(k, a)));
}
function elencoScadenze(k, l) {
  const { h } = k;
  if (!l.length) return h('p.nota', t('fisco.niente'));
  return h('ul.fisco-scadenze', l.map(s => h('li', h('time', data(s.data)), h('span', nomeScadenza(s)), h('b', s.importo ? soldi(s.importo) : ''))));
}

// ---------- IVA ----------
async function iva(dove, k, imp) {
  const { h, get } = k;
  if (imp.regime === 'forfettario') return metti(dove, avviso(k, 'forfettario-niente-iva'));
  const l = await get(`/fisco/liquidazione?anno=${annoScelto}`), mensile = l.periodicita === 'mensile';
  const nomeP = p => (mensile ? t('fisco.mese-n', { n: p.periodo }) : t('fisco.trimestre-n', { n: p.periodo }));
  const lipe = [1, 2, 3, 4].map(q => h('a.btn', { href: `/api/fisco/lipe?anno=${annoScelto}&trimestre=${q}&scarica=1`, download: '', testo: t('fisco.lipe-trimestre', { n: q }) }));
  metti(dove, 
    scheda(k, t('fisco.liquidazioni'), tabella(k, [t('fisco.periodo'), t('fisco.iva-vendite'), t('fisco.iva-acquisti'), t('fisco.riporti'), t('fisco.interessi'), t('fisco.da-versare'), t('fisco.codice'), t('fisco.scadenza')],
      l.periodi.map(p => [nomeP(p), soldi(p.ivaEsigibile), soldi(p.ivaDetratta), riporto(p), p.interessi || p.interessiSaldo ? soldi(p.interessi || p.interessiSaldo) : '',
        p.importoACredito ? t('fisco.a-credito', { importo: soldi(p.importoACredito) }) : p.riportato ? t('fisco.riportato') : soldi(p.daVersare), h('span.mono', p.codice), data(p.scadenza)]), { destra: [1, 2, 5] })),
    scheda(k, t('fisco.acconto-dicembre'), h('p', l.acconto.dovuto ? t('fisco.acconto-dovuto', { importo: soldi(l.acconto.importo), metodo: t('fisco.metodo-' + l.acconto.scelto.metodo), codice: l.acconto.codice, data: data(l.acconto.scadenza) }) : t('fisco.acconto-no')),
      h('p.nota', t('fisco.acconto-nota'))),
    scheda(k, t('fisco.lipe'), h('div.fisco-bottoni', lipe), h('ol.fisco-guida', [1, 2, 3, 4, 5].map(n => h('li', t('fisco.lipe-passo-' + n)))), h('p.nota', t('fisco.lipe-nota'))),
    scheda(k, t('fisco.registri'), h('p.nota', t('fisco.registri-nota')), h('a.btn', { href: '#/fisco/commercialista', testo: t('fisco.scheda-commercialista') })),
    ...l.avvisi.map(a => avviso(k, a)));
}
function riporto(p) {
  const x = [];
  if (p.debitoPrecedente) x.push(t('fisco.debito-prec', { importo: soldi(p.debitoPrecedente) }));
  if (p.creditoPeriodoPrecedente) x.push(t('fisco.credito-prec', { importo: soldi(p.creditoPeriodoPrecedente) }));
  if (p.creditoAnnoPrecedente) x.push(t('fisco.credito-anno', { importo: soldi(p.creditoAnnoPrecedente) }));
  if (p.acconto) x.push(t('fisco.meno-acconto', { importo: soldi(p.acconto) }));
  return x.join(' · ');
}

// ---------- forfettario ----------
async function forfettario(dove, k, imp) {
  const { h, get } = k;
  if (imp.regime !== 'forfettario') return metti(dove, h('div.fisco-avviso', t('fisco.non-forfettario')));
  const c = await get(`/fisco/forfettario?anno=${annoScelto}`);
  const barra = h('div.fisco-soglia', h('div', { stile: { width: Math.min(100, c.soglia.usato) + '%' }, class: c.soglia.usato >= 100 ? 'oltre' : c.soglia.usato >= 80 ? 'vicino' : '' }));
  const piu = h('input.campo', { type: 'number', min: 0, step: 100, placeholder: '5000', 'aria-label': t('fisco.sim-quanto') }), esito = h('div.fisco-sim-esito');
  const simula = async () => {
    const x = Number(piu.value); if (!(x > 0)) return esito.replaceChildren();
    try { const s = (await get(`/fisco/forfettario?anno=${annoScelto}&piu=${x}`)).simulazione;
      esito.replaceChildren(h('p', t('fisco.sim-esito', { piu: soldi(s.piu), tasse: soldi(s.diPiu), resta: soldi(s.restaInTasca) })), ...s.avvisi.map(a => avviso(k, a)));
    } catch (e) { esito.replaceChildren(h('div.avviso', e.message)); }
  };
  piu.addEventListener('change', simula); piu.addEventListener('keyup', ev => { if (ev.key === 'Enter') simula(); });
  const rate = l => (l?.length ? tabella(k, [t('fisco.data'), t('fisco.codice'), t('fisco.importo')], l.map(x => [data(x.scadenza), h('span.mono', x.codice), soldi(x.importo)]), { destra: [2] }) : h('p.nota', t('fisco.niente-acconti')));
  metti(dove, 
    h('div.fisco-cifre', cifra(k, t('fisco.incassato'), soldi(c.incassato), t('fisco.incassato-nota')), cifra(k, t('fisco.reddito'), soldi(c.redditoLordo), t('fisco.coeff', { n: numero(c.coefficiente) })),
      cifra(k, t('fisco.contributi'), soldi(c.inps.totale), t('fisco.gestione-' + (c.inps.gestione || 'nessuna'))), cifra(k, t('fisco.imposta'), soldi(c.imposta), t('fisco.aliquota-n', { n: c.aliquota }))),
    scheda(k, t('fisco.soglia'), barra, h('p.nota', t('fisco.soglia-nota', { usato: numero(c.soglia.usato), margine: soldi(c.soglia.margine) }))),
    ...c.avvisi.map(a => avviso(k, a)),
    scheda(k, t('fisco.simulazione'), h('label.etichetta', t('fisco.sim-quanto')), h('div.fisco-riga', piu, h('button.btn.pieno', { testo: t('fisco.simula'), on: { click: simula } })), esito),
    scheda(k, t('fisco.acconti-anno', { anno: c.anno }), rate(c.accontiQuestAnno), h('p.nota', t('fisco.acconti-base', { importo: soldi(c.impostaAnnoPrecedente) }))),
    scheda(k, t('fisco.acconti-anno', { anno: c.anno + 1 }), rate(c.accontiAnnoProssimo), h('p.nota', t('fisco.saldo-stima', { importo: soldi(c.saldo) }))));
}

// ---------- F24 ----------
async function f24(dove, k, imp, dataScelta) {
  const { h, get } = k;
  const v = await get(`/fisco/versamenti?anno=${dataScelta ? dataScelta.slice(0, 4) : annoScelto}`);
  if (!v.f24.length) return metti(dove, h('p.nota', t('fisco.niente')));
  const blocchi = v.f24.map(g => {
    const stampa = h('button.btn', { testo: t('fisco.stampa-f24'), on: { click: () => apriF24(k, v.anno, g.data) } });
    const righe = g.voci.map(x => [nomeVoce(x), t('fisco.sezione-' + x.sezione), h('span.mono', x.codice || x.causale), x.rateazione || (x.da ? `${x.da} → ${x.a}` : ''), x.anno, soldi(x.importo)]);
    return h('section.fisco-scheda', { id: 'f24-' + g.data, class: g.data === dataScelta ? 'scelta' : '' }, h('div.fisco-riga', h('h2', t('fisco.f24-del', { data: data(g.data) })), h('b', soldi(g.totale)), stampa),
      tabella(k, [t('fisco.cosa'), t('fisco.sezione'), t('fisco.codice'), t('fisco.rateazione'), t('fisco.anno-rif'), t('fisco.importo')], righe, { destra: [5] }));
  });
  metti(dove, h('div.fisco-avviso', t('fisco.f24-come')), ...blocchi, ...v.avvisi.map(a => avviso(k, a)));
  if (dataScelta) setTimeout(() => document.getElementById('f24-' + dataScelta)?.scrollIntoView({ block: 'start' }), 50);
}
async function apriF24(k, anno, dataF24) {
  const { h, get, toast } = k;
  let x; try { x = await get(`/fisco/f24?anno=${anno}&data=${dataF24}`); } catch (e) { return toast(e.message, true); }
  const foglio = h('iframe.fisco-foglio', { title: t('fisco.stampa-f24') }); foglio.setAttribute('sandbox', 'allow-same-origin allow-modals'); foglio.srcdoc = x.html;
  const chiudi = () => { velo.remove(); document.removeEventListener('keydown', esc); };
  const esc = ev => { if (ev.key === 'Escape') chiudi(); };
  const velo = h('div.fisco-velo', { on: { click: ev => { if (ev.target === velo) chiudi(); } } }, h('div.fisco-finestra', { role: 'dialog', 'aria-label': t('fisco.stampa-f24') },
    h('div.fisco-riga', h('b', t('fisco.f24-del', { data: data(dataF24) })), h('span', { stile: { flex: 1 } }),
      h('button.btn.pieno', { testo: t('fisco.stampa'), on: { click: () => { foglio.contentWindow.focus(); foglio.contentWindow.print(); } } }), h('button.btn.nudo', { testo: '×', title: t('fisco.chiudi'), on: { click: chiudi } })), foglio));
  document.addEventListener('keydown', esc); document.body.append(velo);
}

// ---------- ritenute ----------
async function ritenute(dove, k) {
  const { h, get } = k;
  const r = await get(`/fisco/ritenute?anno=${annoScelto}`);
  metti(dove, 
    scheda(k, t('fisco.registro-ritenute'), r.righe.length ? tabella(k, [t('fisco.pagata-il'), t('fisco.percipiente'), t('fisco.compenso'), t('fisco.ritenuta'), t('fisco.codice'), t('fisco.versare-entro')],
      r.righe.map(x => [data(x.pagata_il), x.fornitore, soldi(x.imponibile), soldi(x.ritenuta), h('span.mono', x.codice), data(x.versamento)]), { destra: [2, 3] }) : h('p.nota', t('fisco.ritenute-vuoto'))),
    scheda(k, t('fisco.riepilogo-cu'), r.cu.length ? tabella(k, [t('fisco.percipiente'), t('fisco.cf'), t('fisco.causale'), t('fisco.compenso'), t('fisco.ritenuta')],
      r.cu.map(x => [x.percipiente, h('span.mono', x.cf || ''), x.causale || '', soldi(x.compensi), soldi(x.ritenute)]), { destra: [3, 4] }) : h('p.nota', t('fisco.niente')), h('p.nota', t('fisco.cu-nota'))),
    ...r.avvisi.map(a => avviso(k, a)));
}

// ---------- scadenze ----------
async function scadenze(dove, k) {
  const sc = await k.get(`/fisco/scadenze?anno=${annoScelto}`);
  metti(dove, scheda(k, t('fisco.scadenze-anno', { anno: annoScelto }), elencoScadenze(k, sc)), k.h('p.nota', t('fisco.scadenze-nota')));
}

// ---------- pacchetto per il commercialista ----------
function commercialista(dove, k, imp) {
  const { h } = k;
  const trimestre = Math.ceil((new Date().getMonth() + 1) / 3), y = annoScelto;
  const da = h('input.campo', { type: 'date', value: `${y}-01-01`, 'aria-label': t('fisco.dal') }), a = h('input.campo', { type: 'date', value: `${y}-12-31`, 'aria-label': t('fisco.al') });
  const link = h('a.btn.pieno', { testo: t('fisco.scarica-pacchetto'), download: '' });
  const aggiorna = () => { link.href = `/api/fisco/pacchetto?da=${encodeURIComponent(da.value)}&a=${encodeURIComponent(a.value)}`; };
  da.addEventListener('change', aggiorna); a.addEventListener('change', aggiorna); aggiorna();
  const rapidi = [1, 2, 3, 4].map(q => h('button.btn.nudo', { testo: t('fisco.trimestre-n', { n: q }), class: y === annoOra() && q === trimestre ? 'si' : '', on: { click: () => {
    da.value = `${y}-${String(q * 3 - 2).padStart(2, '0')}-01`; a.value = `${y}-${String(q * 3).padStart(2, '0')}-${[31, 30, 30, 31][q - 1]}`; aggiorna(); } } }));
  metti(dove, scheda(k, t('fisco.pacchetto'), h('p', t('fisco.pacchetto-cosa')), h('div.fisco-riga', h('label.etichetta', t('fisco.dal')), da, h('label.etichetta', t('fisco.al')), a), h('div.fisco-riga', rapidi), link),
    scheda(k, t('fisco.quando-professionista'), h('ul.fisco-guida', ['dichiarazioni', 'visto', 'consulenza', ...(imp.regime === 'forfettario' ? [] : ['redditi'])].map(x => h('li', t('fisco.pro-' + x))))));
}

// ---------- impostazioni ----------
async function impostazioni(dove, k, imp) {
  const { h, api, toast } = k, puo = !!k.stato.poteri?.schema;
  const sel = (id, opzioni, pref) => h('select.campo', { name: id, disabled: !puo }, opzioni.map(o => h('option', { value: o, testo: t(pref + o), selected: imp[id] === o })));
  const num = (id, extra = {}) => h('input.campo', { name: id, type: 'number', step: 'any', min: 0, value: imp[id] ?? '', disabled: !puo, ...extra });
  const chk = id => h('input', { name: id, type: 'checkbox', checked: !!imp[id], disabled: !puo });
  const testo = (id, extra = {}) => h('input.campo', { name: id, value: imp[id] ?? '', disabled: !puo, autocomplete: 'off', ...extra });
  const campi = { regime: sel('regime', ['forfettario', 'semplificato', 'ordinario'], 'fisco.regime-'), periodicita: sel('periodicita', ['trimestrale', 'mensile'], 'fisco.periodicita-'),
    ateco: testo('ateco', { placeholder: '74.10.10' }), coefficiente: num('coefficiente', { max: 100, placeholder: imp.coefficienteAteco ?? '' }),
    gestione: sel('gestione', ['artigiani', 'commercianti', 'separata', 'cassa', 'nessuna'], 'fisco.gestione-'), riduzione35: chk('riduzione35'), aliquotaRidotta: chk('aliquotaRidotta'),
    impostaAnnoPrecedente: num('impostaAnnoPrecedente'), accontiVersatiAnnoPrecedente: num('accontiVersatiAnnoPrecedente'), contributiVersati: num('contributiVersati'),
    sedeInps: testo('sedeInps'), matricolaInps: testo('matricolaInps'), creditoAnnoPrecedente: num('creditoAnnoPrecedente'), accontoIvaStorico: num('accontoIvaStorico'), accontoIvaPrevisto: num('accontoIvaPrevisto'),
    camerale: num('camerale'), provinciaCciaa: testo('provinciaCciaa', { maxLength: 2 }), bollo: chk('bollo'), sostituto: chk('sostituto') };
  const riga = id => h('div', { class: campi[id].type === 'checkbox' ? 'fisco-spunta' : '' }, campi[id].type === 'checkbox' ? h('label', campi[id], ' ', t('fisco.imp-' + id.toLowerCase())) : [h('label.etichetta', t('fisco.imp-' + id.toLowerCase())), campi[id]], h('small.nota', t('fisco.impn-' + id.toLowerCase())));
  const gruppi = [['regime', ['regime', 'periodicita', 'ateco', 'coefficiente']], ['inps', ['gestione', 'riduzione35', 'sedeInps', 'matricolaInps', 'contributiVersati']],
    ['forfettario', ['aliquotaRidotta', 'impostaAnnoPrecedente', 'accontiVersatiAnnoPrecedente']], ['iva', ['creditoAnnoPrecedente', 'accontoIvaStorico', 'accontoIvaPrevisto', 'bollo']],
    ['altro', ['sostituto', 'camerale', 'provinciaCciaa']]];
  const errore = h('div');
  const salva = h('button.btn.pieno', { testo: t('fisco.salva'), disabled: !puo, on: { click: async () => {
    const corpo = Object.fromEntries(Object.entries(campi).map(([id, e]) => [id, e.type === 'checkbox' ? e.checked : e.value]));
    errore.replaceChildren();
    try { await api('PUT', '/fisco/impostazioni', corpo); toast(t('fisco.salvate')); location.hash = '#/fisco/impostazioni'; pagina(document.querySelector('main.contenuto'), k, 'impostazioni'); }
    catch (e) { errore.replaceChildren(h('div.avviso', e.message)); }
  } } });
  const prepara = !imp.sezioni.ricevute && puo ? scheda(k, t('fisco.sezioni'), h('p', t('fisco.sezioni-cosa')), h('label.fisco-spunta', h('input', { type: 'checkbox', id: 'fisco-corr' }), ' ', t('fisco.anche-corrispettivi')),
    h('button.btn', { testo: t('fisco.aggiungi-sezioni'), on: { click: async ev => { try { await api('POST', '/fisco/prepara', { corrispettivi: document.getElementById('fisco-corr').checked }); await k.ricaricaSchema(); toast(t('fisco.sezioni-aggiunte')); ev.target.disabled = true; } catch (e) { toast(e.message, true); } } } })) : null;
  metti(dove, errore, prepara, ...gruppi.map(([g, ids]) => scheda(k, t('fisco.gruppo-' + g), h('div.fisco-griglia', ids.map(riga)))),
    !imp.azienda.piva ? h('div.fisco-avviso', t('fisco.manca-piva'), ' ', h('a', { href: '#/documenti', testo: t('fisco.apri-documenti') })) : null,
    h('div.fisco-riga', { stile: { justifyContent: 'flex-end' } }, salva));
}

// ---------- promemoria all'avvio ----------
async function promemoria(k) {
  let l; try { l = await k.get('/fisco/promemoria'); } catch { return; }
  const vicine = l.filter(s => (Date.parse(s.data) - Date.parse(oggi())) / 864e5 <= 7);
  if (!vicine.length) return;
  const chiave = 'kubo.fisco.promemoria', giorno = oggi();
  try { if (localStorage.getItem(chiave) === giorno) return; localStorage.setItem(chiave, giorno); } catch { /* niente */ }
  const s = vicine[0];
  k.toast(t('fisco.promemoria', { cosa: nomeScadenza(s), data: data(s.data), n: vicine.length }));
}

export default {
  nome: 'fisco',
  avvio(k) { if (k.schema.some(e => e.id === 'fatture')) promemoria(k); },
  lato: k => (k.schema.some(e => e.id === 'fatture') ? [{ href: '#/fisco', icona: 'cassa', nome: t('fisco.titolo') }] : []),
  rotte: { fisco: (contenuto, k, a, b) => pagina(contenuto, k, a === 'f24' ? 'f24' : a || '', b) },
};
