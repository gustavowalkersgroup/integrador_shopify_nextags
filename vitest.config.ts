import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  // `import.meta.dirname`, nao `__dirname`: o projeto e "type": "module" e o
  // vite 8 avisa que `__dirname` nao funciona sob `configLoader: 'native'`,
  // que passa a ser o default num major futuro. Se isso quebrar, o alias `~`
  // deixa de resolver e a suite inteira cai junto.
  resolve: { alias: { "~": path.resolve(import.meta.dirname, "app") } },
});
