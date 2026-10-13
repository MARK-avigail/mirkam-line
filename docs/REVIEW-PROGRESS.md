# Persisted telephone document review

The old telephone routes accepted the review position from the request URL and
clamped an oversized position to the last chunk. This allowed the recipient
approval prompt to be offered without sequential review.

The new document-review module stores the current chunk, whether it was presented,
and completion against a SHA-256 hash of the document in the existing session.
The server chooses the chunk; the URL cannot select a later chunk. Only an explicit
1 advances. Silence and repeat keep the current position. Old duplicate callbacks
cannot advance a new unpresented chunk. A changed document requires fresh review.
The recipient approval guard now requires completed review.

This records generated readback and user input, not proof that audio was heard.
It resumes review in the same stored session, not in a new authenticated call.
Cross-call account login and draft selection remain unfinished. Existing sessions
without review progress restart their review.

Validation: 29 offline checks passed, including seven new regression cases and
an actual session save/reload. Syntax checks passed for 29 JavaScript files.
HTTP tests were updated with sequential review and bypass/resume cases but could
not run because npm dependencies are missing. No live call or email was tested.
