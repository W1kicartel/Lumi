// Fatture elettroniche complete nell'interfaccia: la pagina #/fatture con le fatture ricevute (import dei file .xml e
// .xml.p7m, quelle da integrare), il bollo virtuale per trimestre e il controllo della numerazione; sulle schede, «Vedi la
// fattura» e «Crea integrazione» per le ricevute e il segno «bloccata» sulle fatture emesse.
// Tutti i dati arrivano in textContent (h()), la fattura ricevuta in un iframe sandbox senza script.

import { t, soldi, data } from '../lingua.js';

let cssCaricato = false;
const caricaCss = () => { if (cssCaricato) return; cssCaricato = true; document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/fatture.css' })); };
const RICEVUTE = 'fatture_ricevute';
const MAX = 5 * 1024 * 1024;
const bloccata = r => r.numero && r.stato && r.stato !== 'bozza';

// ---------- la finestra con la fattura ricevuta ----------
function finestra(k, titolo, ...contenuto) {
  const { h } = k;
  const chiudi = () => { velo.remove(); document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', chiudi); };
  const esc = ev => { if (ev.key === 'Escape') chiudi(); };
  const velo = h('div.fatture-velo', { on: { click: ev => { if (ev.target === velo) chiudi(); } } },
    h('div.fatture-finestra', { role: 'dialog', 'aria-label': titolo },
      h('div.fatture-barra', h('b', titolo), h('span.fatture-spazio'), h('button.btn.nudo', { title: t('fatture.chiudi'), testo: '×', on: { click: chiudi } })), ...contenuto));
  document.addEventListener('keydown', esc); window.addEventListener('hashchange', chiudi); document.body.append(velo);
  return chiudi;
}
async function vedi(k, riga) {
  const { h, get, toast } = k;
  let v; try { v = await get(`/fatture/ricevute/${riga.id}/vista?lingua=${encodeURIComponent(document.documentElement.lang || 'it')}`); } catch (e) { return toast(e.message, true); }
  const f = h('iframe.fatture-foglio', { title: t('fatture.vista') }); f.setAttribute('sandbox', 'allow-same-origin allow-modals'); f.srcdoc = v.html;
  const stampa = h('button.btn', { testo: t('fatture.stampa'), on: { click: () => { f.contentWindow.focus(); f.contentWindow.print(); } } });
  finestra(k, riga.nome_documento || riga.numero || t('fatture.vista'), h('div.fatture-tavolo', f), h('div.fatture-piede', stampa));
}
async function integra(k, riga, bottone) {
  if (!confirm(t('fatture.integra-conferma', { numero: riga.numero || '' }))) return;
  if (bottone) bottone.disabled = true;
  try { const n = await k.api('POST', `/fatture/integrazione/${riga.id}`, {}); k.toast(t('fatture.integrazione-creata', { tipo: n.tipo })); location.hash = `#/e/fatture/${n.id}`; }
  catch (e) { k.toast(e.message, true); if (bottone) bottone.disabled = false; }
}

// ---------- la scheda di una fattura emessa ----------
// i campi si riconoscono dall'etichetta (il motore non mette l'id nel DOM); restano vivi solo quelli che il server accetta
const MODIFICABILI = new Set(['stato', 'pagata_il', 'note_interne', 'inviata_il', 'rate']);
function chiudiScheda(segno, def) {
  const testa = segno.closest('.testa'), scheda = testa?.parentElement; if (!scheda) return;
  testa.querySelector('.btn.pericolo')?.remove(); scheda.classList.add('fatture-chiusa');
  const perNome = new Map(def.campi.filter(c => !c.archiviato).map(c => [c.nome, c]));
  for (const blocco of scheda.querySelectorAll('.griglia > div')) {
    const c = perNome.get(String(blocco.querySelector(':scope > label.etichetta')?.firstChild?.textContent || '').trim());
    if (!c || MODIFICABILI.has(c.id)) continue;
    blocco.querySelectorAll('input,select,textarea,button').forEach(x => { x.disabled = true; });
  }
}

// ---------- import dei file ----------
const base64 = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(file); });
async function importa(k, files, esito) {
  const { h, api } = k;
  for (const file of files) {
    const riga = h('li', h('span.fatture-nome', file.name), h('span.nota', t('fatture.leggo')));
    esito.prepend(riga);
    if (!/\.(xml|p7m)$/i.test(file.name)) { riga.lastChild.replaceWith(h('span.fatture-no', t('fatture.solo-xml'))); continue; }
    if (file.size > MAX) { riga.lastChild.replaceWith(h('span.fatture-no', t('fatture.troppo-grande'))); continue; }
    try {
      const r = await api('POST', '/fatture/ricevute', { nome: file.name, dati: await base64(file) });
      const testo = [
        ...r.importate.map(x => t('fatture.importata', { numero: x.numero, data: data(x.data), totale: soldi(x.totale) })),
        ...r.saltate.map(x => t('fatture.gia-importata', { numero: x.numero })),
      ];
      riga.lastChild.replaceWith(h('span', h('b', r.fornitore.nome), r.fornitore.nuovo ? h('span.fatture-nuovo', t('fatture.fornitore-nuovo')) : null, ' · ', testo.join(' · '),
        r.avvisi?.includes('intestata-ad-altri') ? h('span.fatture-no', ' ', t('fatture.intestata-ad-altri')) : null));
      riga.classList.add('ok');
    } catch (e) { riga.lastChild.replaceWith(h('span.fatture-no', e.message)); }
  }
}
function zonaImport(k, dopo) {
  const { h } = k;
  const esito = h('ul.fatture-esito');
  const input = h('input', { type: 'file', multiple: true, accept: '.xml,.p7m,application/xml,application/pkcs7-mime', hidden: true,
    on: { change: async () => { const f = [...input.files]; input.value = ''; await importa(k, f, esito); dopo?.(); } } });
  const zona = h('div.fatture-zona', { tabindex: 0, role: 'button', on: {
    click: () => input.click(), keydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } },
    dragover: ev => { ev.preventDefault(); zona.classList.add('sopra'); }, dragleave: () => zona.classList.remove('sopra'),
    drop: async ev => { ev.preventDefault(); zona.classList.remove('sopra'); await importa(k, [...ev.dataTransfer.files], esito); dopo?.(); },
  } }, k.icona('documento'), h('b', t('fatture.trascina')), h('span.nota', t('fatture.trascina-nota')), input);
  return h('div', zona, esito);
}

