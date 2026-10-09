// Le regole della tesoreria, senza database: termini di pagamento → rate, abbinamento dei movimenti di banca alle scadenze,
// livelli dei solleciti, previsione di cassa. Gli importi sono in centesimi interi; le date in ISO (AAAA-MM-GG).
const iso = d => d.toISOString().slice(0, 10);
const daIso = s => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
export const giorni = (a, b) => Math.round((daIso(b) - daIso(a)) / 864e5);
export const piuGiorni = (s, n) => { const d = daIso(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const fineMese = s => { const d = daIso(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
export const piuMesi = (s, n) => {
  const d = daIso(s), g = d.getUTCDate(), x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  x.setUTCDate(Math.min(g, new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate())); return iso(x);
};

// ---------- termini di pagamento ----------
// Si scrivono come nei gestionali italiani: «RD» (rimessa diretta), «30 DF», «30/60/90 DFFM», «60 DFFM+10».
//   DF = data fattura; FM = fine mese; «+10» = giorno fisso del mese dopo la fine mese (pagamenti «al 10»).
// I giorni multipli di 30 contano come mesi commerciali (30 gg dal 15/01 = 15/02, non 14/02), come fanno Danea Easyfatt e
// TeamSystem; gli altri sono giorni di calendario. Con FM si va alla fine di quel mese: 30 DFFM dal 15/01 = 28/02.
export const TERMINI_COMUNI = ['RD', '30 DF', '60 DF', '30 DFFM', '60 DFFM', '90 DFFM', '120 DFFM', '30/60 DFFM', '30/60/90 DFFM', '60/90/120 DFFM', '30 DFFM+10', '60 DFFM+10'];
export function leggiTermini(s) {
  // come si scrivono davvero: «Ri.Ba. 30/60 gg fine mese», «Bonifico 30 gg data fattura», «60 dffm al 10» (senza questo
  // sarebbero illeggibili e la scadenza cadrebbe sulla data della fattura, con solleciti per fatture non ancora scadute)
  const t = String(s || '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/^(RI\.?\s?BA\.?|RIBA|RB|BONIFICO( BANCARIO)?|BB|RID|SDD|MAV)\s+(?=\d)/, '')
    .replace(/FINE\s*MESE/g, 'FM').replace(/DATA\s*FATTURA/g, 'DF').replace(/\s+AL\s+(\d{1,2})$/, ' +$1');
  if (!t || /^(RD|R\.?D\.?|VISTA|A VISTA|RIMESSA DIRETTA|0)$/.test(t)) return { giorni: [0], fineMese: false, giornoFisso: null, testo: 'RD' };
  const m = t.match(/^(\d{1,3}(?:\s*[/\-,]\s*\d{1,3}){0,11})\s*(?:GG\.?\s*)?(D\.?F\.?)?\s*(F\.?M\.?)?\s*(?:\+\s*(\d{1,2}))?$/);
  if (!m) return null;
  const g = m[1].split(/\s*[/\-,]\s*/).map(Number);
  if (g.some(x => x < 0 || x > 365) || g.some((x, i) => i && x <= g[i - 1])) return null;
  const fisso = m[4] ? Number(m[4]) : null;
  if (fisso != null && (fisso < 1 || fisso > 31)) return null;
  return { giorni: g, fineMese: !!m[3] || fisso != null, giornoFisso: fisso, testo: `${g.join('/')} DF${m[3] || fisso != null ? 'FM' : ''}${fisso != null ? '+' + fisso : ''}` };
}
export function dataRata(dataFattura, gg, { fineMese: fm = false, giornoFisso = null } = {}) {
  let d = gg % 30 === 0 ? piuMesi(dataFattura, gg / 30) : piuGiorni(dataFattura, gg);
  if (fm) d = fineMese(d);
  if (giornoFisso) { const x = daIso(d); d = iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, Math.min(giornoFisso, new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 2, 0)).getUTCDate())))); }
  return d;
}
// le rate di un importo (centesimi): parti uguali, l'arrotondamento sull'ultima
export function rate(dataFattura, totale, termini) {
  const t = typeof termini === 'string' ? leggiTermini(termini) : termini;
  if (!t) throw new Error(`Termini di pagamento non validi: «${termini}» (esempi: RD, 30 DF, 30/60/90 DFFM, 60 DFFM+10)`);
  const n = t.giorni.length, parte = Math.trunc(totale / n);
  return t.giorni.map((g, i) => ({ n: i + 1, data: dataRata(dataFattura, g, t), importo: i === n - 1 ? totale - parte * (n - 1) : parte }));
}

