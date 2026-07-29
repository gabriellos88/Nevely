# Manuale amministratore Nevely

Questa guida spiega cosa è operativo, perché è configurato così e come
modificarlo senza mettere a rischio dati o utenti. Non contiene password,
token, URL di connessione o dati reali: questi restano nei provider.

## Da dove iniziare

| Se devi… | Leggi |
| --- | --- |
| capire architettura e servizi | [Panoramica](overview.md) |
| gestire accessi, email, Google o 2FA | [Identità e accessi](identity-and-access.md) |
| rilasciare una funzionalità | [Rilasci e ambienti](releases-and-environments.md) |
| distribuire, verificare o ripristinare lo staging | [Runbook staging](staging-release-runbook.md) |
| controllare/ripristinare/cambiare i backup | [Backup e recovery](backup-and-recovery.md) |
| sostituire un provider | [Modifiche infrastrutturali](infrastructure-changes.md) |

## Regole permanenti

1. Produzione e staging hanno database, segreti e backup distinti.
2. Ogni modifica parte da un branch dedicato, passa dalla CI e viene verificata
   in staging prima della produzione.
3. Una migrazione database deve essere additiva e compatibile con la versione
   precedente; le rimozioni arrivano solo in un rilascio successivo.
4. Un backup vale solo dopo un ripristino isolato e verificato.
5. I segreti non entrano in Git, documenti, screenshot, ticket o log.

## Cosa è operativo oggi

- Node.js/Express + Socket.IO e PostgreSQL su Railway.
- Sessioni memorizzate in PostgreSQL.
- Staging Railway isolato, con database e segreti propri.
- CI GitHub obbligatoria su pull request e `main`.
- Health check, sovrapposizione del deploy e spegnimento graduale.
- PITR PostgreSQL con pgBackRest verso bucket privati Cloudflare R2.

Le funzioni ancora pianificate non sono da trattare come operative: vedi il
[TODO](../../TODO.md), in particolare maintenance mode (N6) e audit log
generale (N4.6). Gli eventi di sicurezza strettamente necessari a N1 sono
registrati, ma non sostituiscono l'audit log amministrativo completo di N4.6.

## Cadenza minima

- Ogni release: seguire la checklist di rilascio.
- Mensilmente: restore drill su staging.
- Prima di una migrazione ad alto rischio: restore drill e piano rollback.
- Dopo un cambio di provider: aggiornare questo manuale nello stesso PR.

## Fonti tecniche e prove N0

I runbook dettagliati e l'evidenza storica sono in [docs/release](../release/):
[CI](../release/continuous-integration.md),
[staging](../release/staging-environment.md),
[health/draining](../release/health-and-draining.md),
[recovery](../release/database-recovery.md) e
[registro drill](../release/recovery-drill-record.md).
