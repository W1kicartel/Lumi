// La tesoreria nell'interfaccia (#/tesoreria/<scheda>): scadenzario con incassi, pagamenti e distinte per la banca, estratto
// conto con la riconciliazione proposta, previsione di cassa, solleciti, distinte e impostazioni. I conti e i file li fa il
// server (server/moduli/tesoreria.js); qui si mostrano. Tutti i dati entrano come testo (h()), mai in innerHTML.
import { t, soldi, data } from '../lingua.js';

const SCHEDE = ['', 'banca', 'cassa', 'solleciti', 'distinte', 'impostazioni'];
let cssCaricato = false;
const caricaCss = () => { if (cssCaricato) return; cssCaricato = true; document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/tesoreria.css' })); };
const oggi = () => new Date().toISOString().slice(0, 10);
const MAX = 3.5 * 1024 * 1024;
const base64 = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(file); });
const metti = (dove, ...x) => dove.replaceChildren(...x.flat().filter(Boolean));
const stato = { verso: 'attiva', scadute: false, cerca: '', passo: 'settimana' };

function pagina(contenuto, k, scheda = '') {
  caricaCss();
  const { h } = k;
  const corpo = h('div.corpo.tesoreria');
  const schede = h('nav.tesoreria-schede', SCHEDE.map(s => h('a', { href: '#/tesoreria' + (s ? '/' + s : ''), class: s === scheda ? 'si' : '', testo: t('tesoreria.scheda-' + (s || 'scadenze')) })));
  contenuto.replaceChildren(h('div.testa', h('h1', t('tesoreria.titolo'))), h('div.tesoreria-barra', schede), corpo);
  const viste = { '': scadenze, banca, cassa, solleciti, distinte, impostazioni };
  k.get('/tesoreria/impostazioni').then(imp => (viste[scheda] || scadenze)(corpo, k, imp)).catch(e => metti(corpo, h('div.avviso', e.message)));
}

const sezione = (k, titolo, ...figli) => k.h('section.tesoreria-scheda', titolo ? k.h('h2', titolo) : null, ...figli);
const cifra = (k, etichetta, valore, nota, cls = '') => k.h('div.tesoreria-cifra', { class: cls }, k.h('span', etichetta), k.h('b', valore), nota ? k.h('small', nota) : null);
function tabella(k, intest, righe, { destra = [] } = {}) {
  const { h } = k;
  return h('div.tesoreria-tabella', h('table.tabella', h('thead', h('tr', intest.map((x, i) => h('th', { class: destra.includes(i) ? 'num' : '' }, x)))),
    h('tbody', righe.map(r => (r instanceof Node ? r : h('tr', r.map((c, i) => h('td', { class: destra.includes(i) ? 'num' : '' }, c ?? ''))))))));
}
// gli errori dei file per la banca arrivano come chiavi: si mostrano tradotti, uno per riga
function erroriFile(k, e) {
  const l = e?.corpo?.errori; if (!l?.length) return k.toast(e.message, true);
  k.toast(l.map(x => t('tesoreria.err-' + x.chiave, { nome: x.nome || '', n: x.n || '' })).join(' · '), true);
}
const linkDoc = (k, s) => k.h('a', { href: `#/e/${s.origine.entita}/${s.origine.id}`, testo: s.descrizione });
function etichetta(k, s) {
  const { h } = k;
  if (s.stato === 'pagata') return h('span.tesoreria-segno.ok', t('tesoreria.pagata'));
  if (s.distinta && !s.distinta.incassata) return h('span.tesoreria-segno.blu', { title: s.distinta.nome }, t('tesoreria.in-distinta'));
  if (s.scaduta) return h('span.tesoreria-segno.rosso', t('tesoreria.scaduta-da', { n: s.ritardo }));
  if (s.stato === 'parziale') return h('span.tesoreria-segno.giallo', t('tesoreria.parziale'));
  return h('span.tesoreria-segno', t('tesoreria.aperta'));
}

