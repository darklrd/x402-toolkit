# Work Plan: Enhanced Live Flow Visualizer

## Summary

Replace the current step-pill `FlowVisualizer` with a dev-tools–style panel that shows actual HTTP request/response details as they happen during the demo. The panel renders below the call button, expanding progressively as each step fires.

---

## 1. Current State Analysis

### Existing FlowVisualizer
- Simple horizontal row of 6 pill badges: `Request → 402 → Sign tx → Signed → Retry → 200`
- Each pill transitions through `pending → active → done → error` states
- Receives `FlowStep[]` from `Demo.tsx` — no HTTP detail, just step type + minimal metadata
- The `FlowStep` type already carries useful data: URL, challenge object, signature, status code, response data

### Demo Flow (how it works today)
1. User picks a tool (weather/price) and enters input
2. Clicks "Call {Tool}" button → `handleCall()` fires
3. `x402BrowserFetch(url, payer, onStep)` is called with an `onStep` callback
4. Inside `x402BrowserFetch`:
   - `onStep({ type: 'request', url })` → initial `fetch(url)`
   - If 402: `onStep({ type: '402', challenge })` → `onStep({ type: 'signing' })`
   - Payer signs + sends tx → `onStep({ type: 'signed', signature })`
   - `onStep({ type: 'retry' })` → retry fetch with `x-payment-proof` header
   - `onStep({ type: 'success', status, data })` or `onStep({ type: 'error', message })`
5. Steps accumulate in `localSteps[]`, set into state via `setSteps([...localSteps])`
6. `FlowVisualizer` and `ResultPanel` render from that state

### Key Insight
The `FlowStep` union already carries the raw data (URL, challenge, signature, response data). The current visualizer ignores it. The enhancement is about **rendering** that data in a dev-tools panel — no changes to the fetch flow itself are needed, except enriching steps with HTTP details (headers, status codes, timing).

---

## 2. Design Vision

### What It Looks Like
A collapsible dev-tools panel with a dark theme, appearing below the call button. Each step is a row that expands on click to show HTTP detail.

```
┌──────────────────────────────────────────────────┐
│ 🔍 Flow Inspector                        [▼ Hide]│
├──────────────────────────────────────────────────┤
│ ● 0ms   → GET /weather?city=London              │
│   ├─ Request Headers                             │
│   └─ (click to expand)                           │
│                                                  │
│ ● 142ms ← 402 Payment Required                  │
│   ├─ Response: { x402: { nonce, price, ... } }   │
│   └─ (click to expand)                           │
│                                                  │
│ ● 145ms ⚡ Signing transaction...                │
│   └─ (active spinner)                            │
│                                                  │
│ ● 2.1s  ✍ Transaction signed                    │
│   └─ sig: 3xK7...mP9f                           │
│                                                  │
│ ● 2.1s  → GET /weather?city=London               │
│   ├─ x-payment-proof: eyJ2ZXJz...               │
│   └─ (click to expand)                           │
│                                                  │
│ ● 2.4s  ✅ 200 OK                                │
│   └─ { "weather": "sunny", "temp": 18 }         │
└──────────────────────────────────────────────────┘
```

### Visual Rules
- **Background**: `bg-slate-950 border border-slate-800` — darker than surrounding Demo section
- **Font**: `font-mono text-xs` for all HTTP details
- **Each step row**: left border color-coded by type, timestamp on left, expandable
- **Color coding**:
  - Request (outgoing): `text-accent-400 border-l-accent-500` (indigo)
  - 402 challenge: `text-amber-400 border-l-amber-500`
  - Signing/Signed: `text-orange-400 border-l-orange-500`
  - Retry: `text-accent-400 border-l-accent-500` (same as request)
  - Success: `text-green-400 border-l-green-500`
  - Error: `text-red-400 border-l-red-500`
- **Active step**: has a pulsing dot (`animate-pulse`) instead of solid dot
- **Collapsed by default**: header row + current/last step summary visible; click "expand" to see all
- **Mobile**: full-width, same layout, scrollable overflow on long content

### Animation/Timing
- New steps slide in with a simple height transition (CSS `transition-all duration-300`)
- Active step dot pulses
- Timestamps relative to first step (e.g., "0ms", "142ms", "2.1s")
- No spring animations or complex transitions — keep it snappy

