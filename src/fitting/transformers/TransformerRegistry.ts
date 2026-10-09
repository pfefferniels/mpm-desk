import type { Transformer, TransformerConstructor } from './Transformer';

const registry = new Map<string, TransformerConstructor>();
const order: string[] = [];

export interface RegisterOptions {
  after?: string;
  before?: string;
}

/**
 * Register a transformer constructor. Instantiates once to read `.name`.
 * Re-registration of the same name is idempotent.
 */
export function registerTransformer(
  constructor: TransformerConstructor,
  options?: RegisterOptions,
): void {
  const instance = new constructor();
  const name = instance.name;

  if (registry.has(name)) {
    return;
  }

  registry.set(name, constructor);

  if (options?.after) {
    const anchorIndex = order.indexOf(options.after);
    if (anchorIndex === -1) {
      throw new Error(
        `Cannot register "${name}" after "${options.after}": anchor not found in order`,
      );
    }
    order.splice(anchorIndex + 1, 0, name);
  } else if (options?.before) {
    const anchorIndex = order.indexOf(options.before);
    if (anchorIndex === -1) {
      throw new Error(
        `Cannot register "${name}" before "${options.before}": anchor not found in order`,
      );
    }
    order.splice(anchorIndex, 0, name);
  } else {
    order.push(name);
  }
}

/**
 * Create a transformer instance by name.
 * Returns `null` if not registered.
 */
export function createTransformer(name: string): Transformer | null {
  const Constructor = registry.get(name);
  if (!Constructor) {
    return null;
  }
  return new Constructor();
}

/**
 * Returns the current transformer order.
 */
export function getTransformerOrder(): readonly string[] {
  return order;
}

/**
 * Check if a transformer name is registered.
 */
export function isRegistered(name: string): boolean {
  return registry.has(name);
}

/**
 * Clear the registry. Intended for test isolation.
 */
export function clearRegistry(): void {
  registry.clear();
  order.length = 0;
}
