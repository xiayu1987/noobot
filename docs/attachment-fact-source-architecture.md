# Attachment fact-source architecture

This document defines the attachment data ownership rules used by Noobot chat and agent runtime. The
cross-layer contract is implemented by `@noobot/attachment-protocol`; this document describes ownership,
not an alternative schema.

## Canonical identity

The only business identity is the complete tuple `attachmentId + sessionId + attachmentSource`.
All three fields are required and must be carried together. Paths, file names, MIME types, sizes,
content hashes, and client-generated ids are metadata or access/ingest aids only; they must never
identify, merge, replace, or resurrect an attachment in the new protocol path.

## Layers

1. `runtime/attach/scoped/<sessionId>/<source>/attachments.json`
   - Upload and parse-result enrichment persistence adapter.
   - Owns a protocol persisted record keyed by the canonical identity. Storage paths and parsed-result
     locations are storage references, not identity fields.

2. Session user-message `attachments`
   - Display and edit/resend carrier.
   - Must keep enough rich fields for session detail and frontend preview/download: ids, paths, session/source, preview/download fields, and `parsedResult`.

3. Agent runtime `userMessageAttachments`
   - Current-turn model-input authority.
   - Built after prepare/enrichment and used by message-builder user metadata.

4. Frontend normalized attachments
   - UI view only. It may derive `parsedResultUrl`, `parsedResultAttachmentId`, names, and actions, but must not become a competing persistence source.

5. Payload/raw/serialized attachments
   - Transport only. They carry canonical identity or an explicit ingest reference and must not overwrite
     rich session or runtime attachment metadata.

## Merge rules

- Rich fields win over raw fields.
- Non-empty values win over empty values.
- `parsedResult`, path fields, session/source fields, preview/download fields must not be removed by raw payloads.
- New protocol code matches only the complete canonical identity tuple.
- The former path/file-feature matching rules are legacy compatibility behavior and must be isolated in
  one adapter with an explicit removal plan; they are not valid protocol identity.

## Delete and unchanged semantics

- `attachments === undefined`: attachment set was not changed; preserve the existing message attachment set.
- `attachments = []`: user explicitly deleted all attachments; do not restore old items from session history or scoped indexes.

## Protocol and lifecycle

- Persistence, runtime, access and UI objects are separate protocol shapes; no layer may spread one into
  another or add host/sandbox paths to the canonical identity.
- Lifecycle events are versioned and carry `messageId`, the canonical identity, status and timestamp.
  They are the only authoritative attachment lifecycle mutations.
- `@noobot/attachment-protocol` owns validation and `undefined`/empty-array set-update semantics.

## Required code paths

- Frontend local message write-back must use `dialogProcessChain.mergeAttachments()`.
- Agent session write-back must use the rich-first normalization in `session-message-service` before `replaceTurn()` or reused-turn stamp saves user-message attachments.
- Session summaries must compact rich attachment refs with `compactAttachmentRef()` so session detail can still derive preview/download actions.

## Anti-patterns

Do not write these directly into persisted user-message attachments or model-input metadata:

```js
message.attachments = payload.attachments
message.attachments = serializedAttachments
message.attachments = [{ name, mimeType, size }]
```

Always merge/enrich first, and preserve explicit empty arrays as delete-all.
