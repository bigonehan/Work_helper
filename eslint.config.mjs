import { defineConfig } from "eslint/config";
import importPlugin from "eslint-plugin-import";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "dist/**",
      "eslint.config.mjs",
      "node_modules/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      sourceType: "module",
    },
    settings: {
      "import/core-modules": ["bun:test"],
      "import/resolver": {
        node: true,
      },
    },
    rules: {
      "import/default": "error",
      "import/export": "error",
      "import/named": "error",
      "import/namespace": "error",
      "import/no-cycle": "off",
      "import/no-duplicates": "error",
      "import/no-unresolved": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        sourceType: "module",
      },
    },
    settings: {
      "import/core-modules": ["bun:test"],
      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"],
      },
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
        node: true,
      },
    },
    rules: {
      "import/default": "error",
      "import/export": "error",
      "import/named": "error",
      "import/namespace": "error",
      "import/no-cycle": "off",
      "import/no-duplicates": "error",
      "import/no-unresolved": "error",
    },
  },
]);
