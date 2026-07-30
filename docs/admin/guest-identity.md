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

## API e amministrazione

`GET`, `POST`, `PATCH` e `DELETE /api/guest-profile` operano solo sul principal
legato alla sessione corrente. La risposta include l'UUID per compatibilità API,
ma l'interfaccia visualizza `displayAlias`.

`GET /api/admin/guests` richiede un account amministratore e restituisce una
collezione con limite predefinito 30 e massimo 100. Il cursore opaco usa
`(created_at, UUID)`; la risposta amministrativa non espone l'UUID interno.
Il filtro opzionale `status` accetta `active`, `claimed`, `deleted` o `expired`.

## Verifica

La suite PostgreSQL usa-e-getta controlla che:

- l'UUID inviato dal browser non venga adottato;
- una seconda sessione non possa modificare un guest conoscendone l'UUID;
- POST ripetuti nella stessa sessione non creino principal duplicati;
- cambio nome, avatar, alias, cursore admin e limite pagina siano applicati;
- la cancellazione produca un tombstone e il worker lo elimini;
- un principal attivo non venga eliminato insieme al tombstone.
