# workflow

Noobot workflow engine library (CommonJS).

> Note: this library only accepts workflow semantic objects; it does not parse text DSL.

## Stable Facade API

- `compileWorkflowSemantic(semantic)`
- `startWorkflowInstance({ model })`
- `advanceWorkflowInstance({ bizinst, treeRecord, controlCenter, semantic, options })`
- `executeWorkflowSemantic({ semantic, options })`
