import { defineConfig } from "vitest/config";

// Os testes dividem o Neo4j de teste e o apagam inteiro: um arquivo por vez.
export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
