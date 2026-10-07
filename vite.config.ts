import { cloudflare } from "@cloudflare/vite-plugin";
import { remix } from "@pitlane/dev";
import devtoolsJson from "vite-plugin-devtools-json";
import { defineConfig } from "vite-plus";

export default defineConfig({
    plugins: [
        remix({ serverHandler: false }),
        cloudflare({ viteEnvironment: { name: "ssr" } }),
        devtoolsJson(),
    ],
    server: {
        port: 1612,
    },
    css: {
        transformer: "lightningcss",
    },
    run: {
        tasks: {
            dev: {
                dependsOn: ["typegen", "db:seed"],
                command: "vp dev --host",
            },
            "db:seed": {
                dependsOn: ["db:migrations:apply:local"],
                command: "node db/seed.ts",
            },
            "db:reset": {
                command: "rm -rf .wrangler/state/v3/d1",
            },
            "db:migrations:generate": {
                command: "node db/generate-d1-migrations.ts",
                cache: false,
            },
            "db:migrations:apply:local": {
                dependsOn: ["db:migrations:generate"],
                command: "node db/apply-d1-migrations.ts --local",
                cache: false,
            },
            "db:migrations:apply:remote": {
                command: "node db/apply-d1-migrations.ts --remote",
                cache: false,
            },
            "db:migrations:deploy": {
                dependsOn: ["db:migrations:generate"],
                command: "node db/apply-d1-migrations.ts --remote",
                cache: false,
            },
            typegen: {
                cache: { input: ["wrangler.jsonc"] },
                command: "wrangler types",
            },
            typecheck: {
                dependsOn: ["typegen"],
                command: "tsc --noEmit",
                cache: false,
            },
            check: {
                dependsOn: ["typegen"],
                command: "vp check --fix",
                cache: false,
            },
            test: {
                dependsOn: ["typegen", "db:migrations:generate"],
                command: "vitest run",
                cache: false,
            },
            deploy: {
                command: "wrangler deploy",
                cache: false,
            },
        },
    },
    fmt: {
        ignorePatterns: ["**/worker-configuration.d.ts", "dist/**", ".agents/docs/remix/**"],
        printWidth: 100,
        tabWidth: 4,
        arrowParens: "avoid",
        sortPackageJson: true,
        sortImports: {
            groups: [
                "type-import",
                ["value-builtin", "value-external"],
                "type-internal",
                "value-internal",
                ["type-parent", "type-sibling", "type-index"],
                ["value-parent", "value-sibling", "value-index"],
                "unknown",
            ],
            partitionByComment: true,
        },
        overrides: [
            {
                files: ["**/*.jsonc"],
                options: {
                    trailingComma: "none",
                },
            },
            {
                files: ["**/.vscode/**"],
                options: {
                    trailingComma: "all",
                },
            },
        ],
    },
    lint: {
        ignorePatterns: ["**/worker-configuration.d.ts", "dist/**"],
        options: {
            typeAware: true,
            typeCheck: true,
        },
        jsPlugins: ["eslint-plugin-perfectionist", "eslint-plugin-prefer-let"],
        rules: {
            "typescript/no-floating-promises": "allow",
            "typescript/unbound-method": "allow",
            "perfectionist/sort-jsx-props": "warn",
            "import/extensions": [
                "error",
                "ignorePackages",
                {
                    cjs: "always",
                    cts: "always",
                    js: "always",
                    jsx: "always",
                    mjs: "always",
                    mts: "always",
                    ts: "always",
                    tsx: "always",
                },
            ],
            "eslint/prefer-const": "off",
            "prefer-let/prefer-let": [2, { forceUpperCaseConst: true }],
        },
    },
});
