# Brief: app «Gym» per Claude Code

Versione del 07/11/2026. Da copiare nella radice del repository come `BRIEF.md`. Sostituisce a ogni effetto la «Specifica app allenamento» (Google Doc, stessa cartella) se le due non coincidono: questo file è più recente e più dettagliato. L'utente è Giosuè; parla italiano; l'app e i commenti nel codice sono in italiano.

## 1. Obiettivo

Un'app personale per registrare gli allenamenti in palestra e a casa (palestra e riabilitazione di ginocchio destro e caviglia sinistra), al posto di Strong. L'app **registra soltanto**: non suggerisce carichi, progressioni, soglie, semafori. I dati arrivano da soli in un Google Sheet. Un assistente (Claude in chat) legge e modifica lo stesso foglio (esercizi e modelli), quindi il foglio è la fonte dei dati e non va mai rotto nel formato.

Nome: **Gym**. Telefono: **Android** (Chrome). Si installa dalla schermata Home (PWA), senza Play Store. Deve funzionare **offline in palestra** e sincronizzarsi appena c'è rete.

## 2. Vincoli non negoziabili

- **Sicurezza.** Nessuna chiave, token, indirizzo del ponte o dato personale nel repository, nei commit o nei log. Il token dello script sta solo nelle Proprietà script di Apps Script (`GYM_TOKEN`) e, sul telefono, nelle impostazioni dell'app (lo scrive Giosuè a mano, una volta). Se il repository è pubblico (GitHub Pages gratuito lo richiede), non deve contenere nulla di privato: nessun dato di allenamento, nessun ID del foglio se non necessario.
- **Niente app o file modificati o craccati**, niente API private di Hevy o di altre app.
- **Non toccare** il foglio «Registro allenamenti» né lo script Garmin: sono un altro sistema. L'adattamento del Registro lo fa Claude in chat (fase 3).
- **Semplicità di manutenzione:** JavaScript semplice (vanilla), senza build. File: `index.html` (con CSS e JS, oppure un solo `app.js`), `sw.js`, `manifest.webmanifest`, icone, `apps-script/Code.gs`. Librerie esterne solo se indispensabili (per i grafici basta SVG fatto a mano o una libreria piccola, messa in cache dal service worker).
- **Offline-first.** Ogni modifica si salva subito in IndexedDB e va in una coda; l'invio parte quando c'è rete e a ogni apertura dell'app.
- Nessun dato personale in URL o query string (il token viaggia nel corpo delle richieste).
- Non scrivere mai righe nel foglio che non siano nello schema qui sotto.

## 3. Architettura

```
Telefono (PWA, IndexedDB) <-- HTTPS POST (JSON) --> Apps Script (web app, "esegui come me")
                                                          |
                                                  Google Sheet «App allenamento – Dati»
```

- **Hosting:** statico (GitHub Pages o simile). Service worker per la cache dell'app.
- **Ponte:** Apps Script **legato al foglio** (container-bound), pubblicato come web app: esegui come me, accesso «chiunque con il link» (la protezione è il token). Sul telefono si salvano l'indirizzo del ponte e il token.
- **Fonte dei dati:** il Google Sheet. L'app ne tiene una copia locale.

### 3.1 API del ponte (una sola funzione `doPost`)

Richiesta: `POST` con corpo JSON come **testo semplice** (`Content-Type: text/plain`, per evitare la preflight CORS). Corpo: `{ "token": "...", "azione": "...", ... }`. Risposta JSON: `{ "ok": true, ... }` oppure `{ "ok": false, "errore": "..." }`. Token sbagliato o mancante: risposta `{ "ok": false, "errore": "non autorizzato" }` senza altri dettagli.