// ---------- scadenzario ----------
async function scadenze(dove, k, imp) {
  const { h, get, api, toast } = k;
  const r = await get('/tesoreria/scadenze'), scelte = new Set();
  const att = stato.verso === 'attiva';
  const visibili = () => r.scadenze.filter(s => s.verso === stato.verso && (!stato.scadute || s.scaduta) && (!stato.cerca || `${s.controparte} ${s.descrizione}`.toLowerCase().includes(stato.cerca.toLowerCase())));
  const ridisegna = () => scadenze(dove, k, imp);
  const pagaChiavi = async (chiavi, importo = null) => {
    const quando = prompt(t('tesoreria.data-pagamento'), oggi()); if (!quando) return;
    try { await api('POST', '/tesoreria/pagamenti', { chiavi, data: quando, ...(importo != null ? { importo } : {}) }); toast((att ? t('tesoreria.incassi-registrati', { n: chiavi.length }) : t('tesoreria.pagamenti-registrati', { n: chiavi.length }))); ridisegna(); }
    catch (e) { toast(e.message, true); }
  };
  const acconto = async s => {
    const v = prompt(t('tesoreria.importo-acconto'), String(s.residuo)); if (!v) return;
    const n = Number(String(v).replace(/\./g, '').replace(',', '.')); if (!(n > 0)) return toast(t('tesoreria.importo-non-valido'), true);
    pagaChiavi([s.chiave], n);
  };
  const distinta = async tipo => {
    let quando = null;
    if (tipo !== 'riba') { quando = prompt(t('tesoreria.data-esecuzione'), oggi()); if (!quando) return; }
    try {
      const d = await api('POST', '/tesoreria/distinte', { tipo, chiavi: [...scelte], data: quando });
      toast(t('tesoreria.distinta-creata', { nome: d.nome, importo: soldi(d.totale) }));
      location.href = `/api/tesoreria/distinte/${d.id}/file`;
      ridisegna();
    } catch (e) { erroriFile(k, e); }
  };
  const azioni = h('div.tesoreria-azioni');
  const aggiornaAzioni = () => {
    const tot = r.scadenze.filter(s => scelte.has(s.chiave)).reduce((x, s) => x + Math.round(s.residuo * 100), 0) / 100;
    metti(azioni, scelte.size ? [h('span', t('tesoreria.scelte', { n: scelte.size, importo: soldi(tot) })),
      h('button.btn.pieno', { testo: att ? t('tesoreria.segna-incassate') : t('tesoreria.segna-pagate'), on: { click: () => pagaChiavi([...scelte]) } }),
      ...(att ? [h('button.btn', { testo: t('tesoreria.distinta-riba'), on: { click: () => distinta('riba') } }), h('button.btn', { testo: t('tesoreria.distinta-sdd'), on: { click: () => distinta('sdd') } })]
        : [h('button.btn', { testo: t('tesoreria.distinta-sct'), on: { click: () => distinta('sct') } })])] : [h('span.nota', t('tesoreria.scegli-nota'))]);
  };
  const corpoTabella = h('div');
  const disegnaTabella = () => {
    const l = visibili();
    metti(corpoTabella, l.length ? tabella(k, ['', t('tesoreria.scadenza'), t('tesoreria.documento'), att ? t('tesoreria.cliente') : t('tesoreria.fornitore'), t('tesoreria.importo'), t('tesoreria.residuo'), t('tesoreria.stato'), ''],
      l.map(s => [h('input', { type: 'checkbox', 'aria-label': s.descrizione, checked: scelte.has(s.chiave), on: { change: ev => { ev.target.checked ? scelte.add(s.chiave) : scelte.delete(s.chiave); aggiornaAzioni(); } } }),
        data(s.data), linkDoc(k, s), s.controparte, soldi(s.importo), soldi(s.residuo), etichetta(k, s),
        h('span.tesoreria-riga-azioni', h('button.btn.piccolo', { testo: att ? t('tesoreria.incassata') : t('tesoreria.pagata-btn'), on: { click: () => pagaChiavi([s.chiave]) } }),
          h('button.btn.piccolo.nudo', { testo: t('tesoreria.acconto'), on: { click: () => acconto(s) } }))]), { destra: [4, 5] }) : h('p.nota', t('tesoreria.niente-scadenze')));
    aggiornaAzioni();
  };
  const verso = h('div.tesoreria-interruttore', ['attiva', 'passiva'].map(v => h('button', { class: v === stato.verso ? 'si' : '', testo: t('tesoreria.verso-' + v), on: { click: () => { stato.verso = v; ridisegna(); } } })));
  const filtri = h('div.tesoreria-filtri', verso,
    h('label.tesoreria-spunta', h('input', { type: 'checkbox', checked: stato.scadute, on: { change: ev => { stato.scadute = ev.target.checked; disegnaTabella(); } } }), t('tesoreria.solo-scadute')),
    h('input.campo', { type: 'search', placeholder: t('tesoreria.cerca'), value: stato.cerca, on: { input: ev => { stato.cerca = ev.target.value; disegnaTabella(); } } }));
  const rp = r.riepilogo;
  metti(dove,
    !imp.sezioni.fatture ? h('div.tesoreria-avviso', t('tesoreria.manca-fatture')) : null,
    h('div.tesoreria-cifre', cifra(k, t('tesoreria.da-incassare'), soldi(rp.daIncassare), t('tesoreria.di-cui-scaduto', { importo: soldi(rp.scadutoClienti) }), rp.scadutoClienti ? 'attenzione' : ''),
      cifra(k, t('tesoreria.da-pagare'), soldi(rp.daPagare), t('tesoreria.di-cui-scaduto', { importo: soldi(rp.scadutoFornitori) })),
      cifra(k, t('tesoreria.saldo-netto'), soldi(Math.round((rp.daIncassare - rp.daPagare) * 100) / 100))),
    sezione(k, null, filtri, corpoTabella, azioni),
    h('p.nota', t('tesoreria.nota-termini')));
  disegnaTabella();
}