---

## 3. Architecture

### Enriched FlowStep Type

The existing `FlowStep` needs enrichment with timing and HTTP details. Create a new wrapper type:

```typescript
// site/src/lib/flow-types.ts

type FlowStepType = 'request' | '402' | 'signing' | 'signed' | 'retry' | 'success' | 'error';

interface FlowStepBase {
  id: number;
  timestampMs: number;
}

interface RequestStep extends FlowStepBase {
  type: 'request';
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface ChallengeStep extends FlowStepBase {
  type: '402';
  status: 402;
  headers: Record<string, string>;
  challenge: {
    version: number;
    nonce: string;
    expiresAt: string;
    requestHash: string;
    price: string;
    recipient: string;
  };
}

interface SigningStep extends FlowStepBase {
  type: 'signing';
}

interface SignedStep extends FlowStepBase {
  type: 'signed';
  signature: string;
}

interface RetryStep extends FlowStepBase {
  type: 'retry';
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface SuccessStep extends FlowStepBase {
  type: 'success';
  status: number;
  data: Record<string, unknown>;
}

interface ErrorStep extends FlowStepBase {
  type: 'error';
  message: string;
}

type EnrichedFlowStep =
  | RequestStep
  | ChallengeStep
  | SigningStep
  | SignedStep
  | RetryStep
  | SuccessStep
  | ErrorStep;
```

### State Management

No new state management library. The pattern stays the same as today — `Demo.tsx` owns the steps array. The change:

1. `x402BrowserFetch` emits the existing `FlowStep` (no change to its signature)
2. `Demo.tsx`'s `onStep` callback wraps each `FlowStep` into an `EnrichedFlowStep` by adding `id` (counter) and `timestampMs` (relative to start), plus HTTP details where applicable
3. The enriched steps array is passed to the new `FlowInspector` component

```typescript
// Inside Demo.tsx handleCall():
let stepId = 0;
const startTime = performance.now();

const onStep = (step: FlowStep) => {
  const enriched = enrichFlowStep(step, stepId++, startTime, url, proofHeader);
  localSteps.push(enriched);
  setSteps([...localSteps]);
  // ... existing result/signature extraction
};
```

The `enrichFlowStep` function lives in `site/src/lib/flow-types.ts` and maps `FlowStep` → `EnrichedFlowStep`, adding the metadata.

### Component Tree

```
Demo
├── ToolPicker
├── FaucetLink
├── <button> (call)
├── FlowInspector        ← NEW (replaces FlowVisualizer)
│   ├── FlowStepRow      ← NEW (one per step)
│   │   └── StepDetail   ← NEW (expandable HTTP detail)
│   └── (step progress bar at top)
└── ResultPanel
```

`FlowVisualizer` is replaced entirely. Its simple pill row becomes the progress bar inside `FlowInspector`.

---

## 4. Files to Create/Modify

### New Files

#### `site/src/lib/flow-types.ts`
- `EnrichedFlowStep` union type (as above)
- `FlowStepType` type alias
- `enrichFlowStep(step: FlowStep, id: number, startTime: number, url: string, proofHeader: string | null): EnrichedFlowStep` — pure function
- `formatTimestamp(ms: number): string` — formats relative ms as "0ms", "142ms", "1.2s", "2.1s"
- `stepColor(type: FlowStepType): { text: string; border: string; bg: string }` — returns Tailwind class strings
- `stepIcon(type: FlowStepType): string` — returns the icon character
- `stepLabel(type: FlowStepType): string` — returns human label

#### `site/src/components/FlowInspector.tsx`
Main container component:

```typescript
interface FlowInspectorProps {
  steps: EnrichedFlowStep[];
}
```

- Renders nothing when `steps.length === 0`
- Header bar: "🔍 Flow Inspector" + toggle collapse button
- Progress bar: thin horizontal bar showing which step types have been reached (reuse the pill concept but as a compact bar)
- List of `FlowStepRow` components
- Collapsed state stored in local `useState<boolean>` — defaults to expanded

#### `site/src/components/FlowStepRow.tsx`
Individual step row:

