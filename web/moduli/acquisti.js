// Gli acquisti nell'interfaccia (#/acquisti/<scheda>): cosa riordinare (con le quantità da ritoccare), ordini in arrivo con
// il ricevimento della merce anche in parte, ordini da abbinare alla fattura del fornitore. I conti li fa il server
// (server/moduli/acquisti.js). Tutti i dati entrano come testo (h()).
import { t, soldi, data, numero } from '../lingua.js';

const SCHEDE = ['', 'arrivo', 'fatture'];
let cssCaricato = false;
const caricaCss = () => { if (cssCaricato) return; cssCaricato = true; document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/acquisti.css' })); };
const metti = (dove, ...x) => dove.replaceChildren(...x.flat().filter(Boolean));
const oggi = () => new Date().toISOString().slice(0, 10);

function pagina(contenuto, k, scheda = '', id = '') {
  caricaCss();
  const { h } = k;
  const corpo = h('div.corpo.acquisti');
  const schede = h('nav.acquisti-schede', SCHEDE.map(s => h('a', { href: '#/acquisti' + (s ? '/' + s : ''), class: s === scheda ? 'si' : '', testo: t('acquisti.scheda-' + (s || 'riordino')) })));
  contenuto.replaceChildren(h('div.testa', h('h1', t('acquisti.titolo'))), h('div.acquisti-barra', schede), corpo);
  k.get('/acquisti/impostazioni').then(imp => {
    if (!imp.pronti) return prepara(corpo, k, imp, () => pagina(contenuto, k, scheda, id));
    if (scheda === 'ricevi' && id) return ricevi(corpo, k, id);
    if (scheda === 'confronto' && id) return confronto(corpo, k, id);
    return ({ '': riordino, arrivo, fatture }[scheda] || riordino)(corpo, k, imp);
  }).catch(e => metti(corpo, h('div.avviso', e.message)));
}
const sezione = (k, titolo, ...figli) => k.h('section.acquisti-scheda', titolo ? k.h('h2', titolo) : null, ...figli);
function tabella(k, intest, righe, { destra = [] } = {}) {
  const { h } = k;
  return h('div.acquisti-tabella', h('table.tabella', h('thead', h('tr', intest.map((x, i) => h('th', { class: destra.includes(i) ? 'num' : '' }, x)))),
    h('tbody', righe.map(r => h('tr', r.map((c, i) => h('td', { class: destra.includes(i) ? 'num' : '' }, c ?? '')))))));
}

function prepara(dove, k, imp, dopo) {
  const { h, api, toast } = k;
  if (!imp.magazzini.length) return metti(dove, sezione(k, null, h('p', t('acquisti.serve-magazzino'))));
  if (!imp.puo.prepara) return metti(dove, sezione(k, null, h('p', t('acquisti.non-pronti')), h('p.nota', t('acquisti.chiedi-titolare'))));
  const scelta = h('select.campo', { 'aria-label': t('acquisti.magazzino') }, imp.magazzini.map(m => h('option', { value: m.id, testo: m.nome, selected: m.id === imp.articoliProposti })));
  metti(dove, sezione(k, t('acquisti.prepara-titolo'), h('p', t('acquisti.prepara-nota')), h('label.acquisti-campo', h('span', t('acquisti.magazzino')), scelta),
    h('div.acquisti-azioni', h('button.btn.pieno', { testo: t('acquisti.prepara'), on: { click: async () => {
      try { const x = await api('POST', '/acquisti/prepara', { articoli: scelta.value }); await k.ricaricaSchema(); toast(t('acquisti.preparati', { n: x.fatto.length })); dopo(); } catch (e) { toast(e.message, true); }
    } } }))));
}

// ---------- da riordinare ----------
async function riordino(dove, k) {
  const { h, get, api, toast } = k;
  const r = await get('/acquisti/riordino'), fornitori = await get('/dati/fornitori?n=500').then(x => x.righe).catch(() => []);
  if (!r.gruppi.length) return metti(dove, sezione(k, null, h('p.nota', t('acquisti.niente-riordino'))));
  const scelte = new Map();   // articolo → { quantita, fornitore }
  const blocchi = r.gruppi.map(g => {
    const scegliFornitore = g.fornitore ? null : h('select.campo.piccolo', { 'aria-label': t('acquisti.fornitore') }, h('option', { value: '', testo: t('acquisti.scegli-fornitore') }), fornitori.map(f => h('option', { value: f.id, testo: f.nome })));
    const righe = g.righe.map(x => {
      scelte.set(x.articolo.id, { quantita: x.proposta, fornitore: g.fornitore?.id || null, si: !!g.fornitore });
      const sp = h('input', { type: 'checkbox', checked: !!g.fornitore, 'aria-label': x.articolo.nome, on: { change: ev => { scelte.get(x.articolo.id).si = ev.target.checked; } } });
      const q = h('input.campo.piccolo.acquisti-q', { type: 'number', min: 0, step: 'any', value: x.proposta, 'aria-label': t('acquisti.da-ordinare'), on: { input: ev => { scelte.get(x.articolo.id).quantita = Number(ev.target.value); } } });
      return [sp, h('a', { href: `#/e/${r.articoli}/${x.articolo.id}`, testo: x.articolo.nome }), numero(x.giacenza), numero(x.soglia), x.in_arrivo ? numero(x.in_arrivo) : '', q, soldi(x.costo)];
    });
    if (scegliFornitore) scegliFornitore.addEventListener('change', () => { for (const x of g.righe) { const s = scelte.get(x.articolo.id); s.fornitore = scegliFornitore.value || null; s.si = !!scegliFornitore.value; } });
    return sezione(k, g.fornitore ? g.fornitore.nome : t('acquisti.senza-fornitore'),
      scegliFornitore ? h('div.acquisti-azioni', h('span.nota', t('acquisti.senza-fornitore-nota')), scegliFornitore) : null,
      tabella(k, ['', t('acquisti.articolo'), t('acquisti.giacenza'), t('acquisti.soglia'), t('acquisti.in-arrivo'), t('acquisti.da-ordinare'), t('acquisti.costo')], righe, { destra: [2, 3, 4, 5, 6] }),
      g.fornitore ? h('p.nota', t('acquisti.totale-stimato', { importo: soldi(g.totale) })) : null);
  });
  const crea = async () => {
    const righe = [...scelte].filter(([, s]) => s.si && s.quantita > 0).map(([articolo, s]) => ({ articolo, quantita: s.quantita, ...(s.fornitore ? { fornitore: s.fornitore } : {}) }));
    if (!righe.length) return toast(t('acquisti.niente-scelto'), true);
    try { const o = await api('POST', '/acquisti/ordini', { righe }); toast(t('acquisti.ordini-creati', { n: o.length })); riordino(dove, k); } catch (e) { toast(e.message, true); }
  };
  metti(dove, h('p.nota', t('acquisti.riordino-nota')), blocchi, h('div.acquisti-azioni', h('button.btn.pieno', { testo: t('acquisti.crea-ordini'), on: { click: crea } }), h('span.nota', t('acquisti.crea-nota'))));
}

// ---------- in arrivo ----------
async function arrivo(dove, k, imp) {
  const { h, get } = k;
  const l = await get('/acquisti/arrivo');
  metti(dove, l.length ? l.map(o => sezione(k, null,
    h('div.acquisti-testa', h('a', { href: `#/e/${imp.ordini}/${o.id}`, testo: o.numero || '—' }), h('b', o.fornitore.nome), h('span.acquisti-segno', { class: o.stato === 'parziale' ? 'giallo' : '' }, t('acquisti.stato-' + o.stato)),
      o.in_ritardo ? h('span.acquisti-segno.rosso', t('acquisti.in-ritardo', { data: data(o.consegna_prevista) })) : o.consegna_prevista ? h('span.nota', t('acquisti.previsto', { data: data(o.consegna_prevista) })) : null,
      h('span.acquisti-spazio'), h('a.btn.pieno.piccolo', { href: `#/acquisti/ricevi/${o.id}`, testo: t('acquisti.ricevi') })),
    h('ul.acquisti-righe', o.righe.map(r => h('li', h('span', r.articolo.nome), h('span.acquisti-barretta', h('i', { style: `width:${r.quantita ? Math.min(100, (r.ricevuta / r.quantita) * 100) : 0}%` })),
      h('small', t('acquisti.ricevute-di', { ricevuta: numero(r.ricevuta), quantita: numero(r.quantita) }))))))) : sezione(k, null, h('p.nota', t('acquisti.niente-arrivo'))));
}

async function ricevi(dove, k, id) {
  const { h, get, api, toast } = k;
  const c = await get(`/acquisti/ordini/${id}/confronto`), o = c.ordine;
  if (['arrivato', 'annullato'].includes(o.stato)) return metti(dove, sezione(k, null, h('p.nota', t('acquisti.ordine-chiuso')), h('a', { href: `#/acquisti/confronto/${id}`, testo: t('acquisti.vedi-confronto') })));
  const campi = c.righe.filter(r => r.manca > 0).map(r => ({ r, input: h('input.campo.piccolo.acquisti-q', { type: 'number', min: 0, max: r.manca, step: 'any', value: r.manca, 'aria-label': r.articolo }) }));
  const ddt = h('input.campo', { placeholder: t('acquisti.ddt-segnaposto'), maxlength: 60 }), quando = h('input.campo', { type: 'date', value: oggi() });
  const conferma = async ev => {
    ev.target.disabled = true;
    const righe = campi.map(x => ({ riga: x.r.id, quantita: Number(x.input.value) || 0 })).filter(x => x.quantita > 0);
    try { const x = await api('POST', `/acquisti/ordini/${id}/ricevi`, { righe, ddt: ddt.value, data: quando.value }); toast(x.stato === 'arrivato' ? t('acquisti.ricevuto-tutto') : t('acquisti.ricevuto-parte')); location.hash = '#/acquisti/arrivo'; }
    catch (e) { toast(e.message, true); ev.target.disabled = false; }
  };
  metti(dove, sezione(k, t('acquisti.ricevi-titolo', { numero: o.numero, fornitore: o.fornitore }),
    h('div.acquisti-modulo', h('label.acquisti-campo', h('span', t('acquisti.ddt')), ddt), h('label.acquisti-campo', h('span', t('acquisti.data')), quando)),
    tabella(k, [t('acquisti.articolo'), t('acquisti.ordinate'), t('acquisti.gia-ricevute'), t('acquisti.arrivate-ora')], campi.map(x => [x.r.articolo, numero(x.r.quantita), numero(x.r.ricevuta), x.input]), { destra: [1, 2, 3] }),
    h('p.nota', t('acquisti.ricevi-nota')),
    h('div.acquisti-azioni', h('button.btn.pieno', { testo: t('acquisti.carica'), on: { click: conferma } }), h('a.btn', { href: '#/acquisti/arrivo', testo: t('acquisti.annulla') }))));
}

// ---------- fatture dei fornitori ----------
async function fatture(dove, k, imp) {
  const { h, get } = k;
  if (!imp.fatture) return metti(dove, sezione(k, null, h('p.nota', t('acquisti.senza-fatture'))));
  const l = await get('/acquisti/fatture');
  metti(dove, sezione(k, null, l.length ? tabella(k, [t('acquisti.ordine'), t('acquisti.fornitore'), t('acquisti.ricevuto'), t('acquisti.fattura-proposta'), ''],
    l.map(o => [o.numero, o.fornitore, soldi(o.ricevuto), o.candidata ? h('span', { class: o.candidata.torna ? 'acquisti-ok' : 'acquisti-no' }, t('acquisti.candidata', { numero: o.candidata.numero, importo: soldi(o.candidata.imponibile) })) : t('acquisti.nessuna-fattura'),
      h('a.btn.piccolo', { href: `#/acquisti/confronto/${o.id}`, testo: t('acquisti.confronta') })]), { destra: [2] }) : h('p.nota', t('acquisti.tutto-fatturato'))),
    h('p.nota', t('acquisti.fatture-nota')));
}
async function confronto(dove, k, id) {
  const { h, get, api, toast } = k;
  const c = await get(`/acquisti/ordini/${id}/confronto`);
  const abbina = async f => { try { await api('POST', `/acquisti/ordini/${id}/fattura`, { fattura: f }); toast(f ? t('acquisti.abbinata') : t('acquisti.tolta')); confronto(dove, k, id); } catch (e) { toast(e.message, true); } };
  const cifra = (et, v, cls = '') => h('div.acquisti-cifra', { class: cls }, h('span', et), h('b', v));
  metti(dove,
    h('div.acquisti-cifre', cifra(t('acquisti.ordinato'), soldi(c.ordinato)), cifra(t('acquisti.ricevuto'), soldi(c.ricevuto)),
      c.fattura ? cifra(t('acquisti.fatturato'), soldi(c.fattura.imponibile), c.fattura.torna ? '' : 'attenzione') : cifra(t('acquisti.fatturato'), '—')),
    sezione(k, t('acquisti.confronto-titolo', { numero: c.ordine.numero, fornitore: c.ordine.fornitore }),
      tabella(k, [t('acquisti.articolo'), t('acquisti.ordinate'), t('acquisti.gia-ricevute'), t('acquisti.costo')], c.righe.map(r => [r.articolo, numero(r.quantita), numero(r.ricevuta), soldi(r.costo)]), { destra: [1, 2, 3] }),
      c.fattura ? h('p', { class: c.fattura.torna ? 'acquisti-ok' : 'acquisti-no' }, c.fattura.torna ? t('acquisti.torna', { numero: c.fattura.numero }) : t('acquisti.non-torna', { numero: c.fattura.numero, importo: soldi(c.fattura.differenza) }),
        ' ', h('button.btn.piccolo.nudo', { testo: t('acquisti.togli'), on: { click: () => abbina(null) } })) : null),
    !c.fattura ? sezione(k, t('acquisti.candidate'), c.candidate.length ? tabella(k, [t('acquisti.fattura'), t('acquisti.data'), t('acquisti.imponibile'), t('acquisti.differenza'), ''],
      c.candidate.map(f => [f.numero, data(f.data), soldi(f.imponibile), h('span', { class: f.torna ? 'acquisti-ok' : 'acquisti-no' }, soldi(f.differenza)), h('button.btn.piccolo', { testo: t('acquisti.abbina'), on: { click: () => abbina(f.id) } })]), { destra: [2, 3] })
      : h('p.nota', t('acquisti.nessuna-fattura'))) : null,
    c.ricevimenti.length ? sezione(k, t('acquisti.ricevimenti'), tabella(k, [t('acquisti.data'), t('acquisti.ddt'), t('acquisti.quantita')], c.ricevimenti.map(x => [data(x.data), x.ddt || '', numero(x.quantita)]), { destra: [2] })) : null);
}

const ORDINI = ['ordini', 'ordini_acquisto'];
export default {
  nome: 'acquisti',
  lato: k => (k.schema.some(e => e.campi?.some(c => c.id === 'giacenza')) ? [{ href: '#/acquisti', icona: 'furgone', nome: t('acquisti.titolo') }] : []),
  rotte: { acquisti: (contenuto, k, a, b) => pagina(contenuto, k, a || '', b || '') },
  azioniScheda(def, riga, k) {
    if (!ORDINI.includes(def.id) || !riga.id || !def.campi.some(c => c.id === 'fornitore')) return [];
    const out = [];
    if (['bozza', 'inviato', 'parziale'].includes(riga.stato)) out.push(k.h('a.btn', { href: `#/acquisti/ricevi/${riga.id}`, testo: t('acquisti.ricevi') }));
    if (['parziale', 'arrivato'].includes(riga.stato)) out.push(k.h('a.btn', { href: `#/acquisti/confronto/${riga.id}`, testo: t('acquisti.confronta') }));
    return out;
  },
};
