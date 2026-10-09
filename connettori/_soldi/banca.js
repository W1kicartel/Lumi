// I movimenti bancari (Enable Banking, Qonto, Revolut…) e la riconciliazione con le fatture aperte.
// Un movimento è { id, data: 'AAAA-MM-GG', importo (con il segno: + entrata, − uscita), valuta, descrizione, controparte, conto }.
// Se l'azienda ha una sezione «movimenti» (facoltativa: Kubo non la crea), i movimenti si scrivono lì, abbinati per id remoto
// (niente doppioni). In ogni caso le entrate si confrontano con le fatture emesse non pagate, e le uscite con le fatture
// ricevute da pagare: stesso importo, e il numero della fattura (o il nome) nella causale. Le proposte restano nello stato
// del connettore; la persona (o Lumi, con la conferma) le applica con l'azione «riconcilia», che segna pagata la fattura.
import { daIncassare, giorno } from './comuni.js';

export const RICHIEDE_BANCA = {
  movimenti: { data: { tipo: 'data', facoltativo: true }, importo: { facoltativo: true }, descrizione: { facoltativo: true }, controparte: { facoltativo: true },
    conto: { facoltativo: true }, fattura: { tipo: 'relazione', facoltativo: true } },
  fatture: { stato: { tipo: 'stato', facoltativo: true }, numero: { facoltativo: true }, totale: { facoltativo: true }, netto: { facoltativo: true }, pagata_il: { tipo: 'data', facoltativo: true }, cliente: { tipo: 'relazione', facoltativo: true } },
  fatture_ricevute: { stato: { tipo: 'stato', facoltativo: true }, numero: { facoltativo: true }, totale: { facoltativo: true }, netto: { facoltativo: true }, pagata_il: { tipo: 'data', facoltativo: true }, fornitore: { tipo: 'relazione', facoltativo: true } },
};
export const PERMESSI_BANCA = { movimenti: { leggi: true, crea: true, modifica: true }, fatture: { leggi: true, modifica: true }, fatture_ricevute: { leggi: true, modifica: true }, clienti: { leggi: true }, fornitori: { leggi: true } };

const c = (k, sem) => { try { const d = k.S.leggi(k.db, k.entita(sem)); return d && !d.archiviata ? d : null; } catch { return null; } };
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ');
// il numero «12», «2026/12», «FT-12» nella causale: come parola intera, non dentro «112» o in una data
const haNumero = (testo, numero) => { const n = String(numero ?? '').trim(); if (!n) return false;
  const e = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`(^|[^\\d/])${e}([^\\d/]|$)`, 'i').test(testo); };

// le fatture aperte: emesse/inviate (attive, per le entrate) o da pagare (ricevute, per le uscite)
function aperte(k, sem) {
  if (!c(k, sem) || !k.campo(sem, 'stato')) return [];
  const stati = sem === 'fatture' ? ['emessa', 'inviata'] : ['da_pagare'];
  return k.dati.elenca(sem, { filtri: [{ campo: 'stato', op: 'in', valore: stati }], perPagina: 2000 }).righe;
}

// le fatture che corrispondono a un movimento, la migliore per prima. → [{ sem, id, numero, importo, motivo, punti }]
export function candidate(k, m) {
  const sem = m.importo > 0 ? 'fatture' : 'fatture_ricevute', imp = Math.abs(Number(m.importo)), testo = norm(`${m.descrizione} ${m.controparte}`), out = [];
  for (const r of aperte(k, sem)) {
    const dovuto = daIncassare(k, sem, r), tot = Number(k.valore(r, sem, 'totale') || 0), numero = k.valore(r, sem, 'numero');
    const stesso = Math.abs(dovuto - imp) < 0.005 || Math.abs(tot - imp) < 0.005;
    if (!stesso) continue;
    const chi = r[k.campo(sem, sem === 'fatture' ? 'cliente' : 'fornitore')]?.titolo;
    let punti = 1, motivo = 'stesso importo';
    if (haNumero(testo, numero)) { punti += 2; motivo += ' e numero nella causale'; }
    if (chi && norm(chi).length > 2 && testo.includes(norm(chi))) { punti += 1; motivo += chi ? ` e «${chi}»` : ''; }
    out.push({ sem, id: r.id, numero, importo: imp, motivo, punti });
  }
  return out.sort((a, b) => b.punti - a.punti);
}

