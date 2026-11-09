# Gym

App personale per registrare gli allenamenti. Si installa sul telefono Android dalla schermata Home, funziona anche senza rete e salva i dati in un Google Sheet.

Questa guida spiega, passo per passo, le tre cose che puoi fare solo tu. Servono una volta sola.

---

## Passo 1 — Il ponte nel foglio Google (Apps Script)

Il «ponte» è un piccolo programma che vive dentro il foglio e riceve i dati dal telefono.

1. Dal computer apri il foglio **«App allenamento – Dati»**.
2. Menu **Estensioni → Apps Script**. Si apre una nuova scheda con un editor.
3. A sinistra c'è il file `Codice.gs` (o `Code.gs`). Cancella tutto quello che c'è dentro.
4. Apri il file `apps-script/Code.gs` di questa cartella, copia tutto il testo e incollalo nell'editor.
5. Premi l'icona del dischetto (**Salva progetto**).

### Il token (la tua chiave segreta)

Il token è una parola d'ordine che solo il telefono e il ponte conoscono. **Non scriverlo mai in chat, in un file o in un messaggio.**

Consiglio: sei o sette parole a caso, unite da trattini, per esempio sul modello `parola-parola-parola-parola-parola-parola` (non usare questo esempio, inventane una tua). È lunga, quindi sicura, ma facile da scrivere sul telefono.

1. Nell'editor di Apps Script, a sinistra, clicca l'ingranaggio **Impostazioni progetto**.
2. In fondo, **Proprietà script → Aggiungi proprietà script**.
3. Proprietà: `GYM_TOKEN`. Valore: il tuo token. **Salva proprietà script**.

### Pubblicazione

1. In alto a destra: **Esegui il deployment → Nuovo deployment**.
2. Accanto a «Seleziona tipo» clicca l'ingranaggio e scegli **App web**.
3. Descrizione: `Gym`. **Esegui come: Io**. **Chi ha accesso: Chiunque**.
   (Non è pericoloso: senza il token il ponte risponde solo «non autorizzato».)
4. **Esegui il deployment**. Google chiede di autorizzare l'accesso al foglio: scegli il tuo account e conferma. Se compare «Google non ha verificato questa app», clicca **Avanzate → Vai a … (non sicuro)**: l'app è tua, il messaggio compare sempre per gli script personali.
5. Copia l'**URL dell'app web** (finisce con `/exec`). Ti servirà al passo 3. Non è un segreto grave, ma non pubblicarlo.

> Se in futuro ti mando un `Code.gs` nuovo: incollalo, salva, poi **Esegui il deployment → Gestisci deployment → matita (Modifica) → Versione: Nuova versione → Esegui il deployment**. Così l'indirizzo resta lo stesso.

---

## Passo 2 — Mettere l'app online (GitHub Pages, gratis)

### Creare l'account GitHub

1. Vai su **github.com** e clicca **Sign up**.
2. Inserisci email, una password e un nome utente (per esempio il tuo nome senza spazi). Il nome utente comparirà nell'indirizzo dell'app.
3. Conferma l'email con il codice che ti arriva.

### Creare il repository e caricare i file

1. In alto a destra **+ → New repository**.
2. Repository name: `gym`. Lascia **Public** (GitHub Pages gratuito lo richiede). **Create repository**.
3. Nella pagina che si apre, clicca **uploading an existing file**.
4. Trascina dentro **solo questi** file e cartelle:
   - `index.html`
   - `app.js`
   - `sw.js`
   - `manifest.webmanifest`
   - la cartella `icons`
   - la cartella `apps-script`
   - `README.md`
5. In fondo clicca **Commit changes**.

**Non caricare** `BRIEF.md` né la cartella `mockup`: contengono informazioni personali sulla riabilitazione, e il repository è pubblico. Non caricare mai copie di backup (`gym-backup-….json`) o export di Strong (`.csv`).

### Accendere GitHub Pages

1. Nel repository: **Settings → Pages** (menu a sinistra).
2. Source: **Deploy from a branch**. Branch: **main**, cartella **/ (root)**. **Save**.
3. Dopo uno o due minuti, in alto nella stessa pagina compare l'indirizzo: `https://TUONOME.github.io/gym/`.

---

## Passo 3 — Installare l'app sul telefono