- `ping`: verifica token e connessione.
- `pull`: `{ "dal": "AAAA-MM-GG HH:mm:ss" | "" , "schede": [nomi] }`. Restituisce, per ogni scheda richiesta, le righe con `aggiornato_il` maggiore di `dal` (tutte se vuoto), con le intestazioni. Include le righe con `eliminato = sì`.
- `push`: `{ "righe": { "NomeScheda": [ {colonna: valore, ...}, ... ] } }`. Per ogni riga fa **upsert per `id`**: se l'id esiste, sostituisce solo se `aggiornato_il` della riga in arrivo è **maggiore o uguale** a quello presente (vince la modifica più recente); se non esiste, aggiunge. **Idempotente:** lo stesso invio ripetuto non crea doppioni. Usare `LockService` (lock di script) per evitare scritture concorrenti.
- Le schede che l'app può scrivere: `Esercizi`, `Modelli`, `ModelliEsercizi`, `ModelliSerie`, `Sessioni`, `SessioniEsercizi`, `Serie`, `Test`, `Impostazioni`, `DiarioValori`, `DiarioFarmaci`. Le schede `DiarioCampi` e `Farmaci` si leggono soltanto: un `push` verso di esse viene **ignorato** (contato in `ignorate`, senza errore, per non bloccare la coda). La scheda `Leggimi` non si tocca.
- Il ponte dichiara la sua versione (`versione_ponte` nella risposta di `pull`). Le schede del Diario si chiedono in un `pull` separato e solo se `versione_ponte >= 4`: un ponte più vecchio rifiuterebbe tutta la richiesta.
- La colonna `valore` (Test, DiarioValori) può contenere numeri o testo: il formato si decide cella per cella (numero → formato numerico; testo → `@`, così «1/2» non diventa una data).

### 3.2 Regole di lettura e scrittura nel foglio

- Le intestazioni di riga 1 sono il contratto: l'app e lo script leggono le colonne **per nome**, non per posizione. Non cambiare nomi né ordine; colonne extra aggiunte a destra vanno ignorate, non rotte.
- Scrivere `id`, date e orari come **testo** (formato `@`) e leggere con `getDisplayValues()` per le date, per evitare conversioni automatiche. I numeri (peso, ripetizioni, secondi, RPE) sono numeri. Il foglio è in locale italiano: il decimale del foglio è la virgola, ma lo script legge e scrive numeri veri (`getValues`/`setValues`), non testo.
- Orari: stringa `AAAA-MM-GG HH:mm:ss` nel fuso **Europe/Rome**, confrontabile come testo. Nel foglio ci sono righe di partenza con `AAAA-MM-GG HH:mm` (senza secondi): vanno considerate valide e più vecchie di qualsiasi riga con secondi dello stesso minuto.
- Mai cancellare righe: `eliminato` passa da `no` a `sì`. Le righe `eliminato = sì` restano nel foglio; l'app le nasconde.
- `id` generati sul telefono (UUID breve, per esempio 12 caratteri casuali con prefisso: `SE-...` per le sessioni). Le righe di partenza hanno id leggibili (`EX-001`, `MOD-01`, `ME-01-2`, `MS-01-2-1`): l'app deve accettare qualsiasi stringa come id.

## 4. Schema dei dati

Colonne comuni a tutte le schede tranne `Leggimi` e `Impostazioni`: `id`, `aggiornato_il`, `eliminato` (`no`/`sì`). Valori testuali in minuscolo come sotto.

