# Runbook: rilasciare e verificare lo staging

Questa è la procedura da seguire per ogni funzionalità che modifica il
servizio Nevely. Lo staging è l'unico ambiente su cui si provano migrazioni,
email e integrazioni prima del merge in `main` e del rilascio in produzione.

> Non copiare segreti, URL `DATABASE_URL`, cookie, token o schermate delle
> variabili in GitHub, documenti o ticket. Il manuale indica i nomi e le
> regole dei valori, non i valori segreti.

## Risultato atteso

Un rilascio di staging è accettato soltanto quando tutti questi punti sono
veri:

- la pull request è aggiornata con `main` e la CI è verde;
- Railway usa il branch candidato corretto, non un branch storico;
- il deploy e la migrazione terminano senza errori;
- `/health/ready` risponde `{"status":"ready"}`;
- `npm run check:env:staging` passa nel container Railway;
- lo smoke test email è accettato dal destinatario isolato di Resend;
- i test manuali pertinenti alla funzionalità sono registrati nel PR.

Finché uno di questi punti manca, **non fare merge in `main`** e non modificare
la produzione.

## Checklist N4 finale

Prerequisiti: un account admin con 2FA, un account registrato verificato, due
sessioni guest in browser distinti e dati sintetici. Usare lo staging candidato
e non copiare cookie o identificativi interni nei ticket.

1. URL `/admin`: completare un login admin con 2FA e verificare che la testata
   mostri high-risk sbloccato per dieci minuti. Attendere la scadenza o fare
   logout e confermare il blocco; rinnovare soltanto dal flusso Unlock esistente.
2. URL `/admin`, scheda Users: provare Active, Banned, Deleted e All; cercare
   un `nvy_...`; verificare Age, Country, Last seen e Recent chats. Details di
   un account eliminato in retention deve mostrare `Deleted at`, `Scheduled
   data removal`, email/username solo in Details e lo stesso Public ID. Dopo un
   purge sintetico deve mostrare `Removed`/`Not retained`, `pii_purged_at` e un
   Public ID ruotato; il vecchio ID non deve più risolversi.
3. URL `/admin`, scheda Guests: provare ricerca e filtro Banned; verificare
   `gst_...`, Age, Country, Last seen, chat recenti, tipo e scadenza del ban.
   Dopo la cancellazione confermare che `scheduled deletion` sia circa 30 giorni
   dopo `deleted at`, non lo stesso timestamp.
4. Applicare un guest ban temporaneo: ripristino profilo, `/chat?guest=1` e
   Socket.IO devono portare alla pagina Astra `/guest-restricted`, che offre
   `/support` senza motivo o dettagli device/network. Revocare e riprovare.
5. Applicare un guest ban permanente e tentare un nuovo guest sullo stesso
   device: deve ricevere `GUEST_ACCESS_RESTRICTED`. Non deve comparire alcun ban
   IP/network implicito. Revocare e confermare il ripristino.
6. Bannare un account e autenticarsi con credenziali valide: ricevere
   `ACCOUNT_SUSPENDED` solo dopo la validazione. `/suspension` deve mostrare il
   link `/support` e logout, senza appeal o notifiche ban; chat e API restano negate.
7. In Bans aprire `Network bans`. Come Admin A richiedere la review usando il
   Public ID di un account con ban attivo e segnale visto nelle ultime 24 ore;
   verificare `/32` IPv4 o `/128` IPv6. Come Admin B approvare dalla coda e
   confermare che il ban nasca subito. Provare anche rifiuto, retry, self-review,
   segnale scaduto e CIDR manuale (reinserimento esatto, limite `/24` o `/64`).
   Un socket già connesso deve chiudersi; il partner vede solo la chiusura
   generica. Nessuna risposta o audit deve contenere IP/CIDR raw.
8. Verificare Reports e Audit in sola lettura e che nessuna evidenza/audit
   mostri contenuto integrale di messaggi, IP raw o device fingerprint.

Rollback N4.18: prima del rollout conservare il riferimento PITR. Se il deploy
fallisce prima del commit della migrazione, il runner esegue `ROLLBACK` e non
restano colonne o backfill parziali. Dopo il commit, preferire roll-forward:
disabilitare il retention worker e bloccare temporaneamente i due endpoint
`DELETE /api/account` e `DELETE /api/admin/users/:id` all'ingress prima di usare
un binario pre-018, perché quel binario non implementa la retention in due fasi.
Le colonne additive possono restare. Non cancellare tombstone, approval o audit.
Un down SQL post-commit è ammesso solo su clone/PITR dopo avere verificato che
non esistano righe lifecycle o approval create da 018. Ripetere migration,
readiness, login, delete, purge, chat/socket, admin e network review prima di
riaprire il traffico.

## Ruoli di branch

| Branch | Significato |
| --- | --- |
| `main` | base protetta e candidata alla produzione |
| `feature/<tema>` o `fix/<tema>` | lavoro nuovo e pull request futura |
| `codex/n1-identity-auth` | candidato N1 corrente; non riutilizzarlo per il prossimo lavoro |
| `codex/n0-release-safety` | riferimento storico N0; non usarlo come sorgente dello staging |