1. Sul telefono apri **Chrome** e vai all'indirizzo `https://TUONOME.github.io/gym/`.
2. Menu **⋮ → Aggiungi a schermata Home** (o **Installa app**). Ora «Gym» ha la sua icona.
3. Apri Gym dalla Home. In **Oggi** tocca l'ingranaggio in alto a destra (**Impostazioni**).
4. Incolla l'**indirizzo del ponte** (quello che finisce con `/exec`) e scrivi il **token**. **Salva**, poi **Prova**: deve comparire «Connessione riuscita».
5. Torna in **Oggi**: dopo pochi secondi compaiono i modelli del foglio.

Il token resta solo nel telefono. Se cancelli i dati di Chrome o reinstalli l'app, va riscritto.

---

## Come funziona la sincronizzazione

- Ogni tocco viene salvato subito nel telefono. Puoi chiudere l'app o restare senza batteria: alla riapertura la sessione è come l'hai lasciata.
- Le modifiche vanno in una **coda** e partono verso il foglio appena c'è rete: all'apertura dell'app, quando torna la connessione e ogni due minuti.
- In fondo a **Oggi** vedi lo stato: «Sincronizzato · 0 in coda» vuol dire che il foglio è aggiornato.
- Nel foglio non si cancella mai nulla: una riga eliminata resta con `eliminato = sì`.

## Importare lo storico di Strong (una volta sola)

1. In Strong, dalle impostazioni, esporta i dati: ottieni un file CSV.
2. In Gym: **Impostazioni → Storico di Strong → Scegli il file CSV**.
3. Leggi il riepilogo (sessioni, serie, esercizi nuovi) e premi **Importa**.
4. Lascia l'app aperta con la rete finché in fondo a **Oggi** non compare «0 in coda».

Se lo rifai con lo stesso file, le sessioni già importate vengono saltate. Il CSV non va caricato su GitHub.

## Aggiornare il ponte senza cambiare indirizzo

Quando ricevi un `apps-script/Code.gs` nuovo (per esempio la versione 4, per il Diario):

1. Apri il foglio «App allenamento – Dati» → **Estensioni → Apps Script**.
2. Nel file `Code.gs` (o `Codice.gs`): seleziona tutto (Ctrl+A), cancella, incolla il testo nuovo. Premi l'icona del dischetto **Salva progetto**.
3. In alto a destra: **Esegui il deployment → Gestisci deployment**. *Non* scegliere «Nuovo deployment»: creerebbe un indirizzo diverso.
4. Nella finestra c'è il deployment attivo («Gym»): clicca la **matita** (Modifica).
5. In **Versione** scegli **Nuova versione** (la descrizione è facoltativa, per esempio «Diario»). Non toccare «Esegui come» né «Chi ha accesso».
6. **Esegui il deployment**. Se Google chiede di autorizzare di nuovo, conferma con il tuo account. L'**URL dell'app web resta lo stesso**: sul telefono non devi cambiare niente.
7. Sul telefono apri Gym e premi **Impostazioni → Rileggi tutto**. In **Impostazioni → Versione** deve comparire «Ponte (Code.gs): versione 4».

## Aggiornamenti dell'app

Se tra i file nuovi c'è anche `apps-script/Code.gs`, va rimesso anche nel foglio: incollalo in Apps Script, salva, poi **Esegui il deployment → Gestisci deployment → matita → Versione: Nuova versione → Esegui il deployment**. In **Impostazioni → Versione** dell'app vedi quale versione del ponte stai usando (es. «Ponte (Code.gs): versione 2»).

Quando ricevi file nuovi, ricaricali su GitHub (stessa procedura, sovrascrivendo).

1. Su GitHub, nella scheda **Actions** del repository, aspetta la spunta verde (di solito 1-2 minuti): vuol dire che il sito è pubblicato.
2. Sul telefono apri Gym. L'app scarica da sola la versione nuova e in basso compare **«Nuova versione pronta · Aggiorna»**: tocca **Aggiorna**. I dati non si perdono.
3. Per controllare quale versione stai usando: **Impostazioni → Versione**. Lì c'è anche **Cerca aggiornamenti**.

Se la versione non cambia, chiudi Gym dalle app recenti e riaprila. **Non cancellare i dati di Chrome**: le modifiche non ancora inviate al foglio andrebbero perse.
