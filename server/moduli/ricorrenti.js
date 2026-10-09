// I contratti ricorrenti: canoni, manutenzioni, abbonamenti che si fatturano da soli. Rotte:
//   GET/PUT /api/ricorrenti/impostazioni   { automatico } (ogni giorno, da solo, crea le fatture dovute)
//   POST /api/ricorrenti/prepara           aggiunge la sezione «Contratti ricorrenti» (serve il modello fatture)
//   GET  /api/ricorrenti/dovuti?oggi       le fatture da fare adesso, una per periodo arretrato
//   POST /api/ricorrenti/genera { contratto? }   le crea (in bozza o emesse, come dice il contratto) e porta avanti la data
// Le fatture passano da dati.js con il ctx di chi chiede (o del sistema, per il giro automatico): numerazione, conti e
// blocco dopo l'emissione restano quelli del modulo fatture.
import { piuMesi, piuGiorni } from './tesoreria-regole.js';
import { transazione } from '../db.js';

export const CONTRATTI = 'contratti_ricorrenti';
const MESI = { mensile: 1, bimestrale: 2, trimestrale: 3, semestrale: 6, annuale: 12 };
const oggiIso = () => new Date().toISOString().slice(0, 10);
const esiste = (S, db, e) => { const d = S.leggi(db, e); return !!d && !d.archiviata; };
const idDi = x => (x && typeof x === 'object' ? x.id : x) ?? null;
const it = s => String(s).split('-').reverse().join('/');
export const SEZIONE = { id: CONTRATTI, nome: 'Contratti ricorrenti', icona: 'calendario', titolo: 'descrizione', campi: [
  { id: 'numero', nome: 'Numero', tipo: 'contatore', formato: 'CR-{AAAA}-{N:3}' },
  { id: 'cliente', nome: 'Cliente', tipo: 'relazione', entita: 'clienti', obbligatorio: true },
  { id: 'descrizione', nome: 'Descrizione (riga della fattura)', tipo: 'testo', obbligatorio: true },
  { id: 'importo', nome: 'Importo per periodo (senza IVA)', tipo: 'valuta', obbligatorio: true },
  { id: 'aliquota', nome: 'IVA %', tipo: 'percentuale', predefinito: 22 },
  { id: 'periodicita', nome: 'Ogni', tipo: 'scelta', predefinito: 'mensile', opzioni: Object.keys(MESI).map(id => ({ id, nome: id[0].toUpperCase() + id.slice(1) })) },
  { id: 'prossima', nome: 'Prossima fattura il', tipo: 'data', obbligatorio: true },
  { id: 'fino_al', nome: 'Fino al', tipo: 'data' },
  { id: 'stato', nome: 'Stato', tipo: 'stato', iniziale: 'attivo', opzioni: [{ id: 'attivo', nome: 'Attivo', colore: 'verde' }, { id: 'sospeso', nome: 'Sospeso', colore: 'giallo' }, { id: 'chiuso', nome: 'Chiuso', colore: 'grigio' }],
    transizioni: { attivo: ['sospeso', 'chiuso'], sospeso: ['attivo', 'chiuso'], chiuso: ['attivo'] } },
  { id: 'emetti', nome: 'Le fatture nascono', tipo: 'scelta', predefinito: 'bozza', opzioni: [{ id: 'bozza', nome: 'In bozza, da controllare' }, { id: 'emessa', nome: 'Già emesse' }] },
  { id: 'ultima_fattura', nome: 'Ultima fattura', tipo: 'relazione', entita: 'fatture' },
  { id: 'note', nome: 'Note', tipo: 'testo_lungo' }] };

export function prepara(k, { utente = null } = {}) {
  const { db, S } = k;
  if (!esiste(S, db, 'fatture') || !esiste(S, db, 'clienti')) throw new Error('Per i contratti ricorrenti serve il modello «Fatture e fattura elettronica»');
  if (esiste(S, db, CONTRATTI)) return { fatto: [] };
  S.applica(db, structuredClone(SEZIONE), { utente });
  return { fatto: [CONTRATTI] };
}
export function impostazioni(db, meta) { let s = {}; try { s = JSON.parse(meta.leggi(db, 'ricorrenti.impostazioni') || '{}'); } catch { s = {}; } return { automatico: false, ...s }; }

