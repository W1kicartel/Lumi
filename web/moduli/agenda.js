// Agenda e cruscotto. Rotte: #/cruscotto (la pagina iniziale) e #/agenda/<entità>[/mese|settimana|giorno].
// Il calendario funziona per qualsiasi entità con un campo data o data_ora: mese, settimana, giorno (con le colonne per
// persona o per risorsa), trascina per spostare, clic su uno spazio vuoto per creare con la data già messa.
// Il cruscotto: widget salvati nel server (numeri, grafici disegnati a mano in SVG, «cosa richiede attenzione», ultime modifiche).
import { costruttore, risolvi, apriPop, etichetta } from '../filtri.js';

let h, api, get, toast, icona;
const prefs = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('kubo.agenda.' + k) || 'null'); localStorage.setItem('kubo.agenda.' + k, JSON.stringify(v)); } catch { return null; } };
const conData = e => !e.nascosta && e.campi.some(c => !c.archiviato && ['data', 'data_ora'].includes(c.tipo));

// ---------- date locali ----------
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const giorno = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const piu = (s, n) => { const d = giorno(s); d.setDate(d.getDate() + n); return iso(d); };
const lunedi = s => piu(s, -((giorno(s).getDay() + 6) % 7));
const oggi = () => iso(new Date());
const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const ora = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutiDi = d => d.getHours() * 60 + d.getMinutes();
const PX_ORA = 52, PASSO = 15;

export default {
  nome: 'agenda',
  casa: '#/cruscotto',
  avvio(k) {
    ({ h, api, get, toast, icona } = k);
    if (!document.querySelector('link[href="/moduli/agenda.css"]')) document.head.append(h('link', { rel: 'stylesheet', href: '/moduli/agenda.css' }));
  },
  lato(k) {
    const voci = [{ href: '#/cruscotto', icona: 'griglia', nome: 'Cruscotto', inCima: true }];
    const e = k.schema.find(x => !x.nascosta && x.campi.some(c => c.tipo === 'data_ora' && !c.archiviato));
    if (e) voci.push({ href: `#/agenda/${e.id}`, icona: 'calendario', nome: k.schema.some(x => !x.nascosta && x.nome === 'Agenda') ? 'Calendario' : 'Agenda', inCima: true });
    return voci;
  },
  azioniLista(def, k) { return conData(def) ? [k.h('a.btn', { href: `#/agenda/${def.id}`, title: 'Vedi sul calendario' }, k.icona('calendario'), 'Calendario')] : []; },
  rotte: {
    agenda: (contenuto, k, entita, vista) => calendario(contenuto, k, entita, vista),
    cruscotto: (contenuto, k) => cruscotto(contenuto, k),
  },
};

