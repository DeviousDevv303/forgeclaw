# Patches: SystemMonitor + MonitorEventRow

## 1. Restore React.memo on SystemMonitor

```tsx
// SystemMonitor.tsx — wrap in memo
import { memo, useMemo, useState } from 'react'

export const SystemMonitor = memo(function SystemMonitor({ events, isActive = false }: SystemMonitorProps) {
  // ... body unchanged
})
```

## 2. Fix displayEvents window (slice -5 → -20)

```tsx
// current:
const displayEvents = useMemo(() => events.slice(-5), [events])
// fix:
const displayEvents = useMemo(() => events.slice(-20), [events])
```

## 3. Fix MonitorEventRow key stability

Add `id` to `AgentActivityEvent` in `src/types/reasoning.ts`:
```ts
// Add id to every variant:
| { id: string; type: 'tool_call'; ... }
| { id: string; type: 'file_read' | 'file_write'; ... }
// etc.
```

Generate it in `useAgentActivityStream.addEvent`:
```ts
const addEvent = useCallback((event: AgentActivityEvent) => {
  const withId = { ...event, id: `evt-${Date.now()}-${Math.random().toString(36).slice(2,6)}` }
  setEvents(prev => {
    const next = [...prev, withId]
    return next.length > 100 ? next.slice(-100) : next
  })
}, [])
```

Then key on `event.id`:
```tsx
{displayEvents.map(event => (
  <MonitorEventRow key={event.id} event={event} />
))}
```
