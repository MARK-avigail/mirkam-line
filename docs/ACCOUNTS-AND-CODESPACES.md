# Accounts and Codespaces development checkpoint

## Implemented

- Administrator registration with name, identity, prisoner number, prison and
  verifier name/time. This records the administrator's verification; it does not
  independently verify eligibility with an external authority.
- Random six-digit user code and PIN, salted scrypt PIN hashes, three attempts per
  code within fifteen minutes and twenty failures per network source in that window.
- Hashed bearer tokens with one-hour expiry, logout, suspension and PIN reset.
  PIN reset and suspension revoke existing tokens.
- Member draft creation, owned draft listing, saved-answer editing, reload after
  a new browser login and draft PDF/Word downloads. Other members cannot access
  unowned or differently owned drafts. Admin access intentionally remains global.
- Browser account interface at /members.html. Tokens are held in browser memory;
  a page reload requires login, then the account's drafts are loaded from storage.
- Codespaces development configuration and startup helper.

## Start in GitHub Codespaces

Extract the ZIP and put the CONTENTS of ki-ativa at the repository root, including
.devcontainer, package.json and src. Uploading a ZIP alone does not run Node.js.
Create/rebuild a Codespace so .devcontainer/devcontainer.json is used.

The post-create command installs prerequisites and runs setup/check. If it fails,
copy the terminal error, without secrets. To repeat manually:

```bash
bash scripts/setup-check.sh
```

After successful checks:

```bash
npm run dev:codespaces
```

Keep forwarded port 3000 private. Open its browser preview and visit /members.html.
On first startup, a private .env is created with a random ADMIN_TOKEN. Read that
value locally in the editor and enter it in the administrator enrollment form.
Never upload .env or data to GitHub. Use fictional data for development.

## Verification and limits

37 offline checks passed. JavaScript syntax and both shell scripts were checked.
New HTTP integration tests were written but not run in the assistant environment
because npm dependencies remain unavailable. Codespaces startup was not executed
here. Do not call this an end-to-end or deployment verification.

Accounts are not yet wired into telephone login. Five service branches, version
history, full staff roles, MFA, payments, fax, retention automation and live service
activation remain unfinished. Existing account/session JSON storage and scryptSync
are for single-process development; this is not verified for 100 concurrent calls.
No real users, supplier accounts, GitHub repository or PBX settings were changed.