// ---------- banca: estratto conto e riconciliazione ----------
async function banca(dove, k, imp) {
  const { h, get, api, toast } = k;
  const ridisegna = () => banca(dove, k, imp);
  if (!imp.sezioni.movimenti) return metti(dove, sezione(k, t('tesoreria.banca-titolo'), h('p', t('tesoreria.manca-movimenti')), prepara(k, imp, ridisegna)));
  const b = await get('/tesoreria/banca'), sc = (await get('/tesoreria/scadenze')).scadenze;
  const esito = h('div.nota');
  const carica = async files => {
    for (const f of files) {
      if (f.size > MAX) { toast(t('tesoreria.file-grande', { nome: f.name }), true); continue; }
      try {
        const x = await api('POST', '/tesoreria/estratto', { nome: f.name, dati: await base64(f) });
        toast(t('tesoreria.importati', { n: x.importati, doppi: x.doppi }));
        if (x.saldo) toast(t('tesoreria.saldo-aggiornato', { importo: soldi(x.saldo.importo), data: data(x.saldo.data) }));
      } catch (e) { toast(e.message, true); }
    }
    ridisegna();
  };
  const input = h('input', { type: 'file', multiple: true, accept: '.xml,.csv,.xlsx,.txt,.cbi', hidden: true, on: { change: ev => carica([...ev.target.files]) } });
  const zona = h('div.tesoreria-zona', { on: { click: () => input.click(), dragover: ev => { ev.preventDefault(); zona.classList.add('sopra'); }, dragleave: () => zona.classList.remove('sopra'),
    drop: ev => { ev.preventDefault(); zona.classList.remove('sopra'); carica([...ev.dataTransfer.files]); } } }, h('b', t('tesoreria.carica-estratto')), h('span', t('tesoreria.formati')), input);
  const abbina = async (m, chiavi, distinta) => {
    try { const x = await api('POST', '/tesoreria/abbina', { movimento: m.id, chiavi, distinta }); toast(x.differenza ? t('tesoreria.abbinato-differenza', { importo: soldi(x.differenza) }) : t('tesoreria.abbinato')); ridisegna(); }
    catch (e) { toast(e.message, true); }
  };
  const movimento = m => {
    const verso = m.importo > 0 ? 'attiva' : 'passiva', aperte = sc.filter(s => s.verso === verso);
    const scegli = h('select.campo.piccolo', { 'aria-label': t('tesoreria.abbina-a') }, h('option', { value: '', testo: t('tesoreria.abbina-a') }),
      aperte.map(s => h('option', { value: s.chiave, testo: `${data(s.data)} · ${s.controparte} · ${s.descrizione} · ${soldi(s.residuo)}` })));
    return h('article.tesoreria-mov',
      h('div.tesoreria-mov-testa', h('time', data(m.data)), h('b', { class: m.importo > 0 ? 'entrata' : 'uscita' }, soldi(m.importo)), h('span', m.controparte), h('span.tesoreria-spazio'),
        h('button.btn.piccolo.nudo', { testo: t('tesoreria.ignora'), title: t('tesoreria.ignora-nota'), on: { click: async () => { try { await api('POST', '/tesoreria/ignora', { movimento: m.id }); ridisegna(); } catch (e) { toast(e.message, true); } } } })),
      h('p.tesoreria-mov-descr', m.descrizione),
      m.proposte.length ? h('ul.tesoreria-proposte', m.proposte.map(p => h('li',
        h('span.tesoreria-punti', { title: p.perche.map(x => t('tesoreria.perche-' + x)).join(', ') }, h('i', { style: `width:${p.punti}%` })),
        h('span', p.descrizione), h('small', p.perche.map(x => t('tesoreria.perche-' + x)).join(' · ')), h('b', soldi(p.importo)),
        h('button.btn.piccolo.primario', { testo: t('tesoreria.abbina'), on: { click: () => abbina(m, p.chiavi, p.distinta) } })))) : h('p.nota', t('tesoreria.nessuna-proposta')),
      aperte.length ? h('div.tesoreria-mano', scegli, h('button.btn.piccolo', { testo: t('tesoreria.abbina'), on: { click: () => { if (scegli.value) abbina(m, [scegli.value]); } } })) : null);
  };
  metti(dove,
    zona, esito,
    sezione(k, t('tesoreria.da-abbinare', { n: b.daAbbinare.length }), b.daAbbinare.length ? b.daAbbinare.map(movimento) : h('p.nota', t('tesoreria.tutto-abbinato'))),
    b.abbinati.length ? sezione(k, t('tesoreria.abbinati-recenti'), tabella(k, [t('tesoreria.data'), t('tesoreria.importo'), t('tesoreria.descrizione'), t('tesoreria.stato'), ''],
      b.abbinati.map(m => [data(m.data), soldi(m.importo), m.descrizione, t('tesoreria.mov-' + m.stato),
        h('button.btn.piccolo.nudo', { testo: t('tesoreria.annulla'), on: { click: async () => { try { await api('DELETE', `/tesoreria/abbinamenti/${encodeURIComponent(m.id)}`); ridisegna(); } catch (e) { toast(e.message, true); } } } })]), { destra: [1] })) : null,
    h('p.nota', t('tesoreria.nota-movimenti', { sezione: b.sezione })));
}
function prepara(k, imp, dopo) {
  const { h, api, toast } = k;
  if (!imp.puo.impostazioni) return h('p.nota', t('tesoreria.chiedi-titolare'));
  return h('button.btn.pieno', { testo: t('tesoreria.prepara'), on: { click: async () => {
    try { const x = await api('POST', '/tesoreria/prepara'); await k.ricaricaSchema(); toast(t('tesoreria.preparata', { n: x.fatto.length })); imp.sezioni.movimenti = true; imp.sezioni.previsioni = true; dopo(); }
    catch (e) { toast(e.message, true); }
  } } });
}

