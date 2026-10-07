// Lumi nell'interfaccia di Kubo: la pillola in alto (il motore è in /lumi/, copiato dal progetto Lumi), con gli strumenti
// generati dallo schema (./lumi/strumenti.js), «Da vedere» dal server e le azioni rapide. Senza la chiave di Claude la
// pillola resta, mostra «Da vedere» e dice con garbo come accenderla. Le impostazioni (#/lumi) sono del titolare.
import { Lumi } from '/lumi/lumi.js';
import { strumenti, istruzioni } from './lumi/strumenti.js';
import { t, lingua, minuscole } from '../lingua.js';

let K = null, schema = [], lumi = null;
const ICONA = { persona: 'cliente', calendario: 'agenda', cassa: 'ordine', scatola: 'magazzino', documento: 'documento', furgone: 'ordine', attrezzi: 'documento' };
const titolare = () => K?.stato.utente?.ruolo === 'titolare';

async function accendi(k) {
  K = k; schema = k.schema;
  if (!document.querySelector('link[data-kubo-lumi]')) document.head.append(k.h('link', { rel: 'stylesheet', href: '/moduli/lumi.css', 'data-kubo-lumi': '' }));
  const s = await k.api('POST', '/lumi', { azione: 'stato' }).catch(() => null), vero = !!s?.claude;
  document.documentElement.classList.add('con-lumi');
  lumi = Lumi.avvia({
    nome: k.stato.azienda || '', lingua, utente: k.stato.utente.nome,
    server: vero ? '/api/lumi' : null, intestazioni: { 'X-Kubo': '1' },
    tema: matchMedia('(prefers-color-scheme: dark)').matches ? undefined : 'chiaro',
    strumenti: () => strumenti({ schema, api: k.api, poteri: k.stato.poteri || {}, dopoSchema, apri: aggiornaVista }),
    istruzioni: istruzioni({ poteri: k.stato.poteri || {} }),
    contesto, daVedere, azioni: azioni(vero), aggiorna: 60000,
    ...(vero ? {} : {
      locale: async () => {
        if (titolare()) setTimeout(() => { location.hash = '#/lumi'; }, 1600);
        return { testo: titolare() ? (s?.attivo === false ? t('moduli.lumi-serve-chiave-spento') : t('moduli.lumi-serve-chiave')) : t('moduli.lumi-chiedi-titolare') };
      },
      testi: { 'avviso.collega': s?.attivo === false ? t('moduli.lumi-spento') : t('moduli.lumi-quasi-pronto') },
    }),
  });
}

