// I dati di un'azienda dalla partita IVA (VIES, Openapi imprese): controllo della P.IVA italiana e «compila» di clienti e
// fornitori. Si riempiono solo i campi vuoti: quello che la persona ha scritto non si tocca mai.
export const CAMPI = ['nome', 'piva', 'codice_fiscale', 'via', 'cap', 'comune', 'provincia', 'nazione', 'pec', 'codice_destinatario'];
const fac = Object.fromEntries(CAMPI.map(c => [c, { facoltativo: true }]));
export const RICHIEDE_AZIENDE = { clienti: { ...fac, pec: { tipo: 'email', facoltativo: true } }, fornitori: { ...fac, pec: { tipo: 'email', facoltativo: true } } };
export const PERMESSI_AZIENDE = { clienti: { leggi: true, modifica: true }, fornitori: { leggi: true, modifica: true } };

// «IT 01234567890», «it01234567890», «DE123456789» → { paese, numero }; senza prefisso è italiana
export function divisa(s) {
  const t = String(s ?? '').toUpperCase().replace(/[\s.\-/]/g, ''), m = /^([A-Z]{2})?([0-9A-Z+*]{2,13})$/.exec(t);
  if (!m) return null;
  const paese = m[1] === 'GR' ? 'EL' : (m[1] || 'IT');   // la Grecia nel VIES è «EL»
  return { paese, numero: m[2] };
}
// la cifra di controllo della partita IVA italiana (11 cifre, algoritmo di Luhn come da DM 23/12/1976)
export function pivaValida(n) {
  if (!/^\d{11}$/.test(n) || /^0{11}$/.test(n)) return false;
  let s = 0;
  for (let i = 0; i < 10; i++) { let x = Number(n[i]); if (i % 2) { x *= 2; if (x > 9) x -= 9; } s += x; }
  return (10 - (s % 10)) % 10 === Number(n[10]);
}
// «VIA ROMA 1\n00100 ROMA RM» → { via, cap, comune, provincia }
export function indirizzoIt(s) {
  const righe = String(s ?? '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  const ultima = righe.at(-1) || '', m = /^(\d{5})\s+(.+?)\s+([A-Z]{2})$/.exec(ultima);
  return m ? { via: righe.slice(0, -1).join(' '), cap: m[1], comune: m[2], provincia: m[3] } : { via: righe.join(', ') };
}

// le modifiche da proporre: solo i campi che esistono nella sezione e sono vuoti
export function differenze(k, sem, riga, dati) {
  const out = {};
  for (const c of CAMPI) {
    const v = dati[c]; if (v == null || v === '' || !k.campo(sem, c)) continue;
    const prima = k.valore(riga, sem, c); if (prima != null && String(prima).trim() !== '') continue;
    out[c] = String(v).slice(0, 200);
  }
  return out;
}
const NOMI = { nome: 'Nome', piva: 'Partita IVA', codice_fiscale: 'Codice fiscale', via: 'Via', cap: 'CAP', comune: 'Comune', provincia: 'Provincia', nazione: 'Nazione', pec: 'PEC', codice_destinatario: 'Codice destinatario' };

// le azioni comuni: controlla (Lumi legge) e compila clienti / fornitori. cerca(k, { paese, numero }) → dati con i CAMPI e { valida }
export function azioniAziende(servizio, cerca) {
  const daRiga = (k, sem, r) => divisa(k.valore(r, sem, 'piva'));
  const compila = sem => ({
    nome: `Compila dalla partita IVA (${servizio})`, su: sem, lumi: true, scrive: true,
    descrizione: `Riempie i dati mancanti ${sem === 'clienti' ? 'del cliente' : 'del fornitore'} (ragione sociale, indirizzo${servizio === 'VIES' ? '' : ', PEC, codice destinatario'}) dalla partita IVA`,
    input: { [sem === 'clienti' ? 'cliente' : 'fornitore']: { tipo: 'relazione', entita: sem, nome: sem === 'clienti' ? 'Il cliente' : 'Il fornitore' } },
    async proponi(x, k) {
      const r = x.cliente || x.fornitore, p = daRiga(k, sem, r);
      if (!p) return { titolo: 'Compila dalla partita IVA', righe: [], avvisi: ['Manca la partita IVA'] };
      const d = await cerca(k, p);
      if (!d.valida) return { titolo: 'Compila dalla partita IVA', righe: [['Partita IVA', `${p.paese}${p.numero}`]], avvisi: ['Partita IVA non valida o non trovata'] };
      const diff = differenze(k, sem, r, d);
      return { titolo: 'Compila dalla partita IVA', righe: Object.entries(diff).map(([c, v]) => [NOMI[c], v]), avvisi: Object.keys(diff).length ? [] : ['Niente da aggiungere: i campi sono già pieni'] };
    },
    async esegui(x, k) {
      const r = x.cliente || x.fornitore, p = daRiga(k, sem, r); if (!p) throw new Error('Manca la partita IVA');
      const d = await cerca(k, p); if (!d.valida) throw new Error('Partita IVA non valida o non trovata');
      const diff = differenze(k, sem, r, d); if (Object.keys(diff).length) k.dati.modifica(sem, r.id, diff);
      return { ok: true, compilati: Object.keys(diff) };
    },
  });
  return {
    controlla: {
      nome: `Controlla la partita IVA (${servizio})`, su: 'clienti', lumi: true, descrizione: 'Dice se una partita IVA è valida e a chi appartiene',
      input: { piva: { tipo: 'testo', nome: 'La partita IVA (con il prefisso del Paese se non è italiana)' } },
      async esegui({ piva }, k) {
        const p = divisa(piva); if (!p) return { valida: false, motivo: 'formato' };
        if (p.paese === 'IT' && !pivaValida(p.numero)) return { valida: false, motivo: 'cifra di controllo sbagliata', piva: `IT${p.numero}` };
        return { piva: `${p.paese}${p.numero}`, ...(await cerca(k, p)) };
      },
    },
    compila_cliente: compila('clienti'),
    compila_fornitore: compila('fornitori'),
  };
}
export const testiAziende = (controlla, compila, cli, forn) => ({ 'az.controlla': controlla, 'az.compila_cliente': `${compila} (${cli})`, 'az.compila_fornitore': `${compila} (${forn})` });
