# Ownership dei dati guest

N3.2 collega i dati di prodotto al principal guest autenticato dalla sessione.
La migration `007_guest_product_ownership.sql` aggiunge la chiave `guest_id` a:

- partecipanti alle conversazioni;
- chat salvate e ricevute di lettura;
- messaggi, come `sender_guest_id`;
- reporter e utente segnalato nei report.

Le colonne account e guest sono mutuamente esclusive. I dati storici anonimi
possono restare senza principal, ma ogni nuova operazione persistente usa
l'account oppure il guest legato alla sessione server. UUID ricevuti nel body o
nella query non partecipano mai alla decisione di autorizzazione.

## Chat recenti e salvate

Un guest autenticato dalla sessione può:

- leggere le proprie conversazioni recenti e i relativi messaggi;
- aggiornare le proprie ricevute di lettura;
- salvare o rimuovere una chat;
- vedere il proprio archivio salvato nell'interfaccia.

Il limite guest è 2 chat salvate. Il limite delle chat non salvate con messaggi
è quello N2, predefinito a 50 e configurabile con
`RETENTION_MAX_UNSAVED_PER_USER` tra 10 e 1.000. La risposta di
`GET /api/conversations` espone entrambi i limiti effettivi.

Il salvataggio è serializzato sul principal per impedire che richieste
concorrenti superino il limite. Ripetere il salvataggio della stessa chat è
idempotente. Una sessione diversa non può leggere o salvare una conversazione
conoscendone l'ID o inviando il `guest_id` del proprietario.

## Retention e moderazione

Le chat non salvate restano soggette alla scadenza di 7 giorni e al limite
numerico N2, ora calcolato sia per account sia per guest. Le chat salvate restano
soggette alla scadenza di 12 mesi dall'ultima attività.

Il worker non elimina un principal guest scaduto finché possiede una chat
salvata; quando la conversazione supera i 12 mesi, la riga di salvataggio viene
rimossa in cascata e il principal torna eliminabile. Messaggi, partecipanti e
report conservano l'attribuzione guest finché le rispettive policy li
richiedono; la cancellazione del principal rimuove o anonimizza i riferimenti
secondo la finalità della tabella.

I report creati in chat persistono entrambi i principal guest e continuano a
produrre lo snapshot immutabile di massimo 50 messaggi previsto da N2.
L'amministrazione vede l'alias compatto `gst_...`, non l'UUID guest.

## Verifica

La suite PostgreSQL usa-e-getta controlla:

- ownership guest di partecipanti, messaggi, ricevute e report;
- lettura della cronologia e aggiornamento del contatore non letto;
- limite di 2 chat salvate, idempotenza e sostituzione dopo `unsave`;
- isolamento tra sessioni anche quando una richiesta contiene un UUID altrui;
- applicazione del limite N2 alle conversazioni non salvate del guest.