### Esercizi
`id, nome, nome_strong, tipo, attrezzo, gruppo, area, recupero_s, nota, origine, archiviato, aggiornato_il, eliminato`
- `tipo`: `peso_rip` (peso e ripetizioni), `rip` (solo ripetizioni), `durata`, `peso_durata` (isometrie con carico), `cardio`.
- `area`: `ginocchio`, `caviglia`, `altro`. Decide quali campi di riabilitazione compaiono (§6).
- `nome_strong`: uno o più nomi dell'export di Strong separati da `; ` (servono all'importazione dello storico).
- `origine`: `strong`, `routine`, `proposto`, `app` (per quelli creati dall'app).
- `recupero_s`: recupero predefinito in secondi (0 = nessun timer).
- `archiviato`: `sì`/`no` (nascosto dalla ricerca ma conservato nello storico).

### Modelli
`id, nome, cartella, ordine, nota, aggiornato_il, eliminato, sedute_settimana`
- `sedute_settimana` (aggiunta l'08/11/2026, in fondo): quante volte a settimana è previsto il modello, intero 0-14 o vuoto. Serve per l'aderenza (§5.4).

### ModelliEsercizi
`id, modello_id, posizione, esercizio_id, superserie_id, recupero_s, nota, aggiornato_il, eliminato`
- `superserie_id`: lo stesso valore su **due** esercizi dello stesso modello li lega in superserie. Vuoto = singolo. Solo coppie.

### ModelliSerie
`id, modello_esercizio_id, posizione, tipo, lato, peso_kg, rip, durata_s, rpe_previsto, aggiornato_il, eliminato`
- `tipo` della serie: `riscaldamento`, `normale`, `cedimento`.
- `lato`: `dx`, `sx`, `entrambi`.
- Le serie «per lato» sono righe **alternate** dx e sx (non esiste un campo «per lato»).

### Sessioni
`id, titolo, modello_id, inizio, fine, nota, aggiornato_il, eliminato, pausa_s, pausa_dal`
- `pausa_s` (numero) e `pausa_dal` (`AAAA-MM-GG HH:mm:ss`, vuoto se non in pausa), aggiunte l'08/11/2026 in fondo: secondi di pausa già conclusi e inizio della pausa in corso. Durata vera = `fine − inizio − pausa_s`.

### SessioniEsercizi
`id, sessione_id, posizione, esercizio_id, superserie_id, nota, ginocchio_pienezza, ginocchio_pienezza_nota, ginocchio_dolore, ginocchio_dolore_nota, malleolo_dolore, malleolo_dolore_nota, achille_dolore, achille_dolore_nota, aggiornato_il, eliminato`
- Campi di dolore: numero 0-10 oppure vuoto; nota breve di testo.

### Serie
`id, sessione_esercizio_id, posizione, tipo, lato, peso_kg, rip, durata_s, rpe, fatta, aggiornato_il, eliminato`
- `rpe`: 0-10, anche mezzi punti, facoltativo. `fatta`: `sì`/`no`.
- Una serie ha o `rip` o `durata_s` (o tutti e due vuoti prima di essere fatta), secondo il tipo dell'esercizio. `peso_kg` può essere 0 (corpo libero) o vuoto.

### Test
`id, data, tipo, lato, valore, unita, dolore, nota, aggiornato_il, eliminato, origine`
- `tipo`: `wblt`, `heel_raise`, `equilibrio`, `leg_extension`, `step_down` (e altri futuri, come testo libero).

### Impostazioni
`chiave, valore, nota`. Righe: `versione_schema` (1), `unita_peso` (kg), `ultimo_salvataggio`.

### Diario (09/11/2026)
Quattro schede. Valgono le regole del §3.2: id e date come testo, `eliminato` = `no`/`sì`, `aggiornato_il` «AAAA-MM-GG HH:mm:ss» Europe/Rome, upsert per id, vince la modifica più recente. Le date dei giorni sono «AAAA-MM-GG».

**DiarioCampi** (definizione delle voci; l'app la **legge soltanto**)
`id, sezione, etichetta, tipo, ha_nota, ordine, attivo, scala_min, scala_max, opzioni, aiuto, aggiornato_il, eliminato`
- Si mostrano le righe con `attivo = sì` ed `eliminato = no`, ordinate per `ordine` e raggruppate per `sezione`: le righe consecutive con la stessa sezione stanno sotto lo stesso titolo. `etichetta` è il nome della voce; `aiuto` è un testo piccolo facoltativo.
- `tipo`:
  - `scala`: intero tra `scala_min` e `scala_max` (vuoti = 0 e 10);
  - `sino`: sì, no o vuoto;
  - `testo`: testo libero;
  - `elenco`: una scelta tra le `opzioni`, separate da «; »;
  - `farmaci`: in quella posizione, i farmaci del giorno;
  - un tipo sconosciuto si mostra con «Tipo non supportato: aggiorna l'app».
- `ha_nota = sì`: sotto la voce c'è una nota breve.
- Le voci **non sono scritte nel codice**: si aggiungono, rinominano, riordinano o nascondono cambiando il foglio.

**DiarioValori** (le risposte; una riga per giorno e per voce)
`id, giorno, campo_id, campo_etichetta, valore, nota, aggiornato_il, eliminato`
- `id = "DV-AAAA-MM-GG-" + id della voce`.
- `valore`: un numero per `scala`, «sì»/«no» per `sino`, testo per `testo` ed `elenco`.
- `campo_etichetta`: copia, al momento della scrittura, di «sezione – etichetta» (una volta sola se sono uguali), così lo storico resta leggibile anche se la voce cambia nome.
- Se una voce viene svuotata (valore e nota), la riga passa a `eliminato = sì`. Vuoto è diverso da 0. Le voci nascoste o rimosse non cancellano i valori già scritti.

**Farmaci** (catalogo; l'app lo **legge soltanto**, lo aggiorna Claude in chat)
`id, nome, tipo, dose_testo, previste_al_giorno, dal, al, nota, aggiornato_il, eliminato`
- Un farmaco è «in elenco» in un giorno se `dal <= giorno <= al`, confrontando i testi AAAA-MM-GG. `dal` o `al` vuoti significano «senza limite».
- Un cambio di dose è una riga nuova con altre date. `nome` e `dose_testo` si mostrano come sono scritti.

**DiarioFarmaci** (una riga per giorno e per farmaco)
`id, giorno, farmaco_id, farmaco_nome, previste, prese, nota, aggiornato_il, eliminato`
- `id = "DF-AAAA-MM-GG-" + id del farmaco`.
- `previste` = `previste_al_giorno` del farmaco quel giorno; `prese` va da 0 a `previste`.
- La riga nasce al primo tocco.

Il foglio contiene già: 71 esercizi, 9 modelli di riabilitazione (41 righe in ModelliEsercizi, 171 in ModelliSerie). I modelli della parte alta **non ci sono ancora** (l'utente deve decidere la scheda): l'app deve funzionare benissimo anche senza, creando modelli da dentro. Non ricaricare né sovrascrivere le righe esistenti.

## 5. Funzioni dell'app

### 5.1 Oggi
Avvia una sessione da un modello o vuota; se ce n'è una in corso, la riprende. Elenco dei modelli per cartella, un tocco per iniziare. All'avvio da modello si crea una **copia**: modificare il modello dopo non cambia le sessioni già iniziate.

### 5.2 Sessione in corso
- Per ogni esercizio: serie con tipo, lato, peso, ripetizioni o durata (secondo il tipo), RPE e **spunta di completamento**. Numeri grandi, bottoni raggiungibili con il pollice, tastiera numerica.
- **Valori dell'ultima volta** accanto a ogni serie (stesso esercizio, stesso lato, ultima sessione che li contiene).
- **Timer di recupero** che parte alla spunta, con il tempo predefinito dell'esercizio (o del modello), con vibrazione e suono alla fine; modificabile con un tocco; visibile anche se si cambia schermata nell'app. Nelle superserie il recupero parte dopo la coppia.
- **Serie a durata:** conto alla rovescia con avvio e vibrazione, oppure inserimento manuale dei secondi. `peso_durata`: peso in kg e secondi (per esempio 15 kg per 30″).
- **Superserie:** si collegano due esercizi qualsiasi, anche durante la sessione; le serie vanno in alternanza (A1, B1, A2, B2). Si scollegano con un tocco.
- **Note libere** per ogni esercizio e per la sessione.
- Aggiungere, togliere e riordinare esercizi; aggiungere o togliere serie; copiare la serie precedente; eliminare con annullamento.
- **Schermo sempre acceso** durante la sessione (Screen Wake Lock, con ripristino se la pagina torna in primo piano).
- **Fine sessione:** riepilogo (durata, serie fatte, volume) e salvataggio. Si possono modificare anche le sessioni passate.
- Una sessione interrotta (app chiusa, telefono scarico) deve potersi riprendere senza perdere nulla: salvare a ogni modifica.

### 5.3 Esercizi e modelli
Archivio con ricerca; creare, modificare, archiviare un esercizio (nome, tipo, attrezzo, gruppo, area, recupero, nota). Creare, modificare, duplicare modelli (esercizi, serie previste, superserie, recupero, note). L'utente aggiunge esercizi quando vuole, anche ad app finita. Gli esercizi e i modelli creati o modificati nel foglio (da Claude in chat) compaiono nell'app alla sincronizzazione successiva.

### 5.4 Storico e statistiche (fase 4)
Calendario e elenco sessioni con dettaglio. Per ogni esercizio: grafici nel tempo di carico massimo, ripetizioni, volume e durata delle isometrie (per lato dove serve). Statistiche: sedute a settimana, aderenza ai modelli (sedute fatte su previste), volume settimanale per gruppo, record per esercizio. Per gli esercizi di ginocchio e caviglia: andamento di pienezza e dolore (§6) accanto ai carichi.

### 5.5 Test (fase 4)
Registrazione dei test: WBLT (cm dx e sx), heel raise su una gamba (ripetizioni dx e sx), equilibrio a occhi chiusi (secondi dx e sx), leg extension a 12,5 kg (ripetizioni dx e sx), step-down. Valore, lato, dolore, nota; confronto con le date precedenti.

### 5.6 Impostazioni
Indirizzo e token del ponte, stato della sincronizzazione (righe in coda, ultimo invio, errori), esportazione completa dei dati in file (backup), importazione dello storico di Strong, unità.

### 5.7 Diario (09/11/2026; sostituisce il modulo Google «Diario riabilitazione»)
- **Quinta voce della barra in basso.** La schermata è costruita dalla scheda DiarioCampi del foglio (§4). L'app la scarica all'apertura e la tiene in copia per l'uso senza rete; se non l'ha mai scaricata, lo dice chiaramente.
- **Un giorno alla volta**, di default oggi. Con le frecce o il calendario si sceglie un giorno passato, mai un giorno futuro.
- **Una sola compilazione per giorno**, riprendibile più volte: si salva a ogni modifica, tutti i campi sono facoltativi e non c'è un «invia».
- **Comandi:**
  - `scala`: bottoni da 48 px su due righe (0–5, 6–10); per scale più ampie, un cursore con il numero grande;
  - `sino` ed `elenco`: bottoni di scelta;
  - toccare di nuovo la scelta la toglie (vuoto, mai 0).
- **Farmaci:** per ogni farmaco in elenco quel giorno, un contatore «prese / previste» con − e +, senza superare le previste, e una nota facoltativa.
- **In fondo, in sola lettura,** i valori «durante l'allenamento» del giorno (pienezza e dolore del ginocchio, malleolo, tendine d'Achille), presi da SessioniEsercizi delle sessioni di quel giorno, con esercizio e nota.
- **In Oggi,** la scheda «Diario di oggi» con «x voci su y compilate» e un tocco per aprire il Diario.
  - y = voci attive di tipo scala, sino ed elenco più i farmaci del giorno;
  - un farmaco conta come compilato se è stato preso almeno una volta;
  - non esiste un «completo» obbligatorio.
- **Nessun semaforo**, nessuna soglia, nessun consiglio: si mostrano i valori e basta.

## 6. Campi di riabilitazione «durante l'allenamento»

Dentro l'esercizio, in un riquadro **comprimibile**, da compilare anche a fine esercizio o a fine sessione. Ogni valore 0-10 con una nota breve. Non compare negli esercizi con area `altro`.

| Area dell'esercizio | Campi |
|---|---|
| ginocchio | pienezza (0-10) con nota; dolore (0-10) con nota |
| caviglia | malleolo (0-10) con nota; tendine d'Achille (0-10) con nota |

L'app **mostra i valori e basta**: nessun semaforo, nessuna soglia, nessun consiglio. Le voci del mattino e della sera sono nel **Diario** dell'app (§5.7), che dal 09/11/2026 sostituisce il modulo Google «Diario riabilitazione».

## 7. Estetica

- **Tema scuro**, ispirato a Hevy per l'impostazione (card con angoli arrotondati, barra in basso, numeri grandi), senza copiarne grafica, icone o testi.
- **Colore d'accento: blu**; una serie **fatta** passa dal blu al **verde** (spunta, bordo o sfondo della riga, con una breve transizione). Un solo carattere tipografico.
- **Barra in basso** con cinque voci: Oggi, Storico, Esercizi, Test, Diario (larghe 64 px ciascuna: entrano anche in 320 px). Impostazioni dall'icona in alto in Oggi.
- Pochi elementi per schermata, niente animazioni inutili, leggibile con una mano e con poca luce. Contrasto e dimensione del testo adeguati; bersagli di almeno 48 px.
- Prima di costruire tutto: **un mockup delle schermate principali** (Oggi, sessione in corso con una serie fatta e una da fare, esercizio con il riquadro di riabilitazione, Storico) da fare approvare a Giosuè. Usare la skill di design del frontend se disponibile.

## 8. Importazione dello storico di Strong (una tantum, fase 2)

L'utente carica un CSV esportato da Strong. Colonne attese: `Date, Workout Name, Exercise Name, Set Order, Weight, Weight Unit, Reps, RPE, Distance, Distance Unit, Seconds, Notes, Workout Notes, Workout Duration`.

- Raggruppare per `Date` (data e ora di inizio) e `Workout Name` → una sessione; per `Exercise Name` → un `SessioneEsercizio`; per riga → una `Serie`.
- Abbinare `Exercise Name` a `Esercizi.nome_strong` (che può contenere più nomi separati da `; `). Se non c'è corrispondenza, creare l'esercizio con `origine = app`, tipo `peso_rip`, area `altro` e segnalarlo nel riepilogo.
- `Workout Duration` è testo tipo `53m` o `1h 5m`: calcolare la `fine` da `inizio` + durata.
- `Notes` e `Workout Notes` → `nota` dell'esercizio e della sessione. Le note di Strong per le isometrie e il recupero hanno righe come «4 serie da 30 secondi con 15 kg dx» e «Recupero 1.30»: conservarle come testo nella nota, senza interpretarle (l'interpretazione è un lavoro a parte, con il Registro).
- **Idempotente:** una sessione già importata (stessa data e ora di inizio, stesso titolo) non si importa due volte.
- Mostrare un riepilogo prima di scrivere (quante sessioni, serie, esercizi nuovi) e chiedere conferma.

## 9. Fasi e criteri di collaudo

1. **Base:** ponte Apps Script, app con sessione, serie (tipi, lato, RPE), timer, note, campi di riabilitazione, sincronizzazione. *Collaudo:* una sessione registrata senza rete finisce nel foglio appena torna la rete, senza doppioni; un esercizio creato nel foglio compare nell'app all'apertura; una serie `peso_durata` (15 kg × 30″) arriva intera.
2. **Modelli e archivio:** esercizi e modelli da dentro l'app, superserie, valori dell'ultima volta, importazione dello storico di Strong.
3. **Passaggio:** lo fa Claude in chat (adatta lo script del Registro). L'obiettivo di Giosuè è cambiare da Strong all'app **lunedì 09/11/2026 solo se le fasi 1 e 2 sono collaudate**; altrimenti il primo giorno utile. Nel frattempo si continua con Strong.
4. **Storico, grafici, statistiche, Test.**
5. **Rifinitura:** estetica, esportazione, controlli, correzioni.

Per ogni fase: consegnare funzionante, con una breve nota su cosa è fatto e cosa no. Non anticipare le fasi successive senza dirlo.

## 10. Cose che può fare solo Giosuè (guidarlo passo per passo)

- Aprire il foglio «App allenamento – Dati» → Estensioni → Apps Script, incollare `Code.gs`, impostare la proprietà script `GYM_TOKEN` (una chiave lunga e casuale che sceglie lui, **mai in chat o in file**), pubblicare come app web (esegui come me, accesso: chiunque con il link) e copiare l'indirizzo.
- Pubblicare il repository (GitHub Pages) e aprire l'app da Chrome su Android, poi «Aggiungi a schermata Home».
- Scrivere nelle impostazioni dell'app l'indirizzo del ponte e il token.

## 11. Fuori ambito (per ora)

Parte social, coach, foto e misure corporee, nutrizione, sincronizzazione con orologi, suggerimenti automatici di carichi o progressioni, corsa e altre attività, calcolatore dei dischi, semafori e soglie di dolore. (Il «Diario riabilitazione» non è più fuori ambito: dal 09/11/2026 è nell'app, §5.7.)

## 12. Dubbi

Se qualcosa non torna con lo schema o con questo brief, **chiedere a Giosuè** prima di inventare. Non cambiare lo schema del foglio senza dirlo: Claude in chat lo legge e lo scrive.