// i movimenti arrivati dalla banca: scritti (se c'è la sezione), confrontati, ricordati. → { nuovi, proposte }
export function registraMovimenti(k, movimenti) {
  const visti = new Set(k.stato.leggi('visti') || []), proposte = k.stato.leggi('proposte') || [], sez = c(k, 'movimenti');
  let nuovi = 0, aggiunte = 0;
  for (const m of movimenti) {
    const chiave = String(m.id); if (!m.id || visti.has(chiave)) continue;
    visti.add(chiave); nuovi++;
    if (sez && !k.sincro.locale('movimenti', chiave)) {
      const v = { data: m.data, importo: Number(m.importo), descrizione: String(m.descrizione || '').slice(0, 500), controparte: String(m.controparte || '').slice(0, 200), conto: m.conto };
      for (const x of Object.keys(v)) if (!k.campo('movimenti', x) || v[x] == null || v[x] === '') delete v[x];
      const riga = k.dati.crea('movimenti', v); k.sincro.collega('movimenti', riga.id, chiave);
    }
    const cand = candidate(k, m);
    if (cand.length && (cand.length === 1 || cand[0].punti > cand[1].punti) && ++aggiunte)
      proposte.push({ movimento: chiave, data: m.data, importo: Number(m.importo), descrizione: String(m.descrizione || '').slice(0, 140), ...cand[0] });
  }
  k.stato.scrivi('visti', [...visti].slice(-3000));
  k.stato.scrivi('proposte', proposte.slice(-300));
  // l'avviso solo per le proposte nuove di questo giro: quelle vecchie restano nell'elenco senza ripetersi
  if (aggiunte) k.avvisa(`${aggiunte} movimenti sembrano pagare delle fatture: controlla «Bonifici da abbinare»`);
  return { nuovi, proposte: proposte.length };
}

// le azioni comuni: «proposte» (Lumi le legge) e «riconcilia» (segna pagata la fattura, con la data del movimento)
export const AZIONI_BANCA = {
  proposte: {
    nome: 'Bonifici da abbinare', su: 'fatture', lumi: true, descrizione: 'Elenca i movimenti bancari che sembrano pagare fatture aperte',
    esegui: async (_, k) => ({ proposte: (k.stato.leggi('proposte') || []).map(p => ({ movimento: p.movimento, data: p.data, importo: p.importo, causale: p.descrizione, fattura: p.id, sezione: p.sem, numero: p.numero, motivo: p.motivo })) }),
  },
  riconcilia: {
    nome: 'Riconcilia', su: 'fatture', lumi: true, scrive: true, descrizione: 'Segna pagata la fattura abbinata a un movimento bancario',
    input: { movimento: { tipo: 'testo', nome: 'Il codice del movimento (dalle proposte)' } },
    proponi: async ({ movimento }, k) => {
      const p = (k.stato.leggi('proposte') || []).find(x => x.movimento === String(movimento));
      if (!p) return { titolo: 'Riconcilia', righe: [['Movimento', String(movimento)]], avvisi: ['Nessuna proposta per questo movimento'] };
      return { titolo: 'Riconcilia', righe: [['Movimento', `${p.data} · ${k.euro(p.importo)}`], ['Causale', p.descrizione], [p.sem === 'fatture' ? 'Fattura' : 'Fattura ricevuta', p.numero], ['Perché', p.motivo]], avvisi: [] };
    },
    async esegui({ movimento }, k) {
      const tutte = k.stato.leggi('proposte') || [], p = tutte.find(x => x.movimento === String(movimento));
      if (!p) throw new Error('Nessuna proposta per questo movimento');
      const r = k.dati.leggi(p.sem, p.id);
      if (k.valore(r, p.sem, 'stato') === 'pagata') throw new Error('La fattura è già pagata');
      k.dati.modifica(p.sem, p.id, { stato: 'pagata', ...(k.campo(p.sem, 'pagata_il') ? { pagata_il: p.data || giorno(k) } : {}) });
      const riga = c(k, 'movimenti') && k.sincro.locale('movimenti', p.movimento);
      if (riga && k.campo('movimenti', 'fattura') && p.sem === 'fatture') k.dati.modifica('movimenti', riga, { fattura: p.id });
      k.stato.scrivi('proposte', tutte.filter(x => x.movimento !== p.movimento));
      return { ok: true, fattura: p.id, numero: p.numero };
    },
  },
};
export const TESTI_BANCA = {
  en: { 'az.proposte': 'Transfers to match', 'az.riconcilia': 'Reconcile' },
  es: { 'az.proposte': 'Transferencias por conciliar', 'az.riconcilia': 'Conciliar' },
  fr: { 'az.proposte': 'Virements à rapprocher', 'az.riconcilia': 'Rapprocher' },
  de: { 'az.proposte': 'Zuzuordnende Überweisungen', 'az.riconcilia': 'Abgleichen' },
  pt: { 'az.proposte': 'Transferências a conciliar', 'az.riconcilia': 'Conciliar' },
};
