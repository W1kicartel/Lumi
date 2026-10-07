// App desktop, rete, backup e aggiornamenti (lato interfaccia; il server è in server/moduli/desktop*.js).
//   #/rete     «Collega altri dispositivi»: l'indirizzo in rete, il codice da dettare e il QR da inquadrare col telefono
//   #/backup   le copie (scarica, ripristina, carica), la cartella dove vanno, il controllo delle versioni nuove
// Nell'app desktop (Electron) window.kuboDesktop dà la scelta della cartella con la finestra del sistema.
import { peso } from '/campi.js';

const TIPI = { giornaliero: 'Del giorno', modifica: 'Prima di una modifica', manuale: 'Fatto a mano', sicurezza: 'Prima di un ripristino', caricato: 'Caricato da fuori' };
const titolare = k => k.stato.utente?.ruolo === 'titolare';
const quando = iso => new Date(iso).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function fa(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 90 ? 'adesso' : s < 3600 ? `${Math.round(s / 60)} minuti fa` : s < 86400 ? `${Math.round(s / 3600)} ore fa` : s < 172800 ? 'ieri' : `${Math.round(s / 86400)} giorni fa`;
}

// il QR come SVG: un solo tracciato con un quadratino per modulo scuro, e il margine bianco di 4 moduli
function svgQR(righe, lato = 196) {
  const n = righe.length + 8, NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path'), f = document.createElementNS(NS, 'rect');
  let d = ''; righe.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '1') d += `M${x + 4} ${y + 4}h1v1h-1z`; });
  s.setAttribute('viewBox', `0 0 ${n} ${n}`); s.setAttribute('width', lato); s.setAttribute('height', lato); s.setAttribute('shape-rendering', 'crispEdges'); s.setAttribute('class', 'desktop-qr');
  s.setAttribute('role', 'img'); s.setAttribute('aria-label', 'Codice QR con l\'indirizzo');
  f.setAttribute('width', n); f.setAttribute('height', n); f.setAttribute('fill', '#fff'); p.setAttribute('d', d); p.setAttribute('fill', '#000');
  s.append(f, p); return s;
}

// ---------- collega altri dispositivi ----------
async function paginaRete(contenuto, k) {
  const { h, get, toast } = k;
  contenuto.replaceChildren(h('div.testa', h('h1', 'Collega altri dispositivi')), h('div.corpo', h('p.nota', 'Un momento…')));
  let r; try { r = await get('/desktop/rete'); } catch (e) { contenuto.querySelector('.corpo').replaceChildren(h('div.avviso', e.message)); return; }
  const copia = testo => async () => { try { await navigator.clipboard.writeText(testo); toast('Copiato'); } catch { toast('Copia non riuscita: selezionalo a mano', true); } };
  const schede = r.indirizzi.map((x, i) => h('div.foglio.desktop-indirizzo', svgQR(x.qr),
    h('div.desktop-testo',
      i === 0 ? h('div.etichetta', 'Indirizzo') : h('div.etichetta', 'Oppure, su un\'altra rete dell\'ufficio'),
      h('div.desktop-url.mono', { testo: x.url.replace(/\/$/, '') }),
      h('div.desktop-azioni', h('button.btn.piccolo', { type: 'button', on: { click: copia(x.url) } }, 'Copia l\'indirizzo'),
        x.codice ? h('span.desktop-codice', 'Codice ', h('b.mono', { testo: x.codice })) : null),
      h('ol.desktop-passi',
        h('li', h('b', 'Telefono o tablet: '), 'inquadra il codice con la fotocamera e tocca il collegamento.'),
        h('li', h('b', 'Un altro computer: '), 'apri il browser e scrivi l\'indirizzo. Con l\'app Kubo scegli «Collegati a un Kubo in rete» e scrivi ', x.codice ? 'il codice.' : 'l\'indirizzo.')))));
  const fuori = !r.inRete ? h('div.foglio', h('b', 'Adesso Kubo risponde solo a questo computer.'),
    h('p.nota', 'Per usarlo anche dagli altri dispositivi, nell\'app Kubo apri il menu nella barra in alto (o nell\'area di notifica) e accendi «Aperto alla rete locale». Se lo avvii da terminale: ', h('span.mono', 'npm start -- --rete'), '.')) : null;
  contenuto.querySelector('.corpo').replaceChildren(h('div.desktop-rete', fuori, ...schede,
    r.inRete && !schede.length ? h('div.vuoto', 'Questo computer non sembra collegato a una rete. Collegalo al Wi-Fi o al cavo dell\'ufficio e ricarica la pagina.') : null,
    schede.length ? h('p.nota', 'Gli altri dispositivi devono essere sulla stessa rete (lo stesso Wi-Fi o lo stesso cavo). Se non si collegano, controlla che il firewall di questo computer lasci passare Kubo.') : null));
}

