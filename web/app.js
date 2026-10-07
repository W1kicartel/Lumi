// L'applicazione: primo avvio (azienda, titolare, modelli), accesso, poi la barra laterale con le sezioni e le viste.
// Rotte: #/e/<entità> · #/e/<entità>/<id|nuovo> · #/personalizza/<entità|nuova> · #/utenti
import { h, api, get, toast, icona, ErroreApi } from './ui.js';
import { lista, scheda } from './viste.js';
import { personalizza } from './personalizza.js';
import { usaSchema } from './campi.js';
import { utenti } from './utenti.js';
import { filtriDaIndirizzo } from './filtri.js';
import { t, LINGUE, lingua, imposta, VALUTE, valutaProposta } from './lingua.js';

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
  // il primo avvio guidato (web/moduli/avvio.js); se manca, quello semplice qui sotto
  if (!stato.configurato) return import('/moduli/avvio.js').then(m => m.primoAvvio(app)).catch(e => { console.error('avvio guidato', e); return primoAvvio(); });
  if (!stato.utente) return accesso();
  MODULI = (await Promise.all((await get('/moduli')).map(f => import(f).then(m => m.default).catch(e => { console.error('modulo', f, e); return null; })))).filter(Boolean);
  await ricaricaSchema();
  for (const m of MODULI) try { await m.avvio?.(contesto()); } catch (e) { console.error(m.nome, e); } collegaEventi();
  window.addEventListener('hashchange', instrada); instrada();
}
async function ricaricaSchema() { schema = await get('/schema'); usaSchema(schema); disegnaLato(); }

// ---------- primo avvio ----------
async function primoAvvio() {
  const modelli = await get(`/lingua/modelli?l=${lingua}`).catch(() => get('/modelli'));
  const sValuta = h('select.campo', VALUTE.map(v => h('option', { value: v, testo: v, selected: v === valutaProposta() })));
  const f = Object.fromEntries(['azienda', 'nome', 'email', 'password'].map(k => [k, h('input.campo', { name: k, type: k === 'password' ? 'password' : k === 'email' ? 'email' : 'text', required: true, minLength: k === 'password' ? 8 : undefined, autocomplete: k === 'password' ? 'new-password' : undefined })]));
  const err = h('div');
  const codice = stato.serveCodice ? h('input.campo.mono', { name: 'codice', required: true, autocomplete: 'off', placeholder: t('comune.codice-avvio-es') }) : null;
  const form = h('form.scatola', { on: { submit: async ev => {
    ev.preventDefault(); err.replaceChildren();
    const scelti = [...form.querySelectorAll('input[name=modello]:checked')].map(x => x.value);
    // la lingua e la valuta dell'azienda prima dei modelli: i modelli si installano già tradotti
    try { await api('PUT', '/lingua/azienda', { lingua, valuta: sValuta.value, codice: codice?.value }); await api('POST', '/configura', { azienda: f.azienda.value, nome: f.nome.value, email: f.email.value, password: f.password.value, modelli: scelti, codice: codice?.value }); location.hash = ''; location.reload(); }
    catch (e) { err.replaceChildren(h('div.avviso', e.message)); }
  } } },
    h('div.lingue-scegli', sceltaLingua()), h('h1', t('comune.benvenuto')), h('p', t('comune.benvenuto-sotto')),
    err, codice ? h('div.riga', h('label.etichetta', t('comune.codice-avvio')), codice) : null,
    h('div.riga', h('label.etichetta', t('comune.nome-azienda')), f.azienda),
    h('div.riga', h('label.etichetta', t('comune.tuo-nome')), f.nome), h('div.riga', h('label.etichetta', t('comune.email')), f.email),
    h('div.riga', h('label.etichetta', t('comune.password-nuova')), f.password),
    h('div.riga', h('label.etichetta', t('comune.valuta')), sValuta),
    h('label.etichetta', t('comune.da-dove')),
    h('div.modelli', modelli.map((m, i) => h('label.modello', h('input', { type: 'checkbox', name: 'modello', value: m.id, checked: i === 0 }), h('div', h('b', m.nome), h('span', m.descrizione))))),
    h('button.btn.pieno', { type: 'submit', stile: { width: '100%', justifyContent: 'center', padding: '11px' } }, t('comune.inizia')));
  app.replaceChildren(h('div.centro', form));
}
// la lingua prima dell'accesso: si ricorda in questo browser (lingua.js) e la pagina si ricarica nella lingua scelta
function sceltaLingua() {
  return h('select.campo.piccolo', { title: t('comune.lingua'), 'aria-label': t('comune.lingua'), stile: { ...STILE_LINGUA, float: 'right', marginBottom: '6px' }, on: { change: ev => { try { localStorage.setItem('kubo.lingua', ev.target.value); } catch { } location.reload(); } } },
    Object.entries(LINGUE).map(([c, l]) => h('option', { value: c, testo: l.nome, selected: c === lingua })));
}

