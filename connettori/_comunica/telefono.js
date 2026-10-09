// I numeri di telefono per SMS e messaggi: in formato internazionale (E.164, «+393331234567»).
// Un numero senza prefisso prende quello del paese dell'azienda (predefinito +39); «0039…» diventa «+39…».
export function e164(tel, prefisso = '39') {
  let t = String(tel ?? '').replace(/[\s\-./()]/g, '');
  if (!t) return null;
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (!t.startsWith('+')) t = `+${String(prefisso).replace(/\D/g, '')}${t.replace(/^0(?=[1-9])/, prefisso === '39' ? '0' : '')}`;
  return /^\+[1-9]\d{5,14}$/.test(t) ? t : null;
}
// il telefono di un cliente (campo «telefono», o il primo campo di tipo telefono della sezione)
export function telefonoDi(k, cliente, sem = 'clienti') {
  if (!cliente) return null;
  const v = k.valore(cliente, sem, 'telefono'); if (v) return v;
  const def = k.S.leggi(k.db, k.entita(sem)), c = def?.campi.find(x => x.tipo === 'telefono' && !x.archiviato);
  return c ? cliente[c.id] || null : null;
}
// il nome da mostrare di una riga (il campo titolo della sezione, o «nome»)
export function nomeDi(k, riga, sem = 'clienti') {
  if (!riga) return '';
  const def = k.S.leggi(k.db, k.entita(sem)), t = def && k.S.campoTitolo?.(def);
  return String((t && riga[t.id]) ?? k.valore(riga, sem, 'nome') ?? '').trim();
}
