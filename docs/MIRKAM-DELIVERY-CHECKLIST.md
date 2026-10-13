# Mirkam Line — complete delivery scope

This is the agreed product scope, not a statement that these capabilities exist.
The ZIP contains a development checkpoint. A checked item means local implementation
exists; it does not mean live end-to-end verification or release readiness.

## Identity and accounts
- [x] Manual administrator enrollment records verifier and time.
- [x] Random six-digit user code and PIN; PIN hashing and temporary failure lockout.
- [x] Browser login/logout, account suspension and PIN reset revoke tokens.
- [x] Member-owned saved drafts and cross-account access guards.
- [ ] Telephone account login and cross-call resume, without recording PIN.
- [ ] Telephone commands and recovery for silence, invalid input and dropped calls.
- [ ] Role-separated staff, MFA, audit trail and approved support PIN-reset process.
- [ ] Explicit free membership for approved individual accounts, without admin access.

## Branch 1: prisoner petition to district court
- [x] Existing field-based district petition flow, answer confirmation and single-field editing.
- [x] Sequential document readback state and explicit content/recipient approval guards.
- [x] Local Hebrew PDF and Word generation.
- [ ] Account identity confirmation/prefill, verified prison-to-court mapping.
- [ ] Early requested relief, prior petition/new circumstances, urgency and annex workflow.
- [ ] Optional AI per document, factual safeguards and contextual drafting assistance.
- [ ] Separate affidavit draft, fee collection form and actual annex attachments.
- [ ] Verified official templates, fee amounts and required signature/attestation process.
- [ ] Approved destination directory and mail/fax/both choice with readback.
- [ ] Live approved delivery and verifiable receipt/status handling.

## Branch 2: drafts and archive
- [x] Browser listing and reopening account-owned drafts after new login.
- [ ] Telephone draft selection and saved-progress exit.
- [ ] Immutable document versions, archive, delivery timeline and receipts.
- [ ] Safe resend/new-version approvals and duplicate delivery prevention.

## Branch 3: AI conversations
- [ ] Named conversations, transcript history and explicit save/return behavior.
- [ ] Hebrew conversational voice interface with bounded costs and failure recovery.
- [ ] Separation from document facts and administrative permissions.

## Branch 4: family correspondence
- [ ] Administrator-approved contacts and contact permissions.
- [ ] Record/transcribe/review/approve outgoing messages.
- [ ] Receive and read incoming replies with ownership and threading.
- [ ] No automatic AI reply; live provider delivery statuses.

## Branch 5: company service
- [ ] Announcements, subscription information, usage and office contact requests.
- [ ] Accessible spoken menus and consistent command meanings.

## Payments and plans
- [ ] Introductory pricing and fourteen-day trial with explicit charging consent.
- [ ] Secure provider-hosted/tokenized payment; never store/record card CVV.
- [ ] Idempotent authenticated payment callbacks, receipts and refund/admin workflow.
- [ ] Preserve documents when trial/payment state changes; implement account exceptions.

## Operations and retention
- [ ] Four-calendar-month filling-audio retention, provider deletion and legal holds.
- [ ] Persistent database design suitable for the concurrency target.
- [ ] Encrypted off-machine backups, restore verification and monitoring.
- [ ] Staff access audit, safe error reporting, rate limits and supplier cost limits.
- [ ] Public-service notices and reviewed privacy/retention requirements.

## Telephony and release verification
- [ ] Chosen PBX/FXO/SIP/cloud ingress with verified line mapping and capacity.
- [ ] One complete real call: login, draft, review, save, return, approved delivery.
- [ ] Concurrent calls to the same entry number, up to the agreed capacity target.
- [ ] Provider failure, server restart, disconnect, unauthorized access and load tests.
- [ ] Full HTTP/browser tests and no unresolved critical release blockers.

## Branding
- [x] Names: Mavrika AI and Mirkam Line; initial logo concepts.
- [ ] Final English logo/tagline and production assets.
- [ ] Consistent names, greetings and visual/voice branding throughout the product.

External activation (supplier credentials, telephone numbers, payments, fax and
official destination/legal verification) must be tracked separately from code.
Pull requests must describe their actual subset of this checklist; no PR or ZIP
may be described as the full finished service unless all required acceptance
checks have passed. Never merge a development checkpoint as a release by name alone.
