// La voce di Lumi, in due direzioni.
// • Ascoltare: si tiene premuto ⌥ Spazio (Ctrl ⇧ Spazio su Windows e Linux) o si clicca il microfono. Con il server
//   che ha la chiave di Deepgram le parole compaiono mentre si parla (trascrizione in tempo reale, con un gettone di
//   60 secondi: la chiave non arriva mai nel browser); senza, dove il browser lo offre, si usa il riconoscimento vocale
//   del browser (Web Speech). Se non c'è nessuno dei due, il microfono si spegne e si scrive.
// • Parlare: le risposte, se chi usa Lumi lo chiede, si leggono ad alta voce con la sintesi del sistema, frase per frase.
//   Ogni frase passa da un filtro: in modalità schermo condiviso nomi, importi e telefoni non si dicono.

export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const TASTI = MAC ? '⌥ Spazio' : 'Ctrl ⇧ Spazio';
export const eTastoParla = e => (MAC ? e.altKey && e.code === 'Space' && !e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey && e.code === 'Space');

/* ---------- risposte a voce alta ---------- */
export function creaVoceAlta({ lingua = 'it-IT', filtro = s => s, attiva = () => false } = {}) {
  let buf = '';
  const ok = () => attiva() && typeof speechSynthesis !== 'undefined';
  const voce = () => {
    const tutte = speechSynthesis.getVoices() || [], l = lingua.slice(0, 2);
    return tutte.find(v => v.lang?.startsWith(l) && /premium|enhanced|natural|neural/i.test(v.name)) || tutte.find(v => v.lang?.startsWith(l));
  };
  const di = t => {
    t = filtro(String(t).replace(/\*\*/g, '').trim()); if (!t) return;
    const u = new SpeechSynthesisUtterance(t); u.lang = lingua; const v = voce(); if (v) u.voice = v; u.rate = 1.04;
    speechSynthesis.speak(u);
  };
  return {
    aggiungi(d) { if (!ok()) return; buf += d; let m; while ((m = buf.match(/^([\s\S]*?[.!?…])\s+/))) { di(m[1]); buf = buf.slice(m[0].length); } },
    fine() { if (ok() && buf.trim()) di(buf); buf = ''; },
    zitto() { buf = ''; try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (e) { /* niente */ } },
  };
}

