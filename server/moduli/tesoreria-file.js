// I file della banca, senza database e senza dipendenze.
//   In uscita: Ri.Ba. nel tracciato CBI a record di 120 caratteri, SEPA Direct Debit (ISO 20022 pain.008.001.02),
//              bonifici SEPA (ISO 20022 pain.001.001.03).
//   In entrata: estratto conto CAMT.053 (camt.053.001.02 e successive), rendicontazione CBI «RH» a 120 caratteri, CSV o
//              Excel della banca (colonne riconosciute dal nome).
// Fonti, accanto a ogni tracciato: CBI (Consorzio CBI, standard «Ri.Ba. – Incassi commerciali» e «Rendicontazione movimenti
// di c/c»), EPC (SEPA Core Direct Debit e SEPA Credit Transfer, Customer-to-PSP Implementation Guidelines), ISO 20022 (schemi
// pain.001.001.03, pain.008.001.02, camt.053.001.02 da iso20022.org). Un'implementazione di riferimento per la Ri.Ba. è il
// modulo l10n_it_riba di OCA (github.com/OCA/l10n-italy), con cui il tracciato coincide record per record.
import { randomBytes } from 'node:crypto';
import { ibanValido } from './documenti-italia.js';
import { xml, deXml, leggiTabella, numeroIt, dataIt } from './import-formati.js';

// ---------- IBAN ----------
export const pulisciIban = s => String(s || '').replace(/\s+/g, '').toUpperCase();
// un IBAN italiano: IT, 2 cifre di controllo, CIN, ABI (5), CAB (5), conto (12)
export function partiIban(s) {
  const v = pulisciIban(s);
  if (!/^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/.test(v) || ibanValido(v).errore) return null;
  return { iban: v, cin: v[4], abi: v.slice(5, 10), cab: v.slice(10, 15), conto: v.slice(15) };
}
const mod97 = s => { let r = 0; for (const c of s) { const n = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c; for (const d of n) r = (r * 10 + Number(d)) % 97; } return r; };
// l'identificativo del creditore SEPA (Creditor Identifier, EPC262-08): IT + controllo + codice attività (ZZZ) + codice fiscale
// o partita IVA. Il controllo si calcola sul codice nazionale senza il codice attività, seguito da «IT00» (ISO 7064 mod 97-10).
export function idCreditore(cf, attivita = 'ZZZ') {
  const naz = String(cf || '').replace(/\W/g, '').toUpperCase(); if (!naz) return '';
  const c = String(98 - mod97(naz + 'IT00')).padStart(2, '0');
  return `IT${c}${attivita}${naz}`;
}
export function idCreditoreValido(s) {
  const v = String(s || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(v)) return false;
  return mod97(v.slice(7) + v.slice(0, 4)) === 1;
}

// ---------- testo ammesso ----------
// SEPA: solo il set latino di base (EPC217-08): a-z A-Z 0-9 / - ? : ( ) . , ' + e lo spazio. Le lettere accentate perdono l'accento.
export const testoSepa = (s, max = 140) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9/\-?:().,'+ ]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max);
// CBI a 120 caratteri: maiuscolo, niente accenti, solo caratteri stampabili ASCII
const testoCbi = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, ' ').toUpperCase();
const sx = (s, n) => testoCbi(s).slice(0, n).padEnd(n);       // testo a sinistra, spazi a destra
const dx = (s, n) => String(s ?? '').replace(/\D/g, '').slice(-n).padStart(n, '0');   // numero a destra, zeri a sinistra
const ggmmaa = iso => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
const importo = c => (c / 100).toFixed(2);

