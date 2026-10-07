// Gli strumenti di Lumi, generati dallo schema (niente scritto a mano per una sezione): per ogni sezione che l'utente
// vede «cerca_<id>» e «leggi_<id>», per quelle in cui può scrivere «crea_<id>» e «modifica_<id>» (proposte con Conferma /
// Annulla), più «riepilogo» e «da_vedere»; per chi può personalizzare «proponi_modifica_schema» e «proponi_automazione».
// Tutto passa dalle API con la sessione di chi è collegato: i permessi sono quelli del server. Nessun DOM: si prova in Node.
//   strumenti({ schema, api, poteri, dopoSchema }) → [{ nome, descrizione, schema, leggi | proponi + esegui }]

const ID_RIGA = /^[0-9A-HJKMNP-TV-Z]{17}$/;   // gli id di Kubo (db.js: 9 caratteri di tempo + 8 casuali, base 32)
const NON_SCRIVIBILI = ['calcolato', 'contatore', 'immagine', 'file'];
const TIPI_CAMPO = ['testo', 'testo_lungo', 'numero', 'valuta', 'percentuale', 'data', 'data_ora', 'si_no', 'scelta', 'scelta_multipla', 'stato',
  'relazione', 'calcolato', 'contatore', 'email', 'telefono', 'url', 'indirizzo', 'codice_a_barre', 'durata'];
const ICONE = ['persona', 'scatola', 'cassa', 'furgone', 'calendario', 'attrezzi', 'documento', 'cartella', 'stella', 'ingranaggio', 'utenti'];
const OPERATORI = ['=', '!=', '<', '<=', '>', '>=', 'contiene', 'inizia', 'vuoto', 'nonvuoto', 'in', 'tra'];
export const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 40) || 'campo';
const eur = n => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);

// ---------- dal campo allo schema JSON del valore ----------
export function schemaValore(c, schema, { righe = true } = {}) {
  const opz = () => c.opzioni.map(o => `${o.id} = ${o.nome}`).join(', ');
  switch (c.tipo) {
    case 'numero': case 'percentuale': return { type: 'number', description: c.nome + (c.tipo === 'percentuale' ? ' (percentuale, es. 22)' : '') };
    case 'durata': return { type: 'number', description: `${c.nome} (minuti)` };
    case 'valuta': return { type: 'number', description: `${c.nome} in euro (es. 12.5)` };
    case 'si_no': return { type: 'boolean', description: c.nome };
    case 'data': return { type: 'string', description: `${c.nome} (AAAA-MM-GG)`, maxLength: 10 };
    case 'data_ora': return { type: 'string', description: `${c.nome} (data e ora ISO, es. 2026-10-07T15:30)`, maxLength: 30 };
    case 'scelta': case 'stato': return { type: 'string', enum: c.opzioni.map(o => o.id), description: `${c.nome}: ${opz()}` };
    case 'scelta_multipla': return { type: 'array', items: { type: 'string', enum: c.opzioni.map(o => o.id) }, description: `${c.nome}: ${opz()}` };
    case 'relazione': {
      const d = `${c.nome}: collegamento a «${schema.find(e => e.id === c.entita)?.nome || c.entita}» (id, oppure il nome da cercare)`;
      return c.molti ? { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 200 }, description: d } : { type: 'string', maxLength: 200, description: d };
    }
    case 'righe': {
      const figlia = schema.find(e => e.id === c.entita); if (!figlia || !righe) return null;
      const campi = scrivibili(figlia).filter(k => k.id !== c.campo && k.tipo !== 'righe');
      return { type: 'array', maxItems: 100, description: `${c.nome}: le righe (ognuna con i suoi campi)`,
        items: { type: 'object', properties: Object.fromEntries(campi.map(k => [k.id, schemaValore(k, schema, { righe: false })]).filter(([, v]) => v)), additionalProperties: false } };
    }
    case 'testo_lungo': case 'indirizzo': return { type: 'string', maxLength: 10000, description: c.nome };
    default: return { type: 'string', maxLength: 2000, description: c.nome };
  }
}
const scrivibili = def => def.campi.filter(c => !c.archiviato && !c.sola_lettura && !NON_SCRIVIBILI.includes(c.tipo));
function schemaValori(def, schema, { obbligatori = false } = {}) {
  const campi = scrivibili(def), properties = {};
  for (const c of campi) { const s = schemaValore(c, schema); if (s) properties[c.id] = s; }
  const required = obbligatori ? campi.filter(c => c.obbligatorio && c.predefinito === undefined && properties[c.id]).map(c => c.id) : [];
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

// ---------- una riga come la vede il modello: corta, senza vuoti ----------
export function compatta(def, riga, schema, livello = 0) {
  if (!riga) return riga;
  const out = { id: riga.id };
  for (const c of def.campi) {
    if (c.archiviato || ['immagine', 'file'].includes(c.tipo)) continue;
    let v = riga[c.id]; if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (c.tipo === 'righe') { const f = schema.find(e => e.id === c.entita); v = livello ? `${v.length} righe` : v.slice(0, 30).map(x => compatta(f || { campi: [] }, x, schema, 1)); }
    else if (typeof v === 'string' && v.length > 600) v = v.slice(0, 600) + '…';
    out[c.id] = v;
  }
  if (riga.archiviato) out.archiviato = true;
  return out;
}
// un valore come lo legge la persona nella scheda di conferma
export function leggibile(c, v, schema) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  switch (c.tipo) {
    case 'valuta': return eur(Number(v));
    case 'percentuale': return `${v}%`;
    case 'si_no': return v ? 'Sì' : 'No';
    case 'data': return new Date(v + 'T00:00:00').toLocaleDateString('it-IT');
    case 'scelta': case 'stato': return c.opzioni?.find(o => o.id === v)?.nome || String(v);
    case 'scelta_multipla': return v.map(x => c.opzioni?.find(o => o.id === x)?.nome || x).join(', ');
    case 'relazione': return [].concat(v).map(x => x?.titolo ?? x).join(', ');
    case 'righe': {
      const f = schema.find(e => e.id === c.entita), k = f?.campi.find(x => x.tipo === 'relazione' && x.id !== c.campo);
      return `${v.length} ${v.length === 1 ? 'riga' : 'righe'}${k ? ': ' + v.slice(0, 4).map(r => leggibile(k, r[k.id], schema) + (r.quantita != null ? ` × ${r.quantita}` : '')).join(', ') + (v.length > 4 ? '…' : '') : ''}`;
    }
    default: return String(v);
  }
}

