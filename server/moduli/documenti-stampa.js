// I modelli di stampa: per ogni entità con righe, un documento A4 sobrio (intestazione con logo e dati dell'azienda,
// destinatario, dettagli, righe, riepilogo IVA, totali, note, pagamento, piè di pagina). Il modello è un dato che il
// titolare modifica: testi con segnaposto {{cliente.nome}}, blocchi {{#note}}…{{/note}} (si vede solo se c'è), {{^x}}…{{/x}}
// (solo se manca) e {{#linee}}…{{/linee}} (si ripete), più l'elenco delle colonne delle righe. Tutto il testo (modello e
// dati) viene sempre «escapato»: nel documento non entra mai HTML scritto da qualcuno.

const COLORE = /^#[0-9a-fA-F]{6}$/;
const LIMITE = 4000;

// «Vendite» → «Vendita», «Preventivi» → «Preventivo», «Ordini ai fornitori» → «Ordine ai fornitori»
export function singolare(nome) {
  const [p, ...resto] = String(nome || 'Documento').split(' ');
  const s = /^ordini$/i.test(p) ? p.slice(0, -1) + 'e' : /i$/i.test(p) ? p.slice(0, -1) + 'o' : /e$/i.test(p) ? p.slice(0, -1) + 'a' : p;
  return [s, ...resto].join(' ');
}

// il modello che si usa finché il titolare non lo cambia, ricavato dallo schema dell'entità
export function modelloPredefinito(def, schema) {
  const trova = id => schema.find(e => e.id === id);
  const campoRighe = def.campi.find(c => c.tipo === 'righe' && !c.archiviato && c.id !== 'rate');
  const figlia = campoRighe ? trova(campoRighe.entita) : null;
  const haF = (d, ...ids) => !!d && ids.some(id => d.campi.some(c => c.id === id && !c.archiviato));
  const dest = def.campi.find(c => c.tipo === 'relazione' && !c.molti && !c.archiviato && trova(c.entita) && c.entita !== campoRighe?.entita);
  const D = dest?.id;
  const fattura = def.id === 'fatture';
  const dettagli = fattura ? [{ etichetta: 'Numero', valore: '{{numero}}' }, { etichetta: 'Data', valore: '{{data}}' }, { etichetta: 'Scadenza', valore: '{{scadenza}}' }, { etichetta: 'Riferimento', valore: '{{riferimento}}' }]
    : def.campi.filter(c => !c.archiviato && ['contatore', 'data'].includes(c.tipo)).slice(0, 3).map(c => ({ etichetta: c.nome, valore: `{{${c.id}}}` }));
  const colonne = [{ etichetta: 'Descrizione', valore: '{{linea.descrizione}}' }, { etichetta: 'Q.tà', valore: '{{linea.quantita}}', allinea: 'destra' },
    { etichetta: 'Prezzo', valore: '{{linea.prezzo}}', allinea: 'destra' }];
  if (haF(figlia, 'sconto')) colonne.push({ etichetta: 'Sconto', valore: '{{linea.sconto}}', allinea: 'destra' });
  colonne.push({ etichetta: 'IVA', valore: '{{linea.iva}}', allinea: 'destra' }, { etichetta: 'Importo', valore: '{{linea.totale}}', allinea: 'destra' });
  return {
    titolo: fattura ? '{{tipo}} n. {{numero}}' : `${singolare(def.nome)} {{_titolo}}`,
    colore: '',
    destinatario: D ? [`{{${D}}}`, `{{#${D}.via}}{{${D}.via}}{{/${D}.via}}{{^${D}.via}}{{${D}.indirizzo}}{{/${D}.via}}`, `{{${D}.cap}} {{${D}.comune}} {{#${D}.provincia}}({{${D}.provincia}}){{/${D}.provincia}}`,
      `{{#${D}.piva}}P.IVA {{${D}.piva}}{{/${D}.piva}}`, `{{#${D}.codice_fiscale}}C.F. {{${D}.codice_fiscale}}{{/${D}.codice_fiscale}}`,
      ...(fattura ? [`{{#${D}.codice_destinatario}}Codice destinatario {{${D}.codice_destinatario}}{{/${D}.codice_destinatario}}`, `{{#${D}.pec}}PEC {{${D}.pec}}{{/${D}.pec}}`] : [])].join('\n') : '',
    etichettaDestinatario: dest ? (dest.entita === 'fornitori' ? 'Fornitore' : 'Spett.le') : '',
    dettagli, colonne, riepilogoIva: true,
    prezziIvati: !haF(figlia, 'aliquota', 'iva') && !haF(def, 'iva', 'aliquota') && !fattura,
    note: [haF(def, 'causale') ? '{{causale}}' : '', haF(def, 'note') ? '{{note}}' : '', haF(def, 'oggetto') ? '{{oggetto}}' : '',
      fattura ? '{{#forfettario}}Operazione in franchigia da IVA ai sensi dell\'art. 1, commi 54-89, L. 190/2014. Operazione senza applicazione della ritenuta alla fonte (art. 1, comma 67, L. 190/2014).{{/forfettario}}' : '',
      fattura ? '{{#bollo}}Imposta di bollo da 2,00 € assolta in modo virtuale.{{/bollo}}' : ''].filter(Boolean).join('\n'),
    pagamento: fattura ? '{{modalita}}{{#scadenza}} entro il {{scadenza}}{{/scadenza}}{{#azienda.iban}}\nIBAN {{azienda.iban}}{{#azienda.banca}} · {{azienda.banca}}{{/azienda.banca}}{{/azienda.iban}}'
      : haF(def, 'pagamento') ? '{{pagamento}}' : '',
    piede: '{{azienda.ragione_sociale}}{{#azienda.piva}} · P.IVA {{azienda.piva}}{{/azienda.piva}}{{#azienda.pec}} · PEC {{azienda.pec}}{{/azienda.pec}}',
  };
}

