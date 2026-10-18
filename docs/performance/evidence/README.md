# Evidence map

- `production-snapshot.json`, `production-headers.json`: sanitized read-only observations, not a production load test.
- `local-initial-ramp.json`: exploratory patched run before shortening the counter lock; working source was not yet committed. Do not treat its commit metadata as an exact source attestation.
- `baseline-quiet.json`: production commit c3785a2 with only the local load harness copied in; 35-second paced phase and analytics counts completed. Quiet relative to this audit's jobs; machine was not dedicated hardware.
- `baseline-contended-run.json`: earlier reference attempt stopped at 100 concurrency on latency threshold. Retained to disclose variability.
- `local-final-mixed.json`: application code from 501d971, mixed reading run stopped at 100 on latency threshold. No HTTP/render errors, but later phases did not execute.
- `*-cleanup.json`: launcher verified that its owned run database was dropped and services stopped.
- `browser-regressions.log`: first 21 passing browser checks. Focused/cache/lock logs record targeted tests.
- `backup-rerun.log`: all 41 existing backup checks pass separately after two timing failures in a broad concurrent run.

`local-final-analytics.json` is the separate final analytics profile (1cf4f5f source), with exact persisted counts, and `local-final-analytics-cleanup.json` verifies teardown. Final automated verification is added after completion. All test traffic/database writes were isolated locally; no production load was generated. The audit report is the interpretation of these files, including stop conditions and unmatched hosting limits.
