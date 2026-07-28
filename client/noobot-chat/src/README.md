# Frontend Architecture

The frontend is organized by ownership first and technical role second.

```text
src/
|-- app/              application bootstrap, shell, routing and app-wide state
|-- modules/          business capabilities owned by a single feature
|   |-- chat/
|   |-- composer/
|   |-- debug/
|   |-- session/
|   `-- settings/
|-- infrastructure/   HTTP, WebSocket and backend API adapters
|-- extensions/       plugin extension points and runtime integration
|-- plugins/          generated and built-in plugin registration
|-- shared/           business-agnostic UI, styles, i18n and utilities
`-- public/           stable API exported to frontend plugins
```

## Module Layout

A business module may use these directories when they are needed:

```text
modules/<feature>/
|-- components/       Vue presentation components
|-- composables/      Vue composition functions and reactive orchestration
|-- model/            pure domain state, rules and transformations
|-- runtime/          long-running workflows and event processing
|-- stores/           feature-owned Pinia stores
`-- public-api.js     explicit exports for other modules
```

Do not create an empty directory just to satisfy this template.

## Dependency Rules

1. `app` may compose modules, infrastructure, extensions and shared code.
2. A module may depend on `infrastructure` and `shared`, but must not import from `app`.
3. `shared` must remain business-agnostic and must not import from modules.
4. `infrastructure` must not import Vue components or application shell code.
5. Cross-module imports should target a module public API when one exists.
6. Vue files belong in component, panel or shell directories. JavaScript orchestration belongs in composable, model, runtime, store or infrastructure directories.

## Placement Guide

- A reusable visual primitive belongs in `shared/ui`.
- A chat-specific component belongs in `modules/chat/components`.
- A pure chat transition or normalization rule belongs in `modules/chat/model`.
- A Vue hook whose name starts with `use` belongs in the owning module's `composables` directory.
- HTTP and WebSocket clients belong in `infrastructure` even when only one module currently uses them.
- Plugin-facing compatibility exports belong in `public`; internal implementation files do not.