// ---------- la pagina ----------
function pagina(contenuto, k, sezione) {
  const { h } = k;
  caricaCss();
  const voce = (id, testo) => h('a', { href: id ? `#/fatture/${id}` : '#/fatture', class: (sezione || '') === id ? 'si' : '', testo });
  const corpo = h('div.corpo');
  contenuto.replaceChildren(h('div.testa', h('h1', t('fatture.titolo')), h('div.fatture-schede', voce('', t('fatture.ricevute')), voce('bollo', t('fatture.bollo')), voce('numerazione', t('fatture.numerazione')))), corpo);
  if (sezione === 'bollo') return bollo(corpo, k, new Date().getFullYear());
  if (sezione === 'numerazione') return numerazione(corpo, k, new Date().getFullYear());
  return ricevute(corpo, k);
}

async function ricevute(corpo, k) {
  const { h, get } = k;
  const def = k.schema.find(e => e.id === RICEVUTE);
  if (!def) { corpo.replaceChildren(h('div.vuoto', t('fatture.manca-modello'))); return; }
  const daIntegrare = h('div');
  const carica = async () => {
    let l; try { l = (await get(`/dati/${RICEVUTE}?n=200&o=data:desc`)).righe; } catch (e) { daIntegrare.replaceChildren(h('div.avviso', e.message)); return; }
    const aperte = l.filter(r => r.inversione && !r.integrata), dapagare = l.filter(r => r.stato === 'da_pagare');
    const tabella = (righe, azione) => h('div.fatture-scorre', h('table.tabella', h('tbody', righe.map(r => h('tr',
      h('td', h('a', { href: `#/e/${RICEVUTE}/${r.id}`, testo: r.numero })), h('td', r.fornitore?.titolo || ''), h('td', data(r.data)),
      h('td.num', soldi(r.netto ?? r.totale ?? 0)), h('td', r.scadenza ? data(r.scadenza) : ''), h('td.num', azione(r)))))));
    daIntegrare.replaceChildren(
      h('h2.fatture-sotto', t('fatture.da-integrare'), h('span.nota', ' ', String(aperte.length))),
      aperte.length ? tabella(aperte, r => h('button.btn.piccolo', { testo: t('fatture.crea-integrazione'), on: { click: ev => integra(k, r, ev.target) } })) : h('p.nota', t('fatture.niente-da-integrare')),
      h('h2.fatture-sotto', t('fatture.da-pagare'), h('span.nota', ' ', soldi(dapagare.reduce((s, r) => s + (r.netto ?? r.totale ?? 0), 0)))),
      dapagare.length ? tabella(dapagare, r => h('button.btn.piccolo', { testo: t('fatture.vedi'), on: { click: () => vedi(k, r) } })) : h('p.nota', t('fatture.niente-da-pagare')),
      h('p', h('a', { href: `#/e/${RICEVUTE}`, testo: t('fatture.tutte-le-ricevute') })));
  };
  corpo.replaceChildren(h('div.foglio', h('p.nota', t('fatture.ricevute-nota')), def.puo?.crea === false ? null : zonaImport(k, carica)), daIntegrare);
  carica();
}

