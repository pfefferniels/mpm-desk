import { describe, test, expect } from 'vitest';
import {
  registerTransformer,
  createTransformer,
  getTransformerOrder,
  isRegistered,
  clearRegistry,
} from '../../src/fitting/transformers/TransformerRegistry';
import {
  AbstractTransformer,
  type TransformationOptions,
  type Transformer,
} from '../../src/fitting/transformers/Transformer';
import { at, only } from '../support/at';
import * as transformers from '../../src/fitting/transformers/index';
import { buildChain } from '../../src/fitting/chain';
import { parseWorkFile, serializeWorkFile } from '../../src/model/Work';

// Importing Order also registers every built-in transformer, which is what the first describe
// below reads.
import { validate } from '../../src/fitting/transformers/Order';

describe('TransformerRegistry', () => {
  describe('built-in registration', () => {
    test('built-in transformers are pre-registered', () => {
      expect(isRegistered('MakeChoice')).toBe(true);
      expect(isRegistered('InsertTempo')).toBe(true);
      expect(isRegistered('InsertArticulation')).toBe(true);
      expect(isRegistered('InsertPedal')).toBe(true);
      expect(isRegistered('InsertRubato')).toBe(true);
      expect(isRegistered('StylizeOrnamentation')).toBe(true);
      expect(isRegistered('InsertMetadata')).toBe(true);
    });

    /**
     * The registered set, pinned exactly.
     *
     * It used to be a floor (`>= 16`) over espressivo's twenty, and a floor would not notice one
     * going by accident. Seventeen is the number, and changing it is a decision somebody has to
     * come here and make — which is what this test is for, and it has already done its job once.
     *
     * Three of espressivo's twenty are not part of this application: `InsertAsynchrony` and
     * `CompressOrnamentation` are named nowhere in it, and `ApproximateLogarithmicTempo` was
     * superseded by a tempo somebody draws. Three more were dropped and then put back —
     * `CombineAdjacentRubatos`, `StylizeArticulation` and `MakeDefaultArticulation` each have a
     * control in a desk, and retiring one means deleting that control. See `Order.ts`.
     */
    test('the reduction order is exactly the seventeen fitters this build has', () => {
      expect(getTransformerOrder()).toEqual([
        'ProcessVoices',
        'MakeChoice',
        'Modify',
        'InsertDynamicsGradient',
        'InsertTemporalSpread',
        'InsertTempo',
        'TranslatePhysicalTimeToTicks',
        'StylizeOrnamentation',
        'InsertRubato',
        'CombineAdjacentRubatos',
        'InsertDynamicsInstructions',
        'InsertMetricalAccentuation',
        'MergeMetricalAccentuations',
        'InsertArticulation',
        'StylizeArticulation',
        'MakeDefaultArticulation',
        'InsertPedal',
        'InsertMetadata',
      ]);
    });

    /**
     * The three ordering facts the chain is actually built on, read off that list.
     *
     * Written as relations rather than indices so they survive a fitter being inserted between
     * them, which the exact list above deliberately does not.
     */
    test('the order puts each fitter after what it reads', () => {
      const order = getTransformerOrder();
      // `MakeChoice` edits the observations, so it has to precede everything that reads them.
      expect(order.indexOf('MakeChoice')).toBeLessThan(order.indexOf('InsertTempo'));
      // The tempo has to be in the document before physical time can be converted against it.
      expect(order.indexOf('InsertTempo')).toBeLessThan(
        order.indexOf('TranslatePhysicalTimeToTicks'),
      );
      // Everything that works in ticks comes after that conversion.
      for (const name of ['InsertRubato', 'InsertArticulation', 'InsertPedal'])
        expect(order.indexOf('TranslatePhysicalTimeToTicks')).toBeLessThan(order.indexOf(name));
    });

    /**
     * Every transformer the module exports is registered — the generalized form of issue #31.
     *
     * That issue was two exported transformers nobody had registered: `createTransformer`
     * answered null for them, so a saved work file naming one lost it on import, and
     * `compareTransformers` ranked the name last, which is where an unknown one goes. Both are
     * gone now, so naming them here would test nothing. Reading the barrel instead catches the
     * next one — including the mirror-image mistake this move could have made, a transformer
     * dropped from `Order.ts` but left exported.
     */
    test('every transformer the module exports is registered', () => {
      // `Object.values<unknown>` rather than plain `Object.values`: the barrel exports helper
      // functions beside the transformer classes, so the inferred element type is a union of all
      // of them, and a predicate narrowing to a constructor is not assignable to that. Widening
      // to `unknown` first is what lets the predicate do its job without an assertion.
      const exported = Object.values<unknown>(transformers).filter(
        (value): value is new () => Transformer =>
          typeof value === 'function' && value.prototype instanceof AbstractTransformer,
      );
      expect(exported.length).toBe(17);
      for (const constructor of exported) {
        const name = new constructor().name;
        expect(isRegistered(name), `${name} is exported but not registered`).toBe(true);
        expect(createTransformer(name)?.name).toBe(name);
      }
    });
  });

  describe('createTransformer', () => {
    test('creates a known transformer', () => {
      const t = createTransformer('InsertRubato');
      expect(t).not.toBeNull();
      expect(t!.name).toBe('InsertRubato');
    });

    test('returns null for unknown name', () => {
      expect(createTransformer('NonExistentTransformer')).toBeNull();
    });
  });

  describe('roundtrip through the work file', () => {
    test('a call survives being written down and read back', () => {
      // A work file records a call as its id, its name and its options, and `buildChain`
      // rebuilds it through the registry — so the roundtrip holds exactly as long as the name
      // is registered under the spelling the file uses.
      const transformer = createTransformer('InsertRubato')!;
      transformer.options = { scope: 'global', date: 0, length: 720 };

      const json = serializeWorkFile({
        name: 'test',
        mei: 'test.mei',
        mpm: 'test.mpm',
        provenance: [
          // Spread rather than passed through: a `Call`'s options are `Record<string, unknown>`
          // — what a work file can hold — and a transformer's own `TransformationOptions` has no
          // index signature, so it takes a fresh object literal to cross that boundary.
          { id: transformer.id, name: transformer.name, options: { ...transformer.options } },
        ],
        segments: [],
      });
      const { transformers: chain, unknown } = buildChain(parseWorkFile(json).provenance);

      expect(unknown).toEqual([]);
      // `buildChain` always adds two calls of its own — an `InsertMetadata`, because an MPM needs
      // a `<metadata>` whether or not the chain says so, and a `TranslatePhysicalTimeToTicks`,
      // because nothing downstream of the hinge may depend on somebody having asked for it. They
      // sort to the two ends of what is left, being last and near-first in reduction order.
      expect(chain.map((t) => t.name)).toEqual([
        'TranslatePhysicalTimeToTicks',
        'InsertRubato',
        'InsertMetadata',
      ]);
      expect(at(chain, 1, 'transformer').id).toBe(transformer.id);
      expect(at(chain, 1, 'transformer').options).toEqual(transformer.options);
    });
  });

  describe('renames', () => {
    test('a retired name still builds the transformer that replaced it', () => {
      const transformer = createTransformer('TranslatePhyiscalTimeToTicks');
      expect(transformer).not.toBeNull();
      // The instance carries the *current* name, so an old work file loads into a
      // chain that orders and validates like any other.
      expect(transformer!.name).toBe('TranslatePhysicalTimeToTicks');
    });

    test('the retired name is not itself registered', () => {
      expect(isRegistered('TranslatePhyiscalTimeToTicks')).toBe(false);
      expect(isRegistered('TranslatePhysicalTimeToTicks')).toBe(true);
    });
  });

  describe('custom transformer registration (isolated)', () => {
    test('register with after positioning', () => {
      clearRegistry();

      class Alpha extends AbstractTransformer<TransformationOptions> {
        name = 'Alpha';
        requires = [];
        constructor() {
          super({});
        }
        protected transform() {
          /* no-op */
        }
      }
      class Beta extends AbstractTransformer<TransformationOptions> {
        name = 'Beta';
        requires = [];
        constructor() {
          super({});
        }
        protected transform() {
          /* no-op */
        }
      }
      class Custom extends AbstractTransformer<TransformationOptions> {
        name = 'Custom';
        requires = [];
        constructor() {
          super({});
        }
        protected transform() {
          /* no-op */
        }
      }

      registerTransformer(Alpha);
      registerTransformer(Beta);
      registerTransformer(Custom, { after: 'Alpha' });

      const order = getTransformerOrder();
      expect(order).toEqual(['Alpha', 'Custom', 'Beta']);
    });

    test('register with before positioning', () => {
      clearRegistry();

      class Alpha extends AbstractTransformer<TransformationOptions> {
        name = 'Alpha';
        requires = [];
        constructor() {
          super({});
        }
        protected transform() {
          /* no-op */
        }
      }
      class Beta extends AbstractTransformer<TransformationOptions> {
        name = 'Beta';
        requires = [];
        constructor() {
          super({});
        }
        protected transform() {
          /* no-op */
        }
      }
      class Custom extends AbstractTransformer<TransformationOptions> {
        name = 'Custom';
        requires = [];
        constructor() {
          super({});
        }
        protected transform() {
          /* no-op */
        }
      }

      registerTransformer(Alpha);
      registerTransformer(Beta);
      registerTransformer(Custom, { before: 'Beta' });

      const order = getTransformerOrder();
      expect(order).toEqual(['Alpha', 'Custom', 'Beta']);
    });

    test('re-registration of same name is idempotent', () => {
      clearRegistry();

      class Alpha extends AbstractTransformer<TransformationOptions> {
        name = 'Alpha';
        requires = [];
        constructor() {
          super({});
        }
        protected transform() {
          /* no-op */
        }
      }

      registerTransformer(Alpha);
      registerTransformer(Alpha);

      expect(getTransformerOrder()).toEqual(['Alpha']);
    });

    test('throws on unknown anchor name', () => {
      clearRegistry();

      class Custom extends AbstractTransformer<TransformationOptions> {
        name = 'Custom';
        requires = [];
        constructor() {
          super({});
        }
        protected transform() {
          /* no-op */
        }
      }

      expect(() => {
        registerTransformer(Custom, { after: 'DoesNotExist' });
      }).toThrow('anchor not found in order');
    });
  });

  // `validate` is the registry read from the other end: what a chain has to look like for the
  // pipeline to be able to order, save and run it. Isolated for the same reason as above.
  describe('validate (isolated)', () => {
    class Alpha extends AbstractTransformer<TransformationOptions> {
      name = 'Alpha';
      requires = [];
      constructor() {
        super({});
      }
      protected transform() {
        /* no-op */
      }
    }
    class NeedsAlpha extends AbstractTransformer<TransformationOptions> {
      name = 'NeedsAlpha';
      requires = [Alpha];
      constructor() {
        super({});
      }
      protected transform() {
        /* no-op */
      }
    }

    test('an unregistered name is reported, with its position in the chain', () => {
      clearRegistry();
      registerTransformer(Alpha);

      class Stranger extends AbstractTransformer<TransformationOptions> {
        name = 'Stranger';
        requires = [];
        constructor() {
          super({});
        }
        protected transform() {
          /* no-op */
        }
      }

      // Unregistered, so `buildChain` reports it as `unknown` and drops it from the chain,
      // which would then run without it. That silence is what `validate` breaks.
      const messages = validate([new Alpha(), new Stranger()]);
      expect(messages).toHaveLength(1);
      expect(only(messages, 'message').index).toBe(1);
      expect(only(messages, 'message').message).toContain('Stranger');
    });

    test('a requirement is reported only when the chain does not already satisfy it', () => {
      clearRegistry();
      registerTransformer(Alpha);
      registerTransformer(NeedsAlpha);

      expect(validate([new NeedsAlpha()])).toHaveLength(1);
      expect(validate([new Alpha(), new NeedsAlpha()])).toEqual([]);
    });

    test('a requirement met only later in the chain is still missing', () => {
      clearRegistry();
      registerTransformer(Alpha);
      registerTransformer(NeedsAlpha);

      // `requires` is about what has already run, not about mere presence.
      expect(validate([new NeedsAlpha(), new Alpha()])).toHaveLength(1);
    });
  });
});
