// I movimenti bancari dei connettori dell'open banking (Enable Banking, Qonto, Revolut Business, Wise) entrano nella sezione
// «Movimenti di banca» della tesoreria (server/moduli/tesoreria.js, docs/TESORERIA.md), con gli stessi campi dell'estratto
// conto importato: data, importo (+ entrata, − uscita), descrizione, controparte, iban, riferimento, conto, fonte, id_esterno.
// Niente doppioni: id_esterno è l'id del movimento nella banca. L'abbinamento con le fatture lo fa UNO solo, la tesoreria
// (pagina Banca, strumento di Lumi «tesoreria_abbina_movimento»): qui non ci sono proposte né «riconcilia».
// Un movimento del connettore è { id, data: 'AAAA-MM-GG', importo (con il segno), valuta, descrizione, controparte, iban?, riferimento?, conto }.
import { MOVIMENTI, banca as bancaTesoreria } from '../../server/moduli/tesoreria.js';

export const SEZIONE_BANCA = MOVIMENTI;
const f = { facoltativo: true };
export const RICHIEDE_BANCA = {
  [MOVIMENTI]: { data: { tipo: 'data' }, importo: {}, descrizione: {}, id_esterno: {}, controparte: f, iban: f, riferimento: f, conto: f, fonte: { tipo: 'scelta', facoltativo: true } },
};
// leggere le fatture serve solo a contare le proposte della tesoreria per l'avviso: il connettore non segna pagato niente
export const PERMESSI_BANCA = { [MOVIMENTI]: { leggi: true, crea: true }, fatture: { leggi: true }, rate_fattura: { leggi: true }, fatture_ricevute: { leggi: true }, clienti: { leggi: true }, fornitori: { leggi: true } };

const sezione = k => { try { const d = k.S.leggi(k.db, k.entita(MOVIMENTI)); return d && !d.archiviata ? d : null; } catch { return null; } };
const testo = (v, max) => String(v ?? '').trim().slice(0, max);

// i movimenti arrivati dalla banca, scritti nella sezione della tesoreria. → { nuovi, proposte } (proposte: quanti dei nuovi
// la tesoreria sa già abbinare). «visti» ricorda gli ultimi id: un movimento tolto a mano non torna col giro dopo.
export function registraMovimenti(k, movimenti) {
  if (!sezione(k)) throw new Error('Manca la sezione «Movimenti di banca»: premi «Prepara» in Tesoreria, poi «Sincronizza ora»');
  const visti = new Set(k.stato.leggi('visti') || []), creati = [];
  for (const m of movimenti) {
    const idEst = testo(m.id, 200), importo = Math.round(Number(m.importo) * 100) / 100;
    if (!idEst || visti.has(idEst) || !/^\d{4}-\d{2}-\d{2}$/.test(String(m.data || '')) || !Number.isFinite(importo) || !importo) continue;
    visti.add(idEst);
    if (k.dati.trova(MOVIMENTI, 'id_esterno', idEst)) continue;
    const v = { data: m.data, importo, descrizione: testo(m.descrizione || m.controparte, 500) || '—', controparte: testo(m.controparte, 200), iban: testo(m.iban, 40).replace(/\s/g, '').toUpperCase(),
      riferimento: testo(m.riferimento, 100), conto: testo(m.conto, 100), fonte: 'openbanking', id_esterno: idEst };
    for (const x of Object.keys(v)) if (!k.campo(MOVIMENTI, x) || v[x] === '') delete v[x];
    creati.push(k.dati.crea(MOVIMENTI, v).id);
  }
  k.stato.scrivi('visti', [...visti].slice(-3000));
  let proposte = 0;
  if (creati.length) {
    try { const nuovi = new Set(creati); proposte = bancaTesoreria(k, k.ctx).daAbbinare.filter(m => nuovi.has(m.id) && m.proposte.length).length; } catch { proposte = 0; }
  }
  // l'avviso solo per i movimenti nuovi che la tesoreria sa abbinare: gli altri si vedono comunque in Tesoreria › Banca
  if (proposte) k.avvisa(`${proposte} movimenti sembrano pagare delle fatture: abbinali in Tesoreria › Banca`);
  return { nuovi: creati.length, proposte };
}
