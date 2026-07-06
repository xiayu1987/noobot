# Attachment fact-source architecture

This document defines the attachment data ownership rules used by Noobot chat and agent runtime.

## Layers

1. `runtime/attach/scoped/<sessionId>/<source>/attachments.json`
   - Upload and parse-result enrichment source.
   - Owns durable file identity: `attachmentId`, `sessionId`, `attachmentSource`, `path`, `relativePath`, `sandboxPath`, `parsedResult`.

2. Session user-message `attachments`
   - Display and edit/resend carrier.
   - Must keep enough rich fields for session detail and frontend preview/download: ids, paths, session/source, preview/download fields, and `parsedResult`.

3. Agent runtime `userMessageAttachments`
   - Current-turn model-input authority.
   - Built after prepare/enrichment and used by message-builder user metadata.

4. Frontend normalized attachments
   - UI view only. It may derive `parsedResultUrl`, `parsedResultAttachmentId`, names, and actions, but must not become a competing persistence source.

5. Payload/raw/serialized attachments
   - Transport only. Raw refs such as `{ name, mimeType, size }` may help match an attachment, but must not overwrite rich session or runtime attachment metadata.

## Merge rules

- Rich fields win over raw fields.
- Non-empty values win over empty values.
- `parsedResult`, path fields, session/source fields, preview/download fields must not be removed by raw payloads.
- Stable matching keys are, in order: `attachmentId`, `path`, `relativePath`, `sandboxPath`, then `name + mimeType + size`, `name + size`, `name + mimeType`.
- Do not match by file name alone; same-name files are common and can be distinct.

## Delete and unchanged semantics

- `attachments === undefined`: attachment set was not changed; preserve the existing message attachment set.
- `attachments = []`: user explicitly deleted all attachments; do not restore old items from session history or scoped indexes.

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
