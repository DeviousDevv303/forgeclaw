export type TransitionStatus = 'pending' | 'committed' | 'aborted';

export type Transition = {
  transitionId: string;
  fromState: string;
  toState: string;
  status: TransitionStatus;
};

export class RecoveryWal {
  private readonly transitions = new Map<string, Transition>();
  private state: string;

  constructor(initialState: string) {
    this.state = initialState;
  }

  beginTransition(
    transitionId: string,
    fromState: string,
    toState: string,
  ): void {
    this.transitions.set(transitionId, {
      transitionId,
      fromState,
      toState,
      status: 'pending',
    });
  }

  commitTransition(transitionId: string): boolean {
    const transition = this.transitions.get(transitionId);
    if (transition === undefined || transition.status !== 'pending') {
      return false;
    }
    this.state = transition.toState;
    transition.status = 'committed';
    return true;
  }

  recover(): void {
    for (const transition of this.transitions.values()) {
      if (transition.status === 'pending') {
        this.state = transition.fromState;
        transition.status = 'aborted';
      }
    }
  }

  getState(): string {
    return this.state;
  }

  getTransition(transitionId: string): Transition | undefined {
    return this.transitions.get(transitionId);
  }
}
