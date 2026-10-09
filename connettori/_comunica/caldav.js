// CalDAV minimo (RFC 4791) e iCalendar essenziale (RFC 5545): quanto basta per tenere allineata l'agenda di Kubo con
// iCloud, Nextcloud, Fastmail, Synology… Niente librerie: l'XML delle risposte si legge con poche espressioni regolari
// tolleranti ai prefissi (d:, D:, cal:, nessuno), l'ICS con lo «spiegamento» delle righe e i fusi di Intl.
//   const c = caldav(k.http, { server, utente, password });
//   await c.calendari() → [{ url, nome }]          (current-user-principal → calendar-home-set → Depth 1)
//   await c.eventi(cal, da, a) → [{ url, etag, uid, inizio, fine, titolo, descrizione, partecipanti, tutto, ics }]
//   await c.metti(url, ics, etag) → { stato, etag }   (If-Match se c'è l'etag, altrimenti If-None-Match: *)
//   await c.leggi(url) · await c.togli(url, etag)
const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"';
const ent = s => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tutti = (xml, nome) => [...String(xml || '').matchAll(new RegExp(`<(?:[\\w-]+:)?${nome}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${nome}>)`, 'g'))].map(m => m[1] ?? '');
const tag = (xml, nome) => tutti(xml, nome)[0] ?? null;
export const xmlTag = tag;

// ---------- iCalendar ----------
export const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const desc = s => String(s ?? '').replace(/\\[nN]/g, '\n').replace(/\\([\\;,])/g, '$1');
export const utc = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// la piegatura delle righe a 75 ottetti (RFC 5545 §3.1), senza spezzare un carattere UTF-8
export const piega = l => { const out = []; let s = l; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = ' ' + s.slice(n); } out.push(s); return out.join('\r\n'); };
// le righe spiegate: CRLF seguito da uno spazio o da un tab continua la riga prima
export const spiega = t => String(t || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);

// lo scarto di un fuso in un istante (ms), con Intl; un fuso sconosciuto (i nomi di Windows di Outlook) → null
function scarto(ms, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
  } catch { return null; }
}
// «20261010T100000» nel fuso tz → ISO UTC (due passate per i cambi d'ora)
export function daLocale(v, tz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/.exec(v); if (!m) return null;
  const g = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const s1 = scarto(g, tz); if (s1 == null) return null;
  const s2 = scarto(g - s1, tz);
  return new Date(g - (s2 ?? s1)).toISOString();
}
// DTSTART/DTEND: «…Z» è UTC, «TZID=…» è nel fuso, senza niente è l'ora «fluttuante» (nel fuso di Kubo), VALUE=DATE è tutto il giorno
export function dataIcs(v, param = {}, fuso = 'Europe/Rome') {
  if (!v) return { iso: null, tutto: false };
  const tutto = param.VALUE === 'DATE' || /^\d{8}$/.test(v);
  if (/Z$/.test(v)) { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z$/.exec(v); return { iso: m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))).toISOString() : null, tutto: false }; }
  return { iso: daLocale(v, param.TZID || fuso) || daLocale(v, fuso), tutto };
}
const riga = l => {
  // NOME;PARAM=V;PARAM="V:x":valore (i due punti dentro le virgolette non contano)
  let i = 0, q = false; for (; i < l.length; i++) { if (l[i] === '"') q = !q; else if (l[i] === ':' && !q) break; }
  const [nome, ...ps] = l.slice(0, i).split(';'), param = {};
  for (const p of ps) { const j = p.indexOf('='); if (j > 0) param[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ''); }
  return { nome: nome.toUpperCase(), param, valore: l.slice(i + 1) };
};
// i VEVENT di un VCALENDAR (le ricorrenze non si espandono: conta il primo)
export function leggiIcs(testo, fuso = 'Europe/Rome') {
  const out = []; let ev = null, dentro = 0;
  for (const l of spiega(testo)) {
    const r = riga(l);
    if (r.nome === 'BEGIN' && r.valore === 'VEVENT') { ev = { partecipanti: [] }; dentro = 0; continue; }
    if (!ev) continue;
    if (r.nome === 'BEGIN') { dentro++; continue; }   // un VALARM dentro l'evento
    if (r.nome === 'END' && dentro) { dentro--; continue; }
    if (r.nome === 'END' && r.valore === 'VEVENT') { out.push(ev); ev = null; continue; }
    if (dentro) continue;
    if (r.nome === 'UID') ev.uid = r.valore;
    else if (r.nome === 'SUMMARY') ev.titolo = desc(r.valore);
    else if (r.nome === 'DESCRIPTION') ev.descrizione = desc(r.valore);
    else if (r.nome === 'STATUS') ev.stato = r.valore.toUpperCase();
    else if (r.nome === 'RECURRENCE-ID') ev.ricorrenza = r.valore;
    else if (r.nome === 'RRULE' || r.nome === 'RDATE') ev.ripetuto = true;
    else if (r.nome === 'DTSTART') { const d = dataIcs(r.valore, r.param, fuso); ev.inizio = d.iso; ev.tutto = d.tutto; }
    else if (r.nome === 'DTEND') ev.fine = dataIcs(r.valore, r.param, fuso).iso;
    else if (r.nome === 'ATTENDEE') { const email = r.valore.replace(/^mailto:/i, '').trim(); if (email.includes('@')) ev.partecipanti.push({ email: email.toLowerCase(), nome: r.param.CN || null }); }
  }
  return out;
}
// un VCALENDAR con un VEVENT, piegato e con CRLF
export function vevento({ uid, inizio, fine, titolo, descrizione, stamp = Date.now() }) {
  const r = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kubo//Agenda//IT', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utc(stamp)}`,
    `DTSTART:${utc(inizio)}`, `DTEND:${utc(fine)}`, `SUMMARY:${esc(titolo)}`, ...(descrizione ? [`DESCRIPTION:${esc(descrizione)}`] : []), 'END:VEVENT', 'END:VCALENDAR'];
  return r.map(piega).join('\r\n') + '\r\n';
}

