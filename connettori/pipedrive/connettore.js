// Pipedrive (il CRM delle vendite di tante PMI): clienti di Kubo e persone di Pipedrive allineati, trattative dai preventivi.
// - Kubo → Pipedrive: ogni cliente nuovo o cambiato con email o telefono diventa una persona (abbinata per id o per email:
//   mai doppioni); chi ha la partita IVA è anche un'organizzazione con lo stesso nome, collegata alla persona;
// - Pipedrive → Kubo: ogni 15 minuti le persone nuove o cambiate (updated_since) creano o aggiornano i clienti;
// - azione «crea_trattativa»: un preventivo diventa un deal (titolo, valore in euro, persona e organizzazione).
// API v2 (persone, organizzazioni, deal), token nell'intestazione x-api-token, https://<azienda>.pipedrive.com.
import { lotti } from '../_comunica/tabelle.js';
const dominio = k => String(k.imp.dominio || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.pipedrive\.com.*$/, '');
const pbase = k => k.base || `https://${dominio(k)}.pipedrive.com`;
const opz = (k, json) => ({ intestazioni: { 'x-api-token': k.segreti.token }, ...(json ? { json } : {}) });
const no = (r, cosa) => new Error(`Pipedrive ha risposto ${r.stato} a ${cosa}${r.json?.error ? ': ' + r.json.error : ''}`);
const idDi = v => (v && typeof v === 'object' ? v.id : v) || null;
const primo = a => (a || []).find(x => x.primary)?.value || a?.[0]?.value || null;
// una persona di Pipedrive nella forma della mappa «persone» (telefono solo se la sezione clienti ce l'ha)
const piatto = (k, p) => ({ id: p.id, nome: p.name || primo(p.emails) || `Persona ${p.id}`, email: primo(p.emails), ...(k.campo('clienti', 'telefono') ? { telefono: primo(p.phones) } : {}) });

