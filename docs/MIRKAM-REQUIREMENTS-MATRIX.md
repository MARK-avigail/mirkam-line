# Mirkam Line 0.2 — implementation versus acceptance

This matrix is authoritative for this development delivery. It must not be read
as a claim that every agreed detail or real-world provider is complete.

| Requirement | Implementation | Acceptance still required |
|---|---|---|
| New Mirkam Line identity, five branches/submenus | New native HTTP/voice server and branded interface | Browser and telephone user testing |
| Personal verified accounts and six-digit codes | New identity store, trial/free exceptions, PIN hashing and revocation | Enrollment/reset office procedure and load testing |
| Owner/support/billing, MFA | Separate permissions, staff TOTP and tokens; production requires owner MFA | Staff setup UI is partial; external key management and operational review |
| Uncle's free membership without automatic private access | Owner-approved per-account freeMembership | Owner must enroll/verify actual uncle; no real person auto-created |
| AI opt-in and conversational clarification | Per-document choice, automatic contextual coach, history, additions, original restoration | Real Hebrew dialogue and model factual-quality testing |
| Petition, early relief and prior petition | New topics, profile/court confirmation, separate package | Verified court mapping and legal/template validation |
| Spoken dates | Numeric and explicit supported Hebrew day/month/year parsing | Unknown/relative wording is rejected for restatement; validate live STT examples |
| Separate affidavit and fee | Explicit draft files, no false attestation/receipt | Official forms, current fee, signing/attestation and accepted filing routes |
| Real annex attachments | Owner-scoped encrypted storage, size/type/signature, included in mail | Malware scanning and complete voice annex-upload handoff |
| Draft resume, versions, archive | Persistent account ownership, snapshot versions, deliveries, cross-login/call selection | Concurrent real calls, immutable archive policy beyond current snapshots |
| Separate AI conversation branch | Named chats, both sides' history, quotas | Real model/voice quality and cost measurements |
| Approved contacts and outgoing family mail | Staff approval, per-message approval, TLS SMTP adapter | Live SMTP mail receipt/reply routing setup |
| Incoming family messages | Sender/contact/thread verification and idempotent staff ingestion | Authenticated automatic inbound provider adapter is not implemented |
| Company notices/membership/office | Announcements, trial/free/paid status, usage, tickets | Full office ticket status UI and payment provider |
| Payments | Consent defaults, trial restrictions, idempotent verified-event service, checkout boundary | Provider not selected; checkout/callback adapter is not wired; no real charges tested |
| Fax | Explicit channel, approved destination and unconfigured-provider failure | Fax provider/adapter/webhooks not implemented |
| Email | Package and family adapters, TLS, explicit approvals, acceptance status | Credentials, live send, inbox/court receipt and reconciliation |
| Voice protocol | Signed callbacks, prompt nonce, async jobs, user/PIN not recorded | Real transport number/gateway, DTMF, hangup, silence and calls up to target |
| Audio retention | Four calendar months, encrypted local audio, hold/retry and Twilio deletion adapter | Scheduled cleanup, verified provider deletion, backup/historical-page purge |
| Encrypted persistent storage | SQLite/WAL, encrypted payloads, CAS, encrypted backup/restore tests | Metadata sensitivity, off-machine backup schedule, disaster recovery and 100 calls |
| Cost controls | Server request reservations and account caps | Accurate dollars/minutes accounting, supplier limits and monitoring |
| Administration branding | Owner tools integrated into new interface | Full role onboarding/approval screens and final brand assets |

## Important operational limits

Local request limits are not dollar budget caps. Current scryptSync authentication
can block the event loop during hashing; measure and replace with a bounded async
worker/identity service before declaring 100-call capacity. SQLite concurrency
is protected by revisions/transactions but capacity is not proven by unit tests.

Encrypted payloads do not hide all record metadata. Removing a value from the
active SQLite record does not retroactively erase database pages or backups.
Define secure purge/backup retention before real private-data rollout.

The new voice flow has browser-equivalent core state tests and signed callback
tests, but some phone features (rich editing/attachment upload/version selection)
still need voice parity and live acceptance. Do not label this build production
ready solely because more than 70 local checks pass.