// ---------- backup ----------
async function paginaBackup(contenuto, k) {
  const { h, api, get, toast, icona } = k;
  const corpo = h('div.corpo.desktop-backup'), adesso = h('button.btn.pieno', { type: 'button', on: { click: () => fai() } }, 'Fai un backup adesso');
  contenuto.replaceChildren(h('div.testa', h('h1', 'Backup'), adesso), corpo);
  let s, v;
  async function carica() {
    try { [s, v] = await Promise.all([get('/backup'), get('/aggiornamenti')]); } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; }
    disegna();
  }
  async function fai() {
    adesso.disabled = true; adesso.textContent = 'Copia in corso…';
    try { s = await api('POST', '/backup'); toast('Backup fatto'); disegna(); } catch (e) { toast(e.message, true); }
    finally { adesso.disabled = false; adesso.textContent = 'Fai un backup adesso'; }
  }
  function disegna() {
    const ultimo = s.elenco[0];
    const stato = h('div.foglio.desktop-stato',
      h('div', h('div.etichetta', 'Ultimo backup'), h('div.desktop-grande', ultimo ? fa(ultimo.quando) : 'Ancora nessuno'), ultimo ? h('div.nota', { testo: quando(ultimo.quando) }) : null),
      h('div', h('div.etichetta', 'Copie tenute'), h('div.desktop-grande', String(s.elenco.length)), h('div.nota', { testo: peso(s.elenco.reduce((a, b) => a + b.dimensione, 0)) + ' in tutto' })),
      h('p.nota.desktop-spiega', s.automatici ? `Ogni giorno Kubo fa da solo una copia del database, e una prima di ogni modifica alla struttura o di un import. Tiene ${s.limiti.giornalieri} copie giornaliere, ${s.limiti.settimanali} settimanali e ${s.limiti.mensili} mensili; quelle fatte a mano restano finché non le elimini. Gli allegati vanno nella cartella «allegati», copiando solo quelli nuovi.`
        : 'I backup automatici sono spenti (KUBO_BACKUP=0): ricordati di farli a mano o con i tuoi strumenti.'));
    const errore = s.errore?.testo ? h('div.avviso', { testo: s.errore.testo }) : null;
    corpo.replaceChildren(...[errore, stato, cartella(), elenco(), caricaFile(), versioni()].filter(Boolean));
  }

  function cartella() {
    const campo = h('input.campo.mono', { value: s.esterna ? s.cartella : '', placeholder: 'Per esempio /Volumes/Disco/Kubo oppure D:\\Backup\\Kubo' });
    const salva = async valore => { try { s = await api('PUT', '/backup/cartella', { cartella: valore }); toast(valore ? 'Da adesso i backup vanno lì' : 'I backup tornano accanto ai dati'); disegna(); } catch (e) { toast(e.message, true); } };
    const scegli = window.kuboDesktop?.scegliCartella ? h('button.btn', { type: 'button', on: { click: async () => { const c = await window.kuboDesktop.scegliCartella(); if (c) salva(c); } } }, 'Scegli una cartella…') : null;
    return h('div.foglio', h('div.etichetta', 'Dove vanno i backup'), h('div.desktop-cartella.mono', { testo: s.cartella || '(database in memoria: niente backup)' }),
      h('p.nota', s.esterna ? 'Una cartella scelta da te. Se il disco non è collegato, la copia del giorno va accanto ai dati e qui compare un avviso.'
        : 'Accanto ai dati, su questo computer. Meglio una seconda copia altrove: un disco esterno, oppure una cartella sincronizzata (Dropbox, OneDrive, iCloud, Google Drive).'),
      h('div.desktop-riga', scegli || campo, scegli ? null : h('button.btn', { type: 'button', on: { click: () => salva(campo.value) } }, 'Usa questa cartella'),
        s.esterna ? h('button.btn.nudo', { type: 'button', on: { click: () => salva('') } }, 'Torna accanto ai dati') : null));
  }

  function elenco() {
    if (!s.elenco.length) return h('div.vuoto', 'Nessun backup ancora. Il primo arriva da solo entro pochi minuti, oppure fallo adesso.');
    return h('div.desktop-scorri', h('table.tabella.desktop-tabella', h('thead', h('tr', h('th', 'Quando'), h('th', 'Tipo'), h('th', 'Dimensione'), h('th', ''))),
      h('tbody', s.elenco.map(b => h('tr', h('td', { testo: quando(b.quando), title: b.nome }), h('td', { testo: TIPI[b.tipo] || b.tipo }), h('td', { testo: peso(b.dimensione) }),
        h('td.desktop-azioni-riga', h('a.btn.piccolo.nudo', { href: `/api/backup/file/${encodeURIComponent(b.nome)}`, download: b.nome }, 'Scarica'),
          h('button.btn.piccolo', { type: 'button', on: { click: () => ripristina(b) } }, 'Ripristina'),
          h('button.btn.piccolo.nudo.elimina', { type: 'button', title: 'Elimina questo backup', 'aria-label': 'Elimina questo backup', on: { click: () => elimina(b) } }, '×')))))));
  }
  async function elimina(b) {
    if (!confirm(`Eliminare il backup del ${quando(b.quando)}? Non si potrà più ripristinare.`)) return;
    try { s = await api('DELETE', `/backup/file/${encodeURIComponent(b.nome)}`); toast('Backup eliminato'); disegna(); } catch (e) { toast(e.message, true); }
  }

  function ripristina(b) {
    const capito = h('input', { type: 'checkbox' }), vai = h('button.btn.pieno.pericolo-pieno', { type: 'button', disabled: true }, 'Ripristina');
    const err = h('div'), d = h('dialog.desktop-dialogo',
      h('h2', 'Tornare a questo backup?'),
      h('p', 'Il gestionale tornerà com\'era ', h('b', { testo: quando(b.quando) }), '. Tutto quello che è stato fatto dopo sparisce dalla vista.'),
      h('p.nota', 'Prima Kubo fa una copia di adesso («Prima di un ripristino»): se cambi idea, ripristini quella e non perdi niente. Chi sta lavorando sugli altri dispositivi vedrà la pagina ricaricarsi.'),
      err, h('label.desktop-capito', capito, ' Ho capito, voglio tornare a quel momento'),
      h('div.desktop-riga', h('button.btn', { type: 'button', on: { click: () => d.close() } }, 'Annulla'), vai));
    capito.addEventListener('change', () => { vai.disabled = !capito.checked; });
    vai.addEventListener('click', async () => {
      vai.disabled = true; vai.textContent = 'Ripristino in corso…'; err.replaceChildren();
      try { await api('POST', '/backup/ripristina', { nome: b.nome, conferma: true }); d.close(); toast('Ripristinato'); setTimeout(() => { location.hash = '#/backup'; location.reload(); }, 600); }
      catch (e) { err.replaceChildren(h('div.avviso', e.message)); vai.textContent = 'Ripristina'; vai.disabled = false; }
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
        toast(`Backup caricato: ${ult.info.azienda || 'Kubo'}, ${ult.info.utenti} persone, ${ult.info.sezioni} sezioni. Lo trovi in cima all'elenco.`);
      } catch (e) { avanza.hidden = true; esito.replaceChildren(h('div.avviso', e.message)); }
      input.value = '';
    }
    return h('div.foglio', h('div.etichetta', 'Carica un backup'), h('p.nota', 'Un file .db scaricato da qui, anche da un altro computer. Kubo lo controlla e lo mette nell\'elenco: poi scegli tu se ripristinarlo.'),
      esito, h('div.desktop-riga', h('button.btn', { type: 'button', on: { click: () => input.click() } }, icona('cartella'), 'Scegli il file…'), avanza), input);
  }

  function versioni() {
    const acceso = h('input', { type: 'checkbox', checked: v.attivo });
    const esito = v.esito?.errore ? h('span.nota', { testo: v.esito.errore }) : v.esito?.nuova ? h('span', 'È uscita la versione ', h('b', { testo: v.esito.ultima.versione }), ' · ', h('a', { href: v.esito.ultima.url, target: '_blank', rel: 'noopener noreferrer' }, 'cosa c\'è di nuovo'))
      : v.esito ? h('span.nota', 'Hai l\'ultima versione.') : null;
    acceso.addEventListener('change', async () => { try { v = await api('PUT', '/aggiornamenti', { attivo: acceso.checked }); disegna(); } catch (e) { toast(e.message, true); acceso.checked = !acceso.checked; } });
    return h('div.foglio', h('div.etichetta', 'Versioni nuove'), h('p', 'Stai usando Kubo ', h('b.mono', { testo: v.versione }), '.'),
      h('label.desktop-capito', acceso, ' Controlla ogni giorno se è uscita una versione nuova e avvisami'),
      h('p.nota', 'Kubo chiede solo il numero dell\'ultima versione pubblicata su GitHub: non manda dati dell\'azienda e non installa niente da solo. Aggiorni tu, quando vuoi, dopo un backup.'),
      h('div.desktop-riga', v.attivo ? h('button.btn.piccolo', { type: 'button', on: { click: async ev => { ev.target.disabled = true; try { v = await api('POST', '/aggiornamenti/controlla'); disegna(); } catch (e) { toast(e.message, true); ev.target.disabled = false; } } } }, 'Controlla adesso') : null, esito));
  }
  carica();
}

