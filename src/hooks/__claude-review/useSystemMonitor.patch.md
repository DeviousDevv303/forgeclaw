# Patch: useSystemMonitor — stale isActive derivation

## Problem (finishOperation, ~line 57)

```ts
setState(prev => ({
  ...prev,
  currentTool: null,
  isActive: prev.operations.some(o => o.id !== id && o.status === 'running'),
  //         ^^^^^^^^^^^^^ MonitorState.operations — always [] — BUG
}))
```

`MonitorState.operations` is initialised to `[]` and never populated.
The running-operations array lives in a separate `useState<MonitorOperation[]>` called `operations`.
So `isActive` always resolves to `false`.

## Fix Option A — remove isActive from state entirely (simplest)

Drive `isActive` from the `operations` array directly at the call site:
```ts
// In the hook return:
return {
  operations,
  activities,
  state,
  isActive: operations.some(o => o.status === 'running'),  // derived, not stored
  ...
}
```
Remove `isActive` from `MonitorState` interface and all `setState` calls.

## Fix Option B — merge operations into MonitorState

If `MonitorState.operations` is intentional (for snapshot/serialisation), keep it and update it in sync with `setOperations`. Every `setOperations` call must be paired with a `setState` update that sets `state.operations = newOperations`.

Option A is recommended — simpler, single source of truth, no sync risk.
