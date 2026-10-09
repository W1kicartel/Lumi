// L'avvio guidato (il server è in server/moduli/avvio*.js): il nome dell'azienda, una domanda per schermata, il titolare,
// poi Lumi si prepara da solo. Dopo il primo accesso: un giro di quattro tappe sopra l'interfaccia vera e, finché ci sono,
// un promemoria per togliere i dati d'esempio. primoAvvio() lo chiama app.js quando Lumi non è ancora configurato.
import { h, api, get, toast } from '../ui.js';
import { t, esiste, minuscole, LINGUE, lingua, VALUTE, valutaProposta } from '/lingua.js';

// le domande arrivano dal server in italiano: si traducono qui (avvio.d-/a-/o-/sd-), con il testo del server come riserva
const testoDi = d => (esiste('avvio.d-' + d.id) ? t('avvio.d-' + d.id) : d.testo);
const aiutoDi = d => (!d.aiuto ? null : esiste('avvio.a-' + d.id) ? t('avvio.a-' + d.id) : d.aiuto);
const opzioneDi = (d, o) => { const k = typeof o.id === 'boolean' ? (o.id ? 'si' : 'no') : `${d.id}-${o.id}`; return esiste('avvio.o-' + k) ? t('avvio.o-' + k) : o.nome; };
const descrizioneDi = o => (!o.descrizione ? null : esiste('avvio.sd-' + o.id) ? t('avvio.sd-' + o.id) : o.descrizione);
// il nome, la lingua e la valuta della prima schermata sopravvivono al ricaricamento quando si cambia lingua
const ricordo = () => { try { return JSON.parse(sessionStorage.getItem('lumi.avvio') || '{}'); } catch { return {}; } };

const foglio = () => { if (!document.querySelector('link[data-foglio-avvio]')) document.head.append(h('link', { rel: 'stylesheet', href: '/moduli/avvio.css', 'data-foglio-avvio': '' })); };

