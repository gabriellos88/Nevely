# Modifiche infrastrutturali importanti

Usa questa guida per sostituire un componente centrale: per esempio passare da
pgBackRest + Cloudflare R2 ai backup/PITR gestiti Railway.

## Principio

Non disattivare il sistema precedente finché quello nuovo non ha superato un
restore isolato, verificato e cronometrato. Una schermata verde non prova la
capacità di recovery.

## Valutare backup Railway invece di R2

Verificare nel piano Railway in uso:

1. backup e PITR realmente inclusi;
2. frequenza, retention e granularità;
3. possibilità di restore su servizio separato;
4. regione, cifratura, ruoli, costi e supporto;
5. limiti di volume, tempi e possibilità di esportazione dal provider.

Non presumere che “Backups” significhi PITR, stesso RPO o restore verificabile:
dipende dal piano e dal prodotto Railway correnti.

## Migrazione sicura

1. Aprire branch/PR con criteri di successo e rollback.
2. Aggiornare privacy/retention se cambiano processore, regione o conservazione.
3. Abilitare il nuovo sistema prima in staging, mantenendo R2 attivo.
4. Creare dati sintetici e fare restore isolato; verificare schema, integrità
   e applicazione tramite test non pubblici.
5. Misurare RPO/RTO e registrare il drill.
6. Ripetere su produzione senza esporre dati restaurati pubblicamente.
7. Mantenere doppia protezione finché la retention e il restore del nuovo
   sistema non sono comprovati.
8. Ottenere revisione a due persone prima di disattivare R2.
9. Solo dopo il restore drill finale e la retention concordata, revocare token,
   rimuovere variabili e infine eliminare bucket R2.

Eliminare bucket o token è distruttivo: richiede target confermati e restore
alternativo provato.

## Template decisionale

| Domanda | Risposta da documentare |
| --- | --- |
| Quale problema risolve il nuovo servizio? | |
| Quale dato tratta e in quale ambiente? | |
| Quali segreti/ruoli richiede? | |
| Quale test dimostra che funziona? | |
| Come si torna indietro? | |
| Quali policy, alert e documenti cambiano? | |
| Chi approva il cutover? | |

Ogni PR infrastrutturale aggiorna nello stesso commit panoramica, runbook,
variabili richieste senza valori, rollback, cadenza controlli e policy/TODO
quando cambiano dati, retention o fornitori.
