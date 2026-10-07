# Frame Router API Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the frame router so frame-level operations (`resolve`, `reload`, `name`) live on frame nodes and router-wide utilities live under `$`.

**Architecture:** Replace the current `frames.resolve.X()` / `frames.reload.X()` shape with `frames.X.resolve()` / `frames.X.reload()` / `frames.X.name`. Move utility methods (`reloadAll`, `match`, `matchAll`, `canIntercept`) under a `$` property. The config input format is unchanged.

**Tech Stack:** TypeScript, Remix Component API, Biome (format + lint), tsgo (typecheck)

**Spec:** `docs/superpowers/specs/2026-03-23-frame-router-api-restructure-design.md`

---

## File map

- **Modify:** `src/lib/frame-router/types.ts` — rewrite type definitions
- **Modify:** `src/lib/frame-router/core.ts` — rewrite runtime implementation
- **Modify:** `src/components/Document.tsx` — update call sites + Frame names
- **Modify:** `src/assets/Navigator.tsx` — update call sites
- **Modify:** `src/assets/SidebarItem.tsx` — update call site

---

### Task 1: Rewrite types

**Files:**

- Modify: `src/lib/frame-router/types.ts`

- [ ] **Step 1: Replace the entire file with new type definitions**

Remove `ResolveAPI`, `ReloadAPI`, `ExtractParams`, `UnionTupleParams`, `UnionAllParams`, `MergedParams`, and the private `UnionToIntersection`/`StripIndexSignature` types. Keep `ExtractRouteParams`, `RouteResolver`, `RouteTuple`, `FrameConfig`. Add `FrameNode`, `FrameUtils`, `FrameNodeAPI`, and updated `FrameRouter`.

```ts
/** biome-ignore-all lint/suspicious/noExplicitAny: necessary for type inference */
/** biome-ignore-all lint/complexity/noBannedTypes: necessary for type inference */

import type { Handle } from "remix/component";

/**
 * Extract param types from a Route object
 * Returns the type of the first parameter to href(), excluding null/undefined
 */
export type ExtractRouteParams<R> = R extends { href: (...args: infer Args) => any }
    ? Args extends readonly [infer First, ...any[]]
        ? First extends null | undefined
            ? {}
            : Exclude<First, null | undefined>
        : Args extends readonly []
          ? {}
          : {}
    : never;

/**
 * Route resolver function signature
 * Takes extracted params and URL, returns frame source URL
 */
export type RouteResolver<Params = any> = (params: Params, url: URL) => string | null;

/**
 * Route tuple: [route object, resolver function]
 * The resolver's params must match the route's params
 */
export type RouteTuple<R = any> = readonly [R, RouteResolver<ExtractRouteParams<R>>];

/**
 * Frame configuration - nested object or array of route tuples
 */
export type FrameConfig = readonly RouteTuple[] | { [key: string]: FrameConfig };

/**
 * A frame node with resolve, reload, and name
 */
export interface FrameNode {
    resolve(url: URL | string): string | null;
    reload(url: URL | string, handle: Handle): Promise<void>;
    name: string;
}

/**
 * Router-wide utility methods
 */
export interface FrameUtils {
    reloadAll(url: URL | string, handle: Handle): Promise<void>;
    match(
        url: URL | string | null | undefined,
    ): { params: Record<string, string | undefined> } | null;
    matchAll(
        url: URL | string | null | undefined,
    ): Array<{ params: Record<string, string | undefined> }>;
    canIntercept(url: URL | string): boolean;
}

/**
 * Map config structure to frame nodes
 */
export type FrameNodeAPI<Config> = {
    [K in keyof Config]: Config[K] extends readonly any[]
        ? FrameNode
        : Config[K] extends object
          ? FrameNodeAPI<Config[K]>
          : never;
};

/**
 * Frame router instance — frame nodes + $ utilities
 */
export type FrameRouter<Config> = FrameNodeAPI<Config> & { $: FrameUtils };
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: Type errors in `core.ts` (it still returns the old shape). That's expected — we fix it in Task 2.

---

### Task 2: Rewrite core implementation

**Files:**

- Modify: `src/lib/frame-router/core.ts`

- [ ] **Step 1: Replace the entire file with the new implementation**

Replace `generateNestedAPI` (called twice) with `generateFrameNodes` (called once). Each leaf gets `{ resolve, reload, name }`. Attach `$` with utility methods. Change frame name joiner from `"."` to `"-"`.

```ts
/** biome-ignore-all lint/suspicious/noExplicitAny: necessary for type inference */

import type { Handle } from "remix/component";
import type { Route } from "remix/fetch-router/routes";

import { TrieMatcher } from "remix/route-pattern";

import type { ExtractRouteParams, FrameRouter, RouteResolver, RouteTuple } from "./types.ts";

/**
 * Helper to create a type-safe route tuple without needing `as const`
 */
export function frame<R extends Route>(
    r: R,
    resolver: RouteResolver<ExtractRouteParams<R>>,
): RouteTuple<R> {
    return [r, resolver] as const;
}

/**
 * Create a frame router from configuration
 *
 * The config parameter uses a permissive type to allow flexible input,
 * then the const type parameter preserves the exact structure.
 */
