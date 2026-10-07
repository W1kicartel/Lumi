// I conti di un documento: totale di ogni riga, riepilogo IVA per aliquota e natura, ritenuta, bollo, totali.
// Si conta in centesimi interi, così 0,1 + 0,2 fa 0,30 e non 0,30000000000000004. L'imposta si calcola una volta sola per
// gruppo (aliquota, natura), come vuole la FatturaPA, e non riga per riga. Con «prezziIvati» (vendite al banco) i prezzi
// comprendono l'IVA e l'imponibile si ricava per scorporo, sempre per gruppo.

// arrotondamento commerciale (metà per eccesso, lontano dallo zero) di un numero che deve diventare intero
export const intero = x => { const y = Number((+x).toPrecision(12)); return Math.sign(y) * Math.round(Math.abs(y)); };
export const cent = euro => intero(Number(euro || 0) * 100);
export const euro = c => c / 100;
const num = (x, d = 0) => { const n = typeof x === 'number' ? x : Number(String(x ?? '').replace(',', '.')); return Number.isFinite(n) && String(x ?? '').trim() !== '' ? n : d; };

// linee: [{ descrizione, quantita, prezzo (euro), sconto (%), aliquota (%), natura }]
export function totali(linee, { prezziIvati = false, ritenuta = 0, bollo = false } = {}) {
  const out = [], gruppi = new Map();
  linee.forEach((l, i) => {
    const quantita = num(l.quantita, 1), prezzo = cent(l.prezzo), sconto = num(l.sconto), aliquota = num(l.aliquota);
    const natura = aliquota ? null : (l.natura || null);
    const totale = intero(prezzo * quantita * (1 - sconto / 100));
    out.push({ ...l, n: i + 1, quantita, prezzo: euro(prezzo), sconto, aliquota, natura, totale: euro(totale) });
    const k = `${aliquota}|${natura || ''}`;
    if (!gruppi.has(k)) gruppi.set(k, { aliquota, natura, lordo: 0 });
    gruppi.get(k).lordo += totale;
  });
  const riepilogo = [...gruppi.values()].sort((a, b) => b.aliquota - a.aliquota || String(a.natura).localeCompare(String(b.natura))).map(g => {
    const imponibile = prezziIvati ? intero(g.lordo / (1 + g.aliquota / 100)) : g.lordo;
    const imposta = prezziIvati ? g.lordo - imponibile : intero(imponibile * g.aliquota / 100);
    return { aliquota: g.aliquota, natura: g.natura, imponibile: euro(imponibile), imposta: euro(imposta) };
  });
  const imponibile = riepilogo.reduce((s, g) => s + cent(g.imponibile), 0), imposta = riepilogo.reduce((s, g) => s + cent(g.imposta), 0);
  const rit = num(ritenuta) ? intero(imponibile * num(ritenuta) / 100) : 0;
  const esenti = riepilogo.filter(g => !g.aliquota).reduce((s, g) => s + cent(g.imponibile), 0);
  return {
    linee: out, riepilogo, imponibile: euro(imponibile), imposta: euro(imposta), totale: euro(imponibile + imposta),
    ritenuta: euro(rit), netto: euro(imponibile + imposta - rit), esenti: euro(esenti),
    bollo: bollo ? 2 : 0, serveBollo: esenti > 7747,   // bollo da 2 € sopra 77,47 € di operazioni senza IVA
  };
}

export const NATURE = {
  'N1': 'Escluse ex art. 15 DPR 633/72', 'N2.1': 'Non soggette ad IVA ai sensi degli artt. da 7 a 7-septies DPR 633/72',
  'N2.2': 'Non soggette - altri casi', 'N3.1': 'Non imponibili - esportazioni', 'N3.2': 'Non imponibili - cessioni intracomunitarie',
  'N3.3': 'Non imponibili - cessioni verso San Marino', 'N3.4': 'Non imponibili - operazioni assimilate alle cessioni all\'esportazione',
  'N3.5': 'Non imponibili - a seguito di dichiarazioni d\'intento', 'N3.6': 'Non imponibili - altre operazioni', 'N4': 'Esenti art. 10 DPR 633/72',
  'N5': 'Regime del margine / IVA non esposta in fattura', 'N6.1': 'Inversione contabile - cessione di rottami', 'N6.2': 'Inversione contabile - cessione di oro e argento',
  'N6.3': 'Inversione contabile - subappalto nel settore edile', 'N6.4': 'Inversione contabile - cessione di fabbricati', 'N6.5': 'Inversione contabile - cessione di telefoni cellulari',
  'N6.6': 'Inversione contabile - cessione di prodotti elettronici', 'N6.7': 'Inversione contabile - prestazioni comparto edile', 'N6.8': 'Inversione contabile - settore energetico',
  'N6.9': 'Inversione contabile - altri casi', 'N7': 'IVA assolta in altro stato UE',
};
// nel regime forfettario (RF19) le righe senza IVA sono N2.2 con questa dicitura
export const DICITURA_FORFETTARIO = 'Operazione in franchigia da IVA ai sensi dell\'art. 1, commi 54-89, L. 190/2014';
