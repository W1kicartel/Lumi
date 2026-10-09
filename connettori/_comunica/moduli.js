// Gli aiuti comuni ai connettori dei moduli del sito e dei lead (Typeform, Tally, Jotform, Google Ads): chi compila un
// modulo diventa un cliente (trovato per email o telefono, altrimenti creato) con la richiesta nelle note; se il modulo
// ha una data e un'ora, diventa anche un appuntamento (agenda.js). Le risposte arrivano già ridotte a
// [{ titolo, tipo: 'email'|'telefono'|'nome'|'nome_proprio'|'cognome'|'data'|'ora'|'data_ora'|'testo', valore }].
import { ricevi } from './agenda.js';
import { opzione } from './tabelle.js';

export const REQ = {
  clienti: { nome: {}, email: { tipo: ['email'], facoltativo: true }, telefono: { tipo: ['telefono', 'testo'], facoltativo: true }, provenienza: { tipo: ['scelta', 'testo'], facoltativo: true }, note: { tipo: ['testo_lungo', 'testo'], facoltativo: true } },
  appuntamenti: { quando: { tipo: ['data_ora'], facoltativo: true }, cliente: { tipo: 'relazione', facoltativo: true }, stato: { tipo: 'stato', facoltativo: true }, note: { tipo: ['testo_lungo', 'testo'], facoltativo: true } },
};
export const PERMESSI = { clienti: { leggi: true, crea: true, modifica: true }, appuntamenti: { leggi: true, crea: true, modifica: true }, servizi: { leggi: true } };
const prova = f => { try { return f(); } catch { return null; } };

// i titoli delle domande che dicono «nome», «cognome», «ora»: in tutte le lingue di Kubo
const COGNOME = /\b(cognome|surname|last ?name|family ?name|apellidos?|nom de famille|nachname|sobrenome|apelido)\b/i;
const NOME = /\b(nome|name|nombre|nom|vorname|prénom|prenom|first ?name|full ?name|nome e cognome|nome completo|chiami|llamas|appelez|heißen|heissen|chama)\b/i;
const ORA = /\b(ora|orario|time|hour|hora|horario|heure|uhrzeit|zeit)\b/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// un testo per le note: liste con virgole, sì/no, oggetti con i loro valori
export function testoDi(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(testoDi).filter(Boolean).join(', ');
  if (typeof v === 'boolean') return v ? 'sì' : 'no';
  if (typeof v === 'object') return Object.values(v).map(testoDi).filter(Boolean).join(' ');
  return String(v).trim();
}

// l'ora di un orologio locale («2026-10-20», «14:30») nel fuso dell'azienda → ISO UTC
export function isoLocale(data, ora = '00:00', fuso = 'Europe/Rome') {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(data || '')), o = /^(\d{1,2})[:.](\d{2})/.exec(String(ora || ''));
  if (!d || !o) return null;
  const utc = Date.UTC(+d[1], +d[2] - 1, +d[3], +o[1], +o[2]);
  // la differenza del fuso a quell'ora (due passi: regge anche il cambio dell'ora legale)
  const scarto = t => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(t).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t; };
  let t = utc - scarto(utc); t = utc - scarto(t);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// dalle risposte: { email, telefono, nome, quando, righe (le altre risposte, «titolo: valore») }
export function leggiRisposte(risposte, fuso) {
  const x = { email: null, telefono: null, nome: null, quando: null, righe: [] }; let proprio = '', cognome = '', data = null, ora = null;
  for (const r of risposte || []) {
    const v = testoDi(r.valore); if (!v) continue;
    let t = r.tipo || 'testo';
    if (t === 'testo' && EMAIL.test(v) && /mail/i.test(r.titolo || '')) t = 'email';
    if (t === 'testo' && COGNOME.test(r.titolo || '')) t = 'cognome';
    else if (t === 'testo' && NOME.test(r.titolo || '') && v.length < 120) t = 'nome';
    if (t === 'testo' && ORA.test(r.titolo || '') && /^\d{1,2}[:.]\d{2}/.test(v)) t = 'ora';
    if (t === 'email' && !x.email && EMAIL.test(v)) x.email = v.toLowerCase();
    else if (t === 'telefono' && !x.telefono) x.telefono = v.replace(/[^\d+]/g, '');
    else if (t === 'nome' && !x.nome) x.nome = v;
    else if (t === 'nome_proprio' && !proprio) proprio = v;
    else if (t === 'cognome' && !cognome) cognome = v;
    else if (t === 'data' && !data) data = v;
    else if (t === 'ora' && !ora) ora = v;
    else if (t === 'data_ora' && !x.quando && !Number.isNaN(Date.parse(v))) x.quando = new Date(v).toISOString();
    else x.righe.push(`${r.titolo || 'Risposta'}: ${v}`);
  }
  if (!x.nome && (proprio || cognome)) x.nome = [proprio, cognome].filter(Boolean).join(' ');
  else if (x.nome && cognome && !x.nome.includes(cognome)) x.nome = `${x.nome} ${cognome}`;
  if (!x.quando && data && ora) x.quando = isoLocale(data, ora, fuso);
  else if (data && !x.quando) x.righe.unshift(`Data: ${data}`);
  return x;
}