async function bollo(corpo, k, anno) {
  const { h, get } = k;
  let b; try { b = await get(`/fatture/bollo?anno=${anno}`); } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; }
  const anni = h('div.fatture-anni', h('button.btn.nudo', { testo: '←', title: String(anno - 1), on: { click: () => bollo(corpo, k, anno - 1) } }), h('b', String(anno)),
    h('button.btn.nudo', { testo: '→', title: String(anno + 1), on: { click: () => bollo(corpo, k, anno + 1) } }));
  corpo.replaceChildren(h('div.foglio', anni, h('div.fatture-scorre',
    h('table.tabella', h('thead', h('tr', h('th', t('fatture.trimestre')), h('th.num', t('fatture.fatture-con-bollo')), h('th.num', t('fatture.da-versare')), h('th', t('fatture.entro')), h('th', t('fatture.codice-tributo')))),
      h('tbody', b.trimestri.map(x => h('tr', h('td', t('fatture.trimestre-n', { n: x.trimestre })), h('td.num', String(x.fatture)), h('td.num', soldi(x.importo)), h('td', x.importo ? data(x.scadenza) : '—'), h('td', x.tributo)))),
      h('tfoot', h('tr', h('td', t('fatture.totale')), h('td.num', String(b.trimestri.reduce((s, x) => s + x.fatture, 0))), h('td.num', soldi(b.totale)), h('td'), h('td'))))),
    h('p.nota', t('fatture.bollo-nota'))));
}

async function numerazione(corpo, k, anno) {
  const { h, get } = k;
  let n; try { n = await get(`/fatture/numerazione?anno=${anno}`); } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; }
  const anni = h('div.fatture-anni', h('button.btn.nudo', { testo: '←', on: { click: () => numerazione(corpo, k, anno - 1) } }), h('b', String(anno)),
    h('button.btn.nudo', { testo: '→', on: { click: () => numerazione(corpo, k, anno + 1) } }));
  corpo.replaceChildren(h('div.foglio', anni,
    n.serie.length ? h('div.fatture-scorre', h('table.tabella', h('thead', h('tr', h('th', t('fatture.serie')), h('th.num', t('fatture.emesse')), h('th.num', t('fatture.ultimo')), h('th', t('fatture.mancano')))),
      h('tbody', n.serie.map(s => h('tr', h('td', s.serie || t('fatture.serie-principale')), h('td.num', String(s.emesse)), h('td.num', String(s.ultimo)),
        h('td', s.mancano.length ? h('span.fatture-no', s.mancano.join(', ')) : h('span.fatture-si', '✓ ', t('fatture.nessun-buco')))))))) : h('p.nota', t('fatture.nessuna-emessa')),
    h('p.nota', t('fatture.numerazione-nota'))));
}

export default {
  nome: 'fatture',
  // un gestionale installato prima di questo modulo prende i campi nuovi (prezzi a 8 decimali, cassa, PA, fatture ricevute…):
  // è una modifica dello schema, quindi si chiede a chi può personalizzare (una volta per sessione, se dice «no»)
  async avvio(k) {
    const f = k.schema.find(e => e.id === 'fatture'); if (!f || !k.stato.poteri?.schema) return;
    const prezzo = k.schema.find(e => e.id === 'righe_fattura')?.campi.find(c => c.id === 'prezzo');
    if (prezzo?.tipo !== 'valuta' && f.campi.some(c => c.id === 'esigibilita') && k.schema.some(e => e.id === RICEVUTE)) return;
    try { if (sessionStorage.getItem('kubo.fatture.aggiorna') === 'no') return; } catch { /* niente */ }
    if (!confirm(t('fatture.aggiorna-chiedi'))) { try { sessionStorage.setItem('kubo.fatture.aggiorna', 'no'); } catch { /* niente */ } return; }
    try { await k.api('POST', '/fatture/aggiorna'); await k.ricaricaSchema(); k.toast(t('fatture.aggiornato')); } catch (e) { k.toast(e.message, true); }
  },
  lato: k => (k.schema.some(e => e.id === RICEVUTE) && k.schema.find(e => e.id === 'fatture')?.puo?.leggi !== false ? [{ href: '#/fatture', icona: 'documento', nome: t('fatture.titolo') }] : []),
  rotte: { fatture: (contenuto, k, a) => pagina(contenuto, k, a) },
  azioniLista(def, k) {
    if (def.id !== RICEVUTE || def.puo?.crea === false) return [];
    return [k.h('a.btn', { href: '#/fatture', testo: t('fatture.importa') })];
  },
  azioniScheda(def, riga, k) {
    const { h } = k, out = [];
    if (def.id === RICEVUTE && riga.id) {
      if (riga.file) out.push(h('button.btn', { testo: t('fatture.vedi'), on: { click: () => vedi(k, riga) } }));
      if (riga.inversione && !riga.integrata) out.push(h('button.btn', { testo: t('fatture.crea-integrazione'), title: t('fatture.integra-nota'), on: { click: ev => integra(k, riga, ev.target) } }));
    }
    // una fattura emessa non si modifica più: lo si dice subito, accanto ai bottoni
    if (def.id === 'fatture' && bloccata(riga)) {
      caricaCss();
      const segno = h('span.fatture-bloccata', { title: t('fatture.bloccata-nota') }, t('fatture.bloccata'));
      out.unshift(segno);
      // la scheda è disegnata dal motore: appena c'è, si spengono i campi che il server non lascerebbe cambiare e «Archivia»
      setTimeout(() => chiudiScheda(segno, def), 0);
    }
    return out;
  },
};
