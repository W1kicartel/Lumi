// Sicurezza nell'interfaccia: il cambio password obbligatorio (una finestra che non si chiude finché non la cambi), la
// pagina #/sicurezza con la propria password e i dispositivi collegati e, per il titolare, le impostazioni dell'azienda
// (inattività, allegati, fuso orario, webhook interni, budget di Lumi) e i poteri dei ruoli. Il fuso dell'azienda vale
// anche per le date mostrate e per OGGI() nelle formule del browser. Solo testo e h(): mai dati dentro innerHTML.
import { orologio } from '/motore/formule.js';
import { fusoUi } from '/ui.js';

let cssCaricato = false;
function caricaCss() { if (cssCaricato) return; cssCaricato = true; document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/sicurezza.css' })); }
const quando = v => (v ? new Date(v).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: fusoUi.fuso }) : '—');
// «Mozilla/5.0 (Macintosh…) … Chrome/130» → «Chrome su Mac»
function dispositivo(a) {
  const s = String(a || ''); if (!s) return 'Dispositivo sconosciuto';
  const b = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /Electron|Kubo/.test(s) ? 'App Kubo' : s.slice(0, 40);
  const o = /iPhone|iPad/.test(s) ? 'iPhone o iPad' : /Android/.test(s) ? 'Android' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return o ? `${b} su ${o}` : b;
}

// il modulo per cambiare la password: serve quella attuale, la nuova due volte
function moduloPassword(k, { dopo } = {}) {
  const { h } = k;
  const campo = (nome, auto) => h('input.campo', { type: 'password', name: nome, autocomplete: auto, required: true });
  const attuale = campo('attuale', 'current-password'), nuova = campo('nuova', 'new-password'), ancora = campo('ancora', 'new-password'), err = h('div');
  return h('form.sic-password', { on: { submit: async ev => {
    ev.preventDefault(); err.replaceChildren();
    if (nuova.value !== ancora.value) { err.replaceChildren(h('div.avviso', 'Le due password nuove non sono uguali')); return; }
    try { await k.api('POST', '/sicurezza/password', { attuale: attuale.value, nuova: nuova.value }); k.toast('Password cambiata. Gli altri dispositivi sono stati scollegati.'); dopo?.(); }
    catch (e) { err.replaceChildren(h('div.avviso', e.message)); }
  } } }, err,
    h('div.riga', h('label.etichetta', 'Password attuale'), attuale),
    h('div.riga', h('label.etichetta', 'Nuova password'), nuova, h('span.nota', 'Almeno 8 caratteri; sotto i 12 mescola lettere con cifre o simboli.')),
    h('div.riga', h('label.etichetta', 'Ripeti la nuova password'), ancora),
    h('button.btn.pieno', { type: 'submit' }, 'Cambia password'));
}

async function pagina(contenuto, k) {
  const { h, stato } = k, titolare = stato.utente.ruolo === 'titolare';
  const corpo = h('div.corpo.sic');
  contenuto.replaceChildren(h('div.testa', h('h1', 'Sicurezza')), corpo);
  const sessioni = h('div'), parti = [h('section.foglio', h('h2', 'La tua password'), moduloPassword(k, { dopo: () => pagina(contenuto, k) })), h('section.foglio', h('h2', 'Dispositivi collegati'), sessioni)];
  corpo.replaceChildren(...parti);
  async function disegnaSessioni() {
    const l = await k.get('/sicurezza/sessioni');
    sessioni.replaceChildren(...[h('div.sic-scorri', h('table.tabella.sic-tabella', h('thead', h('tr', h('th', 'Dispositivo'), h('th', 'Ultimo uso'), h('th', 'Indirizzo'), h('th', ''))),
      h('tbody', l.map(s => h('tr', h('td', dispositivo(s.agente), s.questa ? h('span.sic-questo', ' · questo') : null), h('td', quando(s.ultimo || s.inizio)), h('td.mono', s.ip || '—'),
        h('td', s.questa ? null : h('button.btn.piccolo.nudo', { on: { click: async () => { await k.api('DELETE', `/sicurezza/sessioni/${s.id}`); disegnaSessioni(); } } }, 'Scollega'))))))),
      l.length > 1 ? h('button.btn.sic-spazio', { on: { click: async () => { const r = await k.api('POST', '/sicurezza/esci-ovunque'); k.toast(r.chiuse === 1 ? 'Scollegato 1 dispositivo' : `Scollegati ${r.chiuse} dispositivi`); disegnaSessioni(); } } }, 'Scollega tutti gli altri') : null].filter(Boolean));
  }
  disegnaSessioni().catch(e => sessioni.replaceChildren(h('div.avviso', e.message)));
  if (titolare) corpo.append(await impostazioni(k), await ruoli(k));
  if (stato.poteri?.utenti) corpo.append(await persone(k));
}

