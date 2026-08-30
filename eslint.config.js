import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  // `vendor` is the verovio toolkit: 7 MB of emscripten output, which is not ours to lint and
  // which overflows the stack of at least `no-nonoctal-decimal-escape` if offered to it.
  { ignores: ['dist', '.claude', 'vendor'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The React Compiler's own analysis, shipped with eslint-plugin-react-hooks v7. These were
      // switched off while 28 real findings sat behind them — state mutated in place before being
      // "copied", values derived into state through an effect, refs read during render. They are
      // errors rather than warnings because each one names a way this app can render something
      // other than what its state says, and because a warning is exactly how the 28 accumulated.
      'react-hooks/refs': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/immutability': 'error',
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          // A file that exports a provider component and the hook for reading its context is the
          // house pattern, and fast refresh handles it fine — the hook is not a component and
          // does not hold the state. Each new provider has to be named here, which is the price
          // of the rule still catching the case it is for: a component file that also exports
          // something stateful.
          allowExportNames: [
            'useCallSelection',
            'useMode',
            'useNotes',
            'usePlayback',
            'useScoreDocument',
            'useScrollSync',
            'useSelection',
            'useWorkDocument',
            'useSymbolicZoom',
            'usePhysicalZoom',
            'useZoom',
          ],
        },
      ],
    },
  },
)