// ---------- Ri.Ba. CBI ----------
// Un flusso: IB (testa), poi per ogni ricevuta i record 14, 20, 30, 40, 50, 51, 70, infine EF (coda). Ogni record è di 120
// caratteri e finisce con CR LF. Posizioni (1-based) del record 14: 2-3 «14», 4-10 numero progressivo, 23-28 scadenza GGMMAA,
// 29-33 causale «30000», 34-46 importo in centesimi, 47 segno «-», 48-52 ABI e 53-57 CAB della banca del creditore,
// 58-69 conto, 70-74 ABI e 75-79 CAB della banca del debitore, 92-96 codice SIA, 97 tipo codice «4», 98-113 codice del
// debitore, 120 divisa «E».
//   az: { ragione_sociale, via, cap, comune, provincia, piva, codice_fiscale, iban }; sia: codice SIA (5 caratteri, dalla banca)
//   ricevute: [{ importo (cent), scadenza, debitore: { nome, cf, via, cap, comune, provincia, iban, banca? }, fattura: { numero, data }, codice? }]
export function riba({ az, sia, ricevute, supporto, oggi }) {
  const errori = [], banca = partiIban(az.iban);
  if (!/^[A-Z0-9]{5}$/i.test(String(sia || ''))) errori.push({ chiave: 'sia' });
  if (!banca) errori.push({ chiave: 'iban-azienda' });
  ricevute.forEach((r, i) => {
    if (!partiIban(r.debitore.iban) && !(r.debitore.abi && r.debitore.cab)) errori.push({ chiave: 'banca-debitore', nome: r.debitore.nome, n: i + 1 });
    if (!r.debitore.cf) errori.push({ chiave: 'cf-debitore', nome: r.debitore.nome, n: i + 1 });
    if (!(r.importo > 0)) errori.push({ chiave: 'importo', nome: r.debitore.nome, n: i + 1 });
  });
  if (errori.length) return { errori };
  const S = String(sia).toUpperCase(), sup = sx(supporto, 20), data = ggmmaa(oggi), righe = [];
  righe.push(' IB' + S + banca.abi + data + sup + ' '.repeat(74) + 'E' + ' '.repeat(6));
  let totale = 0;
  ricevute.forEach((r, i) => {
    const n = String(i + 1).padStart(7, '0'), d = r.debitore, b = partiIban(d.iban) || { abi: d.abi, cab: d.cab };
    totale += r.importo;
    righe.push(' 14' + n + ' '.repeat(12) + ggmmaa(r.scadenza) + '30000' + dx(r.importo, 13) + '-' + banca.abi + banca.cab + sx(banca.conto, 12) +
      dx(b.abi, 5) + dx(b.cab, 5) + ' '.repeat(12) + S + '4' + sx(r.codice || d.cf, 16) + ' '.repeat(6) + 'E');
    righe.push(' 20' + n + sx(az.ragione_sociale, 24) + sx(az.via, 24) + sx(`${az.cap || ''} ${az.comune || ''} ${az.provincia || ''}`.trim(), 24) + sx(az.piva ? `P.IVA ${az.piva}` : '', 24) + ' '.repeat(14));
    righe.push(' 30' + n + sx(d.nome, 60) + sx(d.cf, 16) + ' '.repeat(34));
    righe.push(' 40' + n + sx(d.via, 30) + dx(d.cap, 5) + sx(d.comune, 23) + sx(d.provincia, 2) + sx(d.banca || '', 50));
    righe.push(' 50' + n + sx(`PER LA FATTURA N. ${r.fattura.numero} DEL ${r.fattura.data.split('-').reverse().join('/')} IMP ${importo(r.importo)}`, 80) + ' '.repeat(10) + sx(az.piva || az.codice_fiscale, 16) + ' '.repeat(4));
    righe.push(' 51' + n + dx(i + 1, 10) + sx(az.ragione_sociale, 20) + ' '.repeat(80));
    righe.push(' 70' + n + ' '.repeat(110));
  });
  const nr = ricevute.length;
  righe.push(' EF' + S + banca.abi + data + sup + ' '.repeat(6) + dx(nr, 7) + dx(totale, 15) + '0'.repeat(15) + dx(nr * 7 + 2, 7) + ' '.repeat(24) + 'E' + ' '.repeat(6));
  return { testo: righe.map(x => x + '\r\n').join(''), totale, numero: nr };
}

