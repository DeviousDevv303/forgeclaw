# Patch: Tailwind dynamic depth class → static map

Applies to: `ReasoningPhase.tsx`, `ReasoningStep.tsx`

## Problem
`className={\`ml-${depth * 4}\`}` produces `ml-0`, `ml-4`, `ml-8`, `ml-12` as dynamic strings.
Tailwind JIT only includes classes present as complete literal strings. These will be missing in production builds.

## Fix

```tsx
// Add near the top of each file:
const DEPTH_MARGIN = ['ml-0', 'ml-4', 'ml-8', 'ml-12'] as const
type DepthMargin = typeof DEPTH_MARGIN[number]

// Usage:
const marginClass: DepthMargin = DEPTH_MARGIN[Math.min(depth, 3)]

// In JSX:
<div className={marginClass}>
```

This ensures Tailwind sees all four classes as string literals and includes them in the production bundle.
