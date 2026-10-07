// Esempio minimo di modulo: GET /api/versione-moduli. Si può togliere.
export default function registra({ r }) { r('GET', '/api/ping', () => ({ ok: true })); }
