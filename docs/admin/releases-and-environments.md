# Rilasci e ambienti

Un rilascio è un commit verificato, non un semplice deploy riuscito. La
produzione riceve lo stesso commit verificato in staging.

```text
branch feature → pull request → CI verde → staging → verifiche → main → produzione
```

## Branch Git

| Branch | Uso |
| --- | --- |
| `main` | sorgente protetta e candidata alla produzione |
| `feature/<tema>` / `fix/<tema>` | una modifica verticale per branch |
| `codex/n0-release-safety` | branch storico N0, da non riutilizzare |

Per N1.1, ad esempio, creare `feature/n1-1-public-ids` e includere nel PR
codice, migrazione, test, rollout e rollback. `main` richiede PR, CI
`Migrations and tests` e branch aggiornato: niente force push o bypass.

## Checklist di rilascio

1. Individuare impatto su dati, migrazioni, segreti, privacy e backup.
2. Creare branch dedicato e implementare una sola modifica coerente.
3. Eseguire test locali, aprire PR e attendere CI verde.
4. Distribuire **il medesimo commit** in staging.
5. Eseguire verifica ambiente, migrazioni, `/health/ready`, smoke test e test
   browser contro staging, con dati sintetici.
6. Confermare noindex, analytics disabilitata ed email test-only in staging.
7. Annotare esito, anomalie e rollback nel PR/runbook.
8. Fare merge in `main`, distribuire produzione e controllare readiness/log.

Per i click Railway, i comandi di verifica, il destinatario email isolato, le
correzioni più comuni e il rollback dello staging, seguire il
[Runbook staging](staging-release-runbook.md). Non sostituire questa checklist
con un deploy manuale: il runbook documenta l'ordine sicuro GitHub → Railway →
verifiche → gate di produzione.

## Migrazioni database

Railway esegue `npm run db:migrate` prima dell'avvio. Per modifiche rischiose:

- aggiungere prima il nuovo schema, senza eliminare quello vecchio;
- distribuire codice compatibile con entrambi;
- trasferire e verificare dati;
- rimuovere il vecchio schema solo in un rilascio successivo.

Prima di modifiche irreversibili o ad alto impatto, eseguire un restore drill.
Se staging fallisce, non promuovere: correggere il branch e ripetere il flusso.

## Controlli aggiuntivi per N1

- `SESSION_SECRET` e `ADMIN_TOTP_ENCRYPTION_KEY` sono distinti, lunghi e
  presenti solo nelle variabili protette.
- `RESEND_FROM` è esattamente
  `Verify <noreply@notifications.nevely.app>`; staging usa test delivery.
- staging e produzione usano `GOOGLE_CLIENT_ID` differenti e origini
  autorizzate esatte, senza wildcard.
- dopo la migrazione 014, verificare che gli account usino `nvy_` + 12
  caratteri esadecimali lowercase e i guest `gst_` + 12; le API non devono
  restituire chiavi interne.
- almeno un amministratore di emergenza ha email verificata e TOTP attivo
  prima di rendere obbligatoria la console amministrativa.
