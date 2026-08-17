import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // NestJS's constructor-based DI relies on TypeScript's
  // emitDecoratorMetadata (`design:paramtypes`), which esbuild — Vitest's
  // default transform — does not reliably emit. Without this, providers
  // silently resolve as `undefined` at runtime instead of failing to
  // compile. swc's decorator-metadata support matches tsc's, so tests see
  // exactly the same DI wiring as the real `nest build` output.
  plugins: [swc.vite()],
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Integration tests share one real Postgres database; running files in
    // parallel worker processes is fine (each test uses uniquely-generated
    // fixtures), but within a file, tests run sequentially and deliberately
    // do not run test *files* in isolated transactions — the whole point is
    // to exercise real commits, real RLS, and real constraint enforcement.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    globalSetup: ["test/integration/global-setup.ts"],
    setupFiles: ["test/integration/setup-env.ts"],
  },
});