// =====================================================================================================================
// CALENDARIO
// =====================================================================================================================
async function calendario(contenuto, k, entita, vistaUrl) {
  const def = k.schema.find(e => e.id === entita) || k.schema.find(conData);
  if (!def || !conData(def)) { contenuto.replaceChildren(h('div.corpo', h('div.vuoto', 'Nessuna sezione ha un campo data da mettere in calendario.'))); return; }
  const p = prefs(def.id) || {};
  let vista = ['mese', 'settimana', 'giorno'].includes(vistaUrl) ? vistaUrl : p.vista || (!def.campi.some(c => c.tipo === 'data_ora') ? 'mese' : innerWidth < 700 ? 'giorno' : 'settimana');
  let centro = oggi(), campo = p.campo || null, colonna = p.colonna ?? undefined, dati = null;
  const ricorda = () => prefs(def.id, { vista, campo, colonna }), nomi = new Map();
  const etichettaPeriodo = h('div.ag-periodo'), corpo = h('div.ag-corpo'), strumenti = h('div.ag-strumenti');
  const vai = n => { centro = vista === 'mese' ? iso(new Date(giorno(centro).getFullYear(), giorno(centro).getMonth() + n, 1)) : piu(centro, n * (vista === 'settimana' ? 7 : 1)); ricorda(); carica(); };
  const bVista = v => h('button.btn.piccolo', { class: v === vista ? 'pieno' : '', testo: { mese: 'Mese', settimana: 'Settimana', giorno: 'Giorno' }[v], on: { click: () => { vista = v; ricorda(); carica(); } } });
  contenuto.replaceChildren(
    h('div.testa', h('h1', def.nome), h('a.btn.nudo', { href: `#/e/${def.id}`, title: 'Torna alla lista' }, 'Lista'),
      def.puo.crea ? h('button.btn.pieno', { testo: '+ Nuovo', on: { click: () => crea(ora9(centro)) } }) : null),
    h('div.corpo', h('div.ag-barra',
      h('div.ag-nav', h('button.btn.piccolo', { testo: '‹', title: 'Prima', on: { click: () => vai(-1) } }), h('button.btn.piccolo', { testo: 'Oggi', on: { click: () => { centro = oggi(); ricorda(); carica(); } } }),
        h('button.btn.piccolo', { testo: '›', title: 'Dopo', on: { click: () => vai(1) } }), etichettaPeriodo),
      strumenti), corpo));
  const ora9 = g => (dati?.tipoData === 'data' ? g : new Date(giorno(g).setHours(9, 0, 0, 0)));
  // frecce ← → per spostarsi, «t» per oggi; e quando un collega cambia qualcosa in questa sezione, si ricarica
  const tasti = ev => { if (ev.target.closest?.('input,select,textarea') || ev.metaKey || ev.ctrlKey || document.querySelector('.pop')) return; if (ev.key === 'ArrowLeft') vai(-1); if (ev.key === 'ArrowRight') vai(1); if (ev.key === 't') { centro = oggi(); ricorda(); carica(); } };
  let tRic; const altrui = ev => { if (ev.detail.entita === def.id) { clearTimeout(tRic); tRic = setTimeout(carica, 300); } };
  window.addEventListener('keydown', tasti); window.addEventListener('kubo:evento', altrui);
  window.addEventListener('hashchange', () => { window.removeEventListener('keydown', tasti); window.removeEventListener('kubo:evento', altrui); }, { once: true });

  function intervallo() {
    if (vista === 'giorno') return [centro, centro];
    if (vista === 'settimana') { const l = lunedi(centro); return [l, piu(l, 6)]; }
    const primo = iso(new Date(giorno(centro).getFullYear(), giorno(centro).getMonth(), 1)), l = lunedi(primo);
    return [l, piu(l, 41)];
  }
  let giro = 0;
  async function carica() {
    const mio = ++giro, [da, a] = intervallo();
    corpo.classList.add('ag-carica');
    try { dati = await get(`/agenda/${def.id}?da=${da}&a=${a}${campo ? '&campo=' + encodeURIComponent(campo) : ''}`); }
    catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; } finally { corpo.classList.remove('ag-carica'); }
    if (mio !== giro) return;
    campo = dati.campoData;
    if (colonna === undefined) colonna = dati.colonne.find(c => c.tipo === 'utente')?.id || null;
    if (colonna && !dati.colonne.some(c => c.id === colonna)) colonna = null;
    await nomiRisorse(); if (mio !== giro) return;
    disegnaStrumenti(); disegna();
  }
  function disegnaStrumenti() {
    const d = dati;
    const sCampo = d.date.length > 1 ? h('select.campo.piccolo', { title: 'Quale data', on: { change: () => { campo = sCampo.value; ricorda(); carica(); } } }, d.date.map(c => h('option', { value: c.id, testo: c.nome, selected: c.id === campo }))) : null;
    const sCol = vista === 'giorno' && d.tipoData === 'data_ora' && d.colonne.length ? h('select.campo.piccolo', { title: 'Colonne', on: { change: async () => { colonna = sCol.value || null; ricorda(); await nomiRisorse(); disegna(); } } },
      h('option', { value: '', testo: 'Una colonna' }), d.colonne.map(c => h('option', { value: c.id, testo: `Colonne: ${c.nome.toLowerCase()}`, selected: c.id === colonna }))) : null;
    strumenti.replaceChildren(...[sCampo, sCol, h('div.lista-modi', ['mese', 'settimana', 'giorno'].map(bVista))].filter(Boolean));
  }
  function disegna() {
    const [da, a] = intervallo(), mese = giorno(centro).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    etichettaPeriodo.textContent = vista === 'mese' ? mese : vista === 'giorno' ? giorno(centro).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `${giorno(da).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} – ${giorno(a).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    if (dati.troncato) toast('Troppi elementi in questo periodo: ne mostro una parte', true);
    if (vista === 'mese') corpo.replaceChildren(vistaMese(da));
    else corpo.replaceChildren(vistaOre(vista === 'giorno' ? [centro] : Array.from({ length: 7 }, (_, i) => piu(da, i))));
  }
  // un evento: il suo giorno locale e i minuti di inizio
  const giornoEv = e => (dati.tipoData === 'data' ? e.inizio.slice(0, 10) : iso(new Date(e.inizio)));
  const testoOra = e => (dati.tipoData === 'data' ? '' : ora(minutiDi(new Date(e.inizio))));
  function carta(e, { compatta = false } = {}) {
    const el = h('a.ag-ev', { href: `#/e/${def.id}/${e.id}`, draggable: dati.puo.modifica, title: [testoOra(e), e.titolo, e.sotto, e.stato?.nome].filter(Boolean).join(' · '),
      stile: { '--c': `var(--${e.colore || 'grigio'})` }, on: { dragstart: ev => { ev.dataTransfer.setData('text/kubo-evento', e.id); ev.dataTransfer.effectAllowed = 'move'; el.classList.add('ag-trascina'); }, dragend: () => el.classList.remove('ag-trascina') } },
      compatta ? [testoOra(e) ? h('span.ag-ora', testoOra(e)) : null, h('span.ag-t', e.titolo)] : [h('span.ag-t', e.titolo), h('span.ag-s', [testoOra(e) && `${testoOra(e)}–${ora(Math.min(24 * 60, minutiDi(new Date(e.inizio)) + e.durata))}`, e.sotto].filter(Boolean).join(' · '))]);
    if (e.stato?.id && ['annullato', 'non_venuto'].includes(e.stato.id)) el.classList.add('ag-spento');
    return el;
  }
  async function sposta(id, valori) {
    try { await api('PATCH', `/dati/${def.id}/${id}`, valori); toast('Spostato'); } catch (err) { toast(err.message, true); }
    carica();
  }
  function crea(quando, extra = {}) {
    if (!def.puo.crea) return;
    const v = { [campo || dati?.campoData]: quando instanceof Date ? quando.toISOString() : quando, ...extra };
    try { sessionStorage.setItem('kubo.precompila.' + def.id, JSON.stringify(v)); } catch {}
    location.hash = `#/e/${def.id}/nuovo`;
  }

  // ---------- mese ----------
  function vistaMese(da) {
    const meseAttuale = giorno(centro).getMonth(), per = new Map();
    for (const e of dati.eventi) { const g = giornoEv(e); if (!per.has(g)) per.set(g, []); per.get(g).push(e); }
    for (const l of per.values()) l.sort((a, b) => (a.inizio < b.inizio ? -1 : 1));
    const celle = Array.from({ length: 42 }, (_, i) => {
      const g = piu(da, i), qui = per.get(g) || [], fuori = giorno(g).getMonth() !== meseAttuale;
      const cella = h('div.ag-cella', { class: [fuori ? 'fuori' : '', g === oggi() ? 'oggi' : ''].join(' '), on: {
        click: ev => { if (ev.target === cella || ev.target.classList.contains('ag-num-riga')) crea(dati.tipoData === 'data' ? g : ora9(g)); },
        dragover: ev => { if (ev.dataTransfer.types.includes('text/kubo-evento')) { ev.preventDefault(); cella.classList.add('sopra'); } }, dragleave: () => cella.classList.remove('sopra'),
        drop: ev => { ev.preventDefault(); cella.classList.remove('sopra'); const id = ev.dataTransfer.getData('text/kubo-evento'), e = dati.eventi.find(x => x.id === id); if (!e || giornoEv(e) === g) return;
          if (dati.tipoData === 'data') return sposta(id, { [dati.campoData]: g });
          const d = new Date(e.inizio), n = giorno(g); n.setHours(d.getHours(), d.getMinutes(), 0, 0); sposta(id, { [dati.campoData]: n.toISOString() }); } } },
        h('div.ag-num-riga', h('button.ag-num', { testo: String(giorno(g).getDate()), title: 'Vedi il giorno', on: { click: ev => { ev.stopPropagation(); centro = g; vista = 'giorno'; ricorda(); carica(); } } })),
        qui.slice(0, 3).map(e => carta(e, { compatta: true })),
        qui.length > 3 ? h('button.ag-altri', { testo: `+${qui.length - 3} altri`, on: { click: ev => { ev.stopPropagation(); centro = g; vista = 'giorno'; ricorda(); carica(); } } }) : null);
      return cella;
    });
    return h('div.ag-mese', GIORNI.map(n => h('div.ag-intest', n)), celle);
  }

  // ---------- settimana e giorno: la griglia delle ore ----------
  function vistaOre(giorni) {
    const tuttoGiorno = dati.tipoData === 'data';
    // colonne: un giorno ciascuna, oppure (vista giorno) una per persona o risorsa
    const c = vista === 'giorno' && colonna ? dati.colonne.find(x => x.id === colonna) : null;
    let colonne = giorni.map(g => ({ g, chiave: null, nome: null }));
    if (c) {
      const risorse = c.tipo === 'utente' ? dati.persone.map(p => ({ id: p.id, nome: p.nome })) : [];
      for (const e of dati.eventi) { const id = e.colonne[c.id]; if (id && !risorse.some(r => r.id === id)) risorse.push({ id, nome: nomi.get(id) || (c.tipo === 'utente' ? 'Utente non attivo' : id) }); }
      colonne = [...risorse.map(r => ({ g: giorni[0], chiave: r.id, nome: r.nome })), { g: giorni[0], chiave: '', nome: 'Nessuno' }]
        .filter(x => x.chiave !== '' || dati.eventi.some(e => !e.colonne[c.id]));
      if (!colonne.length) colonne = [{ g: giorni[0], chiave: '', nome: 'Nessuno' }];
    }
    const dellaColonna = col => dati.eventi.filter(e => giornoEv(e) === col.g && (!c || (e.colonne[c.id] || '') === col.chiave));
    // ore mostrate: 7–21, allargate agli eventi che stanno fuori
    let inizio = 7 * 60, fine = 21 * 60;
    if (!tuttoGiorno) for (const e of dati.eventi) { const m = minutiDi(new Date(e.inizio)); inizio = Math.min(inizio, Math.floor(m / 60) * 60); fine = Math.max(fine, Math.min(24 * 60, Math.ceil((m + e.durata) / 60) * 60)); }
    const alto = (fine - inizio) / 60 * PX_ORA;
    const intest = colonne.map(col => h('div.ag-col-testa', { class: col.g === oggi() && !c ? 'oggi' : '' }, c ? h('b', col.nome) : [h('span', GIORNI[(giorno(col.g).getDay() + 6) % 7]), h('b', String(giorno(col.g).getDate()))]));
    if (tuttoGiorno) {
      return h('div.ag-ore', { stile: { '--colonne': colonne.length } }, h('div.ag-righello'), intest, h('div.ag-righello'),
        colonne.map(col => {
          const z = h('div.ag-tuttogiorno', { on: { click: ev => { if (ev.target === z) crea(col.g); }, dragover: ev => { ev.preventDefault(); z.classList.add('sopra'); }, dragleave: () => z.classList.remove('sopra'),
            drop: ev => { ev.preventDefault(); z.classList.remove('sopra'); const id = ev.dataTransfer.getData('text/kubo-evento'); if (id) sposta(id, { [dati.campoData]: col.g }); } } }, dellaColonna(col).map(e => carta(e)));
          return z;
        }));
    }
    const righello = h('div.ag-righello', { stile: { height: alto + 'px' } }, Array.from({ length: (fine - inizio) / 60 }, (_, i) => h('span', { stile: { top: i * PX_ORA + 'px' } }, ora(inizio + i * 60))));
    const corpi = colonne.map(col => {
      const z = h('div.ag-giorno', { stile: { height: alto + 'px' } });
      const minutiDa = ev => { const r = z.getBoundingClientRect(); return Math.max(inizio, Math.min(fine - PASSO, inizio + Math.round((ev.clientY - r.top) / PX_ORA * 60 / PASSO) * PASSO)); };
      const quando = m => { const d = giorno(col.g); d.setHours(0, m, 0, 0); return d; };
      const extra = () => (c && col.chiave ? { [c.id]: c.tipo === 'relazione' ? { id: col.chiave, titolo: col.nome } : col.chiave } : {});
      z.addEventListener('click', ev => { if (ev.target === z) crea(quando(Math.floor(minutiDa(ev) / 30) * 30), extra()); });
      z.addEventListener('mousemove', ev => { if (ev.target === z) z.dataset.ora = ora(Math.floor(minutiDa(ev) / 30) * 30); });
      z.addEventListener('dragover', ev => { if (!ev.dataTransfer.types.includes('text/kubo-evento')) return; ev.preventDefault(); z.classList.add('sopra'); segno.style.top = (minutiDa(ev) - inizio) / 60 * PX_ORA + 'px'; segno.textContent = ora(minutiDa(ev)); });
      z.addEventListener('dragleave', () => z.classList.remove('sopra'));
      z.addEventListener('drop', ev => {
        ev.preventDefault(); z.classList.remove('sopra'); const id = ev.dataTransfer.getData('text/kubo-evento'), e = dati.eventi.find(x => x.id === id); if (!e) return;
        const nuovo = quando(minutiDa(ev)), valori = {};
        if (nuovo.getTime() !== new Date(e.inizio).getTime()) valori[dati.campoData] = nuovo.toISOString();
        if (c && (e.colonne[c.id] || '') !== col.chiave) valori[c.id] = col.chiave || null;
        if (Object.keys(valori).length) sposta(id, valori);
      });
      const segno = h('div.ag-segno');
      // eventi che si sovrappongono: affiancati in corsie
      const evs = dellaColonna(col).map(e => ({ e, a: minutiDi(new Date(e.inizio)), b: minutiDi(new Date(e.inizio)) + e.durata })).sort((x, y) => x.a - y.a || y.b - x.b);
      const corsie = []; let gruppo = [], fineGruppo = -1;
      const chiudi = () => { const n = Math.max(1, ...gruppo.map(x => x.corsia + 1)); gruppo.forEach(x => { x.n = n; }); gruppo = []; };
      for (const x of evs) {
        if (x.a >= fineGruppo) { chiudi(); corsie.length = 0; }
        let i = corsie.findIndex(f => f <= x.a); if (i < 0) { i = corsie.length; corsie.push(0); }
        corsie[i] = x.b; x.corsia = i; gruppo.push(x); fineGruppo = Math.max(fineGruppo, x.b);
      }
      chiudi();
      z.append(...evs.map(x => { const el = carta(x.e); if (x.e.durata / 60 * PX_ORA < 40) el.classList.add('ag-corto'); Object.assign(el.style, { top: (x.a - inizio) / 60 * PX_ORA + 'px', height: Math.max(22, x.e.durata / 60 * PX_ORA - 2) + 'px', left: `calc(${x.corsia / x.n * 100}% + 2px)`, width: `calc(${100 / x.n}% - 4px)` }); return el; }), segno);
      if (col.g === oggi()) { const m = minutiDi(new Date()); if (m >= inizio && m <= fine) z.append(h('div.ag-adesso', { stile: { top: (m - inizio) / 60 * PX_ORA + 'px' } })); }
      return z;
    });
    const griglia = h('div.ag-ore', { stile: { '--colonne': colonne.length } }, h('div.ag-righello-testa'), intest, righello, corpi);
    // apre già sull'ora giusta (adesso, o le 8)
    requestAnimationFrame(() => { const m = Math.max(inizio, (giorni.includes(oggi()) ? minutiDi(new Date()) - 90 : 8 * 60)); griglia.scrollTop = Math.max(0, (m - inizio) / 60 * PX_ORA); });
    return griglia;
  }
  // le risorse di una relazione hanno bisogno del nome: si chiedono una volta sola, prima di disegnare
  async function nomiRisorse() {
    const c = vista === 'giorno' && colonna ? dati.colonne.find(x => x.id === colonna) : null;
    if (c?.tipo !== 'relazione') return;
    const mancano = [...new Set(dati.eventi.map(e => e.colonne[c.id]).filter(id => id && !nomi.has(id)))];
    if (!mancano.length) return;
    const t = k.schema.find(x => x.id === c.entita), ct = t?.campi.find(x => x.id === t.titolo) || t?.campi.find(x => x.tipo === 'testo');
    const r = await get(`/dati/${c.entita}?n=500&f=${encodeURIComponent(JSON.stringify([{ campo: 'id', op: 'in', valore: mancano }]))}`).catch(() => ({ righe: [] }));
    for (const x of r.righe) nomi.set(x.id, String((ct && (typeof x[ct.id] === 'object' ? x[ct.id]?.titolo : x[ct.id])) ?? x.id));
  }
  carica();
}

