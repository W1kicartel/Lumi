// Fatture complete: il ciclo passivo e i conti che servono dopo l'emissione. Rotte:
//   POST /api/fatture/ricevute { nome, dati (base64) }   importa un file .xml o .xml.p7m ricevuto (dal cassetto fiscale o
//                                                         dallo SDI): crea o abbina il fornitore, registra il costo e la scadenza
//   GET  /api/fatture/ricevute/:id/vista                  la fattura ricevuta in HTML leggibile (si mostra in un iframe sandbox)
//   POST /api/fatture/integrazione/:id { tipo? }          dalla fattura ricevuta in reverse charge o dall'estero, l'integrazione
//                                                         o autofattura TD16-TD19 (in bozza, serie «AF»)
//   GET  /api/fatture/bollo?anno=2026                     il bollo virtuale per trimestre: fatture, importo, scadenza, codice tributo
//   GET  /api/fatture/numerazione?anno=2026               i numeri che mancano nelle serie dell'anno
//   POST /api/fatture/aggiorna                            porta un gestionale già installato al modello fatture di oggi
// Il file XML ricevuto resta in _fatture_xml (id della fattura ricevuta → testo), così la vista è quella del documento vero.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estraiP7m } from './fatture-p7m.js';
import { testoXml, leggiFattura, vistaHtml } from './fatture-passive.js';
import { bolloTrimestri, buchiNumerazione } from './fatture-regole.js';
import { tipoIntegrazione, PAESI_UE, AUTOFATTURE } from './fatture-codici.js';
import { azienda } from './documenti.js';

const RICEVUTE = 'fatture_ricevute', FATTURE = 'fatture';
const MODELLO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'modelli', 'fatture.json');
const pulito = s => String(s ?? '').replace(/[\s.-]/g, '').toUpperCase();

export default function registra({ r, prima, db, S, D, P, meta, serve, ErroreHttp }) {
  db.exec('CREATE TABLE IF NOT EXISTS _fatture_xml (id TEXT PRIMARY KEY, nome TEXT, xml TEXT NOT NULL, indice INTEGER NOT NULL DEFAULT 0)');
  const c422 = e => { throw new ErroreHttp(422, e.message); };
  const sezione = id => { const d = S.leggi(db, id); if (!d || d.archiviata) throw new ErroreHttp(409, 'Aggiungi prima il modello «Fatture e fattura elettronica» (Personalizza → modelli).'); return d; };

  r('POST', '/api/fatture/ricevute', ({ ctx, corpo }) => {
    serve(ctx); sezione(RICEVUTE); P.verifica(ctx, RICEVUTE, 'crea');
    try { return importa(db, { S, D, meta }, corpo?.nome, Buffer.from(String(corpo?.dati || ''), 'base64'), ctx); } catch (e) { if (e instanceof ErroreHttp || e.name === 'ErrorePermesso') throw e; c422(e); }
  });
  r('GET', '/api/fatture/ricevute/:id/vista', ({ ctx, p, q }) => {
    serve(ctx); D.leggi(db, RICEVUTE, p.id, ctx, { conRighe: false });   // con i permessi di chi guarda
    const x = db.prepare('SELECT xml, indice FROM _fatture_xml WHERE id = ?').get(p.id);
    if (!x) throw new ErroreHttp(404, 'Questa fattura ricevuta non ha il file XML');
    return { html: vistaHtml(x.xml, x.indice, { lingua: q.get('lingua') || 'it', etichette: ETICHETTE[q.get('lingua')] || ETICHETTE.it }) };
  });
  r('POST', '/api/fatture/integrazione/:id', ({ ctx, p, corpo }) => { serve(ctx); sezione(FATTURE); return integrazione(db, { S, D, P, ErroreHttp }, p.id, corpo || {}, ctx); });
  r('GET', '/api/fatture/bollo', ({ ctx, q }) => bolloAnno(db, { D, P }, Number(q.get('anno')) || new Date().getFullYear(), serve(ctx)));
  r('GET', '/api/fatture/numerazione', ({ ctx, q }) => {
    serve(ctx); P.verifica(ctx, FATTURE, 'leggi'); const anno = String(Number(q.get('anno')) || new Date().getFullYear());
    return { anno, serie: buchiNumerazione(emesse(db, D, ctx).filter(f => String(f.data || '').startsWith(anno))) };
  });
  // quando l'interfaccia prepara i documenti per chi personalizza, il modello fatture si aggiorna da solo
  prima('POST', '/api/documenti/prepara', ({ ctx }) => { if (ctx && P.puoSchema(ctx)) aggiornaModello(db, S, { utente: ctx.utente.id }); });
  r('POST', '/api/fatture/aggiorna', ({ ctx }) => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso('Solo chi può personalizzare il gestionale cambia questi dati'); return aggiornaModello(db, S, { utente: ctx.utente.id }); });
}

