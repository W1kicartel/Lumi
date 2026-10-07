// Utenti e sessioni. Password con scrypt (node:crypto), sessioni con un token casuale in un cookie HttpOnly/SameSite=Strict.
// Il primo avvio crea il titolare. Il PIN (4-8 cifre) serve per cambiare utente al volo sullo stesso PC del banco.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { nuovoId, registra } from './db.js';
import { ruolo } from './permessi.js';

const hash = (pw, sale = randomBytes(16)) => `s1$${sale.toString('hex')}$${scryptSync(String(pw), sale, 32, { N: 16384 }).toString('hex')}`;
function verifica(pw, h) {
  const [, sale, atteso] = String(h || '').split('$'); if (!sale) return false;
  const a = Buffer.from(scryptSync(String(pw), Buffer.from(sale, 'hex'), 32, { N: 16384 }).toString('hex')), b = Buffer.from(atteso);
  return a.length === b.length && timingSafeEqual(a, b);
}
export class ErroreAccesso extends Error {}
const DURATA = 30 * 864e5;

export const quanti = db => db.prepare('SELECT COUNT(*) n FROM _utenti').get().n;
export function creaUtente(db, { nome, email, password, ruolo: r = 'collaboratore', pin = null }, { utente = null } = {}) {
  if (!nome || !email) throw new ErroreAccesso('Servono nome ed email');
  if (String(password || '').length < 8) throw new ErroreAccesso('La password deve avere almeno 8 caratteri');
  if (pin != null && !/^\d{4,8}$/.test(String(pin))) throw new ErroreAccesso('Il PIN è di 4-8 cifre');
  if (db.prepare('SELECT 1 FROM _utenti WHERE email = ?').get(email)) throw new ErroreAccesso('Esiste già un utente con questa email');
  const id = nuovoId();
  db.prepare('INSERT INTO _utenti (id, nome, email, hash, ruolo, pin, creato) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, nome, email, hash(password), r, pin == null ? null : hash(pin), new Date().toISOString());
  registra(db, { utente, tipo: 'utente', riga: id, dopo: { nome, email, ruolo: r } });
  return pubblico(db.prepare('SELECT * FROM _utenti WHERE id = ?').get(id));
}
export const pubblico = u => u && ({ id: u.id, nome: u.nome, email: u.email, ruolo: u.ruolo, attivo: !!u.attivo, pin: !!u.pin });
// le identità di servizio dei connettori («servizio:stripe», server/moduli/connettori.js) non sono persone: non si elencano
export const utenti = db => db.prepare("SELECT * FROM _utenti WHERE id NOT LIKE 'servizio:%' ORDER BY nome").all().map(pubblico);

export function accedi(db, { email, password }, agente = '') {
  const u = db.prepare('SELECT * FROM _utenti WHERE email = ? AND attivo = 1').get(String(email || ''));
  // stesso tempo anche se l'utente non esiste
  if (!u) { verifica(password, hash('x')); throw new ErroreAccesso('Email o password sbagliate'); }
  if (!verifica(password, u.hash)) { registra(db, { utente: u.id, tipo: 'accesso_fallito' }); throw new ErroreAccesso('Email o password sbagliate'); }
  return nuovaSessione(db, u, agente);
}
export function accediPin(db, { id, pin }, agente = '') {
  const u = db.prepare('SELECT * FROM _utenti WHERE id = ? AND attivo = 1 AND pin IS NOT NULL').get(String(id || ''));
  if (!u || !verifica(pin, u.pin)) throw new ErroreAccesso('PIN sbagliato');
  return nuovaSessione(db, u, agente);
}
function nuovaSessione(db, u, agente) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO _sessioni (token, utente, scade, agente) VALUES (?, ?, ?, ?)').run(token, u.id, new Date(Date.now() + DURATA).toISOString(), String(agente).slice(0, 200));
  db.prepare('DELETE FROM _sessioni WHERE scade < ?').run(new Date().toISOString());
  registra(db, { utente: u.id, tipo: 'accesso' });
  return { token, utente: pubblico(u) };
}
export function esci(db, token) { db.prepare('DELETE FROM _sessioni WHERE token = ?').run(String(token || '')); }
// dal token al contesto dei permessi { utente, r }. Un token che non è una sessione passa agli altri verificatori
// (i token personali delle API, server/moduli/import-api.js): f(db, token) → { utente, r } | null.
const verificatori = [];
export const aggiungiVerificatore = f => { verificatori.push(f); };
export function contesto(db, token) {
  if (!token) return null;
  const u = db.prepare('SELECT u.* FROM _sessioni s JOIN _utenti u ON u.id = s.utente WHERE s.token = ? AND s.scade > ? AND u.attivo = 1').get(String(token), new Date().toISOString());
  if (u) return { utente: pubblico(u), r: ruolo(db, u.ruolo) };
  for (const f of verificatori) { const c = f(db, String(token)); if (c) return c; }
  return null;
}
export function modificaUtente(db, id, { nome, ruolo: r, attivo, password, pin }, { utente = null } = {}) {
  const u = db.prepare('SELECT * FROM _utenti WHERE id = ?').get(id); if (!u) throw new ErroreAccesso('Utente sconosciuto');
  if (u.ruolo === 'titolare' && (r && r !== 'titolare' || attivo === false) && db.prepare("SELECT COUNT(*) n FROM _utenti WHERE ruolo = 'titolare' AND attivo = 1").get().n < 2) throw new ErroreAccesso('Serve almeno un titolare attivo');
  if (password != null && String(password).length < 8) throw new ErroreAccesso('La password deve avere almeno 8 caratteri');
  if (pin != null && pin !== '' && !/^\d{4,8}$/.test(String(pin))) throw new ErroreAccesso('Il PIN è di 4-8 cifre');
  db.prepare('UPDATE _utenti SET nome = ?, ruolo = ?, attivo = ?, hash = ?, pin = ? WHERE id = ?').run(nome ?? u.nome, r ?? u.ruolo, attivo == null ? u.attivo : attivo ? 1 : 0,
    password ? hash(password) : u.hash, pin === '' ? null : pin ? hash(pin) : u.pin, id);
  if (attivo === false || password) db.prepare('DELETE FROM _sessioni WHERE utente = ?').run(id);
  registra(db, { utente, tipo: 'utente', riga: id, dopo: { nome, ruolo: r, attivo } });
  return pubblico(db.prepare('SELECT * FROM _utenti WHERE id = ?').get(id));
}
// la password attuale di un utente è giusta? (per cambiarla serve quella vecchia: server/moduli/sicurezza.js)
export function verificaPassword(db, id, pw) { const u = db.prepare('SELECT hash FROM _utenti WHERE id = ?').get(String(id)); return !!u && verifica(pw, u.hash); }
