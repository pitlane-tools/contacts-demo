# Vite+ Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the remix-3-contacts project from esbuild/tsx/Biome to Vite+ (Vite 8 + Rolldown + Oxfmt + Oxlint) in two phases.

**Architecture:** Phase 1 replaces the dev/build pipeline (esbuild + tsx → Vite+ with a custom Remix plugin for `clientEntry` transforms and `@hiogawa/vite-plugin-fullstack` for multi-environment builds). Phase 2 replaces formatting and linting (Biome → Oxfmt + Oxlint). Biome stays during Phase 1 for formatting/linting continuity.

**Tech Stack:** vite-plus (Vite 8 + Rolldown), @hiogawa/vite-plugin-fullstack, oxc-parser, Oxfmt, Oxlint, oxlint-tsgolint, eslint-plugin-perfectionist

**Spec:** `docs/superpowers/specs/2026-03-23-vite-plus-migration-design.md`

**Important:** This project's CLAUDE.md says: NEVER attempt to run the dev server yourself. Add `console.log` statements if debugging is needed and tell the user where to look. Verification steps that say "User verifies" mean you should tell the user what to check, not run the server yourself.

---

## File Structure

### New Files

- `.node-version` — pins Node 24
- `remix.plugin.ts` — Vite plugin: fullstack + clientEntry transform
- `vite.config.ts` — Vite+ config: environments, builder, resolve, plugins, tasks
- `app/env.d.ts` — ambient type declarations for Vite import queries (if needed)

### Renamed Files

- `app/router.tsx` → `app/entry.server.tsx` — SSR entry point

### Moved Files

- `public/index.css` → `app/styles/index.css` — CSS processed by Vite

### Modified Files (Phase 1)

- `app/assets/Favorite.tsx` — `clientEntry` first arg → `import.meta.url`
- `app/assets/SearchBar.tsx` — same
- `app/assets/Buttons.tsx` — same (3 clientEntry calls)
- `app/assets/SidebarItem.tsx` — same
- `app/assets/entry.tsx` — add `/* @vite-ignore */` to dynamic import
- `app/routes.ts` — remove `assets` route
- `app/components/Document.tsx` — mergeAssets + ?url CSS import
- `app/lib/render.tsx` — update router import path
- `server.ts` — production-only, import from dist/ssr
- `package.json` — swap deps, remove scripts
- `.gitignore` — `/dist` instead of `/public/assets`
- `tsconfig.json` — exclude `dist/*` instead of `public/assets/*`

### Modified Files (Phase 2)

- `vite.config.ts` — add `fmt`/`lint` blocks, remove `run.tasks.typecheck`
- `package.json` — swap biome/tsgo for perfectionist/tsgolint
- `.vscode/settings.json` — Biome → Oxc

### Removed Files (Phase 2)

- `biome.jsonc`

---

## Phase 1: Dev/Build Migration

### Task 1: Pin Node version and install Vite+ dependencies

**Files:**

- Create: `.node-version`
- Modify: `package.json`

- [ ] **Step 1: Pin Node 24**

```bash
vp env pin 24
```

This creates `.node-version` with content `24`.

- [ ] **Step 2: Install Vite+ and fullstack plugin**

```bash
vp add -D vite-plus oxc-parser
vp add @hiogawa/vite-plugin-fullstack
```

- [ ] **Step 3: Remove esbuild and tsx**

```bash
vp remove esbuild tsx
```

- [ ] **Step 4: Remove old scripts from package.json**

Edit `package.json`. Remove all scripts except `fmt` and `lint` (kept for Phase 1):

```json
"scripts": {
    "fmt": "biome format --write .",
    "lint": "biome lint --write --unsafe ."
}
```

Remove the `"main": "index.js"` field as well — it's not used.

- [ ] **Step 5: Commit**

```bash
git add .node-version package.json pnpm-lock.yaml
git commit -m "Add Vite+ dependencies, remove esbuild/tsx"
```

---

### Task 2: Create the Remix Vite plugin

**Files:**

- Create: `remix.plugin.ts`

**Reference:** `docs/remix-client-entry-plugin.md` — "Complete Plugin Source" section

- [ ] **Step 1: Create `remix.plugin.ts`**