```typescript
interface FlowStepRowProps {
  step: EnrichedFlowStep;
  isActive: boolean;
  isLast: boolean;
}
```

- Left gutter: colored dot (pulsing if active) + vertical connector line
- Timestamp badge
- Step type icon + label
- One-line summary (URL for requests, status for responses, sig truncated for signed)
- Click to expand → shows `StepDetail`
- Expanded state: local `useState<boolean>`, defaults to collapsed except the last step

#### `site/src/components/StepDetail.tsx`
Expandable detail panel for a single step:

```typescript
interface StepDetailProps {
  step: EnrichedFlowStep;
}
```

Renders based on step type:
- **request/retry**: Method, URL, headers table (key-value rows)
- **402**: Status line, challenge JSON formatted
- **signing**: "Awaiting wallet signature..."
- **signed**: Full signature string (copyable), link to explorer
- **success**: Status line, JSON body (truncated to 20 lines, expandable)
- **error**: Error message in red

### Modified Files

#### `site/src/components/Demo.tsx`
Changes:
1. Import `EnrichedFlowStep` and `enrichFlowStep` from `../lib/flow-types` instead of `FlowStep`
2. Change state: `const [steps, setSteps] = useState<EnrichedFlowStep[]>([]);`
3. In `handleCall`, build enriched steps via the `enrichFlowStep` helper
4. Track `proofHeaderRef` with `useRef<string | null>(null)` so the retry step can include the header
5. Replace `<FlowVisualizer steps={steps} />` with `<FlowInspector steps={steps} />`
6. Keep `ResultPanel` as-is (it still gets `data`, `error`, `signature`, `durationMs`)

#### `site/src/lib/x402-browser-fetch.ts`
**No changes.** The existing `FlowStep` type and `x402BrowserFetch` function remain untouched. The enrichment happens in Demo.tsx's callback. This keeps the fetch lib clean and decoupled.

However, re-export the `FlowStep` type from this file as before so nothing breaks.

#### `site/src/components/FlowVisualizer.tsx`
**Delete this file.** Its functionality is subsumed by `FlowInspector`.

---

## 5. Detailed Type Signatures

```typescript
// site/src/lib/flow-types.ts

interface FlowStepBase {
  id: number;
  timestampMs: number;
}

interface RequestStep extends FlowStepBase {
  type: 'request';
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface ChallengeStep extends FlowStepBase {
  type: '402';
  status: 402;
  headers: Record<string, string>;
  challenge: {
    version: number;
    nonce: string;
    expiresAt: string;
    requestHash: string;
    price: string;
    recipient: string;
  };
}

interface SigningStep extends FlowStepBase {
  type: 'signing';
}

interface SignedStep extends FlowStepBase {
  type: 'signed';
  signature: string;
}

interface RetryStep extends FlowStepBase {
  type: 'retry';
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface SuccessStep extends FlowStepBase {
  type: 'success';
  status: number;
  data: Record<string, unknown>;
}

interface ErrorStep extends FlowStepBase {
  type: 'error';
  message: string;
}

type EnrichedFlowStep =
  | RequestStep
  | ChallengeStep
  | SigningStep
  | SignedStep
  | RetryStep
  | SuccessStep
  | ErrorStep;

type FlowStepType = EnrichedFlowStep['type'];

function enrichFlowStep(
  step: FlowStep,
  id: number,
  startTime: number,
  url: string,
  proofHeader: string | null,
): EnrichedFlowStep;

function formatTimestamp(ms: number): string;

function stepColor(type: FlowStepType): { text: string; border: string; bg: string };

function stepIcon(type: FlowStepType): string;

function stepLabel(type: FlowStepType): string;
```

---

## 6. Styling Specification

### Container
```
rounded-lg border border-slate-800 bg-slate-950 overflow-hidden
```

### Header Bar
```
flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50
```
- Left: `🔍` + "Flow Inspector" in `text-sm font-semibold text-slate-300`
- Right: collapse/expand chevron button `text-slate-500 hover:text-slate-300`

### Progress Bar (compact pills at top)
```
flex gap-1 px-4 py-2 border-b border-slate-800/50
```
Each pill: `px-2 py-0.5 rounded text-[10px] font-mono font-medium` with status-based coloring:
- Pending: `bg-slate-800 text-slate-600`
- Active: `bg-accent-900 text-accent-400 animate-pulse`
- Done: `bg-green-950 text-green-500`
- Error: `bg-red-950 text-red-400`

