// App desktop, rete, backup e aggiornamenti (lato interfaccia; il server è in server/moduli/desktop*.js).
//   #/rete     «Collega altri dispositivi»: l'indirizzo in rete, il codice da dettare e il QR da inquadrare col telefono
//   #/backup   le copie (scarica, ripristina, carica), la cartella dove vanno, il controllo delle versioni nuove
// Nell'app desktop (Electron) window.gestionaleDesktop dà la scelta della cartella con la finestra del sistema.
import { peso } from '/campi.js';
import { t, locale, fusoUi } from '/lingua.js';

const TIPI = ['giornaliero', 'modifica', 'manuale', 'sicurezza', 'caricato'];
const tipo = x => (TIPI.includes(x) ? t('desktop.tipo-' + x) : x);
const titolare = k => k.stato.utente?.ruolo === 'titolare';
const FORMA = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
const quando = iso => { try { return new Date(iso).toLocaleString(locale(), { ...FORMA, timeZone: fusoUi.fuso }); } catch { return new Date(iso).toLocaleString(locale(), FORMA); } };
// «adesso», «5 minuti fa», «ieri»… nella lingua di chi guarda, con Intl.RelativeTimeFormat
function fa(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000, rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  return s < 90 ? rtf.format(0, 'second') : s < 3600 ? rtf.format(-Math.round(s / 60), 'minute') : s < 86400 ? rtf.format(-Math.round(s / 3600), 'hour') : s < 172800 ? rtf.format(-1, 'day') : rtf.format(-Math.round(s / 86400), 'day');
}

// il QR come SVG: un solo tracciato con un quadratino per modulo scuro, e il margine bianco di 4 moduli
function svgQR(righe, lato = 196) {
  const n = righe.length + 8, NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path'), f = document.createElementNS(NS, 'rect');
  let d = ''; righe.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '1') d += `M${x + 4} ${y + 4}h1v1h-1z`; });
  s.setAttribute('viewBox', `0 0 ${n} ${n}`); s.setAttribute('width', lato); s.setAttribute('height', lato); s.setAttribute('shape-rendering', 'crispEdges'); s.setAttribute('class', 'desktop-qr');
  s.setAttribute('role', 'img'); s.setAttribute('aria-label', t('desktop.qr'));
  f.setAttribute('width', n); f.setAttribute('height', n); f.setAttribute('fill', '#fff'); p.setAttribute('d', d); p.setAttribute('fill', '#000');
  s.append(f, p); return s;
}

// ---------- collega altri dispositivi ----------
async function paginaRete(contenuto, k) {
  const { h, get, toast } = k;
  contenuto.replaceChildren(h('div.testa', h('h1', t('desktop.rete-titolo'))), h('div.corpo', h('p.nota', t('desktop.un-momento'))));
  let r; try { r = await get('/desktop/rete'); } catch (e) { contenuto.querySelector('.corpo').replaceChildren(h('div.avviso', e.message)); return; }
  const copia = testo => async () => { try { await navigator.clipboard.writeText(testo); toast(t('desktop.copiato')); } catch { toast(t('desktop.copia-fallita'), true); } };
  const schede = r.indirizzi.map((x, i) => h('div.foglio.desktop-indirizzo', svgQR(x.qr),
    h('div.desktop-testo',
      i === 0 ? h('div.etichetta', t('desktop.indirizzo')) : h('div.etichetta', t('desktop.altra-rete')),
      h('div.desktop-url.mono', { testo: x.url.replace(/\/$/, '') }),
      h('div.desktop-azioni', h('button.btn.piccolo', { type: 'button', on: { click: copia(x.url) } }, t('desktop.copia-indirizzo')),
        x.codice ? h('span.desktop-codice', t('desktop.codice') + ' ', h('b.mono', { testo: x.codice })) : null),
      h('ol.desktop-passi',
        h('li', h('b', t('desktop.passo-telefono') + ' '), t('desktop.passo-telefono-testo')),
        h('li', h('b', t('desktop.passo-computer') + ' '), x.codice ? t('desktop.passo-computer-codice') : t('desktop.passo-computer-indirizzo'))))));
  const fuori = !r.inRete ? h('div.foglio', h('b', t('desktop.solo-qui')),
    h('p.nota', t('desktop.apri-rete') + ' ' + t('desktop.da-terminale') + ' ', h('span.mono', 'npm start -- --rete'))) : null;
  contenuto.querySelector('.corpo').replaceChildren(h('div.desktop-rete', fuori, ...schede,
    r.inRete && !schede.length ? h('div.vuoto', t('desktop.non-in-rete')) : null,
    schede.length ? h('p.nota', t('desktop.stessa-rete')) : null));
}

