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
   prima della verifica.
4. `POST /verify-email` finalizza nella stessa transazione il claim: trasferisce
   partecipazioni, chat salvate, ricevute e notifiche al nuovo utente; conserva
   i riferimenti storici dell'autore guest nei messaggi e nei report; marca il
   principal guest come `claimed` e rende il claim non ripetibile.
5. Google mantiene la propria verifica dell'identita': per una nuova
   registrazione in claim mode, la stessa finalizzazione avviene nella
   transazione Google. Per un accesso Google a un account gia' esistente non
   avviene alcun claim o merge.

## Separazione e ripristino

L'accesso a un account esistente non esegue merge, trasferimenti o conversioni
in chat recenti. Se quell'accesso era iniziato da un guest valido, la sessione
server conserva soltanto un riferimento di ritorno al principal guest; dopo
`POST /logout` viene rigenerata una sessione guest per lo stesso principal.
Il riferimento e' sempre rivalidato dal database e non deriva da UUID, nome o
avatar inviati dal browser.

La notifica guest `guest_account_claim` e' persistente nel database e ha
proprio stato di lettura. Alla finalizzazione viene trasferita all'account.

## Verifica manuale

1. Crea un passaporto guest completo, apri Account e verifica che il pulsante
   primario sia vicino alla scheda identita'.
2. Apri Notifications e la CTA secondaria: entrambe devono portare a `/login`.
3. Da `/login`, controlla le due scelte e avvia il link di claim; completa la
   registrazione, ma non la verifica email. I dati devono restare guest.
4. Apri il link di verifica email e controlla che chat salvate, ricevute e
   notifica siano presenti nel nuovo account. Un secondo uso del link non deve
   trasferire nulla.
5. In una nuova sessione guest, accedi a un account esistente e poi esci:
   devi tornare allo stesso guest, senza dati uniti all'account.