// ---------- gli strumenti ----------
export function strumenti({ schema, api, poteri = {}, dopoSchema = async () => {}, apri = () => {} }) {
  const visibili = schema.filter(e => !e.nascosta);
  const defDi = id => schema.find(e => e.id === id);
  const errore = e => ({ errore: [e.message, ...Object.entries(e.corpo?.campi || {}).map(([k, m]) => `${k}: ${m}`), ...(e.corpo?.dettagli || [])].join(' · ') });
  const lista = [];

  // i collegamenti si possono dare per nome: si cercano, e se non è chiaro si chiede al modello di scegliere
  async function trova(c, v) {
    if (v == null || v === '') return { id: null, titolo: '' };
    const s = String(v).trim(), dest = defDi(c.entita);
    if (ID_RIGA.test(s)) { try { const r = await api('GET', `/dati/${c.entita}/${s}`); return { id: s, titolo: titolo(dest, r) }; } catch { /* non è un id: si cerca */ } }
    const r = await api('GET', `/dati/${c.entita}?n=5&q=${encodeURIComponent(s)}`);
    const esatti = r.righe.filter(x => String(titolo(dest, x)).toLowerCase() === s.toLowerCase());
    const scelti = esatti.length === 1 ? esatti : r.righe;
    if (scelti.length === 1) return { id: scelti[0].id, titolo: titolo(dest, scelti[0]) };
    if (!scelti.length) throw new Error(`in «${dest?.nome || c.entita}» non trovo «${s}»: cercalo con cerca_${c.entita} o crealo prima con crea_${c.entita}`);
    throw new Error(`per «${c.nome}» ci sono più risultati per «${s}» (${r.righe.map(x => `${titolo(dest, x)} = ${x.id}`).join('; ')}): chiedi quale e usa l'id`);
  }
  function titolo(def, riga) { const v = riga?.[def?.titolo] ?? riga?.nome ?? riga?.id; return v && typeof v === 'object' ? v.titolo : v; }
  // valori del modello → valori per l'API + righe della scheda di conferma
  async function risolvi(def, valori = {}, prima = null) {
    const api_ = {}, righe = [], vista = {};
    for (const [k, v] of Object.entries(valori)) {
      const c = def.campi.find(x => x.id === k && !x.archiviato);
      if (!c || c.sola_lettura || NON_SCRIVIBILI.includes(c.tipo)) throw new Error(`«${k}» non è un campo che si può scrivere in ${def.nome}`);
      let x = v; vista[k] = v;
      if (c.tipo === 'relazione') {
        const t = await Promise.all([].concat(c.molti ? v || [] : [v]).map(y => trova(c, y)));
        x = c.molti ? t.map(y => y.id) : t[0].id; vista[k] = c.molti ? t : t[0];
      } else if (c.tipo === 'righe') {
        const f = defDi(c.entita), rr = [], vv = [];
        for (const r of v || []) { const y = await risolvi(f, Object.fromEntries(Object.entries(r).filter(([kk]) => kk !== c.campo))); rr.push(y.api); vv.push(y.vista); }
        x = rr; vista[k] = vv;
      }
      api_[k] = x;
      righe.push([c.nome, prima ? `${leggibile(c, prima[c.id], schema)} → ${leggibile(c, vista[k], schema)}` : leggibile(c, vista[k], schema)]);
    }
    return { api: api_, righe, vista };
  }
  const memo = new Map();   // proponi ed esegui ricevono lo stesso input: i collegamenti si risolvono una volta sola

  for (const def of visibili) {
    const nomi = def.campi.filter(c => !c.archiviato).map(c => `${c.id} (${c.tipo}${c.opzioni ? ': ' + c.opzioni.map(o => o.id).join('/') : ''}${c.entita ? ' → ' + c.entita : ''})`).join(', ');
    const filtrabili = [...def.campi.filter(c => !c.archiviato && c.tipo !== 'righe').map(c => c.id), 'creato', 'modificato'];
    lista.push({
      nome: `cerca_${def.id}`,
      descrizione: `Cerca in «${def.nome}». Testo libero e/o filtri per campo. Campi: ${nomi}.`.slice(0, 1900),
      schema: { type: 'object', properties: {
        testo: { type: 'string', maxLength: 200, description: 'parole da cercare nei campi di testo' },
        filtri: { type: 'array', maxItems: 8, items: { type: 'object', properties: { campo: { type: 'string', enum: filtrabili }, op: { type: 'string', enum: OPERATORI }, valore: { description: 'valore (per in: lista, per tra: [da, a]); collegamenti per id' } }, required: ['campo', 'op'] } },
        ordina: { type: 'string', maxLength: 60, description: 'campo:asc oppure campo:desc' },
        quanti: { type: 'integer', minimum: 1, maximum: 50 }, pagina: { type: 'integer', minimum: 1 }, archiviati: { type: 'boolean' },
      } },
      leggi: async ({ testo, filtri, ordina, quanti = 20, pagina = 1, archiviati }) => {
        const par = new URLSearchParams({ n: quanti, p: pagina }); if (testo) par.set('q', testo); if (filtri?.length) par.set('f', JSON.stringify(filtri)); if (ordina) par.set('o', ordina); if (archiviati) par.set('arch', '1');
        try { const r = await api('GET', `/dati/${def.id}?${par}`); return { totale: r.totale, pagina: r.pagina, righe: r.righe.map(x => compatta(def, x, schema)) }; } catch (e) { return errore(e); }
      },
    }, {
      nome: `leggi_${def.id}`, descrizione: `Legge un elemento di «${def.nome}» per id, con tutti i campi${def.campi.some(c => c.tipo === 'righe') ? ' e le righe' : ''}.`,
      schema: { type: 'object', properties: { id: { type: 'string', maxLength: 40 } }, required: ['id'] },
      leggi: async ({ id }) => { try { return compatta(def, await api('GET', `/dati/${def.id}/${encodeURIComponent(id)}`), schema); } catch (e) { return errore(e); } },
    });
    if (def.puo?.crea) lista.push({
      nome: `crea_${def.id}`, descrizione: `Crea un elemento in «${def.nome}». I collegamenti si danno per id o per nome. Prima chiedi i dati obbligatori che mancano.`,
      schema: { type: 'object', properties: { valori: schemaValori(def, schema, { obbligatori: true }) }, required: ['valori'] },
      proponi: async inp => {
        try {
          const manca = scrivibili(def).filter(c => c.obbligatorio && c.predefinito === undefined && (inp.valori?.[c.id] == null || inp.valori[c.id] === ''));
          if (manca.length) return { errore: `mancano: ${manca.map(c => c.nome).join(', ')}` };
          const r = await risolvi(def, inp.valori); memo.set(inp, r);
          return { titolo: `Nuovo in ${def.nome}`, righe: r.righe };
        } catch (e) { return { errore: e.message }; }
      },
      esegui: async inp => {
        try { const r = memo.get(inp) || await risolvi(def, inp.valori); const x = await api('POST', `/dati/${def.id}`, r.api); apri(def.id, x.id); return { testo: `Fatto: creato in ${def.nome}.`, id: x.id }; }
        catch (e) { return errore(e); }
      },
    });
    if (def.puo?.modifica) lista.push({
      nome: `modifica_${def.id}`, descrizione: `Cambia uno o più campi di un elemento di «${def.nome}» (id da cerca_${def.id}). Solo i campi da cambiare.`,
      schema: { type: 'object', properties: { id: { type: 'string', maxLength: 40 }, valori: schemaValori(def, schema) }, required: ['id', 'valori'] },
      proponi: async inp => {
        try {
          const prima = await api('GET', `/dati/${def.id}/${encodeURIComponent(inp.id)}`);
          if (!Object.keys(inp.valori || {}).length) return { errore: 'nessun campo da cambiare' };
          const r = await risolvi(def, inp.valori, prima); memo.set(inp, r);
          return { titolo: `${def.nome} · ${titolo(def, prima) ?? inp.id}`, righe: r.righe };
        } catch (e) { return { errore: e.message }; }
      },
      esegui: async inp => {
        try { const r = memo.get(inp) || await risolvi(def, inp.valori); await api('PATCH', `/dati/${def.id}/${encodeURIComponent(inp.id)}`, r.api); return { testo: 'Fatto: salvato.' }; }
        catch (e) { return errore(e); }
      },
    });
  }

  // ---------- conti e attenzione ----------
  if (visibili.length) lista.push({
    nome: 'riepilogo',
    descrizione: 'Conta e somma gli elementi di una sezione, con filtri, periodo e raggruppamento. Per domande come «quanto ho venduto questa settimana», «quanti clienti nuovi a ottobre», «vendite per pagamento». Le date sono AAAA-MM-GG; calcola tu il periodo dalla data di oggi.',
    schema: { type: 'object', properties: {
      entita: { type: 'string', enum: visibili.map(e => e.id) }, testo: { type: 'string', maxLength: 200 },
      filtri: { type: 'array', maxItems: 8, items: { type: 'object', properties: { campo: { type: 'string' }, op: { type: 'string', enum: OPERATORI }, valore: {} }, required: ['campo', 'op'] } },
      campo_data: { type: 'string', description: 'il campo data del periodo (predefinito: il primo campo data, altrimenti «creato»)' },
      dal: { type: 'string', maxLength: 10 }, al: { type: 'string', maxLength: 10 },
      somma: { type: 'array', maxItems: 6, items: { type: 'string' }, description: 'campi numerici o importi da sommare (anche calcolati, es. totale)' },
      raggruppa: { type: 'string', description: 'un campo per cui dividere (scelta, stato, collegamento…)' },
    }, required: ['entita'] },
    leggi: async inp => { try { return await api('POST', '/lumi/riepilogo', inp); } catch (e) { return errore(e); } },
  }, {
    nome: 'da_vedere', descrizione: 'Le cose che richiedono attenzione adesso (scorte basse, scadenze passate, pratiche ferme), con il numero di elementi e la sezione.',
    schema: { type: 'object', properties: {} },
    leggi: async () => { try { return { cose: await api('GET', '/lumi/da-vedere') }; } catch (e) { return errore(e); } },
  });

  if (poteri.schema) lista.push(modificaSchema({ schema, api, dopoSchema, errore }), automazione({ schema, api, errore }));
  return lista;
}