// ---------- primo avvio ----------
export async function primoAvvio(app) {
  foglio();
  const { domande, tipiche } = await get('/avvio/domande');
  const r = { ...tipiche.altro, settore: null }, toccate = new Set();   // le risposte; quelle toccate a mano non le cambia il settore
  const prima = ricordo();
  let azienda = prima.azienda || '', valutaScelta = VALUTE.includes(prima.valuta) ? prima.valuta : valutaProposta(), squadra = [{ nome: '', email: '', ruolo: 'collaboratore' }], ruoli = [], ruoliDi = null, i = -1;
  const account = { nome: '', email: '', password: '' };
  const passi = () => domande.filter(d => !d.se || Object.entries(d.se).every(([k, v]) => v.includes(r[k])));
  const scegli = (d, v) => {
    r[d.id] = v; toccate.add(d.id);
    if (d.id === 'settore') for (const [k, x] of Object.entries(tipiche[v] || {})) if (!toccate.has(k) || k === 'settore') r[k] = x;
    setTimeout(() => vai(1), 160);
  };
  function vai(d) { i = Math.max(-1, Math.min(passi().length + 1, i + d)); disegna(); }
  // la lingua e la valuta dell'azienda, appena lasciata la prima schermata: il piano nomina le sezioni nella lingua giusta.
  // Da un altro computer serve il codice di avvio (403): si ignora, la si salva di nuovo alla fine con il codice.
  let linguaSalvata = Promise.resolve();
  const salvaLingua = () => { linguaSalvata = api('PUT', '/lingua/azienda', { lingua, valuta: valutaScelta }).catch(() => {}); };

  const scatola = h('div.avvio-scatola'), barra = h('div.avvio-barra', h('i'));
  app.replaceChildren(h('div.avvio', h('div.avvio-cima', h('span.avvio-marca', 'Lumi'), barra), scatola));
  const piede = (avanti, testo = t('avvio.avanti')) => h('div.avvio-piede',
    i >= 0 ? h('button.btn.nudo', { type: 'button', on: { click: () => vai(-1) } }, t('avvio.indietro')) : h('span'),
    avanti ? h('button.btn.pieno', { type: 'submit' }, testo) : null);
  const schermata = (titolo, aiuto, corpo, avanti, testo) => {
    const f = h('form.avvio-passo', { on: { submit: ev => { ev.preventDefault(); avanti?.(); } } }, h('h1', titolo), aiuto ? h('p.avvio-aiuto', aiuto) : null, corpo, piede(!!avanti, testo));
    scatola.replaceChildren(f); requestAnimationFrame(() => (f.querySelector('input') || f.querySelector('.avvio-opzione.scelta') || f.querySelector('.avvio-opzione') || f.querySelector('button'))?.focus({ preventScroll: true }));
  };

  function disegna() {
    const p = passi(), tot = p.length + 2;
    barra.firstChild.style.width = `${Math.round(((i + 1) / tot) * 100)}%`;
    if (i === -1) {
      const nome = h('input.campo.avvio-grande', { value: azienda, placeholder: t('avvio.azienda-es'), required: true, autocomplete: 'organization', on: { input: () => { azienda = nome.value; } } });
      const sLingua = h('select.campo', { on: { change: ev => {
        try { localStorage.setItem('lumi.lingua', ev.target.value); sessionStorage.setItem('lumi.avvio', JSON.stringify({ azienda, valuta: valutaScelta })); } catch { }
        location.reload();
      } } }, Object.entries(LINGUE).map(([c, l]) => h('option', { value: c, testo: l.nome, selected: c === lingua })));
      const sValuta = h('select.campo', { on: { change: ev => { valutaScelta = ev.target.value; } } }, VALUTE.map(v => h('option', { value: v, testo: v, selected: v === valutaScelta })));
      return schermata(t('comune.benvenuto'), t('avvio.sottotitolo'),
        h('div', h('label', h('span.etichetta', t('avvio.nome-attivita')), nome),
          h('div.avvio-griglia.avvio-lingua', h('label', h('span.etichetta', t('comune.lingua')), sLingua), h('label', h('span.etichetta', t('comune.valuta')), sValuta))),
        () => { if (azienda.trim()) { salvaLingua(); vai(1); } });
    }
    if (i < p.length) {
      const d = p[i];
      if (d.tipo === 'persone') return persone(d);
      const opz = d.opzioni.map(o => h('button.avvio-opzione', { type: 'button', class: r[d.id] === o.id ? 'scelta' : '', 'aria-pressed': String(r[d.id] === o.id), on: { click: () => scegli(d, o.id) } },
        h('b', opzioneDi(d, o)), o.descrizione ? h('span', descrizioneDi(o)) : null));
      return schermata(testoDi(d), aiutoDi(d), h('div', { class: `avvio-opzioni ${d.tipo === 'settore' ? 'avvio-settori' : d.tipo === 'si_no' ? 'avvio-due' : ''}` }, opz), () => { if (r[d.id] != null) vai(1); });
    }
    if (i === p.length) return finale();
    return null;
  }

  async function persone(d) {
    // i ruoli dipendono dal settore: se si torna indietro e lo si cambia, si rileggono
    if (ruoliDi !== r.settore) { await linguaSalvata; ruoli = await api('POST', '/avvio/piano', { risposte: r }).then(x => x.ruoli).catch(() => []); ruoliDi = r.settore; }
    const tutti = [{ id: 'collaboratore', nome: t('avvio.collaboratore') }, ...ruoli.map(x => ({ id: x.id, nome: x.nome })), { id: 'lettura', nome: t('avvio.lettura') }];
    for (const p of squadra) if (!tutti.some(x => x.id === p.ruolo)) p.ruolo = 'collaboratore';
    const lista = h('div.avvio-persone');
    const riga = (p, n) => h('div.avvio-persona',
      h('input.campo', { placeholder: t('avvio.nome'), value: p.nome, 'aria-label': t('avvio.nome'), on: { input: ev => { p.nome = ev.target.value; } } }),
      h('input.campo', { placeholder: t('comune.email'), type: 'email', value: p.email, 'aria-label': t('comune.email'), on: { input: ev => { p.email = ev.target.value; } } }),
      h('select.campo', { 'aria-label': t('avvio.ruolo'), on: { change: ev => { p.ruolo = ev.target.value; } } }, tutti.map(x => h('option', { value: x.id, testo: x.nome, selected: x.id === p.ruolo }))),
      h('button.btn.nudo.piccolo', { type: 'button', title: t('avvio.togli'), 'aria-label': t('avvio.togli'), on: { click: () => { squadra.splice(n, 1); if (!squadra.length) squadra.push({ nome: '', email: '', ruolo: 'collaboratore' }); ridisegna(); } } }, '×'));
    const ridisegna = () => lista.replaceChildren(...squadra.map(riga));
    ridisegna();
    schermata(testoDi(d), aiutoDi(d), h('div', lista, h('button.btn.piccolo', { type: 'button', on: { click: () => { squadra.push({ nome: '', email: '', ruolo: tutti[1]?.id || 'collaboratore' }); ridisegna(); lista.lastChild.querySelector('input').focus(); } } }, t('avvio.altra-persona')),
      h('p.nota', t('avvio.password-provvisoria'))), () => { r.squadra = squadra.filter(x => x.nome.trim() && x.email.trim()); vai(1); });
  }

  async function finale() {
    await linguaSalvata;
    const pl = await api('POST', '/avvio/piano', { risposte: r }).catch(() => null);
    const f = Object.fromEntries(['nome', 'email', 'password'].map(k => [k, h('input.campo', { name: k, required: true, value: account[k], type: k === 'nome' ? 'text' : k,
      autocomplete: k === 'password' ? 'new-password' : k === 'email' ? 'email' : 'name', minLength: k === 'password' ? 8 : undefined, on: { input: ev => { account[k] = ev.target.value; } } })]));
    const err = h('div');
    const riepilogo = pl ? h('div.avvio-riepilogo',
      h('div.etichetta', t('avvio.sezioni')), h('div.avvio-chip', pl.sezioni.length ? pl.sezioni.map(s => h('span', s)) : h('span.vuota', t('avvio.nessuna-sezione'))),
      h('ul.avvio-dettagli',
        pl.spenti.campi.length ? h('li', t('avvio.campi-spenti', { n: pl.spenti.campi.length, personalizza: t('comune.personalizza') })) : null,
        pl.persone.length ? h('li', t('avvio.persone-ruolo', { n: pl.persone.length })) : null,
        h('li', pl.lumi ? t('avvio.lumi-acceso') : t('avvio.lumi-spento')),
        h('li', pl.esempi ? t('avvio.con-esempi') : t('avvio.senza-esempi')))) : null;
    const serveCodice = await get('/stato').then(x => x.serveCodice).catch(() => false);
    const codice = h('input.campo.mono', { name: 'codice', autocomplete: 'off', required: serveCodice, placeholder: t('comune.codice-avvio-es') });
    let invio = false;
    schermata(t('avvio.ci-siamo'), t('avvio.chi-sei'), h('div', riepilogo, err,
      h('div.avvio-griglia', h('label', h('span.etichetta', t('comune.tuo-nome')), f.nome), h('label', h('span.etichetta', t('comune.email')), f.email),
        h('label.largo', h('span.etichetta', t('comune.password-nuova')), f.password),
        serveCodice ? h('label.largo', h('span.etichetta', t('comune.codice-avvio')), codice) : null)), async () => {
      if (invio) return; invio = true; err.replaceChildren();
      const bottone = scatola.querySelector('button[type=submit]'); bottone.disabled = true; bottone.textContent = t('avvio.preparo');
      try {
        // la lingua e la valuta di nuovo, con il codice di avvio (da un altro computer la prima volta non è passata)
        await api('PUT', '/lingua/azienda', { lingua, valuta: valutaScelta, codice: codice.value });
        const x = await api('POST', '/avvio/configura', { azienda: azienda.trim(), nome: account.nome, email: account.email, password: account.password, risposte: r, codice: codice.value });
        try { sessionStorage.removeItem('lumi.avvio'); } catch { }
        if (x.persone?.length) return consegne(x.persone);
        location.hash = ''; location.reload();
      } catch (e) { err.replaceChildren(h('div.avviso', e.message)); bottone.disabled = false; bottone.textContent = t('avvio.prepara'); invio = false; }
    }, t('avvio.prepara'));
  }

  function consegne(persone) {
    barra.firstChild.style.width = '100%';
    scatola.replaceChildren(h('div.avvio-passo', h('h1', t('avvio.pronto')),
      h('p.avvio-aiuto', t('avvio.consegna')),
      h('table.tabella.avvio-consegne', h('tbody', persone.map(p => h('tr', h('td', p.nome), h('td', p.email), h('td.mono', p.errore ? h('span.avviso', p.errore) : p.password))))),
      h('div.avvio-piede', h('span'), h('button.btn.pieno', { type: 'button', on: { click: () => { location.hash = ''; location.reload(); } } }, t('avvio.entra')))));
  }
  disegna();
}