### Step Row
```
px-4 py-3 border-b border-slate-800/30 last:border-b-0 cursor-pointer
hover:bg-slate-900/50 transition-colors
```

Left gutter (timeline):
- Dot: `w-2.5 h-2.5 rounded-full` with step color
- Active dot: add `animate-pulse ring-2 ring-{color}/30`
- Vertical line connecting dots: `w-px bg-slate-800` (absolute positioned)

Timestamp: `text-[10px] font-mono text-slate-600 w-12 text-right`

Summary line: `text-xs font-mono` with step-specific color

### Step Detail (expanded)
```
mt-2 ml-8 rounded bg-slate-900/80 border border-slate-800/50 p-3 font-mono text-xs
```

Headers table:
```
grid grid-cols-[auto_1fr] gap-x-3 gap-y-1
```
- Key: `text-slate-500`
- Value: `text-slate-300 break-all`

JSON body:
```
overflow-x-auto whitespace-pre text-slate-300 leading-relaxed max-h-48 overflow-y-auto
```

### Color Map
| Step Type | Text | Border-left | Dot |
|-----------|------|------------|-----|
| request | `text-accent-400` | `border-l-accent-500` | `bg-accent-500` |
| 402 | `text-amber-400` | `border-l-amber-500` | `bg-amber-500` |
| signing | `text-orange-400` | `border-l-orange-500` | `bg-orange-500` |
| signed | `text-orange-400` | `border-l-orange-500` | `bg-orange-500` |
| retry | `text-accent-400` | `border-l-accent-500` | `bg-accent-500` |
| success | `text-green-400` | `border-l-green-500` | `bg-green-500` |
| error | `text-red-400` | `border-l-red-500` | `bg-red-500` |

### Mobile
- Same layout — it's already a vertical list
- Headers/JSON blocks get `overflow-x-auto` for horizontal scroll
- Progress pills wrap with `flex-wrap`
- No special breakpoints needed beyond the existing `sm:` pattern

---

## 7. Test Coverage

All tests go in `tests/unit/` following the existing pattern. Use Vitest + @testing-library/react.

### `tests/unit/flow-types.test.ts`

| # | Test Case | What It Verifies |
|---|-----------|-----------------|
| 1 | `enrichFlowStep` converts request step | Adds id, timestampMs, method, headers, url |
| 2 | `enrichFlowStep` converts 402 step | Adds status: 402, headers, challenge data |
| 3 | `enrichFlowStep` converts signing step | Minimal enrichment (id + timestamp) |
| 4 | `enrichFlowStep` converts signed step | Includes signature |
| 5 | `enrichFlowStep` converts retry step | Includes url, method, headers with x-payment-proof |
| 6 | `enrichFlowStep` converts success step | Includes status, data |
| 7 | `enrichFlowStep` converts error step | Includes message |
| 8 | `formatTimestamp` returns "0ms" for 0 | Edge case |
| 9 | `formatTimestamp` returns "142ms" for <1000 | Millisecond range |
| 10 | `formatTimestamp` returns "1.2s" for ≥1000 | Second range with decimal |
| 11 | `stepColor` returns correct classes for each type | All 7 types mapped |
| 12 | `stepIcon` returns correct icon for each type | All 7 types mapped |
| 13 | `stepLabel` returns correct label for each type | All 7 types mapped |

### `tests/unit/flow-inspector.test.ts`

| # | Test Case | What It Verifies |
|---|-----------|-----------------|
| 1 | Renders nothing when steps is empty | No DOM output |
| 2 | Renders header with "Flow Inspector" text | Header present |
| 3 | Renders progress pills for all step types | 6 pills present |
| 4 | Shows request step with URL | URL text visible |
| 5 | Shows 402 step with "Payment Required" | Label correct |
| 6 | Shows signing step with active pulse | Has animate-pulse class |
| 7 | Shows signed step with truncated signature | Sig visible |
| 8 | Shows retry step with proof header mention | Header shown |
| 9 | Shows success step with status code | "200 OK" visible |
| 10 | Shows error step with red styling | Error message + red class |
| 11 | Collapse button hides step list | Steps hidden after click |
| 12 | Expand button shows step list | Steps visible after click |
| 13 | Clicking a step row expands detail | Detail panel appears |
| 14 | Clicking expanded step row collapses it | Detail panel disappears |
| 15 | Last step auto-expands | Detail visible without click |
| 16 | Timestamps display correctly | Relative timestamps shown |
| 17 | Multiple steps render in order | DOM order matches step order |
| 18 | Progress pills update status as steps arrive | Correct classes per state |