// una richiesta da un modulo → cliente (+ appuntamento). remoto: l'id della risposta (per non importarla due volte).
// → 'cliente creato' | 'cliente già presente' | 'già importato' | 'ignorato: …', con «, appuntamento creato» se c'è
export function richiesta(k, { remoto, fonte, modulo, risposte, intestazione, provenienza = 'sito', crea = true }) {
  const id = `${fonte}:${remoto}`;
  if (remoto && k.sincro.locale('clienti', id)) return 'già importato';
  const x = leggiRisposte(risposte, k.fuso());
  if (!x.email && !x.telefono && !x.nome) return 'ignorato: nessun contatto nel modulo';
  const quando = x.quando ? new Date(x.quando).toLocaleString('it-IT', { timeZone: k.fuso(), dateStyle: 'medium', timeStyle: 'short' }) : null;
  const nota = [`${intestazione || fonte}${modulo ? ` · modulo «${modulo}»` : ''} · ${new Date().toLocaleDateString('it-IT', { timeZone: k.fuso() })}`, ...(quando ? [`Data richiesta: ${quando}`] : []), ...x.righe].join('\n').slice(0, 4000);
  const gia = (x.email && k.campo('clienti', 'email') && prova(() => k.dati.trova('clienti', 'email', x.email))) || (x.telefono && k.campo('clienti', 'telefono') && prova(() => k.dati.trova('clienti', 'telefono', x.telefono)));
  let cid, esito;
  if (gia) {
    cid = gia.id; esito = 'cliente già presente';
    // la richiesta nuova si aggiunge alle note (senza perdere quelle di prima)
    if (k.campo('clienti', 'note')) { const prima = k.valore(gia, 'clienti', 'note'); k.dati.modifica('clienti', cid, { note: [prima, nota].filter(Boolean).join('\n\n').slice(-8000) }); }
  } else {
    if (!crea) return 'ignorato: cliente sconosciuto';
    const prov = opzione(k, 'clienti', 'provenienza', provenienza, intestazione || fonte);
    cid = k.dati.crea('clienti', { nome: (x.nome || x.email || x.telefono).slice(0, 200), ...(x.email && k.campo('clienti', 'email') ? { email: x.email } : {}),
      ...(x.telefono && k.campo('clienti', 'telefono') ? { telefono: x.telefono } : {}), ...(prov ? { provenienza: prov } : {}), ...(k.campo('clienti', 'note') ? { note: nota } : {}) }).id;
    esito = 'cliente creato';
  }
  if (remoto) k.sincro.collega('clienti', cid, id);
  if (x.quando && k.campo('appuntamenti', 'quando')) {
    // lo stesso cliente alla stessa ora (il modulo mandato due volte): l'appuntamento c'è già
    const filtri = [{ campo: 'quando', op: '=', valore: x.quando }, ...(k.campo('appuntamenti', 'cliente') ? [{ campo: 'cliente', op: '=', valore: cid }] : [])];
    const gia = prova(() => k.dati.elenca('appuntamenti', { filtri, perPagina: 1 }).righe[0]);
    if (gia) { k.sincro.collega('appuntamenti', gia.id, id); return esito; }
    const a = ricevi(k, { remoto: id, quando: x.quando, cliente: { email: x.email, nome: x.nome, telefono: x.telefono }, note: nota, creaClienti: false });
    if (a === 'creato') esito += ', appuntamento creato';
  }
  return esito;
}
