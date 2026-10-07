// Import ed export, backup, API e integrazioni (lato interfaccia; il server è in server/moduli/import*.js).
//   #/importa[/<entità>]  carica un .xlsx o .csv → anteprima → abbinamento colonne ↔ campi → doppioni → rapporto
//   #/api                 token personali, documentazione generata dallo schema, webhook (solo il titolare)
// Nella testa di ogni lista: «Importa» ed «Esporta» (Excel o CSV, con i filtri della lista in quel momento).
import { carica, peso } from '/campi.js';
import { t, numero, simbolo } from '/lingua.js';

const NON_IMPORTABILI = ['calcolato', 'contatore', 'righe', 'file', 'immagine'];
// i nomi dei tipi sono quelli di Personalizza (gestione.tipo-<tipo>), nella lingua di chi importa
const TIPI_NUOVI = ['testo', 'testo_lungo', 'numero', 'valuta', 'percentuale', 'data', 'data_ora', 'si_no', 'scelta', 'scelta_multipla', 'email', 'telefono', 'url', 'indirizzo', 'codice_a_barre']
  .map(k => [k, t('gestione.tipo-' + k, { simbolo: simbolo() })]);
const nomeTipo = t => TIPI_NUOVI.find(x => x[0] === t)?.[1] || t;
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
  const modello = h('a.btn.piccolo.nudo', { href: '#', on: { click: ev => { ev.preventDefault(); if (scelta.value !== '__nuova') scarica(`/api/import/esporta/${scelta.value}?formato=xlsx&vuoto=1`); } } }, 'Scarica il modello da compilare');
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
        puoCreare ? h('option', { value: '__nuovo', testo: t('moduli.im-crea-campo', { nome: col, tipo: nomeTipo(a.tipi[i].tipo).toLowerCase() }) }) : null);
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
      const abbinamento = Object.fromEntries(a.intestazioni.map((t, i) => [t, scelte[i] == null ? null : scelte[i].campo ?? { nuovo: true, tipo: scelte[i].tipo, nome: scelte[i].nome }]));
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
const formato = c => ({ valuta: 'euro, numero (19.9)', data: 'AAAA-MM-GG', data_ora: 'ISO 8601', si_no: 'true / false', scelta: `uno fra: ${(c.opzioni || []).map(o => o.id).join(', ')}`,
  stato: `uno fra: ${(c.opzioni || []).map(o => o.id).join(', ')}`, scelta_multipla: 'lista di id delle opzioni', relazione: c.molti ? `lista di id di ${c.entita}` : `id di ${c.entita} (in lettura { id, titolo })`,
  righe: `lista di righe di ${c.entita}`, calcolato: 'solo lettura', contatore: 'solo lettura, automatico', file: 'lista [{ id, nome }] dei caricamenti', immagine: 'lista [{ id, nome }] dei caricamenti' }[c.tipo] || c.tipo);

