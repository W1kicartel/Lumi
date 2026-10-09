// Il tracking di un corriere sulle vendite, uguale per tutti: «Collega un tracking» a una vendita, «Dov'è il pacco» (anche
// per nome del cliente, per Lumi) e il giro che rilegge le spedizioni non ancora consegnate (al massimo 100 per giro).
// leggi(k, numero) → { stato, consegnato, dove, quando } oppure null se il corriere non lo conosce ancora.
import { venditaDa, venditaDiChi, segnaSpedizione } from './comune.js';

export function tracciamento({ corriere, leggi, pagina }) {
  async function stato(k, n) {
    const s = await leggi(k, n); if (!s) return null;
    const v = k.sincro.locale('vendite', n);
    if (v) segnaSpedizione(k, v, { corriere, tracking: n, stato: s.stato, url: pagina ? pagina(n) : '' });
    const aperte = new Set(k.stato.leggi('aperte') || []); if (s.consegnato) aperte.delete(n); else if (v) aperte.add(n); k.stato.scrivi('aperte', [...aperte]);
    return s;
  }
  return {
    stato,
    azioni: {
      collega: {
        nome: `Collega un tracking ${corriere}`, descrizione: `collega a una vendita un numero di spedizione ${corriere}: lo stato torna sulla vendita`, su: 'vendite', lumi: true, scrive: true,
        input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, tracking: { tipo: 'testo', nome: `Numero di spedizione ${corriere}` } },
        proponi: ({ vendita, tracking }, k) => { const v = venditaDa(k, vendita); return { titolo: `Tracking ${corriere}`, righe: [['Vendita', v.numero ?? v.id], ['Tracking', tracking]], avvisi: [] }; },
        async esegui({ vendita, tracking }, k) { const v = venditaDa(k, vendita), n = String(tracking).replace(/\s+/g, ''); k.sincro.collega('vendite', v.id, n); return { ok: true, tracking: n, ...(await stato(k, n) || { stato: 'non ancora in rete' }) }; },
      },
      dove: {
        nome: 'Dov\'è il pacco', descrizione: `lo stato della spedizione ${corriere} di una vendita, o dell'ultima di un cliente (per nome)`, su: 'vendite', lumi: true,
        input: { chi: { tipo: 'testo', nome: 'Numero della vendita o nome del cliente' } },
        async esegui({ chi }, k) {
          const { vendita, remoto } = venditaDiChi(k, chi); if (!remoto) throw new Error(`Questa vendita non ha un tracking ${corriere}`);
          const s = await stato(k, remoto); if (!s) throw new Error(`${corriere} non conosce ancora ${remoto}`);
          return { vendita: vendita.numero ?? vendita.id, tracking: remoto, ...s };
        },
      },
    },
    pianificati: { stati: { nome: 'Stato delle spedizioni', ogni: '2h', async giro(k) {
      const conti = { lette: 0, consegnate: 0 };
      for (const n of (k.stato.leggi('aperte') || []).slice(0, 100)) { const s = await stato(k, n); if (!s) continue; conti.lette++; if (s.consegnato) conti.consegnate++; }
      return conti;
    } } },
  };
}
