import path from "node:path";
import dotenv from "dotenv";

// Vitest's `globalSetup` runs in a separate process from the actual test
// workers, so process.env mutations made there never reach here — that's
// why .env.test is loaded again, in a `setupFiles` entry, which DOES run
// inside each worker before its test file's beforeAll (and therefore before
// AppModule's ConfigModule.forRoot({ validate: loadEnv }) runs).
dotenv.config({ path: path.join(__dirname, "../../../../.env.test"), override: true });
