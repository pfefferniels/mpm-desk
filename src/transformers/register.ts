import { registerTransformer } from 'mpmify'
import { InsertTempo } from './InsertTempo'

/**
 * Transformers this app adds to mpmify's built-in set.
 *
 * The registry is module-level state, so it has to be populated on *every* thread that
 * reconstructs a chain — the main thread when a work file is opened, and the worker when the
 * pipeline runs. Importing this module is what does that. It used to be a side effect of
 * importing `workImport`, which the worker never touches; the worker therefore carried a
 * hand-written `if/else` over transformer names that drifted out of step with the registry.
 */
registerTransformer(InsertTempo, { after: 'ApproximateLogarithmicTempo' })
