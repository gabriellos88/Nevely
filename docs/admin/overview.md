# Panoramica dell'architettura

## Mappa dei servizi

```text
Utente → Cloudflare DNS/dominio → Railway produzione
                                  ├─ Node.js (Express + Socket.IO)
                                  ├─ PostgreSQL (dati e sessioni)
                                  └─ Cloudflare R2 privato (PITR produzione)

GitHub → CI → Railway staging
               ├─ app isolata
               ├─ PostgreSQL isolato, dati sintetici
               └─ Cloudflare R2 privato distinto (PITR staging)
```

## Ruolo dei servizi

| Servizio | Cosa gestisce | Non deve contenere |
| --- | --- | --- |
| Cloudflare DNS | dominio `nevely.app` | segreti applicativi |
| Railway app | HTTP, realtime, deploy, health | token fuori da variabili protette |
| Railway PostgreSQL | dati e sessioni | dati dell'altro ambiente |
| Cloudflare R2 | archivio fisico privato PITR | backup pubblici o policy incompatibili pgBackRest |
| GitHub | codice, PR, test | segreti o dati reali |
| Resend | verifica email e messaggi di sicurezza in uscita | token persistenti in chiaro fuori dall'outbox |
| Google Identity Services | autenticazione federata minima | access/refresh token Google |

## Ambienti

| Ambiente | Scopo | Dati | Visibilità |
| --- | --- | --- | --- |
| Locale | sviluppo | fittizi/locali | sviluppatore |
| Staging | prova del commit candidato | solo sintetici | noindex, no analytics |
| Produzione | utenti reali | reali | `https://nevely.app` |

Staging non è una copia di produzione: database, `SESSION_SECRET`, chiavi
email, client OAuth Google, chiave di cifratura TOTP, bucket R2 e credenziali
sono tutti separati.

## Salute e deploy

- `/health/live`: il processo Node risponde.
- `/health/ready`: il processo può accettare lavoro e PostgreSQL risponde;
  Railway lo usa per accettare un deploy.

Railway mantiene 30 secondi di sovrapposizione. La versione sostituita smette
di accettare nuovi match, completa o chiude ordinatamente le chat e termina
entro la finestra configurata. I dettagli sono nel
[runbook health e draining](../release/health-and-draining.md).