```ts
import type { Program } from "oxc-parser";
import type { PluginOption } from "vite-plus";

import fullstack from "@hiogawa/vite-plugin-fullstack";

export function remix({
    serverEnvironments: _environments = ["ssr"],
    serverHandler = true,
}: {
    serverEnvironments?: string[];
    serverHandler?: boolean;
} = {}): PluginOption {
    return [
        fullstack({
            serverEnvironments: _environments,
            serverHandler,
        }),
        {
            name: "remix-client-entry-transform",
            transform: {
                filter: {
                    code: {
                        include: /\bclientEntry\b/,
                    },
                },
                handler(code, id, meta) {
                    if (!code.includes("import.meta.url")) return;

                    const calls = findClientEntryCalls(meta.ast);
                    if (calls.length === 0) return;

                    const { magicString } = meta;
                    const envName = this.environment.name;

                    magicString.prepend(
                        `import ___clientEntryAssets from "${id}?assets=${envName}";\n`,
                    );

                    for (const call of calls) {
                        magicString.overwrite(
                            call.metaUrlStart,
                            call.metaUrlEnd,
                            `___clientEntryAssets.entry + "#${call.exportName}"`,
                        );
                    }

                    return { code: magicString };
                },
            },
        },
    ];
}

interface ClientEntryCall {
    exportName: string;
    metaUrlStart: number;
    metaUrlEnd: number;
}

function findClientEntryCalls(program: Program): ClientEntryCall[] {
    const results: ClientEntryCall[] = [];

    for (const node of program.body) {
        if (node.type !== "ExportNamedDeclaration") continue;
        if (node.declaration?.type !== "VariableDeclaration") continue;

        for (const declarator of node.declaration.declarations) {
            if (declarator.id.type !== "Identifier") continue;
            if (declarator.init?.type !== "CallExpression") continue;

            const call = declarator.init;

            if (call.callee.type !== "Identifier" || call.callee.name !== "clientEntry") continue;

            if (call.arguments.length < 2) continue;

            const firstArg = call.arguments[0];
            if (
                firstArg.type !== "MemberExpression" ||
                firstArg.object.type !== "MetaProperty" ||
                firstArg.property.type !== "Identifier" ||
                firstArg.property.name !== "url"
            )
                continue;

            results.push({
                exportName: declarator.id.name,
                metaUrlStart: firstArg.start,
                metaUrlEnd: firstArg.end,
            });
        }
    }

    return results;
}
```

- [ ] **Step 2: Commit**

```bash
git add remix.plugin.ts
git commit -m "Add Remix Vite plugin for clientEntry transforms"
```

---

### Task 3: Create vite.config.ts

**Files:**

- Create: `vite.config.ts`

- [ ] **Step 1: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite-plus";

import { remix } from "./remix.plugin.ts";

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    builder: {
        async buildApp(builder) {
            await builder.build(builder.environments.ssr);
            await builder.build(builder.environments.client);
        },
    },
    environments: {
        client: {
            build: {
                outDir: "dist/client",
                rollupOptions: {
                    input: "app/assets/entry",
                },
            },
        },
        ssr: {
            build: {
                outDir: "dist/ssr",
                rollupOptions: {
                    input: "app/entry.server",
                },
            },
        },
    },
    plugins: [remix()],
    run: {
        tasks: {
            typecheck: {
                command: "tsgo --noEmit",
            },
        },
    },
});
```

- [ ] **Step 2: Commit**

```bash
git add vite.config.ts
git commit -m "Add Vite+ config with multi-environment build"
```

---

### Task 4: Rename router to entry.server and update imports

**Files:**

- Rename: `app/router.tsx` → `app/entry.server.tsx`
- Modify: `app/entry.server.tsx` (add HMR + staticFiles for dist/client)
- Modify: `app/lib/render.tsx:9` (update import path)
- Modify: `server.ts:4` (update import path to avoid broken intermediate state)

- [ ] **Step 1: Rename the file**

```bash
git mv app/router.tsx app/entry.server.tsx
```

- [ ] **Step 2: Add HMR handling and dist/client static files to `app/entry.server.tsx`**

At the end of `app/entry.server.tsx`, after `router.map(routes.contacts, contacts);`, add:

```ts
if (import.meta.hot) {
    import.meta.hot.accept();
}
```

Also add a second `staticFiles` call for the production client build output. In the middleware array, after `staticFiles("./public"),` add:

```ts
        staticFiles("./dist/client"),
