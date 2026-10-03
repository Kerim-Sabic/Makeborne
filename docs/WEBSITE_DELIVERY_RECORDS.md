# Website delivery records

Website projects now have a Website delivery panel under History & review, containing preview and live URLs, hosting/account reference, delivery notes and a last-updated timestamp. The CRM client project table exposes both links beside the relevant project. These are explicitly user-recorded links, not deployment evidence.

Records are optional for backward compatibility and persist in the existing validated local workspace and its backups. Saving writes the complete workspace before clearing the form; failures preserve the form. Activity records each successful update. Adding a link does not change approval/publication status, call any host, or fetch the URL. HTTP(S) links only; embedded usernames/passwords and executable schemes are rejected. External anchors isolate the opener.

Verification: 23 offline schema/link/history assertions pass. TypeScript passes; focused lint has zero errors and two pre-existing studio image warnings. Browser QA on isolated localhost origin saved preview/live example.com addresses and hosting notes on `7ec3bef3-85e0-4863-a1a4-deb9db651bec`, reloaded, and confirmed both links in the linked client's project table. No external test links were opened. The QA data remains clearly marked as test data.

Limits: no automated availability checks, DNS configuration, hosted deployments or cloud synchronisation. Website revisions are local records, not a tamper-proof server audit log.

## Revision history

Every changed save preserves the prior website details with a replacement timestamp. Unchanged saves do not add history or activity noise. The 100-revision limit rejects a new change without deleting old history. Optional history fields keep older backups readable. Browser QA changed the host reference, reloaded, and confirmed the prior host, URLs and notes in the expanded Previous website details panel. Current and historical values are both visible.
