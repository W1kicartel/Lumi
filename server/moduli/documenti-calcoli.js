// I conti di un documento: totale di ogni riga, riepilogo IVA per aliquota e natura, ritenuta, bollo, totali.
// Si conta in centesimi interi, così 0,1 + 0,2 fa 0,30 e non 0,30000000000000004. L'imposta si calcola una volta sola per
// gruppo (aliquota, natura), come vuole la FatturaPA, e non riga per riga. Con «prezziIvati» (vendite al banco) i prezzi
// comprendono l'IVA e l'imponibile si ricava per scorporo, sempre per gruppo.

// arrotondamento commerciale (metà per eccesso, lontano dallo zero) di un numero che deve diventare intero
export const intero = x => { const y = Number((+x).toPrecision(12)); return Math.sign(y) * Math.round(Math.abs(y)); };
export const cent = euro => intero(Number(euro || 0) * 100);
export const euro = c => c / 100;
const num = (x, d = 0) => { const n = typeof x === 'number' ? x : Number(String(x ?? '').replace(',', '.')); return Number.isFinite(n) && String(x ?? '').trim() !== '' ? n : d; };

// Le nature IVA per cui il bollo da 2 € è dovuto sopra 77,47 € (l'«Elenco B» con cui l'Agenzia integra il bollo non messo).
// Fonte: Agenzia delle Entrate, «L'imposta di bollo sulle fatture elettroniche», guida di gennaio 2024, criteri dell'Elenco B
// (N2.1, N2.2, N3.5, N3.6, N4); niente bollo su esportazioni e cessioni UE (N3.1-N3.4), reverse charge (N6.x), N7.
export const NATURE_BOLLO = ['N2.1', 'N2.2', 'N3.5', 'N3.6', 'N4'];
export const SOGLIA_BOLLO = 7747, IMPORTO_BOLLO = 2;   // centesimi; euro (art. 13 tariffa all. A DPR 642/72, guida AdE 2024)
// il prezzo unitario tiene fino a 8 decimali, come Amount8DecimalType della FatturaPA (0,125 € resta 0,125 €)
export const prezzo8 = x => Number(num(x).toFixed(8));
// una riga è soggetta a ritenuta se non lo dici tu (ritenuta: false) e non è una spesa anticipata esclusa art. 15 (N1)
export const soggettaRitenuta = l => l.ritenuta !== false && l.ritenuta !== 0 && !(!num(l.aliquota) && l.natura === 'N1') && !l.bollo;

// linee: [{ descrizione, quantita, prezzo (euro, fino a 8 decimali), sconto (%), sconto_importo (€ sul prezzo unitario),
//           aliquota (%), natura, ritenuta (false = esclusa) }]
// cassa: { tipo, aliquota (%), aliquotaIva, natura, ritenuta (si applica anche al contributo) } · bolloCliente: i 2 € in fattura
export function totali(linee, { prezziIvati = false, ritenuta = 0, bollo = false, bolloCliente = false, cassa = null, esigibilita = 'I' } = {}) {
  const out = [], gruppi = new Map();
  const gruppo = (aliquota, natura) => { const k = `${aliquota}|${natura || ''}`; if (!gruppi.has(k)) gruppi.set(k, { aliquota, natura, lordo: 0 }); return gruppi.get(k); };
  const tutte = bollo && bolloCliente ? [...linee, { descrizione: 'Imposta di bollo', quantita: 1, prezzo: IMPORTO_BOLLO, aliquota: 0, natura: 'N1', bollo: true }] : linee;
  let soggetto = 0, perCassa = 0, perBollo = 0;
  tutte.forEach((l, i) => {
    const quantita = num(l.quantita, 1), sconto = num(l.sconto), scontoImp = prezzo8(l.sconto_importo), aliquota = num(l.aliquota);
    const prezzo = prezziIvati ? euro(cent(l.prezzo)) : prezzo8(l.prezzo);
    const natura = aliquota ? null : (l.natura || null);
    // gli sconti si applicano a cascata sul prezzo unitario (prima la percentuale, poi l'importo), come li legge lo SDI (00423)
    const unitario = prezzo * (1 - sconto / 100) - scontoImp;
    const totale = intero(unitario * quantita * 100);
    out.push({ ...l, n: i + 1, quantita, prezzo, sconto, sconto_importo: scontoImp, aliquota, natura, totale: euro(totale), ritenuta: soggettaRitenuta(l) });
    gruppo(aliquota, natura).lordo += totale;
    if (soggettaRitenuta(l)) soggetto += totale;
    if (!l.bollo && !(natura === 'N1')) perCassa += totale;
    if (NATURE_BOLLO.includes(natura)) perBollo += totale;
  });
  // la cassa previdenziale: un contributo in percentuale sui compensi (non sulle spese N1), con la sua aliquota IVA
  let contributo = null;
  if (cassa && num(cassa.aliquota)) {
    const importo = intero(perCassa * num(cassa.aliquota) / 100), aliquota = num(cassa.aliquotaIva), natura = aliquota ? null : (cassa.natura || null);
    contributo = { tipo: cassa.tipo, aliquota: num(cassa.aliquota), imponibile: euro(perCassa), importo: euro(importo), aliquotaIva: aliquota, natura, ritenuta: !!cassa.ritenuta };
    gruppo(aliquota, natura).lordo += importo;
    if (cassa.ritenuta) soggetto += importo;
    // il contributo senza IVA conta per la soglia del bollo (forfettario: 75 € di compenso + 3 € di rivalsa INPS = 78 €, bollo dovuto)
    if (NATURE_BOLLO.includes(natura)) perBollo += importo;
  }
  const riepilogo = [...gruppi.values()].sort((a, b) => b.aliquota - a.aliquota || String(a.natura).localeCompare(String(b.natura))).map(g => {
    const imponibile = prezziIvati ? intero(g.lordo / (1 + g.aliquota / 100)) : g.lordo;
    const imposta = prezziIvati ? g.lordo - imponibile : intero(imponibile * g.aliquota / 100);
    return { aliquota: g.aliquota, natura: g.natura, imponibile: euro(imponibile), imposta: euro(imposta) };
  });
  const imponibile = riepilogo.reduce((s, g) => s + cent(g.imponibile), 0), imposta = riepilogo.reduce((s, g) => s + cent(g.imposta), 0);
  const rit = num(ritenuta) ? intero(soggetto * num(ritenuta) / 100) : 0;
  const esenti = riepilogo.filter(g => !g.aliquota).reduce((s, g) => s + cent(g.imponibile), 0);
  // con la scissione dei pagamenti (split payment, EsigibilitaIVA S) l'IVA la versa la PA: il cliente paga solo l'imponibile
  const daPagare = imponibile + imposta - rit - (esigibilita === 'S' ? imposta : 0);
  return {
    linee: out, riepilogo, imponibile: euro(imponibile), imposta: euro(imposta), totale: euro(imponibile + imposta),
    ritenuta: euro(rit), baseRitenuta: euro(soggetto), netto: euro(daPagare), esenti: euro(esenti), cassa: contributo,
    bollo: bollo ? IMPORTO_BOLLO : 0, serveBollo: perBollo > SOGLIA_BOLLO,
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