// sposta un evento che non è di Kubo cambiando solo DTSTART e DTEND del primo VEVENT: il resto (invitati, promemoria…) resta
export function sposta(ics, inizio, fine) {
  const out = []; let stato = 0, fineScritta = false;   // 0 prima, 1 dentro il primo VEVENT, 2 dopo
  for (const l of spiega(ics)) {
    const n = l.split(/[;:]/)[0].toUpperCase();
    if (stato === 0 && l.toUpperCase() === 'BEGIN:VEVENT') stato = 1;
    else if (stato === 1 && n === 'DTSTART') { out.push(`DTSTART:${utc(inizio)}`); continue; }
    else if (stato === 1 && (n === 'DTEND' || n === 'DURATION')) { if (!fineScritta) out.push(`DTEND:${utc(fine)}`); fineScritta = true; continue; }
    else if (stato === 1 && l.toUpperCase() === 'END:VEVENT') { if (!fineScritta) out.push(`DTEND:${utc(fine)}`); stato = 2; }
    out.push(l);
  }
  return out.map(piega).join('\r\n') + '\r\n';
}

// ---------- il client ----------
export function caldav(http, { server, utente, password }) {
  const auth = utente || password ? { basic: [utente || '', password || ''] } : {};
  const dav = (metodo, url, { corpo, prof, piu = {} } = {}) => http.richiesta(metodo, url, { ...auth, ...(corpo ? { testo: corpo } : {}),
    intestazioni: { Accept: 'application/xml, text/xml, text/calendar, */*', ...(corpo ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}), ...(prof != null ? { Depth: String(prof) } : {}), ...piu } });
  const male = (r, cosa) => { if (r.stato === 401 || r.stato === 403) throw new Error(`CalDAV: accesso negato (${cosa}): controlla utente e password per app`); if (!r.ok && r.stato !== 207) throw new Error(`CalDAV ha risposto ${r.stato} (${cosa})`); };
  const risposte = t => tutti(t, 'response').map(x => ({ href: ent(tag(x, 'href') || '').trim(), x }));
  const assoluto = (h, base) => new URL(h, base).href;
  async function href(url, prop) {
    const r = await dav('PROPFIND', url, { prof: 0, corpo: `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop><${prop}/></d:prop></d:propfind>` });
    male(r, prop); const h = tag(tag(r.testo, prop.replace(/^\w+:/, '')), 'href');
    return h ? assoluto(ent(h).trim(), url) : null;
  }
  return {
    async calendari() {
      const principale = await href(server, 'd:current-user-principal') || server;
      const casa = await href(principale, 'c:calendar-home-set') || principale;
      const r = await dav('PROPFIND', casa, { prof: 1, corpo: `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>` });
      male(r, 'calendari');
      // i calendari veri (resourcetype «calendar») che accettano eventi: le liste di promemoria (solo VTODO) no
      return risposte(r.testo).filter(({ x }) => { const comp = tag(x, 'supported-calendar-component-set'); return /<(?:[\w-]+:)?calendar\b/.test(tag(x, 'resourcetype') || '') && (!comp || /VEVENT/.test(comp)); })
        .map(({ href: h, x }) => ({ url: assoluto(h, casa), nome: ent(tag(x, 'displayname') || '').trim() || h }));
    },
    async eventi(cal, da, a, fuso) {
      const corpo = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">`
        + `<c:time-range start="${utc(da)}" end="${utc(a)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
      const r = await dav('REPORT', cal, { prof: 1, corpo }); male(r, 'eventi');
      const out = [];
      for (const { href: h, x } of risposte(r.testo)) {
        const ics = ent(tag(x, 'calendar-data') || ''); if (!ics.trim()) continue;
        const ev = leggiIcs(ics, fuso).find(e => !e.ricorrenza) || leggiIcs(ics, fuso)[0]; if (!ev?.uid) continue;
        out.push({ ...ev, url: assoluto(h, cal), etag: ent(tag(x, 'getetag') || '').trim() || null, ics });
      }
      return out;
    },
    async leggi(url) { const r = await http.richiesta('GET', url, { ...auth, intestazioni: { Accept: 'text/calendar' } }); return { stato: r.stato, etag: r.intestazioni.etag || null, ics: r.ok ? r.testo : null }; },
    async metti(url, ics, etag) {
      const r = await http.richiesta('PUT', url, { ...auth, testo: ics, intestazioni: { 'Content-Type': 'text/calendar; charset=utf-8', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) } });
      if (r.stato !== 412) male(r, 'salvataggio');
      return { stato: r.stato, etag: r.intestazioni.etag || null };
    },
    async togli(url, etag) {
      const r = await http.richiesta('DELETE', url, { ...auth, intestazioni: etag ? { 'If-Match': etag } : {} });
      if (r.stato !== 404 && r.stato !== 412) male(r, 'cancellazione');
      return { stato: r.stato };
    },
  };
}