Ogni nuova funzionalità parte da un branch dedicato creato dal `main` più
recente. Il branch della release può essere collegato temporaneamente allo
staging, ma la produzione deve ricevere solo il commit già accettato nello
staging.

## Prima del deploy: GitHub

1. Aggiornare la copia locale di `main`, creare il branch e implementare una
   modifica coerente, inclusi migrazione, test e documentazione.
2. Eseguire i controlli locali. In PowerShell, se il wrapper `npm` è bloccato,
   usare `npm.cmd` al posto di `npm`.

   ```powershell
   npm.cmd run check
   npm.cmd run test:unit
   npm.cmd run test:integration
   ```

3. Fare push e aprire una pull request verso `main`.
4. Attendere il controllo GitHub obbligatorio. Se GitHub mostra **Update
   branch**, aggiornare il branch con `main` e attendere una nuova CI verde.
   Non fare merge e non distribuire un branch fuori data.
5. Annotare nel PR la migrazione prevista, il piano di rollback e i dati
   sintetici che verranno usati nello staging.

## Configurazione Railway staging

Aprire il progetto Railway, ambiente **staging**, servizio
**`nevely-staging`**. Controllare sempre il nome dell'ambiente prima di salvare:
produzione e staging hanno nomi, database e segreti distinti.

### Sorgente del servizio

In **Settings → Source**:

1. Il repository deve essere `gabriellos88/Nevely`.
2. Impostare **Branch connected to staging** sul branch candidato, per esempio
   `codex/n1-identity-auth` per N1.
3. Lasciare **Wait for CI** attivo: Railway distribuisce solo dopo il risultato
   verde di GitHub.
4. Se Railway segnala una regione non valida, scegliere la sostituzione
   proposta dall'interfaccia. Per l'attuale staging la regione valida è
   **US West (California)**; la vecchia `sfo` blocca i deploy.

Un cambio di branch o di regione resta in attesa finché non si applicano le
modifiche. Controllare la sezione **Apply changes** prima di confermare: deve
contenere solo le modifiche intenzionali.

### Variabili da controllare per N1

In **Variables**, le variabili sono per ambiente. Non copiare un gruppo di
segreti dalla produzione allo staging.

| Variabile | Regola staging |
| --- | --- |
| `APP_ENV` | `staging` |
| `NODE_ENV` | `production` |
| `PUBLIC_ORIGIN` | dominio HTTPS esatto dello staging, mai `nevely.app` |
| `DATABASE_URL` | database PostgreSQL dello staging |
| `SESSION_SECRET` | almeno 32 caratteri, distinto dagli altri segreti |
| `MODERATION_MESSAGE_HMAC_KEY` | opzionale; almeno 16 caratteri, solo staging e identico su tutte le repliche; altrimenti viene usato `SESSION_SECRET` |
| `ADMIN_TOTP_ENCRYPTION_KEY` | almeno 32 caratteri, distinto da `SESSION_SECRET` |
| `GOOGLE_CLIENT_ID` | client OAuth Web di **staging**, con sola origine staging esatta |
| `SUPPORT_EMAIL` | `support@nevely.app` |
| `RESEND_API_KEY` | chiave Resend protetta dell'ambiente |
| `RESEND_FROM` | `Verify <noreply@notifications.nevely.app>` |
| `EMAIL_DELIVERY_MODE` | `test` |
| `RESEND_TEST_RECIPIENT` | destinatario Resend isolato `@resend.dev` |
| `ANALYTICS_MODE` | `disabled` |
| `ROBOTS_INDEXING` | `disabled` |
| `PRODUCTION_RAILWAY_ENVIRONMENT_ID` | ID dell'ambiente produzione, diverso da quello staging |

Railway fornisce anche `RAILWAY_ENVIRONMENT_NAME` e
`RAILWAY_ENVIRONMENT_ID`: non sovrascriverli con valori copiati da un altro
ambiente. Per Google sono necessari client web distinti per staging e
produzione; non aggiungere origini wildcard, `localhost` o di staging al client
di produzione.

## Deploy e migrazione

1. Dopo aver ricontrollato sorgente, regione e variabili, premere **Deploy** in
   Railway. Questo applica tutte le modifiche in attesa e crea un nuovo
   deployment solo nello staging.
2. In **Deployments**, attendere prima **Waiting for CI** se compare: con
   *Wait for CI* attivo è normale. Non disattivare il controllo per forzare il
   deploy.
3. Aprire i log del deployment e cercare il pre-deploy:

   ```text
   > npm run db:migrate
   applied 004_identity_and_authentication.sql
   ```

   Le migrazioni già applicate appaiono come `skip`. Per una nuova release deve
   apparire `applied` per la nuova migrazione, senza errori SQL. Una migrazione
   additiva è preferibile: non eliminare colonne o dati nello stesso rilascio.
4. Attendere **Deployment successful**. Un deployment attivo e riuscito è
   quello servito dallo staging.

## Verifiche dopo il deploy

### 1. Readiness pubblica

Aprire:

```text
https://nevely-staging-staging.up.railway.app/health/ready
```

