// Le regole che tengono in ordine le fatture emesse (le usa documenti.js nel suo ascoltatore delle scritture):
//   - una fattura emessa è bloccata: da lì in poi cambiano solo lo stato del pagamento o dell'invio, la data del pagamento,
//     le note interne e le rate segnate come pagate. Si corregge con una nota di credito (TD04) o di debito (TD05).
//     Vale per l'interfaccia, per le API e per Lumi, perché il blocco sta nel motore dei dati e non nei bottoni;
//   - una fattura emessa non si elimina: lascerebbe un buco nella numerazione;
//   - buchiNumerazione() trova i numeri che mancano in una serie e in un anno (per esempio fatture riportate a mano).
// Il modulo non registra rotte.

// i campi che si possono cambiare dopo l'emissione; i campi «si calcola da solo» li riscrive il server
export const MODIFICABILI = new Set(['stato', 'pagata_il', 'note_interne', 'inviata_il', 'nome_documento', 'scaduta']);
export const DERIVATI = new Set(['imposta', 'importo_ritenuta', 'contributo_cassa']);
const META = new Set(['id', 'creato', 'modificato', 'creato_da', 'modificato_da', 'archiviato']);

export const bloccata = f => !!f && !!f.stato && f.stato !== 'bozza' && !!f.numero;

// i campi cambiati che il blocco non permette. defDi(id) dà la definizione di un'entità (per le righe figlie)
export function cambiVietati(def, prima, dopo, defDi) {
  const vietati = [];
  for (const c of def.campi) {
    if (c.archiviato || META.has(c.id) || MODIFICABILI.has(c.id) || DERIVATI.has(c.id) || c.tipo === 'calcolato') continue;
    let a = prima?.[c.id], b = dopo?.[c.id];
    if (c.tipo === 'righe') {
      const figlia = defDi(c.entita); if (!figlia) continue;
      // delle righe contano i valori scritti, non i calcolati; nelle rate si può segnare «pagata»
      const pulisci = l => (l || []).map(r => Object.fromEntries(figlia.campi.filter(x => !x.archiviato && x.tipo !== 'calcolato' && x.id !== c.campo && !META.has(x.id) && !(c.id === 'rate' && x.id === 'pagata'))
        .map(x => [x.id, norm(r[x.id])])));
      a = pulisci(a); b = pulisci(b);
    } else { a = norm(a); b = norm(b); }
    if (JSON.stringify(a) !== JSON.stringify(b)) vietati.push(c.id);
  }
  return vietati;
}
// una relazione si confronta per id; vuoto, null e assente sono la stessa cosa
const norm = v => (v && typeof v === 'object' && !Array.isArray(v) && 'id' in v ? v.id : v === '' || v === undefined ? null : v);

// i numeri che mancano fra 1 e il più alto, per serie e anno: [{ serie, anno, mancano: [3, 7], ultimo }]
export function buchiNumerazione(righe) {
  const gruppi = new Map();
  for (const r of righe) {
    const n = parseInt(String(r.numero ?? '').split('/')[0], 10); if (!Number.isFinite(n) || n < 1) continue;
    const k = `${r.serie || ''}|${String(r.data || '').slice(0, 4)}`;
    if (!gruppi.has(k)) gruppi.set(k, new Set()); gruppi.get(k).add(n);
  }
  return [...gruppi.entries()].map(([k, s]) => {
    const [serie, anno] = k.split('|'), ultimo = Math.max(...s), mancano = [];
    for (let i = 1; i <= ultimo && mancano.length < 100; i++) if (!s.has(i)) mancano.push(i);
    return { serie, anno, ultimo, emesse: s.size, mancano };
  }).sort((a, b) => b.anno.localeCompare(a.anno) || a.serie.localeCompare(b.serie));
}

// il bollo virtuale per trimestre: quante fatture lo hanno e quanto versare. Scadenze e codici tributo: Agenzia delle Entrate,
// «L'imposta di bollo sulle fatture elettroniche», guida di gennaio 2024 (tabella delle scadenze e codici tributo F24
// 2521-2524). Se il 1° trimestre non supera 5.000 € si può versare entro il 30 settembre; se 1° + 2° non superano 5.000 €,
// entro il 30 novembre (art. 17 DL 124/2019 come modificato dal DL 73/2022). Le date che cadono di festa slittano al giorno dopo.
export const TRIBUTI_BOLLO = { 1: '2521', 2: '2522', 3: '2523', 4: '2524' };
const SCADENZE_BOLLO = { 1: '05-31', 2: '09-30', 3: '11-30', 4: '02-28' };
const SOGLIA_RINVIO = 500000;   // centesimi: 5.000 €
export function bolloTrimestri(fatture, anno) {
  const t = [1, 2, 3, 4].map(q => ({ trimestre: q, fatture: 0, importo: 0, tributo: TRIBUTI_BOLLO[q], scadenza: q === 4 ? `${Number(anno) + 1}-${bisestile(Number(anno) + 1) ? '02-29' : '02-28'}` : `${anno}-${SCADENZE_BOLLO[q]}` }));
  for (const f of fatture) {
    if (!f.bollo || !bloccata(f) || f.stato === 'annullata' || String(f.data || '').slice(0, 4) !== String(anno)) continue;
    const q = Math.floor((Number(String(f.data).slice(5, 7)) - 1) / 3); t[q].fatture++; t[q].importo += 200;   // 2 € a fattura
  }
  // i rinvii per gli importi piccoli
  if (t[0].importo && t[0].importo <= SOGLIA_RINVIO) t[0].scadenza = `${anno}-09-30`;
  if (t[0].importo + t[1].importo && t[0].importo + t[1].importo <= SOGLIA_RINVIO) { if (t[0].importo) t[0].scadenza = `${anno}-11-30`; if (t[1].importo) t[1].scadenza = `${anno}-11-30`; }
  return t.map(x => ({ ...x, importo: x.importo / 100 }));
}
const bisestile = a => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