async function impostazioni(k) {
  const { h } = k, x = await k.get('/sicurezza/impostazioni');
  const num = (v, min, max) => h('input.campo', { type: 'number', value: v, min, max, step: 1 });
  const inatt = num(x.inattivita, 5, 43200), mb = num(x.allegatoMb, 1, 25), budget = num(x.lumiBudget, 0, 1e10);
  const fusi = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Europe/Rome']; } })();
  const fuso = h('input.campo', { value: x.fuso, list: 'sic-fusi' }), interni = h('input', { type: 'checkbox', checked: x.webhookInterni });
  const err = h('div');
  return h('section.foglio', h('h2', 'Impostazioni dell\'azienda'), err,
    h('div.sic-griglia',
      h('label', h('span.etichetta', 'Chiudi le sessioni ferme da (minuti)'), inatt),
      h('label', h('span.etichetta', 'Allegati: al massimo (MB)'), mb),
      h('label', h('span.etichetta', 'Fuso orario'), fuso, h('datalist#sic-fusi', fusi.map(f => h('option', { value: f })))),
      h('label', h('span.etichetta', 'Lumi: token al mese (0 = senza limite)'), budget, h('span.nota', `Usati questo mese: ${Number(x.lumiUsati).toLocaleString('it-IT')}`))),
    h('label.sic-spunta', interni, h('span', 'Permetti i webhook verso la rete interna (127.0.0.1, 192.168…). Lascialo spento se non sai a cosa serve.')),
    h('button.btn.pieno.sic-spazio', { on: { click: async () => {
      err.replaceChildren();
      try { const r = await k.api('PUT', '/sicurezza/impostazioni', { inattivita: inatt.value, allegatoMb: mb.value, fuso: fuso.value, lumiBudget: budget.value, webhookInterni: interni.checked }); fusoUi.fuso = orologio.fuso = r.fuso; k.toast('Impostazioni salvate'); }
      catch (e) { err.replaceChildren(h('div.avviso', e.message)); }
    } } }, 'Salva'));
}

async function ruoli(k) {
  const { h } = k, l = await k.get('/sicurezza/ruoli');
  const spunta = (r, chiave) => h('input', { type: 'checkbox', checked: r[chiave], disabled: r.id === 'titolare', 'aria-label': `${chiave} per ${r.nome}`, on: { change: async ev => {
    try { await k.api('PUT', `/sicurezza/ruoli/${r.id}`, { [chiave]: ev.target.checked }); k.toast('Salvato'); } catch (e) { ev.target.checked = !ev.target.checked; k.toast(e.message); }
  } } });
  return h('section.foglio', h('h2', 'Poteri dei ruoli'), h('p.nota', 'Esportare la fattura elettronica consuma un numero d\'invio; Lumi usa i token dell\'azienda.'),
    h('div.sic-scorri', h('table.tabella.sic-tabella', h('thead', h('tr', h('th', 'Ruolo'), h('th', 'Esporta FatturaPA'), h('th', 'Usa Lumi'))),
      h('tbody', l.map(r => h('tr', h('td', r.nome), h('td', spunta(r, 'fatturapa')), h('td', spunta(r, 'lumi'))))))));
}

async function persone(k) {
  const { h } = k, l = (await k.get('/utenti')).filter(u => u.attivo && u.id !== k.stato.utente.id);
  const nomi = new Map((await k.get('/ruoli').catch(() => [])).map(r => [r.id, r.nome]));
  const azione = (u, corpo, ok) => async () => { try { await k.api('POST', `/sicurezza/utenti/${u.id}`, corpo); k.toast(ok); } catch (e) { k.toast(e.message); } };
  return h('section.foglio', h('h2', 'Persone'), l.length ? h('div.sic-scorri', h('table.tabella.sic-tabella', h('thead', h('tr', h('th', 'Nome'), h('th', 'Ruolo'), h('th', ''), h('th', ''))),
    h('tbody', l.map(u => h('tr', h('td', u.nome), h('td', nomi.get(u.ruolo) || u.ruolo),
      h('td', h('button.btn.piccolo.nudo', { on: { click: azione(u, { cambioObbligatorio: true }, `${u.nome} cambierà la password al prossimo accesso`) } }, 'Obbliga a cambiare password')),
      h('td', h('button.btn.piccolo.nudo', { on: { click: azione(u, { esciOvunque: true }, `${u.nome} è stato scollegato ovunque`) } }, 'Scollega ovunque'))))))) : h('p.nota', 'Nessun\'altra persona.'));
}

export default {
  nome: 'sicurezza',
  async avvio(k) {
    caricaCss();
    fusoUi.fuso = orologio.fuso = k.stato.fuso || 'Europe/Rome';
    const io = await k.get('/sicurezza/io').catch(() => null);
    if (!io?.deveCambiare) return;
    // finché non cambia la password, il resto non si usa: una finestra che copre tutto
    const { h } = k, finestra = h('div.sic-velo', h('div.scatola.sic-finestra', h('h1', 'Scegli la tua password'),
      h('p', 'La password che ti hanno dato era provvisoria. Scegline una tua per continuare.'), moduloPassword(k, { dopo: () => location.reload() })));
    document.body.append(finestra); finestra.querySelector('input')?.focus();
  },
  lato: () => [{ href: '#/sicurezza', icona: 'lucchetto', nome: 'Sicurezza' }],
  rotte: { sicurezza: (contenuto, k) => pagina(contenuto, k).catch(e => contenuto.replaceChildren(k.h('div.corpo', k.h('div.avviso', e.message)))) },
};
