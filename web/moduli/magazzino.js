// Il magazzino nell'interfaccia (#/magazzino/<scheda>): valore al costo per categoria, inventario fisico con le conte (anche
// col lettore: il campo «Leggi un codice» aggiunge 1 a ogni lettura) e il registro dei movimenti. I conti li fa il server
// (server/moduli/magazzino.js). Tutti i dati entrano come testo (h()).
import { t, soldi, numero, dataOra } from '../lingua.js';

const SCHEDE = ['', 'inventario', 'movimenti'];
let cssCaricato = false, sezioneScelta = null;
const caricaCss = () => { if (cssCaricato) return; cssCaricato = true; document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/magazzino.css' })); };
const metti = (dove, ...x) => dove.replaceChildren(...x.flat().filter(Boolean));

async function pagina(contenuto, k, scheda = '', id = '') {
  caricaCss();
  const { h, get } = k;
  const corpo = h('div.corpo.magazzino');
  const sezioni = await get('/magazzino/sezioni').catch(() => []);
  if (!sezioni.some(s => s.id === sezioneScelta)) sezioneScelta = sezioni[0]?.id || null;
  const scegli = sezioni.length > 1 ? h('select.campo.magazzino-sezione', { 'aria-label': t('magazzino.sezione'), on: { change: ev => { sezioneScelta = ev.target.value; pagina(contenuto, k, scheda); } } },
    sezioni.map(s => h('option', { value: s.id, testo: s.nome, selected: s.id === sezioneScelta }))) : null;
  const schede = h('nav.magazzino-schede', SCHEDE.map(s => h('a', { href: '#/magazzino' + (s ? '/' + s : ''), class: s === scheda ? 'si' : '', testo: t('magazzino.scheda-' + (s || 'valore')) })));
  contenuto.replaceChildren(h('div.testa', h('h1', t('magazzino.titolo')), scegli), h('div.magazzino-barra', schede), corpo);
  if (!sezioneScelta) return metti(corpo, sezione(k, null, h('p.nota', t('magazzino.nessuna-sezione'))));
  const s = sezioni.find(x => x.id === sezioneScelta);
  const vista = scheda === 'inventario' ? (id ? conte : elencoInventari) : scheda === 'movimenti' ? registro : valore;
  vista(corpo, k, s, id).catch(e => metti(corpo, h('div.avviso', e.message)));
}
const sezione = (k, titolo, ...figli) => k.h('section.magazzino-scheda', titolo ? k.h('h2', titolo) : null, ...figli);
const cifra = (k, et, v, nota, cls = '') => k.h('div.magazzino-cifra', { class: cls }, k.h('span', et), k.h('b', v), nota ? k.h('small', nota) : null);
function tabella(k, intest, righe, { destra = [] } = {}) {
  const { h } = k;
  return h('div.magazzino-tabella', h('table.tabella', h('thead', h('tr', intest.map((x, i) => h('th', { class: destra.includes(i) ? 'num' : '' }, x)))),
    h('tbody', righe.map(r => h('tr', r.map((c, i) => h('td', { class: destra.includes(i) ? 'num' : '' }, c ?? '')))))));
}

// ---------- valore ----------
async function valore(dove, k, s) {
  const { h, get } = k;
  const v = await get(`/magazzino/valore?sezione=${encodeURIComponent(s.id)}`);
  metti(dove,
    h('div.magazzino-cifre', cifra(k, t('magazzino.valore'), soldi(v.totale), t('magazzino.al-costo')), cifra(k, t('magazzino.pezzi'), numero(v.pezzi), t('magazzino.articoli-n', { n: v.articoli.length })),
      cifra(k, t('magazzino.sotto-scorta'), numero(v.sottoScorta), null, v.sottoScorta ? 'attenzione' : '')),
    v.negativi.length ? h('div.magazzino-avviso', t('magazzino.negativi', { n: v.negativi.length, nomi: v.negativi.slice(0, 5).map(x => x.nome).join(', ') })) : null,
    v.senzaCosto ? h('div.magazzino-avviso', t('magazzino.senza-costo', { n: v.senzaCosto })) : null,
    v.categorie.length > 1 ? sezione(k, t('magazzino.per-categoria'), tabella(k, [t('magazzino.categoria'), t('magazzino.articoli'), t('magazzino.pezzi'), t('magazzino.valore')],
      v.categorie.map(c => [c.categoria || t('magazzino.senza-categoria'), numero(c.articoli), numero(c.pezzi), soldi(c.valore)]), { destra: [1, 2, 3] })) : null,
    sezione(k, t('magazzino.per-articolo'), tabella(k, [t('magazzino.codice'), t('magazzino.articolo'), t('magazzino.giacenza'), t('magazzino.costo'), t('magazzino.valore')],
      v.articoli.slice(0, 300).map(a => [a.codice, h('a', { href: `#/e/${s.id}/${a.id}`, testo: a.nome }), h('span', { class: a.giacenza < 0 ? 'magazzino-meno' : '' }, numero(a.giacenza)), soldi(a.costo), soldi(a.valore)]), { destra: [2, 3, 4] }),
      h('div.magazzino-azioni', h('a.btn', { href: `/api/magazzino/valore.csv?sezione=${encodeURIComponent(s.id)}`, download: '', testo: t('magazzino.scarica-csv') }), h('span.nota', t('magazzino.nota-valore')))));
}

// ---------- inventario ----------
async function elencoInventari(dove, k, s) {
  const { h, get, api, toast } = k;
  const l = (await get('/magazzino/inventari')).filter(i => i.sezione === s.id), aperto = l.find(i => !i.chiuso);
  const nuovo = async () => { try { const x = await api('POST', '/magazzino/inventari', { sezione: s.id }); location.hash = `#/magazzino/inventario/${x.id}`; } catch (e) { toast(e.message, true); } };
  metti(dove,
    sezione(k, null, h('p', t('magazzino.inventario-nota')),
      h('div.magazzino-azioni', aperto ? h('a.btn.pieno', { href: `#/magazzino/inventario/${aperto.id}`, testo: t('magazzino.continua', { nome: aperto.nome }) })
        : s.modifica ? h('button.btn.pieno', { testo: t('magazzino.nuovo-inventario'), on: { click: nuovo } }) : null)),
    l.length ? sezione(k, t('magazzino.inventari'), tabella(k, [t('magazzino.nome'), t('magazzino.iniziato'), t('magazzino.contati'), t('magazzino.stato')],
      l.map(i => [h('a', { href: `#/magazzino/inventario/${i.id}`, testo: i.nome }), dataOra(i.creato), `${numero(i.contate)} / ${numero(i.righe)}`, i.chiuso ? t('magazzino.chiuso-il', { data: dataOra(i.chiuso) }) : t('magazzino.aperto')]), { destra: [2] })) : null);
}
async function conte(dove, k, s, id) {
  const { h, get, api, toast } = k;
  const inv = await get(`/magazzino/inventari/${encodeURIComponent(id)}`);
  const ridisegna = () => conte(dove, k, s, id);
  const aperto = !inv.chiuso;
  const lettore = h('input.campo', { placeholder: t('magazzino.leggi-codice'), autocomplete: 'off', 'aria-label': t('magazzino.leggi-codice'), on: { keydown: async ev => {
    if (ev.key !== 'Enter' || !ev.target.value.trim()) return;
    const codice = ev.target.value.trim(); ev.target.value = '';
    try { const x = await api('POST', `/magazzino/inventari/${id}/conta`, { codice }); const r = inv.righe.find(y => y.articolo === x.articolo); toast(t('magazzino.letto', { nome: r?.nome || codice, n: numero(x.contata) })); if (r) { r.contata = x.contata; disegna(); } }
    catch (e) { toast(e.message, true); }
  } } });
  const cerca = h('input.campo', { type: 'search', placeholder: t('magazzino.cerca'), on: { input: () => disegna() } });
  const corpoTab = h('div');
  const salva = async (r, v) => { try { await api('POST', `/magazzino/inventari/${id}/conta`, { conte: [{ articolo: r.articolo, contata: v === '' ? null : Number(v) }] }); r.contata = v === '' ? null : Number(v); disegna(); } catch (e) { toast(e.message, true); } };
  function disegna() {
    const q = cerca.value.trim().toLowerCase(), l = inv.righe.filter(r => !q || `${r.nome} ${r.codice} ${r.barcode}`.toLowerCase().includes(q));
    metti(corpoTab, tabella(k, [t('magazzino.codice'), t('magazzino.articolo'), t('magazzino.attesa'), t('magazzino.contata'), t('magazzino.differenza')],
      l.slice(0, 500).map(r => { const d = r.contata == null ? null : r.contata - r.attesa;
        return [r.codice || r.barcode, r.nome, numero(r.attesa), aperto ? h('input.campo.magazzino-q', { type: 'number', min: 0, step: 'any', value: r.contata ?? '', 'aria-label': r.nome, on: { change: ev => salva(r, ev.target.value) } }) : (r.contata == null ? '—' : numero(r.contata)),
          d == null ? '' : h('b', { class: d < 0 ? 'magazzino-meno' : d > 0 ? 'magazzino-piu' : '' }, `${d > 0 ? '+' : ''}${numero(d)}`)]; }), { destra: [2, 3, 4] }));
  }
  const chiudi = async ev => {
    if (!confirm(t('magazzino.chiudi-conferma', { n: inv.righe.filter(r => r.contata != null && r.contata !== r.attesa).length }))) return;
    ev.target.disabled = true;
    try { const x = await api('POST', `/magazzino/inventari/${id}/chiudi`); toast(t('magazzino.chiuso', { n: x.rettifiche, importo: soldi(x.valore) })); ridisegna(); } catch (e) { toast(e.message, true); ev.target.disabled = false; }
  };
  metti(dove,
    h('div.magazzino-cifre', cifra(k, t('magazzino.contati'), `${numero(inv.contate)} / ${numero(inv.righe.length)}`), cifra(k, t('magazzino.differenze'), numero(inv.differenze)),
      cifra(k, t('magazzino.valore-differenze'), soldi(inv.valoreDifferenze), null, inv.valoreDifferenze < 0 ? 'attenzione' : '')),
    sezione(k, inv.nome, aperto ? h('div.magazzino-filtri', lettore, cerca) : h('p.nota', t('magazzino.chiuso-il', { data: dataOra(inv.chiuso) })), corpoTab,
      aperto ? h('div.magazzino-azioni', h('button.btn.pieno', { testo: t('magazzino.chiudi'), on: { click: chiudi } }), h('span.nota', t('magazzino.chiudi-nota'))) : null));
  disegna();
  if (aperto) lettore.focus();
}

// ---------- movimenti ----------
async function registro(dove, k, s) {
  const { h, get } = k;
  const m = await get(`/magazzino/movimenti?sezione=${encodeURIComponent(s.id)}`);
  metti(dove, sezione(k, null, m.length ? tabella(k, [t('magazzino.quando'), t('magazzino.articolo'), t('magazzino.movimento'), t('magazzino.giacenza'), t('magazzino.origine'), t('magazzino.chi')],
    m.map(x => [dataOra(x.quando), h('a', { href: `#/e/${s.id}/${x.articolo}`, testo: x.nome }), h('b', { class: x.quantita < 0 ? 'magazzino-meno' : 'magazzino-piu' }, `${x.quantita > 0 ? '+' : ''}${numero(x.quantita)}`),
      numero(x.giacenza), t('magazzino.origine-' + x.origine), x.utente || '']), { destra: [2, 3] }) : h('p.nota', t('magazzino.niente-movimenti')), h('p.nota', t('magazzino.nota-movimenti'))));
}

export default {
  nome: 'magazzino',
  lato: k => (k.schema.some(e => e.campi?.some(c => c.id === 'giacenza')) ? [{ href: '#/magazzino', icona: 'scatola', nome: t('magazzino.titolo') }] : []),
  rotte: { magazzino: (contenuto, k, a, b) => pagina(contenuto, k, a || '', b || '') },
};