// ---------- previsione di cassa ----------
function grafico(k, periodi) {
  const NS = 'http://www.w3.org/2000/svg', L = 720, A = 220, m = 28, n = periodi.length, w = (L - m * 2) / n;
  const valori = periodi.flatMap(p => [p.entrate, -p.uscite, p.saldo]), max = Math.max(1, ...valori.map(Math.abs));
  const y = v => A / 2 - (v / max) * (A / 2 - 14);
  const el = (tag, attr) => { const e = document.createElementNS(NS, tag); for (const [a, v] of Object.entries(attr)) e.setAttribute(a, v); return e; };
  const svg = el('svg', { viewBox: `0 0 ${L} ${A}`, class: 'tesoreria-grafico', role: 'img', 'aria-label': t('tesoreria.grafico') });
  svg.append(el('line', { x1: m, x2: L - m, y1: A / 2, y2: A / 2, class: 'asse' }));
  periodi.forEach((p, i) => {
    const x = m + i * w;
    if (p.entrate) svg.append(el('rect', { x: x + w * 0.18, y: y(p.entrate), width: w * 0.3, height: A / 2 - y(p.entrate), class: 'entrate', rx: 2 }));
    if (p.uscite) svg.append(el('rect', { x: x + w * 0.52, y: A / 2, width: w * 0.3, height: y(-p.uscite) - A / 2, class: 'uscite', rx: 2 }));
  });
  const punti = periodi.map((p, i) => `${m + i * w + w / 2},${y(p.saldo)}`).join(' ');
  svg.append(el('polyline', { points: punti, class: 'saldo' }));
  periodi.forEach((p, i) => { const c = el('circle', { cx: m + i * w + w / 2, cy: y(p.saldo), r: 3, class: p.saldo < 0 ? 'saldo rosso' : 'saldo' }); const tt = el('title', {}); tt.textContent = `${data(p.a)}: ${soldi(p.saldo)}`; c.append(tt); svg.append(c); });
  return svg;
}
async function cassa(dove, k, imp) {
  const { h, get } = k;
  const p = await get(`/tesoreria/previsione?passo=${stato.passo}`);
  const passo = h('div.tesoreria-interruttore', ['settimana', 'mese'].map(v => h('button', { class: v === stato.passo ? 'si' : '', testo: t('tesoreria.passo-' + v), on: { click: () => { stato.passo = v; cassa(dove, k, imp); } } })));
  const nomeP = x => (stato.passo === 'mese' ? data(x.da, { month: 'long', year: 'numeric' }) : `${data(x.da, { day: 'numeric', month: 'short' })} – ${data(x.a, { day: 'numeric', month: 'short' })}`);
  metti(dove,
    p.senzaSaldo ? h('div.tesoreria-avviso', t('tesoreria.senza-saldo'), ' ', h('a', { href: '#/tesoreria/impostazioni', testo: t('tesoreria.apri-impostazioni') })) : null,
    p.scoperto ? h('div.tesoreria-avviso.forte', t('tesoreria.scoperto', { importo: soldi(p.minimo.saldo), data: data(p.minimo.data) })) : null,
    h('div.tesoreria-cifre', cifra(k, t('tesoreria.saldo-oggi'), soldi(p.saldoIniziale), p.saldoData ? t('tesoreria.saldo-dal', { data: data(p.saldoData) }) : null),
      cifra(k, t('tesoreria.saldo-fine'), soldi(p.saldoFinale), data(p.periodi.at(-1).a)),
      cifra(k, t('tesoreria.punto-basso'), soldi(p.minimo.saldo), data(p.minimo.data), p.scoperto ? 'attenzione' : '')),
    sezione(k, null, h('div.tesoreria-filtri', passo, h('span.tesoreria-legenda', h('i.entrate'), t('tesoreria.entrate'), h('i.uscite'), t('tesoreria.uscite'), h('i.saldo'), t('tesoreria.saldo'))), grafico(k, p.periodi)),
    sezione(k, t('tesoreria.periodi'), tabella(k, [t('tesoreria.periodo'), t('tesoreria.entrate'), t('tesoreria.uscite'), t('tesoreria.saldo')],
      p.periodi.map(x => [nomeP(x), soldi(x.entrate), soldi(x.uscite), h('b', { class: x.saldo < 0 ? 'uscita' : '' }, soldi(x.saldo))]), { destra: [1, 2, 3] })),
    sezione(k, t('tesoreria.voci'), p.voci.length ? tabella(k, [t('tesoreria.data'), t('tesoreria.tipo'), t('tesoreria.descrizione'), t('tesoreria.importo')],
      p.voci.map(v => [data(v.data), t('tesoreria.voce-' + v.tipo), v.ritardo ? `${v.descrizione} (${t('tesoreria.ritardo-medio', { n: v.ritardo })})` : v.descrizione, soldi(v.importo)]), { destra: [3] }) : h('p.nota', t('tesoreria.niente-voci')),
      imp.sezioni.previsioni ? h('p.nota', h('a', { href: '#/e/previsioni_cassa', testo: t('tesoreria.aggiungi-previsione') })) : null));
}

