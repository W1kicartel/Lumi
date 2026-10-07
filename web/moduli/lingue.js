// Lingua e valuta (#/lingua): la lingua di chi usa Kubo (sua, salvata sul server) e, per chi personalizza, la lingua dei
// modelli nuovi e la valuta dell'azienda. Il selettore rapido della lingua sta anche nel piede della barra laterale.
import { t, LINGUE, VALUTE, lingua, valuta, linguaAzienda, imposta, numero, soldi, data, giorniSettimana, locale } from '../lingua.js';

export default {
  nome: 'lingue',
  lato: k => [{ href: '#/lingua', icona: 'ingranaggio', nome: t('gestione.lingua-valuta') }],
  rotte: {
    lingua(contenuto, k) {
      const { h, api, toast } = k;
      const sel = (valori, attuale, nome) => h('select.campo', valori.map(([v, n]) => h('option', { value: v, testo: n, selected: v === attuale })));
      const lingue = Object.entries(LINGUE).map(([c, l]) => [c, l.nome]);
      const mia = sel(lingue, lingua);
      mia.addEventListener('change', () => imposta(mia.value));
      const esempio = h('p.nota', { testo: t('gestione.esempio', { numero: numero(1234.5), soldi: soldi(1234.5), data: data(new Date()) }) + ' ' +
        t('gestione.settimana-da', { giorno: new Intl.DateTimeFormat(locale(), { weekday: 'long' }).format(new Date(2024, 0, 7 + giorniSettimana()[0].dow)) }) });
      const parti = [h('div.foglio', { stile: { marginBottom: '16px', maxWidth: '560px' } },
        h('label', h('span.etichetta', t('gestione.tua-lingua')), mia), h('p.nota', t('gestione.tua-lingua-nota')), esempio)];
      if (k.stato.poteri?.schema) {
        const sLingua = sel(lingue, linguaAzienda()), sValuta = sel(VALUTE.map(v => [v, v]), valuta);
        const salva = h('button.btn.pieno', { testo: t('viste.salva'), on: { click: async () => {
          try { await api('PUT', '/lingua/azienda', { lingua: sLingua.value, valuta: sValuta.value }); toast(t('gestione.salvato-ricarico')); setTimeout(() => location.reload(), 600); }
          catch (e) { toast(e.message, true); }
        } } });
        parti.push(h('div.foglio', { stile: { maxWidth: '560px' } }, h('div.etichetta', t('gestione.azienda')),
          h('label', h('span.etichetta', t('gestione.lingua-modelli')), sLingua), h('p.nota', t('gestione.lingua-modelli-nota')),
          h('label', h('span.etichetta', t('comune.valuta')), sValuta), h('p.nota', t('gestione.valuta-nota')), salva));
      }
      contenuto.replaceChildren(h('div.testa', h('h1', t('gestione.lingua-valuta'))), h('div.corpo', parti));
    },
  },
};
