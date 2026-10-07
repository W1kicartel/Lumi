// Le rotte degli strumenti di Lumi che arrivano dai moduli (registro in lumi/registro.js, k.lumi). Rotte:
//   GET  /api/lumi/strumenti                          { strumenti: [{ nome, descrizione, schema, tipo }], istruzioni, sostituiti }:
//                                                     solo quelli che chi è collegato può usare
//   POST /api/lumi/strumenti/:nome { args }           un 'leggi': risponde subito
//   POST /api/lumi/strumenti/:nome/anteprima { args, lingua }
//                                                     uno 'scrivi': la scheda di conferma { titolo, righe, avvisi, gettone }
//   POST /api/lumi/strumenti/:nome/esegui { args, gettone }
//                                                     uno 'scrivi', dopo il Conferma: il gettone dell'anteprima degli stessi
//                                                     argomenti, usato una volta sola (niente esecuzioni senza scheda)
//   POST /api/lumi/scheda/:e { valori, id?, lingua }  righe e avvisi in più per la scheda dei crea_/modifica_ generati dallo schema
// Tutto con la sessione di chi chiede: ctx arriva a permesso, anteprima ed esegui, che lo passano a dati.js.
import { controllaArgomenti } from './lumi/registro.js';

export default function registra({ r, lumi, P, D, serve, ErroreHttp }) {
  if (!lumi) return;
  const strumento = (ctx, nome) => {
    const s = lumi.prendi(String(nome));
    if (!s) throw new ErroreHttp(404, `Strumento di Lumi sconosciuto «${nome}»`);
    let ok = false; try { ok = !s.permesso || !!s.permesso(ctx); } catch { ok = false; }
    if (!ok) throw new P.ErrorePermesso('Non puoi usare questo strumento di Lumi');
    return s;
  };
  const argomenti = (s, corpo) => {
    const args = corpo?.args && typeof corpo.args === 'object' && !Array.isArray(corpo.args) ? corpo.args : {};
    const e = controllaArgomenti(args, s.schema);
    if (e) throw new ErroreHttp(400, `Argomenti non validi per ${s.nome}: ${e}`);
    return args;
  };
  // gli errori dei dati e dei permessi passano con il loro stato; gli altri diventano leggibili (il modello li legge e corregge)
  const leggibile = e => { if (e?.stato || e instanceof D.ErroreDati || e instanceof P.ErrorePermesso || e?.name?.startsWith?.('Errore')) throw e; throw new ErroreHttp(422, String(e?.message || e)); };
  const comeOggetto = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : { risultato: x ?? null });

  r('GET', '/api/lumi/strumenti', ({ ctx }) => {
    const { istruzioni, sostituiti } = lumi.tutte();
    return { strumenti: lumi.visibili(serve(ctx)).map(s => ({ nome: s.nome, descrizione: s.descrizione, schema: s.schema, tipo: s.tipo })), istruzioni, sostituiti };
  });
  r('POST', '/api/lumi/strumenti/:nome', async ({ ctx, p, corpo }) => {
    const s = strumento(serve(ctx), p.nome);
    if (s.tipo !== 'leggi') throw new ErroreHttp(400, 'Questo strumento scrive: prima la scheda di conferma');
    const args = argomenti(s, corpo);
    try { return comeOggetto(await s.esegui({ ctx, args })); } catch (e) { leggibile(e); }
  });
  r('POST', '/api/lumi/strumenti/:nome/anteprima', async ({ ctx, p, corpo }) => {
    const s = strumento(serve(ctx), p.nome);
    if (s.tipo !== 'scrivi') throw new ErroreHttp(400, 'Questo strumento non ha una scheda di conferma');
    const args = argomenti(s, corpo);
    let a; try { a = comeOggetto(await s.anteprima({ ctx, args, lingua: corpo?.lingua || 'it' })); } catch (e) { leggibile(e); }
    if (a.errore) return { errore: String(a.errore) };
    return { titolo: String(a.titolo || s.nome), righe: (a.righe || []).map(x => [String(x?.[0] ?? ''), String(x?.[1] ?? '')]), avvisi: (a.avvisi || []).map(String),
      ...(a.nota ? { nota: String(a.nota) } : {}), gettone: lumi.gettone(ctx.utente.id, s.nome, args) };
  });
  r('POST', '/api/lumi/strumenti/:nome/esegui', async ({ ctx, p, corpo }) => {
    const s = strumento(serve(ctx), p.nome);
    if (s.tipo !== 'scrivi') throw new ErroreHttp(400, 'Questo strumento non ha una scheda di conferma');
    const args = argomenti(s, corpo);
    if (!lumi.usaGettone(ctx.utente.id, s.nome, args, corpo?.gettone)) throw new ErroreHttp(409, 'La conferma non corrisponde alla scheda: rifai la proposta');
    try { return comeOggetto(await s.esegui({ ctx, args })); } catch (e) { leggibile(e); }
  });
  r('POST', '/api/lumi/scheda/:e', async ({ ctx, p, corpo }) => {
    P.verifica(serve(ctx), p.e, 'leggi');
    const out = { righe: [], avvisi: [] };
    for (const f of lumi.schedeDi(p.e)) {
      let x; try { x = await f({ ctx, valori: corpo?.valori || {}, id: corpo?.id || null, lingua: corpo?.lingua || 'it' }); } catch (e) { leggibile(e); }
      if (x?.errore) return { errore: String(x.errore) };
      out.righe.push(...(x?.righe || []).map(y => [String(y?.[0] ?? ''), String(y?.[1] ?? '')])); out.avvisi.push(...(x?.avvisi || []).map(String));
    }
    return out;
  });
}
