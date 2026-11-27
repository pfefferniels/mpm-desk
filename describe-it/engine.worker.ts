/**
 * Engine entry point. Runs as a Web Worker when started as one; loaded with a `<script>` it only
 * exposes `load` and `run` on the `DescribeItEngine` global.
 */
import { load, run, type PieceData, type PlainCall, type RunResult } from './engine';

export { load, run };

type Request =
  | { type: 'load'; requestId: number; piece: PieceData }
  | { type: 'run'; requestId: number; calls: PlainCall[] };

export type Reply =
  | { type: 'loaded'; requestId: number; notes: number; end: number }
  | { type: 'ran'; requestId: number; result: RunResult }
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
      } else {
        scope.postMessage({ type: 'ran', requestId: message.requestId, result: run(message.calls) });
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
