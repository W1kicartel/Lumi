// L'avvio guidato (il server è in server/moduli/avvio*.js): il nome dell'azienda, una domanda per schermata, il titolare,
// poi Kubo si prepara da solo. Dopo il primo accesso: un giro di quattro tappe sopra l'interfaccia vera e, finché ci sono,
// un promemoria per togliere i dati d'esempio. primoAvvio() lo chiama app.js quando Kubo non è ancora configurato.
import { h, api, get, toast } from '../ui.js';

const foglio = () => { if (!document.querySelector('link[data-kubo-avvio]')) document.head.append(h('link', { rel: 'stylesheet', href: '/moduli/avvio.css', 'data-kubo-avvio': '' })); };

// ---------- primo avvio ----------
export async function primoAvvio(app) {
  foglio();
  const { domande, tipiche } = await get('/avvio/domande');
  const r = { ...tipiche.altro, settore: null }, toccate = new Set();   // le risposte; quelle toccate a mano non le cambia il settore
  let azienda = '', squadra = [{ nome: '', email: '', ruolo: 'collaboratore' }], ruoli = [], ruoliDi = null, i = -1;
  const account = { nome: '', email: '', password: '' };
  const passi = () => domande.filter(d => !d.se || Object.entries(d.se).every(([k, v]) => v.includes(r[k])));
  const scegli = (d, v) => {
    r[d.id] = v; toccate.add(d.id);
    if (d.id === 'settore') for (const [k, x] of Object.entries(tipiche[v] || {})) if (!toccate.has(k) || k === 'settore') r[k] = x;
    setTimeout(() => vai(1), 160);
  };
  function vai(d) { i = Math.max(-1, Math.min(passi().length + 1, i + d)); disegna(); }

  const scatola = h('div.avvio-scatola'), barra = h('div.avvio-barra', h('i'));
  app.replaceChildren(h('div.avvio', h('div.avvio-cima', h('span.avvio-marca', 'Kubo'), barra), scatola));
  const piede = (avanti, testo = 'Avanti') => h('div.avvio-piede',
    i >= 0 ? h('button.btn.nudo', { type: 'button', on: { click: () => vai(-1) } }, '← Indietro') : h('span'),
    avanti ? h('button.btn.pieno', { type: 'submit' }, testo) : null);
  const schermata = (titolo, aiuto, corpo, avanti, testo) => {
    const f = h('form.avvio-passo', { on: { submit: ev => { ev.preventDefault(); avanti?.(); } } }, h('h1', titolo), aiuto ? h('p.avvio-aiuto', aiuto) : null, corpo, piede(!!avanti, testo));
    scatola.replaceChildren(f); requestAnimationFrame(() => (f.querySelector('input') || f.querySelector('.avvio-opzione.scelta') || f.querySelector('.avvio-opzione') || f.querySelector('button'))?.focus({ preventScroll: true }));
  };

  function disegna() {
    const p = passi(), tot = p.length + 2;
    barra.firstChild.style.width = `${Math.round(((i + 1) / tot) * 100)}%`;
    if (i === -1) {
      const nome = h('input.campo.avvio-grande', { value: azienda, placeholder: 'es. Bottega Ferri', required: true, autocomplete: 'organization', on: { input: () => { azienda = nome.value; } } });
      return schermata('Benvenuto in Kubo', 'Dieci domande e il gestionale è pronto, cucito sul tuo lavoro. Tutto si cambia anche dopo.',
        h('label', h('span.etichetta', 'Come si chiama la tua attività?'), nome), () => { if (azienda.trim()) vai(1); });
    }
    if (i < p.length) {
      const d = p[i];
      if (d.tipo === 'persone') return persone(d);
      const opz = d.opzioni.map(o => h('button.avvio-opzione', { type: 'button', class: r[d.id] === o.id ? 'scelta' : '', 'aria-pressed': String(r[d.id] === o.id), on: { click: () => scegli(d, o.id) } },
        h('b', o.nome), o.descrizione ? h('span', o.descrizione) : null));
      return schermata(d.testo, d.aiuto, h('div', { class: `avvio-opzioni ${d.tipo === 'settore' ? 'avvio-settori' : d.tipo === 'si_no' ? 'avvio-due' : ''}` }, opz), () => { if (r[d.id] != null) vai(1); });
    }
    if (i === p.length) return finale();
    return null;
  }

  async function persone(d) {
    // i ruoli dipendono dal settore: se si torna indietro e lo si cambia, si rileggono
    if (ruoliDi !== r.settore) { ruoli = await api('POST', '/avvio/piano', { risposte: r }).then(x => x.ruoli).catch(() => []); ruoliDi = r.settore; }
    const tutti = [{ id: 'collaboratore', nome: 'Collaboratore (vede e modifica, non elimina)' }, ...ruoli.map(x => ({ id: x.id, nome: x.nome })), { id: 'lettura', nome: 'Solo lettura' }];
    for (const p of squadra) if (!tutti.some(x => x.id === p.ruolo)) p.ruolo = 'collaboratore';
    const lista = h('div.avvio-persone');
    const riga = (p, n) => h('div.avvio-persona',
      h('input.campo', { placeholder: 'Nome', value: p.nome, 'aria-label': 'Nome', on: { input: ev => { p.nome = ev.target.value; } } }),
      h('input.campo', { placeholder: 'Email', type: 'email', value: p.email, 'aria-label': 'Email', on: { input: ev => { p.email = ev.target.value; } } }),
      h('select.campo', { 'aria-label': 'Ruolo', on: { change: ev => { p.ruolo = ev.target.value; } } }, tutti.map(x => h('option', { value: x.id, testo: x.nome, selected: x.id === p.ruolo }))),
      h('button.btn.nudo.piccolo', { type: 'button', title: 'Togli', on: { click: () => { squadra.splice(n, 1); if (!squadra.length) squadra.push({ nome: '', email: '', ruolo: 'collaboratore' }); ridisegna(); } } }, '×'));
    const ridisegna = () => lista.replaceChildren(...squadra.map(riga));
    ridisegna();
    schermata(d.testo, d.aiuto, h('div', lista, h('button.btn.piccolo', { type: 'button', on: { click: () => { squadra.push({ nome: '', email: '', ruolo: tutti[1]?.id || 'collaboratore' }); ridisegna(); lista.lastChild.querySelector('input').focus(); } } }, '+ Un\'altra persona'),
      h('p.nota', 'Ognuno riceve una password provvisoria, che vedrai alla fine.')), () => { r.squadra = squadra.filter(x => x.nome.trim() && x.email.trim()); vai(1); }, 'Avanti');
  }

  async function finale() {
    const pl = await api('POST', '/avvio/piano', { risposte: r }).catch(() => null);
    const f = Object.fromEntries(['nome', 'email', 'password'].map(k => [k, h('input.campo', { name: k, required: true, value: account[k], type: k === 'nome' ? 'text' : k,
      autocomplete: k === 'password' ? 'new-password' : k === 'email' ? 'email' : 'name', minLength: k === 'password' ? 8 : undefined, on: { input: ev => { account[k] = ev.target.value; } } })]));
    const err = h('div');
    const riepilogo = pl ? h('div.avvio-riepilogo',
      h('div.etichetta', 'Ti preparo queste sezioni'), h('div.avvio-chip', pl.sezioni.length ? pl.sezioni.map(s => h('span', s)) : h('span.vuota', 'Nessuna: parti da zero')),
      h('ul.avvio-dettagli',
        pl.spenti.campi.length ? h('li', `${pl.spenti.campi.length} campi che non ti servono restano spenti (si riaccendono da Personalizza)`) : null,
        pl.persone.length ? h('li', pl.persone.length === 1 ? 'Una persona con il suo ruolo' : `${pl.persone.length} persone, ognuna con il suo ruolo`) : null,
        h('li', pl.lumi ? 'Lumi acceso' : 'Lumi spento (si accende quando vuoi)'),
        h('li', pl.esempi ? 'Con i dati d\'esempio, da togliere con un clic' : 'Senza dati d\'esempio'))) : null;
    const serveCodice = await get('/stato').then(x => x.serveCodice).catch(() => false);
    const codice = h('input.campo.mono', { name: 'codice', autocomplete: 'off', required: serveCodice, placeholder: 'es. 3FA9C2D1' });
    let invio = false;
    schermata('Ci siamo', 'Ultima cosa: chi sei. Sarai il titolare, quello che può tutto.', h('div', riepilogo, err,
      h('div.avvio-griglia', h('label', h('span.etichetta', 'Il tuo nome'), f.nome), h('label', h('span.etichetta', 'Email'), f.email),
        h('label.largo', h('span.etichetta', 'Password (almeno 8 caratteri)'), f.password),
        serveCodice ? h('label.largo', h('span.etichetta', 'Codice di avvio (è scritto nel terminale o nel log dove gira Kubo)'), codice) : null)), async () => {
      if (invio) return; invio = true; err.replaceChildren();
      const bottone = scatola.querySelector('button[type=submit]'); bottone.disabled = true; bottone.textContent = 'Preparo Kubo…';
      try {
        const x = await api('POST', '/avvio/configura', { azienda: azienda.trim(), nome: account.nome, email: account.email, password: account.password, risposte: r, codice: codice.value });
        if (x.persone?.length) return consegne(x.persone);
        location.hash = ''; location.reload();
      } catch (e) { err.replaceChildren(h('div.avviso', e.message)); bottone.disabled = false; bottone.textContent = 'Prepara Kubo'; invio = false; }
    }, 'Prepara Kubo');
  }

  function consegne(persone) {
    barra.firstChild.style.width = '100%';
    scatola.replaceChildren(h('div.avvio-passo', h('h1', 'Kubo è pronto'),
      h('p.avvio-aiuto', 'Dai a ognuno la sua password provvisoria. Questa schermata non si rivede: copiale ora.'),
      h('table.tabella.avvio-consegne', h('tbody', persone.map(p => h('tr', h('td', p.nome), h('td', p.email), h('td.mono', p.errore ? h('span.avviso', p.errore) : p.password))))),
      h('div.avvio-piede', h('span'), h('button.btn.pieno', { type: 'button', on: { click: () => { location.hash = ''; location.reload(); } } }, 'Entra in Kubo'))));
  }
  disegna();
}

