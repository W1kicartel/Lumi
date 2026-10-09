// WhatsApp nell'interfaccia (il server è server/moduli/whatsapp.js, la guida docs/WHATSAPP.md):
//   #/whatsapp                 conversazioni per cliente, con i non letti, la finestra di 24 ore e la risposta
//   #/whatsapp/c/<numero>      una conversazione
//   #/whatsapp/modelli         i modelli: stato, categoria, lingua, variabili abbinate ai campi; nuovo modello
//   #/whatsapp/automazioni     le automazioni pronte: accendi, scegli il modello e i tempi, anteprima
//   #/whatsapp/impostazioni    silenzio, limiti, orari, sconosciuti, tariffe, costi del mese, webhook, registro
// Nella scheda di un cliente il bottone «WhatsApp» apre la sua storia e i consensi. Gli eventi in tempo reale (SSE,
// «kubo:evento» con tipo «whatsapp») ridisegnano la pagina aperta.
import { t, locale, fusoUi } from '/lingua.js';

const ora = iso => { try { return new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: fusoUi.fuso }); } catch { return ''; } };
const quando = iso => { try { return new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: fusoUi.fuso }); } catch { return iso || ''; } };
const euro = n => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 }).format(Number(n || 0));
const COLORE = { approvato: 'verde', in_attesa: 'giallo', rifiutato: 'rosso', in_pausa: 'giallo', disattivato: 'grigio', inviato: 'blu', consegnato: 'blu', letto: 'verde', fallito: 'rosso', bloccato: 'rosso', coda: 'grigio', ricevuto: 'grigio' };
const chipStato = (h, s) => h('span.chip', { stile: { '--c': `var(--${COLORE[s] || 'grigio'})` }, testo: t('whatsapp.s-' + s) });
const finestra = f => (f?.aperta ? t('whatsapp.finestra-aperta', { ora: ora(f.scade) }) : t('whatsapp.finestra-chiusa'));
// un solo ascoltatore degli eventi in tempo reale, sostituito a ogni disegno (altrimenti si moltiplicherebbero)
let ascolto = null;
const VARIABILI = ['cliente.nome', 'cliente.email', 'riga.quando', 'riga._titolo', 'riga.totale', 'riga.scadenza', 'azienda.nome', 'ricetta.link', 'fisso:'];

async function pagina(contenuto, k, a, b) {
  const { h, get, toast } = k;
  let st; try { st = await get('/whatsapp/stato'); } catch (e) { contenuto.replaceChildren(h('div.testa', h('h1', 'WhatsApp')), h('div.corpo', h('div.avviso', e.message))); return; }
  const scheda = ['modelli', 'automazioni', 'impostazioni'].includes(a) ? a : 'conversazioni';
  const voce = (id, nome) => h(`a.btn.piccolo${scheda === id ? '.pieno' : ''}`, { href: id === 'conversazioni' ? '#/whatsapp' : `#/whatsapp/${id}` }, nome);
  const attivo = st.provider ? h('span.chip', { stile: { '--c': 'var(--verde)' }, testo: t('whatsapp.attivo', { nome: st.nome }) })
    : h('span.wa-spento', t('whatsapp.nessuno') + ' ', st.titolare ? h('a', { href: '#/connettori', testo: t('whatsapp.vai-connettori') }) : null);
  const corpo = h('div.corpo.wa');
  contenuto.replaceChildren(h('div.testa', h('h1', 'WhatsApp'), attivo, h('div.wa-schede', voce('conversazioni', st.nonLetti ? `${t('whatsapp.conversazioni')} · ${st.nonLetti}` : t('whatsapp.conversazioni')),
    voce('modelli', t('whatsapp.modelli')), voce('automazioni', t('whatsapp.automazioni')), st.titolare ? voce('impostazioni', t('whatsapp.impostazioni')) : null)), corpo);
  const ridisegna = () => pagina(contenuto, k, a, b);
  // un messaggio nuovo ridisegna le conversazioni, ma non mentre si sta scrivendo una risposta
  if (ascolto) window.removeEventListener('kubo:evento', ascolto);
  ascolto = e => { if (e.detail?.tipo === 'whatsapp' && location.hash.startsWith('#/whatsapp') && scheda === 'conversazioni' && !document.querySelector('.wa-testo')?.value) ridisegna(); };
  window.addEventListener('kubo:evento', ascolto);
  try {
    if (scheda === 'conversazioni') await conversazioni(corpo, k, st, a === 'c' && b ? decodeURIComponent(b) : null, ridisegna);
    if (scheda === 'modelli') await modelli(corpo, k, st, ridisegna);
    if (scheda === 'automazioni') await automazioni(corpo, k, st, ridisegna);
    if (scheda === 'impostazioni') await impostazioni(corpo, k, st, ridisegna);
  } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); toast(e.message, true); }
}