// i periodi dovuti di un contratto fino a oggi (al massimo 24: un contratto dimenticato per anni non sommerge di fatture)
export function periodi(c, oggi = oggiIso()) {
  const n = MESI[c.periodicita] || 1, out = [];
  if (c.stato !== 'attivo' || !c.prossima) return out;
  for (let d = c.prossima; d <= oggi && (!c.fino_al || d <= c.fino_al) && out.length < 24; d = piuMesi(d, n)) out.push({ data: d, da: d, a: piuGiorni(piuMesi(d, n), -1) });
  return out;
}
const tutte = (D, db, ctx) => { const out = []; for (let p = 1; p < 400; p++) { const r = D.elenca(db, CONTRATTI, { perPagina: 500, pagina: p }, ctx); out.push(...r.righe); if (r.righe.length < 500) break; } return out; };
export function dovuti(k, ctx, { oggi = oggiIso(), contratto = null } = {}) {
  const { db, S, D } = k;
  if (!esiste(S, db, CONTRATTI)) return [];
  return tutte(D, db, ctx).filter(c => !contratto || c.id === String(contratto)).map(c => ({ id: c.id, numero: c.numero, cliente: { id: idDi(c.cliente), nome: c.cliente?.titolo ?? '' }, descrizione: c.descrizione,
    importo: Number(c.importo) || 0, aliquota: c.aliquota ?? 22, emetti: c.emetti || 'bozza', periodi: periodi(c, oggi) })).filter(c => c.periodi.length && c.importo > 0 && c.cliente.id);
}
export function genera(k, ctx, { oggi = oggiIso(), contratto = null } = {}) {
  const { db, D } = k, fatte = [];
  for (const c of dovuti(k, ctx, { oggi, contratto })) {
    transazione(db, () => {
      let ultima = null;
      for (const p of c.periodi) {
        const f = D.crea(db, 'fatture', { cliente: c.cliente.id, data: p.data, stato: c.emetti === 'emessa' ? 'emessa' : 'bozza',
          righe: [{ descrizione: `${c.descrizione} - periodo dal ${it(p.da)} al ${it(p.a)}`, quantita: 1, prezzo: c.importo, aliquota: c.aliquota }],
          ...(c.numero ? { riferimento: `Contratto ${c.numero}` } : {}) }, ctx);
        ultima = f.id; fatte.push({ contratto: c.id, cliente: c.cliente.nome, fattura: f.id, numero: f.numero || null, data: p.data, importo: c.importo });
      }
      const dopo = piuMesi(c.periodi.at(-1).data, MESI[D.leggi(db, CONTRATTI, c.id, ctx, { conRighe: false }).periodicita] || 1);
      const riga = D.leggi(db, CONTRATTI, c.id, ctx, { conRighe: false });
      D.modifica(db, CONTRATTI, c.id, { prossima: dopo, ultima_fattura: ultima, ...(riga.fino_al && dopo > riga.fino_al ? { stato: 'chiuso' } : {}) }, ctx);
    });
  }
  return { fatte };
}
// le fatture future dei contratti attivi, per la previsione di cassa (importo con l'IVA)
export function future(k, ctx, { da, a }) {
  const { db, S, D, P } = k;
  if (!esiste(S, db, CONTRATTI) || !P.puo(ctx, CONTRATTI, 'leggi')) return [];
  const out = [];
  for (const c of tutte(D, db, ctx)) {
    if (c.stato !== 'attivo' || !c.prossima || !(Number(c.importo) > 0)) continue;
    const n = MESI[c.periodicita] || 1, lordo = Math.round(Number(c.importo) * (100 + Number(c.aliquota ?? 22))) / 100;
    for (let d = c.prossima, i = 0; d <= a && (!c.fino_al || d <= c.fino_al) && i < 120; d = piuMesi(d, n), i++) if (d >= da) out.push({ data: d, importo: lordo, descrizione: `${c.descrizione} · ${c.cliente?.titolo ?? ''}` });
  }
  return out;
}