Risultato atteso:

```json
{"status":"ready"}
```

Da PowerShell, se serve una verifica esterna:

```powershell
curl.exe --fail --silent --show-error --max-time 20 https://nevely-staging-staging.up.railway.app/health/ready
```

### 2. Verifica configurazione, senza mostrare segreti

In **Railway → nevely-staging → Console**, eseguire:

```sh
npm run check:env:staging
```

Risultato atteso:

```text
Environment validation passed for profile "staging". No configuration values were printed.
```

Questo comando controlla presenza, forma e separazione dei valori ma non
stampa segreti. Se fallisce, correggere soltanto la variabile indicata,
ridistribuire e rieseguire il controllo.

### 3. Smoke test email isolato

Solo dopo aver verificato che `EMAIL_DELIVERY_MODE=test` e
`RESEND_TEST_RECIPIENT` sia il destinatario Resend isolato, eseguire nella
stessa console:

```sh
npm run smoke:staging:email
```

Risultato atteso:

```text
Resend staging smoke request accepted. No configuration or provider identifiers were printed.
```

Il test invia volutamente un messaggio al destinatario di test, non a utenti
reali. Non eseguirlo con delivery `live`.

### 4. Accettazione funzionale N1

Usare solo account e dati sintetici nello staging. Registrare nel PR cosa è
stato verificato.

- registrazione e completamento del profilo, inclusa la regola 18+;
- login, logout e persistenza/rotazione della sessione;
- richiesta e consumo di verifica email; richiesta di reset password;
- ID pubblico con prefisso `nvy_`, senza esporre l'ID numerico PostgreSQL;
- Google: annullamento, nuovo account, nonce/replay non validi, email già
  esistente e account bloccato; il pulsante funziona solo dopo la configurazione
  del client Google di staging;
- per un account amministratore sintetico: configurazione TOTP, nuovo login e
  apertura di `/admin`.

Se lo staging non contiene ancora amministratori, usare esclusivamente il
bootstrap versionato descritto in
[`identity-and-access.md`](identity-and-access.md#abilitare-un-amministratore).
Impostare con **Seal** le tre variabili `ADMIN_BOOTSTRAP_*`, eseguire
`npm run admin:bootstrap`, eliminarle immediatamente e registrare nel PR
l'esito senza email, ID o valori di configurazione. Non sostituire il comando
con un `UPDATE users SET role = 'admin'` manuale.

Non promuovere N1 in produzione finché non esistono un client Google Web
separato per produzione, l'origine `https://nevely.app` è quella esatta e le
verifiche Google in staging sono registrate.

## Problemi comuni e correzione sicura

| Sintomo | Cosa fare |
| --- | --- |
| PR con **Update branch** | aggiornare il branch con `main`, attendere una nuova CI verde, poi continuare |
| Railway **Waiting for CI** | aspettare la CI; non disabilitare *Wait for CI* |
| `Invalid region sfo` | scegliere la regione sostitutiva proposta, attualmente US West, e applicare le modifiche in attesa |
| `Staging must use the verified Nevely verification sender` | impostare esattamente `RESEND_FROM=Verify <noreply@notifications.nevely.app>`, ridistribuire, rieseguire il check |
| readiness non pronta | non promuovere; leggere log build/pre-deploy/app, correggere il branch e distribuire di nuovo |
| migrazione fallita | non tentare SQL manuale in produzione; salvare il log, correggere/rendere idempotente la migrazione e riprovare nello staging |
| smoke email rifiutato | controllare `EMAIL_DELIVERY_MODE=test`, `RESEND_TEST_RECIPIENT`, `RESEND_FROM` e chiave Resend senza esporre i valori |

## Rollback nello staging

Un rollback dell'app non equivale a cancellare la migrazione.

1. Fermare la promozione: non fare merge in `main`.
2. Identificare l'ultimo deployment staging sano in **Deployments** e leggere
   commit, log e motivo del rollback nel PR.
3. Per una migrazione additiva e compatibile, ridistribuire il precedente
   commit sano tramite Railway. Non eliminare manualmente colonne, record o
   migrazioni applicate.
4. Se una migrazione è distruttiva o il rollback dell'app non è compatibile con
   lo schema, fermarsi: serve un piano di recovery basato su backup/restore
   isolato, non una modifica improvvisata al database.
5. Ripetere readiness e `check:env:staging` sul deployment ripristinato.

## Chiusura della release

Prima del merge compilare nel PR una breve prova, per esempio:

```text
Staging: commit <sha>
CI: verde e branch aggiornato con main
Migration: 004_identity_and_authentication.sql applied
Readiness: /health/ready = ready
Environment: npm run check:env:staging passed
Email: npm run smoke:staging:email accepted (test recipient only)
Functional checks: <elenco sintetico>
Rollback: <ultimo deployment sano e compatibilità migrazione>
```

Solo allora si procede con il gate di produzione descritto in
[Rilasci e ambienti](releases-and-environments.md). Dopo ogni incidente,
cambio di variabile o cambiamento di provider, aggiornare questo runbook nello
stesso PR: è la fonte operativa per il prossimo rilascio.