// ---------- SEPA ----------
const agente = bic => (bic && /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic) ? `<FinInstnId><BIC>${bic}</BIC></FinInstnId>` : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>');
const quando = d => d.toISOString().slice(0, 19);
// unico anche per due file nello stesso secondo (la banca rifiuta un MsgId già visto): millisecondi e tre cifre a caso,
// 30 caratteri (PmtInfId aggiunge «-n»: resta nei 35)
const idMsg = (pref, d) => `${pref}-${d.toISOString().replace(/\D/g, '').slice(0, 17)}-${randomBytes(2).toString('hex').slice(0, 3).toUpperCase()}`;

// SEPA Direct Debit Core, pain.008.001.02 (EPC130-08 Implementation Guidelines). Un PmtInf per data di incasso.
// SeqTp: RCUR per tutti i mandati ricorrenti: dal rulebook EPC 2016 (v9.0) il primo incasso non deve più essere FRST.
//   az: { ragione_sociale, iban, bic?, idCreditore }; incassi: [{ importo, data, debitore: { nome, iban, bic? }, mandato: { id, data }, e2e, causale }]
export function pain008({ az, incassi, adesso = new Date(), sequenza = 'RCUR' }) {
  const errori = [];
  if (!pulisciIban(az.iban) || ibanValido(pulisciIban(az.iban)).errore) errori.push({ chiave: 'iban-azienda' });
  if (!idCreditoreValido(az.idCreditore)) errori.push({ chiave: 'id-creditore' });
  incassi.forEach((x, i) => {
    if (ibanValido(pulisciIban(x.debitore.iban)).errore) errori.push({ chiave: 'iban-debitore', nome: x.debitore.nome, n: i + 1 });
    if (!x.mandato?.id || !x.mandato?.data) errori.push({ chiave: 'mandato', nome: x.debitore.nome, n: i + 1 });
    // il codice del mandato va alla banca così com'è firmato: se andrebbe ripulito (caratteri fuori dal set SEPA, oltre 35) è un errore, non si cambia
    else if (testoSepa(x.mandato.id, 35) !== String(x.mandato.id).trim()) errori.push({ chiave: 'mandato-id', nome: x.debitore.nome, n: i + 1 });
    if (!(x.importo > 0)) errori.push({ chiave: 'importo', nome: x.debitore.nome, n: i + 1 });
  });
  if (errori.length) return { errori };
  const perData = new Map(); for (const x of incassi) (perData.get(x.data) || perData.set(x.data, []).get(x.data)).push(x);
  const tot = incassi.reduce((s, x) => s + x.importo, 0), msg = idMsg('LUMI-SDD', adesso);
  let k = 0;
  const blocchi = [...perData.entries()].sort().map(([data, l]) => {
    const sub = l.reduce((s, x) => s + x.importo, 0);
    return `<PmtInf><PmtInfId>${xml(`${msg}-${++k}`)}</PmtInfId><PmtMtd>DD</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>${l.length}</NbOfTxs><CtrlSum>${importo(sub)}</CtrlSum>` +
      `<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>${sequenza}</SeqTp></PmtTpInf><ReqdColltnDt>${data}</ReqdColltnDt>` +
      `<Cdtr><Nm>${xml(testoSepa(az.ragione_sociale, 70))}</Nm></Cdtr><CdtrAcct><Id><IBAN>${pulisciIban(az.iban)}</IBAN></Id></CdtrAcct><CdtrAgt>${agente(az.bic)}</CdtrAgt><ChrgBr>SLEV</ChrgBr>` +
      `<CdtrSchmeId><Id><PrvtId><Othr><Id>${xml(String(az.idCreditore).replace(/\s/g, '').toUpperCase())}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>` +
      l.map(x => `<DrctDbtTxInf><PmtId><EndToEndId>${xml(testoSepa(x.e2e, 35) || 'NOTPROVIDED')}</EndToEndId></PmtId><InstdAmt Ccy="EUR">${importo(x.importo)}</InstdAmt>` +
        `<DrctDbtTx><MndtRltdInf><MndtId>${xml(testoSepa(x.mandato.id, 35))}</MndtId><DtOfSgntr>${x.mandato.data}</DtOfSgntr></MndtRltdInf></DrctDbtTx>` +
        `<DbtrAgt>${agente(x.debitore.bic)}</DbtrAgt><Dbtr><Nm>${xml(testoSepa(x.debitore.nome, 70))}</Nm></Dbtr><DbtrAcct><Id><IBAN>${pulisciIban(x.debitore.iban)}</IBAN></Id></DbtrAcct>` +
        `<RmtInf><Ustrd>${xml(testoSepa(x.causale, 140))}</Ustrd></RmtInf></DrctDbtTxInf>`).join('') + '</PmtInf>';
  });
  const testo = '<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<CstmrDrctDbtInitn><GrpHdr><MsgId>${msg}</MsgId><CreDtTm>${quando(adesso)}</CreDtTm><NbOfTxs>${incassi.length}</NbOfTxs><CtrlSum>${importo(tot)}</CtrlSum>` +
    `<InitgPty><Nm>${xml(testoSepa(az.ragione_sociale, 70))}</Nm></InitgPty></GrpHdr>${blocchi.join('')}</CstmrDrctDbtInitn></Document>\n`;
  return { testo, totale: tot, numero: incassi.length, id: msg };
}

