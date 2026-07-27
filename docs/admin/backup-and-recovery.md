# Backup e recovery PostgreSQL

## In una frase

Oggi Nevely usa PostgreSQL su Railway e pgBackRest verso Cloudflare R2 privato
per il PITR: il ripristino a un punto nel tempo.

## Cosa protegge il sistema attuale

- WAL archiviati continuamente (timeout configurato: 60 secondi);
- backup differenziale ogni 24 ore;
- backup completo ogni 7 giorni;
- 4 completi e 14 differenziali conservati;
- restore su un nuovo PostgreSQL Railway, con volume vuoto;
- database sorgente lasciato intatto.

È un sistema autogestito: Railway non mostra né ripristina questo archivio
dalla propria schermata Backups. Un backup è valido solo dopo un restore.

## Separazione obbligatoria

| Sorgente | Bucket | Scrittura | Ripristino |
| --- | --- | --- | --- |
| Staging | `nevely-staging-pitr` | token R2 Read & Write staging | token separato Read only |
| Produzione | `nevely-production-pitr` | token R2 Read & Write produzione | token separato Read only |

I bucket sono privati. Non applicare lifecycle policy o bucket lock senza
conferma di compatibilità con pgBackRest: possono spezzare la catena recovery.
Le chiavi sono solo variabili protette nel servizio PostgreSQL Railway.

## Controllo mensile

1. Verificare catalogo pgBackRest, backup completo e archivio WAL recente.
2. Eseguire restore drill su staging con dati sintetici.
3. Creare un nuovo servizio PostgreSQL Railway e volume vuoto.
4. Usare una chiave R2 di sola lettura per il servizio restore.
5. Verificare schema, integrità e applicazione con script read-only.
6. Registrare durata, RPO/RTO osservati e problemi.
7. Eliminare il clone solo dopo revisione del record.

Non collegare l'app staging normale al DB recuperato e non riutilizzare volumi
di sorgente o restore falliti.

## Incidente reale

```text
fermare scritture → scegliere punto sano → restore isolato → verificare
→ doppio controllo → cambiare riferimento DB → riaprire traffico
```

Conservare la sorgente danneggiata in sola lettura fino alla revisione. La
maintenance mode amministrabile è prevista in N6: oggi un cutover d'emergenza
richiede coordinamento esplicito.

Obiettivi proposti: RPO 5 minuti e RTO 60 minuti. Railway Hobby ha un limite
di volume recovery di 5 GB: prima di un drill fare un full backup fresco e
usare sempre un volume target nuovo.

Per comandi e variabili esatte, vedi il
[runbook tecnico](../release/database-recovery.md) e il
[registro dell'ultimo drill](../release/recovery-drill-record.md).
