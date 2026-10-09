// I cambi di riferimento della Banca centrale europea: gratis, senza chiave, pubblicati verso le 16 dei giorni lavorativi.
// Servono per le fatture e i pagamenti in valuta (l'IVA e la fattura elettronica vogliono l'importo in euro al cambio del
// giorno). eurofxref-daily.xml per l'ultimo giorno, eurofxref-hist-90d.xml per una data degli ultimi 90 giorni (se quel
// giorno non c'è il fixing, vale quello del giorno lavorativo prima). https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
const VALUTA = /^[A-Z]{3}$/;

// <Cube time='AAAA-MM-GG'><Cube currency='USD' rate='1.0850'/>… → [{ data, tassi: { USD: 1.085, … } }], il più recente per primo
export function leggiXml(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    const tassi = { EUR: 1 };
    for (const c of m[2].matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]\s*\/>/g)) tassi[c[1]] = Number(c[2]);
    out.push({ data: m[1], tassi });
  }
  return out.sort((a, b) => b.data.localeCompare(a.data));
}
async function scarica(k, file) {
  const r = await k.http.get(`${k.base}/stats/eurofxref/${file}`, { intestazioni: { Accept: 'application/xml' } });
  if (!r.ok) throw new Error(`BCE ha risposto ${r.stato}`);
  const l = leggiXml(r.testo); if (!l.length) throw new Error('BCE: nessun cambio nel file');
  return l;
}
// i cambi di un giorno: l'ultimo fixing (tenuto per 6 ore) o, per una data passata, il file dei 90 giorni
async function cambiDel(k, data) {
  let u = k.stato.leggi('ultimo');
  if (!u || Date.now() - u.preso > 6 * 36e5) { const [x] = await scarica(k, 'eurofxref-daily.xml'); u = { ...x, preso: Date.now() }; k.stato.scrivi('ultimo', u); }
  if (!data || data >= u.data) return u;
  const x = (await scarica(k, 'eurofxref-hist-90d.xml')).find(g => g.data <= data);
  if (!x) throw new Error(`Nessun cambio BCE per il ${data}: il file storico copre gli ultimi 90 giorni`);
  return x;
}
export async function converti(k, { importo, da = 'EUR', a = 'EUR', data = null }) {
  const x = String(da || 'EUR').toUpperCase().trim(), y = String(a || 'EUR').toUpperCase().trim();
  if (!VALUTA.test(x) || !VALUTA.test(y)) throw new Error('Valuta non valida: usa il codice ISO di tre lettere (USD, GBP, CHF…)');
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(String(data))) throw new Error('Data non valida (AAAA-MM-GG)');
  const c = await cambiDel(k, data || null);
  if (!c.tassi[x] || !c.tassi[y]) throw new Error(`La BCE non pubblica il cambio per ${!c.tassi[x] ? x : y}`);
  const n = Number(String(importo).replace(',', '.')); if (!Number.isFinite(n)) throw new Error('Importo non valido');
  const tasso = c.tassi[y] / c.tassi[x];
  return { importo: n, da: x, a: y, risultato: Math.round(n * tasso * 100) / 100, tasso: Number(tasso.toFixed(6)), data: c.data, fonte: 'BCE' };
}

