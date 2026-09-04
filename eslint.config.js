// @ts-check
import { fileURLToPath } from "node:url";

import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const gitignorePath = fileURLToPath(new URL(".gitignore", import.meta.url));

export default defineConfig([
  // Substitui o `--ignore-path .gitignore` que o script `lint` usava: o flag
  // nao existe mais no flat config. Mesma fonte de verdade de antes.
  includeIgnoreFile(gitignorePath, "Padroes do .gitignore"),

  // O flat config nao ignora dotfiles por padrao (o eslintrc ignorava), e
  // estes diretorios sao gerados por build/tooling.
  globalIgnores([".react-router/", ".vercel/", ".shopify/", "build/"]),

  // Base para todo JS e TS.
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.es2021,
        // Injetado pelo App Bridge no navegador.
        shopify: "readonly",
      },
    },
  },

  // React e acessibilidade.
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat["jsx-runtime"],
      reactHooks.configs.flat["recommended-latest"],
      jsxA11y.flatConfigs.recommended,
    ],
    settings: {
      react: { version: "detect" },
      formComponents: ["Form"],
      linkComponents: [
        { name: "Link", linkAttribute: "to" },
        { name: "NavLink", linkAttribute: "to" },
      ],
    },
    rules: {
      // Os Polaris web components usam `variant` como atributo.
      "react/no-unknown-property": ["error", { ignore: ["variant"] }],
    },
  },

  // TypeScript e resolucao de import.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      tseslint.configs.recommended,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.typescript,
    ],
    settings: {
      "import/internal-regex": "^~/",
      "import/resolver": {
        node: { extensions: [".ts", ".tsx"] },
        typescript: { alwaysTryTypes: true },
      },
    },
  },

  // Codigo que roda em Node, nao no navegador.
  {
    files: [
      "eslint.config.js",
      "vite.config.{js,ts}",
      "vitest.config.{js,ts}",
      "react-router.config.{js,ts}",
      ".graphqlrc.{js,ts}",
      "**/*.server.{js,ts}",
      "tests/**/*.{js,ts}",
    ],
    languageOptions: { globals: { ...globals.node } },
  },
]);