// ---------- personalizzare a parole: la modifica dello schema ----------
const COLORE = n => (/restitu|pagat|fatt[oa]|complet|consegnat|chius|accettat|evas|conclus|saldat/i.test(n) ? 'verde' : /annull|rifiut|pers[oa]|ritard|scadut/i.test(n) ? 'rosso'
  : /in corso|attiv|noleggiat|lavoraz|apert|confermat|spedit|in prova/i.test(n) ? 'blu' : /attesa|sospes|da /i.test(n) ? 'giallo' : 'grigio');
const NOME_TIPO = { testo: 'testo', testo_lungo: 'testo lungo', numero: 'numero', valuta: 'importo', percentuale: 'percentuale', data: 'data', data_ora: 'data e ora', si_no: 'sì/no',
  scelta: 'scelta', scelta_multipla: 'scelta multipla', stato: 'stato', relazione: 'collegamento', calcolato: 'formula', contatore: 'numerazione', email: 'email', telefono: 'telefono',
  url: 'sito', indirizzo: 'indirizzo', codice_a_barre: 'codice a barre', durata: 'durata' };
const pulisci = d => { const x = structuredClone(d); delete x.puo; delete x.archiviata; x.campi = x.campi.map(c => { const y = { ...c }; delete y.sola_lettura; return y; }); return x; };