// Bonifici SEPA, pain.001.001.03 (EPC132-08 Implementation Guidelines). Un PmtInf per data di esecuzione.
//   az: { ragione_sociale, iban, bic? }; bonifici: [{ importo, data, beneficiario: { nome, iban, bic? }, e2e, causale }]
export function pain001({ az, bonifici, adesso = new Date() }) {
  const errori = [];
  if (!pulisciIban(az.iban) || ibanValido(pulisciIban(az.iban)).errore) errori.push({ chiave: 'iban-azienda' });
  bonifici.forEach((x, i) => {
    if (ibanValido(pulisciIban(x.beneficiario.iban)).errore) errori.push({ chiave: 'iban-beneficiario', nome: x.beneficiario.nome, n: i + 1 });
    if (!(x.importo > 0)) errori.push({ chiave: 'importo', nome: x.beneficiario.nome, n: i + 1 });
  });
  if (errori.length) return { errori };
  const perData = new Map(); for (const x of bonifici) (perData.get(x.data) || perData.set(x.data, []).get(x.data)).push(x);
  const tot = bonifici.reduce((s, x) => s + x.importo, 0), msg = idMsg('LUMI-SCT', adesso);
  let k = 0;
  const blocchi = [...perData.entries()].sort().map(([data, l]) => {
    const sub = l.reduce((s, x) => s + x.importo, 0);
    return `<PmtInf><PmtInfId>${xml(`${msg}-${++k}`)}</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>${l.length}</NbOfTxs><CtrlSum>${importo(sub)}</CtrlSum>` +
      `<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>${data}</ReqdExctnDt>` +
      `<Dbtr><Nm>${xml(testoSepa(az.ragione_sociale, 70))}</Nm></Dbtr><DbtrAcct><Id><IBAN>${pulisciIban(az.iban)}</IBAN></Id></DbtrAcct><DbtrAgt>${agente(az.bic)}</DbtrAgt><ChrgBr>SLEV</ChrgBr>` +
      l.map(x => `<CdtTrfTxInf><PmtId><EndToEndId>${xml(testoSepa(x.e2e, 35) || 'NOTPROVIDED')}</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${importo(x.importo)}</InstdAmt></Amt>` +
        (x.beneficiario.bic ? `<CdtrAgt>${agente(x.beneficiario.bic)}</CdtrAgt>` : '') +
        `<Cdtr><Nm>${xml(testoSepa(x.beneficiario.nome, 70))}</Nm></Cdtr><CdtrAcct><Id><IBAN>${pulisciIban(x.beneficiario.iban)}</IBAN></Id></CdtrAcct>` +
        `<RmtInf><Ustrd>${xml(testoSepa(x.causale, 140))}</Ustrd></RmtInf></CdtTrfTxInf>`).join('') + '</PmtInf>';
  });
  const testo = '<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<CstmrCdtTrfInitn><GrpHdr><MsgId>${msg}</MsgId><CreDtTm>${quando(adesso)}</CreDtTm><NbOfTxs>${bonifici.length}</NbOfTxs><CtrlSum>${importo(tot)}</CtrlSum>` +
    `<InitgPty><Nm>${xml(testoSepa(az.ragione_sociale, 70))}</Nm></InitgPty></GrpHdr>${blocchi.join('')}</CstmrCdtTrfInitn></Document>\n`;
  return { testo, totale: tot, numero: bonifici.length, id: msg };
}

