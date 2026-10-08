# Vite+ Migration Design

Migrate the remix-3-contacts project from its current esbuild/tsx/Biome toolchain to Vite+ (Vite 8 + Rolldown). The migration happens in two phases: Phase 1 replaces the dev/build pipeline, Phase 2 replaces formatting and linting.

## Current State

- **Dev server**: `tsx watch server.ts` (Node HTTP server)
- **Client bundling**: esbuild bundles `app/assets/*.tsx` → `public/assets/`
- **Formatting**: Biome (4-space indent, 100-char line width, `asNeeded` arrow parens, semicolons, trailing commas all)
- **Linting**: Biome (~40 configured rules)
- **Type checking**: `tsgo --noEmit`
- **Runtime**: Node 25.7.0 (session), no `.node-version` file
- **Package manager**: pnpm 10.29.3
- **Asset URLs**: `clientEntry(routes.assets.href({file, component}), fn)` — manually routed static paths like `/assets/Buttons.js#EditButton`

## Phase 1: Dev/Build Migration

### Goal

Replace esbuild + tsx with Vite+ for development and production builds. Keep Biome for formatting/linting temporarily.

### New Files

#### `.node-version`

Pin to Node 24 via `vp env pin 24`.

#### `remix.plugin.ts`

The Vite plugin from `docs/remix-client-entry-plugin.md`. Contains two plugins:

1. `fullstack` (from `@hiogawa/vite-plugin-fullstack`) — handles multi-environment builds and the `?assets=<envName>` query
2. `remix-client-entry-transform` — transforms `clientEntry(import.meta.url, fn)` calls, replacing `import.meta.url` with resolved production asset URLs using Rolldown's native `meta.ast` and `meta.magicString`

#### `vite.config.ts`

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

### Renamed Files

#### `app/router.tsx` → `app/entry.server.tsx`

Rename the existing router file to serve as the SSR entry point. Add HMR handling:

```ts
if (import.meta.hot) {
    import.meta.hot.accept();
}
```

All imports of `~/router.tsx` throughout the app update to `~/entry.server.tsx`:

- `app/lib/render.tsx` (imports `{ router }` from `~/router.tsx`)
- `server.ts` (imports `{ router }` from `./app/router.tsx`)

### Moved Files

#### `public/index.css` → `app/styles/index.css`

Move CSS out of the public directory so Vite can process it. Import in `Document.tsx` with `?url`:

```ts
import styles from "~/styles/index.css?url";
// ...
<link href={styles} rel="stylesheet" />
```

### Modified Files

#### `app/assets/*.tsx` (Favorite, SearchBar, Buttons, SidebarItem)

Every `clientEntry(routes.assets.href({...}), fn)` call changes to `clientEntry(import.meta.url, fn)`. The Vite plugin resolves URLs at build time. The `routes` import remains in these files — it is still used for other route references (e.g. `routes.contacts.favorite`, `routes.contacts.show`). Only the `routes.assets.href()` usage is removed.

Before:

```ts
export const Favorite = clientEntry(
    routes.assets.href({ file: "Favorite", component: "Favorite" }),
    function Favorite(handle: Handle) { ... }
);
```

After:

```ts
export const Favorite = clientEntry(
    import.meta.url,
    function Favorite(handle: Handle) { ... }
);
```

#### `app/assets/entry.tsx`

Add `/* @vite-ignore */` on the dynamic `import()` in `loadModule`:

```ts
const mod = await import(/* @vite-ignore */ moduleUrl);
```

#### `app/routes.ts`

Remove the `assets` route definition — no longer needed since the plugin handles asset URL resolution.

#### `app/components/Document.tsx`

Replace the hardcoded `<link href="/index.css">` and `<script src="/assets/entry.js">` with `mergeAssets` for JS/CSS discovered by the fullstack plugin, plus the explicit `?url` CSS import. Favicon links remain unchanged.

```tsx
import { mergeAssets } from "@hiogawa/vite-plugin-fullstack/runtime";

import clientAssets from "~/assets/entry.tsx?assets=client";
import serverAssets from "~/entry.server.tsx?assets=ssr";
import styles from "~/styles/index.css?url";

// In render:
const assets = mergeAssets(clientAssets, serverAssets);
// Use assets.css, assets.js for link/modulepreload tags
// Use styles for the explicit CSS link
// Use clientAssets.entry for the module script
```