function campoNuovo(o, schema, def) {
  const tipo = o.tipo_campo || 'testo';
  if (!TIPI_CAMPO.includes(tipo)) throw new Error(`tipo di campo sconosciuto «${tipo}»`);
  let id = slug(o.nome || o.campo || 'campo'); const usati = new Set(def.campi.map(c => c.id)); for (let i = 2; usati.has(id); i++) id = `${slug(o.nome)}_${i}`;
  const c = { id, nome: String(o.nome || id).slice(0, 80), tipo };
  if (o.obbligatorio) c.obbligatorio = true;
  if (['scelta', 'scelta_multipla', 'stato'].includes(tipo)) {
    const op = (o.opzioni || []).map(String).filter(Boolean); if (!op.length) throw new Error(`«${c.nome}»: servono le opzioni`);
    c.opzioni = op.map(n => ({ id: slug(n), nome: n, colore: tipo === 'stato' ? COLORE(n) : 'grigio' }));
    if (tipo === 'stato') c.iniziale = c.opzioni[0].id;
  }
  if (tipo === 'relazione') {
    const dest = schema.find(e => e.id === o.collegato_a || e.nome.toLowerCase() === String(o.collegato_a || '').toLowerCase());
    if (!dest) throw new Error(`«${c.nome}»: collegamento a una sezione che non c'è («${o.collegato_a || '?'}»)`);
    c.entita = dest.id; if (o.molti) c.molti = true;
  }
  if (tipo === 'calcolato') { if (!o.formula) throw new Error(`«${c.nome}»: manca la formula`); c.formula = o.formula; if (o.formato) c.formato = o.formato; }
  if (tipo === 'contatore') c.formato = o.formato && o.formato.includes('{N') ? o.formato : `${def.id.slice(0, 3).toUpperCase()}-{AAAA}-{N:4}`;
  return c;
}
const descriviCampo = (c, schema) => `${NOME_TIPO[c.tipo] || c.tipo}${c.opzioni ? ': ' + c.opzioni.map(o => o.nome).join(', ') : ''}${c.entita ? ' → ' + (schema.find(e => e.id === c.entita)?.nome || c.entita) : ''}${c.formula ? ' = ' + c.formula : ''}${c.obbligatorio ? ' · obbligatorio' : ''}`;