// ---------- conversazioni ----------
async function conversazioni(corpo, k, st, numero, ridisegna) {
  const { h, get } = k, lista = await get('/whatsapp/conversazioni');
  const sinistra = h('div.wa-lista', lista.length ? lista.map(c => h(`a.wa-voce${c.numero === numero ? '.scelta' : ''}`, { href: `#/whatsapp/c/${encodeURIComponent(c.numero)}` },
    h('div.wa-riga', h('b', { testo: c.nome }), c.nonLetti ? h('span.wa-conta', { testo: String(c.nonLetti) }) : null),
    h('div.wa-riga.nota', h('span.wa-ultimo', { testo: (c.verso === 'out' ? '↩ ' : '') + (c.testo || '') }), h('span', { testo: quando(c.quando) })),
    h(`span.wa-punto${c.finestra?.aperta ? '.aperta' : ''}`, { title: finestra(c.finestra) }))) : h('div.vuoto', t('whatsapp.vuoto')));
  const destra = h('div.wa-chat');
  corpo.replaceChildren(h('div.wa-due', sinistra, destra));
  if (!numero) { destra.append(h('div.vuoto', t('whatsapp.scegli'))); return; }
  await chat(destra, k, st, numero, ridisegna);
}
async function chat(dove, k, st, numero, ridisegna) {
  const { h, api, get, toast } = k, c = await get(`/whatsapp/conversazioni/${encodeURIComponent(numero)}`);
  if (c.messaggi.some(m => m.verso === 'in' && !m.letto)) api('POST', `/whatsapp/conversazioni/${encodeURIComponent(numero)}/letti`).catch(() => null);
  const fumetti = h('div.wa-fumetti', c.messaggi.map(m => h(`div.wa-fumetto.${m.verso}`, h('div', { testo: m.testo || (m.modello ? `[${m.modello}]` : '') }),
    h('div.wa-meta', m.modello ? h('span', { testo: m.modello }) : null, h('span', { testo: quando(m.quando) }), m.verso === 'out' ? chipStato(h, m.stato) : null, m.motivo ? h('span.wa-motivo', { testo: m.motivo }) : null))));
  const cs = c.consenso || {}, voceCons = (cat, x) => h('span', `${t('whatsapp.c-' + cat)}: `, h('b', { testo: x ? t('whatsapp.si-no-' + x.stato) : '—' }), x ? h('span.nota', { testo: ` (${quando(x.quando)}${x.fonte ? ' · ' + x.fonte : ''})` }) : null);
  const registraCons = (categoria, stato) => async () => {
    const fonte = prompt(t('whatsapp.fonte-chiedi')); if (fonte === null) return;
    const testo = stato === 'si' ? prompt(t('whatsapp.testo-chiedi'), t('whatsapp.testo-predefinito')) : null; if (stato === 'si' && testo === null) return;
    try { await api('POST', '/whatsapp/consensi', { numero, categoria, stato, fonte, testo }); ridisegna(); } catch (e) { toast(e.message, true); }
  };
  const testa = h('div.wa-testa', h('div', h('b', { testo: c.cliente?.nome || numero }), ' ', h('span.nota.mono', { testo: numero })),
    h(`div.wa-finestra${c.finestra.aperta ? '.aperta' : ''}`, { testo: finestra(c.finestra) }),
    h('div.wa-consensi', voceCons('servizio', cs.servizio), voceCons('marketing', cs.marketing),
      h('span.wa-bottoni', h('button.btn.piccolo', { type: 'button', on: { click: registraCons('servizio', 'si') } }, t('whatsapp.ok-servizio')),
        h('button.btn.piccolo', { type: 'button', on: { click: registraCons('marketing', 'si') } }, t('whatsapp.ok-marketing')),
        h('button.btn.piccolo.pericolo', { type: 'button', on: { click: registraCons('servizio', 'no') } }, t('whatsapp.revoca')))),
    !c.cliente ? h('div.wa-bottoni', h('span.nota', t('whatsapp.sconosciuto') + ' '),
      ...['cliente', 'lead'].map(x => h('button.btn.piccolo', { type: 'button', on: { click: async () => { try { await api('POST', '/whatsapp/collega', { numero, crea: x }); ridisegna(); } catch (e) { toast(e.message, true); } } } }, t('whatsapp.crea-' + x)))) : null);
  dove.replaceChildren(testa, fumetti, risposta(k, st, c, ridisegna));
  fumetti.scrollTop = fumetti.scrollHeight;
}
// la risposta: testo libero nella finestra, altrimenti un modello approvato (con l'anteprima e il motivo se non parte)
function risposta(k, st, c, ridisegna) {
  const { h, api, toast } = k, esito = h('div.nota.wa-esito');
  if (!st.provider) return h('div.avviso', t('whatsapp.nessuno'));
  const testo = h('textarea.wa-testo', { rows: 3, placeholder: c.finestra.aperta ? t('whatsapp.scrivi') : t('whatsapp.serve-modello') });
  const scelta = h('select.wa-modello', h('option', { value: '', testo: c.finestra.aperta ? t('whatsapp.testo-libero') : t('whatsapp.scegli-modello') }));
  api('GET', '/whatsapp/modelli').then(l => { for (const m of l.filter(x => x.stato === 'approvato')) scelta.append(h('option', { value: `${m.nome}|${m.lingua}`, testo: `${m.nome} · ${t('whatsapp.k-' + m.categoria)} · ${m.lingua}` })); }).catch(() => null);
  const richiesta = () => { const [nome, lingua] = scelta.value.split('|'); return scelta.value ? { numero: c.numero, modello: { nome, lingua } } : { numero: c.numero, testo: testo.value }; };
  const anteprima = async () => {
    try { const p = await api('POST', '/whatsapp/invia', { ...richiesta(), anteprima: true });
      esito.replaceChildren(p.no ? h('span.wa-motivo', { testo: p.no.messaggio }) : h('span', { testo: `${p.testo || ''} — ${t('whatsapp.costo')}: ${euro(p.costo)}` })); } catch (e) { esito.textContent = e.message; }
  };
  scelta.addEventListener('change', () => { testo.disabled = !!scelta.value; anteprima(); });
  const invia = h('button.btn.pieno', { type: 'button', on: { click: async () => {
    try { invia.disabled = true; await api('POST', '/whatsapp/invia', richiesta()); testo.value = ''; toast(t('whatsapp.inviato')); ridisegna(); } catch (e) { esito.replaceChildren(h('span.wa-motivo', { testo: e.message })); } finally { invia.disabled = false; }
  } } }, t('whatsapp.invia'));
  return h('div.wa-risposta', testo, h('div.wa-bottoni', scelta, h('button.btn', { type: 'button', on: { click: anteprima } }, t('whatsapp.anteprima')), invia), esito);
}

