export type ProviderRemovalResult = {
  status: 'provider-unavailable';
};

export class ProviderRemovalRuntime {
  constructor(private readonly providers: unknown[] = []) {}

  run(): ProviderRemovalResult {
    if (this.providers.length === 0) {
      return { status: 'provider-unavailable' };
    }
    return { status: 'provider-unavailable' };
  }
}