export function applicaOperazioni(schema, operazioni) {
  const lavoro = new Map(), righe = [], archiviati = [];
  const prendi = id => { if (!lavoro.has(id)) { const d = schema.find(e => e.id === id || e.nome.toLowerCase() === String(id).toLowerCase()); if (!d) throw new Error(`sezione sconosciuta «${id}»`); lavoro.set(d.id, pulisci(d)); } return lavoro.get(schema.find(e => e.id === id || e.nome.toLowerCase() === String(id).toLowerCase())?.id ?? id); };
  const campoDi = (def, k) => { const c = def.campi.find(x => !x.archiviato && (x.id === k || x.nome.toLowerCase() === String(k).toLowerCase())); if (!c) throw new Error(`in «${def.nome}» non c'è il campo «${k}»`); return c; };
  for (const o of operazioni) {
    if (o.tipo === 'nuova_sezione') {
      const id = slug(o.sezione || o.nome); if (schema.some(e => e.id === id) || lavoro.has(id)) throw new Error(`la sezione «${id}» esiste già: aggiungi i campi a quella`);
      const def = { id, nome: String(o.nome || o.sezione).slice(0, 60), icona: ICONE.includes(o.icona) ? o.icona : 'cartella', campi: [] };
      for (const x of o.campi || []) def.campi.push(campoNuovo(x, [...schema, def], def));
      if (!def.campi.length) throw new Error('una sezione nuova vuole almeno un campo');
      const t = def.campi.find(c => c.tipo === 'testo') || def.campi.find(c => c.tipo === 'contatore');
      if (t) def.titolo = t.id; else { def.campi.unshift({ id: 'numero', nome: 'Numero', tipo: 'contatore', formato: `${id.slice(0, 3).toUpperCase()}-{AAAA}-{N:4}` }); def.titolo = 'numero'; }
      lavoro.set(id, def); schema = [...schema, def];
      righe.push([`Nuova sezione`, def.nome]);
      for (const c of def.campi) righe.push([`${def.nome} · ${c.nome}`, descriviCampo(c, schema)]);
      continue;
    }
    const def = prendi(o.sezione);
    if (o.tipo === 'aggiungi_campo') { const c = campoNuovo(o, schema, def); def.campi.push(c); righe.push([`${def.nome} · + ${c.nome}`, descriviCampo(c, schema)]); }
    else if (o.tipo === 'rinomina_campo') { const c = campoDi(def, o.campo); righe.push([`${def.nome} · ${c.nome}`, `si chiamerà «${o.nome}» (i valori restano)`]); c.nome = String(o.nome).slice(0, 80); }
    else if (o.tipo === 'archivia_campo') { const c = campoDi(def, o.campo); def.campi = def.campi.filter(x => x !== c); archiviati.push(`${def.id}.${c.id}`); righe.push([`${def.nome} · ${c.nome}`, 'archiviato (i valori restano e si può ripristinare)']); }
    else if (o.tipo === 'aggiungi_opzioni') {
      const c = campoDi(def, o.campo); if (!c.opzioni) throw new Error(`«${c.nome}» non ha opzioni`);
      const nuove = (o.opzioni || []).map(String).filter(n => n && !c.opzioni.some(x => x.nome.toLowerCase() === n.toLowerCase() || x.id === slug(n)));
      if (!nuove.length) throw new Error(`«${c.nome}» ha già queste opzioni`);
      c.opzioni = [...c.opzioni, ...nuove.map(n => ({ id: slug(n), nome: n, colore: c.tipo === 'stato' ? COLORE(n) : 'grigio' }))];
      if (c.transizioni) for (const n of nuove) c.transizioni[slug(n)] ||= [];
      righe.push([`${def.nome} · ${c.nome}`, `+ ${nuove.join(', ')}`]);
    } else if (o.tipo === 'formula') { const c = campoDi(def, o.campo); if (c.tipo !== 'calcolato') throw new Error(`«${c.nome}» non è un campo calcolato`); righe.push([`${def.nome} · ${c.nome}`, `${c.formula} → ${o.formula}`]); c.formula = o.formula; if (o.formato) c.formato = o.formato; }
    else if (o.tipo === 'obbligatorio') { const c = campoDi(def, o.campo); c.obbligatorio = o.obbligatorio !== false || undefined; righe.push([`${def.nome} · ${c.nome}`, c.obbligatorio ? 'diventa obbligatorio' : 'non più obbligatorio']); }
    else if (o.tipo === 'rinomina_sezione') { righe.push([def.nome, `si chiamerà «${o.nome}»`]); def.nome = String(o.nome).slice(0, 60); }
    else throw new Error(`operazione sconosciuta «${o.tipo}»`);
  }
  return { entita: [...lavoro.values()], righe, archiviati };
}

