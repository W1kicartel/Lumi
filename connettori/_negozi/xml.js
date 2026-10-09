// Un XML minimo per i servizi che vogliono XML in scrittura (il Webservice di PrestaShop): da oggetto a testo, con
// l'escape dei cinque caratteri, e una lettura semplice di un elemento (per le risposte di errore).
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
// { stock_available: { id: 3, quantity: 5 } } → <stock_available><id>3</id><quantity>5</quantity></stock_available>
export function xml(o) {
  if (o == null) return '';
  if (Array.isArray(o)) return o.map(xml).join('');
  if (typeof o !== 'object') return esc(o);
  return Object.entries(o).map(([n, v]) => Array.isArray(v) ? v.map(x => `<${n}>${xml(x)}</${n}>`).join('') : `<${n}>${xml(v)}</${n}>`).join('');
}
export const documento = (o, radice = 'prestashop') => `<?xml version="1.0" encoding="UTF-8"?><${radice} xmlns:xlink="http://www.w3.org/1999/xlink">${xml(o)}</${radice}>`;
// il testo del primo <nome>…</nome> (con CDATA)
export const elemento = (t, nome) => { const m = new RegExp(`<${nome}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${nome}>`).exec(String(t || '')); return m ? m[1].trim() : null; };
