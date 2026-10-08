import path from "node:path";
import { generateD1Migrations } from "pitlane/data-table-d1/migrations";

import { parseWranglerConfig } from "./lib/wrangler-config.ts";

// The output directory comes from wrangler.jsonc's `migrations_dir` so the
// generator and D1's own migration runner can never disagree about where the
// .sql files live.
let { d1 } = parseWranglerConfig();

let generated = await generateD1Migrations({ to: d1.migrationsDir });

console.log(
    `Generated ${generated.length} migration(s) into ${path.relative(".", d1.migrationsDir)}`,
);
for (let migration of generated) {
    console.log(`  ${migration.file}`);
}
