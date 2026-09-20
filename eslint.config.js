// ESLint (flat config). Scopul: prinde greselile care au produs deja buguri in
// acest proiect (dependente gresite la hook-uri => valori invechite / salvari
// ratate, variabile nefolosite, cod de debug ramas) - nu reguli de stil (pentru
// stil exista Prettier).
const js = require('@eslint/js')
const globals = require('globals')
const react = require('eslint-plugin-react')
const reactHooks = require('eslint-plugin-react-hooks')

module.exports = [
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'date/**', 'keys/**', 'tests/e2e/last-report.json'] },
  js.configs.recommended,
  {
    files: ['src/main/**/*.js', 'src/preload/**/*.js', 'src/shared/**/*.js', 'electron.vite.config.js', 'vitest.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },
  {
    files: ['src/renderer/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser }
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/no-unescaped-entities': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_|^React$', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // ambele sunt reguli noi ("compilatorului React"), prea stricte pentru codul existent
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/static-components': 'off'
    }
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } }
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { 'no-console': 'off', 'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }] }
  },
  {
    files: ['tests/**/*.{js,mjs}'],
    // e2e trimite functii in pagina (page.evaluate) - de aceea si globalurile browserului
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
]