// ---------- modelli ----------
async function modelli(corpo, k, st, ridisegna) {
  const { h, api, get, toast } = k, lista = await get('/whatsapp/modelli');
  const sinc = h('button.btn', { type: 'button', disabled: !st.provider || !st.titolare, on: { click: async () => { try { sinc.disabled = true; await api('POST', '/whatsapp/modelli/sincronizza'); toast(t('whatsapp.sincronizzati')); ridisegna(); } catch (e) { toast(e.message, true); sinc.disabled = false; } } } }, t('whatsapp.sincronizza'));
  const righe = lista.map(m => {
    const campi = m.variabili.map(n => h('label.wa-var', h('span.mono', { testo: `{{${n}}}` }), h('input', { value: m.mappa?.[n] || '', list: 'wa-variabili', disabled: !st.titolare, on: { change: async e => {
      try { await api('PUT', `/whatsapp/modelli/${encodeURIComponent(m.nome)}/${encodeURIComponent(m.lingua)}/mappa`, { mappa: { ...m.mappa, [n]: e.target.value } }); m.mappa = { ...m.mappa, [n]: e.target.value }; toast(t('whatsapp.salvato')); } catch (x) { toast(x.message, true); }
    } } })));
    return h('div.foglio.wa-modello', h('div.wa-riga', h('b.mono', { testo: m.nome }), h('span.nota', { testo: `${t('whatsapp.k-' + m.categoria)} · ${m.lingua}` }), chipStato(h, m.stato)),
      h('p', { testo: m.corpo }), m.motivo ? h('p.wa-motivo', { testo: m.motivo }) : null, campi.length ? h('div.wa-vars', campi) : null);
  });
  const nuovo = st.titolare && st.creaModelli ? formNuovo(k, ridisegna) : null;
  corpo.replaceChildren(h('div.wa-barra', sinc, h('span.nota', t('whatsapp.modelli-nota'))), h('datalist#wa-variabili', VARIABILI.map(v => h('option', { value: v }))),
    lista.length ? h('div.wa-griglia', righe) : h('div.vuoto', t('whatsapp.nessun-modello')), nuovo);
}
function formNuovo(k, ridisegna) {
  const { h, api, toast } = k;
  const nome = h('input', { placeholder: 'ordine_pronto', pattern: '[a-z0-9_]+' }), cat = h('select', ['utility', 'marketing', 'authentication'].map(c => h('option', { value: c, testo: t('whatsapp.k-' + c) })));
  const lingua = h('input', { value: 'it', size: 5 }), testo = h('textarea', { rows: 3, placeholder: t('whatsapp.corpo-esempio') }), esempi = h('input', { placeholder: t('whatsapp.esempi-esempio') });
  return h('div.foglio.wa-nuovo', h('h3', t('whatsapp.nuovo-modello')), h('p.nota', t('whatsapp.nuovo-nota')),
    h('label', h('span.etichetta', t('whatsapp.nome')), nome), h('label', h('span.etichetta', t('whatsapp.categoria')), cat), h('label', h('span.etichetta', t('whatsapp.lingua')), lingua),
    h('label', h('span.etichetta', t('whatsapp.testo')), testo), h('label', h('span.etichetta', t('whatsapp.esempi')), esempi),
    h('button.btn.pieno', { type: 'button', on: { click: async () => {
      try { await api('POST', '/whatsapp/modelli', { nome: nome.value.trim(), categoria: cat.value, lingua: lingua.value.trim(), corpo: testo.value, esempi: esempi.value.split(';').map(x => x.trim()) }); toast(t('whatsapp.mandato-a-meta')); ridisegna(); }
      catch (e) { toast(e.message, true); }
    } } }, t('whatsapp.manda-approvazione')));
}