```

- [ ] **Step 3: Update import in `app/lib/render.tsx`**

Change line 9 from:

```ts
import { router } from "~/router.tsx";
```

to:

```ts
import { router } from "~/entry.server.tsx";
```

- [ ] **Step 4: Update import in `server.ts`**

Change line 4 from:

```ts
import { router } from "./app/router.tsx";
```

to:

```ts
import { router } from "./app/entry.server.tsx";
```

(Task 8 will replace `server.ts` entirely for production use, but this keeps it working in the interim.)

- [ ] **Step 5: Commit**

```bash
git add app/entry.server.tsx app/lib/render.tsx server.ts
git commit -m "Rename router to entry.server, add HMR and dist/client serving"
```

---

### Task 5: Move CSS and remove assets route

**Files:**

- Move: `public/index.css` → `app/styles/index.css`
- Modify: `app/routes.ts`

- [ ] **Step 1: Move the CSS file**

```bash
mkdir -p app/styles
git mv public/index.css app/styles/index.css
```

- [ ] **Step 2: Remove the `assets` route from `app/routes.ts`**

The file should become:

```ts
import { createRoutes, resources } from "remix/fetch-router/routes";

export const routes = createRoutes({
    home: "/",
    contacts: {
        ...resources("/contacts", { exclude: ["index", "new"] }),
        favorite: { method: "PATCH", pattern: "/contacts/:id/favorite" },
    },
});
```

(Remove the `assets: "/assets/:file.js#:component",` line.)

- [ ] **Step 3: Commit**

```bash
git add app/styles/index.css public/index.css app/routes.ts
git commit -m "Move CSS to app/styles, remove assets route"
```

---

### Task 6: Update clientEntry calls in all asset files

**Files:**

- Modify: `app/assets/Favorite.tsx:5`
- Modify: `app/assets/SearchBar.tsx:6`
- Modify: `app/assets/Buttons.tsx:13,31,47`
- Modify: `app/assets/SidebarItem.tsx:30`
- Modify: `app/assets/entry.tsx:5`

The `routes` import stays in Favorite.tsx (uses `routes.contacts.favorite`), Buttons.tsx (uses `routes.contacts.*`), and SidebarItem.tsx (uses `routes.contacts.show`/`edit`). SearchBar.tsx's `routes` import becomes unused and must be removed. Only the `routes.assets.href()` usage is replaced with `import.meta.url`.

- [ ] **Step 1: Update `app/assets/Favorite.tsx`**

Change line 5 from:

```ts
    routes.assets.href({ file: "Favorite", component: "Favorite" }),
```

to:

```ts
    import.meta.url,
```

- [ ] **Step 2: Update `app/assets/SearchBar.tsx`**

Change line 6 from:

```ts
    routes.assets.href({ file: "SearchBar", component: "SearchBar" }),
```

to:

```ts
    import.meta.url,
```

Also remove line 3 — the `routes` import is no longer used in this file:

```ts
import { routes } from "~/routes.ts";
```

- [ ] **Step 3: Update `app/assets/Buttons.tsx`**

Three `clientEntry` calls need updating. Change line 13 from:

```ts
    routes.assets.href({ file: "Buttons", component: "EditButton" }),
```

to:

```ts
    import.meta.url,
```

Change line 31 from:

```ts
    routes.assets.href({ file: "Buttons", component: "CancelButton" }),
```

to:

```ts
    import.meta.url,
```

Change line 47 from:

```ts
    routes.assets.href({ file: "Buttons", component: "DeleteButton" }),
```

to:

```ts
    import.meta.url,
```

The `routes` import stays — it is used by `NewButton`, `EditButton`, and `DeleteButton` for `routes.contacts.*` references.

- [ ] **Step 4: Update `app/assets/SidebarItem.tsx`**

Change line 30 from:

```ts
    routes.assets.href({ file: "SidebarItem", component: "SidebarItem" }),
```

to:

```ts
    import.meta.url,
