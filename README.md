> תוכנית המוצר הפעילה והחלטות עדכניות: [CURRENT-PLAN-HE.md](docs/CURRENT-PLAN-HE.md). מסמכי דרישות ישנים נשמרים כמקורות; שינויים מפורשים במסמך הפעיל גוברים.

# Mirkam Line — מרקם ליין

Mirkam Line by Mavrika AI is the new five-branch service. npm start now runs
src/mirkam-server.js with a new interface and a separate encrypted data store.
The old petition code remains only for regression/reference; start:legacy runs it explicitly.

## Development

Use Node.js 24 (or 22.13+), Python 3, PDF dependencies and a Hebrew font.

```bash
npm run test:mirkam
npm start
```

The new HTTP server, identity, database, workflows and tests use Node built-ins;
starting them does not require downloading Express/Twilio. SMTP additionally
requires npm install for Nodemailer. PDF requires a Python environment:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-document.txt
export PYTHON_BIN="$PWD/.venv/bin/python"
```

Keep Codespaces forwarded port 3000 private. Codespaces is development hosting,
not a verified permanent production host.

## Administrator and members

Development startup creates a private mirkam-admin-secret.txt. Read it locally in
the editor and enter it in the administrator section. Never send or commit it.
The legacy ADMIN_TOKEN/PIN does not automatically become the new owner token.

Enroll verified members with profile/prison/wing and separate six-digit user and
PIN codes. Free membership is an owner exception and gives no staff access.
Owner-approved court destinations and verified prison mapping must be configured
before a real petition. Official destinations and fee values are not invented.

Support/billing identities have separate roles and individual TOTP secrets.
Owner-authenticated POST /api/admin/staff takes name/role; POST /api/staff-login
uses id/password/TOTP. Staff cannot create owners. These endpoints are tested;
a complete staff setup wizard is not supplied. Owner MFA uses MIRKAM_ADMIN_TOTP_SECRET.

## Five branches

1. New petition: AI on/off, profile/court confirmation, relief-first dialogue,
   contextual clarification, answer approval, separate petition/affidavit/fee drafts.
2. Account drafts, versions and delivery history after a new login.
3. Named contextual AI conversations with both sides stored as text.
4. Staff-approved family contacts, outgoing review/approval and incoming replies.
   Automatic incoming mail requires a chosen authenticated provider; verified staff
   ingestion is currently implemented.
5. Announcements, trial/membership/usage and office requests.

## Providers

OPENAI_API_KEY is a server secret. MIRKAM_TEXT_MODEL defaults to gpt-4.1 and is
configurable. This choice is not a legal accuracy guarantee. AI/transcription
requests are chargeable. MIRKAM_AI_REQUESTS_PER_DAY defaults to 40 per account,
including reserved failed attempts. It is a request limit, not a dollar spending
cap. Credits and supplier usage require monitoring.

SMTP_HOST/PORT/USER/PASS/FROM enable mail with TLS port 465/587. Acceptance by a
mail server is not inbox or court receipt. Document bundles stay marked for
checking. Affidavit attestation, fee proof and accepted filing routes require
verification. Attachments have signature/size checks but no malware scanner.

Twilio POST routes /voice/voice and /voice/step validate signed callbacks, use
six-digit user/PIN Gather without PIN recording, prompt nonces, async processing,
five menus, account drafts and explicit delivery confirmation. Configure HTTPS
BASE_URL, TWILIO_ACCOUNT_SID/AUTH_TOKEN and the provider webhook. Local routes
were tested, but no live call acceptance test ran. Panasonic USB management and
raw SIP/FXO are not automatically connected; they need the selected adapter.

Fax/payment providers remain unconfigured. Boundaries reject rather than invent
success. Provider selection, authenticated callbacks and live tests are needed.
Paying OpenAI does not activate mail, fax, payment or a telephone number.

## Data/security/retention

Records use AES-256-GCM encryption in SQLite/WAL and optimistic revisions.
Development generates a private key in mirkam-data/encryption.key. Production
requires a separately managed DATA_ENCRYPTION_KEY (base64 32 bytes) and owner MFA.
Database, encryption key and owner secret must never be committed. Encryption
protects record payloads, not all database metadata.

The fourteen-day trial never auto-charges/deletes drafts. Filling audio retention
uses four calendar months, including month-end clamping. Legal hold has a staff
reason and audit. Expired local audio bytes are removed from active records;
provider deletion is retried on failure. Backup retention and historical SQLite
pages still need an operational purge policy.

Owner POST /api/admin/cleanup runs deletion; production needs scheduled cleanup.
Store.backup() produces a database backup; restore needs the separately secured
matching encryption key. Tests exercise encrypted backup/restore. Off-machine
scheduling, monitoring, UPS and 100-call capacity need deployment testing.

## Verification

Read docs/MIRKAM-VALIDATION.md and docs/MIRKAM-REQUIREMENTS-MATRIX.md. HTTP tests
exercise the actual handlers with isolated transport. The sandbox denied a
loopback socket, so there is no complete local browser/network test. This is a
coherent development release requiring acceptance, not 100% launch readiness.