// ---------- un lettore XML piccolo (elementi, attributi, testo; i prefissi dei namespace si tolgono) ----------
export function albero(testo) {
  const s = String(testo).replace(/^﻿/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const radice = { nome: '#', attr: {}, figli: [], testo: '' }, pila = [radice];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const cima = pila.at(-1);
    if (m[1] != null) { cima.testo += m[1]; continue; }
    if (m[6] != null) { cima.testo += deXml(m[6]); continue; }
    const nome = m[3].replace(/^.*:/, '');
    if (m[2]) { if (pila.length > 1 && cima.nome === nome) pila.pop(); else throw new Error(`XML non valido: </${nome}> inatteso`); continue; }
    const attr = {}; for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attr[a[1].replace(/^.*:/, '')] = deXml(a[2] ?? a[3]);
    const n = { nome, attr, figli: [], testo: '' }; cima.figli.push(n);
    if (!m[5]) pila.push(n);
    if (pila.length > 64) throw new Error('XML troppo annidato');
  }
  if (pila.length !== 1) throw new Error('XML non valido: elementi non chiusi');
  return radice;
}
export const figlio = (n, percorso) => { let x = n; for (const p of percorso.split('/')) { x = x?.figli.find(f => f.nome === p); if (!x) return null; } return x; };
export const testoDi = (n, percorso) => (figlio(n, percorso)?.testo ?? '').trim();
export const figli = (n, nome) => n?.figli.filter(f => f.nome === nome) || [];
export function cerca(n, nome, out = []) { for (const f of n.figli) { if (f.nome === nome) out.push(f); else cerca(f, nome, out); } return out; }

