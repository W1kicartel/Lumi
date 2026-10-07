// «Personalizza»: l'editor visuale dello schema. Aggiungi, rinomina, sposta, cambia tipo o archivia i campi di
// un'entità; crea entità nuove. Si salva tutto insieme; il server rifiuta le modifiche che perderebbero dati.
import { h, api, toast, ErroreApi, NOMI_ICONE, icona, COLORI } from './ui.js';

export const TIPI = [
  ['testo', 'Testo'], ['testo_lungo', 'Testo lungo'], ['numero', 'Numero'], ['valuta', 'Importo (€)'], ['percentuale', 'Percentuale'],
  ['data', 'Data'], ['data_ora', 'Data e ora'], ['si_no', 'Sì / No'], ['scelta', 'Scelta'], ['scelta_multipla', 'Scelta multipla'],
  ['stato', 'Stato (flusso)'], ['relazione', 'Collegamento'], ['righe', 'Righe (sotto-tabella)'], ['calcolato', 'Calcolato (formula)'],
  ['contatore', 'Numerazione'], ['email', 'Email'], ['telefono', 'Telefono'], ['url', 'Sito web'], ['indirizzo', 'Indirizzo'],
  ['codice_a_barre', 'Codice a barre'], ['durata', 'Durata (minuti)'], ['immagine', 'Immagine'], ['file', 'File'],
];
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 40) || 'campo';

