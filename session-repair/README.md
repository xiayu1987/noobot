# Session Repair

`@noobot/session-repair` is the only place allowed to interpret historical Session protocol fields.

The package provides explicit, deterministic migrations into the current Session and Semantic
Transfer protocols. Runtime readers never return a historical shape: they either validate the
current protocol, atomically migrate and validate a staging copy, or report the Session as
unavailable.

Migration rules must preserve canonical identity and content. A rule must fail when required
identity cannot be recovered without guessing. Failed staging directories are removed and the
authoritative Session directory remains unchanged.
