# Context protocol

## Message attachments

`resolveContextMessageAttachments` defines the attachment projection used by model user metadata. Message `attachments` and attachment-mode `transferEnvelopes` contribute distinct identities; neither source suppresses the other. Source-reference envelopes remain references and are not converted into attachments.

Identity is the canonical `attachmentId`, `sessionId`, `attachmentSource` triple. Transfer descriptors use nested `identity`; the context projection explicitly maps this to model metadata. Entries with the same identity appear once. Shared `name`, `mimeType` and `size` values must agree; conflicting values throw `context_attachment_metadata_conflict:<field>`. A field supplied by only one representation is preserved. No file paths or inferred identities are introduced.

Missing message array fields mean an empty list. Non-array values are invalid. Tool-result storage retains the authoritative result; model projection may compact empty fields without modifying stored results.