// l'avviso di una versione nuova, per il titolare, una volta per versione
async function avvisaVersione(k) {
  if (!titolare(k)) return;
  let v; try { v = await k.get('/aggiornamenti'); } catch { return; }
  const nuova = v.esito?.nuova && v.esito.ultima?.versione; if (!nuova) return;
  try { if (localStorage.getItem('kubo.versione.vista') === nuova) return; } catch {}
  const { h } = k, chiudi = () => { try { localStorage.setItem('kubo.versione.vista', nuova); } catch {} a.remove(); };
  const a = h('div.desktop-avviso', h('span', 'È uscita Kubo ', h('b', { testo: nuova })), h('a', { href: '#/backup', on: { click: chiudi } }, 'Dettagli'),
    h('button.btn.nudo.piccolo', { type: 'button', title: 'Chiudi', 'aria-label': 'Chiudi', on: { click: chiudi } }, '×'));
  document.body.append(a);
}

export default {
  nome: 'desktop',
  avvio(k) {
    if (!document.querySelector('link[data-modulo=desktop]')) { const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/desktop.css' }); l.dataset.modulo = 'desktop'; document.head.append(l); }
    // un ripristino fatto da un altro: i dati sotto sono cambiati, si ricarica
    window.addEventListener('kubo:evento', ev => { if (ev.detail?.tipo === 'ripristinato' && ev.detail.da !== k.stato.utente.id) { k.toast('Il titolare ha ripristinato un backup: ricarico…'); setTimeout(() => location.reload(), 1500); } });
    avvisaVersione(k);
  },
  lato(k) {
    if (!titolare(k) && !k.stato.poteri?.utenti) return [];
    return [{ href: '#/rete', icona: 'griglia', nome: 'Collega dispositivi' }, titolare(k) ? { href: '#/backup', icona: 'cartella', nome: 'Backup' } : null].filter(Boolean);
  },
  rotte: {
    rete: (contenuto, k) => paginaRete(contenuto, k),
    backup: (contenuto, k) => (titolare(k) ? paginaBackup(contenuto, k) : contenuto.replaceChildren(k.h('div.corpo', k.h('div.vuoto', 'I backup li gestisce il titolare.')))),
  },
};