// il modello che arriva dall'editor: solo i campi conosciuti, testi corti, colore valido
export function pulisciModello(m = {}) {
  const t = (x, n = LIMITE) => String(x ?? '').slice(0, n);
  const voci = (l, n) => (Array.isArray(l) ? l : []).slice(0, n).map(x => ({ etichetta: t(x?.etichetta, 80), valore: t(x?.valore, 400), ...(x?.allinea === 'destra' ? { allinea: 'destra' } : {}) }));
  const colonne = voci(m.colonne, 10);
  if (!colonne.length) throw new Error('Serve almeno una colonna');
  return { titolo: t(m.titolo, 200), colore: COLORE.test(m.colore || '') ? m.colore : '', destinatario: t(m.destinatario), etichettaDestinatario: t(m.etichettaDestinatario, 40),
    dettagli: voci(m.dettagli, 8), colonne, riepilogoIva: m.riepilogoIva !== false, prezziIvati: !!m.prezziIvati, note: t(m.note), pagamento: t(m.pagamento), piede: t(m.piede, 600) };
}

// ---------- segnaposto ----------
function cerca(percorso, pila) {
  const [primo, ...resto] = percorso.split('.');
  for (let i = pila.length - 1; i >= 0; i--) {
    if (pila[i] && typeof pila[i] === 'object' && primo in pila[i]) { let v = pila[i][primo]; for (const k of resto) v = v != null && typeof v === 'object' ? v[k] : undefined; return v; }
  }
  return undefined;
}
const comeTesto = v => (v == null ? '' : Array.isArray(v) ? v.map(comeTesto).join(', ') : typeof v === 'object' ? comeTesto(v._) : String(v));
const vero = v => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? !!comeTesto(v._) || Object.keys(v).length > 1 : !!v && v !== '0');