// ---------- il giro guidato: quattro tappe sopra l'interfaccia vera ----------
const nomi = k => { const l = k.schema.filter(e => !e.nascosta).slice(0, 3).map(e => e.nome.toLowerCase()); return l.length ? ` (${l.join(', ')}…)` : ''; };
const TAPPE = [
  { dove: () => document.querySelector('.lato nav'), titolo: 'Le tue sezioni', testo: k => `Qui c'è tutto il gestionale${nomi(k)}. Ogni sezione è una lista che puoi cercare, filtrare, ordinare e vedere a colonne.` },
  { prima: k => { const e = k.schema.find(x => !x.nascosta); if (e) location.hash = `#/e/${e.id}`; }, dove: () => document.querySelector('.testa a[href^="#/personalizza/"]'),
    titolo: 'Personalizza', testo: 'Manca un campo? Ne avanza uno? Da qui aggiungi, rinomini e sposti i campi, senza perdere mai un dato. Le sezioni nuove le crei da «Nuova sezione».' },
  { dove: () => document.querySelector('.lumi-pill')?.parentElement, titolo: 'Lumi', testo: 'Chiedi a parole: «quanto ho incassato questa settimana?», «aggiungi la taglia agli articoli». Lumi legge con i tuoi permessi e propone; decidi tu.' },
  { prima: () => { if (document.querySelector('.lato a[href="#/cruscotto"]')) location.hash = '#/cruscotto'; }, dove: () => document.querySelector('.contenuto'),
    titolo: 'Il cruscotto', testo: 'I numeri che contano e cosa richiede attenzione, aggiornati mentre lavori. Si cambia con «Modifica» in alto.' },
];
function giro(k, n = 0) {
  document.querySelector('.avvio-giro')?.remove();
  const t = TAPPE[n]; if (!t) { api('POST', '/avvio/giro', { fatto: true }).catch(() => {}); return; }
  t.prima?.(k);
  setTimeout(() => {
    const el = t.dove(), rq = el?.getBoundingClientRect();
    const buco = h('div.avvio-buco'), fumetto = h('div.avvio-fumetto', { role: 'dialog', 'aria-label': t.titolo },
      h('small', `${n + 1} di ${TAPPE.length}`), h('b', t.titolo), h('p', typeof t.testo === 'function' ? t.testo(k) : t.testo),
      h('div', h('button.btn.nudo.piccolo', { type: 'button', on: { click: () => giro(k, TAPPE.length) } }, 'Salta'),
        h('button.btn.pieno.piccolo', { type: 'button', on: { click: () => giro(k, n + 1) } }, n === TAPPE.length - 1 ? 'Ho capito' : 'Avanti')));
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
  }, t.prima ? 350 : 60);
}
addEventListener('keydown', ev => { if (ev.key === 'Escape' && document.querySelector('.avvio-giro')) { document.querySelector('.avvio-giro').remove(); api('POST', '/avvio/giro', { fatto: true }).catch(() => {}); } });