// le fatture emesse visibili all'utente (con i suoi permessi), senza le righe
const emesse = (db, D, ctx) => D.elenca(db, FATTURE, { filtri: [{ campo: 'stato', op: '!=', valore: 'bozza' }], perPagina: 100000, limite: 100000 }, ctx).righe;

// il bollo virtuale dell'anno per trimestre: lo usa anche la parte fiscale (liquidazioni, F24)
export function bolloAnno(db, { D, P }, anno, ctx) {
  P.verifica(ctx, FATTURE, 'leggi');
  const trimestri = bolloTrimestri(emesse(db, D, ctx), anno);
  return { anno, trimestri, totale: trimestri.reduce((s, t) => s + t.importo, 0) };
}

// ---------- import delle fatture ricevute ----------
export function importa(db, { S, D, meta }, nome, dati, ctx) {
  if (!dati?.length) throw new Error('Il file è vuoto');
  const p7m = /\.p7m$/i.test(String(nome || '')) || dati[0] === 0x30;
  const xml = testoXml(p7m ? estraiP7m(dati) : dati), letta = leggiFattura(xml), az = azienda(db, meta);
  // la fattura deve essere intestata a te: se la partita IVA del cliente non è la tua, la si importa lo stesso ma si avvisa
  const avvisi = [];
  const nostra = pulito(az.piva).replace(/^IT/, '');
  if (nostra && letta.cliente.piva && pulito(letta.cliente.piva) !== nostra && pulito(letta.cliente.codice_fiscale) !== pulito(az.codice_fiscale)) avvisi.push('intestata-ad-altri');
  const fornitore = fornitoreDi(db, { S, D }, letta.fornitore, ctx);
  const ric = S.leggi(db, RICEVUTE), haCampo = k => ric.campi.some(c => c.id === k && !c.archiviato);
  const importate = [], saltate = [];
  letta.fatture.forEach((f, i) => {
    const gia = db.prepare(`SELECT id FROM d_${RICEVUTE} WHERE archiviato = 0 AND c_fornitore = ? AND c_numero = ? AND c_data = ?`).get(fornitore.id, f.numero, f.data);
    if (gia) { saltate.push({ id: gia.id, numero: f.numero }); return; }
    const valori = { fornitore: fornitore.id, tipo: f.tipo, numero: f.numero, data: f.data, imponibile: f.imponibile, imposta: f.imposta, totale: f.totale, ritenuta: f.ritenuta,
      netto: f.netto, scadenza: f.scadenza, modalita: f.modalita, iban: f.iban, inversione: f.inversione, file: String(nome || '').slice(0, 200), note: f.causale.slice(0, 2000),
      nome_documento: `${f.numero} · ${letta.fornitore.nome}`.slice(0, 200) };
    for (const k of Object.keys(valori)) if (!haCampo(k) || valori[k] == null || valori[k] === '') delete valori[k];
    const riga = D.crea(db, RICEVUTE, valori, ctx);
    db.prepare('INSERT OR REPLACE INTO _fatture_xml (id, nome, xml, indice) VALUES (?, ?, ?, ?)').run(riga.id, String(nome || ''), xml, i);
    importate.push({ id: riga.id, numero: f.numero, data: f.data, totale: f.totale, inversione: f.inversione });
  });
  return { fornitore: { id: fornitore.id, nome: letta.fornitore.nome, nuovo: fornitore.nuovo }, importate, saltate, avvisi };
}

// il fornitore: si cerca per partita IVA, poi per codice fiscale; se non c'è si crea con i dati della fattura
function fornitoreDi(db, { S, D }, f, ctx) {
  const def = S.leggi(db, 'fornitori'); if (!def || def.archiviata) throw new Error('Manca la sezione «Fornitori»');
  const col = k => (def.campi.some(c => c.id === k && !c.archiviato) ? `c_${k}` : null);
  const cerca = (k, v) => col(k) && v && db.prepare(`SELECT id FROM d_fornitori WHERE archiviato = 0 AND UPPER(REPLACE(REPLACE(${col(k)}, ' ', ''), '.', '')) IN (?, ?)`).get(pulito(v), pulito(`${f.paese}${v}`));
  const trovato = cerca('piva', f.piva) || cerca('codice_fiscale', f.codice_fiscale);
  if (trovato) return { id: trovato.id, nuovo: false };
  const valori = { nome: f.nome || f.piva || '?', piva: f.paese !== 'IT' && f.piva ? `${f.paese}${f.piva}` : f.piva, codice_fiscale: f.codice_fiscale, via: f.via, cap: f.cap,
    comune: f.comune, provincia: f.provincia, nazione: f.nazione, email: f.email, telefono: f.telefono };
  for (const k of Object.keys(valori)) if (!col(k) || !valori[k]) delete valori[k];
  // i fornitori di altri modelli (negozio, officina…) hanno «piva» senza validatore: il valore resta com'è
  return { id: D.crea(db, 'fornitori', valori, ctx).id, nuovo: true };
}

