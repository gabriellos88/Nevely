# Recovery drill record

Status: PASSED

- Drill date: 2026-07-26
- Operator: Project owner with Codex-assisted execution
- Reviewed by: Project owner on 2026-07-26
- Source environment: Railway staging
- Restore method: pgBackRest PITR from private Cloudflare R2 to Railway sibling
- Requested restore timestamp: 2026-07-26T20:58:04.521402Z
- Requested restore transaction ID, if used: 876
- PITR window confirmed: PASS — the target WAL was confirmed archived before restore
- Source archive health check: PASS — the fresh full backup and target WAL were readable from R2
- Source pgBackRest full backup confirmed: PASS — `20260726-203126F`, 31.1 MB and 1,359 files, completed at 20:35:18.788Z in 233.529 seconds
- R2 bucket remained private: PASS
- Recovery used a separate read-only token: PASS
- Source remained untouched: PASS — the source service stayed online throughout both restore attempts
- Restored service identity verified: PASS — isolated service, new empty volume and no public endpoint
- Exact recovery boundary: PASS — the target marker was present and the post-target marker was absent
- Promotion evidence: PASS — recovery stopped after transaction 876 at the requested timestamp; archive recovery completed and PostgreSQL accepted connections
- `npm run recovery:verify` result: PASS — 3 migrations, 16 required tables and 4 integrity checks
- Synthetic authenticated smoke result: PASS — 3 tests passed and 0 failed against a temporary database clone; authentication, authorization, profile, persisted Socket.IO and ban-notification paths were exercised
- Restore duration: 8 minutes 43.135 seconds, from restore start at 21:20:17.044Z to database readiness at 21:29:00.179Z
- Verification duration: 0.557 seconds read-only verification; 4.397 seconds authenticated smoke
- Observed RPO: 0 seconds relative to the selected transaction boundary
- Observed RTO: 8 minutes 43.135 seconds
- RPO target met: PASS — at most 5 minutes
- RTO target met: PASS — at most 60 minutes
- Privacy and environment controls: PASS — staging validation confirmed analytics and indexing disabled and email restricted to test delivery; no secrets or user data were recorded
- Cleanup: PASS — the synthetic smoke clone and temporary staging connection reference were removed; the successful restored sibling remains available after review
- Issues and follow-up tasks:
  - The first isolated restore attempt used an older base backup and exhausted its 5 GB volume while replaying WAL. PostgreSQL reported `No space left on device`; the source remained online and unchanged.
  - The successful retry used a fresh full backup, a new empty volume and a synthetic transaction immediately afterward. Final target-volume usage was approximately 5%.
  - The failed sibling and volume are retained as error-state evidence until review. Remove them only after verifying their exact service and volume identities.
  - Railway Hobby restore drills must include the fresh-full-backup and empty-volume capacity gate now documented in the runbook.

N0.5 can be checked only when this record says `Status: PASSED`, contains no
secrets or user data, and is reviewed after a real isolated restore.
