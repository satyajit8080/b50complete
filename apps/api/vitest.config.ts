import { defineConfig } from "vitest/config";
import { config } from "dotenv";

// Pure-logic unit tests still transitively import modules that read env
// vars at import time (e.g. anything importing lib/logger.ts pulls in
// config/env.ts, which exits the process on missing required vars). Load
// a dummy test env so unit tests never need real infra credentials.
config({ path: ".env.test" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Pure-logic units only this round — anything touching Prisma/Redis/Dhan
    // live connections is excluded; those need integration tests against
    // real infra, not mocks pretending to be the real thing.
  },
});
