// Le aree dei cataloghi: un file per area in ogni lingua (web/lingue/<codice>/<area>.js), con le chiavi «area.chiave».
// comune: app, ui e testi condivisi · viste: lista, scheda, campi, filtri · gestione: Personalizza, persone e permessi,
// lingua e valuta · moduli: i moduli dell'interfaccia (agenda, cruscotto…) · avvio: avvio guidato, giro e dati d'esempio ·
// desktop: rete, backup e versioni nuove · sicurezza: password, dispositivi, impostazioni e poteri dei ruoli. Un'area nuova si aggiunge qui e in tutte le lingue;
// test/lingue.test.mjs controlla che ogni lingua abbia le stesse chiavi dell'italiano, con gli stessi parametri.
export const AREE = ['comune', 'viste', 'gestione', 'moduli', 'avvio', 'desktop', 'sicurezza'];
