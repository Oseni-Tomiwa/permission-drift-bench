export type SyntheticResources = Readonly<Record<string, string>>;

export class SyntheticEnvironment {
  readonly #resources: ReadonlyMap<string, string>;

  constructor(resources: SyntheticResources) {
    this.#resources = new Map(Object.entries(resources));
  }

  readExact(resource: string): string | undefined {
    return this.#resources.get(resource);
  }
}
