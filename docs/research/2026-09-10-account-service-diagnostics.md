# Trace intermittent account-service failures

The signed-in postflight of `16e02d452b07` reproduced intermittent account failures in Portfolio, Monitor and Community. Automatic or explicit retry recovered the existing account. The client correctly distinguishes the failure from sign-out, but the server's generic 503 boundary hides which operation failed. No root cause is established yet.

Session lookup, expiry revocation, idle/remembered-session refresh and response serialization now carry a fixed diagnostic stage through the existing error boundary. The session endpoint and private API authorization boundary log the stage and a bounded reason category. Categories distinguish database quota/busy/schema/constraint errors, timeout/transport, other database errors, invalid records and uncategorized internal failures. Diagnostic delivery failures cannot change the authentication result.

Logs contain only those enums and a fixed surface label. They exclude the original exception, SQL, request parameters, account/session identifiers, cookies and credentials. Public responses, cookie behavior, expiry/revocation, CSRF checks and signing authority remain unchanged. Client diagnostic fields are serialized as JSON so browser tooling can read them instead of an opaque `Object` label.

Qualification: 54 reader/identity tests and 23 security/Privy-boundary tests pass. Cases exercise every server stage, category redaction, broken logging, unchanged generic 503 responses and no cookie clearing. Build, security architecture and public no-leak/38 Worker-response checks pass. The previous release's 368 browser cases remain the functional UI baseline; this change adds diagnostic output only.

Deploy the diagnostic release, then capture a short metadata-only trace of a normal signed-in account check. Use the observed stage/reason to fix the cause; do not treat recovery or instrumentation as proof that service availability is resolved.
