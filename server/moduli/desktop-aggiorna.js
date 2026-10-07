// Le versioni nuove: un controllo facoltativo (lo accende il titolare) dell'ultima versione pubblicata su GitHub
// (W1kicartel/kubo). Kubo avvisa e basta: non scarica e non installa mai niente da solo. Si manda solo la richiesta
// della pagina pubblica delle versioni, nessun dato dell'azienda. KUBO_AGGIORNAMENTI_URL cambia l'indirizzo (i test usano
// un finto server locale).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const URL_VERSIONI = 'https://api.github.com/repos/W1kicartel/kubo/releases/latest';
export const VERSIONE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8')).version;

// «v0.2.0», «0.10.1-beta.1» → confronto numerico; una pre-release viene prima della versione finale
export function confronta(a, b) {
  const p = v => { const [n, pre] = String(v).trim().replace(/^v/i, '').split('-', 2); return { n: n.split('.').map(x => parseInt(x, 10) || 0), pre: pre ?? null }; };
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) > (y.n[i] || 0) ? 1 : -1;
  if (x.pre === y.pre) return 0; if (x.pre == null) return 1; if (y.pre == null) return -1;
  return x.pre > y.pre ? 1 : -1;
}

// chiede l'ultima versione; { versione, nome, url, note, data } oppure lancia (rete assente, risposta strana)
export async function ultimaVersione({ url = process.env.KUBO_AGGIORNAMENTI_URL || URL_VERSIONI, attesa = 8000 } = {}) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Kubo/${VERSIONE}` }, signal: AbortSignal.timeout(attesa), redirect: 'follow' });
  if (!r.ok) throw new Error(`Il controllo delle versioni ha risposto ${r.status}`);
  const j = await r.json();
  if (!j || typeof j.tag_name !== 'string' || j.draft || j.prerelease) throw new Error('Risposta inattesa');
  // il collegamento si mostra al titolare: solo pagine https di GitHub (o del finto server dei test, in http locale)
  const pagina = String(j.html_url || ''), sicura = /^https:\/\/github\.com\//.test(pagina) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(pagina);
  return { versione: j.tag_name.replace(/^v/i, ''), nome: String(j.name || j.tag_name).slice(0, 120), url: sicura ? pagina : 'https://github.com/W1kicartel/kubo/releases',
    note: String(j.body || '').slice(0, 4000), data: j.published_at || null };
}

export async function controlla(attuale = VERSIONE, opz) {
  const u = await ultimaVersione(opz);
  return { attuale, ultima: u, nuova: confronta(u.versione, attuale) > 0 };
}
