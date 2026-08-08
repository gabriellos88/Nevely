# Identità guest persistente

N3.1 conserva gli ospiti in `guest_principals`; non crea righe anonime in
`users`. Il principal contiene:

- UUID interno e alias compatto `gst_XXXXXXXXXX`;
- nome, genere, età, paese canonico e preset avatar;
- contatore dell'unico cambio nome consentito;
- stato, creazione, ultimo accesso e scadenza di retention.

Il browser può memorizzare l'UUID per compatibilità e recupero dell'interfaccia,
ma non può usarlo per autorizzare letture o modifiche. Il server accetta come
prova di possesso soltanto `guestPrincipalId` nella sessione PostgreSQL firmata.
Un UUID inviato nel corpo HTTP viene ignorato. Le sessioni guest precedenti a
N3.1 vengono migrate alla prima lettura del profilo.

## Ciclo di vita

Un principal attivo scade 30 giorni dopo l'ultimo accesso server-side. Ogni
lettura o modifica autenticata dalla sessione aggiorna `last_seen_at` e
`retention_until`. La cancellazione guest:

1. imposta `status = 'deleted'`;
2. registra `deleted_at`;
3. rende la riga immediatamente eleggibile per il worker N2;
4. rimuove UUID e snapshot del profilo dalla sessione.

Il worker elimina le righe scadute in batch limitati. Gli stati `claimed` ed
`expired` sono già riservati nello schema; claim, merge e comportamento
post-claim appartengono alle fasi N3.3-N3.5.

L'ownership di conversazioni, messaggi, ricevute, chat salvate e report è
descritta in [`guest-product-ownership.md`](guest-product-ownership.md).

## API e amministrazione

`GET`, `POST`, `PATCH` e `DELETE /api/guest-profile` operano solo sul principal
legato alla sessione corrente. La risposta include l'UUID per compatibilità API,
ma l'interfaccia visualizza `displayAlias`.

`GET /api/admin/guests` richiede un account amministratore e restituisce una
collezione con limite predefinito 30 e massimo 100. Il cursore opaco usa
`(created_at, UUID)`. L'UUID è esposto soltanto al workspace amministrativo,
abbreviato nella tabella e completo nella pagina Details; non è un token di
autorizzazione. I filtri `status` e `q` ricercano rispettivamente stato e
nome, alias o UUID esatto.

## Restrizioni guest N4

Un amministratore appena riautenticato può applicare una restrizione solo
temporanea al principal guest. La decisione richiede motivazione, durata tra
un'ora e 30 giorni e un record append-only in `audit_log`; non copia nome,
messaggi, IP o contenuti della conversazione nell'audit.

La restrizione è verificata su HTTP, all'ammissione Socket.IO e prima di ogni
evento Socket.IO sensibile. Le connessioni attive vengono chiuse anche sulle
repliche attraverso il canale PostgreSQL di controllo. Il partner riceve solo
la normale chiusura `partner-left`, senza stato o motivazione di moderazione.
La revoca richiede a sua volta una motivazione e produce un audit record.

`guest_bans` viene cancellata insieme al principal scaduto tramite chiave
esterna `ON DELETE CASCADE`; l'audit conserva soltanto l'UUID del target per
la tracciabilità della decisione.

## Verifica

La suite PostgreSQL usa-e-getta controlla che:

- l'UUID inviato dal browser non venga adottato;
- una seconda sessione non possa modificare un guest conoscendone l'UUID;
- POST ripetuti nella stessa sessione non creino principal duplicati;
- cambio nome, avatar, alias, cursore admin e limite pagina siano applicati;
- la cancellazione produca un tombstone e il worker lo elimini;
- un principal attivo non venga eliminato insieme al tombstone.
