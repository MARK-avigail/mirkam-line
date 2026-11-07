# Retained caller recordings and owner playback

Caller speech segments from document filling, chat, family messages and office tickets are retained for four calendar months under the existing retention/hold mechanism. A separate spoken notice precedes the main menu. This does not record PIN keypresses, assistant replies or a continuous full call.

The Voice Elements upload archives accepted audio atomically before transcription. A stable call/prompt identity prevents duplicate recordings after temporary uploads expire; retries preserve the first accepted bytes. Transcription failure and disconnect after upload do not erase the archive.

An owner-only Recordings tab lists metadata in each user dossier and loads local audio through an authenticated, account-scoped endpoint with audit and no-store headers. Revoked sessions, other roles, wrong-account IDs, expired records and invalid data cannot retrieve audio. Playback URLs are released on navigation/logout; delayed responses cannot restore a player after logout. Provider-only historical references remain explicitly unavailable rather than fetching arbitrary URLs.

Validation on this release: 3,348 Node tests and 16 Python mailbox tests passed. Earlier workspace totals included separate, unshipped changes and are not the count for this release. The two retry/invalid-data regressions failed before the fixes and pass after them. Browser playback and production call acceptance remain pending; local browser setup was blocked by sandbox network permissions. No production credentials, data or recordings were inspected or included.

Deployment: end active calls, then use deploy/apply-voice-experience.sh on the VPS. It rebuilds the bridge, backs up the existing private app data/configuration, deploys the app and recreates the bridge in its network namespace, with rollback attempts on failure. A registration message does not prove a successful call. Confirm one test recording appears and plays in the owner dossier. No production deployment is claimed here.

Limits: audio never uploaded before disconnection cannot be recovered; previously deleted audio cannot be recovered; provider-only legacy recordings are not mirrored. More retained audio consumes additional storage. Existing cleanup scheduling is unchanged and must be checked in production; playback denies expired recordings except holds. The five-minute disconnection and the permanent Panasonic/fax connection remain unresolved.