/* ---------- ascoltare ---------- */
// cb: { testo(tutto), livello(0..1), fine(testo|null), errore(messaggio) }
export function creaAscolto({ motore, t, lingua = 'it-IT', cb }) {
  const V = { sessione: 0, stato: 'spento', modo: 'premi', ws: null, rec: null, stream: null, ctx: null, an: null, dati: null, finali: '', parziale: '', gettone: null, timer: null, stop: null, chiuso: null, sr: null, raf: 0 };
  const WebSpeech = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  const conDeepgram = () => !!motore.M.servizio?.voce && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const disponibile = () => conDeepgram() || !!WebSpeech;

  async function gettone() {
    if (V.gettone && Date.now() < V.gettone.scade - 8000) return V.gettone;
    const g = await motore.gettoneVoce(); V.gettone = { ...g, scade: Date.now() + (g.scade || 60) * 1000 }; return V.gettone;
  }
  function prepara() { if (conDeepgram() && (!V.gettone || Date.now() > V.gettone.scade - 15000)) gettone().catch(() => {}); }
  function connetti(ws) {
    return new Promise((ok, ko) => {
      const timer = setTimeout(() => { ws.close(); ko(new Error('timeout')); }, 5000);
      ws.onopen = () => { clearTimeout(timer); ok(ws); };
      ws.onerror = () => { clearTimeout(timer); ko(new Error('refused')); };
      ws.onclose = () => { clearTimeout(timer); ko(new Error('closed')); };
    });
  }
  async function apriSocket(g) {
    const qs = new URLSearchParams({ model: g.modello || 'nova-3', language: g.lingua || lingua.slice(0, 2), interim_results: 'true', smart_format: 'true', punctuate: 'true', endpointing: '300', utterance_end_ms: '1000', vad_events: 'true' });
    const url = 'wss://api.deepgram.com/v1/listen?' + qs;
    // il gettone temporaneo è un JWT: nel browser va come sotto-protocollo «bearer»; in ripiego nell'indirizzo
    try { return await connetti(new WebSocket(url, ['bearer', g.token])); }
    catch (e) { return connetti(new WebSocket(url + '&access_token=' + encodeURIComponent(g.token))); }
  }
  const tutto = () => (V.finali + ' ' + V.parziale).trim();

  async function avvia(modo = 'premi') {
    if (V.stato !== 'spento') return false;
    if (!disponibile()) return false;
    const s = ++V.sessione;
    V.stato = 'avvio'; V.modo = modo; V.finali = ''; V.parziale = '';
    if (!conDeepgram()) return avviaWebSpeech(s);
    try {
      const [g, stream] = await Promise.all([gettone(), navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })]);
      if (s !== V.sessione || V.stato !== 'avvio') { stream.getTracks().forEach(x => x.stop()); return false; }   // tasto già lasciato
      V.stream = stream;
      V.ctx = new AudioContext(); const src = V.ctx.createMediaStreamSource(stream); V.an = V.ctx.createAnalyser(); V.an.fftSize = 1024; src.connect(V.an); V.dati = new Float32Array(V.an.fftSize);
      misura(s);
      const ws = await apriSocket(g);
      if (s !== V.sessione || V.stato !== 'avvio') { try { ws.close(); } catch (e) { /* niente */ } if (s === V.sessione) chiudi(); return false; }
      V.ws = ws;
      ws.onmessage = e => { try { ricevi(JSON.parse(e.data)); } catch (x) { /* niente */ } };
      ws.onclose = () => { V.ws = null; V.chiuso?.(); };
      const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(x => MediaRecorder.isTypeSupported(x));
      V.rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      V.rec.ondataavailable = e => { if (e.data.size && V.ws?.readyState === 1) V.ws.send(e.data); };
      V.rec.start(100);
      V.stato = 'ascolto';
      // con un clic si ascolta finché non si smette di parlare (al massimo un minuto)
      V.timer = setTimeout(() => { if (s === V.sessione) ferma(true); }, 60000);
      return true;
    } catch (e) {
      if (s !== V.sessione) return false;
      chiudi(); cb.errore(/Permission|NotAllowed/i.test(e.name + e.message) ? t('avviso.microfono') : /NotFound/i.test(e.name) ? t('avviso.noMicrofono') : t('avviso.noVoce'));
      return false;
    }
  }
  function ricevi(m) {
    if (m.type === 'Results') {
      const x = m.channel?.alternatives?.[0]?.transcript || '';
      if (m.is_final) { if (x) V.finali = (V.finali + ' ' + x).trim(); V.parziale = ''; } else V.parziale = x;
      if (tutto()) cb.testo(tutto());
      if (m.speech_final && V.modo === 'clic' && V.finali) { clearTimeout(V.stop); V.stop = setTimeout(() => ferma(true), 700); }
      else if (x) clearTimeout(V.stop);
    } else if (m.type === 'UtteranceEnd' && V.modo === 'clic' && V.finali) ferma(true);
  }
  // il riconoscimento del browser (Chrome, Edge, Safari): niente livello del microfono, un'onda tranquilla
  function avviaWebSpeech(s) {
    const sr = new WebSpeech(); V.sr = sr;
    sr.lang = lingua; sr.interimResults = true; sr.continuous = V.modo === 'premi'; sr.maxAlternatives = 1;
    sr.onresult = e => {
      let fin = '', par = '';
      for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else par += r[0].transcript; }
      V.finali = fin.trim(); V.parziale = par.trim(); if (tutto()) cb.testo(tutto());
    };
    sr.onerror = e => { if (s !== V.sessione) return; const no = /not-allowed|service-not-allowed/.test(e.error); if (e.error !== 'no-speech' && e.error !== 'aborted') { chiudi(); cb.errore(no ? t('avviso.microfono') : t('avviso.noVoce')); } };
    sr.onend = () => { if (s === V.sessione && V.stato !== 'spento' && V.stato !== 'chiusura') ferma(true); else V.chiuso?.(); };
    try { sr.start(); V.stato = 'ascolto'; } catch (e) { chiudi(); cb.errore(t('avviso.noVoce')); return false; }
    const t0 = performance.now();
    const giro = () => { if (s !== V.sessione || V.stato === 'spento') { cb.livello(0); return; } cb.livello(.18 + .12 * Math.sin((performance.now() - t0) / 260)); V.raf = requestAnimationFrame(giro); };
    giro();
    V.timer = setTimeout(() => { if (s === V.sessione) ferma(true); }, 60000);
    return true;
  }
  function misura(s) {
    let liscio = 0;
    const giro = () => {
      if (s !== V.sessione || !V.an) { cb.livello(0); return; }
      V.an.getFloatTimeDomainData(V.dati); let q = 0; for (const x of V.dati) q += x * x;
      const v = Math.min(1, Math.sqrt(q / V.dati.length) * 6.5); liscio += (v - liscio) * (v > liscio ? .5 : .15);
      cb.livello(liscio); V.raf = requestAnimationFrame(giro);
    };
    giro();
  }
  function chiudi() {
    V.sessione++; clearTimeout(V.timer); clearTimeout(V.stop); cancelAnimationFrame(V.raf);
    try { if (V.rec && V.rec.state !== 'inactive') V.rec.stop(); } catch (e) { /* niente */ }
    V.stream?.getTracks().forEach(x => x.stop());
    try { V.ctx?.close(); } catch (e) { /* niente */ }
    try { V.ws?.close(); } catch (e) { /* niente */ }
    try { V.sr?.abort(); } catch (e) { /* niente */ }
    V.rec = V.stream = V.ctx = V.an = V.ws = V.sr = null; V.stato = 'spento'; cb.livello(0);
  }
  // fine dell'ascolto: si chiede a Deepgram di chiudere la frase (CloseStream) e si consegna quello che si è capito
  async function ferma(invia) {
    if (V.stato === 'spento' || V.stato === 'chiusura') return;
    const avvio = V.stato === 'avvio'; V.stato = 'chiusura'; clearTimeout(V.timer); clearTimeout(V.stop);
    if (!avvio && invia && V.ws?.readyState === 1) {
      try { if (V.rec?.state !== 'inactive') V.rec.stop(); } catch (e) { /* niente */ }
      await new Promise(ok => { V.chiuso = ok; setTimeout(ok, 1200); setTimeout(() => { try { if (V.ws?.readyState === 1) V.ws.send(JSON.stringify({ type: 'CloseStream' })); } catch (e) { /* niente */ } }, 120); });
    } else if (!avvio && invia && V.sr) {
      await new Promise(ok => { V.chiuso = ok; setTimeout(ok, 900); try { V.sr.stop(); } catch (e) { ok(); } });
    }
    const testo = tutto();
    chiudi(); V.chiuso = null;
    cb.fine(invia && testo ? testo : null);
  }
  return { avvia, ferma, prepara, disponibile, get stato() { return V.stato; }, get modo() { return V.modo; } };
}
