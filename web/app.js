// L'applicazione: primo avvio (azienda, titolare, modelli), accesso, poi la barra laterale con le sezioni e le viste.
// Rotte: #/e/<entità> · #/e/<entità>/<id|nuovo> · #/personalizza/<entità|nuova> · #/utenti
import { h, api, get, toast, icona, ErroreApi } from './ui.js';
import { lista, scheda } from './viste.js';
import { personalizza } from './personalizza.js';
import { usaSchema } from './campi.js';
import { utenti } from './utenti.js';

const app = document.getElementById('app');
let stato = null, schema = [], eventi = null, vistaAttiva = null;
// I moduli dell'interfaccia (web/moduli/*.js), caricati all'avvio. Ognuno esporta di default un oggetto:
//   { nome, avvio?(k), lato?(k) → [{ href, icona, nome, sezione? }], rotte?: { tipo: (contenuto, k, ...parti) },
//     azioniLista?(def, k) → [elementi], azioniScheda?(def, riga, k) → [elementi] }
// k = contesto(): { stato, schema, ricaricaSchema, h, api, get, toast, icona }
export let MODULI = [];
export const contesto = () => ({ stato, schema, ricaricaSchema, h, api, get, toast, icona });

async function avvio() {
  stato = await get('/stato');
  if (!stato.configurato) return primoAvvio();
  if (!stato.utente) return accesso();
  MODULI = (await Promise.all((await get('/moduli')).map(f => import(f).then(m => m.default).catch(e => { console.error('modulo', f, e); return null; })))).filter(Boolean);
  await ricaricaSchema();
  for (const m of MODULI) try { await m.avvio?.(contesto()); } catch (e) { console.error(m.nome, e); } collegaEventi();
  window.addEventListener('hashchange', instrada); instrada();
}
async function ricaricaSchema() { schema = await get('/schema'); usaSchema(schema); disegnaLato(); }

// ---------- primo avvio ----------
async function primoAvvio() {
  const modelli = await get('/modelli');
  const f = Object.fromEntries(['azienda', 'nome', 'email', 'password'].map(k => [k, h('input.campo', { name: k, type: k === 'password' ? 'password' : k === 'email' ? 'email' : 'text', required: true, minLength: k === 'password' ? 8 : undefined, autocomplete: k === 'password' ? 'new-password' : undefined })]));
  const err = h('div');
  const form = h('form.scatola', { on: { submit: async ev => {
    ev.preventDefault(); err.replaceChildren();
    const scelti = [...form.querySelectorAll('input[name=modello]:checked')].map(x => x.value);
    try { await api('POST', '/configura', { azienda: f.azienda.value, nome: f.nome.value, email: f.email.value, password: f.password.value, modelli: scelti }); location.hash = ''; location.reload(); }
    catch (e) { err.replaceChildren(h('div.avviso', e.message)); }
  } } },
    h('h1', 'Benvenuto in Kubo'), h('p', 'Il gestionale che si monta come vuoi tu. Parti da un modello, poi cambia tutto quello che vuoi.'),
    err, h('div.riga', h('label.etichetta', 'Nome dell\'azienda'), f.azienda),
    h('div.riga', h('label.etichetta', 'Il tuo nome'), f.nome), h('div.riga', h('label.etichetta', 'Email'), f.email),
    h('div.riga', h('label.etichetta', 'Password (almeno 8 caratteri)'), f.password),
    h('label.etichetta', 'Da dove partiamo? (se ne possono aggiungere altri dopo)'),
    h('div.modelli', modelli.map((m, i) => h('label.modello', h('input', { type: 'checkbox', name: 'modello', value: m.id, checked: i === 0 }), h('div', h('b', m.nome), h('span', m.descrizione))))),
    h('button.btn.pieno', { type: 'submit', stile: { width: '100%', justifyContent: 'center', padding: '11px' } }, 'Inizia'));
  app.replaceChildren(h('div.centro', form));
}