// ---------- solleciti ----------
async function solleciti(dove, k) {
  const { h, get, api, toast } = k;
  const l = await get('/tesoreria/solleciti');
  const segna = async s => { try { await api('POST', '/tesoreria/solleciti', { cliente: s.cliente, livello: s.livello, chiavi: s.scadenze.map(x => x.chiave) }); toast(t('tesoreria.sollecito-segnato')); solleciti(dove, k); } catch (e) { toast(e.message, true); } };
  metti(dove, l.length ? l.map(s => sezione(k, null,
    h('div.tesoreria-mov-testa', h('b', s.nome), h('span.tesoreria-segno', { class: s.livello >= 2 ? 'rosso' : '' }, s.livello > 0 ? t('tesoreria.livello-' + s.livello) : t('tesoreria.appena-sollecitato')),
      h('span.tesoreria-spazio'), h('span', t('tesoreria.ritardo-giorni', { n: s.ritardo })), h('b', soldi(s.totale))),
    h('ul.tesoreria-elenco', s.scadenze.map(x => h('li', h('time', data(x.data)), h('span', x.descrizione), h('b', soldi(x.residuo))))),
    s.ultimo ? h('p.nota', t('tesoreria.ultimo-sollecito', { data: data(s.ultimo.data), livello: s.ultimo.livello })) : null,
    s.livello > 0 ? [h('textarea.campo.tesoreria-lettera', { readonly: true, rows: 9, value: s.testo, 'aria-label': t('tesoreria.lettera') }),
      h('div.tesoreria-azioni', h('button.btn', { testo: t('tesoreria.copia'), on: { click: async () => { try { await navigator.clipboard.writeText(s.testo); toast(t('tesoreria.copiato')); } catch { toast(t('tesoreria.copia-no'), true); } } } }),
        s.email ? h('a.btn', { href: `mailto:${encodeURIComponent(s.email)}?subject=${encodeURIComponent(t('tesoreria.oggetto-sollecito'))}&body=${encodeURIComponent(s.testo)}`, testo: t('tesoreria.scrivi-email') }) : null,
        h('button.btn.pieno', { testo: t('tesoreria.segna-mandato'), on: { click: () => segna(s) } }))] : null)) : sezione(k, null, h('p.nota', t('tesoreria.niente-solleciti'))));
}