#### `app/entry.server.tsx` (formerly `app/router.tsx`)

Update `staticFiles` to serve `./dist/client` in addition to `./public` for production builds:

```ts
staticFiles("./public"),
staticFiles("./dist/client"),
```

#### `app/lib/render.tsx`

Update router import from `~/router.tsx` to `~/entry.server.tsx`. No other changes.

#### `server.ts`

Production-only server (during development, `vp dev` handles the server via the fullstack plugin's `serverHandler` wiring). Import router from built SSR output:

```ts
// @ts-expect-error - no types for built output
import { router } from "./dist/ssr/entry.server.js";
```

#### `package.json`

Dependencies to remove:

- `esbuild` (dev)
- `tsx` (dev)

Dependencies to add (via `vp add`):

- `vite-plus` (dev)
- `@hiogawa/vite-plugin-fullstack`
- `oxc-parser` (dev, for plugin types)

Scripts: remove all — `dev`, `dev:server`, `dev:browser`, `start`. These are replaced by `vp dev`, `vp build`, and `node server.ts`. The `typecheck` script moves to a Vite task in `vite.config.ts`. Keep `fmt` and `lint` scripts pointing to Biome temporarily.

#### `.gitignore`

Add `/dist`. Remove `/public/assets` (esbuild no longer outputs there).

#### `tsconfig.json`

Update `exclude` from `["public/assets/*"]` to `["dist/*"]` — esbuild no longer outputs to `public/assets`, and the new `dist/` build output should not be type-checked.

### Verification

- `vp install`
- `vp dev` — dev server starts, pages render, client hydration works
- `vp build` — produces `dist/client/` and `dist/ssr/`
- `node server.ts` — production server runs against built output

## Phase 2: Lint/Format Migration

### Goal

Replace Biome with Oxfmt (formatting) and Oxlint (linting/type-checking). Remove Biome entirely.

### Modified Files

#### `vite.config.ts`

Add `fmt` and `lint` config blocks. Remove the `typecheck` Vite task (absorbed by `vp check`).

```ts
fmt: {
    // Match current Biome formatting settings
    // 4-space indent, 100-char print width, arrow parens asNeeded,
    // semicolons, trailing commas all
    // Built-in import sorting enabled
    organizeImports: true,
},
lint: {
    options: {
        typeAware: true,
        typeCheck: true,
    },
    jsPlugins: ["eslint-plugin-perfectionist"],
    // Configure perfectionist/sort-jsx-props
},
```

Exact `fmt` option names follow Oxfmt's Prettier-compatible config surface (e.g. `printWidth`, `tabWidth`, `useTabs`, `semi`, `singleQuote`, `trailingComma`, `arrowParens`). Double quotes (no `singleQuote`) matches the current Biome default.

Also remove the `run.tasks.typecheck` block — type checking is now handled by `vp check` via the `lint.options.typeCheck` setting and `oxlint-tsgolint`.

#### `package.json`

Dependencies to remove:

- `@biomejs/biome` (dev)
- `@typescript/native-preview` (dev) — type checking now via tsgolint through `vp check`

Dependencies to add (via `vp add`):

- `eslint-plugin-perfectionist` (dev)
- `oxlint-tsgolint` (dev)

Remove remaining `fmt` and `lint` scripts (now `vp fmt` and `vp lint`).

#### `.vscode/settings.json`

Replace Biome with Oxc, modeled after the malstrom.me reference:

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

    // Per-language formatters all pointing to oxc.oxc-vscode
    // ...

    "explorer.fileNesting.patterns": {
        "package.json": "... .node-version ...",
        "vite.config.*": "vitest.config.*, *.plugin.ts",
    },

    "biome.enabled": false,
    "prettier.enable": false,
    "eslint.enable": false,
    // ... other disables
}
```

### Removed Files

- **`biome.jsonc`** — fully replaced by `vite.config.ts` `fmt`/`lint` blocks

### Verification

- `vp check` — formatting, linting, and type checking all pass
- `vp fmt` — one-time pass to normalize any formatting differences from Biome → Oxfmt
- `vp lint` — confirm no unexpected errors from Oxlint defaults
- `vp build` — still produces correct output after reformatting