// ---------- automazioni pronte ----------
async function automazioni(corpo, k, st, ridisegna) {
  const { h, api, get, toast } = k, [ric, mod] = await Promise.all([get('/whatsapp/ricette'), get('/whatsapp/modelli')]);
  const approvati = mod.filter(m => m.stato === 'approvato');
  corpo.replaceChildren(h('p.nota', t('whatsapp.automazioni-nota')), h('div.wa-griglia', ric.map(r => {
    const acceso = h('input', { type: 'checkbox', checked: r.attiva, disabled: !st.titolare || !r.possibile });
    const scelta = r.tipo === 'entrata' ? null : h('select', { disabled: !st.titolare }, h('option', { value: '', testo: t('whatsapp.scegli-modello') }),
      approvati.map(m => h('option', { value: `${m.nome}|${m.lingua}`, selected: m.nome === r.modello && (!r.lingua || m.lingua === r.lingua), testo: `${m.nome} · ${m.lingua}${m.categoria !== r.categoria ? ' ⚠' : ''}` })));
    const opz = {}, campiOpz = Object.entries(r.opzioni || {}).filter(([n]) => ['ore', 'giorni', 'mesi', 'link', 'testo'].includes(n)).map(([n, v]) => {
      const i = n === 'testo' ? h('textarea', { rows: 2, value: v ?? '', disabled: !st.titolare }) : h('input', { value: Array.isArray(v) ? v.join(', ') : v ?? '', disabled: !st.titolare, size: n === 'link' ? 30 : 6 });
      opz[n] = () => (n === 'ore' ? i.value.split(/[,; ]+/).map(Number).filter(x => x > 0) : ['giorni', 'mesi'].includes(n) ? Number(i.value) || 0 : i.value);
      return h('label.wa-opz', h('span.etichetta', t('whatsapp.o-' + n)), i);
    });
    const leggiOpz = () => Object.fromEntries(Object.entries(opz).map(([n, f]) => [n, f()]));
    const anteprima = h('div.wa-anteprima.nota');
    const mostra = async () => {
      try { const [nome, lingua] = (scelta?.value || '').split('|'); const p = await api('POST', `/whatsapp/ricette/${r.id}/anteprima`, { modello: nome || null, lingua: lingua || null, opzioni: leggiOpz() });
        anteprima.replaceChildren(h('div.wa-fumetto.out', { testo: p.testo }), p.esempio ? h('div.nota', t('whatsapp.esempio-da-approvare')) : null,
          p.costo != null ? h('div', { testo: `${t('whatsapp.costo')}: ${euro(p.costo)}` }) : null, p.nota ? h('div.wa-motivo', { testo: p.nota }) : null,
          p.mancano?.length ? h('div.wa-motivo', { testo: t('whatsapp.mancano', { n: p.mancano.join(', ') }) }) : null); } catch (e) { anteprima.textContent = e.message; }
    };
    const salva = h('button.btn.pieno', { type: 'button', disabled: !st.titolare || !r.possibile, on: { click: async () => {
      try { const [nome, lingua] = (scelta?.value || '').split('|'); await api('PUT', `/whatsapp/ricette/${r.id}`, { attiva: acceso.checked, modello: nome || null, lingua: lingua || null, opzioni: leggiOpz() }); toast(t('whatsapp.salvato')); ridisegna(); }
      catch (e) { toast(e.message, true); }
    } } }, t('whatsapp.salva'));
    return h(`div.foglio.wa-ricetta${r.attiva ? '.accesa' : ''}`, h('div.wa-riga', h('label.wa-interruttore', acceso, h('b', t('whatsapp.r-' + r.id))), h('span.chip', { stile: { '--c': `var(--${r.categoria === 'marketing' ? 'viola' : 'blu'})` }, testo: t('whatsapp.k-' + r.categoria) })),
      h('p.nota', t('whatsapp.rd-' + r.id)), r.categoria === 'marketing' ? h('p.wa-motivo', t('whatsapp.serve-marketing')) : null, !r.possibile ? h('p.wa-motivo', t('whatsapp.non-possibile')) : null,
      scelta ? h('label', h('span.etichetta', t('whatsapp.modello')), scelta) : null, ...campiOpz,
      h('div.wa-bottoni', h('button.btn', { type: 'button', on: { click: mostra } }, t('whatsapp.anteprima')), salva), anteprima);
  })));
}

