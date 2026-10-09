// La registrazione della voce locale di Lumi (voce.js): un AudioWorklet che manda al thread della pagina i campioni del
// primo canale del microfono, a pezzi di 128, così come arrivano. Non produce suono: la sua uscita resta a zero.
class Cattura extends AudioWorkletProcessor {
  process(ingressi) {
    const c = ingressi[0]?.[0];
    if (c?.length) this.port.postMessage(c.slice(0));
    return true;
  }
}
registerProcessor('lumi-cattura', Cattura);
