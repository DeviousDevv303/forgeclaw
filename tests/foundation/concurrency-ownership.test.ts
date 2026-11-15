import { describe, it, expect } from 'vitest';
import {
  claimTask,
  releaseTask,
  type TaskOwnership,
} from '../../foundation/runtime/taskOwnership';

describe('concurrency-ownership', () => {
  it('Two runs cannot simultaneously own the same task', () => {
    const firstRun: TaskOwnership = { taskId: 'task-1', runId: 'run-1' };
    const secondRun: TaskOwnership = { taskId: 'task-1', runId: 'run-2' };

    expect(claimTask(firstRun)).toBe(true);
    expect(claimTask(secondRun)).toBe(false);
    expect(claimTask(firstRun)).toBe(true);

    expect(releaseTask(firstRun)).toBe(true);
    expect(claimTask(secondRun)).toBe(true);
  });
});
