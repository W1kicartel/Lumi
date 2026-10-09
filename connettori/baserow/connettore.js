// Baserow (l'Airtable open source, su baserow.io o installato in proprio): una sezione di Lumi copiata in una tabella,
// ogni 15 minuti, solo le righe cambiate. Passano i campi che hanno lo stesso nome di una colonna (user_field_names=true)
// e un tipo che si scrive a testo, numero, sì/no o data; le righe già copiate si aggiornano (l'abbinamento sta in k.sincro),
// le nuove si creano, a lotti da 200 (il massimo delle chiamate batch). Token del database: «Authorization: Token …».
import { sezione, cambiate, cella, lotti } from '../_comunica/tabelle.js';
const bbase = k => String(k.base || k.imp.url || 'https://api.baserow.io').replace(/\/+$/, '');
const opz = (k, json) => ({ intestazioni: { Authorization: `Token ${k.segreti.token}` }, ...(json ? { json } : {}) });
const no = (r, cosa) => new Error(`Baserow ha risposto ${r.stato} a ${cosa}${r.json?.detail ? ': ' + (typeof r.json.detail === 'string' ? r.json.detail : JSON.stringify(r.json.detail).slice(0, 200)) : r.json?.error ? ': ' + r.json.error : ''}`);
const TIPI = new Set(['text', 'long_text', 'number', 'boolean', 'date', 'email', 'phone_number', 'url', 'rating']);
const tab = k => encodeURIComponent(String(k.imp.tabella || '').trim());
async function colonne(k) {
  const r = await k.http.get(`${bbase(k)}/api/database/fields/table/${tab(k)}/`, opz(k));
  if (!r.ok) throw no(r, 'le colonne della tabella');
  return Array.isArray(r.json) ? r.json : [];
}
const valore = (v, tipo) => { const x = cella(v); return x === '' ? (tipo === 'boolean' ? false : null) : tipo === 'date' && typeof x === 'string' ? x.slice(0, 10) : x; };
async function sincronizza(k, { tutto = false } = {}) {
  const { entita, campi } = sezione(k, k.imp.sezione), cc = await colonne(k);
  const nomi = new Map(cc.filter(f => !f.read_only && TIPI.has(f.type)).map(f => [f.name.toLowerCase(), f]));
  const usati = campi.filter(c => nomi.has(c.nome.toLowerCase())), chiave = nomi.get('lumi id');
  if (!usati.length) throw new Error('Nessuna colonna della tabella ha il nome di un campo di Lumi (es. Nome, Email, Telefono)');
  if (tutto) k.stato.scrivi(`cursore:${entita}`, null);
  const { righe, salva } = cambiate(k, entita), url = `${bbase(k)}/api/database/rows/table/${tab(k)}/batch/?user_field_names=true`; let creati = 0, aggiornati = 0;
  for (const gruppo of lotti(righe, 200)) {
    const nuovi = [], vecchi = [];
    for (const r of gruppo) {
      const item = { ...Object.fromEntries(usati.map(c => { const f = nomi.get(c.nome.toLowerCase()); return [f.name, valore(r[c.id], f.type)]; })), ...(chiave ? { [chiave.name]: r.id } : {}) };
      const id = k.sincro.remoto(entita, r.id); id ? vecchi.push({ id: Number(id), ...item }) : nuovi.push([r, item]);
    }
    if (vecchi.length) { const x = await k.http.patch(url, opz(k, { items: vecchi })); if (!x.ok) throw no(x, 'l\'aggiornamento delle righe'); aggiornati += vecchi.length; }
    if (nuovi.length) {
      const x = await k.http.post(url, opz(k, { items: nuovi.map(n => n[1]) })); if (!x.ok) throw no(x, 'la creazione delle righe');
      (x.json?.items || []).forEach((rec, j) => nuovi[j] && k.sincro.collega(entita, nuovi[j][0].id, rec.id)); creati += nuovi.length;
    }
    salva(gruppo.at(-1).modificato);   // il cursore avanza lotto per lotto
  }
  return { creati, aggiornati, campi: usati.length };
}
export default {
  id: 'baserow', nome: 'Baserow', versione: 1, icona: 'griglia',
  descrizione: 'Tiene una tabella di Baserow (anche installato in proprio) allineata a una sezione di Lumi.',
  impostazioni: [
    { id: 'url', nome: 'Indirizzo del server Baserow', tipo: 'url', predefinito: 'https://api.baserow.io' },
    { id: 'token', nome: 'Token del database', segreto: true, schema: /^[A-Za-z0-9]{20,64}$/ },
    { id: 'tabella', nome: 'Id della tabella (un numero)', schema: /^\d{1,12}$/ },
    { id: 'sezione', nome: 'Sezione di Lumi da copiare (es. clienti)' },
  ],
  permessi: { '*': { leggi: true } },
  prova: async k => { const c = await colonne(k); return { ok: true, messaggio: `${c.length} colonne: ${c.slice(0, 6).map(f => f.name).join(', ')}` }; },
  azioni: {
    sincronizza_ora: {
      nome: 'Copia tutto in Baserow', descrizione: 'Ricopia in Baserow tutte le righe della sezione scelta, non solo quelle cambiate', lumi: true, scrive: true,
      proponi: async (x, k) => { const { def } = sezione(k, k.imp.sezione); return { titolo: 'Copia in Baserow', righe: [['Sezione', def.nome], ['Tabella', String(k.imp.tabella || '—')]], avvisi: [] }; },
      esegui: async (x, k) => sincronizza(k, { tutto: true }),
    },
  },
  pianificati: { sincronizza: { nome: 'Copia le righe cambiate', ogni: '15m', giro: k => sincronizza(k) } },
  catalogo: {
    categoria: 'produttivita', sito: 'https://baserow.io', costo: 'gratis',
    costoNota: 'Open source: installato in proprio è gratuito e senza limiti di righe. Su baserow.io il piano Free è gratuito (fino a 3.000 righe per area di lavoro); Premium circa 10 $ per utente al mese.',
    serve: [
      { cosa: 'Un token del database con il permesso di creare, leggere e aggiornare righe', dove: 'Baserow → il tuo nome in alto a sinistra → Impostazioni → Token del database → Crea token, scegli l\'area di lavoro', link: 'https://baserow.io/user-docs/personal-api-tokens' },
      { cosa: 'L\'id della tabella', dove: 'Apri la tabella: è il numero dopo /table/ nell\'indirizzo (o nella documentazione API del database)', link: 'https://baserow.io/api-docs' },
      { cosa: 'L\'indirizzo del server, se Baserow è installato in proprio', dove: 'L\'indirizzo che apri nel browser, es. https://baserow.bottega.it', link: 'https://baserow.io/docs/index' },
    ],
    passi: [
      'Crea in Baserow la tabella e dai alle colonne gli stessi nomi dei campi di Lumi (es. Nome, Email, Telefono).',
      'Se vuoi, aggiungi una colonna di testo «Lumi ID»: ci finisce l\'id della riga di Lumi.',
      'Crea un token del database (Impostazioni → Token del database) con creare, leggere e aggiornare.',
      'Incolla indirizzo del server (lascia quello predefinito per baserow.io), token, id della tabella e la sezione di Lumi.',
      'Premi «Prova la connessione», poi «Copia tutto in Baserow»: da lì ogni 15 minuti passano solo le righe cambiate.',
    ],
    difficolta: 'facile', zone: ['mondo', 'UE'],
    fonti: ['https://baserow.io/api-docs', 'https://baserow.io/user-docs/personal-api-tokens', 'https://baserow.io/docs/apis/rest-api', 'https://baserow.io/pricing'],
    prova: 'finto', parole: ['baserow', 'airtable', 'tabella', 'database', 'open source', 'no-code', 'self-hosted', 'sync'],
  },
  testi: {
    en: { nome: 'Baserow', descrizione: 'Keeps a Baserow table (self-hosted too) in line with a Lumi section.', 'imp.url': 'Baserow server address', 'imp.token': 'Database token', 'imp.tabella': 'Table id (a number)', 'imp.sezione': 'Lumi section to copy (e.g. clienti)', 'az.sincronizza_ora': 'Copy everything to Baserow', 'giro.sincronizza': 'Copy changed rows',
      'cat.costoNota': 'Open source: self-hosted it is free with no row limit. On baserow.io the Free plan costs nothing (up to 3,000 rows per workspace); Premium about $10 per user per month.',
      'cat.serve': [{ cosa: 'A database token allowed to create, read and update rows', dove: 'Baserow → your name top left → Settings → Database tokens → Create token, pick the workspace' }, { cosa: 'The table id', dove: 'Open the table: it is the number after /table/ in the address (or in the database API docs)' }, { cosa: 'The server address, if Baserow is self-hosted', dove: 'The address you open in the browser, e.g. https://baserow.example.com' }],
      'cat.passi': ['Create the table in Baserow and name the columns like the Lumi fields (e.g. Nome, Email, Telefono).', 'Optionally add a «Lumi ID» text column: it gets the Lumi row id.', 'Create a database token (Settings → Database tokens) with create, read and update.', 'Paste server address (keep the default for baserow.io), token, table id and the Lumi section.', 'Press «Test connection», then «Copy everything to Baserow»: from then on only changed rows go every 15 minutes.'] },
    es: { nome: 'Baserow', descrizione: 'Mantiene una tabla de Baserow (también autoalojado) alineada con una sección de Lumi.', 'imp.url': 'Dirección del servidor Baserow', 'imp.token': 'Token de la base de datos', 'imp.tabella': 'Id de la tabla (un número)', 'imp.sezione': 'Sección de Lumi a copiar (p. ej. clienti)', 'az.sincronizza_ora': 'Copiar todo en Baserow', 'giro.sincronizza': 'Copiar las filas cambiadas' },
    fr: { nome: 'Baserow', descrizione: 'Garde une table Baserow (même auto-hébergée) alignée sur une section de Lumi.', 'imp.url': 'Adresse du serveur Baserow', 'imp.token': 'Jeton de la base de données', 'imp.tabella': 'Id de la table (un nombre)', 'imp.sezione': 'Section de Lumi à copier (ex. clienti)', 'az.sincronizza_ora': 'Tout copier dans Baserow', 'giro.sincronizza': 'Copier les lignes modifiées' },
    de: { nome: 'Baserow', descrizione: 'Hält eine Baserow-Tabelle (auch selbst gehostet) mit einem Lumi-Bereich abgeglichen.', 'imp.url': 'Adresse des Baserow-Servers', 'imp.token': 'Datenbank-Token', 'imp.tabella': 'Tabellen-ID (eine Zahl)', 'imp.sezione': 'Zu kopierender Lumi-Bereich (z. B. clienti)', 'az.sincronizza_ora': 'Alles nach Baserow kopieren', 'giro.sincronizza': 'Geänderte Zeilen kopieren' },
    pt: { nome: 'Baserow', descrizione: 'Mantém uma tabela do Baserow (também auto-hospedado) alinhada a uma seção do Lumi.', 'imp.url': 'Endereço do servidor Baserow', 'imp.token': 'Token do banco de dados', 'imp.tabella': 'Id da tabela (um número)', 'imp.sezione': 'Seção do Lumi a copiar (ex. clienti)', 'az.sincronizza_ora': 'Copiar tudo para o Baserow', 'giro.sincronizza': 'Copiar as linhas alteradas' },
  },
};