// ---------- distinte ----------
async function distinte(dove, k) {
  const { h, get, api, toast } = k;
  const l = await get('/tesoreria/distinte');
  const incassa = async d => { const quando = prompt(t('tesoreria.data-accredito'), oggi()); if (!quando) return; try { await api('POST', `/tesoreria/distinte/${d.id}/incassata`, { data: quando }); toast(t('tesoreria.distinta-chiusa')); distinte(dove, k); } catch (e) { toast(e.message, true); } };
  metti(dove, sezione(k, null, l.length ? tabella(k, [t('tesoreria.distinta'), t('tesoreria.creata'), t('tesoreria.quante'), t('tesoreria.importo'), t('tesoreria.stato'), ''],
    l.map(d => [d.nome, data(d.creata.slice(0, 10)), d.chiavi.length, soldi(d.totale), d.incassata ? (d.tipo === 'sct' ? t('tesoreria.pagata-il', { data: data(d.incassata) }) : t('tesoreria.accreditata-il', { data: data(d.incassata) })) : t('tesoreria.in-attesa'),
      h('span.tesoreria-riga-azioni', h('a.btn.piccolo', { href: `/api/tesoreria/distinte/${d.id}/file`, download: d.file, testo: t('tesoreria.scarica') }),
        d.incassata ? null : h('button.btn.piccolo', { testo: d.tipo === 'sct' ? t('tesoreria.segna-pagati') : t('tesoreria.segna-accreditata'), on: { click: () => incassa(d) } }))]), { destra: [2, 3] }) : h('p.nota', t('tesoreria.niente-distinte'))),
    h('p.nota', t('tesoreria.nota-distinte')));
}