// ---------- il giro guidato: quattro tappe sopra l'interfaccia vera ----------
const nomi = k => { const l = k.schema.filter(e => !e.nascosta).slice(0, 3).map(e => minuscole(e.nome)); return l.length ? ` (${l.join(', ')}…)` : ''; };
const TAPPE = [
  { dove: () => document.querySelector('.lato nav'), titolo: t('avvio.tappa-sezioni'), testo: k => t('avvio.tappa-sezioni-testo', { esempi: nomi(k) }) },
  { prima: k => { const e = k.schema.find(x => !x.nascosta); if (e) location.hash = `#/e/${e.id}`; }, dove: () => document.querySelector('.testa a[href^="#/personalizza/"]'),
    titolo: t('comune.personalizza'), testo: t('avvio.tappa-personalizza-testo', { nuova: t('comune.nuova-sezione') }) },
  { dove: () => document.querySelector('.lumi-pill')?.parentElement, titolo: 'Lumi', testo: t('avvio.tappa-lumi-testo') },
  { prima: () => { if (document.querySelector('.lato a[href="#/cruscotto"]')) location.hash = '#/cruscotto'; }, dove: () => document.querySelector('.contenuto'),
    titolo: t('avvio.tappa-cruscotto'), testo: t('avvio.tappa-cruscotto-testo', { modifica: t('moduli.ag-modifica') }) },
];
function giro(k, n = 0) {
  document.querySelector('.avvio-giro')?.remove();
  const tappa = TAPPE[n]; if (!tappa) { api('POST', '/avvio/giro', { fatto: true }).catch(() => {}); return; }
  tappa.prima?.(k);
  setTimeout(() => {
    const el = tappa.dove(), rq = el?.getBoundingClientRect();
    const buco = h('div.avvio-buco'), fumetto = h('div.avvio-fumetto', { role: 'dialog', 'aria-label': tappa.titolo },
      h('small', t('avvio.n-di', { n: n + 1, tot: TAPPE.length })), h('b', tappa.titolo), h('p', typeof tappa.testo === 'function' ? tappa.testo(k) : tappa.testo),
      h('div', h('button.btn.nudo.piccolo', { type: 'button', on: { click: () => giro(k, TAPPE.length) } }, t('avvio.salta')),
        h('button.btn.pieno.piccolo', { type: 'button', on: { click: () => giro(k, n + 1) } }, n === TAPPE.length - 1 ? t('avvio.capito') : t('avvio.avanti'))));
    const strato = h('div.avvio-giro', buco, fumetto);
    document.body.append(strato);
    if (rq && rq.width) {
      const m = 6, x = Math.max(4, rq.left - m), y = Math.max(4, rq.top - m), w = Math.min(innerWidth - x - 4, rq.width + 2 * m), hh = Math.min(innerHeight - y - 4, rq.height + 2 * m);
      Object.assign(buco.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` });
      // il fumetto accanto al riquadro: a destra se c'è posto, altrimenti sotto o sopra
      const fw = Math.min(320, innerWidth - 32);
      if (x + w + fw + 24 < innerWidth) Object.assign(fumetto.style, { left: `${x + w + 14}px`, top: `${Math.min(Math.max(16, y), innerHeight - 220)}px` });
      else if (y + hh + 200 < innerHeight) Object.assign(fumetto.style, { left: `${Math.max(16, Math.min(x, innerWidth - fw - 16))}px`, top: `${y + hh + 12}px` });
      else Object.assign(fumetto.style, { left: `${Math.max(16, Math.min(x, innerWidth - fw - 16))}px`, top: `${Math.max(16, y - 200)}px` });
    } else { buco.style.display = 'none'; strato.classList.add('senza'); }
    fumetto.querySelector('.btn.pieno').focus();
  }, tappa.prima ? 350 : 60);
}
addEventListener('keydown', ev => { if (ev.key === 'Escape' && document.querySelector('.avvio-giro')) { document.querySelector('.avvio-giro').remove(); api('POST', '/avvio/giro', { fatto: true }).catch(() => {}); } });

// ---------- dati d'esempio: il promemoria e la pagina ----------
let stato = { esempi: 0, titolare: false };
function promemoria() {
  document.querySelector('.avvio-esempi')?.remove();
  if (!stato.esempi || !stato.titolare) return;
  document.body.append(h('div.avvio-esempi', h('span', t('avvio.promemoria')), h('a', { href: '#/avvio' }, t('avvio.toglili'))));
}
async function pagina(contenuto, k) {
  stato = await get('/avvio/stato'); promemoria();
  const togli = h('button.btn.pericolo', { type: 'button', on: { click: async () => {
    if (!confirm(t('avvio.conferma-togli'))) return;
    togli.disabled = true; try { const x = await api('DELETE', '/avvio/esempi'); toast(t('avvio.tolte', { n: x.tolti })); stato.esempi = 0; promemoria(); location.hash = ''; }
    catch (e) { toast(e.message, true); togli.disabled = false; }
  } } }, t('avvio.togli-esempi'));
  const metti = h('button.btn', { type: 'button', on: { click: async () => {
    metti.disabled = true; try { const x = await api('POST', '/avvio/esempi'); toast(t('avvio.aggiunte', { n: x.creati })); pagina(contenuto, k); } catch (e) { toast(e.message, true); metti.disabled = false; }
  } } }, t('avvio.rimetti-esempi'));
  contenuto.replaceChildren(h('div.testa', h('h1', t('avvio.pagina-titolo'))),
    h('div.corpo', h('div.foglio.avvio-pagina',
      stato.esempi ? [h('p', t('avvio.ci-sono', { n: stato.esempi })), stato.titolare ? togli : h('p.nota', t('avvio.solo-titolare'))]
        : [h('p', t('avvio.nessun-esempio')), stato.titolare ? metti : null],
      h('hr'), h('p', t('avvio.rivedere')), h('button.btn', { type: 'button', on: { click: () => giro(k) } }, t('avvio.rifai-giro')))));
}

export default {
  nome: 'avvio',
  async avvio(k) {
    foglio();
    try { stato = await get('/avvio/stato'); } catch { return; }
    promemoria();
    if (stato.giro) setTimeout(() => giro(k), 700);
  },
  lato: k => (k.stato.utente?.ruolo === 'titolare' ? [{ href: '#/avvio', icona: 'stella', nome: t('avvio.lato'), sezione: t('avvio.lato-sezione') }] : []),
  rotte: { avvio: (contenuto, k) => pagina(contenuto, k) },
};
