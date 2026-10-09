// Import ed export, backup, API e integrazioni (lato interfaccia; il server è in server/moduli/import*.js).
//   #/importa[/<entità>]  carica un .xlsx o .csv → anteprima → abbinamento colonne ↔ campi → doppioni → rapporto
//   #/api                 token personali, documentazione generata dallo schema, webhook (solo il titolare)
// Nella testa di ogni lista: «Importa» ed «Esporta» (Excel o CSV, con i filtri della lista in quel momento).
import { carica, peso } from '/campi.js';
import { t, numero, simbolo, minuscole, data as dataL, dataOra as dataOraL } from '/lingua.js';

const NON_IMPORTABILI = ['calcolato', 'contatore', 'righe', 'file', 'immagine'];
// i nomi dei tipi sono quelli di Personalizza (gestione.tipo-<tipo>), nella lingua di chi importa
const TIPI_NUOVI = ['testo', 'testo_lungo', 'numero', 'valuta', 'percentuale', 'data', 'data_ora', 'si_no', 'scelta', 'scelta_multipla', 'email', 'telefono', 'url', 'indirizzo', 'codice_a_barre']
  .map(k => [k, t('gestione.tipo-' + k, { simbolo: simbolo() })]);
const nomeTipo = tipo => TIPI_NUOVI.find(x => x[0] === tipo)?.[1] || tipo;
// i valori dell'anteprima come li legge il server (1.234,5 · 31/12/2026 · Sì), con i numeri e il sì/no nella lingua di chi guarda
const comeTesto = x => (x == null ? '' : typeof x === 'boolean' ? (x ? t('comune.si') : t('comune.no')) : typeof x === 'number' ? numero(x, 6)
  : /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(x) ? x.slice(0, 10).split('-').reverse().join('/') + (x.length > 10 ? ' ' + x.slice(11, 16) : '') : String(x));
const scarica = (href, nome) => { const a = document.createElement('a'); a.href = href; if (nome) a.download = nome; document.body.append(a); a.click(); a.remove(); };

// ---------- testa della lista ----------
function azioniLista(def, k) {
  const { h, icona } = k;
  const esporta = formato => () => { const q = new URLSearchParams(document.querySelector('.contenuto')?.dataset.query || ''); q.delete('p'); q.delete('n'); q.set('formato', formato); scarica(`/api/import/esporta/${def.id}?${q}`); };
  const menu = h('details.import-menu', h('summary.btn.nudo', { title: t('moduli.im-menu') }, icona('documento'), 'Excel'),
    h('div', def.puo.crea ? h('a', { href: `#/importa/${def.id}`, on: { click: () => { menu.open = false; } } }, t('moduli.im-importa-da')) : null, h('hr'),
      h('button', { type: 'button', on: { click: esporta('xlsx') } }, t('moduli.im-esporta-xlsx')), h('button', { type: 'button', on: { click: esporta('csv') } }, t('moduli.im-esporta-csv'))));
  const chiudi = ev => { if (!menu.isConnected) document.removeEventListener('click', chiudi); else if (!menu.contains(ev.target)) menu.open = false; };
  document.addEventListener('click', chiudi);
  return [menu];
}