export default {
  id: 'bce-cambi', nome: 'Cambi BCE', versione: 1, icona: 'documento', base: 'https://www.ecb.europa.eu',
  descrizione: 'I cambi di riferimento della Banca centrale europea per convertire importi in valuta. Gratis, senza chiave.',
  impostazioni: [],
  richiede: { clienti: { nome: { facoltativo: true } } },
  permessi: {},
  prova: async k => { try { const [x] = await scarica(k, 'eurofxref-daily.xml'); return { ok: true, messaggio: `cambi del ${x.data}` }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    converti: {
      nome: 'Converti valuta', su: 'clienti', lumi: true, descrizione: 'Converte un importo da una valuta all\'altra con il cambio BCE del giorno (o di una data degli ultimi 90 giorni)',
      input: { importo: { tipo: 'numero', nome: 'L\'importo' }, da: { tipo: 'testo', nome: 'La valuta di partenza (USD, GBP, CHF…)' }, a: { tipo: 'testo', nome: 'La valuta di arrivo (di solito EUR)' }, data: { tipo: 'testo', nome: 'La data AAAA-MM-GG (vuota: l\'ultimo cambio)' } },
      esegui: (x, k) => converti(k, x),
    },
    tassi: {
      nome: 'Cambi del giorno', su: 'clienti', lumi: true, descrizione: 'Gli ultimi cambi di riferimento BCE dell\'euro',
      esegui: async (_, k) => { const c = await cambiDel(k, null); return { data: c.data, tassi: c.tassi }; },
    },
  },
  pianificati: { tassi: { alle: '16:30', giro: async k => { const [x] = await scarica(k, 'eurofxref-daily.xml'); k.stato.scrivi('ultimo', { ...x, preso: Date.now() }); return { data: x.data, valute: Object.keys(x.tassi).length }; } } },
  catalogo: {
    categoria: 'contabilita', sito: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.it.html',
    costo: 'gratis', costoNota: 'Gratis: sono i cambi pubblici della Banca centrale europea, aggiornati ogni giorno lavorativo verso le 16. Non serve nessuna chiave.',
    serve: [{ cosa: 'Niente: i file della BCE sono pubblici', dove: '—', link: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml' }],
    passi: ['Accendi il connettore: non chiede chiavi.', 'Ogni giorno alle 16:30 Kubo prende i cambi nuovi.', 'Chiedi a Lumi «quanto sono 1.250 dollari in euro?» o «il cambio GBP del 3 settembre».', 'Per una fattura in valuta usa il cambio del giorno della fattura (gli ultimi 90 giorni sono disponibili).'],
    difficolta: 'facile', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html', 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'],
    prova: 'finto', parole: ['cambio', 'valuta', 'tasso di cambio', 'bce', 'dollaro', 'sterlina', 'exchange rate', 'currency', 'ecb', 'forex'],
  },
  testi: {
    en: { nome: 'ECB exchange rates', descrizione: 'European Central Bank reference rates to convert amounts in foreign currency. Free, no key.', 'az.converti': 'Convert currency', 'az.tassi': 'Today\'s rates', 'giro.tassi': 'Daily rates',
      'cat.costoNota': 'Free: these are the public European Central Bank rates, updated every working day around 4 pm CET. No key needed.',
      'cat.serve': [{ cosa: 'Nothing: the ECB files are public', dove: '—' }],
      'cat.passi': ['Switch the connector on: it asks for no keys.', 'Every day at 16:30 Kubo fetches the new rates.', 'Ask Lumi «how much is $1,250 in euros?» or «the GBP rate on 3 September».', 'For an invoice in foreign currency use the rate of the invoice day (the last 90 days are available).'] },
    es: { nome: 'Tipos de cambio BCE', descrizione: 'Los tipos de referencia del Banco Central Europeo para convertir importes en divisa. Gratis, sin clave.', 'az.converti': 'Convertir divisa', 'az.tassi': 'Cambios del día', 'giro.tassi': 'Cambios diarios' },
    fr: { nome: 'Taux de change BCE', descrizione: 'Les taux de référence de la Banque centrale européenne pour convertir des montants en devise. Gratuit, sans clé.', 'az.converti': 'Convertir une devise', 'az.tassi': 'Taux du jour', 'giro.tassi': 'Taux quotidiens' },
    de: { nome: 'EZB-Wechselkurse', descrizione: 'Die Referenzkurse der Europäischen Zentralbank zum Umrechnen von Fremdwährungsbeträgen. Kostenlos, ohne Schlüssel.', 'az.converti': 'Währung umrechnen', 'az.tassi': 'Tageskurse', 'giro.tassi': 'Tägliche Kurse' },
    pt: { nome: 'Câmbios BCE', descrizione: 'As taxas de referência do Banco Central Europeu para converter valores em moeda estrangeira. Grátis, sem chave.', 'az.converti': 'Converter moeda', 'az.tassi': 'Câmbios do dia', 'giro.tassi': 'Câmbios diários' },
  },
};