// =====================================================================================================================
// CRUSCOTTO
// =====================================================================================================================
const PERIODI = { oggi: 'Oggi', settimana: 'Questa settimana', mese: 'Questo mese', anno: "Quest'anno", ultimi_7: 'Ultimi 7 giorni', ultimi_30: 'Ultimi 30 giorni', ultimi_84: 'Ultime 12 settimane', ultimi_365: 'Ultimo anno', sempre: 'Sempre' };
const PRIMA = { oggi: 'a ieri', settimana: 'alla settimana scorsa', mese: 'al mese scorso', anno: "all'anno scorso" }, COME = { oggi: 'ieri', settimana: 'la settimana scorsa', mese: 'il mese scorso', anno: "l'anno scorso" };
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }), nf = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
const eurCorto = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }), nfCorto = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 });
const valore = (v, valuta) => (v == null ? '—' : valuta ? eur.format(v) : nf.format(v));

async function cruscotto(contenuto, k) {
  const saluto = (() => { const o = new Date().getHours(); return o < 13 ? 'Buongiorno' : o < 18 ? 'Buon pomeriggio' : 'Buonasera'; })();
  const griglia = h('div.cr-griglia'), azioni = h('div.cr-azioni');
  let c = null, modifica = false;
  contenuto.replaceChildren(
    h('div.testa', h('h1', `${saluto}, ${k.stato.utente.nome.split(' ')[0]}`, h('small.cr-data', new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }))), azioni),
    h('div.corpo', griglia));
  // le modifiche dei colleghi aggiornano i numeri (al massimo una volta ogni 2 secondi), finché si resta qui
  let tRic; const altrui = () => { if (modifica) return; clearTimeout(tRic); tRic = setTimeout(carica, 2000); };
  window.addEventListener('kubo:evento', altrui); window.addEventListener('hashchange', () => window.removeEventListener('kubo:evento', altrui), { once: true });
  async function carica() {
    try { c = await get('/cruscotto'); } catch (e) { griglia.replaceChildren(h('div.avviso', e.message)); return; }
    disegna();
  }
  function disegna() {
    azioni.replaceChildren(...(c.puoModificare ? (modifica
      ? [h('button.btn', { testo: '+ Aggiungi', on: { click: ev => editorWidget(ev.currentTarget, null) } }), h('button.btn.pieno', { testo: 'Fatto', on: { click: () => { modifica = false; disegna(); } } })]
      : [h('button.btn.nudo', { on: { click: () => { modifica = true; disegna(); } } }, icona('matita'), 'Modifica')]) : []));
    griglia.classList.toggle('in-modifica', modifica);
    if (!c.widget.length) { griglia.replaceChildren(h('div.vuoto', 'Il cruscotto è vuoto. ', c.puoModificare ? 'Premi «Modifica» per aggiungere numeri e grafici.' : '')); return; }
    griglia.replaceChildren(...c.widget.map((w, i) => {
      const d = c.dati[w.id] || {};
      const testa = h('div.cr-testa', h('span.cr-titolo', w.titolo || 'Senza titolo'), w.periodo && w.tipo !== 'grafico' ? h('span.cr-periodo', PERIODI[w.periodo] || '') : null,
        modifica ? h('span.cr-mod', h('button.btn.nudo.piccolo', { title: 'Prima', testo: '←', disabled: i === 0, on: { click: () => muovi(i, -1) } }), h('button.btn.nudo.piccolo', { title: 'Dopo', testo: '→', disabled: i === c.widget.length - 1, on: { click: () => muovi(i, 1) } }),
          h('button.btn.nudo.piccolo', { title: 'Cambia', on: { click: ev => editorWidget(ev.currentTarget, i) } }, icona('matita')), h('button.btn.nudo.piccolo.pericolo', { title: 'Togli', testo: '×', on: { click: () => { c.widget.splice(i, 1); salva(); } } })) : null);
      let dentro;
      try {
        dentro = d.errore ? h('div.nota', d.errore) : w.tipo === 'numero' ? numero(w, d) : w.tipo === 'grafico' ? grafico(w, d) : w.tipo === 'attenzione' ? attenzione(d) : ultime(d);
      } catch (e) { dentro = h('div.nota', 'Non riesco a disegnarlo'); console.error(e); }
      return h('section.cr-widget', { class: `cr-w-${w.tipo}${w.largo || ['attenzione', 'ultime'].includes(w.tipo) ? ' largo' : ''}` }, testa, dentro);
    }));
  }
  function numero(w, d) {
    const v = d.totali?.[0], val = d.valuta?.[0], prima = d.prima?.[0];
    let conf = null;
    if (prima != null && v != null && PRIMA[w.periodo]) {
      const diff = v - prima, pct = prima ? Math.round(diff / Math.abs(prima) * 100) : null;
      conf = h('div.cr-conf', { class: diff > 0 ? 'su' : diff < 0 ? 'giu' : '' }, diff === 0 ? `come ${COME[w.periodo]}` : `${diff > 0 ? '▲' : '▼'} ${pct != null ? Math.abs(pct) + '%' : valore(Math.abs(diff), val)} rispetto ${PRIMA[w.periodo]} (${valore(prima, val)})`);
    }
    return h('a.cr-numero', { href: `#/e/${w.entita}`, title: 'Vedi l\'elenco', on: { click: () => apriLista(w.entita, w.filtri, w.periodo && w.periodo !== 'sempre' ? { campo: w.campoData, op: 'periodo', valore: w.periodo } : null) } }, h('div.cr-valore', valore(v, val)), conf);
  }
  carica();

  function muovi(i, d) { const [w] = c.widget.splice(i, 1); c.widget.splice(i + d, 0, w); salva(); }
  async function salva() {
    try { await api('PUT', '/cruscotto', { nome: c.nome, widget: c.widget }); await carica(); } catch (e) { toast(e.message, true); }
  }

  // ---------- aggiungere o cambiare un widget ----------
  function editorWidget(ancora, i) {
    const w = i == null ? { tipo: 'numero', misura: 'conta', periodo: 'mese', filtri: [] } : structuredClone(c.widget[i]);
    const entita = k.schema.filter(e => !e.nascosta);
    const form = h('form'), err = h('div.errore-campo');
    const sel = (opzioni, attuale, cambia) => { const s = h('select.campo', opzioni.map(([v, n]) => h('option', { value: v, testo: n, selected: v === attuale }))); s.addEventListener('change', () => cambia(s.value)); return s; };
    const riga = (nome, el) => h('label.cr-riga', h('span.etichetta', nome), el);
    const disegnaForm = () => {
      const def = entita.find(e => e.id === w.entita) || entita[0]; if (def && !['attenzione', 'ultime'].includes(w.tipo)) w.entita = def.id;
      const numeri = def ? def.campi.filter(x => !x.archiviato && (['valuta', 'numero', 'durata', 'percentuale'].includes(x.tipo) || x.tipo === 'calcolato')) : [];
      const date = def ? [...def.campi.filter(x => !x.archiviato && ['data', 'data_ora'].includes(x.tipo)), { id: 'creato', nome: 'Creato il' }] : [];
      const titolo = h('input.campo', { value: w.titolo || '', placeholder: 'Es. Incassato oggi', on: { input: () => { w.titolo = titolo.value; } } });
      const parti = [h('div.pop-titolo', i == null ? 'Nuovo widget' : 'Cambia il widget'),
        riga('Tipo', sel([['numero', 'Numero'], ['grafico', 'Grafico'], ['attenzione', 'Cosa richiede attenzione'], ['ultime', 'Ultime modifiche']], w.tipo, v => { w.tipo = v; if (v === 'grafico') { w.per ||= 'giorno'; w.periodo = w.periodo && w.periodo.startsWith('ultimi') ? w.periodo : 'ultimi_30'; w.largo = true; } disegnaForm(); })),
        riga('Titolo', titolo)];
      if (['numero', 'grafico'].includes(w.tipo) && def) {
        parti.push(riga('Sezione', sel(entita.map(e => [e.id, e.nome]), w.entita, v => { w.entita = v; w.campo = null; w.campoData = null; w.filtri = []; disegnaForm(); })),
          riga('Misura', sel([['conta', 'Quanti sono'], ...(numeri.length ? [['somma', 'Somma di…'], ['media', 'Media di…']] : [])], w.misura, v => { w.misura = v; if (v !== 'conta') w.campo ||= numeri[0]?.id; disegnaForm(); })));
        if (w.misura !== 'conta') parti.push(riga('Campo', sel(numeri.map(x => [x.id, x.nome]), w.campo, v => { w.campo = v; })));
        parti.push(riga('Data di riferimento', sel(date.map(x => [x.id, x.nome]), w.campoData || date[0]?.id, v => { w.campoData = v; })));
        if (!w.campoData) w.campoData = date[0]?.id;
        const periodi = w.tipo === 'grafico' ? ['ultimi_7', 'ultimi_30', 'ultimi_84', 'ultimi_365', 'mese', 'anno'] : ['oggi', 'settimana', 'mese', 'anno', 'ultimi_30', 'sempre'];
        parti.push(riga('Periodo', sel(periodi.map(p => [p, PERIODI[p]]), w.periodo, v => { w.periodo = v; })));
        if (w.tipo === 'grafico') parti.push(h('div.pop-due', riga('Per', sel([['giorno', 'Giorno'], ['settimana', 'Settimana'], ['mese', 'Mese']], w.per, v => { w.per = v; })), riga('Forma', sel([['barre', 'Barre'], ['linea', 'Linea']], w.forma || 'barre', v => { w.forma = v; }))));
        parti.push(h('span.etichetta', 'Solo quelli con…'), costruttore(def, w.filtri || [], { schema: k.schema, cambia: l => { w.filtri = l; } }));
      }
      if (w.tipo === 'attenzione') {
        w.voci ||= [];
        parti.push(h('div.nota', 'Ogni voce conta gli elementi di una sezione che rispondono ai filtri (es. articoli da riordinare, preventivi fermi da 7 giorni).'),
          ...w.voci.map((v, j) => {
            const d = entita.find(e => e.id === v.entita);
            return h('div.cr-voce-ed', h('input.campo', { value: v.titolo || '', placeholder: 'Nome della voce', on: { input: ev => { v.titolo = ev.target.value; } } }),
              h('div.nota', d ? `${d.nome}: ${(v.filtri || []).map(f => etichetta(d, f)).join(', ') || 'tutti'}` : v.entita),
              h('button.btn.nudo.piccolo.pericolo', { type: 'button', testo: 'Togli', on: { click: () => { w.voci.splice(j, 1); disegnaForm(); } } }));
          }),
          (() => { const nv = { titolo: '', entita: entita[0]?.id, filtri: [] }; const box = h('div.cr-voce-nuova');
            const dis = () => { const d = entita.find(e => e.id === nv.entita); box.replaceChildren(h('span.etichetta', 'Nuova voce'), sel(entita.map(e => [e.id, e.nome]), nv.entita, v => { nv.entita = v; nv.filtri = []; dis(); }),
              costruttore(d, nv.filtri, { schema: k.schema, cambia: l => { nv.filtri = l; } }),
              h('button.btn.piccolo', { type: 'button', testo: 'Aggiungi la voce', on: { click: () => { if (!nv.filtri.length) { err.textContent = 'Metti almeno un filtro alla voce'; return; } nv.titolo ||= nv.filtri.map(f => etichetta(d, f)).join(', '); w.voci.push(nv); disegnaForm(); } } })); };
            dis(); return box; })());
      }
      parti.push(err, h('div.pop-azioni', h('button.btn.pieno.piccolo', { type: 'submit', testo: i == null ? 'Aggiungi' : 'Salva' })));
      form.replaceChildren(...parti);
    };
    form.addEventListener('submit', async ev => {
      ev.preventDefault(); err.textContent = '';
      if (!w.titolo?.trim()) { err.textContent = 'Dai un titolo al widget'; return; }
      try { await api('POST', '/cruscotto/anteprima', w); } catch (e) { err.textContent = e.message; return; }
      if (i == null) c.widget.push(w); else c.widget[i] = w;
      pop.chiudi(); salva();
    });
    disegnaForm();
    const pop = apriPop(ancora, form, { largo: true });
    pop.classList.add('cr-pop');
  }
}

