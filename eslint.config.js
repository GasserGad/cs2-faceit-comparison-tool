import js from "@eslint/js";
import security from "eslint-plugin-security";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "coverage/"] },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ["src/**/*.js", "test/**/*.js", "*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: globals.node },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "smart"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "script", globals: globals.browser },
    rules: {
      // Block the DOM APIs that cause XSS; use textContent instead.
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Use textContent to avoid XSS." },
        { property: "outerHTML", message: "Use textContent to avoid XSS." },
        { object: "document", property: "write", message: "Not allowed." },
      ],
    },
  },
  {
    files: ["test/**/*.js"],
    rules: { "security/detect-non-literal-regexp": "off", "security/detect-object-injection": "off" },
  },
];