// ---------- backup ----------
async function paginaBackup(contenuto, k) {
  const { h, api, get, toast, icona } = k;
  const corpo = h('div.corpo.desktop-backup'), adesso = h('button.btn.pieno', { type: 'button', on: { click: () => fai() } }, t('desktop.fai-adesso'));
  contenuto.replaceChildren(h('div.testa', h('h1', t('desktop.backup')), adesso), corpo);
  let s, v;
  async function carica() {
    try { [s, v] = await Promise.all([get('/backup'), get('/aggiornamenti')]); } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; }
    disegna();
  }
  async function fai() {
    adesso.disabled = true; adesso.textContent = t('desktop.copia-in-corso');
    try { s = await api('POST', '/backup'); toast(t('desktop.fatto')); disegna(); } catch (e) { toast(e.message, true); }
    finally { adesso.disabled = false; adesso.textContent = t('desktop.fai-adesso'); }
  }
  function disegna() {
    const ultimo = s.elenco[0];
    const stato = h('div.foglio.desktop-stato',
      h('div', h('div.etichetta', t('desktop.ultimo')), h('div.desktop-grande', ultimo ? fa(ultimo.quando) : t('desktop.nessuno-ancora')), ultimo ? h('div.nota', { testo: quando(ultimo.quando) }) : null),
      h('div', h('div.etichetta', t('desktop.copie-tenute')), h('div.desktop-grande', String(s.elenco.length)), h('div.nota', { testo: t('desktop.in-tutto', { peso: peso(s.elenco.reduce((a, b) => a + b.dimensione, 0)) }) })),
      h('p.nota.desktop-spiega', s.automatici ? t('desktop.spiega-automatici', { giornalieri: s.limiti.giornalieri, settimanali: s.limiti.settimanali, mensili: s.limiti.mensili })
        : t('desktop.spiega-spenti')));
    const errore = s.errore?.testo ? h('div.avviso', { testo: s.errore.testo }) : null;
    corpo.replaceChildren(...[errore, stato, cartella(), elenco(), caricaFile(), versioni()].filter(Boolean));
  }

  function cartella() {
    const campo = h('input.campo.mono', { value: s.esterna ? s.cartella : '', placeholder: t('desktop.cartella-esempio', { a: '/Volumes/Disco/Lumi', b: 'D:\\Backup\\Lumi' }) });
    const salva = async valore => { try { s = await api('PUT', '/backup/cartella', { cartella: valore }); toast(valore ? t('desktop.cartella-nuova') : t('desktop.cartella-tornata')); disegna(); } catch (e) { toast(e.message, true); } };
    const scegli = window.gestionaleDesktop?.scegliCartella ? h('button.btn', { type: 'button', on: { click: async () => { const c = await window.gestionaleDesktop.scegliCartella(); if (c) salva(c); } } }, t('desktop.scegli-cartella')) : null;
    return h('div.foglio', h('div.etichetta', t('desktop.dove')), h('div.desktop-cartella.mono', { testo: s.cartella || t('desktop.in-memoria') }),
      h('p.nota', s.esterna ? t('desktop.nota-esterna') : t('desktop.nota-accanto')),
      h('div.desktop-riga', scegli || campo, scegli ? null : h('button.btn', { type: 'button', on: { click: () => salva(campo.value) } }, t('desktop.usa-cartella')),
        s.esterna ? h('button.btn.nudo', { type: 'button', on: { click: () => salva('') } }, t('desktop.torna-accanto')) : null));
  }

  function elenco() {
    if (!s.elenco.length) return h('div.vuoto', t('desktop.vuoto'));
    return h('div.desktop-scorri', h('table.tabella.desktop-tabella', h('thead', h('tr', h('th', t('desktop.col-quando')), h('th', t('desktop.col-tipo')), h('th', t('desktop.col-dimensione')), h('th', ''))),
      h('tbody', s.elenco.map(b => h('tr', h('td', { testo: quando(b.quando), title: b.nome }), h('td', { testo: tipo(b.tipo) + (b.accanto ? ' · ' + t('desktop.accanto-ai-dati') : '') }), h('td', { testo: peso(b.dimensione) }),
        h('td.desktop-azioni-riga', h('a.btn.piccolo.nudo', { href: `/api/backup/file/${encodeURIComponent(b.nome)}`, download: b.nome }, t('desktop.scarica')),
          h('button.btn.piccolo', { type: 'button', on: { click: () => ripristina(b) } }, t('desktop.ripristina')),
          h('button.btn.piccolo.nudo.elimina', { type: 'button', title: t('desktop.elimina'), 'aria-label': t('desktop.elimina'), on: { click: () => elimina(b) } }, '×')))))));
  }
  async function elimina(b) {
    if (!confirm(t('desktop.elimina-conferma', { quando: quando(b.quando) }))) return;
    try { s = await api('DELETE', `/backup/file/${encodeURIComponent(b.nome)}`); toast(t('desktop.eliminato')); disegna(); } catch (e) { toast(e.message, true); }
  }

  function ripristina(b) {
    const capito = h('input', { type: 'checkbox' }), vai = h('button.btn.pieno.pericolo-pieno', { type: 'button', disabled: true }, t('desktop.ripristina'));
    const err = h('div'), d = h('dialog.desktop-dialogo',
      h('h2', t('desktop.ripristino-titolo')),
      h('p', t('desktop.ripristino-prima') + ' ', h('b', { testo: quando(b.quando) }), t('desktop.ripristino-dopo')),
      h('p.nota', t('desktop.ripristino-nota', { tipo: t('desktop.tipo-sicurezza') })),
      err, h('label.desktop-capito', capito, ' ' + t('desktop.capito')),
      h('div.desktop-riga', h('button.btn', { type: 'button', on: { click: () => d.close() } }, t('desktop.annulla')), vai));
    capito.addEventListener('change', () => { vai.disabled = !capito.checked; });
    vai.addEventListener('click', async () => {
      vai.disabled = true; vai.textContent = t('desktop.ripristino-in-corso'); err.replaceChildren();
      try { await api('POST', '/backup/ripristina', { nome: b.nome, conferma: true }); d.close(); toast(t('desktop.ripristinato')); setTimeout(() => { location.hash = '#/backup'; location.reload(); }, 600); }
      catch (e) { err.replaceChildren(h('div.avviso', e.message)); vai.textContent = t('desktop.ripristina'); vai.disabled = false; }
    });
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
  }

  function caricaFile() {
    const avanza = h('progress', { max: 1, value: 0, hidden: true }), esito = h('div');
    const input = h('input', { type: 'file', accept: '.db,.sqlite,application/vnd.sqlite3,application/x-sqlite3', hidden: true, on: { change: () => input.files[0] && manda(input.files[0]) } });
    async function manda(file) {
      esito.replaceChildren(); avanza.hidden = false; avanza.value = 0;
      try {
        const a = await api('POST', '/backup/carica', { nome: file.name, dimensione: file.size }); let da = 0, ult;
        while (da < file.size) {
          const pezzo = file.slice(da, da + a.pezzo);
          const b64 = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = no; fr.readAsDataURL(pezzo); });
          ult = await api('POST', `/backup/carica/${a.id}`, { da, pezzo: b64 }); da += pezzo.size; avanza.value = da / file.size;
        }
        s = await get('/backup'); disegna();
        toast(t('desktop.caricato', { azienda: ult.info.azienda || 'Lumi', persone: t('desktop.persone', { n: ult.info.utenti }), sezioni: t('desktop.sezioni', { n: ult.info.sezioni }) }));
      } catch (e) { avanza.hidden = true; esito.replaceChildren(h('div.avviso', e.message)); }
      input.value = '';
    }
    return h('div.foglio', h('div.etichetta', t('desktop.carica')), h('p.nota', t('desktop.carica-nota')),
      esito, h('div.desktop-riga', h('button.btn', { type: 'button', on: { click: () => input.click() } }, icona('cartella'), t('desktop.scegli-file')), avanza), input);
  }

  function versioni() {
    const acceso = h('input', { type: 'checkbox', checked: v.attivo });
    const esito = v.esito?.errore ? h('span.nota', { testo: v.esito.errore }) : v.esito?.nuova ? h('span', t('desktop.uscita-versione') + ' ', h('b', { testo: v.esito.ultima.versione }), ' · ', h('a', { href: v.esito.ultima.url, target: '_blank', rel: 'noopener noreferrer' }, t('desktop.novita')))
      : v.esito ? h('span.nota', t('desktop.aggiornato')) : null;
    acceso.addEventListener('change', async () => { try { v = await api('PUT', '/aggiornamenti', { attivo: acceso.checked }); disegna(); } catch (e) { toast(e.message, true); acceso.checked = !acceso.checked; } });
    return h('div.foglio', h('div.etichetta', t('desktop.versioni')), h('p', t('desktop.stai-usando') + ' ', h('b.mono', { testo: v.versione })),
      h('label.desktop-capito', acceso, ' ' + t('desktop.controlla-ogni-giorno')),
      h('p.nota', t('desktop.versioni-nota')),
      h('div.desktop-riga', v.attivo ? h('button.btn.piccolo', { type: 'button', on: { click: async ev => { ev.target.disabled = true; try { v = await api('POST', '/aggiornamenti/controlla'); disegna(); } catch (e) { toast(e.message, true); ev.target.disabled = false; } } } }, t('desktop.controlla-adesso')) : null, esito));
  }
  carica();
}