```

The `routes` import stays — it is used for `routes.contacts.show` and `routes.contacts.edit`.

- [ ] **Step 5: Add `/* @vite-ignore */` to `app/assets/entry.tsx`**

Change line 5 from:

```ts
const mod = await import(moduleUrl);
```

to:

```ts
const mod = await import(/* @vite-ignore */ moduleUrl);
```

- [ ] **Step 6: Commit**

```bash
git add app/assets/Favorite.tsx app/assets/SearchBar.tsx app/assets/Buttons.tsx app/assets/SidebarItem.tsx app/assets/entry.tsx
git commit -m "Update clientEntry calls to use import.meta.url"
```

---

### Task 7: Update Document.tsx with mergeAssets

**Files:**

- Modify: `app/components/Document.tsx`

**Reference:** `docs/remix-client-entry-plugin.md` — "Document component (server)" section

- [ ] **Step 1: Rewrite `app/components/Document.tsx`**

Replace the entire file with:

```tsx
import { mergeAssets } from "@hiogawa/vite-plugin-fullstack/runtime";
import { getContext } from "remix/async-context-middleware";
import { Frame } from "remix/component";
import * as s from "remix/data-schema";

import { NewButton } from "~/assets/Buttons.tsx";
import clientAssets from "~/assets/entry.tsx?assets=client";
import { SearchBar } from "~/assets/SearchBar.tsx";
import serverAssets from "~/entry.server.tsx?assets=ssr";
import { QuerySchema } from "~/lib/schemas.ts";
import styles from "~/styles/index.css?url";

export function Document() {
    const { url } = getContext();
    const { q } = s.parse(QuerySchema, url.searchParams);
    const assets = mergeAssets(clientAssets, serverAssets);

    return () => (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta content="width=device-width, initial-scale=1" name="viewport" />
                <title>Remix 3 Contacts</title>
                <link href={styles} rel="stylesheet" />
                <link href="/favicon-32.png" rel="icon" sizes="32x32" />
                <link href="/favicon-128.png" rel="icon" sizes="128x128" />
                <link href="/favicon-180.png" rel="icon" sizes="180x180" />
                <link href="/favicon-192.png" rel="icon" sizes="192x192" />
                <link href="/favicon-180.png" rel="apple-touch-icon" sizes="180x180" />
                {assets.css.map(attrs => (
                    <link key={attrs.href} {...attrs} rel="stylesheet" />
                ))}
                {assets.js.map(attrs => (
                    <link key={attrs.href} {...attrs} rel="modulepreload" />
                ))}
                <script async src={clientAssets.entry} type="module" />
            </head>
            <body>
                <div id="root">
                    <div id="sidebar">
                        <h1>Remix 3 Contacts</h1>
                        <div>
                            <SearchBar query={q} />
                            <NewButton />
                        </div>
                        <Frame name="sidebar" src={url.toString()} />
                    </div>
                    <Frame name="detail" src={url.toString()} />
                </div>
            </body>
        </html>
    );
}
```

- [ ] **Step 2: Create `app/env.d.ts` for Vite import type declarations**

The `?assets=client`, `?assets=ssr`, and `?url` import queries need ambient type declarations for TypeScript. Check if `@hiogawa/vite-plugin-fullstack` or `vite-plus` provide these types. If not, create `app/env.d.ts`:

```ts
declare module "*?url" {
    const url: string;
    export default url;
}

declare module "*?assets=client" {
    const assets: { entry: string; css: { href: string }[]; js: { href: string }[] };
    export default assets;
}

declare module "*?assets=ssr" {
    const assets: { entry: string; css: { href: string }[]; js: { href: string }[] };
    export default assets;
}
```

Verify with `vp run typecheck` that the type declarations are correct. Adjust the shapes based on what `@hiogawa/vite-plugin-fullstack` actually exports. Vite+ may already provide the `?url` type via `vite-plus/client` — check and use that if available rather than declaring it manually.

- [ ] **Step 3: Commit**

```bash
git add app/components/Document.tsx app/env.d.ts
git commit -m "Update Document to use mergeAssets for CSS/JS resolution"
```

---

### Task 8: Update server.ts for production-only use

**Files:**

- Modify: `server.ts`

- [ ] **Step 1: Update `server.ts`**

Replace the entire file with:

```ts
import * as http from "node:http";
import { createRequestListener } from "remix/node-fetch-server";

// @ts-expect-error - no types for the built output
import { router } from "./dist/ssr/entry.server.js";