// ---------- accesso ----------
function accesso() {
  const email = h('input.campo', { type: 'email', autocomplete: 'username', required: true }), pw = h('input.campo', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div');
  const form = h('form.scatola', { on: { submit: async ev => {
    ev.preventDefault(); err.replaceChildren();
    try { await api('POST', '/accedi', { email: email.value, password: pw.value }); location.hash = ''; location.reload(); }
    catch (e) { err.replaceChildren(h('div.avviso', e.message)); pw.select(); }
  } } }, h('h1', stato.azienda || 'Kubo'), h('p', 'Accedi per continuare.'), err,
    h('div.riga', h('label.etichetta', 'Email'), email), h('div.riga', h('label.etichetta', 'Password'), pw),
    h('button.btn.pieno', { type: 'submit', stile: { width: '100%', justifyContent: 'center', padding: '11px' } }, 'Accedi'));
  app.replaceChildren(h('div.centro', form)); email.focus();
}

// ---------- struttura ----------
let lato, contenuto;
function disegnaLato() {
  if (!lato) { lato = h('aside.lato'); contenuto = h('main.contenuto'); app.replaceChildren(h('div.app', lato, contenuto)); }
  const voci = schema.filter(e => !e.nascosta);
  lato.replaceChildren(
    h('div.marca', h('svg', { html: '' }), h('div', 'Kubo', h('small', stato.azienda || ''))),
    // le voci dei moduli con «inCima» (es. Cruscotto, Agenda) vanno sopra le sezioni
    h('nav', vociModuli().filter(v => v.inCima).map(v => h('a', { href: v.href }, icona(v.icona), v.nome)), voci.map(e => h('a', { href: `#/e/${e.id}`, 'data-e': e.id }, icona(e.icona), e.nome)),
      stato.poteri?.schema || stato.poteri?.utenti ? h('div.sez', 'Gestione') : null,
      stato.poteri?.schema ? h('a', { href: '#/personalizza/nuova' }, icona('griglia'), 'Nuova sezione') : null,
      stato.poteri?.utenti ? h('a', { href: '#/utenti' }, icona('utenti'), 'Persone e permessi') : null,
      ...vociModuli().filter(v => !v.inCima).map(v => [v.sezione ? h('div.sez', v.sezione) : null, h('a', { href: v.href }, icona(v.icona), v.nome)])),
    h('div.piede', h('span.chi', stato.utente.nome), h('button.btn.nudo.piccolo', { title: 'Esci', on: { click: async () => { await api('POST', '/esci'); location.reload(); } } }, icona('esci'))));
  lato.querySelector('.marca svg').replaceWith(logo());
  evidenzia();
}
const vociModuli = () => MODULI.flatMap(m => { try { return m.lato?.(contesto()) || []; } catch { return []; } });
function logo() { const s = icona('griglia'); s.style.width = '22px'; s.style.height = '22px'; return s; }
function evidenzia() { const e = location.hash.split('/')[2]; lato?.querySelectorAll('nav a').forEach(a => a.classList.toggle('attivo', a.getAttribute('href') === `#/e/${e}` || a.getAttribute('href') === location.hash)); }

function instrada() {
  window.onbeforeunload = null;
  const [, tipo, a, b] = (location.hash || '').replace(/^#/, '').split('/');
  evidenzia(); vistaAttiva = null;
  const def = schema.find(e => e.id === a);
  const daModulo = MODULI.find(m => m.rotte?.[tipo]);
  if (daModulo) return daModulo.rotte[tipo](contenuto, contesto(), a, b);
  if (tipo === 'e' && def && !b) {
    vistaAttiva = { entita: def.id, ...lista(def, contenuto, { schema, poteri: stato.poteri }) };
    for (const m of MODULI) for (const x of m.azioniLista?.(def, contesto()) || []) contenuto.querySelector('.testa').append(x);
    if (stato.poteri?.schema) contenuto.querySelector('.testa').append(h('a.btn.nudo', { href: `#/personalizza/${def.id}`, title: 'Personalizza questa sezione' }, icona('matita'), 'Personalizza'));
    return;
  }
  if (tipo === 'e' && def && b) return scheda(def, b, contenuto, { schema, azioni: riga => MODULI.flatMap(m => m.azioniScheda?.(def, riga, contesto()) || []) });
  if (tipo === 'personalizza' && stato.poteri?.schema) return personalizza(a === 'nuova' ? null : def, contenuto, { schema, ricaricaSchema });
  if (tipo === 'utenti' && stato.poteri?.utenti) return utenti(contenuto, { schema });
  // la pagina iniziale: quella di un modulo («casa», es. il cruscotto), altrimenti la prima sezione
  const casa = MODULI.find(m => m.casa)?.casa;
  if (casa && !tipo) { location.hash = casa; return; }
  const primo = schema.find(e => !e.nascosta);
  if (primo) location.hash = `#/e/${primo.id}`;
  else contenuto.replaceChildren(h('div.corpo', h('div.vuoto', 'Nessuna sezione. ', stato.poteri?.schema ? h('a', { href: '#/personalizza/nuova' }, 'Creane una') : 'Chiedi al titolare di crearne una.')));
}

// ---------- tempo reale: quando un altro modifica, la lista si aggiorna da sola ----------
function collegaEventi() {
  eventi?.close(); eventi = new EventSource('/api/eventi');
  eventi.onmessage = m => {
    const ev = JSON.parse(m.data);
    if (ev.tipo === 'avviso') return toast(ev.testo);
    window.dispatchEvent(new CustomEvent('kubo:evento', { detail: ev }));   // per i moduli (es. calendario e cruscotto)
    if (ev.da === stato.utente.id) return;
    if (vistaAttiva?.entita === ev.entita) vistaAttiva.ricarica();
  };
}

avvio().catch(e => { app.replaceChildren(h('div.centro', h('div.scatola', h('h1', 'Qualcosa non va'), h('p', e.message)))); });