// ---------- impostazioni ----------
async function impostazioni(dove, k, imp) {
  const { h, api, toast } = k;
  const campo = (id, etichetta, valore, extra = {}) => h('label.tesoreria-campo', h('span', etichetta), h('input.campo', { name: id, value: valore ?? '', ...extra }));
  const modulo = h('form.tesoreria-modulo', { on: { submit: async ev => {
    ev.preventDefault(); const f = new FormData(modulo);
    const corpo = { sia: f.get('sia'), bic: f.get('bic'), idCreditore: f.get('idCreditore'), saldo: f.get('saldo') === '' ? null : f.get('saldo'), saldoData: f.get('saldoData') || null,
      sequenzaSdd: f.get('sequenzaSdd'), ritardoClienti: f.get('ritardoClienti') === 'on', sezioneMovimenti: f.get('sezioneMovimenti') };
    try { await api('PUT', '/tesoreria/impostazioni', corpo); toast(t('tesoreria.salvate')); } catch (e) { toast(e.message, true); }
  } } },
    campo('sia', t('tesoreria.sia'), imp.sia, { maxlength: 5, placeholder: 'A1B2C' }),
    campo('bic', t('tesoreria.bic'), imp.bic, { maxlength: 11 }),
    campo('idCreditore', t('tesoreria.id-creditore'), imp.idCreditore, { placeholder: imp.idCreditoreProposto }),
    campo('saldo', t('tesoreria.saldo-banca'), imp.saldo, { inputmode: 'decimal' }),
    campo('saldoData', t('tesoreria.saldo-data'), imp.saldoData, { type: 'date' }),
    h('label.tesoreria-campo', h('span', t('tesoreria.sequenza-sdd')), h('select.campo', { name: 'sequenzaSdd' }, ['RCUR', 'FRST', 'OOFF'].map(x => h('option', { value: x, testo: t('tesoreria.seq-' + x.toLowerCase()), selected: x === imp.sequenzaSdd })))),
    campo('sezioneMovimenti', t('tesoreria.sezione-movimenti'), imp.sezioneMovimenti),
    h('label.tesoreria-spunta', h('input', { type: 'checkbox', name: 'ritardoClienti', checked: imp.ritardoClienti }), t('tesoreria.ritardo-clienti')),
    imp.puo.impostazioni ? h('div.tesoreria-azioni', h('button.btn.pieno', { type: 'submit', testo: t('tesoreria.salva') })) : h('p.nota', t('tesoreria.chiedi-titolare')));
  const manca = ['movimenti', 'previsioni'].filter(x => !imp.sezioni[x]);
  metti(dove,
    sezione(k, t('tesoreria.banca-azienda'), h('p', imp.azienda.iban ? t('tesoreria.iban-azienda', { iban: imp.azienda.iban }) : t('tesoreria.manca-iban')), h('p.nota', h('a', { href: '#/documenti', testo: t('tesoreria.dati-azienda') }))),
    sezione(k, t('tesoreria.scheda-impostazioni'), modulo, h('p.nota', t('tesoreria.nota-sia'))),
    sezione(k, t('tesoreria.sezioni'), h('p', manca.length ? t('tesoreria.sezioni-mancano') : t('tesoreria.sezioni-ci-sono')), manca.length ? prepara(k, imp, () => impostazioni(dove, k, imp)) : null),
    sezione(k, t('tesoreria.termini'), h('p', t('tesoreria.termini-nota')), h('p.mono', imp.termini.join(' · '))));
}

export default {
  nome: 'tesoreria',
  lato: k => (k.schema.some(e => ['fatture', 'fatture_ricevute'].includes(e.id)) ? [{ href: '#/tesoreria', icona: 'cassa', nome: t('tesoreria.titolo'), inCima: true }] : []),
  rotte: { tesoreria: (contenuto, k, a) => pagina(contenuto, k, a || '') },
};