// lo schema cambia (da Lumi o da Personalizza): gli strumenti si rigenerano al giro dopo
async function dopoSchema() {
  await K.ricaricaSchema(); schema = await K.get('/schema');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
// dopo una creazione o una modifica, la vista aperta si ridisegna se non ha modifiche non salvate
function aggiornaVista(entita) {
  if (!location.hash.startsWith(`#/e/${entita}`) || window.onbeforeunload?.()) return;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

async function contesto() {
  schema = await K.get('/schema').catch(() => schema);
  const u = K.stato.utente, righe = [`Chi chiede: ${u.nome} (${u.ruolo}).`, `Sezioni: ${schema.filter(e => !e.nascosta).map(e => `${e.nome} (${e.id})`).join(', ') || 'nessuna'}.`];
  const [, tipo, a, b] = location.hash.replace(/^#/, '').split('/'), def = schema.find(e => e.id === a);
  if (tipo === 'e' && def) righe.push(b && b !== 'nuovo' ? `Sta guardando la scheda ${b} in ${def.nome} (${def.id}).` : b === 'nuovo' ? `Sta creando un elemento in ${def.nome}.` : `Sta guardando la lista di ${def.nome}.`);
  else if (tipo === 'personalizza') righe.push('Sta personalizzando il gestionale.');
  return righe.join('\n');
}

// i testi di «Da vedere» arrivano dal server in italiano, con i nomi delle sezioni: le due frasi fisse si rimettono nella lingua
function testoDaVedere(x) {
  let m = /^(.+): ferme su «(.+)» da più di una settimana$/.exec(x); if (m) return t('moduli.lumi-dv-ferme', { sezione: m[1], stato: m[2] });
  m = /^(.+) oltre «(.+)»$/.exec(x); if (m) return t('moduli.lumi-dv-oltre', { sezione: m[1], campo: m[2] });
  return x;
}
async function daVedere() {
  const cose = await K.get('/lumi/da-vedere').catch(() => []);
  return cose.map(x => ({ testo: testoDaVedere(x.testo), numero: x.numero, livello: x.livello, bottone: t('moduli.lumi-apri'), apri: () => { location.hash = `#/e/${x.entita}`; } }));
}

function azioni(vero) {
  const nuove = schema.filter(e => !e.nascosta && e.puo?.crea).slice(0, vero ? 3 : 4)
    .map(e => ({ testo: t('viste.nuovo-in', { nome: minuscole(e.nome) }), icona: ICONA[e.icona] || 'piu', fai: () => { location.hash = `#/e/${e.id}/nuovo`; } }));
  if (vero) nuove.push({ testo: t('moduli.lumi-settimana'), icona: 'grafico', fai: () => lumi?.chiedi(t('moduli.lumi-settimana-domanda')) });
  if (K.stato.poteri?.schema) nuove.push({ testo: t('comune.nuova-sezione'), icona: 'piu', fai: () => { location.hash = '#/personalizza/nuova'; } });
  if (!vero && titolare()) nuove.push({ testo: t('moduli.lumi-accendi'), icona: 'apri', fai: () => { location.hash = '#/lumi'; } });
  return nuove.slice(0, 6);
}

// ---------- impostazioni (#/lumi): solo il titolare ----------
// le proprietà --x non si impostano con Object.assign(style): serve setProperty
const colore = (e, c) => { e.style.setProperty('--c', `var(--${c})`); return e; };
async function impostazioni(contenuto, k) {
  const { h, api, toast } = k;
  if (k.stato.utente?.ruolo !== 'titolare') { contenuto.replaceChildren(h('div.corpo', h('div.avviso', t('moduli.lumi-solo-titolare')))); return; }
  let st; try { st = await api('GET', '/lumi/impostazioni'); } catch (e) { contenuto.replaceChildren(h('div.corpo', h('div.avviso', e.message))); return; }
  const chiave = h('input.campo.mono', { type: 'password', placeholder: st.chiave ? t('moduli.lumi-gia-salvata') : 'sk-ant-…', autocomplete: 'off', spellcheck: false });
  const attivo = h('input', { type: 'checkbox', checked: st.attivo }), limite = h('input.campo', { type: 'number', min: 1, max: 600, value: st.limite, stile: { width: '110px' } });
  const salva = async corpo => {
    try { await api('PUT', '/lumi/impostazioni', corpo); toast(t('viste.salvato')); await accendi(k); impostazioni(contenuto, k); } catch (e) { toast(e.message, true); }
  };
  const stato = !st.attivo ? [t('moduli.lumi-stato-spento'), 'grigio'] : st.chiave ? [t('moduli.lumi-stato-acceso'), 'verde'] : [t('moduli.lumi-stato-manca'), 'giallo'];
  contenuto.replaceChildren(
    h('div.testa', h('h1', 'Lumi')),
    h('div.corpo.kubo-lumi',
      h('div.foglio',
        h('div.kubo-lumi-riga', colore(h('span.chip', { testo: stato[0] }), stato[1]),
          h('span.nota', st.fonte === 'ambiente' ? t('moduli.lumi-fonte-ambiente') : st.fonte ? t('moduli.lumi-fonte-file') : '')),
        h('p', t('moduli.lumi-cos-e')),
        h('label.etichetta', t('moduli.lumi-chiave')),
        h('div.kubo-lumi-riga', chiave, h('button.btn.pieno', { testo: t('moduli.lumi-salva-chiave'), on: { click: () => (chiave.value.trim() ? salva({ chiave: chiave.value.trim(), attivo: true }) : toast(t('moduli.lumi-incolla'), true)) } }),
          st.fonte === 'impostazioni' ? h('button.btn.pericolo', { testo: t('comune.togli'), on: { click: () => { if (confirm(t('moduli.lumi-togliere'))) salva({ togliChiave: true }); } } }) : null),
        h('p.nota', t('moduli.lumi-dove-chiave')),
        h('div.kubo-lumi-riga', { stile: { marginTop: '18px' } },
          h('label.kubo-lumi-interruttore', attivo, t('moduli.lumi-acceso')),
          h('label.kubo-lumi-interruttore', t('moduli.lumi-limite'), limite),
          h('button.btn', { testo: t('viste.salva'), on: { click: () => salva({ attivo: attivo.checked, limite: Number(limite.value) }) } }))),
      h('div.foglio', { stile: { marginTop: '16px' } },
        h('div.etichetta', t('moduli.lumi-da-provare')),
        h('ul.kubo-lumi-esempi', [1, 2, 3, 4, 5].map(i => h('li', t('moduli.lumi-esempio-' + i)))),
        h('p.nota', t('moduli.lumi-modello', { modello: st.modello }), ' ', st.voce ? t('moduli.lumi-voce-accesa') : t('moduli.lumi-voce-browser')))));
}

export default {
  nome: 'lumi',
  avvio: accendi,
  lato: k => (k.stato.utente?.ruolo === 'titolare' ? [{ href: '#/lumi', icona: 'stella', nome: 'Lumi' }] : []),
  rotte: { lumi: (contenuto, k) => impostazioni(contenuto, k) },
};