function strumentiLumi(k) {
  const { P } = k;
  return [
    { nome: 'ricorrenti_dovuti', tipo: 'leggi', permesso: ctx => P.puo(ctx, CONTRATTI, 'leggi'), descrizione: 'Le fatture dei contratti ricorrenti (canoni, manutenzioni, abbonamenti) da fare adesso, una per periodo arretrato.',
      schema: { type: 'object', properties: {} }, esegui: async ({ ctx }) => ({ dovuti: dovuti(k, ctx) }) },
    { nome: 'ricorrenti_genera', tipo: 'scrivi', permesso: ctx => P.puo(ctx, 'fatture', 'crea') && P.puo(ctx, CONTRATTI, 'modifica'),
      descrizione: 'Crea le fatture dovute dei contratti ricorrenti (tutti, o uno con il suo id) e porta avanti la prossima data.',
      schema: { type: 'object', properties: { contratto: { type: 'string', maxLength: 64 } } },
      anteprima: async ({ ctx, args }) => {
        const l = dovuti(k, ctx, { contratto: args.contratto || null });
        if (!l.length) return { errore: 'Nessuna fattura dovuta adesso' };
        return { titolo: 'Fatture dei contratti ricorrenti', righe: l.flatMap(c => c.periodi.map(p => [`${c.cliente.nome} · ${c.descrizione}`, `${it(p.data)} · € ${c.importo.toFixed(2)} + IVA ${c.aliquota}% · ${c.emetti === 'emessa' ? 'emessa' : 'bozza'}`])).slice(0, 40), avvisi: [] };
      },
      esegui: async ({ ctx, args }) => genera(k, ctx, { contratto: args.contratto || null }) },
  ];
}

export default function registra(k) {
  const { r, db, P, meta, serve, ErroreHttp } = k;
  const leggibile = e => { if (e?.stato || e instanceof k.D.ErroreDati || e instanceof P.ErrorePermesso) throw e; throw new ErroreHttp(422, e.message); };
  const prova = f => { try { return f(); } catch (e) { leggibile(e); } };
  r('GET', '/api/ricorrenti/impostazioni', ({ ctx }) => { serve(ctx); return { ...impostazioni(db, meta), pronti: esiste(k.S, db, CONTRATTI), fatture: esiste(k.S, db, 'fatture'), puo: { prepara: P.puoSchema(ctx) } }; });
  r('PUT', '/api/ricorrenti/impostazioni', ({ ctx, corpo }) => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso(); meta.scrivi(db, 'ricorrenti.impostazioni', JSON.stringify({ automatico: !!corpo.automatico })); return impostazioni(db, meta); });
  r('POST', '/api/ricorrenti/prepara', ({ ctx }) => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso(); return prova(() => prepara(k, { utente: ctx.utente.id })); });
  r('GET', '/api/ricorrenti/dovuti', ({ ctx }) => { serve(ctx); P.verifica(ctx, CONTRATTI, 'leggi'); return dovuti(k, ctx); });
  r('POST', '/api/ricorrenti/genera', ({ ctx, corpo }) => { serve(ctx); P.verifica(ctx, CONTRATTI, 'modifica'); return prova(() => genera(k, ctx, { contratto: corpo.contratto || null })); });
  for (const s of strumentiLumi(k)) k.lumi?.strumento?.(s);
  // il giro automatico: una volta al giorno, se acceso; il primo controllo un minuto dopo l'avvio (unref: non tiene vivo il processo)
  const giro = () => {
    try {
      if (!impostazioni(db, meta).automatico || meta.leggi(db, 'ricorrenti.ultimo') === oggiIso()) return;
      genera(k, null); meta.scrivi(db, 'ricorrenti.ultimo', oggiIso());
    } catch (e) { console.error('ricorrenti:', e.message); }
  };
  setTimeout(giro, 60e3).unref?.(); setInterval(giro, 3600e3).unref?.();
}