const server = http.createServer(
    createRequestListener(request => router.fetch(request), {
        onError(error) {
            // Client disconnects mid-stream cause AbortErrors — not actionable
            if (error instanceof DOMException && error.name === "AbortError") {
                return new Response(null, { status: 499 });
            }
            console.error(error);
            return new Response("Internal Server Error", { status: 500 });
        },
    }),
);

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 1612;

server.listen(port, () => {
    console.log(`Contacts demo is running on http://localhost:${port}`);
});

let shuttingDown = false;

function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 2: Commit**

```bash
git add server.ts
git commit -m "Update server.ts for production-only use with built SSR output"
```

---

### Task 9: Update config files

**Files:**

- Modify: `.gitignore`
- Modify: `tsconfig.json:3`

- [ ] **Step 1: Update `.gitignore`**

Replace the entire file with:

```
.DS_Store
.env
/node_modules/
*.tsbuildinfo

# Vite
/dist
```

- [ ] **Step 2: Update `tsconfig.json`**

Change the `exclude` value from `["public/assets/*"]` to `["dist/*"]`.

- [ ] **Step 3: Commit**

```bash
git add .gitignore tsconfig.json
git commit -m "Update gitignore and tsconfig for Vite build output"
```

---

### Task 10: Verify Phase 1

- [ ] **Step 1: Install dependencies**

```bash
vp install
```

- [ ] **Step 2: Run format and lint (still Biome)**

```bash
pnpm run fmt
pnpm run lint
```

- [ ] **Step 3: Run typecheck**

```bash
vp run typecheck
```

Fix any type errors that arise. Likely issues:

- The `?assets=client` / `?assets=ssr` / `?url` import queries may need type declarations. If so, create `app/env.d.ts` with the necessary ambient module declarations.
- The `mergeAssets` return type may need checking.

- [ ] **Step 4: User verifies dev server**

Tell the user to run `vp dev` and verify:

- Pages render with correct styling
- Client-side hydration works (search bar, favorite button, navigation)
- HMR works when editing a component

- [ ] **Step 5: User verifies production build**

Tell the user to run:

```bash
vp build
node server.ts
```

Verify:

- `dist/client/` and `dist/ssr/` directories are created
- Production server starts and pages render correctly
- Static assets (CSS, JS, favicons) are served

- [ ] **Step 6: Commit any fixes**

If any fixes were needed during verification, commit them.

---

## Phase 2: Lint/Format Migration

### Task 11: Add fmt and lint config to vite.config.ts

**Files:**

- Modify: `vite.config.ts`

- [ ] **Step 1: Update `vite.config.ts`**

Add `fmt` and `lint` blocks. Remove the `run.tasks.typecheck` block. The full file becomes:

```ts
import { defineConfig } from "vite-plus";

import { remix } from "./remix.plugin.ts";

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    builder: {
        async buildApp(builder) {
            await builder.build(builder.environments.ssr);
            await builder.build(builder.environments.client);
        },
    },
    environments: {
        client: {
            build: {
                outDir: "dist/client",
                rollupOptions: {
                    input: "app/assets/entry",
                },
            },
        },
        ssr: {
            build: {
                outDir: "dist/ssr",
                rollupOptions: {
                    input: "app/entry.server",
                },
            },
        },
    },
    plugins: [remix()],
    fmt: {
        printWidth: 100,
        tabWidth: 4,
        useTabs: false,
        semi: true,
        trailingComma: "all",
        arrowParens: "asNeeded",
        organizeImports: true,
    },
    lint: {
        options: {
            typeAware: true,
            typeCheck: true,
        },
        jsPlugins: ["eslint-plugin-perfectionist"],
    },
});
```

- [ ] **Step 2: Commit**

```bash
git add vite.config.ts
git commit -m "Add Oxfmt/Oxlint config, remove typecheck task"
```

---

### Task 12: Swap lint/format dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Remove Biome and TypeScript native preview**

```bash
vp remove @biomejs/biome @typescript/native-preview
```

- [ ] **Step 2: Add Oxlint tsgolint and perfectionist**

```bash
vp add -D oxlint-tsgolint eslint-plugin-perfectionist
```

- [ ] **Step 3: Remove remaining scripts from `package.json`**