// ---------- accesso ----------
function accesso() {
  const email = h('input.campo', { type: 'email', autocomplete: 'username', required: true }), pw = h('input.campo', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div');
  const form = h('form.scatola', { on: { submit: async ev => {
    ev.preventDefault(); err.replaceChildren();
    try { await api('POST', '/accedi', { email: email.value, password: pw.value }); location.hash = ''; location.reload(); }
    catch (e) { err.replaceChildren(h('div.avviso', e.message)); pw.select(); }
  } } }, h('div.lingue-scegli', sceltaLingua()), h('h1', stato.azienda || 'Kubo'), h('p', t('comune.accedi-per')), err,
    h('div.riga', h('label.etichetta', t('comune.email')), email), h('div.riga', h('label.etichetta', t('comune.password')), pw),
    h('button.btn.pieno', { type: 'submit', stile: { width: '100%', justifyContent: 'center', padding: '11px' } }, t('comune.accedi')));
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
      stato.poteri?.schema || stato.poteri?.utenti ? h('div.sez', t('comune.gestione')) : null,
      stato.poteri?.schema ? h('a', { href: '#/personalizza/nuova' }, icona('griglia'), t('comune.nuova-sezione')) : null,
      stato.poteri?.utenti ? h('a', { href: '#/utenti' }, icona('utenti'), t('comune.persone-permessi')) : null,
      ...vociModuli().filter(v => !v.inCima).map(v => [v.sezione ? h('div.sez', v.sezione) : null, h('a', { href: v.href }, icona(v.icona), v.nome)])),
    h('div.piede', h('span.chi', stato.utente.nome), linguaUtente(), h('button.btn.nudo.piccolo', { title: t('comune.esci'), on: { click: async () => { await api('POST', '/esci'); location.reload(); } } }, icona('esci'))));
  lato.querySelector('.marca svg').replaceWith(logo());
  evidenzia();
}
// lo stile dei due selettori della lingua: piccolo e discreto, con i colori del tema (stile.css)
const STILE_LINGUA = { font: 'inherit', fontSize: '12px', color: 'var(--tenue)', background: 'transparent', border: '1px solid var(--linea)', borderRadius: '6px', padding: '3px 4px', cursor: 'pointer' };
// il selettore della lingua nel piede: la scelta si salva sul server per questo utente (lingua.js, imposta)
function linguaUtente() {
  return h('select.lingua-piede', { title: t('comune.lingua'), 'aria-label': t('comune.lingua'), stile: STILE_LINGUA, on: { change: ev => imposta(ev.target.value) } },
    Object.entries(LINGUE).map(([c]) => h('option', { value: c, testo: c.toUpperCase(), selected: c === lingua })));
}
const vociModuli = () => MODULI.flatMap(m => { try { return m.lato?.(contesto()) || []; } catch { return []; } });
function logo() { const s = icona('griglia'); s.style.width = '22px'; s.style.height = '22px'; return s; }
function evidenzia() { const e = location.hash.split('?')[0].split('/')[2]; lato?.querySelectorAll('nav a').forEach(a => a.classList.toggle('attivo', a.getAttribute('href') === `#/e/${e}` || a.getAttribute('href') === location.hash)); }

function instrada() {
  window.onbeforeunload = null;
  const [, tipo, a, b] = (location.hash || '').replace(/^#/, '').split('?')[0].split('/');   // dopo «?» i filtri (filtri.js)
  if (tipo === 'e' && a && !b && location.hash.includes('?')) filtriDaIndirizzo(a);
  evidenzia(); vistaAttiva = null;
  const def = schema.find(e => e.id === a);
  const daModulo = MODULI.find(m => m.rotte?.[tipo]);
  if (daModulo) return daModulo.rotte[tipo](contenuto, contesto(), a, b);
  if (tipo === 'e' && def && !b) {
    vistaAttiva = { entita: def.id, ...lista(def, contenuto, { schema, poteri: stato.poteri }) };
    for (const m of MODULI) for (const x of m.azioniLista?.(def, contesto()) || []) contenuto.querySelector('.testa').append(x);
    if (stato.poteri?.schema) contenuto.querySelector('.testa').append(h('a.btn.nudo', { href: `#/personalizza/${def.id}`, title: t('comune.personalizza-sezione') }, icona('matita'), t('comune.personalizza')));
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
  else contenuto.replaceChildren(h('div.corpo', h('div.vuoto', t('comune.nessuna-sezione'), ' ', stato.poteri?.schema ? h('a', { href: '#/personalizza/nuova' }, t('comune.creane-una')) : t('comune.chiedi-titolare'))));
}

// ---------- tempo reale: quando un altro modifica, la lista si aggiorna da sola ----------
function collegaEventi() {
  eventi?.close(); eventi = new EventSource('/api/eventi');
  eventi.onmessage = m => {
    const ev = JSON.parse(m.data);
    // gli avvisi fissi dei moduli arrivano con una chiave e si mostrano nella lingua di chi guarda; gli altri come sono
    if (ev.tipo === 'avviso') return toast({ 'esempi-aggiunti': () => t('comune.avviso-esempi-aggiunti'), 'esempi-tolti': () => t('comune.avviso-esempi-tolti') }[ev.chiave]?.() ?? ev.testo);
    window.dispatchEvent(new CustomEvent('kubo:evento', { detail: ev }));   // per i moduli (es. calendario e cruscotto)
    if (ev.da === stato.utente.id) return;
    if (vistaAttiva?.entita === ev.entita) vistaAttiva.ricarica();
  };
}

avvio().catch(e => { app.replaceChildren(h('div.centro', h('div.scatola', h('h1', t('comune.qualcosa-non-va')), h('p', e.message)))); });
