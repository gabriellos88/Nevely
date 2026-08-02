# Claim dell'account guest

Un guest con passaporto completo vede nel pannello Account il pulsante primario
**Claim guest account**. Il link di notifica persistente e la CTA secondaria
continuano invece a condurre a `/login`.

## Flusso utente

1. In `/login`, una sessione guest valida mostra sia il normale link di
   creazione account sia **Claim your current guest account**, con avatar e
   nome del guest.
2. Il secondo link apre `/register?claim=1`. Il server ricalcola l'idoneita'
   dal solo `guestPrincipalId` custodito nella sessione PostgreSQL.
3. La registrazione password crea un record `guest_account_claims` in stato
   `pending` e invia l'email di verifica. Nessun dato guest viene trasferito
   prima della verifica e l'account non può usare il prodotto.
4. `POST /verify-email` finalizza nella stessa transazione il claim: trasferisce
   partecipazioni, chat salvate, ricevute e notifiche al nuovo utente; conserva
   i riferimenti storici dell'autore guest nei messaggi e nei report; marca il
   principal guest come `claimed` e rende il claim non ripetibile.
5. Google mantiene la propria verifica dell'identita': per una nuova
   registrazione in claim mode, la stessa finalizzazione avviene nella
   transazione Google. Per un accesso Google a un account gia' esistente non
   avviene alcun claim o merge.

## Blocco fino alla verifica

Dopo una registrazione password, claim o normale, la sessione autenticata può
aprire soltanto `/verify-email/pending`, richiedere un reinvio entro i limiti e
fare logout. `/chat` e le altre pagine prodotto reindirizzano alla pagina di
attesa; le API restituiscono HTTP 403 con `EMAIL_VERIFICATION_REQUIRED` e gli
eventi Socket.IO di prodotto sono rifiutati. Il claim rimane `pending` e i dati
restano associati al guest fino al consumo valido del token monouso.

Google non introduce una seconda verifica Nevely: il server accetta soltanto
una credenziale Google con email già verificata dal provider. Se quella
credenziale crea un nuovo account in claim mode, la verifica provider e il
claim vengono conclusi nella stessa transazione.

## Separazione e ripristino

L'accesso a un account esistente non esegue merge, trasferimenti o conversioni
in chat recenti. Se quell'accesso era iniziato da un guest valido, la sessione
server conserva soltanto un riferimento di ritorno al principal guest; dopo
`POST /logout` viene rigenerata una sessione guest per lo stesso principal.
Il riferimento e' sempre rivalidato dal database e non deriva da UUID, nome o
avatar inviati dal browser.

Questa separazione è una decisione di prodotto definitiva per N3: non viene
mostrata alcuna conferma di merge e un login non può trasformarsi implicitamente
in un claim. Il claim resta un percorso di registrazione distinto.

La notifica guest `guest_account_claim` e' persistente nel database e ha
proprio stato di lettura. Alla finalizzazione viene trasferita all'account.

## Verifica manuale

1. Crea un passaporto guest completo, apri Account e verifica che il pulsante
   primario sia vicino alla scheda identita'.
2. Apri Notifications e la CTA secondaria: entrambe devono portare a `/login`.
3. Da `/login`, controlla le due scelte e avvia il link di claim; completa la
   registrazione, ma non la verifica email. Devi arrivare alla pagina di attesa;
   `/chat` deve tornarvi, le API prodotto devono rispondere 403 e i dati devono
   restare guest.
4. Apri il link di verifica email e controlla che chat salvate, ricevute e
   notifica siano presenti nel nuovo account. Un secondo uso del link non deve
   trasferire nulla.
5. In una nuova sessione guest, accedi a un account esistente e poi esci:
   devi tornare allo stesso guest, senza dati uniti all'account.
