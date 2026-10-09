// Gli avvisi al titolare su un canale (Telegram, Slack, Teams, Discord, webhook): quali eventi, il testo nella lingua
// dell'azienda, una volta sola per riga. Si accendono con le impostazioni «su_<sezione>» (si/no).
// Un evento «nuovo» vale solo per le righe create dopo l'accensione (niente valanga di avvisi su righe vecchie che si
// modificano); la scorta bassa si avvisa quando la giacenza scende alla soglia e si riarma quando torna sopra.
import { nomeDi } from './telefono.js';
import { giornoDi, mezzanotte, piuGiorni } from '../../server/moduli/agenda-aggregati.js';

export const EVENTI = ['vendite', 'appuntamenti', 'prenotazioni', 'clienti', 'articoli'];
const T = {
  it: { vendite: 'Nuova vendita {n}: {tot}{chi}', appuntamenti: 'Nuovo appuntamento: {quando}{chi}', prenotazioni: 'Nuova prenotazione: {quando}{chi}', clienti: 'Nuovo cliente: {nome}', articoli: 'Scorta bassa: {nome} ({q} rimasti)',
    imp: { vendite: 'Avvisa: nuove vendite', appuntamenti: 'Avvisa: nuovi appuntamenti', prenotazioni: 'Avvisa: nuove prenotazioni', clienti: 'Avvisa: nuovi clienti', articoli: 'Avvisa: scorte basse' } },
  en: { vendite: 'New sale {n}: {tot}{chi}', appuntamenti: 'New appointment: {quando}{chi}', prenotazioni: 'New booking: {quando}{chi}', clienti: 'New customer: {nome}', articoli: 'Low stock: {nome} ({q} left)',
    imp: { vendite: 'Notify: new sales', appuntamenti: 'Notify: new appointments', prenotazioni: 'Notify: new bookings', clienti: 'Notify: new customers', articoli: 'Notify: low stock' } },
  es: { vendite: 'Nueva venta {n}: {tot}{chi}', appuntamenti: 'Nueva cita: {quando}{chi}', prenotazioni: 'Nueva reserva: {quando}{chi}', clienti: 'Nuevo cliente: {nome}', articoli: 'Stock bajo: {nome} (quedan {q})',
    imp: { vendite: 'Avisar: ventas nuevas', appuntamenti: 'Avisar: citas nuevas', prenotazioni: 'Avisar: reservas nuevas', clienti: 'Avisar: clientes nuevos', articoli: 'Avisar: stock bajo' } },
  fr: { vendite: 'Nouvelle vente {n} : {tot}{chi}', appuntamenti: 'Nouveau rendez-vous : {quando}{chi}', prenotazioni: 'Nouvelle réservation : {quando}{chi}', clienti: 'Nouveau client : {nome}', articoli: 'Stock bas : {nome} ({q} restants)',
    imp: { vendite: 'Prévenir : nouvelles ventes', appuntamenti: 'Prévenir : nouveaux rendez-vous', prenotazioni: 'Prévenir : nouvelles réservations', clienti: 'Prévenir : nouveaux clients', articoli: 'Prévenir : stock bas' } },
  de: { vendite: 'Neuer Verkauf {n}: {tot}{chi}', appuntamenti: 'Neuer Termin: {quando}{chi}', prenotazioni: 'Neue Reservierung: {quando}{chi}', clienti: 'Neuer Kunde: {nome}', articoli: 'Niedriger Bestand: {nome} ({q} übrig)',
    imp: { vendite: 'Melden: neue Verkäufe', appuntamenti: 'Melden: neue Termine', prenotazioni: 'Melden: neue Reservierungen', clienti: 'Melden: neue Kunden', articoli: 'Melden: niedriger Bestand' } },
  pt: { vendite: 'Nova venda {n}: {tot}{chi}', appuntamenti: 'Novo agendamento: {quando}{chi}', prenotazioni: 'Nova reserva: {quando}{chi}', clienti: 'Novo cliente: {nome}', articoli: 'Estoque baixo: {nome} (restam {q})',
    imp: { vendite: 'Avisar: novas vendas', appuntamenti: 'Avisar: novos agendamentos', prenotazioni: 'Avisar: novas reservas', clienti: 'Avisar: novos clientes', articoli: 'Avisar: estoque baixo' } },
};
const PREDEFINITI = { vendite: true, appuntamenti: true, prenotazioni: true, clienti: false, articoli: true };

export const lingua = k => { try { return k.db.prepare("SELECT valore FROM _meta WHERE chiave = 'lingue.azienda'").get()?.valore || 'it'; } catch { return 'it'; } };
const metti = (s, p) => s.replace(/\{(\w+)\}/g, (_, x) => p[x] ?? '');
const titoloRel = v => (v && typeof v === 'object' ? v.titolo || '' : '');

