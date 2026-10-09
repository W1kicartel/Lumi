// La voce di Lumi, in due direzioni.
// • Ascoltare: si tiene premuto ⌥ Spazio (Ctrl ⇧ Spazio su Windows e Linux) o si clicca il microfono. Tre modi, in
//   quest'ordine:
//   1. locale (adattamento per Lumi): se il server ha la voce locale pronta (Parakeet v3 sul suo computer, in una
//      qualsiasi delle 25 lingue europee, riconosciuta da sola), il microfono si registra qui (AudioContext), si
//      ricampiona a 16 kHz mono float32 e al rilascio va al server, che restituisce il testo. L'audio non esce
//      dall'azienda. Se la voce locale non risponde, per il resto della pagina si passa al modo dopo;
//   2. Deepgram: con il server che ne ha la chiave le parole compaiono mentre si parla (trascrizione in tempo reale,
//      con un gettone di 60 secondi: la chiave non arriva mai nel browser);
//   3. il riconoscimento vocale del browser (Web Speech), dove c'è.
//   Se non c'è nessuno dei tre, il microfono si spegne e si scrive.
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
export const SR_LOCALE = 16000, MAX_SECONDI = 60;
// da qualsiasi frequenza (44,1 o 48 kHz) a 16 kHz: ogni campione nuovo è la media di quelli che copre (un filtro a scatola,
// che basta a togliere quello che sopra gli 8 kHz si ripiegherebbe nel parlato)
export function ricampiona(campioni, da, a = SR_LOCALE) {
  if (da === a) return Float32Array.from(campioni);
  const passo = da / a, n = Math.floor(campioni.length / passo), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x0 = i * passo, x1 = Math.min(campioni.length, x0 + Math.max(1, passo));
    let somma = 0, k = 0; for (let j = Math.floor(x0); j < x1; j++) { somma += campioni[j]; k++; }
    out[i] = k ? somma / k : 0;
  }
  return out;
}
// i pezzi registrati, uno dopo l'altro (al massimo un minuto)
export function unisci(pezzi, max = Infinity) {
  const n = Math.min(max, pezzi.reduce((t, p) => t + p.length, 0)), out = new Float32Array(n); let i = 0;
  for (const p of pezzi) { if (i >= n) break; const q = p.subarray(0, n - i); out.set(q, i); i += q.length; }
  return out;
}
// cb: { testo(tutto), livello(0..1), fine(testo|null), errore(messaggio) }
export function creaAscolto({ motore, t, lingua = 'it-IT', cb }) {
  const V = { sessione: 0, stato: 'spento', modo: 'premi', ws: null, rec: null, stream: null, ctx: null, an: null, dati: null, finali: '', parziale: '', gettone: null, timer: null, stop: null, chiuso: null, sr: null, raf: 0,
    pezzi: null, nodo: null, muto: null, localeGuasta: false, rilettoIl: 0, parlato: 0 };
  const WebSpeech = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  const microfono = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const conLocale = () => !!motore.M.servizio?.voceLocale && !V.localeGuasta && microfono() && typeof AudioContext !== 'undefined' && typeof motore.trascriviVoce === 'function';
  const conDeepgram = () => !!motore.M.servizio?.voce && microfono() && typeof MediaRecorder !== 'undefined';
  const disponibile = () => conLocale() || conDeepgram() || !!WebSpeech;

  async function gettone() {
    if (V.gettone && Date.now() < V.gettone.scade - 8000) return V.gettone;
    const g = await motore.gettoneVoce(); V.gettone = { ...g, scade: Date.now() + (g.scade || 60) * 1000 }; return V.gettone;
  }
  function prepara() {
    if (conDeepgram() && (!V.gettone || Date.now() > V.gettone.scade - 15000)) gettone().catch(() => {});
    // il server ha la voce locale ma non era ancora pronta (sta caricando il modello): si richiede lo stato, ogni 5 secondi al più
    const sv = motore.M.servizio;
    if (sv?.voceMotore && !sv.voceLocale && !V.localeGuasta && Date.now() - V.rilettoIl > 5000) { V.rilettoIl = Date.now(); motore.servizio?.().catch?.(() => {}); }
  }
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
    if (conLocale()) return avviaLocale(s);
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
  // la voce locale: si registra qui, a pezzi, e al rilascio l'audio (16 kHz mono float32) va al server
  async function avviaLocale(s) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (s !== V.sessione || V.stato !== 'avvio') { stream.getTracks().forEach(x => x.stop()); return false; }   // tasto già lasciato
      V.stream = stream; V.pezzi = []; V.parlato = 0;
      V.ctx = new AudioContext(); const src = V.ctx.createMediaStreamSource(stream);
      if (V.ctx.state === 'suspended') await V.ctx.resume().catch(() => {});   // Safari, dopo l'attesa del permesso
      V.an = V.ctx.createAnalyser(); V.an.fftSize = 1024; src.connect(V.an); V.dati = new Float32Array(V.an.fftSize);
      // l'uscita passa da un guadagno a zero: il nodo deve essere collegato per lavorare, ma dagli altoparlanti non esce niente
      V.muto = V.ctx.createGain(); V.muto.gain.value = 0; V.muto.connect(V.ctx.destination);
      const max = (MAX_SECONDI + 1) * V.ctx.sampleRate; let tot = 0;
      const prendi = x => { if (tot < max) { V.pezzi.push(x); tot += x.length; } };
      if (V.ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        await V.ctx.audioWorklet.addModule(new URL('./cattura.js', import.meta.url));
        if (s !== V.sessione) return false;
        V.nodo = new AudioWorkletNode(V.ctx, 'lumi-cattura', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
        V.nodo.port.onmessage = e => prendi(e.data);
      } else {   // i browser senza AudioWorklet
        V.nodo = V.ctx.createScriptProcessor(4096, 1, 1);
        V.nodo.onaudioprocess = e => prendi(Float32Array.from(e.inputBuffer.getChannelData(0)));
      }
      src.connect(V.nodo); V.nodo.connect(V.muto);
      misura(s);
      V.stato = 'ascolto';
      V.timer = setTimeout(() => { if (s === V.sessione) ferma(true); }, MAX_SECONDI * 1000);
      return true;
    } catch (e) {
      if (s !== V.sessione) return false;
      chiudi(); cb.errore(/Permission|NotAllowed/i.test(e.name + e.message) ? t('avviso.microfono') : /NotFound/i.test(e.name) ? t('avviso.noMicrofono') : t('avviso.noVoce'));
      return false;
    }
  }
  async function finisciLocale() {
    const da = V.ctx?.sampleRate || 48000, audio = ricampiona(unisci(V.pezzi || [], MAX_SECONDI * da), da);
    chiudi();
    if (audio.length < SR_LOCALE * 0.3) return '';   // meno di un terzo di secondo: un tocco del tasto
    V.stato = 'chiusura';   // finché il server trascrive non si riparte
    try { const j = await motore.trascriviVoce(audio); return String(j?.testo || '').trim(); }
    catch (e) { V.localeGuasta = true; V.stato = 'spento'; cb.errore(t('avviso.noVoce')); return null; }   // la prossima volta: Deepgram o il browser
    finally { V.stato = 'spento'; }
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
      // voce locale con un clic: dopo aver parlato, un secondo e mezzo di silenzio chiude la frase
      if (V.pezzi && V.stato === 'ascolto') { const ora = performance.now(); if (v > .12) V.parlato = ora; else if (V.modo === 'clic' && V.parlato && ora - V.parlato > 1500) { ferma(true); return; } }
      cb.livello(liscio); V.raf = requestAnimationFrame(giro);
    };
    giro();
  }
  function chiudi() {
    V.sessione++; clearTimeout(V.timer); clearTimeout(V.stop); cancelAnimationFrame(V.raf);
    try { if (V.rec && V.rec.state !== 'inactive') V.rec.stop(); } catch (e) { /* niente */ }
    try { if (V.nodo) { V.nodo.disconnect(); if (V.nodo.port) V.nodo.port.onmessage = null; else V.nodo.onaudioprocess = null; } } catch (e) { /* niente */ }
    V.stream?.getTracks().forEach(x => x.stop());
    try { V.ctx?.close(); } catch (e) { /* niente */ }
    try { V.ws?.close(); } catch (e) { /* niente */ }
    try { V.sr?.abort(); } catch (e) { /* niente */ }
    V.rec = V.stream = V.ctx = V.an = V.ws = V.sr = V.nodo = V.muto = V.pezzi = null; V.stato = 'spento'; cb.livello(0);
  }
  // fine dell'ascolto: si chiede a Deepgram di chiudere la frase (CloseStream) e si consegna quello che si è capito
  async function ferma(invia) {
    if (V.stato === 'spento' || V.stato === 'chiusura') return;
    const avvio = V.stato === 'avvio'; V.stato = 'chiusura'; clearTimeout(V.timer); clearTimeout(V.stop);
    if (V.pezzi) {   // la voce locale: il testo arriva tutto insieme, dal server
      if (avvio || !invia) { chiudi(); cb.fine(null); return; }
      cancelAnimationFrame(V.raf); cb.livello(0);
      const testo = await finisciLocale();
      if (testo) cb.testo(testo);
      if (testo !== null) cb.fine(testo || null);
      return;
    }
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