// ---------- abbinamento movimenti ↔ scadenze ----------
const piano = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const FORME = new Set(['srl', 'spa', 'snc', 'sas', 'srls', 'soc', 'societa', 'coop', 'di', 'e', 'del', 'della', 'the', 'ltd', 'gmbh', 'sa', 'sl', 'sarl']);
const parole = s => piano(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(p => p.length > 2 && !FORME.has(p));
// il numero della fattura scritto nella causale: «FT 12/2026», «fatt. n.12», «saldo fattura 12»; non basta la cifra dentro un'altra
export function citaNumero(testo, numero) {
  const n = String(numero || '').trim(); if (!n) return false;
  const base = n.split('/')[0].replace(/^0+/, '');
  if (!base) return false;
  const t = ' ' + piano(testo).replace(/\s+/g, ' ') + ' ';
  if (t.includes(piano(n)) && n.length >= 3) return true;
  return new RegExp(`(fatt\\w*|ft|fat|fattura|fatture|doc|n\\.?|nr\\.?|num\\.?)\\s*(n\\.?|nr\\.?|num\\.?)?\\s*0*${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`).test(t);
}
// quanto un movimento somiglia a una scadenza (0-100) e perché: importo, numero di fattura, nome o IBAN della controparte, data
export function punteggio(mov, sc) {
  const perche = []; let p = 0;
  const imp = Math.abs(mov.importo), res = sc.residuo;
  if (imp === res) { p += 50; perche.push('importo'); }
  else if (res && Math.abs(imp - res) <= Math.max(200, res * 0.01)) { p += 25; perche.push('importo-vicino'); }
  else if (imp < res) { p += 5; perche.push('acconto'); }
  const testo = `${mov.descrizione || ''} ${mov.riferimento || ''}`;
  if (sc.numero && citaNumero(testo, sc.numero)) { p += 30; perche.push('numero'); }
  if (mov.iban && sc.iban && mov.iban.replace(/\s/g, '').toUpperCase() === sc.iban.replace(/\s/g, '').toUpperCase()) { p += 30; perche.push('iban'); }
  else {
    const pc = parole(sc.controparte), pm = new Set(parole(`${mov.controparte || ''} ${mov.descrizione || ''}`));
    const comuni = pc.filter(x => pm.has(x)).length;
    if (pc.length && comuni) { p += comuni >= Math.min(2, pc.length) ? 20 : 10; perche.push('nome'); }
  }
  if (sc.data && mov.data) { const g = Math.abs(giorni(sc.data, mov.data)); if (g <= 10) { p += 10; perche.push('data'); } else if (g <= 45) p += 4; }
  return { punti: Math.min(100, p), perche };
}
// più scadenze della stessa controparte che insieme fanno l'importo (un bonifico che paga tre fatture): al massimo 14 candidate
export function combinazione(importo, scadenze) {
  const l = scadenze.filter(s => s.residuo > 0 && s.residuo <= importo).slice(0, 14);
  let migliore = null;
  for (let m = 1; m < 1 << l.length; m++) {
    let somma = 0, n = 0; for (let i = 0; i < l.length; i++) if (m & (1 << i)) { somma += l[i].residuo; n++; }
    if (somma === importo && n > 1 && (!migliore || n < migliore.length)) migliore = l.filter((_, i) => m & (1 << i));
  }
  return migliore;
}
// le proposte per un movimento: le scadenze aperte dello stesso verso, le migliori prima; poi le combinazioni e le distinte
export function proposte(mov, scadenze, distinte = [], { quante = 5 } = {}) {
  const verso = mov.importo >= 0 ? 'attiva' : 'passiva', imp = Math.abs(mov.importo);
  // le scadenze in una distinta non ancora accreditata le paga la banca tutte insieme: si propongono con la distinta
  const aperte = scadenze.filter(s => s.verso === verso && s.residuo > 0 && !(s.distinta && !s.distinta.incassata));
  const out = aperte.map(s => ({ chiavi: [s.chiave], ...punteggio(mov, s), importo: s.residuo, descrizione: s.descrizione, controparte: s.controparte }))
    .filter(x => x.punti >= 30).sort((a, b) => b.punti - a.punti).slice(0, quante);
  // per controparte: le fatture che insieme fanno l'importo
  const perControparte = new Map();
  for (const s of aperte) { const k = s.controparteId || s.controparte; if (k) (perControparte.get(k) || perControparte.set(k, []).get(k)).push(s); }
  for (const l of perControparte.values()) {
    const c = combinazione(imp, l.sort((a, b) => a.data.localeCompare(b.data))); if (!c) continue;
    const nome = parole(c[0].controparte), testo = new Set(parole(`${mov.controparte || ''} ${mov.descrizione || ''}`));
    const punti = 60 + (nome.some(x => testo.has(x)) ? 25 : 0) + (c.some(s => citaNumero(`${mov.descrizione} ${mov.riferimento || ''}`, s.numero)) ? 10 : 0);
    out.push({ chiavi: c.map(s => s.chiave), punti: Math.min(100, punti), perche: ['somma', ...(punti > 60 ? ['nome'] : [])], importo: imp, descrizione: c.map(s => s.descrizione).join(' + '), controparte: c[0].controparte });
  }
  // una distinta Ri.Ba. o SDD presentata torna come un solo accredito per il suo totale
  if (verso === 'attiva') for (const d of distinte) if (d.totale === imp && d.aperte.length) out.push({ chiavi: d.aperte, distinta: d.id, punti: 90, perche: ['distinta'], importo: imp, descrizione: d.nome, controparte: '' });
  return out.sort((a, b) => b.punti - a.punti).slice(0, quante);
}

// ---------- solleciti ----------
// il livello dipende dai giorni di ritardo e dai solleciti già mandati: 1 cortese (dopo 7 giorni), 2 fermo (dopo 30 o dopo un
// primo sollecito di almeno 15 giorni fa), 3 diffida (dopo 60 o dopo un secondo sollecito di almeno 15 giorni fa)
export function livelloSollecito(ritardo, mandati = [], oggi) {
  const ultimo = mandati.at(-1), dopo = ultimo ? giorni(ultimo.data, oggi) : Infinity;
  if (ritardo < 7) return 0;
  if (ultimo && dopo < 15) return -1;   // già sollecitato da poco
  const giaFatto = mandati.reduce((m, x) => Math.max(m, x.livello), 0);
  const perTempo = ritardo >= 60 ? 3 : ritardo >= 30 ? 2 : 1;
  return Math.min(3, Math.max(perTempo, giaFatto + 1));
}
// 1234567 → «12.345,67» (sempre con il punto delle migliaia: Intl in italiano non lo mette sotto 10.000)
const fmt = c => { const [i, d] = (Math.abs(c) / 100).toFixed(2).split('.'); return `${c < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`; };
const dataIt = s => s.split('-').reverse().join('/');
// la lettera (in italiano, la lingua dei documenti): al cliente si scrive nella lingua delle fatture
export function testoSollecito({ livello, cliente, azienda, scadenze, iban, oggi }) {
  const tot = scadenze.reduce((s, x) => s + x.residuo, 0);
  const elenco = scadenze.map(s => `- ${s.descrizione}, scaduta il ${dataIt(s.data)}: € ${fmt(s.residuo)}`).join('\n');
  const apertura = { 1: `Gentile ${cliente},\n\nda un controllo della nostra contabilità risultano ancora aperti questi pagamenti. Sarà sicuramente una svista:`,
    2: `Gentile ${cliente},\n\nnonostante il nostro precedente promemoria, risultano ancora da saldare:`,
    3: `Spett.le ${cliente},\n\ncon la presente vi invitiamo formalmente a saldare entro 15 giorni dal ricevimento le seguenti somme, ormai scadute da tempo:` }[livello];
  const chiusura = { 1: 'Se avete già provveduto, non tenete conto di questo messaggio.', 2: 'Vi chiediamo di provvedere entro 10 giorni, oppure di contattarci per concordare il pagamento.',
    3: 'Trascorso inutilmente il termine, ci riserveremo di tutelare i nostri diritti nelle sedi opportune, con addebito di interessi di mora (D.Lgs. 231/2002) e spese.' }[livello];
  return `${apertura}\n\n${elenco}\n\nTotale: € ${fmt(tot)}${iban ? `\nIBAN per il bonifico: ${iban}` : ''}\n\n${chiusura}\n\nCordiali saluti,\n${azienda}\n${dataIt(oggi)}`;
}

// ---------- previsione di cassa ----------
// voci: [{ data, importo (centesimi, + entrata / − uscita), tipo, descrizione }]; periodi settimanali (lunedì-domenica) o mensili.
// Le voci prima di «da» (scadute e non incassate) finiscono nel primo periodo: sono soldi attesi adesso.
export function previsione({ saldo = 0, da, periodi = 13, passo = 'settimana', voci = [] }) {
  const inizio = passo === 'mese' ? `${da.slice(0, 7)}-01` : piuGiorni(da, -((daIso(da).getUTCDay() + 6) % 7));
  const p = [];
  for (let i = 0; i < periodi; i++) {
    const a0 = passo === 'mese' ? piuMesi(inizio, i) : piuGiorni(inizio, i * 7), a1 = passo === 'mese' ? fineMese(a0) : piuGiorni(a0, 6);
    p.push({ da: a0, a: a1, entrate: 0, uscite: 0, saldo: 0, voci: 0 });
  }
  const fine = p.at(-1).a, fuori = [];
  for (const v of voci) {
    if (!v.importo) continue;
    if (v.data > fine) { fuori.push(v); continue; }
    const x = p.find(q => v.data <= q.a) || p[0];
    if (v.importo > 0) x.entrate += v.importo; else x.uscite -= v.importo;
    x.voci++;
  }
  let s = saldo, minimo = { saldo, data: da };
  for (const x of p) { s += x.entrate - x.uscite; x.saldo = s; if (s < minimo.saldo) minimo = { saldo: s, data: x.a }; }
  return { saldoIniziale: saldo, periodi: p, saldoFinale: s, minimo, scoperto: minimo.saldo < 0, oltre: fuori.length };
}
// le ripetizioni di una previsione manuale (affitto, stipendi): mensile, bimestrale, trimestrale, semestrale, annuale
const PASSI = { mensile: 1, bimestrale: 2, trimestrale: 3, semestrale: 6, annuale: 12 };
export function ripeti(data, ripetizione, fino, max = 200) {
  const n = PASSI[ripetizione]; if (!n) return [data];
  const out = []; for (let i = 0; i < max; i++) { const d = piuMesi(data, i * n); if (d > fino) break; out.push(d); }
  return out;
}
// il ritardo medio con cui un cliente paga (giorni dopo la scadenza, mai negativo), dalle scadenze già pagate con la data
export function ritardoMedio(pagate) {
  const l = pagate.filter(x => x.data && x.pagata_il).map(x => Math.max(0, giorni(x.data, x.pagata_il)));
  return l.length ? Math.round(l.reduce((s, x) => s + x, 0) / l.length) : 0;
}