export function personalizza(def, contenitore, { schema, ricaricaSchema }) {
  const nuova = !def;
  const lavoro = nuova ? { id: '', nome: '', icona: 'cartella', campi: [{ id: 'nome', nome: 'Nome', tipo: 'testo', obbligatorio: true }], titolo: 'nome' } : structuredClone(def);
  delete lavoro.puo; delete lavoro.archiviata;
  const avviso = h('div'), lista = h('div.campi-edit');
  const nome = h('input.campo', { value: lavoro.nome, placeholder: 'es. Noleggi', on: { input: () => { lavoro.nome = nome.value; if (nuova) lavoro.id = slug(nome.value); } } });
  const ic = h('select.campo', { on: { change: () => { lavoro.icona = ic.value; } } }, NOMI_ICONE.map(n => h('option', { value: n, testo: n, selected: n === lavoro.icona })));
  const titolo = () => h('select.campo', { on: { change: ev => { lavoro.titolo = ev.target.value; } } }, lavoro.campi.filter(c => !c.archiviato && ['testo', 'contatore', 'email', 'relazione'].includes(c.tipo)).map(c => h('option', { value: c.id, testo: c.nome, selected: c.id === lavoro.titolo })));
  let selTitolo = titolo();

  function riga(c, i) {
    const tipo = h('select.campo', { disabled: c.archiviato, on: { change: () => { c.tipo = tipo.value; disegna(); } } }, TIPI.map(([v, n]) => h('option', { value: v, testo: n, selected: v === c.tipo })));
    const nomeC = h('input.campo', { value: c.nome, disabled: c.archiviato, on: { input: () => { c.nome = nomeC.value; if (c.__nuovo) c.id = slug(nomeC.value); } } });
    const azioni = h('div', { stile: { display: 'flex', gap: '4px' } },
      h('button.btn.piccolo.nudo', { type: 'button', title: 'Su', testo: '↑', disabled: i === 0, on: { click: () => { [lavoro.campi[i - 1], lavoro.campi[i]] = [lavoro.campi[i], lavoro.campi[i - 1]]; disegna(); } } }),
      h('button.btn.piccolo.nudo', { type: 'button', title: 'Giù', testo: '↓', disabled: i === lavoro.campi.length - 1, on: { click: () => { [lavoro.campi[i + 1], lavoro.campi[i]] = [lavoro.campi[i], lavoro.campi[i + 1]]; disegna(); } } }),
      c.archiviato ? h('button.btn.piccolo', { type: 'button', testo: 'Ripristina', on: { click: () => { delete c.archiviato; disegna(); } } })
        : h('button.btn.piccolo.nudo.pericolo', { type: 'button', title: 'Archivia il campo (i valori restano)', testo: '×', on: { click: () => { if (c.__nuovo) lavoro.campi.splice(i, 1); else c.archiviato = true; disegna(); } } }));
    const dettagli = h('div.dettagli');
    const chk = (k, etichetta) => h('label', { stile: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } }, h('input', { type: 'checkbox', checked: !!c[k], on: { change: ev => { c[k] = ev.target.checked || undefined; } } }), etichetta);
    if (!c.archiviato) {
      if (!['calcolato', 'righe', 'contatore'].includes(c.tipo)) dettagli.append(chk('obbligatorio', 'Obbligatorio'));
      if (['testo', 'email', 'codice_a_barre', 'telefono'].includes(c.tipo)) dettagli.append(chk('unico', 'Senza doppioni'));
      if (['scelta', 'scelta_multipla', 'stato'].includes(c.tipo)) {
        c.opzioni ||= [{ id: 'a', nome: 'Prima opzione', colore: 'grigio' }];
        const testo = h('textarea.campo', { value: c.opzioni.map(o => o.nome + (o.colore && o.colore !== 'grigio' ? ` (${o.colore})` : '')).join('\n'), rows: 3,
          on: { input: () => { c.opzioni = testo.value.split('\n').map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^(.*?)\s*\((\w+)\)$/); const n = m ? m[1] : x; const vecchia = c.opzioni.find(o => o.nome === n); return { id: vecchia?.id || slug(n), nome: n, colore: m && COLORI.includes(m[2]) ? m[2] : vecchia?.colore || 'grigio' }; }); } } });
        dettagli.append(h('label', h('span.etichetta', `Opzioni, una per riga (colori: ${COLORI.join(', ')})`), testo));
      }
      if (['relazione', 'righe'].includes(c.tipo)) {
        const altre = schema.filter(e => e.id !== lavoro.id);
        dettagli.append(h('label', h('span.etichetta', c.tipo === 'righe' ? 'Righe di' : 'Collegato a'), h('select.campo', { on: { change: ev => { c.entita = ev.target.value; } } }, h('option', { value: '', testo: '—' }), altre.map(e => h('option', { value: e.id, testo: e.nome, selected: e.id === c.entita })))));
        if (c.tipo === 'relazione') dettagli.append(chk('molti', 'Più di uno'));
        if (c.tipo === 'righe') dettagli.append(h('label', h('span.etichetta', 'Campo che punta qui (nell\'altra entità)'), h('input.campo', { value: c.campo || '', on: { input: ev => { c.campo = ev.target.value; } } })));
      }
      if (c.tipo === 'calcolato') {
        dettagli.append(h('label', { stile: { gridColumn: '1 / -1' } }, h('span.etichetta', 'Formula (es. quantita * prezzo · SOMMA(righe.totale) · SE(giacenza <= soglia; "sì"; "no"))'),
          h('input.campo.mono', { value: c.formula || '', on: { input: ev => { c.formula = ev.target.value; } } })));
        dettagli.append(h('label', h('span.etichetta', 'Mostra come'), h('select.campo', { on: { change: ev => { c.formato = ev.target.value || undefined; } } }, [['', 'Automatico'], ['valuta', 'Importo'], ['percentuale', 'Percentuale'], ['numero', 'Numero'], ['si_no', 'Sì / No']].map(([v, n]) => h('option', { value: v, testo: n, selected: (c.formato || '') === v })))));
      }
      if (c.tipo === 'contatore') dettagli.append(h('label', h('span.etichetta', 'Formato ({AAAA} anno, {N:4} numero a 4 cifre)'), h('input.campo.mono', { value: c.formato || 'N-{AAAA}-{N:4}', on: { input: ev => { c.formato = ev.target.value; } } })));
      if (c.tipo === 'contatore' && !c.formato) c.formato = 'N-{AAAA}-{N:4}';
    }
    return h('div.campo-edit', { class: c.archiviato ? 'archiviato' : '' }, h('div.maniglia', '⋮⋮'), nomeC, tipo, azioni, dettagli.childNodes.length ? dettagli : null);
  }
  function disegna() { lista.replaceChildren(...lavoro.campi.map(riga)); const t = titolo(); selTitolo.replaceWith(t); selTitolo = t; }

  const salva = h('button.btn.pieno', { testo: nuova ? 'Crea' : 'Salva le modifiche', on: { click: async () => {
    avviso.replaceChildren();
    const corpo = structuredClone(lavoro); corpo.campi = corpo.campi.map(c => { const x = { ...c }; delete x.__nuovo; delete x.sola_lettura; return x; });
    if (!corpo.nome) { avviso.replaceChildren(h('div.avviso', 'Dai un nome')); return; }
    try { await api('PUT', `/schema/${corpo.id}`, corpo); toast('Salvato'); await ricaricaSchema(); location.hash = `#/e/${corpo.id}`; }
    catch (e) { avviso.replaceChildren(h('div.avviso', e.message, e instanceof ErroreApi && e.corpo.dettagli ? h('ul', e.corpo.dettagli.map(d => h('li', d))) : null)); }
  } } });
  const aggiungi = h('button.btn', { testo: '+ Campo', on: { click: () => { lavoro.campi.push({ id: 'nuovo_' + (lavoro.campi.length + 1), nome: '', tipo: 'testo', __nuovo: true }); disegna(); lista.lastChild.querySelector('input').focus(); } } });
  contenitore.replaceChildren(
    h('div.testa', def ? h('a.btn.nudo', { href: `#/e/${def.id}`, testo: '←' }) : null, h('h1', nuova ? 'Nuova sezione' : `Personalizza · ${def.nome}`), salva),
    h('div.corpo', avviso,
      h('div.foglio', { stile: { marginBottom: '16px' } }, h('div.griglia', h('label', h('span.etichetta', 'Nome'), nome), h('label', h('span.etichetta', 'Icona'), ic), h('label', h('span.etichetta', 'Nome di ogni elemento'), selTitolo))),
      h('p.nota', 'Rinominare e spostare non tocca i dati. Un campo tolto viene archiviato con i suoi valori e si può ripristinare. Se un cambio di tipo perderebbe dei valori, il salvataggio si ferma e ti dice quali.'),
      lista, h('div', { stile: { marginTop: '12px' } }, aggiungi)));
  disegna();
}
