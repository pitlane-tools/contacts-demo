import type { Plugin, PluginOption } from "vite";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { remix } from "pitlane/vite-plugin-remix";
import { defineConfig } from "vitest/config";

// Read once at config time, in Node — `applyD1Migrations` needs the SQL as data
// because the test worker has no filesystem.
let migrations = await readD1Migrations("./db/d1-migrations");

// The app's own transforms: `clientEntry()` and the `pitlane/assets/manifest`.
// Without them neither the router's module graph nor a component imports.
let appPlugins = (): PluginOption => remix({ serverHandler: false });

// Component HMR rewrites modules to talk to a dev-server registry that no test
// runtime provides. It is a `vite dev` concern, so drop it where it bites.
const HMR_PLUGINS = ["pitlane-remix-component-hmr", "pitlane-remix-server-data-hmr"];

/** Drops the HMR plugins at any nesting depth; Vite ignores `false` entries. */
function withoutHmr(plugin: PluginOption): PluginOption {
    if (Array.isArray(plugin)) return plugin.map(withoutHmr);

    let named: Plugin | undefined =
        typeof plugin === "object" && plugin !== null && "name" in plugin ? plugin : undefined;

    return named && HMR_PLUGINS.includes(named.name) ? false : plugin;
}

export default defineConfig({
    test: {
        projects: [
            {
                // Server tests run inside workerd, so `cloudflare:workers`
                // resolves and the router can be fetched exactly as deployed.
                plugins: [
                    appPlugins(),
                    cloudflareTest({
                        miniflare: {
                            // `fakeNetwork()` sleeps 1-3s unless NODE_ENV is
                            // "test"; workerd does not set it on its own.
                            bindings: { NODE_ENV: "test", TEST_MIGRATIONS: migrations },
                        },
                        wrangler: { configPath: "./wrangler.jsonc" },
                    }),
                ],
                test: {
                    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
                    name: "worker",
                    setupFiles: ["./test/apply-migrations.ts"],
                },
            },
            {
                // Workerd has no DOM, so anything touching `document` runs here.
                plugins: [withoutHmr(appPlugins())],
                test: {
                    environment: "jsdom",
                    include: ["app/**/*.test.browser.ts", "app/**/*.test.browser.tsx"],
                    name: "dom",
                },
            },
        ],
    },
});