async function paginaApi(contenuto, k) {
  const { h, api, get, toast, schema, stato } = k;
  const base = location.origin, titolare = stato.utente.ruolo === 'titolare';
  const codice = t => { const p = h('pre.import-codice', { testo: t }); return h('div.import-copia', p, h('button.btn.piccolo.nudo', { type: 'button', testo: 'Copia', on: { click: async () => { try { await navigator.clipboard.writeText(t); toast('Copiato'); } catch { toast('Seleziona e copia a mano', true); } } } })); };
  const quando = d => (d ? new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  // token
  const tokenBox = h('div'), nuovoBox = h('div');
  async function disegnaToken() {
    const l = await get('/token');
    tokenBox.replaceChildren(l.length ? h('table.tabella', h('thead', h('tr', ['Nome', 'Inizia con', 'Creato', 'Scade', 'Ultimo uso', ''].map(x => h('th', x)))),
      h('tbody', l.map(t => h('tr', { class: t.revocato ? 'import-spento' : '' }, h('td', { testo: t.nome }), h('td.mono', `${t.inizio}…`), h('td', quando(t.creato)), h('td', t.scade ? quando(t.scade) : 'mai'), h('td', quando(t.usato)),
        h('td', t.revocato ? 'revocato' : h('button.btn.piccolo.pericolo', { type: 'button', testo: 'Revoca', on: { click: async () => { if (!confirm(`Revocare «${t.nome}»? Chi lo usa non entra più.`)) return; await api('DELETE', `/token/${t.id}`); disegnaToken(); } } }))))))
      : h('p.nota', 'Nessun token, per ora.'));
  }
  const nomeT = h('input.campo', { placeholder: 'A cosa serve (es. Sito, Contabilità)' });
  const durata = h('select.campo', [['30', '30 giorni'], ['90', '90 giorni'], ['365', 'un anno'], ['0', 'non scade']].map(([v, n]) => h('option', { value: v, testo: n, selected: v === '90' })));
  const creaT = h('button.btn.pieno', { type: 'button', testo: 'Crea il token', on: { click: async () => {
    try {
      const t = await api('POST', '/token', { nome: nomeT.value, giorni: Number(durata.value) }); nomeT.value = '';
      nuovoBox.replaceChildren(h('div.import-nuovo', h('b', 'Ecco il token. Copialo adesso: non si vedrà più.'), codice(t.token))); disegnaToken();
    } catch (e) { toast(e.message, true); }
  } } });

  // documentazione dallo schema
  const esempioDi = e => JSON.stringify(Object.fromEntries(e.campi.filter(c => !c.archiviato && !['calcolato', 'contatore', 'righe'].includes(c.tipo) && !c.sola_lettura).slice(0, 5).map(c => [c.id, esempio(c)])), null, 2);
  const doc = schema.filter(e => !e.nascosta).map(e => h('details.import-doc', h('summary', h('b', e.nome), h('span.mono.nota', ` /api/dati/${e.id}`)),
    h('table.righe', h('thead', h('tr', h('th', 'Campo'), h('th', 'id'), h('th', 'Valore'))), h('tbody', e.campi.filter(c => !c.archiviato).map(c => h('tr', h('td', { testo: c.nome }), h('td.mono', c.id), h('td.nota', { testo: formato(c) + (c.obbligatorio ? ' · obbligatorio' : '') })))) ),
    h('div.etichetta', 'Elenco (q = cerca, f = filtri JSON, o = ordina campo:desc, p = pagina, n = per pagina fino a 500)'),
    codice(`curl -H "Authorization: Bearer $KUBO_TOKEN" "${base}/api/dati/${e.id}?q=&n=50&p=1"`),
    h('div.etichetta', 'Una riga'), codice(`curl -H "Authorization: Bearer $KUBO_TOKEN" ${base}/api/dati/${e.id}/<id>`),
    e.puo.crea ? [h('div.etichetta', 'Crea'), codice(`curl -X POST -H "Authorization: Bearer $KUBO_TOKEN" -H "Content-Type: application/json" \\\n  -d '${esempioDi(e).replace(/'/g, "'\\''")}' ${base}/api/dati/${e.id}`)] : null,
    e.puo.modifica ? [h('div.etichetta', 'Modifica (solo i campi che mandi)'), codice(`curl -X PATCH -H "Authorization: Bearer $KUBO_TOKEN" -H "Content-Type: application/json" \\\n  -d '{"${e.campi.find(c => !c.archiviato)?.id}": ${JSON.stringify(esempio(e.campi.find(c => !c.archiviato) || {}))}}' ${base}/api/dati/${e.id}/<id>`)] : null,
    e.puo.elimina ? [h('div.etichetta', 'Archivia'), codice(`curl -X DELETE -H "Authorization: Bearer $KUBO_TOKEN" ${base}/api/dati/${e.id}/<id>`)] : null,
    h('div.etichetta', 'Esporta in Excel'), codice(`curl -H "Authorization: Bearer $KUBO_TOKEN" -o ${e.id}.xlsx "${base}/api/import/esporta/${e.id}?formato=xlsx"`)));

  // webhook
  const webBox = h('div');
  async function disegnaWebhook() {
    const l = await get('/webhook');
    webBox.replaceChildren(...l.map(w => {
      const registro = h('div');
      const segreto = h('code.mono', '••••••••');
      return h('div.foglio.import-webhook',
        h('div.import-titolo', h('b', { testo: w.nome }), h('span.mono.nota', { testo: w.url })),
        h('div.nota', `${w.entita === '*' ? 'Tutte le sezioni' : w.entita.map(id => schema.find(e => e.id === id)?.nome || id).join(', ')} · ${w.eventi.map(x => ({ crea: 'creato', modifica: 'modificato', elimina: 'archiviato', ripristina: 'ripristinato' }[x])).join(', ')}`,
          ` · consegnate ${w.consegne.ok || 0}`, w.consegne.fallita ? ` · fallite ${w.consegne.fallita}` : '', w.consegne.attesa ? ` · in attesa ${w.consegne.attesa}` : ''),
        h('div.import-bottoni', h('span.nota', 'Segreto: '), segreto,
          h('button.btn.piccolo.nudo', { type: 'button', testo: 'Mostra', on: { click: ev => { segreto.textContent = w.segreto; ev.target.remove(); } } }),
          h('button.btn.piccolo', { type: 'button', testo: 'Manda una prova', on: { click: async () => { await api('POST', `/webhook/${w.id}/prova`); toast('Prova in partenza'); setTimeout(() => apriRegistro(), 800); } } }),
          h('button.btn.piccolo', { type: 'button', testo: 'Registro', on: { click: () => (registro.childNodes.length ? registro.replaceChildren() : apriRegistro()) } }),
          h('button.btn.piccolo.pericolo', { type: 'button', testo: 'Elimina', on: { click: async () => { if (!confirm(`Eliminare il webhook «${w.nome}»?`)) return; await api('DELETE', `/webhook/${w.id}`); disegnaWebhook(); } } })),
        registro);
      async function apriRegistro() {
        const c = await get(`/webhook/${w.id}/consegne`);
        registro.replaceChildren(c.length ? h('table.righe', h('thead', h('tr', ['#', 'Evento', 'Stato', 'Tentativi', 'Risposta', 'Quando', ''].map(x => h('th', x)))),
          h('tbody', c.slice(0, 30).map(x => h('tr', h('td.mono', String(x.id)), h('td.mono', { testo: x.evento }), h('td', h('span.import-stato', { class: x.stato, testo: { ok: 'consegnata', attesa: 'in attesa', invio: 'in invio', fallita: 'fallita' }[x.stato] || x.stato })),
            h('td', String(x.tentativi)), h('td.nota', { testo: `${x.codice ?? ''} ${x.risposta ?? ''}`.trim().slice(0, 80) }), h('td.nota', new Date(x.aggiornato || x.creato).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })),
            h('td', x.stato === 'fallita' ? h('button.btn.piccolo', { type: 'button', testo: 'Riprova', on: { click: async () => { await api('POST', `/webhook/consegne/${x.id}/riprova`); setTimeout(apriRegistro, 800); } } }) : null))))) : h('p.nota', 'Ancora nessuna consegna.'));
      }
    }), l.length ? null : h('p.nota', 'Nessun webhook, per ora.'));
  }
  const wNome = h('input.campo', { placeholder: 'Nome (es. Contabilità)' }), wUrl = h('input.campo', { type: 'url', placeholder: 'https://… l\'indirizzo che riceve' });
  const wSez = schema.filter(e => !e.nascosta).map(e => h('label', h('input', { type: 'checkbox', value: e.id }), e.nome));
  const wEv = [['crea', 'creato'], ['modifica', 'modificato'], ['elimina', 'archiviato'], ['ripristina', 'ripristinato']].map(([v, n]) => h('label', h('input', { type: 'checkbox', value: v, checked: v !== 'ripristina' }), n));
  const aggiungiW = h('button.btn.pieno', { type: 'button', testo: 'Aggiungi il webhook', on: { click: async () => {
    const entita = wSez.map(l => l.firstChild).filter(x => x.checked).map(x => x.value), eventi = wEv.map(l => l.firstChild).filter(x => x.checked).map(x => x.value);
    try { await api('PUT', '/webhook/nuovo', { nome: wNome.value, url: wUrl.value, entita: entita.length ? entita : '*', eventi }); wNome.value = wUrl.value = ''; toast('Webhook aggiunto'); disegnaWebhook(); }
    catch (e) { toast(e.message, true); }
  } } });
  const verifica = `// Node: verifica la firma di Kubo prima di fidarti del corpo
import { createHmac, timingSafeEqual } from 'node:crypto';
const atteso = 'sha256=' + createHmac('sha256', process.env.KUBO_SEGRETO)
  .update(req.headers['x-kubo-tempo'] + '.' + corpoGrezzo).digest('hex');
const arrivata = Buffer.from(req.headers['x-kubo-firma'] || '');
const buona = arrivata.length === atteso.length && timingSafeEqual(Buffer.from(atteso), arrivata);
// e scarta i messaggi con x-kubo-tempo vecchio di più di 5 minuti`;

  contenuto.replaceChildren(h('div.testa', h('h1', t('moduli.im-api'))),
    h('div.corpo.import-api',
      h('p.nota', 'Collega Kubo al sito, alla contabilità o a un\'automazione. Ogni chiamata ha gli stessi permessi del tuo ruolo.'),
      h('h2', 'I tuoi token'), h('div.foglio', h('div.import-riga', nomeT, durata, creaT), nuovoBox, tokenBox),
      h('h2', 'Documentazione'),
      h('div.foglio', h('p', 'Ogni richiesta porta l\'intestazione ', h('code.mono', 'Authorization: Bearer <token>'), '. Le risposte sono JSON; gli errori hanno ', h('code.mono', '{ "errore": "…" }'), ' e il codice HTTP giusto (401, 403, 404, 422).'),
        codice(`export KUBO_TOKEN=kubo_…\ncurl -H "Authorization: Bearer $KUBO_TOKEN" ${base}/api/schema`),
        h('p.nota', 'La descrizione OpenAPI 3 (per Postman, Swagger o per generare un client) è in ', h('a', { href: '/api/openapi.json', target: '_blank', testo: '/api/openapi.json' }), ', con le sole sezioni che il token può vedere.'),
        h('p.nota', 'Gli allegati si caricano prima a pezzi (POST /api/file/carica, poi /api/file/carica/<id> con { da, pezzo in base64 }) e poi si mettono nel campo come [{ "id": "<id>" }].'),
        doc),
      titolare ? [h('h2', 'Webhook'), h('p.nota', 'Quando qualcosa cambia, Kubo manda un POST JSON firmato all\'indirizzo che scegli. Se non risponde, riprova dopo 30 secondi, 2, 10 e 30 minuti e 2 ore.'),
        h('div.foglio', h('div.import-riga', wNome, wUrl), h('div.etichetta', 'Sezioni (nessuna = tutte)'), h('div.etichette-scelte', wSez), h('div.etichetta', 'Quando una riga è'), h('div.etichette-scelte', wEv), h('div', { stile: { marginTop: '12px' } }, aggiungiW)),
        webBox, h('details.import-doc', h('summary', 'Come verificare la firma'), codice(verifica))] : null));
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
