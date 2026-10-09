// Gli avvisi al titolare su un canale (Telegram, Slack, Teams, Discord, webhook): quali eventi, il testo nella lingua
// dell'azienda, una volta sola per riga. Si accendono con le impostazioni «su_<sezione>» (si/no).
// Un evento «nuovo» vale solo per le righe create dopo l'accensione (niente valanga di avvisi su righe vecchie che si
// modificano); la scorta bassa si avvisa quando la giacenza scende alla soglia e si riarma quando torna sopra.
import { nomeDi } from './telefono.js';

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
