// Reglas de ESLint: las recomendadas más algunas que evitan errores habituales. Uso: npm run lint
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", "src/renderer/js/data/**", "build/**"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2025, sourceType: "module" },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-eval": "error",
    },
  },
  // Proceso principal, scripts y tests: Node.
  { files: ["src/main/**", "scripts/**", "test/**", "eslint.config.js"], languageOptions: { globals: globals.node } },
  // Interfaz: navegador (sandbox, sin Node).
  { files: ["src/renderer/**"], languageOptions: { globals: globals.browser } },
  // Preload: CommonJS con acceso limitado a Node.
  { files: ["src/preload.cjs"], languageOptions: { sourceType: "commonjs", globals: { ...globals.node, ...globals.browser } } },
];
