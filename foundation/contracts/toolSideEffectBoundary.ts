const CONTROLLED_DISPATCHER = Symbol('controlled-dispatcher');

export function controlledDispatcherToken(): symbol {
  return CONTROLLED_DISPATCHER;
}

export function mayCauseSideEffect(actor: unknown): boolean {
  return actor === CONTROLLED_DISPATCHER;
}
