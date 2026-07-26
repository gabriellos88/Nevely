# Recovery drill record

Status: NOT RUN

- Drill date:
- Operator:
- Reviewed by:
- Source environment: staging rehearsal, then production enablement
- Restore method: pgBackRest PITR from private Cloudflare R2 to Railway sibling
- Requested restore timestamp:
- Requested restore transaction ID, if used:
- PITR window confirmed:
- Source archive health check:
- Source pgBackRest full backup confirmed:
- R2 bucket remained private:
- Recovery used a separate read-only token:
- Source remained untouched:
- Restored service identity verified:
- `npm run recovery:verify` result:
- Synthetic authenticated smoke result:
- Restore duration:
- Verification duration:
- Observed RPO:
- Observed RTO:
- RPO target met:
- RTO target met:
- Issues and follow-up tasks:

N0.5 can be checked only when this record says `Status: PASSED`, contains no
secrets or user data, and is reviewed after a real isolated restore.