### `tests/unit/flow-step-row.test.ts`

| # | Test Case | What It Verifies |
|---|-----------|-----------------|
| 1 | Renders timestamp | Timestamp text visible |
| 2 | Renders step icon | Correct icon for type |
| 3 | Renders summary text | URL/status/sig visible |
| 4 | Active step has pulse animation | Class applied |
| 5 | Inactive step has static dot | No pulse class |
| 6 | Click toggles detail expansion | Detail appears/disappears |

### `tests/unit/step-detail.test.ts`

| # | Test Case | What It Verifies |
|---|-----------|-----------------|
| 1 | Request detail shows method + URL | Both visible |
| 2 | Request detail renders headers table | Key-value pairs |
| 3 | 402 detail shows challenge JSON | Formatted JSON |
| 4 | Signed detail shows full signature | Sig + explorer link |
| 5 | Success detail shows response JSON | Pretty-printed body |
| 6 | Error detail shows message in red | Red text |
| 7 | Long JSON is scrollable | max-h class present |

**Total new tests: ~40**

### Existing Tests
- The 157 existing tests must pass unchanged
- `tests/unit/architecture-flow.test.ts` is unaffected (different component)
- No existing test imports `FlowVisualizer` directly (it's only used inside Demo)

---

## 8. Implementation Order

1. **Create `site/src/lib/flow-types.ts`** — types + pure functions. Write `tests/unit/flow-types.test.ts`. Run tests.

2. **Create `site/src/components/StepDetail.tsx`** — leaf component, no dependencies on other new files. Write `tests/unit/step-detail.test.ts`.

3. **Create `site/src/components/FlowStepRow.tsx`** — uses StepDetail. Write `tests/unit/flow-step-row.test.ts`.

4. **Create `site/src/components/FlowInspector.tsx`** — composes FlowStepRow + progress bar. Write `tests/unit/flow-inspector.test.ts`.

5. **Modify `site/src/components/Demo.tsx`** — swap FlowVisualizer → FlowInspector, add enrichment logic.

6. **Delete `site/src/components/FlowVisualizer.tsx`**.

7. **Run full test suite** — verify all 157 + ~40 new tests pass.

---

## 9. Constraints Checklist

- [x] No `any` or `unknown` types — all types are explicit unions and interfaces
- [x] No unnecessary comments or JSDoc — types are self-documenting
- [x] Zero new dependencies — Tailwind classes only, React built-ins only
- [x] Must not break existing 157 tests — FlowVisualizer is only imported by Demo, not tested directly
- [x] Mobile responsive — vertical list layout works on all sizes, overflow-x-auto for wide content
- [x] React + Tailwind + Vite — no build config changes needed

---

## 10. Risk Notes

1. **`Demo.tsx` uses `Record<string, unknown>` for result data** — this is the existing pattern from `x402-browser-fetch.ts`. The new types maintain this; no `unknown` added by us.

2. **Amber color classes** (`text-amber-400`, `bg-amber-500`, etc.) are part of Tailwind's default palette — no config change needed. The existing tailwind config only extends with `accent` colors.

3. **The `FlowStep` type from `x402-browser-fetch.ts` stays unchanged** — the enrichment is a mapping layer in Demo.tsx, keeping the fetch library decoupled.

4. **The `proofHeader` value for retry step detail** — currently computed inside `x402BrowserFetch` and not exposed. The enrichment function in Demo.tsx will reconstruct it from the signed step's data (nonce, requestHash, payer, etc.) or accept it as a parameter. The simplest approach: after `onStep({ type: 'signed' })` fires, Demo.tsx computes the proof header and stores it in a ref for the retry step enrichment.