// ---------- dati d'esempio: il promemoria e la pagina ----------
let stato = { esempi: 0, titolare: false };
function promemoria() {
  document.querySelector('.avvio-esempi')?.remove();
  if (!stato.esempi || !stato.titolare) return;
  document.body.append(h('div.avvio-esempi', h('span', 'Stai guardando dati d\'esempio'), h('a', { href: '#/avvio' }, 'Toglili')));
}
async function pagina(contenuto, k) {
  stato = await get('/avvio/stato'); promemoria();
  const togli = h('button.btn.pericolo', { type: 'button', on: { click: async () => {
    if (!confirm('Tolgo tutti i dati d\'esempio? Quello che hai aggiunto tu resta.')) return;
    togli.disabled = true; try { const x = await api('DELETE', '/avvio/esempi'); toast(`Tolte ${x.tolti} righe d'esempio`); stato.esempi = 0; promemoria(); location.hash = ''; }
    catch (e) { toast(e.message, true); togli.disabled = false; }
  } } }, 'Togli i dati d\'esempio');
  const metti = h('button.btn', { type: 'button', on: { click: async () => {
    metti.disabled = true; try { const x = await api('POST', '/avvio/esempi'); toast(`Aggiunte ${x.creati} righe d'esempio`); pagina(contenuto, k); } catch (e) { toast(e.message, true); metti.disabled = false; }
  } } }, 'Rimetti i dati d\'esempio');
  contenuto.replaceChildren(h('div.testa', h('h1', 'Dati d\'esempio e giro guidato')),
    h('div.corpo', h('div.foglio.avvio-pagina',
      stato.esempi ? [h('p', `Ci sono ${stato.esempi} righe d'esempio: clienti, movimenti e appuntamenti finti, per provare Kubo senza paura. Quando sei pronto toglile: spariscono tutte (anche quelle che hai ritoccato), quello che hai inserito tu resta e, dove non c'è ancora niente di tuo, la numerazione riparte da 1.`), stato.titolare ? togli : h('p.nota', 'Solo il titolare può toglierli.')]
        : [h('p', 'Non ci sono dati d\'esempio.'), stato.titolare ? metti : null],
      h('hr'), h('p', 'Vuoi rivedere dove sono le cose?'), h('button.btn', { type: 'button', on: { click: () => giro(k) } }, 'Rifai il giro guidato'))));
}

export default {
  nome: 'avvio',
  async avvio(k) {
    foglio();
    try { stato = await get('/avvio/stato'); } catch { return; }
    promemoria();
    if (stato.giro) setTimeout(() => giro(k), 700);
  },
  lato: k => (k.stato.utente?.ruolo === 'titolare' ? [{ href: '#/avvio', icona: 'stella', nome: 'Dati d\'esempio e giro', sezione: 'Primi passi' }] : []),
  rotte: { avvio: (contenuto, k) => pagina(contenuto, k) },
};
