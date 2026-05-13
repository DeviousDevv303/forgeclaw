# Patch: App.tsx — two issues

## 1. Re-introduced duplicate browserauto tab (B5)

Line ~352:
```ts
// current — bug re-introduced:
type Tab = 'forgemind' | 'repoagent' | 'failures' | 'orchestrator' | 'browserauto' | 'browserauto'

// fix:
type Tab = 'forgemind' | 'repoagent' | 'failures' | 'orchestrator' | 'browserauto'
```

Also remove the duplicate entry from the TABS array definition.

## 2. useEffect missing dep + double-fire in StrictMode (F8)

```tsx
// current:
useEffect(() => {
  if (import.meta.env.DEV) {
    const mockEvents = collectMockEvents('forgemind')
    for (const event of mockEvents) {
      activityStream.addEvent(event)
    }
  }
}, [])  // missing activityStream.addEvent

// fix — use a ref to hold the stable addEvent function:
const addEventRef = useRef(activityStream.addEvent)
useEffect(() => {
  addEventRef.current = activityStream.addEvent
})

useEffect(() => {
  if (!import.meta.env.DEV) return
  const addEvent = addEventRef.current
  collectMockEvents('forgemind').forEach(addEvent)
}, []) // safe: addEventRef.current is stable
```

Or simpler: just add the dep and let React handle it (loads mock once since `activityStream` identity is stable from its hook):
```tsx
useEffect(() => {
  if (!import.meta.env.DEV) return
  collectMockEvents('forgemind').forEach(activityStream.addEvent)
}, [activityStream.addEvent])
```