// ---------- integrazioni e autofatture (TD16-TD19) ----------
export function integrazione(db, { S, D, P, ErroreHttp }, id, { tipo = null, aliquota = 22, beni = false } = {}, ctx) {
  P.verifica(ctx, FATTURE, 'crea');
  const ric = D.leggi(db, RICEVUTE, id, ctx, { conRighe: false });
  if (ric.integrata?.id) throw new ErroreHttp(409, 'Questa fattura ricevuta ha già la sua integrazione');
  const forn = ric.fornitore?.id ? D.leggi(db, 'fornitori', ric.fornitore.id, ctx, { conRighe: false }) : {};
  const x = db.prepare('SELECT xml, indice FROM _fatture_xml WHERE id = ?').get(id), letta = x ? leggiFattura(x.xml).fatture[x.indice] : null;
  const nazione = String(forn.nazione || 'IT').toUpperCase().slice(0, 2);
  const t = AUTOFATTURE.includes(tipo) ? tipo : tipoIntegrazione({ nazione, beni: !!beni, ue: PAESI_UE.includes(nazione) });
  // le righe: una per natura/aliquota della fattura ricevuta senza IVA (reverse charge, estero), con l'IVA italiana
  const gruppi = letta ? letta.riepilogo.filter(g => !g.imposta) : [{ imponibile: Number(ric.imponibile) || 0, natura: null }];
  const righe = (gruppi.length ? gruppi : [{ imponibile: Number(ric.imponibile) || 0 }]).map(g => ({
    descrizione: `Integrazione della fattura ${ric.numero} del ${String(ric.data).split('-').reverse().join('/')}${g.natura ? ` (${g.natura})` : ''}`, quantita: 1, prezzo: g.imponibile, aliquota: Number(aliquota) }));
  const fdef = S.leggi(db, FATTURE);
  const valori = { tipo: t, serie: 'AF', fornitore: forn.id, ricevuta: ric.id, data: new Date().toISOString().slice(0, 10), riferimento: `${ric.numero} · ${forn.nome || ''}`.slice(0, 200), righe };
  for (const k of Object.keys(valori)) if (!S.campo(fdef, k) || S.campo(fdef, k).archiviato) delete valori[k];
  const nuova = D.crea(db, FATTURE, valori, ctx);
  D.modifica(db, RICEVUTE, ric.id, { integrata: nuova.id }, ctx);
  return nuova;
}

