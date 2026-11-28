/**
 * Engine entry point. Runs as a Web Worker when started as one; loaded with a `<script>` it only
 * exposes `load`, `run` and `bringOut` on the `DescribeItEngine` global.
 */
import { bringOut, load, run, type BroughtOut, type PieceData, type PlainCall, type RunResult } from './engine';

export { bringOut, load, run };

type Request =
  | { type: 'load'; requestId: number; piece: PieceData }
  | { type: 'run'; requestId: number; calls: PlainCall[] }
  | { type: 'bringOut'; requestId: number; mpm: string; ids: string[]; factor: number; attenuation: number };

export type Reply =
  | { type: 'loaded'; requestId: number; notes: number; end: number }
  | { type: 'ran'; requestId: number; result: RunResult }
  | { type: 'broughtOut'; requestId: number; result: BroughtOut }
  | { type: 'error'; requestId: number; message: string };

const scope = globalThis as unknown as {
  document?: unknown;
  postMessage(reply: Reply): void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
};

if (scope.document === undefined && typeof scope.postMessage === 'function') {
  scope.onmessage = (event) => {
    const message = event.data;
    try {
      if (message.type === 'load') {
        scope.postMessage({ type: 'loaded', requestId: message.requestId, ...load(message.piece) });
      } else if (message.type === 'run') {
        scope.postMessage({ type: 'ran', requestId: message.requestId, result: run(message.calls) });
      } else {
        const { mpm, ids, factor, attenuation } = message;
        const result = bringOut(mpm, ids, factor, attenuation);
        scope.postMessage({ type: 'broughtOut', requestId: message.requestId, result });
      }
    } catch (thrown) {
      scope.postMessage({
        type: 'error',
        requestId: message.requestId,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      });
    }
  };
}