// ---------- grafico a barre o a linea, SVG a mano: una serie, griglia leggera, valore al passaggio ----------
function grafico(w, d) {
  const g = d.gruppi || [], valuta = d.valuta?.[0], vals = g.map(x => x.valori[0] ?? 0);
  if (!g.length) return h('div.nota', 'Niente da mostrare.');
  const W = 640, H = 200, sx = 44, dx = 8, su = 10, giu = 24, max = Math.max(...vals, 0) || 1;
  const passo = scala(max), top = Math.ceil(max / passo) * passo, y = v => su + (H - su - giu) * (1 - v / top), larg = (W - sx - dx) / g.length;
  const ns = 'http://www.w3.org/2000/svg', s = (tag, attr = {}, ...figli) => { const e = document.createElementNS(ns, tag); for (const [a, v] of Object.entries(attr)) e.setAttribute(a, v); e.append(...figli); return e; };
  const corto = v => (valuta ? eurCorto.format(v) : nfCorto.format(v));
  const nomeX = k => (w.per === 'mese' ? new Date(k + '-01T12:00').toLocaleDateString('it-IT', { month: 'short' }) : w.per === 'anno' ? k : new Date(k + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cr-svg', role: 'img', 'aria-label': `${w.titolo}: grafico` });
  for (let v = 0; v <= top + 1e-9; v += passo) svg.append(s('line', { x1: sx, x2: W - dx, y1: y(v), y2: y(v), class: v === 0 ? 'cr-base' : 'cr-griglia-l' }), s('text', { x: sx - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'cr-asse' }, corto(v)));
  const ogni = Math.ceil(g.length / 6);
  g.forEach((x, i) => { if (i % ogni === 0 || i === g.length - 1 && g.length < 14) svg.append(s('text', { x: sx + larg * (i + 0.5), y: H - 6, 'text-anchor': 'middle', class: 'cr-asse' }, nomeX(x.chiave))); });
  const suggerimento = h('div.cr-sugg', { hidden: true }), box = h('div.cr-grafico', svg, suggerimento);
  const mostra = (i, ev) => {
    suggerimento.hidden = false; suggerimento.replaceChildren(h('span', nomeX(g[i].chiave)), h('b', valore(vals[i], valuta)));
    const r = box.getBoundingClientRect(); suggerimento.style.left = Math.min(r.width - 140, Math.max(0, ev.clientX - r.left + 12)) + 'px'; suggerimento.style.top = Math.max(0, ev.clientY - r.top - 44) + 'px';
  };
  if (w.forma === 'linea') {
    const pts = vals.map((v, i) => [sx + larg * (i + 0.5), y(v)]);
    svg.append(s('path', { d: `M${pts.map(p => p.join(',')).join('L')}L${pts[pts.length - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z`, class: 'cr-area' }), s('path', { d: 'M' + pts.map(p => p.join(',')).join('L'), class: 'cr-linea' }));
    const punto = s('circle', { r: 4, class: 'cr-punto', visibility: 'hidden' }), croce = s('line', { y1: su, y2: H - giu, class: 'cr-croce', visibility: 'hidden' }); svg.append(croce, punto);
    svg.append(s('rect', { x: sx, y: 0, width: W - sx - dx, height: H, fill: 'transparent', class: 'cr-tocco' }));
    svg.addEventListener('mousemove', ev => { const r = svg.getBoundingClientRect(), xx = (ev.clientX - r.left) / r.width * W, i = Math.max(0, Math.min(g.length - 1, Math.floor((xx - sx) / larg)));
      punto.setAttribute('cx', pts[i][0]); punto.setAttribute('cy', pts[i][1]); croce.setAttribute('x1', pts[i][0]); croce.setAttribute('x2', pts[i][0]); punto.setAttribute('visibility', 'visible'); croce.setAttribute('visibility', 'visible'); mostra(i, ev); });
    svg.addEventListener('mouseleave', () => { suggerimento.hidden = true; punto.setAttribute('visibility', 'hidden'); croce.setAttribute('visibility', 'hidden'); });
  } else {
    const b = Math.max(2, Math.min(36, larg - 2));
    vals.forEach((v, i) => {
      const x0 = sx + larg * i + (larg - b) / 2, alto = Math.max(0, y(0) - y(v)), r = Math.min(4, b / 2, alto);
      // barra con gli angoli tondi solo in cima
      const dPath = alto ? `M${x0},${y(0)}V${y(v) + r}Q${x0},${y(v)} ${x0 + r},${y(v)}H${x0 + b - r}Q${x0 + b},${y(v)} ${x0 + b},${y(v) + r}V${y(0)}Z` : '';
      if (dPath) svg.append(s('path', { d: dPath, class: 'cr-barra' }));
      const t = s('rect', { x: sx + larg * i, y: su, width: larg, height: H - su - giu, fill: 'transparent', class: 'cr-tocco' });
      t.addEventListener('mousemove', ev => mostra(i, ev)); t.addEventListener('mouseleave', () => { suggerimento.hidden = true; }); svg.append(t);
    });
  }
  const totale = d.totali?.[0];
  return h('div', box, h('div.cr-piede', `${PERIODI[w.periodo] || ''} · in tutto ${valore(totale, valuta)}`));
}
function scala(max) { const p = 10 ** Math.floor(Math.log10(max / 3)), n = max / 3 / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

function attenzione(d) {
  if (!d.voci?.length) return h('div.nota', 'Niente da segnalare.');
  const tutto = d.voci.every(v => !v.totale);
  if (tutto) return h('div.cr-tutto-ok', '✓ Tutto in ordine: niente da sistemare.');
  return h('ul.cr-attenzione', d.voci.filter(v => v.totale).map(v => h('li',
    h('a.cr-att-testa', { href: `#/e/${v.entita}`, title: 'Vedi l\'elenco', on: { click: () => apriLista(v.entita, v.filtri) } }, h('b', v.titolo), h('span.cr-conta', String(v.totale))),
    h('div.cr-att-righe', v.righe.map(r => h('a', { href: `#/e/${v.entita}/${r.id}`, testo: r.titolo })), v.totale > v.righe.length ? h('a.nota', { href: `#/e/${v.entita}`, testo: `e altri ${v.totale - v.righe.length}`, on: { click: () => apriLista(v.entita, v.filtri) } }) : null))));
}
// dal cruscotto alla lista con gli stessi filtri: le date relative del server («@oggi-7») diventano «prima del» / «dal»
function apriLista(entita, filtri = [], periodo = null) {
  const giornoRel = v => { const m = /^@oggi([+-]\d+)?$/.exec(v); return m ? piu(oggi(), Number(m[1] || 0)) : null; };
  const l = [...(filtri || []).flatMap(f => {
    if (typeof f.valore !== 'string' || !f.valore.startsWith('@')) return [f];
    const g = giornoRel(f.valore); if (!g) return [];
    return f.op === '<' ? [{ campo: f.campo, op: 'prima', valore: g }] : f.op === '>=' ? [{ campo: f.campo, op: 'dopo', valore: g }] : [];
  }).map(f => (f.op === '=' && f.valore === true ? { campo: f.campo, op: 'si' } : f.op === '=' && f.valore === false ? { campo: f.campo, op: 'no' } : f)), ...(periodo?.campo ? [periodo] : [])];
  try { const k = 'kubo.lista.' + entita, s = JSON.parse(localStorage.getItem(k) || '{}'); localStorage.setItem(k, JSON.stringify({ ...s, filtri: l, vista: null, raggruppa: null })); } catch {}
}
function ultime(d) {
  if (!d.voci?.length) return h('div.nota', 'Ancora nessuna modifica.');
  const verbo = { crea: 'ha creato', modifica: 'ha modificato', elimina: 'ha archiviato', ripristina: 'ha ripristinato' };
  const quando = q => { const m = Math.round((Date.now() - new Date(q)) / 6e4); return m < 1 ? 'adesso' : m < 60 ? `${m} min fa` : m < 24 * 60 ? `${Math.round(m / 60)} h fa` : new Date(q).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); };
  return h('ul.cr-ultime', d.voci.map(v => h('li', h('span', h('b', v.chi), ` ${verbo[v.tipo] || v.tipo} `, h('a', { href: `#/e/${v.entita}/${v.riga}`, testo: v.titolo || 'un elemento' }), h('span.nota', ` in ${v.nomeEntita.toLowerCase()}`)), h('span.nota', quando(v.quando)))));
}