// ---------- un gestionale già installato prende i campi nuovi del modello ----------
// Si aggiunge e basta: entità e campi mancanti, opzioni mancanti delle scelte; il prezzo delle righe passa da valuta (centesimi)
// a numero (fino a 8 decimali, i valori si convertono); i conti che ora scrive il server diventano campi veri.
export function aggiornaModello(db, S, { utente = null } = {}) {
  const m = JSON.parse(readFileSync(MODELLO, 'utf8')), fatto = [];
  if (!S.leggi(db, FATTURE)) return { fatto };   // il modello fatture non c'è: si aggiunge da Personalizza
  for (const e of m.entita) {
    const v = S.leggi(db, e.id);
    if (!v) { S.applica(db, e, { utente }); fatto.push(e.id); continue; }
    if (v.archiviata) continue;
    const { archiviata, ...def } = v; let cambiato = false;
    def.campi = def.campi.map(c => {
      const n = e.campi.find(x => x.id === c.id); if (!n || c.archiviato) return c;
      const x = { ...c };
      if (['scelta', 'stato'].includes(c.tipo) && n.opzioni) { const mancano = n.opzioni.filter(o => !c.opzioni?.some(y => y.id === o.id)); if (mancano.length) { x.opzioni = [...(c.opzioni || []), ...mancano]; cambiato = true; } }
      if (c.tipo === 'stato' && n.transizioni && JSON.stringify(c.transizioni) !== JSON.stringify(n.transizioni)) { x.transizioni = n.transizioni; cambiato = true; }
      const tipoNuovo = (e.id === 'righe_fattura' && c.id === 'prezzo' && c.tipo === 'valuta') || (e.id === FATTURE && c.id === 'importo_ritenuta' && c.tipo === 'calcolato');
      if (tipoNuovo || (c.tipo === 'calcolato' && n.tipo === 'calcolato' && ['imponibile', 'netto', 'totale', 'scaduta'].includes(c.id) && c.formula !== n.formula)) { Object.assign(x, n); delete x.formula; if (n.formula) x.formula = n.formula; cambiato = true; }
      if (e.id === FATTURE && c.id === 'cliente' && c.obbligatorio) { delete x.obbligatorio; cambiato = true; }
      return x;
    });
    const mancanti = e.campi.filter(n => !def.campi.some(c => c.id === n.id));
    if (mancanti.length) { def.campi.push(...mancanti); cambiato = true; }
    const ritenutaNuova = e.id === FATTURE && v.campi.some(c => c.id === 'importo_ritenuta' && c.tipo === 'calcolato');
    if (cambiato) { S.applica(db, def, { utente }); fatto.push(e.id); }
    // la ritenuta era un calcolato su tutto l'imponibile: ora è un campo vero (in centesimi). Le fatture già emesse tengono l'importo
    // con cui sono uscite (la formula di prima; il prezzo è già passato a euro con 8 decimali), le bozze lo ricalcolano alla prossima modifica
    if (ritenutaNuova) db.prepare(`UPDATE d_${FATTURE} SET c_importo_ritenuta = (SELECT CAST(ROUND(IFNULL(SUM(ROUND(IFNULL(r.c_quantita, 1) * IFNULL(r.c_prezzo, 0) * (1 - IFNULL(r.c_sconto, 0) / 100.0) * 100, 0)), 0) * IFNULL(d_${FATTURE}.c_ritenuta, 0) / 100.0) AS INTEGER) FROM d_righe_fattura r WHERE r.c_fattura = d_${FATTURE}.id AND r.archiviato = 0)`).run();
  }
  return { fatto };
}

// le etichette della vista della fattura ricevuta, nelle sei lingue
const ETICHETTE = {
  it: { fattura: 'Fattura', fornitore: 'Fornitore', cliente: 'Cliente', piva: 'P.IVA', cf: 'CF', descrizione: 'Descrizione', quantita: 'Quantità', prezzo: 'Prezzo', iva: 'IVA', totale: 'Totale', imponibile: 'Imponibile', ritenuta: 'Ritenuta', scadenza: 'Scadenza', modalita: 'Modalità', importo: 'Importo' },
  en: { fattura: 'Invoice', fornitore: 'Supplier', cliente: 'Customer', piva: 'VAT no.', cf: 'Tax code', descrizione: 'Description', quantita: 'Quantity', prezzo: 'Price', iva: 'VAT', totale: 'Total', imponibile: 'Taxable amount', ritenuta: 'Withholding', scadenza: 'Due date', modalita: 'Method', importo: 'Amount' },
  es: { fattura: 'Factura', fornitore: 'Proveedor', cliente: 'Cliente', piva: 'NIF-IVA', cf: 'Código fiscal', descrizione: 'Descripción', quantita: 'Cantidad', prezzo: 'Precio', iva: 'IVA', totale: 'Total', imponibile: 'Base imponible', ritenuta: 'Retención', scadenza: 'Vencimiento', modalita: 'Forma de pago', importo: 'Importe' },
  fr: { fattura: 'Facture', fornitore: 'Fournisseur', cliente: 'Client', piva: 'N° TVA', cf: 'Code fiscal', descrizione: 'Description', quantita: 'Quantité', prezzo: 'Prix', iva: 'TVA', totale: 'Total', imponibile: 'Montant HT', ritenuta: 'Retenue', scadenza: 'Échéance', modalita: 'Mode', importo: 'Montant' },
  de: { fattura: 'Rechnung', fornitore: 'Lieferant', cliente: 'Kunde', piva: 'USt-IdNr.', cf: 'Steuernummer', descrizione: 'Beschreibung', quantita: 'Menge', prezzo: 'Preis', iva: 'MwSt.', totale: 'Gesamt', imponibile: 'Nettobetrag', ritenuta: 'Quellensteuer', scadenza: 'Fällig am', modalita: 'Zahlungsart', importo: 'Betrag' },
  pt: { fattura: 'Fatura', fornitore: 'Fornecedor', cliente: 'Cliente', piva: 'Nº IVA', cf: 'Código fiscal', descrizione: 'Descrição', quantita: 'Quantidade', prezzo: 'Preço', iva: 'IVA', totale: 'Total', imponibile: 'Base tributável', ritenuta: 'Retenção', scadenza: 'Vencimento', modalita: 'Forma', importo: 'Valor' },
};
