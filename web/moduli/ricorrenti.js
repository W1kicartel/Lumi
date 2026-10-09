// I contratti ricorrenti nell'interfaccia: la pagina #/ricorrenti (prepara la sezione, fatture dovute adesso, giro automatico)
// e il bottone «Fatture dovute» in testa alla lista dei contratti. Le fatture le crea il server (server/moduli/ricorrenti.js).
import { t, soldi, data } from '../lingua.js';

const CONTRATTI = 'contratti_ricorrenti';
const metti = (dove, ...x) => dove.replaceChildren(...x.flat().filter(Boolean));
let cssCaricato = false;
const caricaCss = () => { if (cssCaricato) return; cssCaricato = true; document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/ricorrenti.css' })); };

async function pagina(contenuto, k) {
  caricaCss();
  const { h, get, api, toast } = k;
  const corpo = h('div.corpo.ricorrenti');
  contenuto.replaceChildren(h('div.testa', h('h1', t('ricorrenti.titolo'))), corpo);
  const ridisegna = () => pagina(contenuto, k);
  try {
    const imp = await get('/ricorrenti/impostazioni');
    const scheda = (...x) => h('section.ricorrenti-scheda', ...x);
    if (!imp.pronti) {
      if (!imp.fatture) return metti(corpo, scheda(h('p', t('ricorrenti.serve-fatture'))));
      return metti(corpo, scheda(h('p', t('ricorrenti.nota')), imp.puo.prepara ? h('button.btn.pieno', { testo: t('ricorrenti.prepara'), on: { click: async () => {
        try { await api('POST', '/ricorrenti/prepara'); await k.ricaricaSchema(); location.hash = `#/e/${CONTRATTI}`; } catch (e) { toast(e.message, true); } } } }) : h('p.nota', t('ricorrenti.chiedi-titolare'))));
    }
    const l = await get('/ricorrenti/dovuti'), quante = l.reduce((s, c) => s + c.periodi.length, 0);
    const genera = async ev => { ev.target.disabled = true; try { const x = await api('POST', '/ricorrenti/genera', {}); toast(t('ricorrenti.create', { n: x.fatte.length })); ridisegna(); } catch (e) { toast(e.message, true); ev.target.disabled = false; } };
    const automatico = h('label.ricorrenti-spunta', h('input', { type: 'checkbox', checked: imp.automatico, disabled: !imp.puo.prepara, on: { change: async ev => {
      try { await api('PUT', '/ricorrenti/impostazioni', { automatico: ev.target.checked }); toast(t('ricorrenti.salvato')); } catch (e) { toast(e.message, true); } } } }), t('ricorrenti.automatico'));
    metti(corpo,
      scheda(h('h2', t('ricorrenti.dovute', { n: quante })), quante ? h('ul.ricorrenti-elenco', l.flatMap(c => c.periodi.map(p => h('li', h('time', data(p.data)), h('span', `${c.cliente.nome} · ${c.descrizione}`),
        h('small', c.emetti === 'emessa' ? t('ricorrenti.emessa') : t('ricorrenti.bozza')), h('b', soldi(c.importo)))))) : h('p.nota', t('ricorrenti.niente')),
        h('div.ricorrenti-azioni', quante ? h('button.btn.pieno', { testo: t('ricorrenti.genera'), on: { click: genera } }) : null, h('a.btn', { href: `#/e/${CONTRATTI}`, testo: t('ricorrenti.contratti') }))),
      scheda(automatico, h('p.nota', t('ricorrenti.automatico-nota'))));
  } catch (e) { metti(corpo, h('div.avviso', e.message)); }
}

export default {
  nome: 'ricorrenti',
  lato: k => (k.schema.some(e => e.id === 'fatture') && !k.schema.some(e => e.id === CONTRATTI) && k.stato.poteri?.schema ? [{ href: '#/ricorrenti', icona: 'calendario', nome: t('ricorrenti.titolo') }] : []),
  rotte: { ricorrenti: (contenuto, k) => pagina(contenuto, k) },
  azioniLista(def, k) { return def.id === CONTRATTI ? [k.h('a.btn', { href: '#/ricorrenti', testo: t('ricorrenti.fatture-dovute') })] : []; },
};