// ---------- estratto conto CAMT.053 ----------
// BkToCstmrStmt/Stmt: Acct/Id/IBAN, Bal (OPBD/CLBD), Ntry: Amt@Ccy, CdtDbtInd (CRDT entrata, DBIT uscita), RvslInd (storno),
// BookgDt, ValDt, AcctSvcrRef, NtryDtls/TxDtls: Refs/EndToEndId, RltdPties (Dbtr/Cdtr, anche con Pty dalla versione .08), RmtInf/Ustrd
export function camt053(testo) {
  const doc = albero(testo), stmts = cerca(doc, 'Stmt');
  if (!stmts.length) throw new Error('Non è un estratto conto CAMT.053 (manca BkToCstmrStmt/Stmt)');
  const movimenti = [], saldi = [];
  const data = n => (testoDi(n, 'Dt') || testoDi(n, 'DtTm')).slice(0, 10);
  const centesimi = s => Math.round(Number(String(s).replace(',', '.')) * 100);
  for (const st of stmts) {
    const conto = testoDi(st, 'Acct/Id/IBAN') || testoDi(st, 'Acct/Id/Othr/Id');
    for (const b of figli(st, 'Bal')) {
      const tipo = testoDi(b, 'Tp/CdOrPrtry/Cd'), segno = testoDi(b, 'CdtDbtInd') === 'DBIT' ? -1 : 1;
      saldi.push({ conto, tipo, data: data(figlio(b, 'Dt') || b), importo: segno * centesimi(testoDi(b, 'Amt')) });
    }
    for (const e of figli(st, 'Ntry')) {
      const sts = testoDi(e, 'Sts') || testoDi(e, 'Sts/Cd');
      if (sts && sts !== 'BOOK') continue;   // solo i movimenti contabilizzati
      // il segno è quello di CdtDbtInd anche per gli storni (RvslInd): ISO 20022 dice che CRDT + storno è un addebito
      // annullato, cioè soldi che rientrano; i saldi del file tornano solo così
      const segno = testoDi(e, 'CdtDbtInd') === 'DBIT' ? -1 : 1;
      const tx = cerca(e, 'TxDtls')[0], entrata = segno > 0;
      const parte = tx ? figlio(tx, `RltdPties/${entrata ? 'Dbtr' : 'Cdtr'}`) : null;
      const nome = parte ? testoDi(parte, 'Nm') || testoDi(parte, 'Pty/Nm') : '';
      const iban = tx ? testoDi(tx, `RltdPties/${entrata ? 'DbtrAcct' : 'CdtrAcct'}/Id/IBAN`) : '';
      const ustrd = tx ? cerca(tx, 'Ustrd').map(x => x.testo.trim()) : [];
      const strd = tx ? testoDi(tx, 'RmtInf/Strd/CdtrRefInf/Ref') : '';
      const descr = [...ustrd, strd, testoDi(e, 'AddtlNtryInf'), tx ? testoDi(tx, 'AddtlTxInf') : ''].filter(Boolean).join(' · ');
      const ref = (tx && (testoDi(tx, 'Refs/EndToEndId') || testoDi(tx, 'Refs/AcctSvcrRef'))) || '';
      movimenti.push({ data: data(figlio(e, 'BookgDt')), valuta_il: data(figlio(e, 'ValDt') || e) || null, importo: segno * centesimi(testoDi(e, 'Amt')),
        descrizione: descr.slice(0, 500), controparte: nome.slice(0, 140), iban: pulisciIban(iban), riferimento: ref === 'NOTPROVIDED' ? '' : ref.slice(0, 70), conto,
        id_esterno: testoDi(e, 'AcctSvcrRef') || testoDi(e, 'NtryRef') || '', fonte: 'camt053' });
    }
  }
  return { movimenti, saldi };
}

// ---------- rendicontazione CBI «RH» (movimenti di conto corrente, record di 120 caratteri) ----------
// Record 62 (movimento): 4-10 progressivo, 11-13 n. movimento, 14-19 data valuta GGMMAA, 20-25 data contabile GGMMAA,
// 26 segno C/D, 27-41 importo (con la virgola o in centesimi), 42-43 causale ABI, 62-77 riferimento banca, 87-120 descrizione.
// Record 63: 14-119 altra descrizione dello stesso movimento. Record 61/64: saldo iniziale e finale (segno a 42, importo 43-57).
// Le posizioni vengono dal tracciato CBI «RH»: da ricontrollare su un file vero della propria banca.
export function cbiRh(testo) {
  const righe = String(testo).split(/\r?\n/).filter(x => x.trim());
  if (!righe.some(x => x.slice(1, 3) === 'RH' || x.slice(1, 3) === '62')) throw new Error('Non è una rendicontazione CBI (mancano i record RH e 62)');
  const data = s => (/^\d{6}$/.test(s) ? `20${s.slice(4, 6)}-${s.slice(2, 4)}-${s.slice(0, 2)}` : null);
  const cifra = s => { const t = s.trim(); return t.includes(',') ? Math.round(Number(t.replace(/\./g, '').replace(',', '.')) * 100) : Number(t || 0); };
  const movimenti = [], saldi = [];
  for (const r of righe.map(x => x.padEnd(120))) {
    const tipo = r.slice(1, 3);
    if (tipo === '62') movimenti.push({ data: data(r.slice(19, 25)), valuta_il: data(r.slice(13, 19)), importo: (r[25] === 'D' ? -1 : 1) * cifra(r.slice(26, 41)), causale: r.slice(41, 43).trim(),
      riferimento: r.slice(61, 77).trim(), descrizione: r.slice(86, 120).trim(), controparte: '', iban: '', conto: '', id_esterno: `${r.slice(3, 13)}-${r.slice(19, 25)}`, fonte: 'cbi' });
    else if (tipo === '63' && movimenti.length) movimenti.at(-1).descrizione = `${movimenti.at(-1).descrizione} ${r.slice(13, 119).trim()}`.trim();
    else if (tipo === '61' || tipo === '64') saldi.push({ tipo: tipo === '61' ? 'OPBD' : 'CLBD', data: data(r.slice(35, 41)), importo: (r[41] === 'D' ? -1 : 1) * cifra(r.slice(42, 57)) });
  }
  return { movimenti: movimenti.filter(m => m.data), saldi };
}