// le impostazioni «su_<sezione>» da mettere nel manifesto, e le loro traduzioni per testi.<lingua>
export const impostazioniAvvisi = () => EVENTI.map(s => ({ id: `su_${s}`, nome: T.it.imp[s], tipo: 'si_no', predefinito: PREDEFINITI[s] }));
export const testiAvvisi = l => Object.fromEntries(EVENTI.map(s => [`imp.su_${s}`, T[l].imp[s]]));

// il testo dell'avviso per una riga
export function testoEvento(k, sem, r) {
  const l = T[lingua(k)] ? lingua(k) : 'it', loc = { it: 'it-IT', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT' }[l];
  const q = k.valore(r, sem, 'quando'), quando = q ? new Date(q).toLocaleString(loc, { timeZone: k.fuso(), weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const chi = [titoloRel(k.valore(r, sem, 'cliente')), titoloRel(k.valore(r, sem, 'servizio') ?? k.valore(r, sem, 'trattamento')), sem === 'prenotazioni' ? [k.valore(r, sem, 'nome'), k.valore(r, sem, 'persone') && `${k.valore(r, sem, 'persone')} pax`].filter(Boolean).join(' ') : ''].filter(Boolean);
  const n = k.valore(r, sem, 'numero');
  return metti(T[l][sem], { n: n == null ? '' : /^\d+$/.test(String(n)) ? `n. ${n}` : String(n), tot: k.euro(k.valore(r, sem, 'totale')), chi: chi.length ? ` · ${chi.join(' · ')}` : '', quando, nome: nomeDi(k, r, sem), q: k.valore(r, sem, 'giacenza') ?? '' });
}

// va avvisata? (si chiama con la riga dell'evento, prima della coda, e di nuovo con la riga letta, prima di mandare)
function daAvvisare(k, sem, r) {
  if (!r?.id || !k.imp[`su_${sem}`]) return false;
  if (sem === 'articoli') {
    const g = Number(k.valore(r, sem, 'giacenza')), s = Number(k.valore(r, sem, 'soglia'));
    const sotto = Number.isFinite(g) && Number.isFinite(s) && k.valore(r, sem, 'soglia') != null && g <= s, avvisati = k.stato.leggi('scorte') || [];
    if (!sotto && avvisati.includes(r.id)) k.stato.scrivi('scorte', avvisati.filter(x => x !== r.id));   // tornata sopra: si riarma
    return sotto && !avvisati.includes(r.id);
  }
  const t = Date.parse(r.creato || 0), dal = k.stato.leggi('acceso') || 0;
  return t >= dal && Date.now() - t < 864e5 && !(k.stato.leggi(`avvisati.${sem}`) || []).includes(r.id);
}
function segna(k, sem, r) {
  const c = sem === 'articoli' ? 'scorte' : `avvisati.${sem}`;
  k.stato.scrivi(c, [...(k.stato.leggi(c) || []), r.id].slice(-2000));
}

// l'«uscita» del manifesto: una voce per sezione, manda(k, testo, { sem, riga }) è il canale del connettore
export function uscitaAvvisi(manda) {
  return Object.fromEntries(EVENTI.map(sem => [sem, {
    campi: sem === 'articoli' ? ['giacenza', 'soglia'] : [], unisci: 'ultimo',
    quando: (r, k) => daAvvisare(k, sem, r),
    async invia(r, k) { if (!daAvvisare(k, sem, r)) return; await manda(k, testoEvento(k, sem, r), { sem, riga: r }); segna(k, sem, r); },
  }]));
}
// da chiamare in attiva(k): gli avvisi valgono da adesso
export const segnaAcceso = k => { if (!k.stato.leggi('acceso')) k.stato.scrivi('acceso', Date.now() - 1000); };

// ---------- il riepilogo della sera: vendite di oggi, appuntamenti e prenotazioni di domani, scorte basse, fatture scadute ----------
const R = {
  it: { titolo: 'Riepilogo di {g}', vendite: 'Vendite: {n}, {tot}', nessuna: 'Vendite: nessuna', app: 'Appuntamenti di domani: {n}', pren: 'Prenotazioni di domani: {n} (persone: {p})', scorte: 'Articoli sotto scorta: {n}', scadute: 'Fatture scadute: {n}', imp: 'Riepilogo ogni sera alle 20' },
  en: { titolo: 'Summary of {g}', vendite: 'Sales: {n}, {tot}', nessuna: 'Sales: none', app: 'Appointments tomorrow: {n}', pren: 'Bookings tomorrow: {n} (people: {p})', scorte: 'Items low on stock: {n}', scadute: 'Overdue invoices: {n}', imp: 'Summary every evening at 8 pm' },
  es: { titolo: 'Resumen del {g}', vendite: 'Ventas: {n}, {tot}', nessuna: 'Ventas: ninguna', app: 'Citas de mañana: {n}', pren: 'Reservas de mañana: {n} (personas: {p})', scorte: 'Artículos con stock bajo: {n}', scadute: 'Facturas vencidas: {n}', imp: 'Resumen cada tarde a las 20' },
  fr: { titolo: 'Résumé du {g}', vendite: 'Ventes : {n}, {tot}', nessuna: 'Ventes : aucune', app: 'Rendez-vous de demain : {n}', pren: 'Réservations de demain : {n} (personnes : {p})', scorte: 'Articles en stock bas : {n}', scadute: 'Factures échues : {n}', imp: 'Résumé chaque soir à 20 h' },
  de: { titolo: 'Zusammenfassung vom {g}', vendite: 'Verkäufe: {n}, {tot}', nessuna: 'Verkäufe: keine', app: 'Termine morgen: {n}', pren: 'Reservierungen morgen: {n} (Personen: {p})', scorte: 'Artikel mit niedrigem Bestand: {n}', scadute: 'Überfällige Rechnungen: {n}', imp: 'Zusammenfassung jeden Abend um 20 Uhr' },
  pt: { titolo: 'Resumo de {g}', vendite: 'Vendas: {n}, {tot}', nessuna: 'Vendas: nenhuma', app: 'Agendamentos de amanhã: {n}', pren: 'Reservas de amanhã: {n} (pessoas: {p})', scorte: 'Artigos com estoque baixo: {n}', scadute: 'Faturas vencidas: {n}', imp: 'Resumo todas as noites às 20h' },
};
export const impRiepilogo = { id: 'riepilogo', nome: R.it.imp, tipo: 'si_no', predefinito: true };
export const testiRiepilogo = l => ({ 'imp.riepilogo': R[l].imp, 'giro.riepilogo': R[l].imp });
// tutte le righe che passano i filtri (a pagine da 500, al massimo 20.000)
function* tutte(k, sem, filtri) {
  for (let p = 1; p <= 40; p++) { let l = []; try { l = k.dati.elenca(sem, { filtri, pagina: p, perPagina: 500 }).righe; } catch { return; } yield* l; if (l.length < 500) return; }
}
export function testoRiepilogo(k, adesso = Date.now()) {
  const l = R[lingua(k)] ? lingua(k) : 'it', t = R[l], fuso = k.fuso(), oggi = giornoDi(adesso, fuso), domani = piuGiorni(oggi, 1), righe = [];
  if (k.campo('vendite', 'data')) {
    let n = 0, tot = 0; for (const v of tutte(k, 'vendite', [{ campo: 'data', op: '=', valore: oggi }])) { if (/annull/i.test(String(k.valore(v, 'vendite', 'stato') || ''))) continue; n++; tot += Number(k.valore(v, 'vendite', 'totale')) || 0; }
    righe.push(n ? metti(t.vendite, { n, tot: k.euro(tot) }) : t.nessuna);
  }
  const daDomani = [{ campo: 'quando', op: '>=', valore: mezzanotte(domani, fuso) }, { campo: 'quando', op: '<', valore: mezzanotte(piuGiorni(domani, 1), fuso) }];
  if (k.campo('appuntamenti', 'quando')) { const n = [...tutte(k, 'appuntamenti', daDomani)].filter(a => !/annull/i.test(String(k.valore(a, 'appuntamenti', 'stato') || ''))).length; if (n) righe.push(metti(t.app, { n })); }
  if (k.campo('prenotazioni', 'quando')) { const l2 = [...tutte(k, 'prenotazioni', daDomani)].filter(a => !/annull/i.test(String(k.valore(a, 'prenotazioni', 'stato') || ''))); if (l2.length) righe.push(metti(t.pren, { n: l2.length, p: l2.reduce((s, x) => s + (Number(k.valore(x, 'prenotazioni', 'persone')) || 0), 0) })); }
  if (k.campo('articoli', 'soglia')) { let n = 0; for (const a of tutte(k, 'articoli', [])) { const g = Number(k.valore(a, 'articoli', 'giacenza')), s = k.valore(a, 'articoli', 'soglia'); if (s != null && Number.isFinite(g) && g <= Number(s)) n++; } if (n) righe.push(metti(t.scorte, { n })); }
  if (k.campo('fatture', 'scadenza')) { const n = [...tutte(k, 'fatture', [{ campo: 'stato', op: '=', valore: 'emessa' }, { campo: 'scadenza', op: '<', valore: oggi }])].length; if (n) righe.push(metti(t.scadute, { n })); }
  const g = new Date(adesso).toLocaleDateString({ it: 'it-IT', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT' }[l], { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long' });
  return `${metti(t.titolo, { g })}\n${righe.map(r => `- ${r}`).join('\n')}`;
}
export const giroRiepilogo = manda => ({ nome: R.it.imp, alle: '20:00', async giro(k) {
  if (!k.imp.riepilogo) return { saltato: 'spento' };
  const testo = testoRiepilogo(k); await manda(k, testo); return { inviato: true, righe: testo.split('\n').length - 1 };
} });
