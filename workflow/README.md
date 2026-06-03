# workflow

Noobot workflow engine library (**ESM**).

> Note: this library only accepts workflow semantic objects; it does not parse text DSL.

## Install / Use

```js
import workflow from 'workflow';
// or
import {
  compileWorkflowSemantic,
  startWorkflowInstance,
  advanceWorkflowInstance,
  executeWorkflowSemantic,
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance,
} from 'workflow';
```

## Stable Facade API

- `compileWorkflowSemantic(semantic)`
- `startWorkflowInstance({ model, conditionContext })`
- `advanceWorkflowInstance({ bizinst, treeRecord, controlCenter, semantic, options })`
- `executeWorkflowSemantic({ semantic, options })`
- `startWorkflowInstanceById({ instanceId, semantic, options, meta })`
- `getWorkflowInstanceSnapshot({ instanceId })`
- `advanceWorkflowInstanceById({ instanceId, action })`
- `releaseWorkflowInstance({ instanceId })`

## Extension API

```js
import workflowExtension from 'workflow/extension';
// or
import { registerModelBoxFactory } from 'workflow/extension';
```
