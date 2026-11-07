# Model release ordering

`model-library.json.releases` is the authority for release dates, keyed by exact,
case-sensitive API model ID. Each entry declares `date` (`YYYY-MM-DD`) and an
official `source` URL. Use the first public API availability of that exact ID,
including a public preview when it uses the same ID. A separately named preview
ID does not establish the date of a later stable ID. Do not use weights publication dates,
documentation update dates, version numbers, aliases, or configuration order to
infer release dates. For regional launches use the first public API availability.
A library model without a `releases` entry has no verified date; add one only when
the exact model's public API release can be sourced.

`resolveModelRelease` returns an immutable fact or `null` for an unverified model.
`sortModelsByReleaseDate` returns a new list ordered by descending date, keeping
input order for equal dates. Models without a verified date follow dated models,
also in input order. Only the model picker drawer applies this order; catalog
projection and candidate normalization keep configuration order.
