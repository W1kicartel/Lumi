// La prima scelta: «Questo PC tiene i dati» oppure «Collegati a Lumi in rete» (indirizzo o codice). Il controllo vero
// (l'indirizzo risponde ed è Lumi) lo fa main.mjs.
const $ = id => document.getElementById(id);
const scegli = async (richiesta, errore, bottone) => {
  errore.textContent = ''; bottone.disabled = true;
  try { const r = await window.gestionaleAvvio.scegli(richiesta); if (r?.errore) errore.textContent = r.errore; }
  catch { errore.textContent = 'Qualcosa non va: riprova.'; }
  finally { bottone.disabled = false; }
};
$('server').addEventListener('click', () => scegli({ modo: 'server' }, $('errore-server'), $('server')));
$('cliente').addEventListener('click', () => { $('collega').hidden = false; $('indirizzo').focus(); });
$('collega').addEventListener('submit', ev => { ev.preventDefault(); scegli({ modo: 'cliente', indirizzo: $('indirizzo').value }, $('errore'), ev.target.querySelector('.vai')); });
