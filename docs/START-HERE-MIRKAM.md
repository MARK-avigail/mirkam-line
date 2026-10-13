# Mirkam Line — development handoff

This package contains ki-ativa plus persisted document-review progress and a
setup/check script. It is not a completed Mirkam Line release. See
REVIEW-PROGRESS.md for the code change and validation limits.

Use a modern Linux development environment such as a GitHub Codespace with Node.js
22+, Python 3, Python venv support and a Hebrew font. Do not install this server on
the Windows 7 computer used to manage the PBX.

From the project directory, run:

```bash
bash scripts/setup-check.sh
```

The script installs dependencies and runs syntax/runtime checks, offline checks
and the full test suite. It stops on the first failure. Send the terminal error
for diagnosis; do not send passwords, API keys or .env contents.

To run locally after the checks:

```bash
export PYTHON_BIN="$PWD/.venv/bin/python"
npm start
```

Do not publish or expose the application before configuring authentication and
reviewing the deployment requirements in README.md. Do not use real prisoner
data for development tests.

Verified in the current assistant workspace: 37 offline checks passed. Full tests
were not run because npm dependencies could not be downloaded. The setup script
was syntax checked, but its installation steps have not completed here.

No GitHub repository was changed. No PBX settings were changed. Live telephony,
AI, email, fax, payments and capacity remain unverified or unfinished as described
in the project documentation.

For the new accounts interface and GitHub Codespaces setup, read ACCOUNTS-AND-CODESPACES.md.
