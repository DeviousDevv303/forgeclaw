import { describe, it, expect } from 'vitest';
import {
  EventOrdering,
  type RunEvent,
} from '../../foundation/runtime/eventOrdering';

describe('event-ordering', () => {
  it('A late event for a stopped run is dropped rather than applied', () => {
    const runtime = new EventOrdering();
    const runId = 'run-1';

    runtime.startRun(runId);

    const activeEvent: RunEvent = {
      eventId: 'event-1',
      runId,
    };

    expect(runtime.applyEvent(activeEvent)).toBe(true);
    expect(runtime.getAppliedEvents(runId)).toEqual(['event-1']);

    runtime.stopRun(runId);

    const lateEvent: RunEvent = {
      eventId: 'event-2',
      runId,
    };

    expect(runtime.applyEvent(lateEvent)).toBe(false);
    expect(runtime.getAppliedEvents(runId)).toEqual(['event-1']);
  });
});
