// I documenti di Lumi come file, per gli archivi cloud (Drive, Dropbox, OneDrive, S3, WebDAV):
// - documentoDi: la stampa HTML di una riga (fattura, preventivo, vendita) e, per le fatture emesse, l'XML FatturaPA;
// - backupDi: una copia coerente del database (VACUUM INTO, come desktop-backup.js) in una cartella temporanea, poi cancellata;
// - archivio: i pezzi comuni di un connettore di archivio (azioni, uscita, giro del backup alle 02:30, testi).
// Un connettore dà solo { carica(k, cartella, nome, contenuto, tipo), elenca(k, cartella) → [{ nome, … }], cancella(k, voce) }.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stampa } from '../../server/moduli/documenti.js';
import { copiaXmlDi } from '../openapi-sdi/connettore.js';

const meta = { leggi: (db, c) => db.prepare('SELECT valore FROM _meta WHERE chiave = ?').get(c)?.valore ?? null };
// un nome di file che va bene ovunque (Windows, Drive, S3): niente / \ : * ? " < > |
export const nomeFile = s => String(s ?? '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'documento';
const fermo = s => s === 'bozza' || s === 'annullata';

// → [{ nome, tipo, contenuto: Buffer }]: la stampa HTML e, per una fattura non in bozza, l'XML FatturaPA (se è valida)
// (xml: false per un'anteprima). L'XML è una copia: riusa il progressivo dell'invio allo SDI, non ne consuma uno nuovo
export function documentoDi(k, sezione, riga, { xml = true } = {}) {
  const s = stampa(k.db, { S: k.S, D: k.D, meta }, k.entita(sezione), riga.id, k.ctx), base = nomeFile(s.titolo);
  const out = [{ nome: `${base}.html`, tipo: 'text/html; charset=utf-8', contenuto: Buffer.from(s.html, 'utf8') }];
  if (xml && sezione === 'fatture' && k.valore(riga, 'fatture', 'stato') !== 'bozza') {
    // stesso nome della stampa: un nuovo salvataggio sovrascrive invece di lasciare doppioni
    try { const x = copiaXmlDi(k, riga); out.push({ nome: `${base}.xml`, tipo: 'application/xml', contenuto: Buffer.from(x.xml, 'utf8') }); } catch { /* fattura incompleta per lo SDI: solo la stampa */ }
  }
  return out;
}

// → { nome: 'lumi-2026-10-09-02-30-00.db', contenuto: Buffer }. La copia si prende anche mentre si lavora
export function backupDi(k, ora = new Date()) {
  const t = ora.toLocaleString('sv-SE', { timeZone: k.fuso?.() || 'Europe/Rome' }).replace(/[^\d]/g, '-').slice(0, 19);
  const dir = mkdtempSync(join(tmpdir(), 'lumi-backup-')), nome = `lumi-${t}.db`, f = join(dir, nome);
  try { k.db.exec(`VACUUM INTO '${f.replaceAll("'", "''")}'`); return { nome, contenuto: readFileSync(f) }; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

// la cartella di un documento: <radice>/<Sezione>/<anno>, es. Lumi/Fatture/2026
export function cartellaDi(k, sezione, riga) {
  const anno = /^(\d{4})/.exec(String(k.valore(riga, sezione, 'data') || ''))?.[1] || new Date().toLocaleDateString('sv-SE', { timeZone: k.fuso() }).slice(0, 4);
  return `${radice(k)}/${nomeFile(k.S.leggi(k.db, k.entita(sezione))?.nome || sezione)}/${anno}`;
}
const radice = k => String(k.imp.cartella || 'Lumi').split('/').map(nomeFile).filter(Boolean).join('/') || 'Lumi';
const mb = n => `${Math.round(n / 1048576)} MB`;

// i pezzi comuni di un connettore di archivio. servizio = { nome, carica, elenca, cancella, massimo (byte), pronto(k) }
export function archivio(servizio) {
  const { carica, elenca, cancella, massimo = Infinity, pronto = () => true } = servizio;
  const troppo = (n, cosa) => { if (n > massimo) throw new Error(`${cosa} pesa ${mb(n)}: ${servizio.nome} accetta al massimo ${mb(massimo)} in un colpo solo`); };
  async function salva(k, sezione, riga) {
    const cartella = cartellaDi(k, sezione, riga), file = documentoDi(k, sezione, riga);
    for (const f of file) { troppo(f.contenuto.length, f.nome); await carica(k, cartella, f.nome, f.contenuto, f.tipo); }
    return { cartella, file: file.map(f => f.nome) };
  }
  const anteprima = (cosa, sezione) => async (x, k) => {
    const r = x[cosa], cartella = cartellaDi(k, sezione, r), file = documentoDi(k, sezione, r, { xml: false }).map(f => f.nome);
    const bozza = sezione === 'fatture' && k.valore(r, 'fatture', 'stato') === 'bozza';
    if (sezione === 'fatture' && !bozza) file.push(file[0].replace(/\.html$/, '.xml'));
    return { titolo: `Salva su ${servizio.nome}`, righe: [['Documento', file[0]], ['Cartella', cartella], ['File', file.join(', ')]],
      avvisi: [...(pronto(k) ? [] : [`${servizio.nome} non è ancora collegato`]), ...(bozza ? ['La fattura è in bozza: si salva solo la stampa, senza XML FatturaPA'] : [])] };
  };
  return {
    impostazioni: [
      { id: 'cartella', nome: 'Cartella principale', predefinito: 'Lumi' },
      { id: 'automatico', nome: 'Salva da solo le fatture emesse', tipo: 'si_no', predefinito: false },
      { id: 'backup', nome: 'Backup del database ogni notte alle 02:30', tipo: 'si_no', predefinito: true },
      { id: 'tieni', nome: 'Backup da tenere', tipo: 'numero', predefinito: 14 },
    ],
    // tutto facoltativo: senza fatture (es. solo il negozio) resta il backup. «documenti» si abbina a preventivi, vendite…
    richiede: { fatture: { numero: { facoltativo: true }, data: { tipo: 'data', facoltativo: true }, stato: { tipo: 'stato', facoltativo: true } },
      documenti: { numero: { facoltativo: true }, data: { tipo: 'data', facoltativo: true } } },
    permessi: { fatture: { leggi: true }, documenti: { leggi: true }, clienti: { leggi: true } },
    azioni: {
      salva_documento: { nome: `Salva su ${servizio.nome}`, descrizione: `Salva la fattura (stampa e XML FatturaPA) su ${servizio.nome}, es. «salva la fattura 12 su ${servizio.breve || servizio.nome}»`,
        su: 'fatture', lumi: true, scrive: true, input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura' } },
        proponi: anteprima('fattura', 'fatture'), esegui: ({ fattura }, k) => salva(k, 'fatture', fattura) },
      salva_altro: { nome: `Salva su ${servizio.nome}`, descrizione: `Salva il documento (preventivo, vendita…) su ${servizio.nome}`,
        su: 'documenti', lumi: true, scrive: true, input: { documento: { tipo: 'relazione', entita: 'documenti', nome: 'Il documento' } },
        proponi: anteprima('documento', 'documenti'), esegui: ({ documento }, k) => salva(k, 'documenti', documento) },
    },
    // «salva da solo le fatture emesse»: quando una fattura nasce o cambia stato e non è bozza né annullata
    uscita: { fatture: { campi: ['stato'], quando: (r, k) => !!k.imp.automatico && pronto(k) && !!k.valore(r, 'fatture', 'stato') && !fermo(k.valore(r, 'fatture', 'stato')),
      invia: (r, k) => salva(k, 'fatture', r) } },
    pianificati: { backup: { nome: 'Backup notturno del database', alle: '02:30', async giro(k) {
      if (!k.imp.backup) return { saltato: 'backup spento' };
      if (!pronto(k)) return { saltato: `${servizio.nome} non collegato` };
      const b = backupDi(k), cartella = `${radice(k)}/Backup`; troppo(b.contenuto.length, 'Il database');
      await carica(k, cartella, b.nome, b.contenuto, 'application/vnd.sqlite3');
      // gli ultimi N: i nomi lumi-AAAA-MM-GG-hh-mm-ss.db si ordinano da soli
      const tieni = Math.max(1, Number(k.imp.tieni) || 14), vecchi = (await elenca(k, cartella)).filter(x => /^lumi-[\d-]+\.db$/.test(x.nome)).sort((a, b) => b.nome.localeCompare(a.nome)).slice(tieni);
      for (const v of vecchi) await cancella(k, v);
      return { caricato: b.nome, byte: b.contenuto.length, tolti: vecchi.length };
    } } },
    salva,
  };
}

// i testi comuni nelle 5 lingue, uniti a quelli del connettore («Drive», «Dropbox»… si sostituisce a {s})
export function testiArchivio(s, propri = {}) {
  const c = {
    en: { 'imp.cartella': 'Main folder', 'imp.automatico': 'Save issued invoices automatically', 'imp.backup': 'Back up the database every night at 02:30', 'imp.tieni': 'Backups to keep', 'az.salva_documento': `Save to ${s}`, 'az.salva_altro': `Save to ${s}`, 'giro.backup': 'Nightly database backup' },
    es: { 'imp.cartella': 'Carpeta principal', 'imp.automatico': 'Guardar solas las facturas emitidas', 'imp.backup': 'Copia de la base de datos cada noche a las 02:30', 'imp.tieni': 'Copias a conservar', 'az.salva_documento': `Guardar en ${s}`, 'az.salva_altro': `Guardar en ${s}`, 'giro.backup': 'Copia nocturna de la base de datos' },
    fr: { 'imp.cartella': 'Dossier principal', 'imp.automatico': 'Enregistrer automatiquement les factures émises', 'imp.backup': 'Sauvegarde de la base chaque nuit à 02:30', 'imp.tieni': 'Sauvegardes à garder', 'az.salva_documento': `Enregistrer sur ${s}`, 'az.salva_altro': `Enregistrer sur ${s}`, 'giro.backup': 'Sauvegarde nocturne de la base' },
    de: { 'imp.cartella': 'Hauptordner', 'imp.automatico': 'Ausgestellte Rechnungen automatisch speichern', 'imp.backup': 'Datenbank jede Nacht um 02:30 sichern', 'imp.tieni': 'Aufzubewahrende Sicherungen', 'az.salva_documento': `In ${s} speichern`, 'az.salva_altro': `In ${s} speichern`, 'giro.backup': 'Nächtliche Datenbanksicherung' },
    pt: { 'imp.cartella': 'Pasta principal', 'imp.automatico': 'Salvar sozinho as faturas emitidas', 'imp.backup': 'Backup do banco de dados toda noite às 02:30', 'imp.tieni': 'Backups a manter', 'az.salva_documento': `Salvar no ${s}`, 'az.salva_altro': `Salvar no ${s}`, 'giro.backup': 'Backup noturno do banco de dados' },
  };
  return Object.fromEntries(Object.keys(c).map(l => [l, { ...c[l], ...(propri[l] || {}) }]));
}
