const taskOwners = new Map<string, string>();

export type TaskOwnership = {
  taskId: string;
  runId: string;
};

export function claimTask(task: TaskOwnership): boolean {
  const currentOwner = taskOwners.get(task.taskId);
  if (currentOwner === undefined) {
    taskOwners.set(task.taskId, task.runId);
    return true;
  }
  return currentOwner === task.runId;
}

export function releaseTask(task: TaskOwnership): boolean {
  if (taskOwners.get(task.taskId) !== task.runId) {
    return false;
  }
  taskOwners.delete(task.taskId);
  return true;
}