// l'avviso di una versione nuova, per il titolare, una volta per versione
async function avvisaVersione(k) {
  if (!titolare(k)) return;
  let v; try { v = await k.get('/aggiornamenti'); } catch { return; }
  const nuova = v.esito?.nuova && v.esito.ultima?.versione; if (!nuova) return;
  try { if (localStorage.getItem('lumi.versione.vista') === nuova) return; } catch {}
  const { h } = k, chiudi = () => { try { localStorage.setItem('lumi.versione.vista', nuova); } catch {} a.remove(); };
  const a = h('div.desktop-avviso', h('span', t('desktop.avviso-versione') + ' ', h('b', { testo: nuova })), h('a', { href: '#/backup', on: { click: chiudi } }, t('desktop.dettagli')),
    h('button.btn.nudo.piccolo', { type: 'button', title: t('desktop.chiudi'), 'aria-label': t('desktop.chiudi'), on: { click: chiudi } }, '×'));
  document.body.append(a);
}

export default {
  nome: 'desktop',
  avvio(k) {
    if (!document.querySelector('link[data-modulo=desktop]')) { const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/desktop.css' }); l.dataset.modulo = 'desktop'; document.head.append(l); }
    // un ripristino fatto da un altro: i dati sotto sono cambiati, si ricarica
    window.addEventListener('gestionale:evento', ev => { if (ev.detail?.tipo === 'ripristinato' && ev.detail.da !== k.stato.utente.id) { k.toast(t('desktop.ripristinato-altro')); setTimeout(() => location.reload(), 1500); } });
    avvisaVersione(k);
  },
  lato(k) {
    if (!titolare(k) && !k.stato.poteri?.utenti) return [];
    return [{ href: '#/rete', icona: 'griglia', nome: t('desktop.lato-rete') }, titolare(k) ? { href: '#/backup', icona: 'cartella', nome: t('desktop.backup') } : null].filter(Boolean);
  },
  rotte: {
    rete: (contenuto, k) => paginaRete(contenuto, k),
    backup: (contenuto, k) => (titolare(k) ? paginaBackup(contenuto, k) : contenuto.replaceChildren(k.h('div.corpo', k.h('div.vuoto', t('desktop.solo-titolare'))))),
  },
};