// ---------- impostazioni, costi, webhook, registro ----------
async function impostazioni(corpo, k, st, ridisegna) {
  const { h, api, get, toast } = k, i = st.impostazioni, reg = await get('/whatsapp/registro').catch(() => []);
  const campo = (nome, el) => h('label.wa-opz', h('span.etichetta', t('whatsapp.i-' + nome)), el);
  const v = {
    prefisso: h('input', { value: i.prefisso, size: 5 }), da: h('input', { type: 'time', value: i.silenzio.da }), a: h('input', { type: 'time', value: i.silenzio.a }),
    tutti: h('input', { type: 'checkbox', checked: i.silenzioTutti }), giorno: h('input', { type: 'number', value: i.limiteGiorno, min: 0 }), cliente: h('input', { type: 'number', value: i.maxClienteGiorno, min: 0 }),
    marketing: h('input', { type: 'number', value: i.marketingOgniGiorni, min: 0 }), sconosciuti: h('select', ['chiedi', 'cliente', 'lead'].map(x => h('option', { value: x, selected: i.sconosciuti === x, testo: t('whatsapp.sc-' + x) }))),
    apre: h('input', { type: 'time', value: i.orari.apre }), chiude: h('input', { type: 'time', value: i.orari.chiude }), giorni: h('input', { value: (i.orari.giorni || []).join(','), size: 14 }),
  };
  const tar = Object.fromEntries(['marketing', 'utility', 'authentication', 'servizio', 'servizioGratisMese', 'twilio'].map(n => [n, h('input', { type: 'number', step: 'any', min: 0, value: i.tariffe[n] ?? '', size: 8 })]));
  const salva = h('button.btn.pieno', { type: 'button', on: { click: async () => {
    try { await api('PUT', '/whatsapp/impostazioni', { prefisso: v.prefisso.value.trim(), silenzio: { da: v.da.value, a: v.a.value }, silenzioTutti: v.tutti.checked, limiteGiorno: Number(v.giorno.value), maxClienteGiorno: Number(v.cliente.value),
      marketingOgniGiorni: Number(v.marketing.value), sconosciuti: v.sconosciuti.value, orari: { apre: v.apre.value, chiude: v.chiude.value, giorni: v.giorni.value.split(/[ ,;]+/).filter(Boolean).map(Number) },
      tariffe: Object.fromEntries(Object.entries(tar).map(([n, x]) => [n, x.value === '' ? null : Number(x.value)])) }); toast(t('whatsapp.salvato')); ridisegna(); } catch (e) { toast(e.message, true); }
  } } }, t('whatsapp.salva'));
  const wh = st.webhook ? h('div.foglio', h('h3', t('whatsapp.webhook')), h('p.mono.wa-url', { testo: location.origin + st.webhook.percorso }),
    h('p.nota', st.webhook.verifica ? t('whatsapp.webhook-meta') : st.webhook.automatico ? t('whatsapp.webhook-360') : t('whatsapp.webhook-twilio')),
    h('a.btn.piccolo', { href: `#/connettori/${st.provider}` }, t('whatsapp.apri-connettore'))) : null;
  const costi = h('div.foglio', h('h3', t('whatsapp.costi-mese')), st.costi.length ? h('table.tabella', h('tbody', st.costi.map(c => h('tr', h('td', { testo: t('whatsapp.k-' + c.categoria) }), h('td', { testo: String(c.n) }), h('td', { testo: euro(c.euro) })))))
    : h('p.nota', t('whatsapp.nessun-costo')), h('p.nota', t('whatsapp.costi-nota', { data: i.tariffe.aggiornate || '' })));
  corpo.replaceChildren(h('div.wa-griglia',
    h('div.foglio', h('h3', t('whatsapp.regole')), campo('prefisso', v.prefisso), h('div.wa-riga', campo('silenzio-da', v.da), campo('silenzio-a', v.a)), h('label.wa-interruttore', v.tutti, t('whatsapp.i-silenzio-tutti')),
      campo('limite-giorno', v.giorno), campo('limite-cliente', v.cliente), campo('marketing-giorni', v.marketing), campo('sconosciuti', v.sconosciuti),
      h('div.wa-riga', campo('apre', v.apre), campo('chiude', v.chiude), campo('giorni', v.giorni))),
    h('div.foglio', h('h3', t('whatsapp.tariffe')), ...Object.entries(tar).map(([n, x]) => campo('t-' + n, x)), h('p.nota', t('whatsapp.tariffe-nota'))),
    costi, wh),
    h('div.wa-barra', salva),
    h('div.foglio', h('h3', t('whatsapp.registro')), reg.length ? h('table.tabella', h('tbody', reg.map(x => h('tr', h('td', { testo: quando(x.quando) }), h('td', { testo: x.nome || x.numero }),
      h('td', { testo: x.modello || x.tipo }), h('td', chipStato(h, x.stato)), h('td', { testo: x.motivo || '' }))))) : h('p.nota', t('whatsapp.registro-vuoto'))));
}

