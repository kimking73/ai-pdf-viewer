import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const NODE_BUILTINS = ['fs', 'path', 'child_process', 'os', 'net', 'crypto', 'http', 'https'].flatMap(
  (name) => [name, `node:${name}`],
);

export default tseslint.config(
  { ignores: ['out/', 'release/', 'node_modules/', 'deps.nosync/', 'node_modules */**', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  // 프로세스 경계를 린트로 강제한다. 렌더러는 비신뢰 영역이다.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: '렌더러는 Electron API를 직접 쓰지 않는다. window.api를 쓴다.' },
            ...NODE_BUILTINS.map((name) => ({ name, message: '렌더러에서 Node API를 쓰지 않는다.' })),
          ],
          patterns: [
            { group: ['**/main/**', '**/preload/**'], message: '렌더러는 shared만 가져올 수 있다.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'zod', message: '검증은 메인 프로세스에서 한다. preload는 얇게 유지한다.' },
            ...NODE_BUILTINS.map((name) => ({ name, message: '샌드박스 preload에는 Node API가 없다.' })),
          ],
          patterns: [{ group: ['**/main/**', '**/renderer/**'], message: 'preload는 shared만 가져올 수 있다.' }],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'shared는 어느 프로세스에서도 실행되어야 한다.' },
            ...NODE_BUILTINS.map((name) => ({ name, message: 'shared는 어느 프로세스에서도 실행되어야 한다.' })),
          ],
        },
      ],
    },
  },
);