// un cliente con la partita IVA è anche un'organizzazione: l'id sta in k.stato (l'abbinamento righe↔id è delle persone)
async function organizzazione(k, c) {
  const piva = k.campo('clienti', 'piva') && k.valore(c, 'clienti', 'piva'); if (!piva) return null;
  const mappa = k.stato.leggi('organizzazioni') || {}, name = String(k.valore(c, 'clienti', 'nome') || piva);
  const r = mappa[c.id] ? await k.http.patch(`${pbase(k)}/api/v2/organizations/${mappa[c.id]}`, opz(k, { name })) : await k.http.post(`${pbase(k)}/api/v2/organizations`, opz(k, { name }));
  if (!r.ok) throw no(r, 'l\'organizzazione');
  if (!mappa[c.id]) { mappa[c.id] = r.json.data.id; k.stato.scrivi('organizzazioni', mappa); }
  return mappa[c.id];
}
// Kubo → Pipedrive: la persona del cliente (creata o aggiornata) → id, o null se non ha né email né telefono
async function persona(k, c) {
  const email = String(k.valore(c, 'clienti', 'email') || '').trim().toLowerCase(), tel = k.campo('clienti', 'telefono') ? String(k.valore(c, 'clienti', 'telefono') || '').trim() : '';
  if (!email && !tel) return null;
  const org = await organizzazione(k, c);
  const corpo = { name: String(k.valore(c, 'clienti', 'nome') || email || tel), ...(email ? { emails: [{ value: email, primary: true, label: 'work' }] } : {}), ...(tel ? { phones: [{ value: tel, primary: true, label: 'work' }] } : {}), ...(org ? { org_id: Number(org) } : {}) };
  let id = k.sincro.remoto('clienti', c.id);
  if (!id && email) {
    const s = await k.http.get(`${pbase(k)}/api/v2/persons/search?${new URLSearchParams({ term: email, fields: 'email', exact_match: 'true', limit: '1' })}`, opz(k));
    if (!s.ok) throw no(s, 'la ricerca della persona');
    id = s.json?.data?.items?.[0]?.item?.id ?? null;
  }
  const r = id ? await k.http.patch(`${pbase(k)}/api/v2/persons/${id}`, opz(k, corpo)) : await k.http.post(`${pbase(k)}/api/v2/persons`, opz(k, corpo));
  if (!r.ok) throw no(r, `la persona ${corpo.name}`);
  k.sincro.collega('clienti', c.id, r.json.data.id);
  return r.json.data.id;
}
// Pipedrive → Kubo: le persone cambiate dopo il cursore (update_time), a pagine da 500, al massimo 10.000 per giro
async function ricevi(k) {
  const dopo = k.stato.leggi('aggiornate') || null, conti = { creati: 0, aggiornati: 0, uguali: 0 }; let cursor = null;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ sort_by: 'update_time', sort_direction: 'asc', limit: '500', ...(dopo ? { updated_since: dopo } : {}), ...(cursor ? { cursor } : {}) });
    const r = await k.http.get(`${pbase(k)}/api/v2/persons?${q}`, opz(k));
    if (!r.ok) throw no(r, 'l\'elenco delle persone');
    const res = r.json?.data || [];
    for (const g of lotti(res, 100)) { const c = await k.sincro.daRemoto('persone', g.map(p => piatto(k, p))); for (const x of Object.keys(conti)) conti[x] += c[x]; }
    const ultimo = res.at(-1)?.update_time; if (ultimo) k.stato.scrivi('aggiornate', String(ultimo).replace(' ', 'T').replace(/(\d)$/, '$1Z'));
    cursor = r.json?.additional_data?.next_cursor; if (!cursor) break;
  }
  return conti;
}
// i dati della trattativa dal preventivo
function trattativa(k, p) {
  const v = c => k.valore(p, 'preventivi', c), num = v('numero'), ogg = v('oggetto');
  return { title: [num != null ? `Preventivo ${num}` : 'Preventivo', ogg].filter(Boolean).join(' · ').slice(0, 255), value: Number(v('totale') || 0), currency: 'EUR' };
}
export default {
  id: 'pipedrive', nome: 'Pipedrive', versione: 1, icona: 'utenti',
  descrizione: 'Clienti di Kubo e persone di Pipedrive allineati; le aziende con P.IVA come organizzazioni; i preventivi diventano trattative.',
  impostazioni: [
    { id: 'token', nome: 'Token API personale', segreto: true, schema: /^[0-9a-f]{40}$/ },
    { id: 'dominio', nome: 'Il dominio dell\'azienda (es. bottega per bottega.pipedrive.com)', schema: /^(https?:\/\/)?[a-z0-9][a-z0-9-]{0,62}(\.pipedrive\.com\/?)?$/i },
  ],
  richiede: {
    clienti: { nome: {}, email: { tipo: ['email'], facoltativo: true }, telefono: { tipo: ['telefono', 'testo'], facoltativo: true }, piva: { tipo: ['testo'], facoltativo: true } },
    preventivi: { numero: { facoltativo: true }, oggetto: { facoltativo: true }, cliente: { tipo: ['relazione'], facoltativo: true }, totale: { facoltativo: true } },
  },
  permessi: { clienti: { leggi: true, crea: true, modifica: true }, preventivi: { leggi: true } },
  mappe: { persone: { entita: 'clienti', id: 'id', chiave: ['email', 'email'], campi: [{ kubo: 'nome', remoto: 'nome' }, { kubo: 'email', remoto: 'email' }, { kubo: 'telefono', remoto: 'telefono' }] } },
  prova: async k => { const r = await k.http.get(`${pbase(k)}/api/v1/users/me`, opz(k)); return { ok: r.ok, messaggio: r.ok ? `Collegato come ${r.json?.data?.name} (${r.json?.data?.company_name || dominio(k)})` : `HTTP ${r.stato}` }; },
  uscita: { clienti: { campi: ['nome', 'email', 'telefono', 'piva'], quando: (r, k) => !!(k.valore(r, 'clienti', 'email') || (k.campo('clienti', 'telefono') && k.valore(r, 'clienti', 'telefono'))), invia: async (riga, k) => { await persona(k, riga); } } },
  pianificati: { persone: { nome: 'Persone nuove o cambiate in Pipedrive', ogni: '15m', giro: k => ricevi(k) } },
  azioni: {
    crea_trattativa: {
      nome: 'Crea la trattativa in Pipedrive', descrizione: 'Porta un preventivo in Pipedrive come trattativa (deal), con il cliente come persona', su: 'preventivi', lumi: true, scrive: true,
      input: { preventivo: { tipo: 'relazione', entita: 'preventivi', nome: 'Il preventivo' } },
      proponi: async ({ preventivo }, k) => {
        const t = trattativa(k, preventivo), cli = idDi(k.valore(preventivo, 'preventivi', 'cliente'));
        return { titolo: 'Nuova trattativa in Pipedrive', righe: [['Trattativa', t.title], ['Valore', k.euro(t.value)], ['Cliente', k.valore(preventivo, 'preventivi', 'cliente')?.titolo || (cli ? 'sì' : '—')]],
          avvisi: [...(cli ? [] : ['Il preventivo non ha un cliente: la trattativa nasce senza persona']), ...(k.sincro.remoto('preventivi', preventivo.id) ? ['Questo preventivo è già in Pipedrive: la trattativa viene aggiornata'] : [])] };
      },
      esegui: async ({ preventivo }, k) => {
        const cli = idDi(k.valore(preventivo, 'preventivi', 'cliente')), c = cli ? k.dati.leggi('clienti', String(cli)) : null;
        const person_id = c ? await persona(k, c) : null, org_id = c ? (k.stato.leggi('organizzazioni') || {})[c.id] : null;
        const json = { ...trattativa(k, preventivo), ...(person_id ? { person_id: Number(person_id) } : {}), ...(org_id ? { org_id: Number(org_id) } : {}) }, gia = k.sincro.remoto('preventivi', preventivo.id);
        const r = gia ? await k.http.patch(`${pbase(k)}/api/v2/deals/${gia}`, opz(k, json)) : await k.http.post(`${pbase(k)}/api/v2/deals`, opz(k, json));
        if (!r.ok) throw no(r, 'la trattativa');
        k.sincro.collega('preventivi', preventivo.id, r.json.data.id);
        return { ok: true, id: r.json.data.id, aggiornata: !!gia, link: `https://${dominio(k)}.pipedrive.com/deal/${r.json.data.id}` };
      },
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.pipedrive.com', costo: 'abbonamento',
    costoNota: 'Nessun piano gratuito (prova di 14 giorni). Lite da circa 14 € per utente al mese con fatturazione annuale, Growth circa 24 €, Premium circa 49 €, Ultimate circa 69 €. L\'API c\'è in tutti i piani.',
    serve: [
      { cosa: 'Il token API personale', dove: 'Pipedrive → icona del profilo → Impostazioni personali → API → Copia il token', link: 'https://pipedrive.readme.io/docs/how-to-find-the-api-token' },
      { cosa: 'Il dominio dell\'azienda', dove: 'È la prima parte dell\'indirizzo che usi: <azienda>.pipedrive.com', link: 'https://pipedrive.readme.io/docs/how-to-get-the-company-domain' },
    ],
    passi: [
      'In Pipedrive apri l\'icona del profilo → Impostazioni personali → API e copia il token.',
      'Incolla qui il token e il dominio dell\'azienda (la parte prima di .pipedrive.com).',
      'Premi «Prova la connessione»: vedi il tuo nome.',
      'Da qui ogni cliente nuovo o cambiato con email o telefono passa a Pipedrive; chi ha la P.IVA anche come organizzazione.',
      'Ogni 15 minuti le persone nuove o cambiate in Pipedrive tornano in Kubo come clienti.',
      'Su un preventivo premi «Crea la trattativa in Pipedrive», o chiedilo a Lumi.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developers.pipedrive.com/docs/api/v1/Persons#getPersons', 'https://developers.pipedrive.com/docs/api/v1/Persons#addPerson', 'https://developers.pipedrive.com/docs/api/v1/Persons#searchPersons', 'https://developers.pipedrive.com/docs/api/v1/Organizations#addOrganization', 'https://developers.pipedrive.com/docs/api/v1/Deals#addDeal', 'https://pipedrive.readme.io/docs/core-api-concepts-authentication', 'https://www.pipedrive.com/en/pricing'],
    prova: 'finto', parole: ['pipedrive', 'crm', 'trattative', 'vendite', 'contatti', 'deal', 'pipeline', 'sales', 'lead'],
  },
  testi: {
    en: { nome: 'Pipedrive', descrizione: 'Kubo customers and Pipedrive people in sync; companies with a VAT number as organisations; quotes become deals.', 'imp.token': 'Personal API token', 'imp.dominio': 'Company domain (e.g. bottega for bottega.pipedrive.com)', 'az.crea_trattativa': 'Create the deal in Pipedrive', 'giro.persone': 'New or changed people in Pipedrive',
      'cat.costoNota': 'No free plan (14-day trial). Lite from about €14 per user per month billed annually, Growth about €24, Premium about €49, Ultimate about €69. The API is in every plan.',
      'cat.serve': [{ cosa: 'The personal API token', dove: 'Pipedrive → profile icon → Personal preferences → API → Copy the token' }, { cosa: 'The company domain', dove: 'It is the first part of the address you use: <company>.pipedrive.com' }],
      'cat.passi': ['In Pipedrive open the profile icon → Personal preferences → API and copy the token.', 'Paste the token and the company domain (the part before .pipedrive.com).', 'Press «Test connection»: you see your name.', 'From then on every new or changed customer with email or phone goes to Pipedrive; those with a VAT number also as an organisation.', 'Every 15 minutes new or changed people in Pipedrive come back to Kubo as customers.', 'On a quote press «Create the deal in Pipedrive», or ask Lumi.'] },
    es: { nome: 'Pipedrive', descrizione: 'Clientes de Kubo y personas de Pipedrive alineados; las empresas con NIF como organizaciones; los presupuestos se convierten en tratos.', 'imp.token': 'Token API personal', 'imp.dominio': 'Dominio de la empresa (p. ej. bottega para bottega.pipedrive.com)', 'az.crea_trattativa': 'Crear el trato en Pipedrive', 'giro.persone': 'Personas nuevas o cambiadas en Pipedrive' },
    fr: { nome: 'Pipedrive', descrizione: 'Clients Kubo et personnes Pipedrive alignés ; les sociétés avec n° de TVA comme organisations ; les devis deviennent des affaires.', 'imp.token': 'Jeton API personnel', 'imp.dominio': 'Domaine de l\'entreprise (ex. bottega pour bottega.pipedrive.com)', 'az.crea_trattativa': 'Créer l\'affaire dans Pipedrive', 'giro.persone': 'Personnes nouvelles ou modifiées dans Pipedrive' },
    de: { nome: 'Pipedrive', descrizione: 'Kubo-Kunden und Pipedrive-Personen abgeglichen; Firmen mit USt-IdNr. als Organisationen; Angebote werden Deals.', 'imp.token': 'Persönliches API-Token', 'imp.dominio': 'Firmendomain (z. B. bottega für bottega.pipedrive.com)', 'az.crea_trattativa': 'Deal in Pipedrive anlegen', 'giro.persone': 'Neue oder geänderte Personen in Pipedrive' },
    pt: { nome: 'Pipedrive', descrizione: 'Clientes do Kubo e pessoas do Pipedrive alinhados; empresas com NIF como organizações; os orçamentos viram negócios.', 'imp.token': 'Token de API pessoal', 'imp.dominio': 'Domínio da empresa (ex. bottega para bottega.pipedrive.com)', 'az.crea_trattativa': 'Criar o negócio no Pipedrive', 'giro.persone': 'Pessoas novas ou alteradas no Pipedrive' },
  },
};
