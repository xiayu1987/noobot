# File mutation contract

`applyFileMutation` accepts `stageBytes(stagedPath, bytes)`. The callback writes only the supplied sibling staging path and must not change the destination. The callback may fail before or after writing staging bytes. No destination commit has occurred at that point.

The transaction owns destination changes: validate staged SHA-256, recheck the original destination version, rename the staged file (or unlink for deletion), validate the committed version, then publish the mutation record. Only a successful destination syscall establishes committed state. A record failure restores the original byte snapshot after checking that the destination still matches this transaction's committed version. An external version conflict is reported without overwriting external content. Failure details distinguish `not_committed`, `restored`, `conflict` and `restore_failed`; cleanup failures retain their paths and errors alongside the primary failure. Rollback record cleanup failure reports `file_mutation_cleanup_failed` with `targetState: restored`. The old destination-writing callback is not accepted.

The package root exports browser-safe contracts and text validation. Node byte conversion is exported only from `@noobot/file-mutation-protocol/text-codec-node`; browser consumers must not import this entry.

Text encoding is owned by `decodeFileDocument`, `encodeFileText` and `resolveFileWriteEncoding`: supported encodings are UTF-8, UTF-16LE, UTF-16BE and GB18030. `auto` recognizes UTF BOMs and otherwise requires UTF-8; unmarked UTF-16 and GB18030 must be explicit. BOM conflicts, malformed Unicode and non-reversible byte conversions are rejected. Updates and moves preserve source encoding, BOM, unchanged line terminators and EOF state. Auto writes preserve a decoded source encoding; new files use UTF-8. No encoding is inferred from a file extension or MIME type. Read/preview metadata and mutation downloads use the same resolved encoding; hashes and rollback always operate on original bytes.

Existing destinations must decode losslessly with the requested encoding before any write, including whole-file replacement. Decoding errors and BOM conflicts propagate; they never mean that the file is absent. Only an absent destination permits the new-file UTF-8 default. The encoding parameter describes both source decoding and output encoding, not a transcoding request.

`assertFileText` accepts well-formed Unicode, including NUL and other control characters. Successfully decoded content remains text in reads, previews, mutations, snapshots and downloads; content characters do not clear its resolved encoding or format metadata. Document-specific validation, such as JSON syntax, remains the caller's responsibility.

Search strictly validates each returned file once and checks returned match/context lines against that read. A mismatch fails explicitly rather than mixing snapshots. Only encoding metadata is retained between files. This check does not provide a filesystem-wide snapshot.

Locks serialize cooperating mutations. Version checks detect external changes at validation points; this is not a filesystem compare-and-swap or a crash-recovery journal.

`createFileDiff` returns a deterministic longest-common-subsequence edit script with unchanged `git-lines-v1` fields. Ambiguous equal-cost alignments have no prescribed placement. Common prefix/suffix and disjoint ranges are resolved directly; remaining ranges use divide-and-conquer LCS with row scores instead of a full matrix. Worst-case comparison time remains quadratic for interleaved inputs.
