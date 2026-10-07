// Lumi nell'interfaccia di Kubo: la pillola in alto (il motore è in /lumi/, copiato dal progetto Lumi), con gli strumenti
// generati dallo schema (./lumi/strumenti.js), «Da vedere» dal server e le azioni rapide. Senza la chiave di Claude la
// pillola resta, mostra «Da vedere» e dice con garbo come accenderla. Le impostazioni (#/lumi) sono del titolare.
import { Lumi } from '/lumi/lumi.js';
import { strumenti, istruzioni } from './lumi/strumenti.js';

let K = null, schema = [], lumi = null;
const ICONA = { persona: 'cliente', calendario: 'agenda', cassa: 'ordine', scatola: 'magazzino', documento: 'documento', furgone: 'ordine', attrezzi: 'documento' };
const titolare = () => K?.stato.utente?.ruolo === 'titolare';

async function accendi(k) {
  K = k; schema = k.schema;
  if (!document.querySelector('link[data-kubo-lumi]')) document.head.append(k.h('link', { rel: 'stylesheet', href: '/moduli/lumi.css', 'data-kubo-lumi': '' }));
  const s = await k.api('POST', '/lumi', { azione: 'stato' }).catch(() => null), vero = !!s?.claude;
  document.documentElement.classList.add('con-lumi');
  lumi = Lumi.avvia({
    nome: k.stato.azienda || '', lingua: 'it', utente: k.stato.utente.nome,
    server: vero ? '/api/lumi' : null, intestazioni: { 'X-Kubo': '1' },
    tema: matchMedia('(prefers-color-scheme: dark)').matches ? undefined : 'chiaro',
    strumenti: () => strumenti({ schema, api: k.api, poteri: k.stato.poteri || {}, dopoSchema, apri: aggiornaVista }),
    istruzioni: istruzioni({ poteri: k.stato.poteri || {} }),
    contesto, daVedere, azioni: azioni(vero), aggiorna: 60000,
    ...(vero ? {} : {
      locale: async () => {
        if (titolare()) setTimeout(() => { location.hash = '#/lumi'; }, 1600);
        return { testo: titolare() ? `Per rispondere mi serve la chiave di Claude${s?.attivo === false ? ' e che tu mi riaccenda' : ''}. Ti apro **Gestione → Lumi**: ci vuole un minuto.`
          : 'Per rispondere mi serve la chiave di Claude: chiedi al titolare di aggiungerla in **Gestione → Lumi**.' };
      },
      testi: { 'avviso.collega': s?.attivo === false ? 'Lumi è spento: si riaccende in Gestione → Lumi.' : 'Lumi è quasi pronto: manca la chiave di Claude.' },
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

async function daVedere() {
  const cose = await K.get('/lumi/da-vedere').catch(() => []);
  return cose.map(x => ({ testo: x.testo, numero: x.numero, livello: x.livello, bottone: 'Apri', apri: () => { location.hash = `#/e/${x.entita}`; } }));
}

function azioni(vero) {
  const nuove = schema.filter(e => !e.nascosta && e.puo?.crea).slice(0, vero ? 3 : 4)
    .map(e => ({ testo: `Nuovo in ${e.nome.toLowerCase()}`, icona: ICONA[e.icona] || 'piu', fai: () => { location.hash = `#/e/${e.id}/nuovo`; } }));
  if (vero) nuove.push({ testo: 'Com\'è la settimana', icona: 'grafico', fai: () => lumi?.chiedi('Com\'è andata questa settimana? Dammi i numeri principali.') });
  if (K.stato.poteri?.schema) nuove.push({ testo: 'Nuova sezione', icona: 'piu', fai: () => { location.hash = '#/personalizza/nuova'; } });
  if (!vero && titolare()) nuove.push({ testo: 'Accendi Lumi', icona: 'apri', fai: () => { location.hash = '#/lumi'; } });
  return nuove.slice(0, 6);
}

// ---------- impostazioni (#/lumi): solo il titolare ----------
// le proprietà --x non si impostano con Object.assign(style): serve setProperty
const colore = (e, c) => { e.style.setProperty('--c', `var(--${c})`); return e; };
async function impostazioni(contenuto, k) {
  const { h, api, toast } = k;
  if (k.stato.utente?.ruolo !== 'titolare') { contenuto.replaceChildren(h('div.corpo', h('div.avviso', 'Le impostazioni di Lumi sono del titolare.'))); return; }
  let st; try { st = await api('GET', '/lumi/impostazioni'); } catch (e) { contenuto.replaceChildren(h('div.corpo', h('div.avviso', e.message))); return; }
  const chiave = h('input.campo.mono', { type: 'password', placeholder: st.chiave ? '•••••••• (già salvata)' : 'sk-ant-…', autocomplete: 'off', spellcheck: false });
  const attivo = h('input', { type: 'checkbox', checked: st.attivo }), limite = h('input.campo', { type: 'number', min: 1, max: 600, value: st.limite, stile: { width: '110px' } });
  const salva = async corpo => {
    try { await api('PUT', '/lumi/impostazioni', corpo); toast('Salvato'); await accendi(k); impostazioni(contenuto, k); } catch (e) { toast(e.message, true); }
  };
  const stato = !st.attivo ? ['Spento', 'grigio'] : st.chiave ? ['Acceso', 'verde'] : ['Manca la chiave', 'giallo'];
  contenuto.replaceChildren(
    h('div.testa', h('h1', 'Lumi')),
    h('div.corpo.kubo-lumi',
      h('div.foglio',
        h('div.kubo-lumi-riga', colore(h('span.chip', { testo: stato[0] }), stato[1]),
          h('span.nota', st.fonte === 'ambiente' ? 'La chiave arriva dalla variabile ANTHROPIC_API_KEY del server.' : st.fonte ? 'Chiave salvata su questo computer.' : '')),
        h('p', 'Lumi è l\'assistente di Kubo. Gli parli o gli scrivi dalla pillola in alto: cerca, conta, prepara schede e cambia la forma del gestionale. Ogni modifica aspetta il tuo «Conferma», e ognuno vede solo quello che i suoi permessi gli lasciano vedere.'),
        h('label.etichetta', 'Chiave di Claude'),
        h('div.kubo-lumi-riga', chiave, h('button.btn.pieno', { testo: 'Salva la chiave', on: { click: () => (chiave.value.trim() ? salva({ chiave: chiave.value.trim(), attivo: true }) : toast('Incolla la chiave', true)) } }),
          st.fonte === 'impostazioni' ? h('button.btn.pericolo', { testo: 'Togli', on: { click: () => { if (confirm('Togliere la chiave? Lumi smette di rispondere.')) salva({ togliChiave: true }); } } }) : null),
        h('p.nota', 'La crei su console.anthropic.com, alla voce API Keys. Resta su questo computer, in un file accanto ai dati che solo Kubo legge, e non arriva mai ai browser.'),
        h('div.kubo-lumi-riga', { stile: { marginTop: '18px' } },
          h('label.kubo-lumi-interruttore', attivo, 'Lumi acceso'),
          h('label.kubo-lumi-interruttore', 'Domande al minuto per persona', limite),
          h('button.btn', { testo: 'Salva', on: { click: () => salva({ attivo: attivo.checked, limite: Number(limite.value) }) } }))),
      h('div.foglio', { stile: { marginTop: '16px' } },
        h('div.etichetta', 'Da provare'),
        h('ul.kubo-lumi-esempi', ['Quanto ho venduto questa settimana?', 'Cosa devo riordinare?', 'Aggiungi la taglia agli articoli con S, M, L e XL',
          'Fammi una sezione per i noleggi con cliente, attrezzo, dal, al e stato', 'Quando un noleggio passa a restituito avvisami'].map(t => h('li', t))),
        h('p.nota', `Modello: ${st.modello}. ${st.voce ? 'Voce in tempo reale accesa.' : 'Voce: quella del browser, dove c\'è.'}`))));
}

export default {
  nome: 'lumi',
  avvio: accendi,
  lato: k => (k.stato.utente?.ruolo === 'titolare' ? [{ href: '#/lumi', icona: 'stella', nome: 'Lumi' }] : []),
  rotte: { lumi: (contenuto, k) => impostazioni(contenuto, k) },
};
