# Identità e accessi

Questa guida copre le funzioni N1: profilo registrato, sessioni, email,
Google e protezione amministratori.

## Modello operativo

- L'ID pubblico è opaco: prefisso `nvy_` e 80 bit casuali. L'ID numerico
  PostgreSQL resta interno e non entra in HTML, JSON o eventi Socket.IO.
- Il vecchio `Nevely#xxxxxx` resta, quando presente, solo come alias visivo.
- La data di nascita è la sorgente dell'età corrente. Non salvare una nuova
  età numerica e non correggere la nascita dal normale pannello profilo.
- Genere e paese usano valori canonici. L'utente può cambiarli una volta ogni
  30 giorni; ogni variazione genera un evento di sicurezza.
- Le sessioni cookie restano in PostgreSQL. Login, Google e attivazione 2FA
  rigenerano la sessione.

## Variabili per ambiente

| Variabile | Regola |
| --- | --- |
| `DATABASE_URL` | obbligatoria in produzione |
| `SESSION_SECRET` | almeno 32 caratteri; distinta per ambiente |
| `ADMIN_TOTP_ENCRYPTION_KEY` | segreto separato per cifrare i seed TOTP |
| `PUBLIC_ORIGIN` | origine HTTPS esatta dell'ambiente |
| `RESEND_API_KEY` | chiave dell'ambiente, mai condivisa |
| `RESEND_FROM` | `Verify <noreply@notifications.nevely.app>` |
| `EMAIL_DELIVERY_MODE` | `test` in staging, `live` solo in produzione |
| `RESEND_TEST_RECIPIENT` | destinatario `@resend.dev` di staging |
| `GOOGLE_CLIENT_ID` | client web distinto per staging e produzione |

`EMAIL_DELIVERY_MODE=disabled` conserva il lavoro nell'outbox senza fingere un
invio. Il worker usa retry con backoff e una chiave idempotente stabile.

Per verificare senza esporre segreti la configurazione e l'invio isolato di
staging, usare nell'ordine `npm run check:env:staging` e
`npm run smoke:staging:email` come descritto nel
[Runbook staging](staging-release-runbook.md). Lo smoke test è consentito solo
con `EMAIL_DELIVERY_MODE=test` e il destinatario Resend di test.

## Verifica email e recupero account

I token sono casuali, monouso, legati a uno scopo e salvati solo come hash in
`account_tokens`. Il valore grezzo esiste temporaneamente soltanto nel link
dell'email accodata. Un nuovo invio revoca il precedente.

- verifica email: scadenza 24 ore;
- reset password: scadenza 1 ora;
- cambio email: scadenza 1 ora e notifica al vecchio indirizzo;
- reset password e cambio email revocano tutte le sessioni.

Le risposte di richiesta sono uguali per indirizzi esistenti e inesistenti.
Tre richieste per scopo e account in un'ora sono il limite applicativo, oltre
al rate limit HTTP.

Un account password non verificato non può usare il prodotto. Le pagine chat e
account lo rimandano a `/verify-email/pending`; le API di prodotto rispondono
HTTP 403 con `EMAIL_VERIFICATION_REQUIRED` e Socket.IO rifiuta matching, chat
dirette e richieste. Restano disponibili soltanto la pagina di attesa, il
reinvio limitato della verifica e il logout. Gli account Google nascono già
verificati perché il server accetta solo ID token con `email_verified=true`.

## Attivare Google in sicurezza

1. Nel progetto Google Cloud dell'account amministrativo privato creare due
   client OAuth Web, uno staging e uno produzione.
2. Inserire solo le origini esatte dei due ambienti; nessuna wildcard,
   localhost o origine staging nel client produzione.
3. Salvare ciascun client ID nel proprio ambiente Railway.
4. Verificare Privacy Policy, Terms e dominio pubblico prima dell'attivazione
   produzione.
5. Provare in staging: annullamento, nonce errato, replay, email duplicata,
   account bannato, nuovo account e account passwordless.

Nevely valida firma, issuer, audience, scadenza, nonce ed `email_verified`.
La chiave durevole è il `sub` Google in `account_identities`, non l'email.
Non vengono richiesti né conservati access token o refresh token. Un'email
già presente non viene collegata automaticamente: l'utente deve autenticarsi
prima con il metodo esistente.

L'accettazione OAuth di staging del 28 luglio 2026 è registrata in
[N1.5 Google staging acceptance](../release/n1-google-staging-acceptance.md).
N1.5 resta aperta finché non viene creato e configurato il client Web separato
di produzione.

## Abilitare un amministratore

Il primo amministratore viene promosso con il comando versionato
`npm run admin:bootstrap`, mai con una query SQL manuale. Il comando:

- funziona soltanto con `APP_ENV=staging` o `production`,
  `NODE_ENV=production` e nome/ID Railway coerenti;
- richiede il latch temporaneo `ADMIN_BOOTSTRAP_ENABLED=true`, l'email esatta
  dell'account e la conferma legata all'ambiente;
- accetta soltanto un account esistente, verificato, completo, non bannato e
  dotato di password o identità Google;
- usa un lock transazionale, fallisce se esiste già un amministratore, revoca
  le sessioni del promosso e registra `first_admin_bootstrapped` negli eventi
  di sicurezza;
- non stampa email, ID, credenziali o valori di configurazione.

Procedura per il primo amministratore:

1. Creare e verificare l'account che diventerà amministratore.
2. Nell'ambiente Railway corretto impostare temporaneamente e con **Seal**
   `ADMIN_BOOTSTRAP_ENABLED=true`, `ADMIN_BOOTSTRAP_EMAIL=<email esatta>` e
   `ADMIN_BOOTSTRAP_CONFIRM=bootstrap-first-admin:<staging|production>`.
3. In Railway Console eseguire `npm run admin:bootstrap`. Il comando deve
   terminare con `admin.first_bootstrap_completed`.
4. Eliminare subito tutte le variabili `ADMIN_BOOTSTRAP_*`. Un secondo avvio
   deve fallire perché esiste già un amministratore.
5. L'amministratore effettua nuovamente il login e apre `/admin/security`;
   reinserisce la password se ne possiede una e
   registra il seed nell'app authenticator.
6. Conferma un codice TOTP corrente.
7. Effettua nuovamente il login. Per sbloccare per 10 minuti ban,
   eliminazioni, ruoli, report e prezzi, la console richiede password + TOTP
   agli account con password oppure una credenziale Google fresca + TOTP agli
   account Google-only. Un campo password non viene mostrato né accettato come
   fattore per gli account passwordless.

Dopo il bootstrap iniziale, ogni promozione successiva deve passare
dall'endpoint amministrativo protetto e da una ri-autenticazione recente.

Una promozione, un ban, una modifica ruolo, un cambio password/email o
un'eliminazione incrementano la versione sessione e cancellano le sessioni
PostgreSQL dell'account. I controlli admin rileggono ruolo, ban, verifica email
e 2FA dal database: il ruolo nella sessione non è una fonte autorevole.

## Assistenza su dati protetti

La nascita può essere corretta solo tramite l'endpoint amministrativo protetto,
con ri-autenticazione recente e motivazione obbligatoria. Non inserire la data
di nascita nei ticket: identificare l'account con l'ID pubblico e raccogliere
il dato nel canale di supporto approvato. Il contatto pubblico è
`support@nevely.app`.

Gli account storici incompleti vengono inviati una sola volta a
`/complete-profile`. Finché il profilo non è riparato non possono entrare
nella chat registrata.
