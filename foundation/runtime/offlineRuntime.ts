export type OfflineTask<T> = () => T;

export type OfflineTaskResult<T> = {
  status: 'completed';
  value: T;
};

export class OfflineRuntime {
  run<T>(task: OfflineTask<T>): OfflineTaskResult<T> {
    return {
      status: 'completed',
      value: task(),
    };
  }
}