function modificaSchema({ schema, api, dopoSchema, errore }) {
  const memo = new Map();
  return {
    nome: 'proponi_modifica_schema',
    descrizione: 'Cambia la forma del gestionale: aggiunge, rinomina o archivia campi, aggiunge opzioni, cambia una formula, crea una sezione nuova. La persona vede l\'anteprima e conferma. Nessuna modifica perde dati: un campo tolto resta archiviato. Per un collegamento a una sezione che esiste già usa tipo_campo «relazione» e collegato_a con il suo id.',
    schema: { type: 'object', properties: { operazioni: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: {
      tipo: { type: 'string', enum: ['aggiungi_campo', 'rinomina_campo', 'archivia_campo', 'aggiungi_opzioni', 'formula', 'obbligatorio', 'nuova_sezione', 'rinomina_sezione'] },
      sezione: { type: 'string', maxLength: 60, description: 'id della sezione (per nuova_sezione: il nome della nuova)' },
      campo: { type: 'string', maxLength: 60, description: 'id del campo esistente' }, nome: { type: 'string', maxLength: 80, description: 'nome nuovo o del campo nuovo' },
      tipo_campo: { type: 'string', enum: TIPI_CAMPO }, opzioni: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 60 } },
      collegato_a: { type: 'string', maxLength: 60 }, molti: { type: 'boolean' }, formula: { type: 'string', maxLength: 500 },
      formato: { type: 'string', enum: ['valuta', 'percentuale', 'numero', 'si_no'] }, obbligatorio: { type: 'boolean' }, icona: { type: 'string', enum: ICONE },
      campi: { type: 'array', maxItems: 40, description: 'per nuova_sezione', items: { type: 'object', properties: {
        nome: { type: 'string', maxLength: 80 }, tipo_campo: { type: 'string', enum: TIPI_CAMPO }, opzioni: { type: 'array', items: { type: 'string', maxLength: 60 } },
        collegato_a: { type: 'string' }, molti: { type: 'boolean' }, formula: { type: 'string' }, formato: { type: 'string' }, obbligatorio: { type: 'boolean' } }, required: ['nome'] } },
    }, required: ['tipo', 'sezione'] } } }, required: ['operazioni'] },
    proponi: async inp => {
      let m; try { m = applicaOperazioni(schema, inp.operazioni); } catch (e) { return { errore: e.message }; }
      try {
        const v = await api('POST', '/lumi/verifica', { entita: m.entita });
        // solo i campi chiesti: chi non vede tutti i campi non deve archiviare per sbaglio quelli nascosti
        const extra = (v.archivia || []).filter(x => !m.archiviati.includes(x));
        if (extra.length) return { errore: `la modifica toglierebbe campi che questa persona non vede (${extra.join(', ')}): serve il titolare` };
        if (!v.ok) return { errore: 'la modifica non va: ' + v.errori.join('; ') };
      } catch (e) { return errore(e); }
      memo.set(inp, m);
      return { titolo: 'Modifica del gestionale', righe: m.righe, nota: 'Si può sempre tornare indietro: i dati non si perdono.' };
    },
    esegui: async inp => {
      const m = memo.get(inp) || applicaOperazioni(schema, inp.operazioni);
      try { for (const d of m.entita) await api('PUT', `/schema/${d.id}`, d); } catch (e) { return errore(e); }
      await dopoSchema(m.entita.map(d => d.id));
      return { testo: 'Fatto: il gestionale è cambiato.', sezioni: m.entita.map(d => d.id) };
    },
  };
}