// ---------- nella scheda del cliente: la storia WhatsApp e i consensi ----------
async function storia(k, riga) {
  const { h, get } = k; let c; try { c = await get(`/whatsapp/cliente/${encodeURIComponent(riga.id)}`); } catch (e) { k.toast(e.message, true); return; }
  const d = h('dialog.wa-dialogo', h('div.wa-riga', h('b', t('whatsapp.storia')), h('button.btn.nudo', { type: 'button', on: { click: () => d.close() } }, '×')),
    h('div.nota', { testo: c.numero ? `${c.numero} · ${finestra(c.finestra)}` : t('whatsapp.senza-numero') }),
    h('div.nota', { testo: `${t('whatsapp.c-servizio')}: ${c.consenso?.servizio ? t('whatsapp.si-no-' + c.consenso.servizio.stato) : '—'} · ${t('whatsapp.c-marketing')}: ${c.consenso?.marketing ? t('whatsapp.si-no-' + c.consenso.marketing.stato) : '—'}` }),
    h('div.wa-fumetti', c.messaggi.length ? c.messaggi.map(m => h(`div.wa-fumetto.${m.verso}`, h('div', { testo: m.testo || '' }), h('div.wa-meta', h('span', { testo: quando(m.quando) }), m.verso === 'out' ? chipStato(h, m.stato) : null))) : h('p.nota', t('whatsapp.vuoto'))),
    c.numero ? h('a.btn.pieno', { href: `#/whatsapp/c/${encodeURIComponent(c.numero)}`, on: { click: () => d.close() } }, t('whatsapp.apri-chat')) : null);
  document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
}

export default {
  nome: 'whatsapp',
  avvio(k) { if (!document.querySelector('link[href="/moduli/whatsapp.css"]')) document.head.append(k.h('link', { rel: 'stylesheet', href: '/moduli/whatsapp.css' })); },
  lato: () => [{ href: '#/whatsapp', icona: 'utenti', nome: 'WhatsApp' }],
  rotte: { whatsapp: (contenuto, k, a, b) => pagina(contenuto, k, a, b) },
  azioniScheda(def, riga, k) {
    if (!riga?.id || !def.campi.some(c => c.tipo === 'telefono' && !c.archiviato) || !['clienti', 'soci'].includes(def.id)) return [];
    return [k.h('button.btn', { type: 'button', title: t('whatsapp.storia'), on: { click: () => storia(k, riga) } }, 'WhatsApp')];
  },
};