// ---------- CSV o Excel della banca ----------
// le colonne si riconoscono dal nome, come le esportano le banche italiane e quelle online
const COLONNE = {
  data: ['data contabile', 'data operazione', 'data registrazione', 'data', 'booking date', 'date', 'completed date', 'started date'],
  valuta_il: ['data valuta', 'valuta', 'value date'],
  importo: ['importo', 'importo eur', 'importo (eur)', 'amount', 'movimento', 'importo euro'],
  dare: ['dare', 'addebiti', 'addebito', 'uscite', 'uscita', 'debit', 'debito'],
  avere: ['avere', 'accrediti', 'accredito', 'entrate', 'entrata', 'credit', 'credito'],
  descrizione: ['descrizione', 'descrizione operazione', 'causale', 'dettagli', 'description', 'descrizione estesa', 'operazione', 'motivo'],
  controparte: ['controparte', 'beneficiario', 'ordinante', 'counterparty', 'nome', 'payee'],
  iban: ['iban', 'iban controparte', 'conto controparte'],
  riferimento: ['riferimento', 'cro', 'trn', 'reference', 'id operazione', 'id'],
};
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
export function csvBanca(buf, nome = 'estratto.csv') {
  const { intestazioni, righe } = leggiTabella(buf, nome), h = intestazioni.map(norm), idx = {};
  for (const [campo, nomi] of Object.entries(COLONNE)) { const i = nomi.map(n => h.indexOf(n)).find(i => i >= 0); if (i != null && !Object.values(idx).includes(i)) idx[campo] = i; }
  if (idx.data == null || (idx.importo == null && idx.dare == null && idx.avere == null)) throw new Error('Nel file servono almeno le colonne della data e dell\'importo (oppure dare e avere)');
  const movimenti = [], scartate = [];
  righe.forEach((r, n) => {
    const d = dataIt(r[idx.data])?.data, v = idx.valuta_il != null ? dataIt(r[idx.valuta_il])?.data : null;
    let imp = idx.importo != null ? numeroIt(r[idx.importo]) : NaN;
    if (!Number.isFinite(imp)) { const a = numeroIt(r[idx.avere]), de = numeroIt(r[idx.dare]); imp = (Number.isFinite(a) ? Math.abs(a) : 0) - (Number.isFinite(de) ? Math.abs(de) : 0); }
    if (!d || !Number.isFinite(imp) || !imp) { scartate.push(n + 2); return; }
    const val = c => (idx[c] != null ? String(r[idx[c]] ?? '').trim() : '');
    movimenti.push({ data: d, valuta_il: v || null, importo: Math.round(imp * 100), descrizione: val('descrizione').slice(0, 500), controparte: val('controparte').slice(0, 140),
      iban: pulisciIban(val('iban')), riferimento: val('riferimento').slice(0, 70), conto: '', id_esterno: '', fonte: 'csv' });
  });
  return { movimenti, saldi: [], scartate };
}
// riconosce il formato dal contenuto
export function leggiEstratto(buf, nome = '') {
  const inizio = buf.subarray(0, 4000).toString('utf8');
  if (/<\?xml|<Document|BkToCstmrStmt/.test(inizio)) return camt053(buf.toString('utf8'));
  if (/^ ?(RH|61|62)/m.test(inizio) && inizio.split(/\r?\n/)[0].replace(/\r$/, '').length >= 100) return cbiRh(buf.toString('latin1'));
  return csvBanca(buf, nome);
}
