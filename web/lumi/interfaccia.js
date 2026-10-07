// L'interfaccia di Lumi: la pillola di vetro nero in cima alla finestra. Passandoci sopra si apre il pannello (una molla
// smorzata, senza rimbalzi): «Da vedere» (le cose che l'host segnala), le azioni rapide dell'host e il campo «Chiedi o
// cerca…». Si parla tenendo premuto ⌥ Spazio (Ctrl ⇧ Spazio su Windows e Linux) o col microfono; la risposta arriva in
// streaming e si scrive con un ritmo morbido; parlando di nuovo la si interrompe. I file trascinati sulla finestra li
// legge. Ogni scrittura è una scheda «Conferma / Annulla».
// Tutte le animazioni passano da un solo giro di requestAnimationFrame e si accorciano a niente con
// prefers-reduced-motion. Il motore (motore.js) non sa niente del DOM: qui c'è solo l'adattatore `ui` che lui chiama.
import { creaMotore } from './motore.js';
import { creaVoceAlta, creaAscolto, TASTI, eTastoParla } from './voce.js';
import { creaMascotte } from './mascotte.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));

/* ---------- icone (tratto 1.5, angoli tondi, solo bianco e nero) ---------- */
const IC = {
  lente: '<svg class="lente" viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/></svg>',
  spunta: '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:0"/></svg>',
  croce: '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:0"/></svg>',
  scudo: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  occhio: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.5 2.1-2.9 3.3M6.6 7.6C4.6 8.9 3.2 10.8 2.5 12c1 1.5 4.5 6 9.5 6 1.4 0 2.7-.3 3.8-.9"/></svg>',
  chiudi: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
};
const TRATTI = {
  piu: '<path d="M12 5v14M5 12h14"/>',
  cliente: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  agenda: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>',
  ordine: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6"/><path d="M9 12h6"/>',
  magazzino: '<path d="M3 8l9-5 9 5v12H3z"/><path d="M7 20v-7h10v7"/><path d="M7 16h10"/>',
  messaggio: '<path d="M4 5h16v11H9l-5 4z"/>',
  documento: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 13h5"/><path d="M10 17h5"/>',
  grafico: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  apri: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  cerca: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
  foto: '<rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-5-8 9"/>',
  pdf: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 15h5"/>',
  foglio: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 15h5M10 18h3"/>',
};
const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${TRATTI[k] || TRATTI.piu}</svg>`;

/* ---------- tempo: curve e un solo giro di requestAnimationFrame ---------- */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = q => ((ax * q + bx) * q + cx) * q, Y = q => ((ay * q + by) * q + cy) * q, dX = q => (3 * ax * q + 2 * bx) * q + cx;
  return p => {
    if (p <= 0) return 0; if (p >= 1) return 1;
    let q = p;
    for (let i = 0; i < 8; i++) { const e = X(q) - p, d = dX(q); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; q -= e / d; }
    if (q < 0 || q > 1 || Math.abs(X(q) - p) > 1e-3) { let a = 0, b = 1; q = p; for (let i = 0; i < 24; i++) { if (X(q) < p) a = q; else b = q; q = (a + b) / 2; } }
    return Y(q);
  };
}
const morbido = bezier(0.22, 1, 0.36, 1), lineare = x => x;

export function montaInterfaccia(op, t) {
  const RIDOTTO = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desk = typeof window !== 'undefined' ? window.lumiDesktop : null;
  const giri = new Set(); let raf = 0, GEN = 0;
  function giro() {
    raf = 0; const ts = performance.now();
    for (const f of [...giri]) { if (!giri.has(f)) continue; let ok = false; try { ok = f(ts); } catch (e) { console.error(e); } if (ok === false) giri.delete(f); }
    if (giri.size) raf = requestAnimationFrame(giro);
  }
  function ogni(f) { giri.add(f); if (!raf) raf = requestAnimationFrame(giro); return () => giri.delete(f); }
  function tween(ms, fn, { ritardo = 0, ease = morbido } = {}) {
    if (RIDOTTO) { ms = Math.min(ms, 1); ritardo = 0; }
    return new Promise(res => {
      const t0 = performance.now() + ritardo; fn(0, 0);
      ogni(ts => { const p = ms > 0 ? (ts - t0) / ms : (ts >= t0 ? 1 : -1); if (p < 0) return true; if (p >= 1) { fn(1, 1); res(); return false; } fn(ease(p), p); return true; });
    });
  }
  const attendi = ms => new Promise(res => { const t0 = performance.now(); ogni(ts => { if (ts - t0 >= ms) { res(); return false; } return true; }); });
  function dopo(ms, f) { const t0 = performance.now(); let via = false; const stop = ogni(ts => { if (via) return false; if (ts - t0 >= ms) { f(); return false; } return true; }); return () => { via = true; stop(); }; }
  function entra(el, { ritardo = 0, dy = 8, blur = 6, ms = 520, scala = 1 } = {}) {
    return tween(ms, e => {
      if (e >= 1) { el.style.opacity = ''; el.style.transform = ''; el.style.filter = ''; return; }
      el.style.opacity = e.toFixed(3);
      el.style.transform = `translateY(${((1 - e) * dy).toFixed(2)}px)` + (scala !== 1 ? ` scale(${(scala + (1 - scala) * e).toFixed(4)})` : '');
      el.style.filter = blur ? `blur(${((1 - e) * blur).toFixed(2)}px)` : '';
    }, { ritardo });
  }
  function comprimi(el, ms = 360, togli = true) {
    const h0 = el.offsetHeight, gap = parseFloat(getComputedStyle(el.parentElement).rowGap) || 0;
    el.style.overflow = 'hidden';
    return tween(ms, e => {
      el.style.height = (h0 * (1 - e)).toFixed(2) + 'px'; el.style.marginBottom = (-gap * e).toFixed(2) + 'px';
      el.style.opacity = Math.max(0, 1 - e * 1.8).toFixed(3);
    }).then(() => { if (togli) el.remove(); else el.style.display = 'none'; });
  }
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  /* ---------- stato ---------- */
  const A = { aperto: false, fisso: false, modo: 'riposo', turno: null, home: true, avviso: null, chiudiTra: null, apriTra: null, dv: [], voceAlta: false };
  try { A.voceAlta = localStorage.getItem('lumi:voce-alta') === '1'; } catch (e) { /* niente */ }
  let shell, pill, corpo, campo, filo, home, testa, allegatiBox, piede, tacche = [], anello, velo, forma, mascotte = null;
  const segnala = (evento, x = {}) => shell?.dispatchEvent(new CustomEvent('lumi', { detail: { evento, ...x } }));
  const LIV = x => (x.livello === 'urgente' ? 'urg' : x.livello === 'attenzione' ? 'att' : 'info');

  const voceAlta = creaVoceAlta({ lingua: t.voce, attiva: () => A.voceAlta, filtro: s => motore.pubblicoSubito(s) });
  const ui = {
    domanda(testo, { daVoce, allegati = [] } = {}) {
      const tr = daVoce && A.turno && !A.turno.dataset.chiuso ? A.turno : nuovoTurno();
      tr.dataset.chiuso = '1';
      if (testo) detto(tr, testo);
      if (allegati.length) { const box = h('div', 'lumi-allegati'); box.innerHTML = allegati.map(a => `<span class="lumi-file">${ico(a.icona || 'doc')}<span>${esc(a.nome)}</span></span>`).join(''); tr.append(box); }
    },
    risposta: () => nuovaRisposta(),
    fisso: (testo, o) => rispostaFissa(testo, o),
    pensa(etichetta) { modo('pensa', etichetta); segnala('pensa'); },
    riposo() { if (A.modo === 'pensa') modo('riposo'); },
    proposta: p => schedaConferma(p),
    confermato(card) { segnala('confermato'); return premi(card?.querySelector?.('[data-lumi=si]')); },
    esito: (e, card) => mostraFatto(e, card?.isConnected ? card : null),
    mostra: x => mostraScheda(x),
    avviso(testo) { if (A.aperto) nota(testo); else mostraAvviso(testo); },
    allegati: () => disegnaAllegati(),
    ricominciato() {
      GEN++; formaViva = false; campo._pensa = false;
      A.turno = null; filo.innerHTML = ''; mostraHome(); modo('riposo');
      forma.w.x = forma.w.t = A.aperto ? larghezzaAperta() : 336; molla();
    },
    zitto: () => voceAlta.zitto(),
    servizio: () => statoCampo(),
    schermo: () => { aggiornaPillola(); disegnaPiede(); },
  };
  const motore = creaMotore(op, ui);
  const ascolto = creaAscolto({ motore, t, lingua: t.voce, cb: {
    testo: tutto => {
      if (motore.M.attesa && A.turno?.contains(motore.M.attesa.scheda)) {
        // risposta a voce a una proposta: sotto la scheda di conferma, nello stesso turno
        const a = motore.M.attesa;
        if (!a.voce?.isConnected) { a.voce = h('p', 'lumi-detto'); a.scheda.after(a.voce); }
        scriviParole(a.voce, tutto);
      } else { const tr = A.turno && !A.turno.dataset.chiuso ? A.turno : nuovoTurno(); detto(tr, tutto); }
      segnala('ascolto', { ms: 600 });
    },
    livello: v => livelloVoce(v),
    fine: testo => {
      if (testo) { if (!motore.M.attesa) modo('pensa'); else modo('riposo'); motore.chiedi(testo, { daVoce: true }); return; }
      modo('riposo'); motore.M.attesa?.voce?.remove();
      if (A.turno && !A.turno.dataset.chiuso && !A.turno.querySelector('.lumi-ai')) { const tr = A.turno; A.turno = null; comprimi(tr, 260); if (!filo.querySelector('.lumi-turno:not(.passato)') && !motore.M.storia.length) mostraHome(); }
    },
    errore: testo => { modo('riposo'); mostraAvviso(testo); if (A.aperto) campo.querySelector('input').focus(); },
  } });

  /* ---------- testi ---------- */
  function saluto() {
    const o = new Date().getHours(), s = t(o < 13 ? 'saluto.mattina' : o < 18 ? 'saluto.pomeriggio' : 'saluto.sera');
    let n = ''; try { n = String((typeof op.utente === 'function' ? op.utente() : op.utente) || '').trim().split(/\s+/)[0]; } catch (e) { /* niente */ }
    return n ? t('saluto.nome', { saluto: s, nome: n }) : t('saluto.solo', { saluto: s });
  }
  function frase(dv) {
    if (!dv.length) return t('stato.ordine');
    const u = dv.filter(v => LIV(v) === 'urg').length;
    return t('stato.davedere', { n: dv.length }) + (u ? t('stato.urgenti', { n: u }) : '') + '.';
  }
  const ore = d => d.toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' });
  const giorno = d => { const s = d.toLocaleDateString(t.locale, { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };

  /* ---------- costruzione ---------- */
  function costruisci() {
    shell = h('div', 'lumi'); shell.setAttribute('role', 'region'); shell.setAttribute('aria-label', t('regione') + ' ' + op.nomeAssistente);
    shell.dataset.aperto = '0';
    if (op.tema === 'chiaro') shell.dataset.tema = 'chiaro';
    pill = h('button', 'lumi-pill'); pill.type = 'button'; pill.setAttribute('aria-expanded', 'false');
    corpo = h('div', 'lumi-corpo');
    testa = h('header', 'lumi-testa', '<div class="r1"><i class="lumi-rombo"></i><h2></h2><span class="esc">Esc</span></div><div class="sotto"><p></p><small></small></div>');
    const dentro = h('div', 'lumi-dentro');
    campo = h('div', 'lumi-campo'); campo.dataset.modo = 'riposo';
    campo.innerHTML = `<div class="cerca">${IC.lente}<input type="text" aria-label="${esc(t('campo.aria'))}" placeholder="${esc(t('campo.placeholder'))}" autocomplete="off" spellcheck="true"></div>
      <div class="stato ascolto"><span>${esc(t('campo.ascolto'))}</span><div class="lumi-onda" aria-hidden="true">${Array.from({ length: 41 }, (_, i) => `<i${i === 20 ? ' class="c"' : ''}></i>`).join('')}</div><span class="esc">${esc(t('campo.esc'))}</span></div>
      <div class="stato pensa"><span class="lbl">${esc(t('campo.attimo'))}</span><div class="lumi-linea" aria-hidden="true"><i></i></div></div>
      <button type="button" class="lumi-mic" aria-label="${esc(t('mic.parla', { tasti: TASTI }))}">${IC.mic}<i class="quadro"></i><i class="anello"></i></button>`;
    tacche = [...campo.querySelectorAll('.lumi-onda i')]; anello = campo.querySelector('.anello');
    allegatiBox = h('div', 'lumi-allegati');
    home = h('div', 'lumi-home');
    filo = h('div', 'lumi-filo'); filo.setAttribute('aria-live', 'polite');
    dentro.append(campo, allegatiBox, home, filo);
    piede = h('footer', 'lumi-piede');
    corpo.append(testa, dentro, piede);
    shell.append(pill, corpo);
    document.body.append(shell);
    if (op.file !== false) {
      velo = h('div', 'lumi-drop', `<i class="bordo"></i><div class="lumi-drop-in"><b>${esc(t('drop.titolo'))}</b><span>${esc(t('drop.nota', { nome: op.nomeAssistente }))}</span></div>`);
      velo.setAttribute('aria-hidden', 'true'); document.body.append(velo);
    }
    forma = { w: { x: 336, v: 0, t: 336 }, h: { x: 34, v: 0, t: 34 }, r: { x: 17, v: 0, t: 17 } };
    if (op.mascotte !== false) mascotte = creaMascotte(shell, { ridotto: RIDOTTO });
    else shell.classList.add('senza-mascotte');
    disegnaHome(); aggiornaTesta(); aggiornaPillola(); disegnaPiede(); applica(); statoCampo();
    collega();
  }
  function livelloVoce(v) {
    mascotte?.livello(v);
    const liv = Math.max(0, Math.min(1, v)), ts = performance.now();
    for (let i = 0; i < tacche.length; i++) {
      const dd = Math.abs(i - 20), peso = 0.28 + 0.72 * Math.exp(-((dd / 10.5) ** 2)), trem = 0.7 + 0.3 * Math.sin(i * 2.39996 + ts * 0.012 * (1 + (i % 5) * 0.17));
      tacche[i].style.transform = liv ? `scaleY(${((3 + 15 * liv * peso * trem) / 18).toFixed(3)})` : '';
    }
    anello.style.transform = liv ? `scale(${(1 + liv * 0.2).toFixed(3)})` : ''; anello.style.opacity = liv ? (0.2 + liv * 0.7).toFixed(3) : '';
  }
  // il campo dice subito che cosa si può fare da qui
  function statoCampo() {
    const inp = campo.querySelector('input'), mic = campo.querySelector('.lumi-mic'), s = motore.M.servizio;
    const esempio = op.esempi?.[0];
    inp.placeholder = !op.server && esempio ? t('campo.senzaServer', { esempio }) : s?.irraggiungibile ? t('risposta.irraggiungibile') : t('campo.placeholder');
    const voce = ascolto.disponibile();
    mic.setAttribute('aria-disabled', voce ? 'false' : 'true');
    mic.title = voce ? t('mic.parla', { tasti: TASTI }) : t('mic.noVoce');
  }
  function disegnaPiede() {
    const cond = motore.schermoCondiviso();
    piede.innerHTML = `<span>${esc(t('piede.parla'))} <kbd>${esc(TASTI)}</kbd></span><span>${cond ? IC.occhio + esc(t('piede.schermo')) : IC.scudo + esc(t('piede.conferma'))}</span>`;
    shell.classList.toggle('condiviso', cond);
  }
  async function caricaDaVedere() {
    if (typeof op.daVedere !== 'function') { A.dv = []; return A.dv; }
    try { const r = await op.daVedere(); A.dv = Array.isArray(r) ? r.filter(x => x && x.testo) : []; } catch (e) { console.error(e); }
    return A.dv;
  }
  function disegnaHome() {
    const dv = A.dv;
    const righe = dv.slice(0, 4).map((v, i) => `<div class="lumi-riga ${LIV(v)}"><i class="lumi-seg"></i><div class="t"><b>${esc(v.testo)}</b><span>${esc(v.nota || '')}</span></div><span class="n">${esc(v.numero ?? '')}</span>${typeof v.apri === 'function' ? `<button type="button" class="lumi-btn piccolo${LIV(v) === 'urg' && i === 0 ? ' primario' : ''}" data-lumi-vedi="${i}">${esc(v.bottone || t('vedere.apri'))}</button>` : '<span></span>'}</div>`).join('');
    const rapide = (op.azioni || []).filter(a => a && a.testo && typeof a.fai === 'function').slice(0, 6);
    home.innerHTML = `<section class="lumi-vedere"><div class="capo"><span class="lumi-lbl">${esc(t('vedere.titolo', { n: dv.length }))}</span><span>${dv.length > 4 ? esc(t('vedere.altre', { n: dv.length - 4 })) : esc(t('vedere.adesso'))}</span></div>${righe || `<div class="lumi-riga info"><i class="lumi-seg"></i><div class="t"><b>${esc(t('vedere.niente'))}</b><span>${esc(t('vedere.nienteNota'))}</span></div><span class="n"></span><span></span></div>`}</section>`
      + (rapide.length ? `<div class="lumi-rapidi">${rapide.map((a, i) => `<button type="button" class="lumi-btn" data-lumi-rapido="${i}">${ico(a.icona)}<span>${esc(a.testo)}</span></button>`).join('')}</div>` : '');
    home._rapide = rapide;
  }
  function aggiornaTesta() {
    const dv = A.dv, d = new Date();
    testa.querySelector('h2').textContent = saluto();
    testa.querySelector('p').textContent = frase(dv);
    testa.querySelector('small').textContent = t('stato.aggiornato', { giorno: giorno(d), ora: ore(d) });
    testa.querySelector('.r1 .lumi-rombo').classList.toggle('lumi-cavo', !dv.some(v => LIV(v) === 'urg'));
  }
  // la pillola: solo quante cose ci sono da vedere, mai nomi o cifre; un avviso breve passa e torna com'era
  function aggiornaPillola(avviso) {
    if (!pill) return;
    const dv = A.dv, urg = dv.some(v => LIV(v) === 'urg');
    const stato = dv.length ? t('pillola.davedere', { n: dv.length }) : t('pillola.ordine');
    if (avviso) pill.innerHTML = `<svg class="lumi-ok" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg><span>${esc(motore.pubblicoSubito(avviso))}</span>`;
    else pill.innerHTML = `<i class="lumi-rombo${urg ? '' : ' lumi-cavo'}"></i><span>${dv.length ? `<b>${dv.length}</b> ${esc(stato.replace(/^\d+\s*/, ''))}` : esc(stato)}</span><span class="lumi-voce" aria-hidden="true"><i style="height:4px"></i><i style="height:8px"></i><i style="height:5px"></i><i style="height:9px"></i><i style="height:4px"></i></span>`;
    pill.setAttribute('aria-label', avviso ? motore.pubblicoSubito(avviso) : t('pillola.aria', { nome: op.nomeAssistente, stato, tasti: TASTI }));
  }

  /* ---------- la forma: tre molle smorzate criticamente (niente rimbalzi) che seguono i bersagli ---------- */
  let formaViva = false;
  // nella shell desktop la finestra si allarga quando il pannello si apre: la larghezza non dipende da quella di adesso
  const larghezzaAperta = () => (desk?.solo ? 560 : Math.min(560, innerWidth - 16));
  function applica() { shell.style.width = forma.w.x.toFixed(2) + 'px'; shell.style.height = forma.h.x.toFixed(2) + 'px'; shell.style.borderRadius = forma.r.x.toFixed(2) + 'px'; }
  function molla() {
    if (formaViva) return; formaViva = true; let prec = performance.now(); const g = GEN;
    ogni(ts => {
      if (g !== GEN) { formaViva = false; return false; }
      const dt = Math.min(64, Math.max(0, ts - prec)) / 1000; prec = ts;
      if (A.aperto) forma.h.t = Math.min(corpo.offsetHeight, innerHeight - 20);
      let fermo = true; const w0 = RIDOTTO ? 80 : 15.5;
      for (const k of ['w', 'h', 'r']) {
        const m = forma[k], n = Math.max(1, Math.ceil(dt / 0.008)), s = dt / n;
        for (let i = 0; i < n; i++) { const a = -w0 * w0 * (m.x - m.t) - 2 * w0 * m.v; m.v += a * s; m.x += m.v * s; }
        if (Math.abs(m.x - m.t) < 0.2 && Math.abs(m.v) < 3) { m.x = m.t; m.v = 0; } else fermo = false;
      }
      applica();
      if (fermo && !A.aperto) { formaViva = false; return false; }
      return true;
    });
  }
  // nella shell desktop la finestra è grande quanto serve: si allarga prima di aprire, si stringe dopo aver chiuso
  const finestra = (w, hh) => { try { desk?.forma?.(Math.ceil(w), Math.ceil(hh)); } catch (e) { /* niente */ } };
  let osservatore = null;

  /* ---------- aprire e chiudere ---------- */
  async function apri({ fisso = false } = {}) {
    if (fisso) A.fisso = true;
    if (A.aperto) return;
    // dopo un quarto d'ora di silenzio si ricomincia da capo (i file caricati si cancellano)
    if (motore.M.storia.length && Date.now() - motore.M.ultimoUso > 15 * 60e3 && !motore.M.inCorso && !motore.M.attesa) motore.ricomincia();
    A.apriTra?.(); A.chiudiTra?.(); A.aperto = true;
    if (desk?.solo) finestra(larghezzaAperta() + 40, Math.min(screen.availHeight - 20, 900));
    if (A.home) disegnaHome();
    aggiornaTesta(); statoCampo(); ascolto.prepara();
    caricaDaVedere().then(() => { if (A.aperto && A.home && !occupato()) { disegnaHome(); aggiornaTesta(); } });
    shell.dataset.aperto = '1'; pill.setAttribute('aria-expanded', 'true');
    forma.w.t = larghezzaAperta(); forma.r.t = 20; molla();
    tween(150, e => { pill.style.opacity = (1 - e).toFixed(3); pill.style.transform = `scale(${1 - 0.04 * e})`; }).then(() => { if (A.aperto) pill.style.visibility = 'hidden'; });
    corpo.style.opacity = '1';
    const pezzi = [testa, ...corpo.querySelector('.lumi-dentro').children, piede].filter(x => x.style.display !== 'none' && x.offsetParent !== null && !(x === filo && !filo.children.length) && !(x === allegatiBox && !allegatiBox.children.length));
    pezzi.forEach((p, i) => entra(p, { ritardo: 50 + i * 45, dy: 10, blur: 8, ms: 560 }));
    segnala('aperto');
    // poi la finestra segue il contenuto (scrollHeight: anche quello che oggi non ci sta)
    if (desk?.solo && typeof ResizeObserver === 'function') { osservatore ||= new ResizeObserver(() => { if (A.aperto) finestra(larghezzaAperta() + 40, Math.min(corpo.scrollHeight + 40, screen.availHeight)); }); osservatore.observe(corpo); osservatore.observe(corpo.querySelector('.lumi-dentro')); }
    await attendi(560);
  }
  async function chiudi(avviso) {
    A.fisso = false;
    if (!A.aperto) { if (avviso) mostraAvviso(avviso); return; }
    A.chiudiTra?.(); A.aperto = false; pill.setAttribute('aria-expanded', 'false');
    if (shell.contains(document.activeElement)) document.activeElement.blur();
    forma.w.t = 336; forma.h.t = 34; forma.r.t = 17; molla();
    tween(170, e => { corpo.style.opacity = (1 - e).toFixed(3); });
    if (avviso) mostraAvviso(avviso, true); else aggiornaPillola();
    pill.style.visibility = '';
    tween(300, e => { pill.style.opacity = e.toFixed(3); pill.style.transform = `scale(${0.96 + 0.04 * e})`; }, { ritardo: 170 });
    segnala('chiuso');
    osservatore?.disconnect();
    await attendi(480);
    if (!A.aperto) { shell.dataset.aperto = '0'; if (desk?.solo) finestra(336 + 40, 34 + 26); }
  }
  function mostraAvviso(testo, silenzioso) {
    A.avviso?.(); aggiornaPillola(testo);
    if (!silenzioso) entra(pill, { dy: 0, blur: 4, ms: 300 });
    A.avviso = dopo(2600, () => { A.avviso = null; if (A.aperto) return; tween(160, e => { pill.style.opacity = (1 - e).toFixed(3); }).then(() => { aggiornaPillola(); tween(260, e => { pill.style.opacity = e.toFixed(3); }); }); });
  }
  function nota(testo) {
    const n = h('p', 'lumi-nota-avviso', esc(testo));
    filo.prepend(n); entra(n, { dy: 4, blur: 4, ms: 380 });
  }

  /* ---------- campo: riposo, ascolto, un attimo ---------- */
  function modo(m, etichetta) {
    A.modo = m; campo.dataset.modo = m;
    if (m === 'pensa') {
      campo.querySelector('.stato.pensa .lbl').textContent = etichetta || t('campo.attimo');
      if (campo._pensa) return; campo._pensa = true;
      const g = GEN, t0 = performance.now(), seg = campo.querySelector('.lumi-linea i');
      ogni(ts => { if (g !== GEN || A.modo !== 'pensa') { campo._pensa = false; return false; } const p = ((ts - t0) % 900) / 900; seg.style.transform = `translateX(${(-48 + 218 * morbido(p)).toFixed(1)}px)`; return true; });
    }
  }

  /* ---------- conversazione: turni, parole che entrano, risposta in streaming ---------- */
  function nascondiHome() {
    if (!A.home) return; A.home = false;
    comprimi(home, 380, false); comprimi(testa.querySelector('.sotto'), 380, false);
  }
  function mostraHome() {
    if (A.home) return; A.home = true;
    for (const el of [home, testa.querySelector('.sotto')]) { el.style.display = ''; el.style.height = ''; el.style.marginBottom = ''; el.style.opacity = ''; el.style.overflow = ''; }
    disegnaHome(); aggiornaTesta();
  }
  function riassumi(tr) {
    const dom = tr.dataset.domanda || '', sin = tr.dataset.sintesi || '';
    if (!dom && !sin) { tr.classList.add('passato'); return; }
    const h0 = tr.offsetHeight; tr.style.height = h0 + 'px'; tr.style.overflow = 'hidden';
    tween(140, e => { for (const c of tr.children) c.style.opacity = (1 - e).toFixed(3); }).then(() => {
      tr.innerHTML = ''; const r = h('div', 'lumi-riass', `<q>${esc(dom)}</q><span>→</span><b>${esc(sin || '…')}</b>`); tr.append(r);
      const h1 = r.offsetHeight; entra(r, { dy: 4, blur: 4, ms: 380 });
      return tween(380, e => { tr.style.height = (h0 + (h1 - h0) * e).toFixed(2) + 'px'; });
    }).then(() => { tr.style.height = ''; });
    tr.classList.add('passato');
  }
  function nuovoTurno() {
    if (!A.aperto) apri({ fisso: true });
    nascondiHome();
    // mai riassumere il turno con una proposta che aspetta: la scheda di conferma deve restare lì
    if (A.turno && !A.turno.classList.contains('passato') && !(motore.M.attesa && A.turno.contains(motore.M.attesa.scheda))) riassumi(A.turno);
    const vecchi = [...filo.querySelectorAll('.lumi-turno.passato')]; if (vecchi.length > 2) comprimi(vecchi[0], 300);
    const tr = h('article', 'lumi-turno'); filo.append(tr); A.turno = tr; return tr;
  }
  function detto(tr, testo) {
    let p = tr.querySelector('.lumi-detto');
    if (!p) { p = h('p', 'lumi-detto'); p.dataset.tu = t('tu'); tr.prepend(p); p._parole = []; }
    scriviParole(p, testo); tr.dataset.domanda = testo;
    return p;
  }
  function scriviParole(p, testo) {
    p._parole ||= [];
    const parole = String(testo).split(/\s+/).filter(Boolean);
    parole.forEach((w, i) => {
      const s = p._parole[i];
      if (s) { if (s.textContent !== w) s.textContent = w; return; }
      if (i > 0) p.append(document.createTextNode(' '));
      const n = h('span', 'w'); n.textContent = w; p.append(n); p._parole.push(n);
      entra(n, { dy: 5, blur: 7, ms: 380 });
    });
    while (p._parole.length > parole.length) { const n = p._parole.pop(); const sp = n.previousSibling; n.remove(); if (sp && sp.nodeType === 3) sp.remove(); }
  }
  const mdHtml = x => {
    let s = esc(x).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const i = s.lastIndexOf('**'); if (i >= 0) s = s.slice(0, i) + '<b>' + s.slice(i + 2) + '</b>';   // grassetto ancora aperto durante lo streaming
    return s.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  };
  const prima = x => String(x).replace(/\*\*/g, '').split(/(?<=[.?!])\s/)[0];
  // la risposta: i pezzi dello streaming si scrivono con un ritmo morbido (mai a scatti), più svelto se c'è arretrato
  function nuovaRisposta() {
    const tr = A.turno || nuovoTurno(), g = GEN; modo('riposo');
    const p = h('p', 'lumi-ai', '<i class="lumi-rombo"></i><span class="tx"></span>'); tr.append(p);
    entra(p, { dy: 3, blur: 0, ms: 240 });
    const tx = p.querySelector('.tx'), caret = h('span', 'lumi-caret');
    let testo = '', visti = 0, finito = false, chiusa = null, prec = performance.now(), ultimoSegno = 0;
    const fatto = new Promise(r => { chiusa = r; });
    ogni(t2 => {
      if (g !== GEN) { chiusa(); return false; }
      const dt = Math.min(100, t2 - prec) / 1000; prec = t2;
      const arretrato = testo.length - visti, cps = RIDOTTO ? 1e6 : Math.max(70, arretrato * 5);
      if (arretrato > 0) { visti = Math.min(testo.length, visti + Math.max(1, cps * dt)); tx.innerHTML = mdHtml(testo.slice(0, Math.floor(visti))); tx.append(caret); if (t2 - ultimoSegno > 300) { ultimoSegno = t2; segnala('risposta', { ms: 700 }); } }
      if (finito && Math.floor(visti) >= testo.length) {
        chiusa();
        const t1 = performance.now();
        ogni(tt => { if (g !== GEN) return false; const e = tt - t1; if (e > 1100) { caret.remove(); return false; } caret.style.opacity = (Math.floor(e / 530) % 2 ? 0 : 1) * (e > 900 ? (1100 - e) / 200 : 1); return true; });
        return false;
      }
      return true;
    });
    return {
      aggiungi(d) { testo += d; voceAlta.aggiungi(d); },
      fine() { finito = true; voceAlta.fine(); if (!tr.dataset.sintesi) tr.dataset.sintesi = prima(testo); return fatto; },
      interrotta() { finito = true; testo = testo.trimEnd() + ' …'; voceAlta.zitto(); },
    };
  }
  function rispostaFissa(testo, { errore = false } = {}) {
    const tr = A.turno || nuovoTurno(); modo('riposo');
    const p = h('p', 'lumi-ai' + (errore ? ' lumi-err' : ''), `<i class="lumi-rombo"></i><span class="tx">${mdHtml(testo)}</span>`); tr.append(p);
    entra(p, { dy: 3, blur: 2, ms: 300 });
    if (!tr.dataset.sintesi) tr.dataset.sintesi = prima(testo);
    return p;
  }

  /* ---------- schede: una cifra, un elenco, la conferma, l'esito ---------- */
  function scheda(cls, html) { const tr = A.turno || nuovoTurno(); const s = h('div', 'lumi-scheda ' + cls, html); tr.append(s); segnala('scheda'); return s; }
  function mostraScheda(x) {
    if (x.tipo === 'numero') {
      const s = scheda('lumi-kpi', `<span class="lumi-lbl">${esc(x.titolo || '')}</span><b class="v"></b>${x.nota ? `<span class="d">${esc(x.nota)}</span>` : ''}`);
      const v = s.querySelector('.v'), valore = String(x.valore ?? ''), m = valore.match(/^(\D*?)(\d[\d.,'\s]*)(.*)$/);
      entra(s, { dy: 10, blur: 8, ms: 520, scala: 0.985 });
      // la cifra sale da zero, con lo stesso formato (separatori compresi)
      if (m && !RIDOTTO) {
        // «1.240 €», «€1,250.50», «12,5%»: separatori delle migliaia e decimali capiti dal formato, non dalla lingua
        const pulita = m[2].trim(), dopo = (m[2].match(/\s+$/)?.[0] || '') + m[3];
        let num, dec = 0;
        if (/^\d{1,3}([.,'\s]\d{3})+$/.test(pulita)) num = +pulita.replace(/\D/g, '');
        else { const md = pulita.match(/^(.*?)[.,](\d{1,2})$/); if (md) { num = +(md[1].replace(/\D/g, '') + '.' + md[2]); dec = md[2].length; } else num = +pulita.replace(/\D/g, ''); }
        if (Number.isFinite(num) && pulita.replace(/\D/g, '').length < 13) tween(900, e => { v.textContent = e >= 1 ? valore : m[1] + (num * e).toLocaleString(t.locale, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + dopo; }, { ritardo: 60 });
        else v.textContent = valore;
      } else v.textContent = valore;
      if (A.turno) A.turno.dataset.sintesi = valore;
      return;
    }
    const righe = (x.righe || []).slice(0, 12);
    const s = scheda('lumi-elenco', `<span class="lumi-lbl">${esc(x.titolo || t('mostra.elenco'))}</span>${righe.map(r => `<div class="lumi-el"><span class="t"><b>${esc(r.titolo || '—')}</b>${r.nota ? `<span>${esc(r.nota)}</span>` : ''}</span><span class="v">${esc(r.valore || '')}</span></div>`).join('')}`);
    entra(s, { dy: 10, blur: 8, ms: 500, scala: 0.985 });
    [...s.querySelectorAll('.lumi-el')].forEach((r, i) => entra(r, { ritardo: 80 + i * 60, dy: 6, blur: 5, ms: 440 }));
  }
  function schedaConferma({ titolo, righe = [], nota: n, avvisi = [] }) {
    const s = scheda('lumi-conf', `<h3>${esc(titolo)}</h3>
      <dl>${righe.map(r => (Array.isArray(r) ? r : [r?.etichetta ?? '', r?.valore ?? r])).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${avvisi.length ? `<ul class="lumi-avvisi" role="list">${avvisi.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      ${n ? `<p class="lumi-nota">${esc(n)}</p>` : ''}
      <div class="az"><button type="button" class="lumi-btn primario" data-lumi="si">${esc(t('conferma.si'))}</button><button type="button" class="lumi-btn piano" data-lumi="no">${esc(t('conferma.no'))}</button><small>${esc(ascolto.disponibile() ? t('conferma.voce') : t('conferma.scrivi'))}</small></div>
      <div class="tempo" aria-hidden="true"><i></i></div>`);
    s.setAttribute('role', 'alertdialog'); s.setAttribute('aria-label', titolo);
    s.querySelector('[data-lumi=si]').addEventListener('click', () => motore.conferma());
    s.querySelector('[data-lumi=no]').addEventListener('click', () => motore.annulla());
    // la barra si riempie in 8 secondi: il tempo per rispondere a voce; poi la proposta resta lì ad aspettare i pulsanti
    const g = GEN, barra = s.querySelector('.tempo i'), t0 = performance.now();
    ogni(ts => { if (g !== GEN || !s.isConnected || s.dataset.deciso) return false; barra.style.transform = `scaleX(${Math.min(1, (ts - t0) / 8000).toFixed(4)})`; return ts - t0 < 8000; });
    entra(s, { dy: 10, blur: 8, ms: 500, scala: 0.985 }).then(() => segnala('conferma-pronta'));
    s.querySelector('[data-lumi=si]').focus({ preventScroll: true });
    return s;
  }
  function mostraFatto(d = {}, dove) {
    if (dove) dove.dataset.deciso = '1';
    const f = h('div', 'lumi-fatto' + (d.no ? ' no' : ''), `${d.no ? IC.croce : IC.spunta}<b>${esc(d.testo || t('esito.fatto'))}</b>${d.nota ? `<span>${esc(d.nota)}</span>` : ''}`);
    if (dove) dove.replaceWith(f); else (A.turno || nuovoTurno()).append(f);
    const path = f.querySelector('path');
    if (A.turno) A.turno.dataset.sintesi = d.no ? t('riassunto.annullato') : String(d.testo || '').replace(/\.$/, '');
    segnala(d.no ? 'quiete' : 'fatto');
    caricaDaVedere().then(() => aggiornaPillola());
    return Promise.all([entra(f, { dy: 4, blur: 4, ms: 380 }), tween(420, e => { path.style.strokeDashoffset = (1 - e).toFixed(3); }, { ritardo: 80 })]);
  }
  function premi(b) {
    if (!b) return Promise.resolve();
    return tween(90, e => { b.style.transform = `scale(${1 - 0.04 * e})`; }, { ease: lineare }).then(() => tween(260, e => { b.style.transform = e >= 1 ? '' : `scale(${0.96 + 0.04 * e})`; }));
  }

  /* ---------- file trascinati sulla finestra, o incollati nel campo ---------- */
  function disegnaAllegati() {
    allegatiBox.innerHTML = '';
    for (const a of motore.M.allegati) {
      const c = h('span', `lumi-file ${a.stato}`, `${ico(a.icona || 'doc')}<span>${esc(a.nome)}</span><small>${a.stato === 'carica' ? esc(t('file.leggo')) : a.stato === 'errore' ? esc(a.errore) : a.modo === 'testo' ? esc(t('file.pronto')) : esc(t('file.caricato'))}</small>`);
      const x = h('button', '', IC.chiudi); x.type = 'button'; x.setAttribute('aria-label', t('file.togli', { nome: a.nome }));
      x.addEventListener('click', () => motore.togliAllegato(a));
      c.append(x); allegatiBox.append(c);
    }
  }
  async function aggiungiFile(lista) {
    if (!lista.length) return;
    if (!motore.puoChattare()) { mostraAvviso(t('file.nonDisponibile')); return; }
    if (!A.aperto) await apri({ fisso: true });
    await motore.aggiungiFile(lista);
    // appena letti, Lumi li guarda: con la domanda scritta nel campo, se c'è
    const inp = campo.querySelector('input');
    if (motore.M.allegati.some(a => a.stato === 'pronto') && !motore.M.attesa) { const q = inp.value; inp.value = ''; motore.chiedi(q); }
  }

  /* ---------- interazione ---------- */
  const occupato = () => motore.M.inCorso || !!motore.M.attesa || ascolto.stato !== 'spento' || motore.M.allegati.some(a => a.stato === 'carica') || Date.now() - motore.M.finitoIl < 2500
    || (shell.contains(document.activeElement) && document.activeElement.tagName === 'INPUT');
  const via = [];
  const su = (bersaglio, tipo, f, o) => { bersaglio.addEventListener(tipo, f, o); via.push(() => bersaglio.removeEventListener(tipo, f, o)); };
  async function parla(modoAscolto) {
    // parlare interrompe la risposta in corso (non una proposta che aspetta: a quella si risponde a voce)
    if (motore.M.inCorso && !motore.M.attesa && !motore.M.proponendo) motore.interrompi(); else voceAlta.zitto();
    if (!A.aperto) apri({ fisso: true });
    if (!ascolto.disponibile()) { campo.querySelector('input').focus(); mostraAvviso(t('mic.noVoce')); return; }
    nascondiHome(); modo('ascolto'); segnala('ascolto', { ms: 800 });
    const ok = await ascolto.avvia(modoAscolto);
    if (!ok && ascolto.stato === 'spento' && A.modo === 'ascolto') modo('riposo');
  }
  function collega() {
    su(shell, 'pointerenter', () => { A.chiudiTra?.(); A.chiudiTra = null; if (!A.aperto) { A.apriTra?.(); A.apriTra = dopo(70, () => { A.apriTra = null; apri(); }); } });
    su(shell, 'pointerleave', () => {
      A.apriTra?.(); A.apriTra = null;
      if (A.aperto && !A.fisso && !occupato()) { A.chiudiTra?.(); A.chiudiTra = dopo(420, () => { A.chiudiTra = null; if (!occupato() && !A.fisso) chiudi(); }); }
    });
    su(shell, 'pointermove', e => {
      const r = shell.getBoundingClientRect(); shell.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px'); shell.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
      const s = e.target.closest?.('.lumi-scheda'); if (s) { const q = s.getBoundingClientRect(); s.style.setProperty('--mx', (e.clientX - q.left).toFixed(0) + 'px'); s.style.setProperty('--my', (e.clientY - q.top).toFixed(0) + 'px'); }
    }, { passive: true });
    su(pill, 'click', () => apri({ fisso: true }));
    // un clic fuori dal pannello lo richiude (ma non mentre lavora, ascolta o aspetta una conferma)
    su(document, 'pointerdown', e => { if (A.aperto && !shell.contains(e.target) && !e.target.closest?.('.lumi-drop') && !motore.M.attesa && !motore.M.inCorso && ascolto.stato === 'spento') chiudi(); }, true);
    su(home, 'click', e => {
      const v = e.target.closest('[data-lumi-vedi]'), r = e.target.closest('[data-lumi-rapido]');
      if (v) { const x = A.dv[+v.dataset.lumiVedi]; if (x?.apri) { chiudi(); x.apri(); } }
      if (r) { const x = home._rapide?.[+r.dataset.lumiRapido]; if (x) { chiudi(); x.fai(); } }
    });
    su(campo.querySelector('.lumi-mic'), 'click', () => { if (ascolto.stato === 'ascolto') ascolto.ferma(true); else if (ascolto.stato === 'spento') parla('clic'); });
    const inp = campo.querySelector('input');
    su(inp, 'keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const q = inp.value; if (!q.trim() && !motore.M.allegati.some(a => a.stato === 'pronto')) return; inp.value = ''; motore.chiedi(q); } });
    su(inp, 'paste', e => { const f = [...(e.clipboardData?.files || [])]; if (f.length && op.file !== false) { e.preventDefault(); aggiungiFile(f); } });
    su(window, 'keydown', e => {
      if (!shell?.isConnected) return;
      if (eTastoParla(e)) { e.preventDefault(); e.stopPropagation(); if (e.repeat) return; if (ascolto.stato === 'ascolto' && ascolto.modo === 'clic') ascolto.ferma(true); else if (ascolto.stato === 'spento') parla('premi'); return; }
      if (e.key === 'Escape' && A.aperto) {
        if (ascolto.stato !== 'spento') { e.preventDefault(); ascolto.ferma(false); return; }
        if (motore.M.attesa) { e.preventDefault(); motore.annulla(); return; }
        if (motore.M.inCorso) { e.preventDefault(); motore.interrompi(); return; }
        chiudi();
      }
    }, true);
    su(window, 'keyup', e => { if (ascolto.modo === 'premi' && (ascolto.stato === 'ascolto' || ascolto.stato === 'avvio') && (e.code === 'Space' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift')) { e.preventDefault(); ascolto.ferma(true); } }, true);
    su(window, 'blur', () => { if (ascolto.modo === 'premi' && ascolto.stato !== 'spento' && !desk) ascolto.ferma(true); });
    su(window, 'resize', () => { if (A.aperto) { forma.w.t = larghezzaAperta(); molla(); } });
    su(window, 'pagehide', () => motore.eliminaFile());
    if (op.file !== false) {
      let dentro = 0;
      const conFile = e => [...(e.dataTransfer?.types || [])].includes('Files');
      su(window, 'dragenter', e => { if (!conFile(e)) return; dentro++; velo.classList.add('on'); });
      su(window, 'dragover', e => { if (!conFile(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      su(window, 'dragleave', e => { if (!conFile(e)) return; dentro = Math.max(0, dentro - 1); if (!dentro) velo.classList.remove('on'); });
      su(window, 'drop', e => { if (!conFile(e)) return; e.preventDefault(); dentro = 0; velo.classList.remove('on'); aggiungiFile([...e.dataTransfer.files]); });
    }
    // le cose da vedere cambiano con i dati: la pillola si aggiorna da sola
    const timer = setInterval(async () => { if (!shell?.isConnected || occupato()) return; await caricaDaVedere(); if (!A.aperto) aggiornaPillola(); else if (A.home) { disegnaHome(); aggiornaTesta(); } }, op.aggiorna ?? 30000);
    via.push(() => clearInterval(timer));
    // la shell desktop: la scorciatoia globale fa parlare anche quando la finestra non ha il fuoco
    if (desk?.suParla) via.push(desk.suParla(() => { if (ascolto.stato === 'ascolto') ascolto.ferma(true); else if (ascolto.stato === 'spento') parla('clic'); }) || (() => {}));
  }

  costruisci();
  caricaDaVedere().then(() => { aggiornaPillola(); if (A.home) { disegnaHome(); aggiornaTesta(); } });
  motore.servizio();

  return {
    apri: () => apri({ fisso: true }), chiudi: () => chiudi(),
    chiedi: x => { if (!A.aperto) apri({ fisso: true }); return motore.chiedi(x); },
    conferma: () => motore.conferma(), annulla: () => motore.annulla(), interrompi: () => motore.interrompi(), ricomincia: () => motore.ricomincia(),
    aggiorna: async () => { await caricaDaVedere(); aggiornaPillola(); if (A.aperto && A.home) { disegnaHome(); aggiornaTesta(); } },
    schermoCondiviso: v => { if (v === undefined) return motore.schermoCondiviso(); motore.impostaSchermoCondiviso(v); },
    voceAlta: v => { if (v === undefined) return A.voceAlta; A.voceAlta = !!v; try { localStorage.setItem('lumi:voce-alta', v ? '1' : '0'); } catch (e) { /* niente */ } if (!v) voceAlta.zitto(); },
    get stato() { return { aperto: A.aperto, modo: A.modo, inCorso: motore.M.inCorso, attesa: !!motore.M.attesa, voce: ascolto.stato, storia: motore.M.storia.length, servizio: motore.M.servizio, schermoCondiviso: motore.schermoCondiviso() }; },
    distruggi() { motore.ricomincia(); motore.eliminaFile(); via.forEach(f => f()); osservatore?.disconnect(); mascotte?.distruggi(); shell.remove(); velo?.remove(); cancelAnimationFrame(raf); giri.clear(); },
  };
}
