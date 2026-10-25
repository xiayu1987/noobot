# workflow

Noobot workflow engine library (**ESM**).

> Note: this library only accepts workflow semantic objects; it does not parse text DSL.

## Install / Use

```js
import workflow from "workflow";
// or
import {
  compileWorkflowSemantic,
  startWorkflowInstance,
  startWorkflowInstanceById,
  getWorkflowInstanceSnapshot,
  resolveWorkflowUpstreamActionSteps,
  advanceWorkflowInstanceById,
  releaseWorkflowInstance,
} from "workflow";
```

## Stable Facade API

- `compileWorkflowSemantic(semantic)`
- `startWorkflowInstance({ model })`
- `startWorkflowInstanceById({ instanceId, semantic })`: `instanceId` is required; an existing id is rejected.
- `getWorkflowInstanceSnapshot({ instanceId })`: throws for an unknown instance.
- `resolveWorkflowUpstreamActionSteps({ instanceId, stepId })`
- `advanceWorkflowInstanceById({ instanceId, action })`
- `releaseWorkflowInstance({ instanceId })`: throws for an unknown instance.

## Extension API

```js
import workflowExtension from "workflow/extension";
// or
import { registerModelBoxFactory } from "workflow/extension";
```
