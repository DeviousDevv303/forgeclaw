export type RunStatus = 'active' | 'stopped';

export type Run = {
  runId: string;
  status: RunStatus;
};

export type RunEvent = {
  eventId: string;
  runId: string;
};

export class EventOrdering {
  private readonly runs = new Map<string, RunStatus>();
  private readonly appliedEvents = new Map<string, string[]>();

  startRun(runId: string): void {
    this.runs.set(runId, 'active');
    this.appliedEvents.set(runId, []);
  }

  stopRun(runId: string): void {
    this.runs.set(runId, 'stopped');
  }

  applyEvent(event: RunEvent): boolean {
    if (this.runs.get(event.runId) !== 'active') {
      return false;
    }
    const events = this.appliedEvents.get(event.runId);
    if (events === undefined) {
      return false;
    }
    events.push(event.eventId);
    return true;
  }

  getAppliedEvents(runId: string): string[] {
    return [...(this.appliedEvents.get(runId) ?? [])];
  }
}