Edit `package.json` to remove the `"scripts"` block entirely (remove `fmt` and `lint` — now handled by `vp fmt` and `vp lint`).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Swap Biome for Oxlint/Oxfmt, add perfectionist plugin"
```

---

### Task 13: Update .vscode/settings.json

**Files:**

- Modify: `.vscode/settings.json`

**Reference:** `/Users/orion/Developer/Projects/malstrom.me/.vscode/settings.json`

- [ ] **Step 1: Replace `.vscode/settings.json`**

```jsonc
{
    "js/ts.preferences.importModuleSpecifierEnding": "js",
    "js/ts.experimental.useTsgo": true,

    "oxc.enable.oxlint": true,
    "oxc.enable.oxfmt": true,

    "editor.codeActionsOnSave": {
        "source.fixAll.oxc": "explicit",
        "source.fixAll": "explicit",
        "source.addMissingImports.ts": "explicit",
        "source.removeUnused.ts": "never",
    },
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true,
    "editor.formatOnSaveMode": "file",

    "[typescript]": {
        "editor.defaultFormatter": "oxc.oxc-vscode",
    },
    "[tsx]": {
        "editor.defaultFormatter": "oxc.oxc-vscode",
    },
    "[javascript]": {
        "editor.defaultFormatter": "oxc.oxc-vscode",
    },
    "[jsx]": {
        "editor.defaultFormatter": "oxc.oxc-vscode",
    },
    "[css]": {
        "editor.defaultFormatter": "oxc.oxc-vscode",
    },
    "[json]": {
        "editor.defaultFormatter": "oxc.oxc-vscode",
    },
    "[jsonc]": {
        "editor.defaultFormatter": "oxc.oxc-vscode",
    },
    "[markdown]": {
        "editor.defaultFormatter": "oxc.oxc-vscode",
    },

    "explorer.fileNesting.enabled": true,
    "explorer.fileNesting.expand": false,
    "explorer.fileNesting.patterns": {
        "package.json": ".github*, .npmrc, .prettierignore, .vscode*, .node-version, biome.json*, bun.lock*, components.json, eslint.config.*, mise.toml, pnpm-*.yaml, prettier.config.*, tsconfig.*, wrangler.toml, wrangler.*.toml, wrangler.json*, wrangler.*.json, wrangler.*.jsonc, workspace.json",
        "readme*": "agent*, authors, backers*, changelog*, citation*, claude*, code_of_conduct*, codeowners, contributing*, contributors, copying, credits, governance.md, history.md, license*, maintainers, readme*, security.md, sponsors*",
        "vite.config.*": "vitest.config.*, *.plugin.ts",
    },

    "biome.enabled": false,
    "prettier.enable": false,
    "eslint.enable": false,
    "dprint.experimentalLsp": false,
    "deno.enable": false,
    "unocss.disable": true,
    "vitest.ignoreWorkspace": true,
}
```

- [ ] **Step 2: Commit**

```bash
git add .vscode/settings.json
git commit -m "Update VS Code settings for Oxc tooling"
```

---

### Task 14: Remove biome.jsonc

**Files:**

- Delete: `biome.jsonc`

- [ ] **Step 1: Delete `biome.jsonc`**

```bash
git rm biome.jsonc
```

- [ ] **Step 2: Commit**

```bash
git commit -m "Remove Biome config"
```

---

### Task 15: Normalize formatting and verify Phase 2

- [ ] **Step 1: Run Oxfmt to normalize formatting**

```bash
vp fmt
```

This is a one-time pass to normalize any minor formatting differences between Biome and Oxfmt. Expect some files to change.

- [ ] **Step 2: Run lint**

```bash
vp lint
```

Fix any errors. Oxlint defaults may flag things Biome didn't, or vice versa.

- [ ] **Step 3: Run full check**

```bash
vp check
```

This runs format + lint + type check together. Everything should pass.

- [ ] **Step 4: Verify build still works**

```bash
vp build
```

Confirm `dist/client/` and `dist/ssr/` are produced without errors.

- [ ] **Step 5: Commit formatting changes**

```bash
git add -A
git commit -m "Normalize formatting with Oxfmt"
```

- [ ] **Step 6: User verifies dev server still works**

Tell the user to run `vp dev` and verify everything still works as expected.
