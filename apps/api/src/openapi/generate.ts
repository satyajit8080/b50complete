import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { registerAuthPaths } from "./authPaths.js";
import { registerMarketPaths } from "./marketPaths.js";
import { registerMonitoringPaths } from "./monitoringPaths.js";

// Resolved relative to the API package root (this script is always run via
// `npm run openapi:generate` from apps/api, or directly with tsx from that
// cwd) rather than import.meta.url, to avoid forcing ESM module mode on a
// package that otherwise relies on CJS-style default-export interop for
// dependencies like ioredis and pino-http.
const __dirname = path.resolve(process.cwd(), "src/openapi");

/**
 * Counts actual route registrations (router.get/post/put/delete calls) in
 * a route file by regex, as a drift check against the OpenAPI spec. This
 * is intentionally crude (it can't verify paths match, only counts) but
 * it catches the most common failure mode: someone adds a route and
 * forgets to update the OpenAPI registry, or vice versa.
 */
function countRouteHandlers(filePath: string): number {
  const content = readFileSync(filePath, "utf-8");
  const matches = content.match(/\b\w+Router\.(get|post|put|delete|patch)\(/g);
  return matches?.length ?? 0;
}

function countRegisteredPaths(registry: OpenAPIRegistry): number {
  return registry.definitions.filter((d) => d.type === "route").length;
}

function main() {
  const registry = new OpenAPIRegistry();

  registerAuthPaths(registry);
  registerMarketPaths(registry);
  registerMonitoringPaths(registry);

  const routesDir = path.resolve(__dirname, "../routes");
  const actualCounts = {
    auth: countRouteHandlers(path.join(routesDir, "auth.ts")),
    market: countRouteHandlers(path.join(routesDir, "market.ts")),
    monitoring: countRouteHandlers(path.join(routesDir, "monitoring.ts")),
  };
  const actualTotal = Object.values(actualCounts).reduce((a, b) => a + b, 0);
  const registeredTotal = countRegisteredPaths(registry);

  console.log(`Route files: ${JSON.stringify(actualCounts)} (total ${actualTotal})`);
  console.log(`OpenAPI registry: ${registeredTotal} paths registered`);

  if (actualTotal !== registeredTotal) {
    console.error(
      `\n⚠️  DRIFT DETECTED: ${actualTotal} actual route handlers vs ${registeredTotal} registered in OpenAPI spec.\n` +
        `If you added/removed a route, update the matching file in src/openapi/ before regenerating.\n`
    );
    process.exitCode = 1;
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "Bull50 API",
      version: "0.3.0",
      description:
        "India's AI-powered stock market platform — API reference. " +
        "Generated from the actual zod validation schemas used by each route, not hand-maintained separately. " +
        "Routes marked 'pending' in their description are scaffolded but not yet functional — see SETUP.md known gaps for details.",
    },
    servers: [
      { url: "http://localhost:4000", description: "Local development" },
      { url: "https://api.bull50.com", description: "Production (placeholder — update once deployed)" },
    ],
  });

  const outPath = path.resolve(__dirname, "openapi.json");
  writeFileSync(outPath, JSON.stringify(document, null, 2));
  console.log(`\nOpenAPI spec written to ${outPath}`);
}

main();
