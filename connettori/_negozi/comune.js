// Attrezzi comuni dei connettori dei negozi e delle spedizioni (la cartella comincia con «_»: il nucleo non la carica
// come connettore). Ordini dei canali → vendite di Kubo (righe abbinate per codice, cliente trovato o creato per email),
// la vendita chiesta da una persona o da Lumi (per id o per numero), il destinatario di una spedizione dal cliente della
// vendita, lo stato della spedizione scritto sulla vendita (nei campi «tracking» e «spedizione» se ci sono, se no nelle note).
import { scomponiIndirizzo } from '../../server/moduli/sicurezza-migrazioni.js';

export const tondo = n => Math.round(Number(n || 0) * 100) / 100;
// i soli campi che lo schema ha davvero (un campo sconosciuto fa fallire la scrittura)
export const soloCampi = (k, sem, valori) => Object.fromEntries(Object.entries(valori).filter(([c, v]) => v != null && v !== '' && k.campo(sem, c)));

// il cliente di un ordine: per email, se no si crea (se il connettore ha il permesso). → id o null
export function cliente(k, c = {}) {
  try {
    const email = String(c.email || '').trim().toLowerCase();
    if (email && k.campo('clienti', 'email')) { const x = k.dati.trova('clienti', 'email', email); if (x) return x.id; }
    if (!c.nome && !email) return null;
    const ind = [c.via, [c.cap, c.comune, c.provincia && `(${c.provincia})`].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return k.dati.crea('clienti', soloCampi(k, 'clienti', { nome: c.nome || email, email, telefono: c.telefono, via: c.via, cap: c.cap, comune: c.comune, provincia: c.provincia,
      ...(k.campo('clienti', 'via') ? {} : { indirizzo: ind }) })).id;
  } catch { return null; }
}

// le righe di un ordine abbinate agli articoli per codice. linee: [{ sku, nome, q, prezzo (ivato, a pezzo) }] → righe o null
export function righeDa(k, linee, etichetta) {
  const righe = [];
  for (const l of linee) {
    const a = l.sku ? k.dati.trova('articoli', 'codice', String(l.sku)) : null;
    if (!a) { k.avvisa(`${etichetta}: articolo ${l.sku || l.nome || '?'} sconosciuto`); return null; }
    righe.push({ articolo: a.id, quantita: Number(l.q) || 1, prezzo: tondo(l.prezzo) });
  }
  return righe;
}

// un ordine del canale diventa una vendita pagata, una volta sola. o: { id, numero, linee, cliente, canale }
export function importaOrdine(k, o) {
  if (k.sincro.locale('vendite', o.id)) return 'ignorato: già importato';
  const etichetta = `ordine ${o.canale || ''} ${o.numero || o.id}`.replace(/\s+/g, ' ');
  const righe = righeDa(k, o.linee || [], etichetta); if (!righe) return 'ignorato: articolo sconosciuto';
  const cid = o.cliente ? cliente(k, o.cliente) : null;
  const v = k.dati.crea('vendite', { stato: 'pagata', righe, ...soloCampi(k, 'vendite', { cliente: cid, note: `${o.canale || 'Web'}: ordine ${o.numero || o.id}` }) });
  k.sincro.collega('vendite', v.id, o.id);
  return 'vendita creata';
}

// la vendita chiesta: un id, una riga, oppure il numero che si legge in Kubo («1043», «2026/0012»)
export function venditaDa(k, x) {
  if (x && typeof x === 'object' && x.id) return x;
  const s = String(x ?? '').trim(); if (!s) throw new Error('Quale vendita?');
  try { return k.dati.leggi('vendite', s); } catch { }
  const v = k.campo('vendite', 'numero') ? k.dati.trova('vendite', 'numero', s) : null;
  if (!v) throw new Error(`Vendita ${s} non trovata`);
  return v;
}

// il destinatario dal cliente della vendita: via/cap/comune/provincia, o il campo libero «indirizzo» scomposto
export function destinatario(k, v) {
  const cid = k.valore(v, 'vendite', 'cliente'), id = typeof cid === 'object' ? cid?.id : cid;
  if (!id) throw new Error('La vendita non ha un cliente con l\'indirizzo');
  const c = k.dati.leggi('clienti', id), val = n => (k.valore(c, 'clienti', n) ?? '').toString().trim();
  let ind = { via: val('via'), cap: val('cap'), comune: val('comune'), provincia: val('provincia') };
  if (!ind.via && val('indirizzo')) ind = scomponiIndirizzo(val('indirizzo')) || ind;
  if (!ind.via || !ind.cap || !ind.comune) throw new Error(`Il cliente ${val('nome')} non ha un indirizzo completo (via, CAP, comune)`);
  // «Via Roma 12» → via «Via Roma», civico «12» (i corrieri li vogliono separati)
  const m = /^(.*?)[\s,]+(\d+[a-zA-Z]?(?:\/\w+)?)$/.exec(ind.via);
  return { nome: val('nome'), email: val('email'), telefono: val('telefono'), via: m ? m[1] : ind.via, civico: m ? m[2] : '', indirizzo: ind.via,
    cap: ind.cap, comune: ind.comune, provincia: ind.provincia, paese: val('paese') || 'IT' };
}

// lo stato della spedizione sulla vendita: nei campi «tracking» e «spedizione» se lo schema li ha, se no una riga nelle note
export function segnaSpedizione(k, venditaId, { corriere = '', tracking = '', stato = '', url = '' } = {}) {
  const v = k.dati.leggi('vendite', venditaId), campi = soloCampi(k, 'vendite', { tracking, spedizione: stato });
  const riga = `Spedizione${corriere ? ' ' + corriere : ''}${tracking ? ' ' + tracking : ''}: ${stato}${url ? ' ' + url : ''}`;
  if (!Object.keys(campi).length || !k.campo('vendite', 'spedizione')) {
    const note = String(k.valore(v, 'vendite', 'note') || ''); if (note.includes(riga)) return v;
    if (k.campo('vendite', 'note')) campi.note = (note ? note + '\n' : '') + riga;
  }
  return Object.keys(campi).length ? k.dati.modifica('vendite', venditaId, campi) : v;
}

// i testi comuni dei campi facoltativi delle spedizioni
export const RICHIEDE_SPEDIZIONI = {
  vendite: { cliente: { tipo: 'relazione' }, note: { tipo: 'testo_lungo', facoltativo: true }, tracking: { tipo: 'testo', facoltativo: true }, spedizione: { tipo: ['testo', 'scelta', 'stato'], facoltativo: true } },
  clienti: { nome: { tipo: 'testo' }, email: { tipo: 'email', facoltativo: true }, telefono: { tipo: 'telefono', facoltativo: true }, indirizzo: { tipo: ['indirizzo', 'testo', 'testo_lungo'], facoltativo: true },
    via: { tipo: 'testo', facoltativo: true }, cap: { tipo: 'testo', facoltativo: true }, comune: { tipo: 'testo', facoltativo: true }, provincia: { tipo: 'testo', facoltativo: true } },
};
export const RICHIEDE_NEGOZI = {
  articoli: { codice: { tipo: 'testo', alias: ['sku'] }, nome: { tipo: 'testo' }, prezzo: { tipo: 'valuta' }, giacenza: { tipo: 'numero' } },
  vendite: { stato: { tipo: 'stato' }, righe: { tipo: 'righe' }, cliente: { tipo: 'relazione', facoltativo: true }, note: { tipo: 'testo_lungo', facoltativo: true } },
  clienti: { nome: { tipo: 'testo', facoltativo: true }, email: { tipo: 'email', facoltativo: true }, telefono: { tipo: 'telefono', facoltativo: true } },
};
export const PERMESSI_NEGOZI = { articoli: { leggi: true, crea: true, modifica: true }, vendite: { leggi: true, crea: true }, clienti: { leggi: true, crea: true } };