export function createFrames<const Config>(config: Config): FrameRouter<Config> {
    // Collect all route tuples from nested config
    const allTuples: Array<{ framePath: string[]; tuple: RouteTuple }> = [];

    function collect(obj: unknown, path: string[] = []) {
        if (Array.isArray(obj)) {
            for (const tuple of obj) {
                allTuples.push({ framePath: path, tuple });
            }
        } else if (typeof obj === "object" && obj !== null) {
            for (const [key, value] of Object.entries(obj)) {
                collect(value, [...path, key]);
            }
        }
    }

    collect(config);

    // Build matcher for all routes
    const matcher = new TrieMatcher<{
        framePath: string[];
        resolver: RouteResolver;
    }>();

    for (const { framePath, tuple } of allTuples) {
        const [route, resolver] = tuple;

        if (!route?.pattern) {
            throw new Error(
                `Route object must have a 'pattern' property: ${JSON.stringify(route)}`,
            );
        }

        matcher.add(route.pattern, { framePath, resolver });
    }

    // Build frame nodes from config
    const nodes = generateFrameNodes(config, (framePath: string[]) => {
        const frameName = framePath.join("-");

        function resolve(url: URL | string): string | null {
            const urlObj = toURL(url);
            const matches = matcher.matchAll(urlObj);
            for (const match of matches) {
                if (pathEquals(match.data.framePath, framePath)) {
                    return match.data.resolver(match.params, urlObj);
                }
            }
            return null;
        }

        return {
            name: frameName,
            resolve,

            async reload(url: URL | string, handle: Handle) {
                const frameSource = resolve(url);
                if (!frameSource) return;

                const frame = handle.frames.get(frameName);
                if (!frame) return;

                frame.src = frameSource;
                await frame.reload();
            },
        };
    });

    // Attach $ utilities
    const result = nodes as FrameRouter<Config>;
    (result as any).$ = {
        async reloadAll(url: URL | string, handle: Handle) {
            const urlObj = toURL(url);
            const matches = matcher.matchAll(urlObj);

            // Group by frame name to avoid duplicate reloads
            const frameMap = new Map<string, string>();

            for (const match of matches) {
                const { framePath, resolver } = match.data;
                const frameName = framePath.join("-");
                const src = resolver(match.params, urlObj);
                if (src) {
                    frameMap.set(frameName, src);
                }
            }

            await Promise.all(
                Array.from(frameMap.entries()).map(async ([frameName, src]) => {
                    const frame = handle.frames.get(frameName);
                    if (!frame) return;

                    frame.src = src;
                    await frame.reload();
                }),
            );
        },

        match(url: URL | string | null | undefined) {
            if (!url) return null;
            const urlObj = toURL(url);
            const match = matcher.match(urlObj);
            return match ? { params: match.params } : null;
        },

        matchAll(url: URL | string | null | undefined) {
            if (!url) return [];
            const urlObj = toURL(url);
            const matches = matcher.matchAll(urlObj);
            return matches.map(m => ({ params: m.params }));
        },

        canIntercept(url: URL | string) {
            const urlObj = toURL(url);
            return matcher.match(urlObj) !== null;
        },
    };

    return result;
}

/**
 * Parse URL input to URL object
 */
function toURL(url: URL | string): URL {
    return typeof url === "string" ? new URL(url, "http://localhost") : url;
}

/**
 * Build frame node objects from config structure
 */
function generateFrameNodes(
    config: any,
    createLeaf: (framePath: string[]) => any,
    path: string[] = [],
): any {
    if (Array.isArray(config)) {
        return createLeaf(path);
    }

    const result = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(config)) {
        result[key] = generateFrameNodes(value, createLeaf, [...path, key]);
    }
    return result;
}

/**
 * Check if two paths are equal
 */
function pathEquals(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: Type errors in consumer files (`Document.tsx`, `Navigator.tsx`, `SidebarItem.tsx`) — old API usage. Fixed in Task 3.

---

### Task 3: Update all call sites

**Files:**

- Modify: `src/components/Document.tsx`
- Modify: `src/assets/Navigator.tsx`
- Modify: `src/assets/SidebarItem.tsx`

- [ ] **Step 1: Update Document.tsx**

Change resolve calls and Frame name props:

```diff
-    const sidebarSrc = frames.resolve.sidebar(url);
-    const detailSrc = frames.resolve.detail(url);
+    const sidebarSrc = frames.sidebar.resolve(url);
+    const detailSrc = frames.detail.resolve(url);
```

```diff
-                        <Frame name="sidebar" src={sidebarSrc} />
+                        <Frame name={frames.sidebar.name} src={sidebarSrc} />
```

```diff
-                    <Frame name="detail" src={detailSrc} />
+                    <Frame name={frames.detail.name} src={detailSrc} />
```

- [ ] **Step 2: Update Navigator.tsx**

```diff
-        enhancer.canIntercept = frames.canIntercept;
+        enhancer.canIntercept = frames.$.canIntercept;
```

```diff
-                    await frames.reload.detail(url, handle);
-                    await frames.reload.sidebar(url, handle);
+                    await frames.detail.reload(url, handle);
+                    await frames.sidebar.reload(url, handle);
```

- [ ] **Step 3: Update SidebarItem.tsx**

```diff
-            const destination = frames.match(navigating.to.url);
+            const destination = frames.$.match(navigating.to.url);
```

- [ ] **Step 4: Run typecheck, format, and lint**

Run: `pnpm run typecheck && pnpm run fmt && pnpm run lint`
Expected: All pass with no errors.
