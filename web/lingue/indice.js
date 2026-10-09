// Le aree dei cataloghi: un file per area in ogni lingua (web/lingue/<codice>/<area>.js), con le chiavi «area.chiave».
// comune: app, ui e testi condivisi · viste: lista, scheda, campi, filtri · gestione: Personalizza, persone e permessi,
// lingua e valuta · moduli: i moduli dell'interfaccia (agenda, cruscotto…) · avvio: avvio guidato, giro e dati d'esempio ·
// desktop: rete, backup e versioni nuove · sicurezza: password, dispositivi, impostazioni e poteri dei ruoli · fisco: IVA, F24, forfettario e scadenze · connettori: i servizi collegati · fatture: emissione, passive e controlli · tesoreria: scadenzario, banca, cassa e solleciti · acquisti: riordino, ordini ai fornitori, ricevimenti · magazzino: valore, inventario, movimenti. Un'area nuova si aggiunge qui e in tutte le lingue;
// test/lingue.test.mjs controlla che ogni lingua abbia le stesse chiavi dell'italiano, con gli stessi parametri.
export const AREE = ['comune', 'viste', 'gestione', 'moduli', 'avvio', 'desktop', 'sicurezza', 'fisco', 'connettori', 'fatture', 'tesoreria', 'acquisti', 'magazzino'];