// testo del modello + dati → testo semplice (non ancora escapato)
export function rendi(testo, pila) {
  const sezioni = String(testo ?? '').replace(/\{\{([#^])\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g, (_, tipo, nome, dentro) => {
    const v = cerca(nome, pila);
    if (tipo === '^') return vero(v) ? '' : rendi(dentro, pila);
    if (Array.isArray(v)) return v.map(x => rendi(dentro, [...pila, x])).join('');
    return vero(v) ? rendi(dentro, typeof v === 'object' ? [...pila, v] : pila) : '';
  });
  return sezioni.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => comeTesto(cerca(p, pila)));
}
export const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// testo con più righe: le righe vuote (segnaposto senza valore) si tolgono
const blocco = (testo, pila) => rendi(testo, pila).split('\n').map(r => r.replace(/\s+/g, ' ').trim()).filter(Boolean).map(escHtml).join('<br>');

// ---------- il documento ----------
const CSS = `@font-face { font-family: Geist; src: url(/font/Geist-Variable.woff2) format("woff2"); font-weight: 100 900; }
@page { size: A4; margin: 14mm 14mm 16mm; @bottom-right { content: counter(page) " / " counter(pages); font: 8pt Geist, Arial, sans-serif; color: #888; } }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #111; font: 9.5pt/1.45 Geist, "Helvetica Neue", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.foglio { max-width: 182mm; margin: 0 auto; padding: 8mm 0; }
@media print { .foglio { padding: 0; max-width: none; } }
.testa { display: flex; justify-content: space-between; gap: 10mm; align-items: flex-start; padding-bottom: 6mm; border-bottom: 1.5pt solid var(--c); }
.mittente { font-size: 8.5pt; color: #444; } .mittente b { display: block; font-size: 11pt; color: #111; margin-bottom: 1mm; }
.mittente img { display: block; max-height: 18mm; max-width: 60mm; margin-bottom: 3mm; }
.doc { text-align: right; } .doc h1 { margin: 0 0 3mm; font-size: 17pt; letter-spacing: -.02em; font-weight: 650; color: var(--c); }
.dettagli { margin-left: auto; border-collapse: collapse; font-size: 8.5pt; } .dettagli td { padding: .6mm 0 .6mm 4mm; } .dettagli td:first-child { color: #777; }
.parti { display: flex; justify-content: flex-end; margin: 7mm 0 6mm; }
.dest { min-width: 78mm; max-width: 95mm; padding: 3.5mm 4.5mm; border: .6pt solid #ddd; border-radius: 2mm; }
.dest small { display: block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: #888; margin-bottom: 1mm; }
table.righe { width: 100%; border-collapse: collapse; }
table.righe thead { display: table-header-group; }
table.righe th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em; color: #666; font-weight: 600; text-align: left; padding: 2mm 2mm; border-bottom: .8pt solid #111; }
table.righe td { padding: 2.2mm 2mm; border-bottom: .5pt solid #e3e3e3; vertical-align: top; }
table.righe tr { break-inside: avoid; } .dx { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fondo { display: flex; gap: 10mm; justify-content: space-between; margin-top: 6mm; break-inside: avoid; }
.sx { flex: 1; min-width: 0; font-size: 8.5pt; color: #333; } .sx h3 { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: #888; margin: 0 0 1.5mm; font-weight: 600; }
.sx section { margin-bottom: 5mm; }
.iva { border-collapse: collapse; font-size: 8pt; } .iva th, .iva td { padding: 1mm 4mm 1mm 0; text-align: right; } .iva th { color: #888; font-weight: 500; } .iva th:first-child, .iva td:first-child { text-align: left; }
.tot { width: 68mm; border-collapse: collapse; font-variant-numeric: tabular-nums; } .tot td { padding: 1.3mm 0; } .tot td:last-child { text-align: right; }
.tot .grande td { font-size: 12.5pt; font-weight: 650; border-top: 1pt solid #111; padding-top: 2.5mm; color: var(--c); }
.piede { margin-top: 10mm; padding-top: 3mm; border-top: .5pt solid #ddd; font-size: 7.5pt; color: #888; text-align: center; }`;

// ctx: { azienda (testi), logo (data URL o null), dati (la pila dei segnaposto), linee, riepilogo, totali }, tutto già formattato
export function documentoHtml(m, ctx) {
  const pila = [ctx.dati];
  const colore = COLORE.test(m.colore || '') ? m.colore : COLORE.test(ctx.azienda.colore || '') ? ctx.azienda.colore : '#111111';
  const az = ctx.azienda, titolo = rendi(m.titolo, pila).replace(/\s+/g, ' ').trim();
  const mittente = [az.via, [az.cap, az.comune, az.provincia ? `(${az.provincia})` : ''].filter(Boolean).join(' '),
    [az.piva ? `P.IVA ${az.piva}` : '', az.codice_fiscale && az.codice_fiscale !== az.piva ? `C.F. ${az.codice_fiscale}` : ''].filter(Boolean).join(' · '),
    [az.telefono, az.email].filter(Boolean).join(' · '), az.pec ? `PEC ${az.pec}` : ''].filter(Boolean).map(escHtml).join('<br>');
  const dettagli = m.dettagli.map(d => [d.etichetta, rendi(d.valore, pila).trim()]).filter(([, v]) => v);
  const destinatario = blocco(m.destinatario, pila);
  const righe = ctx.linee.map(l => `<tr>${m.colonne.map(c => `<td${c.allinea === 'destra' ? ' class="dx"' : ''}>${blocco(c.valore, [...pila, { linea: l, riga: l.riga }])}</td>`).join('')}</tr>`).join('');
  const T = ctx.totali, sez = (t, x) => (x ? `<section><h3>${escHtml(t)}</h3>${x}</section>` : '');
  const iva = m.riepilogoIva && ctx.riepilogo.length ? `<table class="iva"><tr><th>IVA</th><th>Imponibile</th><th>Imposta</th></tr>${ctx.riepilogo.map(g => `<tr><td>${escHtml(g.etichetta)}</td><td>${escHtml(g.imponibile)}</td><td>${escHtml(g.imposta)}</td></tr>`).join('')}</table>` : '';
  const tot = [['Imponibile', T.imponibile], ['IVA', T.imposta], T.ritenuta ? [`Ritenuta d'acconto`, `− ${T.ritenuta}`] : null].filter(Boolean)
    .map(([a, b]) => `<tr><td>${escHtml(a)}</td><td>${escHtml(b)}</td></tr>`).join('') +
    `<tr class="grande"><td>${T.ritenuta ? 'Netto a pagare' : 'Totale'}</td><td>${escHtml(T.ritenuta ? T.netto : T.totale)}</td></tr>`;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${escHtml(titolo)}</title><style>${CSS}</style></head>
<body style="--c:${colore}"><div class="foglio">
<header class="testa"><div class="mittente">${ctx.logo ? `<img src="${escHtml(ctx.logo)}" alt="">` : ''}<b>${escHtml(az.ragione_sociale)}</b>${mittente}</div>
<div class="doc"><h1>${escHtml(titolo)}</h1><table class="dettagli">${dettagli.map(([a, b]) => `<tr><td>${escHtml(a)}</td><td>${escHtml(b)}</td></tr>`).join('')}</table></div></header>
<div class="parti">${destinatario ? `<div class="dest">${m.etichettaDestinatario ? `<small>${escHtml(m.etichettaDestinatario)}</small>` : ''}${destinatario}</div>` : ''}</div>
<table class="righe"><thead><tr>${m.colonne.map(c => `<th${c.allinea === 'destra' ? ' class="dx"' : ''}>${escHtml(c.etichetta)}</th>`).join('')}</tr></thead><tbody>${righe}</tbody></table>
<div class="fondo"><div class="sx">${sez('Riepilogo IVA', iva)}${sez('Note', blocco(m.note, pila))}${sez('Pagamento', blocco(m.pagamento, pila))}</div>
<table class="tot">${tot}</table></div>
${m.piede ? `<footer class="piede">${blocco(m.piede, pila)}</footer>` : ''}
</div></body></html>`;
}