// ---------- personalizzare a parole: le automazioni ----------
export function automazioneDa(schema, inp) {
  const def = schema.find(e => e.id === inp.sezione || e.nome.toLowerCase() === String(inp.sezione || '').toLowerCase());
  if (!def) throw new Error(`sezione sconosciuta «${inp.sezione}»`);
  const campo = inp.campo ? def.campi.find(c => c.id === inp.campo || c.nome.toLowerCase() === String(inp.campo).toLowerCase()) : null;
  if (inp.campo && !campo) throw new Error(`in «${def.nome}» non c'è il campo «${inp.campo}»`);
  let a = inp.diventa;
  if (a != null && campo?.opzioni) a = campo.opzioni.find(o => o.id === a || o.nome.toLowerCase() === String(a).toLowerCase())?.id ?? a;
  // un avviso scritto come testo semplice diventa una formula di testo
  const testo = t => (/["&]/.test(t) ? t : `"${String(t).replace(/"/g, '\'')}"`);
  const azioni = (inp.azioni || []).map(x => ({ tipo: x.tipo, ...(x.tipo === 'avvisa' ? { testo: testo(x.testo || '') } : {}), ...(x.campo ? { campo: x.campo } : {}), ...(x.formula ? { formula: x.formula } : {}),
    ...(x.sezione ? { entita: x.sezione } : {}), ...(x.valori ? { valori: x.valori } : {}), ...(x.relazione ? { relazione: x.relazione } : {}), ...(x.aggiungi != null ? { aggiungi: String(x.aggiungi) } : {}),
    ...(x.per_ogni_riga ? { perOgniRiga: x.per_ogni_riga } : {}) }));
  return { def, campo, a: { id: `${def.id}_${slug(inp.nome || 'automazione')}`.slice(0, 60), nome: String(inp.nome || 'Automazione').slice(0, 120), entita: def.id, quando: inp.quando,
    ...(campo ? { campo: campo.id } : {}), ...(a != null ? { a } : {}), ...(inp.se ? { se: inp.se } : {}), azioni } };
}
function automazione({ schema, api, errore }) {
  const memo = new Map();
  const QUANDO = { creato: 'quando si crea', modificato: 'quando si modifica', salvato: 'quando si salva', eliminato: 'quando si archivia', campo_cambia: 'quando cambia' };
  return {
    nome: 'proponi_automazione',
    descrizione: 'Crea un\'automazione: «quando succede X (e la condizione è vera), fai Y». Azioni: avvisa (testo semplice, o una formula con & come "Restituito: " & attrezzo), imposta (campo = formula sulla stessa riga), crea (un elemento in un\'altra sezione, valori come formule), aggiorna_collegato (es. aggiungi -quantita alla giacenza dell\'articolo collegato, anche per_ogni_riga). La persona vede l\'anteprima e conferma.',
    schema: { type: 'object', properties: {
      nome: { type: 'string', maxLength: 120 }, sezione: { type: 'string', maxLength: 60 },
      quando: { type: 'string', enum: Object.keys(QUANDO) }, campo: { type: 'string', maxLength: 60, description: 'per campo_cambia' },
      diventa: { description: 'per campo_cambia: il valore nuovo (per uno stato, l\'id o il nome dell\'opzione)' }, se: { type: 'string', maxLength: 500, description: 'condizione (formula), facoltativa' },
      azioni: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', properties: {
        tipo: { type: 'string', enum: ['avvisa', 'imposta', 'crea', 'aggiorna_collegato'] }, testo: { type: 'string', maxLength: 500 }, campo: { type: 'string' }, formula: { type: 'string', maxLength: 500 },
        sezione: { type: 'string' }, valori: { type: 'object' }, relazione: { type: 'string' }, aggiungi: { type: 'string' }, per_ogni_riga: { type: 'string' } }, required: ['tipo'] } },
    }, required: ['nome', 'sezione', 'quando', 'azioni'] },
    proponi: async inp => {
      let x; try { x = automazioneDa(schema, inp); } catch (e) { return { errore: e.message }; }
      try {
        // un nome già usato non deve sostituire un'automazione che c'è: si aggiunge un numero
        const usati = new Set((await api('GET', '/automazioni')).map(a => a.id)), base = x.a.id;
        for (let i = 2; usati.has(x.a.id); i++) x.a.id = `${base.slice(0, 56)}_${i}`;
      } catch (e) { return errore(e); }
      try { const v = await api('POST', '/lumi/verifica', { automazione: x.a }); if (!v.ok) return { errore: 'l\'automazione non va: ' + v.errori.join('; ') }; } catch (e) { return errore(e); }
      memo.set(inp, x);
      const quando = `${x.def.nome}: ${QUANDO[x.a.quando]}${x.campo ? ` «${x.campo.nome}»` : ''}${x.a.a != null ? ` e diventa «${x.campo?.opzioni?.find(o => o.id === x.a.a)?.nome ?? x.a.a}»` : ''}`;
      const fai = x.a.azioni.map(z => z.tipo === 'avvisa' ? `avvisa: ${z.testo}` : z.tipo === 'imposta' ? `${z.campo} = ${z.formula}` : z.tipo === 'crea' ? `crea in ${z.entita}` : `aggiorna ${z.relazione}.${z.campo} (${z.aggiungi ?? z.formula})`).join(' · ');
      return { titolo: 'Nuova automazione', righe: [['Nome', x.a.nome], ['Quando', quando], ...(x.a.se ? [['Se', x.a.se]] : []), ['Allora', fai]] };
    },
    esegui: async inp => {
      const x = memo.get(inp) || automazioneDa(schema, inp);
      try { await api('PUT', `/automazioni/${x.a.id}`, x.a); } catch (e) { return errore(e); }
      return { testo: 'Fatto: l\'automazione è attiva.', id: x.a.id };
    },
  };
}

// ---------- le istruzioni per il modello: come è fatto Kubo ----------
export function istruzioni({ poteri = {} } = {}) {
  return [
    'Sei dentro Kubo, un gestionale fatto di sezioni (entità) e campi. Gli strumenti si chiamano cerca_<sezione>, leggi_<sezione>, crea_<sezione>, modifica_<sezione>: gli id delle sezioni e dei campi sono quelli negli schemi.',
    'Importi in euro con il punto decimale; date AAAA-MM-GG. Per i collegamenti puoi dare il nome: se è ambiguo lo strumento ti dice quali ci sono, e allora chiedi alla persona.',
    'Per totali, conteggi e confronti usa riepilogo (non sommare tu a mano). Per «cosa devo fare», «cosa c\'è di urgente» usa da_vedere.',
    'Se la persona guarda una scheda (nel contesto), «questo», «questa» si riferiscono a quella: leggila con leggi_<sezione>.',
    poteri.schema ? 'Questa persona può personalizzare il gestionale: per «aggiungi un campo», «fammi una sezione per…», «quando… avvisami» usa proponi_modifica_schema o proponi_automazione. Scegli i tipi giusti (stato per un flusso come prenotato → in corso → restituito, relazione verso le sezioni che esistono già, data per le date). Dopo una sezione nuova i suoi strumenti arrivano al giro successivo.'
      : 'Questa persona non può cambiare la forma del gestionale: se lo chiede, dille che serve il titolare.',
  ].join('\n');
}