// ---------- importa ----------
function paginaImporta(contenuto, k, entita) {
  const { h, schema, stato } = k;
  const destinazioni = schema.filter(e => !e.nascosta && e.puo.crea);
  const scelta = h('select.campo', destinazioni.map(e => h('option', { value: e.id, testo: e.nome, selected: e.id === entita })),
    stato.poteri?.schema ? h('option', { value: '__nuova', testo: t('moduli.im-nuova-dal-foglio'), selected: entita === 'nuova' }) : null);
  const modello = h('a.btn.piccolo.nudo', { href: '#', on: { click: ev => { ev.preventDefault(); if (scelta.value !== '__nuova') scarica(`/api/import/esporta/${scelta.value}?formato=xlsx&vuoto=1`); } } }, t('moduli.im-scarica-modello'));
  scelta.addEventListener('change', () => { modello.hidden = scelta.value === '__nuova'; });
  modello.hidden = scelta.value === '__nuova';
  const zona = h('label.import-zona', h('input', { type: 'file', accept: '.xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true, on: { change: ev => ev.target.files[0] && parti(ev.target.files[0]) } }),
    h('b', t('moduli.im-scegli-file')), h('span.nota', t('moduli.im-trascina')));
  zona.tabIndex = 0; zona.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); zona.querySelector('input').click(); } });
  zona.addEventListener('dragover', ev => { ev.preventDefault(); zona.classList.add('sopra'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('sopra'));
  zona.addEventListener('drop', ev => { ev.preventDefault(); zona.classList.remove('sopra'); if (ev.dataTransfer.files[0]) parti(ev.dataTransfer.files[0]); });
  const passo = h('div');
  const esportazioni = h('div.foglio', h('div.etichetta', t('moduli.im-esporta-tutto')), h('div.import-esporta', schema.filter(e => !e.nascosta).map(e => h('div', h('span', e.nome),
    h('a.btn.piccolo', { href: `/api/import/esporta/${e.id}?formato=xlsx`, testo: 'Excel' }), h('a.btn.piccolo.nudo', { href: `/api/import/esporta/${e.id}?formato=csv`, testo: 'CSV' })))));
  const backup = stato.utente.ruolo === 'titolare' ? h('div.foglio', h('div.etichetta', t('moduli.im-backup')),
    h('p.nota', t('moduli.im-backup-nota')),
    h('a.btn.pieno', { href: '/api/import/backup', testo: t('moduli.im-scarica-backup') })) : null;
  contenuto.replaceChildren(h('div.testa', h('h1', t('moduli.im-importa-esporta'))),
    h('div.corpo.import', h('div.foglio', h('div.import-dove', h('label.etichetta', t('moduli.im-dove')), h('div.import-riga', scelta, modello)), zona), passo, h('div.import-lato', esportazioni, backup)));

  async function parti(file) {
    const avanza = h('progress', { max: 1, value: 0 });
    passo.replaceChildren(h('div.foglio', h('b', { testo: file.name }), ' ', h('span.nota', peso(file.size)), avanza));
    try {
      const f = await carica(file, { max: 50, avanzamento: p => { avanza.value = p; } });
      const nuova = scelta.value === '__nuova', def = schema.find(e => e.id === scelta.value);
      const a = await k.api('POST', '/import/anteprima', { caricamento: f.id, entita: nuova ? undefined : def.id });
      abbina(f, a, nuova ? null : def, file.name);
    } catch (e) { passo.replaceChildren(h('div.avviso', e.message)); }
  }

  function abbina(f, a, def, nomeFile) {
    const campi = def ? def.campi.filter(c => !c.archiviato && !c.sola_lettura && !NON_IMPORTABILI.includes(c.tipo)) : [];
    const puoCreare = !!stato.poteri?.schema;
    // per ogni colonna: { campo } | { nuovo, tipo, nome } | null
    const scelte = a.intestazioni.map((col, i) => def ? (a.abbinamento[col] ? { campo: a.abbinamento[col] } : null) : { nuovo: true, tipo: a.tipi[i].tipo, nome: col });
    const nomeSezione = h('input.campo', { value: nomeFile.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()), placeholder: t('gestione.esempio-sezione') });
    const testa = a.intestazioni.map((col, i) => {
      if (!def) {
        const usa = h('input', { type: 'checkbox', checked: true, on: { change: () => { scelte[i] = usa.checked ? { nuovo: true, tipo: tipo.value, nome: nome.value } : null; } } });
        const nome = h('input.campo', { value: col, on: { input: () => { if (scelte[i]) scelte[i].nome = nome.value; } } });
        const tipo = h('select.campo', { on: { change: () => { if (scelte[i]) scelte[i].tipo = tipo.value; } } }, TIPI_NUOVI.map(([v, n]) => h('option', { value: v, testo: n, selected: v === a.tipi[i].tipo })));
        return h('th', h('label.import-usa', usa, h('span', { testo: col })), nome, tipo);
      }
      const sel = h('select.campo', { class: scelte[i] ? 'abbinata' : '', on: { change: () => {
        scelte[i] = sel.value === '' ? null : sel.value === '__nuovo' ? { nuovo: true, tipo: a.tipi[i].tipo, nome: col } : { campo: sel.value };
        sel.classList.toggle('abbinata', !!scelte[i]); } } },
        h('option', { value: '', testo: t('moduli.im-non-importare') }), campi.map(c => h('option', { value: c.id, testo: c.nome, selected: scelte[i]?.campo === c.id })),
        puoCreare ? h('option', { value: '__nuovo', testo: t('moduli.im-crea-campo', { nome: col, tipo: minuscole(nomeTipo(a.tipi[i].tipo)) }) }) : null);
      return h('th', h('div.import-colonna', { testo: col }), sel);
    });
    const anteprima = h('div.import-tabella', h('table.tabella', h('thead', h('tr', testa)),
      h('tbody', a.righe.map(r => h('tr', r.map(x => h('td', { testo: comeTesto(x) })))))));
    // doppioni: di solito sul campo «senza doppioni», altrimenti su uno a scelta
    const chiavi = campi.filter(c => ['testo', 'email', 'telefono', 'codice_a_barre', 'numero', 'url'].includes(c.tipo));
    const suggerita = chiavi.find(c => c.unico && a.abbinamento && Object.values(a.abbinamento).includes(c.id));
    const doppio = h('select.campo', h('option', { value: '', testo: t('moduli.im-non-controllare') }), chiavi.map(c => h('option', { value: c.id, testo: c.unico ? t('moduli.im-stesso-unico', { nome: c.nome }) : t('moduli.im-stesso', { nome: c.nome }), selected: c === suggerita })));
    const modo = h('select.campo', h('option', { value: 'aggiorna', testo: t('moduli.im-aggiorna') }), h('option', { value: 'salta', testo: t('moduli.im-salta') }));
    const avviso = h('div');
    const corpo = prova => {
      const abbinamento = Object.fromEntries(a.intestazioni.map((col, i) => [col, scelte[i] == null ? null : scelte[i].campo ?? { nuovo: true, tipo: scelte[i].tipo, nome: scelte[i].nome }]));
      return { caricamento: f.id, prova, abbinamento, ...(def ? { entita: def.id } : { nuova: { nome: nomeSezione.value } }), ...(def && doppio.value ? { doppioni: { campo: doppio.value, modo: modo.value } } : {}) };
    };
    const vai = async (prova, b) => {
      avviso.replaceChildren(); b.disabled = true; const testo = b.textContent; b.textContent = prova ? t('moduli.im-controllo') : t('moduli.im-importo');
      let fatto = false;
      try { const e = await k.api('POST', '/import/esegui', corpo(prova)); if (!prova && (!def || scelte.some(x => x?.nuovo))) await k.ricaricaSchema(); rapporto(e, a.intestazioni, prova); fatto = !prova; }
      catch (e) { avviso.replaceChildren(h('div.avviso', e.message, e.corpo?.dettagli ? h('ul', e.corpo.dettagli.map(d => h('li', { testo: d }))) : null)); }
      finally { b.textContent = fatto ? t('moduli.im-importato') : testo; b.disabled = fatto; if (fatto) bProva.disabled = true; }   // niente doppio clic che raddoppia
    };
    const bProva = h('button.btn', { type: 'button', testo: t('moduli.im-prova'), on: { click: () => vai(true, bProva) } });
    const bVai = h('button.btn.pieno', { type: 'button', testo: t('moduli.im-importa-n', { n: a.totale }), on: { click: () => vai(false, bVai) } });
    const esito = h('div');
    function rapporto(e, intestazioni, prova) {
      const righeErr = e.errori.slice(0, 20).map(x => h('tr', h('td.num', String(x.riga)), h('td', { testo: x.messaggio })));
      const scaricaErrori = () => {
        const q = v => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const csv = '﻿' + [[t('moduli.im-riga'), ...intestazioni, t('moduli.im-errore')], ...e.errori.map(x => [x.riga, ...x.valori, x.messaggio])].map(r => r.map(q).join(';')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); scarica(url, t('moduli.im-file-errori')); setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      esito.replaceChildren(h('div.foglio.import-esito', { class: e.erroriTotali ? 'con-errori' : '' },
        h('div.etichetta', prova ? t('moduli.im-prova-esito') : t('moduli.ag-fatto')),
        h('div.import-numeri', [['create', e.create], ['aggiornate', e.aggiornate], ['saltate', e.saltate], ['errori', e.erroriTotali]].map(([n, v]) => h('div', h('b', String(v)), h('span', t('moduli.im-esito-' + n, { n: v }))))),
        e.erroriTotali ? [h('table.righe', h('thead', h('tr', h('th', t('moduli.im-riga')), h('th', t('moduli.im-cosa-non-va')))), h('tbody', righeErr)),
          e.erroriTotali > 20 ? h('p.nota', t('moduli.im-e-altre', { n: e.erroriTotali - 20 })) : null,
          h('button.btn', { type: 'button', on: { click: scaricaErrori } }, t('moduli.im-scarica-errori')), h('p.nota', t('moduli.im-correggi'))] : null,
        !prova ? h('a.btn.pieno', { href: `#/e/${e.entita}`, testo: t('moduli.im-vai-a', { nome: e.nome }) }) : null));
      esito.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    passo.replaceChildren(h('div.foglio',
      h('div.import-titolo', h('b', t('moduli.im-righe-in', { n: a.totale, file: nomeFile })), h('span.nota', def ? t('moduli.im-abbina', { nome: def.nome }) : t('moduli.im-ogni-colonna'))),
      def ? null : h('div.import-dove', h('label.etichetta', t('moduli.im-nome-sezione')), nomeSezione),
      anteprima,
      def ? h('div.import-opzioni', h('label.etichetta', t('moduli.im-gia-presenti')), doppio, h('span.nota', t('moduli.im-se-trovo')), modo) : null,
      h('p.nota', t('moduli.im-formati')),
      avviso, h('div.import-bottoni', bProva, bVai)), esito);
  }
}

// ---------- API e integrazioni ----------
function esempio(c) {
  switch (c.tipo) {
    case 'numero': case 'durata': return 3; case 'valuta': return 19.9; case 'percentuale': return 22; case 'si_no': return true;
    case 'data': return '2026-12-31'; case 'data_ora': return '2026-12-31T14:30:00Z';
    case 'scelta': case 'stato': return c.opzioni?.[0]?.id ?? ''; case 'scelta_multipla': return (c.opzioni || []).slice(0, 2).map(o => o.id);
    case 'relazione': return c.molti ? ['<id>'] : '<id>'; case 'utente': return '<id persona>';
    case 'email': return 'nome@esempio.it'; case 'telefono': return '+39 333 1234567'; case 'url': return 'https://esempio.it';
    case 'file': case 'immagine': return [{ id: '<id del caricamento>' }];
    default: return c.nome;
  }
}
const formato = c => { const fra = (c.opzioni || []).map(o => o.id).join(', ');
  return ({ valuta: t('moduli.api-f-valuta'), data: t('moduli.api-f-data'), data_ora: 'ISO 8601', si_no: 'true / false', scelta: t('moduli.api-f-uno-fra', { fra }), stato: t('moduli.api-f-uno-fra', { fra }),
    scelta_multipla: t('moduli.api-f-multipla'), relazione: c.molti ? t('moduli.api-f-rel-molti', { entita: c.entita }) : t('moduli.api-f-rel', { entita: c.entita }),
    righe: t('moduli.api-f-righe', { entita: c.entita }), calcolato: t('moduli.api-f-lettura'), contatore: t('moduli.api-f-contatore'), file: t('moduli.api-f-file'), immagine: t('moduli.api-f-file') }[c.tipo] || c.tipo); };

async function paginaApi(contenuto, k) {
  const { h, api, get, toast, schema, stato } = k;
  const base = location.origin, titolare = stato.utente.ruolo === 'titolare';
  const codice = testo => { const p = h('pre.import-codice', { testo }); return h('div.import-copia', p, h('button.btn.piccolo.nudo', { type: 'button', testo: t('moduli.api-copia'), on: { click: async () => { try { await navigator.clipboard.writeText(testo); toast(t('moduli.api-copiato')); } catch { toast(t('moduli.api-copia-mano'), true); } } } })); };
  const quando = d => (d ? dataL(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  // token
  const tokenBox = h('div'), nuovoBox = h('div');
  async function disegnaToken() {
    const l = await get('/token');
    tokenBox.replaceChildren(l.length ? h('table.tabella', h('thead', h('tr', [t('gestione.nome'), t('moduli.api-inizia'), t('moduli.api-creato'), t('moduli.api-scade'), t('moduli.api-ultimo-uso'), ''].map(x => h('th', x)))),
      h('tbody', l.map(tk => h('tr', { class: tk.revocato ? 'import-spento' : '' }, h('td', { testo: tk.nome }), h('td.mono', `${tk.inizio}…`), h('td', quando(tk.creato)), h('td', tk.scade ? quando(tk.scade) : t('moduli.api-mai')), h('td', quando(tk.usato)),
        h('td', tk.revocato ? t('moduli.api-revocato') : h('button.btn.piccolo.pericolo', { type: 'button', testo: t('moduli.api-revoca'), on: { click: async () => { if (!confirm(t('moduli.api-revocare', { nome: tk.nome }))) return; await api('DELETE', `/token/${tk.id}`); disegnaToken(); } } }))))))
      : h('p.nota', t('moduli.api-nessun-token')));
  }
  const nomeT = h('input.campo', { placeholder: t('moduli.api-a-cosa') });
  const durata = h('select.campo', [['30', t('moduli.api-30')], ['90', t('moduli.api-90')], ['365', t('moduli.api-anno')], ['0', t('moduli.api-non-scade')]].map(([v, n]) => h('option', { value: v, testo: n, selected: v === '90' })));
  const creaT = h('button.btn.pieno', { type: 'button', testo: t('moduli.api-crea-token'), on: { click: async () => {
    try {
      const nuovo = await api('POST', '/token', { nome: nomeT.value, giorni: Number(durata.value) }); nomeT.value = '';
      nuovoBox.replaceChildren(h('div.import-nuovo', h('b', t('moduli.api-ecco')), codice(nuovo.token))); disegnaToken();
    } catch (e) { toast(e.message, true); }
  } } });

  // documentazione dallo schema
  const esempioDi = e => JSON.stringify(Object.fromEntries(e.campi.filter(c => !c.archiviato && !['calcolato', 'contatore', 'righe'].includes(c.tipo) && !c.sola_lettura).slice(0, 5).map(c => [c.id, esempio(c)])), null, 2);
  const doc = schema.filter(e => !e.nascosta).map(e => h('details.import-doc', h('summary', h('b', e.nome), h('span.mono.nota', ` /api/dati/${e.id}`)),
    h('table.righe', h('thead', h('tr', h('th', t('moduli.ag-campo')), h('th', 'id'), h('th', t('moduli.api-valore')))), h('tbody', e.campi.filter(c => !c.archiviato).map(c => h('tr', h('td', { testo: c.nome }), h('td.mono', c.id), h('td.nota', { testo: formato(c) + (c.obbligatorio ? ' · obbligatorio' : '') })))) ),
    h('div.etichetta', t('moduli.api-elenco')),
    codice(`curl -H "Authorization: Bearer $LUMI_TOKEN" "${base}/api/dati/${e.id}?q=&n=50&p=1"`),
    h('div.etichetta', t('moduli.api-una-riga')), codice(`curl -H "Authorization: Bearer $LUMI_TOKEN" ${base}/api/dati/${e.id}/<id>`),
    e.puo.crea ? [h('div.etichetta', t('viste.crea')), codice(`curl -X POST -H "Authorization: Bearer $LUMI_TOKEN" -H "Content-Type: application/json" \\\n  -d '${esempioDi(e).replace(/'/g, "'\\''")}' ${base}/api/dati/${e.id}`)] : null,
    e.puo.modifica ? [h('div.etichetta', t('moduli.api-modifica')), codice(`curl -X PATCH -H "Authorization: Bearer $LUMI_TOKEN" -H "Content-Type: application/json" \\\n  -d '{"${e.campi.find(c => !c.archiviato)?.id}": ${JSON.stringify(esempio(e.campi.find(c => !c.archiviato) || {}))}}' ${base}/api/dati/${e.id}/<id>`)] : null,
    e.puo.elimina ? [h('div.etichetta', t('viste.archivia')), codice(`curl -X DELETE -H "Authorization: Bearer $LUMI_TOKEN" ${base}/api/dati/${e.id}/<id>`)] : null,
    h('div.etichetta', t('moduli.api-esporta')), codice(`curl -H "Authorization: Bearer $LUMI_TOKEN" -o ${e.id}.xlsx "${base}/api/import/esporta/${e.id}?formato=xlsx"`)));

  // webhook
  const webBox = h('div');
  async function disegnaWebhook() {
    const l = await get('/webhook');
    webBox.replaceChildren(...l.map(w => {
      const registro = h('div');
      const segreto = h('code.mono', '••••••••');
      return h('div.foglio.import-webhook',
        h('div.import-titolo', h('b', { testo: w.nome }), h('span.mono.nota', { testo: w.url })),
        h('div.nota', `${w.entita === '*' ? t('moduli.api-tutte') : w.entita.map(id => schema.find(e => e.id === id)?.nome || id).join(', ')} · ${w.eventi.map(x => t('moduli.api-ev-' + x)).join(', ')}`,
          ' · ', t('moduli.api-consegnate', { n: w.consegne.ok || 0 }), w.consegne.fallita ? [' · ', t('moduli.api-fallite', { n: w.consegne.fallita })] : '', w.consegne.attesa ? [' · ', t('moduli.api-in-attesa', { n: w.consegne.attesa })] : ''),
        h('div.import-bottoni', h('span.nota', t('moduli.api-segreto')), segreto,
          h('button.btn.piccolo.nudo', { type: 'button', testo: t('moduli.api-mostra'), on: { click: ev => { segreto.textContent = w.segreto; ev.target.remove(); } } }),
          h('button.btn.piccolo', { type: 'button', testo: t('moduli.api-prova'), on: { click: async () => { await api('POST', `/webhook/${w.id}/prova`); toast(t('moduli.api-prova-partenza')); setTimeout(() => apriRegistro(), 800); } } }),
          h('button.btn.piccolo', { type: 'button', testo: t('moduli.api-registro'), on: { click: () => (registro.childNodes.length ? registro.replaceChildren() : apriRegistro()) } }),
          h('button.btn.piccolo.pericolo', { type: 'button', testo: t('viste.elimina'), on: { click: async () => { if (!confirm(t('moduli.api-elimina-webhook', { nome: w.nome }))) return; await api('DELETE', `/webhook/${w.id}`); disegnaWebhook(); } } })),
        registro);
      async function apriRegistro() {
        const c = await get(`/webhook/${w.id}/consegne`);
        registro.replaceChildren(c.length ? h('table.righe', h('thead', h('tr', ['#', t('moduli.api-evento'), t('moduli.api-stato'), t('moduli.api-tentativi'), t('moduli.api-risposta'), t('moduli.api-quando'), ''].map(x => h('th', x)))),
          h('tbody', c.slice(0, 30).map(x => h('tr', h('td.mono', String(x.id)), h('td.mono', { testo: x.evento }), h('td', h('span.import-stato', { class: x.stato, testo: ['ok', 'attesa', 'invio', 'fallita'].includes(x.stato) ? t('moduli.api-st-' + x.stato) : x.stato })),
            h('td', String(x.tentativi)), h('td.nota', { testo: `${x.codice ?? ''} ${x.risposta ?? ''}`.trim().slice(0, 80) }), h('td.nota', dataOraL(x.aggiornato || x.creato)),
            h('td', x.stato === 'fallita' ? h('button.btn.piccolo', { type: 'button', testo: t('moduli.api-riprova'), on: { click: async () => { await api('POST', `/webhook/consegne/${x.id}/riprova`); setTimeout(apriRegistro, 800); } } }) : null))))) : h('p.nota', t('moduli.api-nessuna-consegna')));
      }
    }), l.length ? null : h('p.nota', t('moduli.api-nessun-webhook')));
  }
  const wNome = h('input.campo', { placeholder: t('moduli.api-nome-wh') }), wUrl = h('input.campo', { type: 'url', placeholder: t('moduli.api-url-wh') });
  const wSez = schema.filter(e => !e.nascosta).map(e => h('label', h('input', { type: 'checkbox', value: e.id }), e.nome));
  const wEv = ['crea', 'modifica', 'elimina', 'ripristina'].map(v => [v, t('moduli.api-ev-' + v)]).map(([v, n]) => h('label', h('input', { type: 'checkbox', value: v, checked: v !== 'ripristina' }), n));
  const aggiungiW = h('button.btn.pieno', { type: 'button', testo: t('moduli.api-aggiungi-wh'), on: { click: async () => {
    const entita = wSez.map(l => l.firstChild).filter(x => x.checked).map(x => x.value), eventi = wEv.map(l => l.firstChild).filter(x => x.checked).map(x => x.value);
    try { await api('PUT', '/webhook/nuovo', { nome: wNome.value, url: wUrl.value, entita: entita.length ? entita : '*', eventi }); wNome.value = wUrl.value = ''; toast(t('moduli.api-wh-aggiunto')); disegnaWebhook(); }
    catch (e) { toast(e.message, true); }
  } } });
  const verifica = `// Node: verifica la firma di Lumi prima di fidarti del corpo
import { createHmac, timingSafeEqual } from 'node:crypto';
const atteso = 'sha256=' + createHmac('sha256', process.env.LUMI_SEGRETO)
  .update(req.headers['x-lumi-tempo'] + '.' + corpoGrezzo).digest('hex');
const arrivata = Buffer.from(req.headers['x-lumi-firma'] || '');
const buona = arrivata.length === atteso.length && timingSafeEqual(Buffer.from(atteso), arrivata);
// e scarta i messaggi con x-lumi-tempo vecchio di più di 5 minuti`;

  contenuto.replaceChildren(h('div.testa', h('h1', t('moduli.im-api'))),
    h('div.corpo.import-api',
      h('p.nota', t('moduli.api-intro')),
      h('h2', t('moduli.api-tuoi-token')), h('div.foglio', h('div.import-riga', nomeT, durata, creaT), nuovoBox, tokenBox),
      h('h2', t('moduli.api-documentazione')),
      h('div.foglio', h('p', t('moduli.api-doc-1'), h('code.mono', 'Authorization: Bearer <token>'), t('moduli.api-doc-2'), h('code.mono', '{ "errore": "…" }'), t('moduli.api-doc-3')),
        codice(`export LUMI_TOKEN=lumi_…\ncurl -H "Authorization: Bearer $LUMI_TOKEN" ${base}/api/schema`),
        h('p.nota', t('moduli.api-openapi-1'), h('a', { href: '/api/openapi.json', target: '_blank', testo: '/api/openapi.json' }), t('moduli.api-openapi-2')),
        h('p.nota', t('moduli.api-allegati')),
        doc),
      titolare ? [h('h2', 'Webhook'), h('p.nota', t('moduli.api-wh-intro')),
        h('div.foglio', h('div.import-riga', wNome, wUrl), h('div.etichetta', t('moduli.api-sezioni')), h('div.etichette-scelte', wSez), h('div.etichetta', t('moduli.api-quando-riga')), h('div.etichette-scelte', wEv), h('div', { stile: { marginTop: '12px' } }, aggiungiW)),
        webBox, h('details.import-doc', h('summary', t('moduli.api-firma')), codice(verifica))] : null));
  disegnaToken().catch(e => tokenBox.replaceChildren(h('div.avviso', e.message)));
  if (titolare) disegnaWebhook().catch(e => webBox.replaceChildren(h('div.avviso', e.message)));
}

export default {
  nome: 'import',
  avvio() { if (document.querySelector('link[data-modulo=import]')) return; const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/import.css' }); l.dataset.modulo = 'import'; document.head.append(l); },
  lato: k => [{ href: '#/importa', icona: 'documento', nome: t('moduli.im-importa-esporta'), sezione: t('moduli.im-dati') }, { href: '#/api', icona: 'ingranaggio', nome: t('moduli.im-api') }],
  rotte: { importa: (contenuto, k, a) => paginaImporta(contenuto, k, a), api: (contenuto, k) => paginaApi(contenuto, k) },
  azioniLista,
};
