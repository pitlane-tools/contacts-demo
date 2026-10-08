# Frame-Aware Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-app `app/utils/metadata` utility that lets Remix UI components declare lowercase head tags inside `<Head>` and keeps the document `<head>` synchronized across SSR, hydration, client updates, and frame reloads.

**Architecture:** `<Head>` renders an inert transport `<template>` instead of literal document metadata. SSR helpers extract those templates from rendered HTML and inject normalized tags into the real document `<head>`. A client `MetadataManager` observes transport templates and performs owner-scoped reconciliation against `document.head`.

**Tech Stack:** Remix 3 UI, `remix/assert`, `remix/test`, TypeScript, DOM APIs, Web Streams.

---

## External behavior notes

Use lowercase metadata children inside `<Head>`:

```tsx
<Head>
    <title>Product</title>
    <meta name="description" content="Product description" />
    <link rel="canonical" href="/products/product" />
    <link rel="stylesheet" href="/assets/product.css" precedence="route" />
    <style href="inline:product" precedence="component">{`.x{color:red}`}</style>
    <script async src="/assets/product.js" />
</Head>
```

This follows React 19’s document metadata direction: React 19 supports rendering metadata tags like `<title>`, `<link>`, and `<meta>` from components and hoisting them to `<head>`. It also uses `precedence` for managed stylesheets. ([React][1])

Tests should use `describe`/`it` from `remix/test` and assertions from `remix/assert`; Remix’s prerelease notes added `remix/assert` and `remix/test` exports, and `@remix-run/test` provides `describe`/`it` test structure. ([New Releases][2])

---

## File structure

Create the utility under the existing app:

```txt
app/utils/metadata/
├── index.ts
├── types.ts
├── rules.ts
├── html.ts
├── transport.ts
├── head.tsx
├── ssr.ts
├── stream.ts
├── manager.ts
├── frames.ts
├── rules.test.ts
├── html.test.ts
├── transport.test.ts
├── head.test.tsx
├── ssr.test.ts
├── manager.test.ts
├── frames.test.ts
└── integration.test.tsx
```

Responsibilities:

```txt
types.ts       Shared metadata types.
rules.ts       Supported tag rules, identity, lifecycle, ordering metadata.
html.ts        Render normalized metadata entries as real head HTML.
transport.ts   Serialize and parse inert transport templates.
head.tsx       Remix UI <Head> component that accepts lowercase metadata tags.
ssr.ts         Extract transport templates and inject managed tags into SSR HTML.
stream.ts      Buffer renderToStream() output and inject metadata.
manager.ts     Client document.head reconciler.
frames.ts      resolveFrame() wrapper and frame HTML normalization.
index.ts       Barrel exports.
```

---

## Task 1: Configure Remix test coverage for app utilities

**Files:**

- Modify: `remix-test.config.ts`

- [ ] **Step 1: Update test glob**

Replace `remix-test.config.ts` with:

```ts
import type { RemixTestConfig } from "remix/test";

export default {
    glob: {
        test: "app/**/*.test.{ts,tsx}",
        browser: "app/**/*.test.{ts,tsx}",
    },
    playwrightConfig: {
        projects: [
            {
                name: "chromium",
                use: { browserName: "chromium" },
            },
        ],
    },
} satisfies RemixTestConfig;
```

- [ ] **Step 2: Run test discovery**

Run:

```bash
pnpm remix-test --list
```

Expected: command exits successfully. It may list zero tests before the next task.

- [ ] **Step 3: Commit**

```bash
git add remix-test.config.ts
git commit -m "test: configure Remix tests for app utilities"
```

---

## Task 2: Add metadata types and identity rules

**Files:**

- Create: `app/utils/metadata/types.ts`

- Create: `app/utils/metadata/rules.ts`

- Create: `app/utils/metadata/index.ts`

- Test: `app/utils/metadata/rules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/utils/metadata/rules.test.ts`:

```ts
import assert from "remix/assert";
import { describe, it } from "remix/test";

import type { MetadataEntry } from "./types";

import { deriveEntryKey, getEntryLifecycle, isSupportedEntry, normalizeEntry } from "./rules";

function entry(type: MetadataEntry["type"], props: MetadataEntry["props"] = {}): MetadataEntry {
    return { type, props };
}

describe("metadata rules", () => {
    it("derives stable entry keys", () => {
        assert.equal(deriveEntryKey(entry("title")), "title");
        assert.equal(deriveEntryKey(entry("meta", { charset: "utf-8" })), "meta:charset");
        assert.equal(
            deriveEntryKey(entry("meta", { name: "description" })),
            "meta:name:description",
        );
        assert.equal(
            deriveEntryKey(entry("meta", { property: "og:title" })),
            "meta:property:og:title",
        );
        assert.equal(
            deriveEntryKey(entry("meta", { httpEquiv: "refresh" })),
            "meta:http-equiv:refresh",
        );
        assert.equal(
            deriveEntryKey(entry("link", { rel: "canonical", href: "/x" })),
            "link:canonical",
        );
        assert.equal(
            deriveEntryKey(entry("link", { rel: "preload", href: "/font.woff2" })),
            "link:preload:/font.woff2",
        );
        assert.equal(deriveEntryKey(entry("style", { href: "inline:x" })), "style:inline:x");
        assert.equal(
            deriveEntryKey(entry("script", { src: "/app.js", async: true })),
            "script:/app.js",
        );
    });

    it("honors explicit keys", () => {
        assert.equal(
            deriveEntryKey({ type: "meta", key: "custom", props: { name: "x" } }),
            "custom",
        );
    });

    it("rejects unsupported React 19 metadata/resource cases", () => {
        assert.equal(isSupportedEntry(entry("meta", { itemProp: "name", content: "A" })), false);
        assert.equal(
            isSupportedEntry(entry("link", { rel: "stylesheet", href: "/app.css" })),
            false,
        );
        assert.equal(
            isSupportedEntry(
                entry("link", { rel: "stylesheet", href: "/app.css", precedence: "base" }),
            ),
            true,
        );
        assert.equal(isSupportedEntry(entry("style", { href: "inline:x" })), false);
        assert.equal(
            isSupportedEntry(entry("style", { href: "inline:x", precedence: "component" })),
            true,
        );
        assert.equal(isSupportedEntry(entry("script", { src: "/sync.js" })), false);
        assert.equal(isSupportedEntry(entry("script", { src: "/async.js", async: true })), true);
    });

    it("assigns replaceable and sticky lifecycles", () => {
        assert.equal(getEntryLifecycle(entry("title")), "replaceable");
        assert.equal(getEntryLifecycle(entry("meta", { name: "description" })), "replaceable");
        assert.equal(
            getEntryLifecycle(entry("link", { rel: "canonical", href: "/x" })),
            "replaceable",
        );
        assert.equal(getEntryLifecycle(entry("link", { rel: "preload", href: "/x.js" })), "sticky");
        assert.equal(
            getEntryLifecycle(
                entry("link", { rel: "stylesheet", href: "/app.css", precedence: "base" }),
            ),
            "sticky",
        );
        assert.equal(
            getEntryLifecycle(entry("style", { href: "inline:x", precedence: "base" })),
            "sticky",
        );
        assert.equal(getEntryLifecycle(entry("script", { src: "/app.js", async: true })), "sticky");
    });

    it("normalizes supported entries and drops unsupported entries", () => {
        assert.deepEqual(normalizeEntry(entry("meta", { name: "description", content: "Hello" })), {
            type: "meta",
            props: { name: "description", content: "Hello" },
            key: "meta:name:description",
            lifecycle: "replaceable",
        });

        assert.equal(normalizeEntry(entry("script", { src: "/sync.js" })), null);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm remix-test app/utils/metadata/rules.test.ts
```

Expected: FAIL because `./rules` and `./types` do not exist.

- [ ] **Step 3: Add types**

Create `app/utils/metadata/types.ts`:

```ts
export type MetadataElementType = "title" | "meta" | "link" | "style" | "script";

export type MetadataLifecycle = "replaceable" | "sticky";

export type MetadataPrimitive = string | boolean | number | null | undefined;

export type MetadataProps = Record<string, MetadataPrimitive>;

export interface MetadataEntry {
    type: MetadataElementType;
    key?: string;
    props: MetadataProps;
    children?: string;
    order?: number;
    owner?: string;
    lifecycle?: MetadataLifecycle;
}

export interface NormalizedMetadataEntry extends MetadataEntry {
    key: string;
    lifecycle: MetadataLifecycle;
}

export interface MetadataManagerOptions {
    precedence?: string[];
    titleTemplate?: (title: string | null) => string;
}
```

- [ ] **Step 4: Add rules**

Create `app/utils/metadata/rules.ts`:

```ts
import type { MetadataEntry, MetadataLifecycle, NormalizedMetadataEntry } from "./types";

const RESOURCE_HINT_RELS = new Set(["dns-prefetch", "preconnect", "preload", "modulepreload"]);

function propString(entry: MetadataEntry, name: string): string | undefined {
    let value = entry.props[name];
    if (value === null || value === undefined || typeof value === "boolean") return undefined;
    return String(value);
}

function lowerProp(entry: MetadataEntry, name: string): string | undefined {
    return propString(entry, name)?.toLowerCase();
}

function hasProp(entry: MetadataEntry, name: string): boolean {
    return entry.props[name] !== null && entry.props[name] !== undefined;
}

export function deriveEntryKey(entry: MetadataEntry): string {
    if (entry.key) return entry.key;

    switch (entry.type) {
        case "title":
            return "title";

        case "meta": {
            if (hasProp(entry, "charset")) return "meta:charset";

            let name = lowerProp(entry, "name");
            if (name) return `meta:name:${name}`;

            let property = lowerProp(entry, "property");
            if (property) return `meta:property:${property}`;

            let httpEquiv = lowerProp(entry, "httpEquiv") ?? lowerProp(entry, "http-equiv");
            if (httpEquiv) return `meta:http-equiv:${httpEquiv}`;

            return "meta:unknown";
        }

        case "link": {
            let rel = lowerProp(entry, "rel");
            let href = propString(entry, "href");

            if (rel === "canonical") return "link:canonical";
            if (rel && href) return `link:${rel}:${href}`;

            return "link:unknown";
        }

        case "style": {
            let href = propString(entry, "href");
            return href ? `style:${href}` : "style:unknown";
        }

        case "script": {
            let src = propString(entry, "src");
            return src ? `script:${src}` : "script:unknown";
        }
    }
}

export function isSupportedEntry(entry: MetadataEntry): boolean {
    if (hasProp(entry, "itemProp")) return false;

    switch (entry.type) {
        case "title":
            return true;

        case "meta":
            return (
                hasProp(entry, "charset") ||
                hasProp(entry, "name") ||
                hasProp(entry, "property") ||
                hasProp(entry, "httpEquiv") ||
                hasProp(entry, "http-equiv")
            );

        case "link": {
            let rel = lowerProp(entry, "rel");
            let href = propString(entry, "href");
            if (!rel || !href) return false;
            if (rel === "stylesheet") return hasProp(entry, "precedence");
            return true;
        }

        case "style":
            return hasProp(entry, "href") && hasProp(entry, "precedence");

        case "script":
            return typeof entry.props.src === "string" && entry.props.async === true;
    }
}

export function getEntryLifecycle(entry: MetadataEntry): MetadataLifecycle {
    if (entry.lifecycle) return entry.lifecycle;

    if (entry.type === "script" || entry.type === "style") return "sticky";

    if (entry.type === "link") {
        let rel = lowerProp(entry, "rel");
        if (rel === "stylesheet" || (rel && RESOURCE_HINT_RELS.has(rel))) {
            return "sticky";
        }
    }

    return "replaceable";
}

export function normalizeEntry(entry: MetadataEntry): NormalizedMetadataEntry | null {
    if (!isSupportedEntry(entry)) return null;

    return {
        ...entry,
        key: deriveEntryKey(entry),
        lifecycle: getEntryLifecycle(entry),
    };
}

export function isResourceHint(entry: NormalizedMetadataEntry): boolean {
    return entry.type === "link" && RESOURCE_HINT_RELS.has(lowerProp(entry, "rel") ?? "");
}

export function getPrecedence(entry: NormalizedMetadataEntry): string | undefined {
    return propString(entry, "precedence");
}
```

- [ ] **Step 5: Add barrel exports**

Create `app/utils/metadata/index.ts`:

```ts
export type {
    MetadataElementType,
    MetadataEntry,
    MetadataLifecycle,
    MetadataManagerOptions,
    MetadataPrimitive,
    MetadataProps,
    NormalizedMetadataEntry,
} from "./types";

export {
    deriveEntryKey,
    getEntryLifecycle,
    getPrecedence,
    isResourceHint,
    isSupportedEntry,
    normalizeEntry,
} from "./rules";
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
pnpm remix-test app/utils/metadata/rules.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/utils/metadata
git commit -m "feat(metadata): add metadata rules"
```

---

## Task 3: Render normalized entries to managed head HTML

**Files:**

- Create: `app/utils/metadata/html.ts`

- Modify: `app/utils/metadata/index.ts`

- Test: `app/utils/metadata/html.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/utils/metadata/html.test.ts`:

```ts
import assert from "remix/assert";
import { describe, it } from "remix/test";

import type { NormalizedMetadataEntry } from "./types";

import { renderHeadEntriesToHtml, renderHeadEntryToHtml } from "./html";

function normalized(
    entry: Omit<NormalizedMetadataEntry, "owner" | "lifecycle"> & {
        owner?: string;
        lifecycle?: NormalizedMetadataEntry["lifecycle"];
    },
): NormalizedMetadataEntry {
    return {
        owner: "owner-1",
        lifecycle: "replaceable",
        ...entry,
    };
}

describe("head HTML rendering", () => {
    it("renders managed title with escaped text", () => {
        assert.equal(
            renderHeadEntryToHtml(
                normalized({
                    type: "title",
                    key: "title",
                    props: {},
                    children: "A < B",
                }),
            ),
            '<title data-pitlane-metadata-managed="true" data-pitlane-metadata-owner="owner-1" data-pitlane-metadata-key="title">A &lt; B</title>',
        );
    });

    it("renders managed meta with escaped attributes", () => {
        assert.equal(
            renderHeadEntryToHtml(
                normalized({
                    type: "meta",
                    key: "meta:name:description",
                    props: { name: "description", content: 'A "quote"' },
                }),
            ),
            '<meta data-pitlane-metadata-managed="true" data-pitlane-metadata-owner="owner-1" data-pitlane-metadata-key="meta:name:description" name="description" content="A &quot;quote&quot;">',
        );
    });

    it("renders sticky script lifecycle and boolean attributes", () => {
        assert.equal(
            renderHeadEntryToHtml(
                normalized({
                    type: "script",
                    key: "script:/app.js",
                    lifecycle: "sticky",
                    props: { src: "/app.js", async: true },
                }),
            ),
            '<script data-pitlane-metadata-managed="true" data-pitlane-metadata-owner="owner-1" data-pitlane-metadata-key="script:/app.js" data-pitlane-metadata-lifecycle="sticky" src="/app.js" async></script>',
        );
    });

    it("dedupes replaceable entries by last writer", () => {
        let html = renderHeadEntriesToHtml([
            normalized({ type: "title", key: "title", props: {}, children: "Old", order: 0 }),
            normalized({ type: "title", key: "title", props: {}, children: "New", order: 1 }),
        ]);

        assert.ok(html.includes(">New</title>"));
        assert.equal(html.includes(">Old</title>"), false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm remix-test app/utils/metadata/html.test.ts
```

Expected: FAIL because `./html` does not exist.

- [ ] **Step 3: Add implementation**

Create `app/utils/metadata/html.ts`:

```ts
import type { NormalizedMetadataEntry } from "./types";

import { getPrecedence, isResourceHint } from "./rules";

const VOID_ELEMENTS = new Set(["meta", "link"]);

function escapeText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
    return escapeText(value).replace(/"/g, "&quot;");
}

function renderAttributes(entry: NormalizedMetadataEntry): string {
    let attrs: string[] = [
        'data-pitlane-metadata-managed="true"',
        `data-pitlane-metadata-owner="${escapeAttribute(entry.owner ?? "document")}"`,
        `data-pitlane-metadata-key="${escapeAttribute(entry.key)}"`,
    ];

    if (entry.lifecycle === "sticky") {
        attrs.push('data-pitlane-metadata-lifecycle="sticky"');
    }

    for (let [name, value] of Object.entries(entry.props)) {
        if (name === "children" || name === "key") continue;
        if (value === null || value === undefined || value === false) continue;

        let htmlName = name === "httpEquiv" ? "http-equiv" : name;

        if (value === true) {
            attrs.push(htmlName);
            continue;
        }

        attrs.push(`${htmlName}="${escapeAttribute(String(value))}"`);
    }

    return attrs.join(" ");
}

export function renderHeadEntryToHtml(entry: NormalizedMetadataEntry): string {
    let attrs = renderAttributes(entry);

    if (VOID_ELEMENTS.has(entry.type)) {
        return `<${entry.type} ${attrs}>`;
    }

    return `<${entry.type} ${attrs}>${escapeText(entry.children ?? "")}</${entry.type}>`;
}

function getEntryBucket(entry: NormalizedMetadataEntry): number {
    if (entry.type === "meta" && entry.props.charset) return 0;
    if (isResourceHint(entry)) return 1;
    if (entry.type === "link" && String(entry.props.rel).toLowerCase() === "stylesheet") return 2;
    if (entry.type === "style") return 2;
    if (entry.type === "meta") return 3;
    if (entry.type === "title") return 4;
    if (entry.type === "link" && String(entry.props.rel).toLowerCase() === "canonical") return 4;
    if (entry.type === "script") return 5;
    return 3;
}

export function collectPrecedenceOrder(
    entries: NormalizedMetadataEntry[],
    initialOrder: string[] = [],
): string[] {
    let order = [...initialOrder];

    for (let entry of entries) {
        let precedence = getPrecedence(entry);
        if (precedence && !order.includes(precedence)) {
            order.push(precedence);
        }
    }

    return order;
}

function compareEntries(
    left: NormalizedMetadataEntry,
    right: NormalizedMetadataEntry,
    precedenceOrder: string[],
): number {
    let bucketDiff = getEntryBucket(left) - getEntryBucket(right);
    if (bucketDiff !== 0) return bucketDiff;

    let leftPrecedence = getPrecedence(left);
    let rightPrecedence = getPrecedence(right);

    if (leftPrecedence || rightPrecedence) {
        let leftIndex = leftPrecedence ? precedenceOrder.indexOf(leftPrecedence) : -1;
        let rightIndex = rightPrecedence ? precedenceOrder.indexOf(rightPrecedence) : -1;
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    }

    return (left.order ?? 0) - (right.order ?? 0);
}

export function dedupeEntries(entries: NormalizedMetadataEntry[]): NormalizedMetadataEntry[] {
    let byKey = new Map<string, NormalizedMetadataEntry>();

    for (let entry of entries) {
        if (entry.lifecycle === "sticky" && byKey.has(entry.key)) continue;
        byKey.set(entry.key, entry);
    }

    return [...byKey.values()];
}

export function renderHeadEntriesToHtml(
    entries: NormalizedMetadataEntry[],
    options: { precedence?: string[] } = {},
): string {
    let precedenceOrder = collectPrecedenceOrder(entries, options.precedence);

    return dedupeEntries(entries)
        .sort((left, right) => compareEntries(left, right, precedenceOrder))
        .map(renderHeadEntryToHtml)
        .join("");
}
```

- [ ] **Step 4: Export implementation**

Modify `app/utils/metadata/index.ts`:

```ts
export type {
    MetadataElementType,
    MetadataEntry,
    MetadataLifecycle,
    MetadataManagerOptions,
    MetadataPrimitive,
    MetadataProps,
    NormalizedMetadataEntry,
} from "./types";

export {
    deriveEntryKey,
    getEntryLifecycle,
    getPrecedence,
    isResourceHint,
    isSupportedEntry,
    normalizeEntry,
} from "./rules";

export {
    collectPrecedenceOrder,
    dedupeEntries,
    renderHeadEntriesToHtml,
    renderHeadEntryToHtml,
} from "./html";
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm remix-test app/utils/metadata/html.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/utils/metadata
git commit -m "feat(metadata): render managed head HTML"
```

---

## Task 4: Add transport template serialization

**Files:**

- Create: `app/utils/metadata/transport.ts`

- Modify: `app/utils/metadata/index.ts`

- Test: `app/utils/metadata/transport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/utils/metadata/transport.test.ts`:

```ts
import assert from "remix/assert";
import { describe, it } from "remix/test";

import {
    createTransportHtml,
    extractTransportTemplates,
    parseTransportTemplate,
    stripTransportTemplates,
} from "./transport";

describe("metadata transport", () => {
    it("serializes entries into an inert template", () => {
        let html = createTransportHtml({
            owner: "owner-1",
            entries: [{ type: "title", props: {}, children: "A < B" }],
        });

        assert.ok(html.includes('<template data-pitlane-metadata="true"'));
        assert.ok(html.includes('data-pitlane-metadata-owner="owner-1"'));
        assert.ok(html.includes("\\u003c"));
    });

    it("parses template HTML back into entries", () => {
        let html = createTransportHtml({
            owner: "owner-1",
            entries: [{ type: "title", props: {}, children: "Hello" }],
        });

        assert.deepEqual(parseTransportTemplate(html), {
            owner: "owner-1",
            entries: [{ type: "title", props: {}, children: "Hello" }],
        });
    });

    it("extracts and strips templates", () => {
        let one = createTransportHtml({
            owner: "one",
            entries: [{ type: "title", props: {}, children: "One" }],
        });
        let two = createTransportHtml({
            owner: "two",
            entries: [{ type: "meta", props: { name: "description", content: "Two" } }],
        });
        let html = `<html><body>${one}<main>x</main>${two}</body></html>`;

        assert.deepEqual(extractTransportTemplates(html), [
            { owner: "one", entries: [{ type: "title", props: {}, children: "One" }] },
            {
                owner: "two",
                entries: [{ type: "meta", props: { name: "description", content: "Two" } }],
            },
        ]);
        assert.equal(stripTransportTemplates(html), "<html><body><main>x</main></body></html>");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm remix-test app/utils/metadata/transport.test.ts
```

Expected: FAIL because `./transport` does not exist.

- [ ] **Step 3: Add implementation**

Create `app/utils/metadata/transport.ts`:

```ts
import type { MetadataEntry } from "./types";

export interface MetadataTransportPayload {
    owner: string;
    entries: MetadataEntry[];
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function decodeAttribute(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");
}

function safeJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

const TEMPLATE_RE =
    /<template\b(?=[^>]*\bdata-pitlane-metadata=["']true["'])([^>]*)>([\s\S]*?)<\/template>/gi;

const OWNER_RE = /\bdata-pitlane-metadata-owner=["']([^"']+)["']/i;

const JSON_RE = /<script\b(?=[^>]*\bdata-pitlane-metadata-json\b)[^>]*>([\s\S]*?)<\/script>/i;

export function createTransportHtml(payload: MetadataTransportPayload): string {
    return `<template data-pitlane-metadata="true" data-pitlane-metadata-owner="${escapeAttribute(
        payload.owner,
    )}"><script type="application/json" data-pitlane-metadata-json>${safeJson(
        payload.entries,
    )}</script></template>`;
}

export function parseTransportTemplate(templateHtml: string): MetadataTransportPayload | null {
    let open = templateHtml.match(/^<template\b([^>]*)>/i);
    if (!open) return null;

    let ownerMatch = open[1].match(OWNER_RE);
    if (!ownerMatch) return null;

    let jsonMatch = templateHtml.match(JSON_RE);
    if (!jsonMatch) return null;

    try {
        let entries = JSON.parse(jsonMatch[1]) as MetadataEntry[];
        if (!Array.isArray(entries)) return null;
        return { owner: decodeAttribute(ownerMatch[1]), entries };
    } catch {
        return null;
    }
}

export function extractTransportTemplates(html: string): MetadataTransportPayload[] {
    let payloads: MetadataTransportPayload[] = [];

    for (let match of html.matchAll(TEMPLATE_RE)) {
        let payload = parseTransportTemplate(match[0]);
        if (payload) payloads.push(payload);
    }

    return payloads;
}

export function stripTransportTemplates(html: string): string {
    return html.replace(TEMPLATE_RE, "");
}
```

- [ ] **Step 4: Export implementation**

Modify `app/utils/metadata/index.ts`:

```ts
export type {
    MetadataElementType,
    MetadataEntry,
    MetadataLifecycle,
    MetadataManagerOptions,
    MetadataPrimitive,
    MetadataProps,
    NormalizedMetadataEntry,
} from "./types";

export {
    deriveEntryKey,
    getEntryLifecycle,
    getPrecedence,
    isResourceHint,
    isSupportedEntry,
    normalizeEntry,
} from "./rules";

export {
    collectPrecedenceOrder,
    dedupeEntries,
    renderHeadEntriesToHtml,
    renderHeadEntryToHtml,
} from "./html";

export type { MetadataTransportPayload } from "./transport";
export {
    createTransportHtml,
    extractTransportTemplates,
    parseTransportTemplate,
    stripTransportTemplates,
} from "./transport";
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm remix-test app/utils/metadata/transport.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/utils/metadata
git commit -m "feat(metadata): add metadata transport templates"
```

---

## Task 5: Add `<Head>` with lowercase metadata children

**Files:**

- Create: `app/utils/metadata/head.tsx`

- Modify: `app/utils/metadata/index.ts`

- Test: `app/utils/metadata/head.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/utils/metadata/head.test.tsx`:

```tsx
// @jsxRuntime classic
// @jsx createElement
import assert from "remix/assert";
import { describe, it } from "remix/test";
import { createElement, type RemixElement } from "remix/ui";
import { renderToString } from "remix/ui/server";

import { Head, entriesFromHeadChildren } from "./head";
import { extractTransportTemplates } from "./transport";

async function render(node: RemixElement): Promise<string> {
    return await renderToString(node);
}

describe("<Head>", () => {
    it("extracts lowercase metadata children", () => {
        let entries = entriesFromHeadChildren([
            <title>Page</title>,
            <meta name="description" content="Description" />,
            <link rel="canonical" href="/page" />,
        ]);

        assert.deepEqual(entries, [
            { type: "title", props: {}, children: "Page", order: 0 },
            { type: "meta", props: { name: "description", content: "Description" }, order: 1 },
            { type: "link", props: { rel: "canonical", href: "/page" }, order: 2 },
        ]);
    });

    it("renders a transport template", async () => {
        let html = await render(
            <html>
                <head></head>
                <body>
                    <Head owner="page">
                        <title>Page</title>
                        <meta name="description" content="Description" />
                        <link rel="canonical" href="/page" />
                    </Head>
                </body>
            </html>,
        );

        assert.deepEqual(extractTransportTemplates(html), [
            {
                owner: "page",
                entries: [
                    { type: "title", props: {}, children: "Page", order: 0 },
                    {
                        type: "meta",
                        props: { name: "description", content: "Description" },
                        order: 1,
                    },
                    { type: "link", props: { rel: "canonical", href: "/page" }, order: 2 },
                ],
            },
        ]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm remix-test app/utils/metadata/head.test.tsx
```

Expected: FAIL because `./head` does not exist.

- [ ] **Step 3: Add implementation**

Create `app/utils/metadata/head.tsx`:

```tsx
// @jsxRuntime classic
// @jsx createElement
import { createElement, type Handle, type RemixNode } from "remix/ui";

import type { MetadataElementType, MetadataEntry, MetadataProps } from "./types";

import { createTransportHtml } from "./transport";

export interface HeadProps {
    children?: RemixNode;
    owner?: string;
}

type RemixLikeElement = {
    type: unknown;
    key?: unknown;
    props?: Record<string, unknown>;
};

const SUPPORTED_TYPES = new Set<MetadataElementType>(["title", "meta", "link", "style", "script"]);

function isElement(value: unknown): value is RemixLikeElement {
    return typeof value === "object" && value !== null && "type" in value;
}

function flattenChildren(children: RemixNode): unknown[] {
    if (children === null || children === undefined || typeof children === "boolean") return [];
    if (Array.isArray(children))
        return children.flatMap(child => flattenChildren(child as RemixNode));
    return [children];
}

function textFromChildren(children: unknown): string | undefined {
    if (children === null || children === undefined || typeof children === "boolean")
        return undefined;

    if (Array.isArray(children)) {
        return children
            .map(child => textFromChildren(child))
            .filter((value): value is string => value !== undefined)
            .join("");
    }

    if (
        typeof children === "string" ||
        typeof children === "number" ||
        typeof children === "bigint"
    ) {
        return String(children);
    }

    return undefined;
}

function propsFromElement(element: RemixLikeElement): MetadataProps {
    let props: MetadataProps = {};

    for (let [name, value] of Object.entries(element.props ?? {})) {
        if (name === "children") continue;

        if (
            value === null ||
            value === undefined ||
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
        ) {
            props[name] = value;
        }
    }

    return props;
}

export function entriesFromHeadChildren(children: RemixNode): MetadataEntry[] {
    let entries: MetadataEntry[] = [];
    let order = 0;

    for (let child of flattenChildren(children)) {
        if (!isElement(child)) continue;
        if (typeof child.type !== "string") continue;
        if (!SUPPORTED_TYPES.has(child.type as MetadataElementType)) continue;

        let entry: MetadataEntry = {
            type: child.type as MetadataElementType,
            props: propsFromElement(child),
            order,
        };

        if (typeof child.key === "string" || typeof child.key === "number") {
            entry.key = String(child.key);
        }

        let childrenText = textFromChildren(child.props?.children);
        if (childrenText !== undefined) {
            entry.children = childrenText;
        }

        entries.push(entry);
        order++;
    }

    return entries;
}

export function Head(handle: Handle<HeadProps>) {
    return () => {
        let owner = handle.props.owner ?? handle.id;
        let entries = entriesFromHeadChildren(handle.props.children);
        let html = createTransportHtml({ owner, entries });

        return createElement("template", {
            "data-pitlane-metadata": "true",
            "data-pitlane-metadata-owner": owner,
            innerHTML: html.replace(/^<template\b[^>]*>/i, "").replace(/<\/template>$/i, ""),
        });
    };
}
```

- [ ] **Step 4: Export implementation**

Modify `app/utils/metadata/index.ts`:

```ts
export type {
    MetadataElementType,
    MetadataEntry,
    MetadataLifecycle,
    MetadataManagerOptions,
    MetadataPrimitive,
    MetadataProps,
    NormalizedMetadataEntry,
} from "./types";

export {
    deriveEntryKey,
    getEntryLifecycle,
    getPrecedence,
    isResourceHint,
    isSupportedEntry,
    normalizeEntry,
} from "./rules";

export {
    collectPrecedenceOrder,
    dedupeEntries,
    renderHeadEntriesToHtml,
    renderHeadEntryToHtml,
} from "./html";

export type { MetadataTransportPayload } from "./transport";
export {
    createTransportHtml,
    extractTransportTemplates,
    parseTransportTemplate,
    stripTransportTemplates,
} from "./transport";

export { Head, entriesFromHeadChildren } from "./head";
export type { HeadProps } from "./head";
```

- [ ] **Step 5: Fix barrel syntax**

Replace the final export block in `app/utils/metadata/index.ts` with:

```ts
export { Head, entriesFromHeadChildren } from "./head";
export type { HeadProps } from "./head";
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
pnpm remix-test app/utils/metadata/head.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/utils/metadata
git commit -m "feat(metadata): add lowercase Head API"
```

---

## Task 6: Add SSR injection helpers

**Files:**

- Create: `app/utils/metadata/ssr.ts`

- Modify: `app/utils/metadata/index.ts`

- Test: `app/utils/metadata/ssr.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/utils/metadata/ssr.test.ts`:

```ts
import assert from "remix/assert";
import { describe, it } from "remix/test";

import { collectNormalizedEntriesFromHtml, injectMetadataIntoHtml } from "./ssr";
import { createTransportHtml } from "./transport";

describe("SSR metadata injection", () => {
    it("collects normalized entries from transport templates", () => {
        let marker = createTransportHtml({
            owner: "page",
            entries: [{ type: "title", props: {}, children: "Page" }],
        });

        assert.deepEqual(collectNormalizedEntriesFromHtml(marker), [
            {
                type: "title",
                props: {},
                children: "Page",
                owner: "page",
                key: "title",
                lifecycle: "replaceable",
            },
        ]);
    });

    it("injects supported metadata before closing head", () => {
        let marker = createTransportHtml({
            owner: "page",
            entries: [
                { type: "title", props: {}, children: "Page", order: 0 },
                { type: "meta", props: { name: "description", content: "Description" }, order: 1 },
            ],
        });

        let html = injectMetadataIntoHtml(`<html><head></head><body>${marker}</body></html>`);

        assert.ok(html.includes('<meta data-pitlane-metadata-managed="true"'));
        assert.ok(html.includes('<title data-pitlane-metadata-managed="true"'));
        assert.ok(html.includes(">Page</title>"));
        assert.ok(html.includes(marker));
    });

    it("throws when there is no document head", () => {
        assert.throws(() => injectMetadataIntoHtml("<html><body></body></html>"), {
            message: "Cannot inject metadata: missing closing </head> tag",
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm remix-test app/utils/metadata/ssr.test.ts
```

Expected: FAIL because `./ssr` does not exist.

- [ ] **Step 3: Add implementation**

Create `app/utils/metadata/ssr.ts`:

```ts
import type { MetadataManagerOptions, NormalizedMetadataEntry } from "./types";

import { renderHeadEntriesToHtml } from "./html";
import { normalizeEntry } from "./rules";
import { extractTransportTemplates } from "./transport";

export function collectNormalizedEntriesFromHtml(html: string): NormalizedMetadataEntry[] {
    let entries: NormalizedMetadataEntry[] = [];

    for (let payload of extractTransportTemplates(html)) {
        for (let entry of payload.entries) {
            let normalized = normalizeEntry({
                ...entry,
                owner: payload.owner,
            });

            if (normalized) entries.push(normalized);
        }
    }

    return entries;
}

export function injectMetadataIntoHtml(html: string, options: MetadataManagerOptions = {}): string {
    let entries = collectNormalizedEntriesFromHtml(html);
    if (entries.length === 0) return html;

    let closingHeadIndex = html.search(/<\/head\s*>/i);
    if (closingHeadIndex === -1) {
        throw new Error("Cannot inject metadata: missing closing </head> tag");
    }

    let headHtml = renderHeadEntriesToHtml(entries, {
        precedence: options.precedence,
    });

    return `${html.slice(0, closingHeadIndex)}${headHtml}${html.slice(closingHeadIndex)}`;
}
```

- [ ] **Step 4: Export implementation**

Append to `app/utils/metadata/index.ts`:

```ts
export { collectNormalizedEntriesFromHtml, injectMetadataIntoHtml } from "./ssr";
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm remix-test app/utils/metadata/ssr.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/utils/metadata
git commit -m "feat(metadata): inject SSR metadata"
```

---

## Task 7: Add stream wrapper for `renderToStream()`

**Files:**

- Create: `app/utils/metadata/stream.ts`

- Modify: `app/utils/metadata/index.ts`

- Test: `app/utils/metadata/stream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/utils/metadata/stream.test.ts`:

```ts
import assert from "remix/assert";
import { describe, it } from "remix/test";

import { renderWithMetadata, stringToStream, streamToString } from "./stream";
import { createTransportHtml } from "./transport";

describe("metadata stream wrapper", () => {
    it("converts strings to streams and streams to strings", async () => {
        assert.equal(await streamToString(stringToStream("hello")), "hello");
    });

    it("injects metadata into a render stream", async () => {
        let marker = createTransportHtml({
            owner: "page",
            entries: [{ type: "title", props: {}, children: "Streamed" }],
        });

        let stream = await renderWithMetadata(
            Promise.resolve(stringToStream(`<html><head></head><body>${marker}</body></html>`)),
        );

        let html = await streamToString(stream);

        assert.ok(html.includes("<title"));
        assert.ok(html.includes(">Streamed</title>"));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm remix-test app/utils/metadata/stream.test.ts
```

Expected: FAIL because `./stream` does not exist.

- [ ] **Step 3: Add implementation**

Create `app/utils/metadata/stream.ts`:

```ts
import type { MetadataManagerOptions } from "./types";

import { injectMetadataIntoHtml } from "./ssr";

export function stringToStream(value: string): ReadableStream<Uint8Array> {
    let encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encoder.encode(value));
            controller.close();
        },
    });
}

export async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
    let reader = stream.getReader();
    let decoder = new TextDecoder();
    let chunks: string[] = [];

    while (true) {
        let read = await reader.read();
        if (read.done) break;
        chunks.push(decoder.decode(read.value, { stream: true }));
    }

    chunks.push(decoder.decode());
    return chunks.join("");
}

export async function renderWithMetadata(
    streamOrPromise: ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>,
    options: MetadataManagerOptions = {},
): Promise<ReadableStream<Uint8Array>> {
    let stream = await streamOrPromise;
    let html = await streamToString(stream);
    return stringToStream(injectMetadataIntoHtml(html, options));
}
```

- [ ] **Step 4: Export implementation**

Append to `app/utils/metadata/index.ts`:

```ts
export { renderWithMetadata, streamToString, stringToStream } from "./stream";
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm remix-test app/utils/metadata/stream.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/utils/metadata
git commit -m "feat(metadata): add render stream metadata wrapper"
```

---

## Task 8: Add client-side metadata manager

**Files:**

- Create: `app/utils/metadata/manager.ts`

- Modify: `app/utils/metadata/index.ts`

- Test: `app/utils/metadata/manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/utils/metadata/manager.test.ts`:

```ts
import assert from "remix/assert";
import { describe, it } from "remix/test";

import { MetadataManager } from "./manager";
import { createTransportHtml } from "./transport";

function setDocument(html: string) {
    document.documentElement.innerHTML = html;
}

async function nextMicrotask() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("MetadataManager", () => {
    it("hydrates templates into document.head", () => {
        setDocument(
            `<head></head><body>${createTransportHtml({
                owner: "page",
                entries: [
                    { type: "title", props: {}, children: "Page" },
                    { type: "meta", props: { name: "description", content: "Description" } },
                ],
            })}</body>`,
        );

        let manager = new MetadataManager();
        manager.hydrate(document);

        assert.equal(document.head.querySelector("title")?.textContent, "Page");
        assert.equal(
            document.head.querySelector('meta[name="description"]')?.getAttribute("content"),
            "Description",
        );

        manager.dispose();
    });

    it("removes replaceable entries when an owner disappears", async () => {
        setDocument(
            `<head></head><body><div id="frame">${createTransportHtml({
                owner: "frame",
                entries: [{ type: "meta", props: { name: "description", content: "Frame" } }],
            })}</div></body>`,
        );

        let manager = new MetadataManager();
        manager.hydrate(document);

        assert.notEqual(document.head.querySelector('meta[name="description"]'), null);

        document.getElementById("frame")?.remove();
        await nextMicrotask();

        assert.equal(document.head.querySelector('meta[name="description"]'), null);

        manager.dispose();
    });

    it("keeps sticky resources when an owner disappears", async () => {
        setDocument(
            `<head></head><body><div id="frame">${createTransportHtml({
                owner: "frame",
                entries: [
                    { type: "script", props: { src: "/app.js", async: true } },
                    {
                        type: "link",
                        props: { rel: "stylesheet", href: "/app.css", precedence: "base" },
                    },
                ],
            })}</div></body>`,
        );

        let manager = new MetadataManager();
        manager.hydrate(document);

        document.getElementById("frame")?.remove();
        await nextMicrotask();

        assert.notEqual(document.head.querySelector('script[src="/app.js"]'), null);
        assert.notEqual(document.head.querySelector('link[href="/app.css"]'), null);

        manager.dispose();
    });

    it("updates replaceable entries when a template changes", async () => {
        setDocument(
            `<head></head><body><div id="root">${createTransportHtml({
                owner: "page",
                entries: [{ type: "title", props: {}, children: "Old" }],
            })}</div></body>`,
        );

        let manager = new MetadataManager();
        manager.hydrate(document);

        document.getElementById("root")!.innerHTML = createTransportHtml({
            owner: "page",
            entries: [{ type: "title", props: {}, children: "New" }],
        });

        await nextMicrotask();

        assert.equal(document.head.querySelector("title")?.textContent, "New");

        manager.dispose();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm remix-test app/utils/metadata/manager.test.ts
```

Expected: FAIL because `./manager` does not exist.

- [ ] **Step 3: Add implementation**

Create `app/utils/metadata/manager.ts`:

```ts
import type { MetadataManagerOptions, NormalizedMetadataEntry } from "./types";

import { dedupeEntries, renderHeadEntryToHtml } from "./html";
import { normalizeEntry } from "./rules";

interface ExistingManagedNode {
    node: Element;
    owner: string;
    key: string;
    lifecycle: "replaceable" | "sticky";
}

function cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
    }

    return value.replace(/["\\]/g, "\\$&");
}

function parseTemplateElement(template: HTMLTemplateElement): NormalizedMetadataEntry[] {
    let owner = template.getAttribute("data-pitlane-metadata-owner");
    if (!owner) return [];

    let json = template.content.querySelector("[data-pitlane-metadata-json]")?.textContent;
    if (!json) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return [];
    }

    if (!Array.isArray(parsed)) return [];

    let entries: NormalizedMetadataEntry[] = [];

    for (let raw of parsed) {
        let normalized = normalizeEntry({
            ...(raw as object),
            owner,
        } as NormalizedMetadataEntry);

        if (normalized) entries.push(normalized);
    }

    return entries;
}

function nodeToManaged(node: Element): ExistingManagedNode | null {
    let owner = node.getAttribute("data-pitlane-metadata-owner");
    let key = node.getAttribute("data-pitlane-metadata-key");
    let lifecycle =
        node.getAttribute("data-pitlane-metadata-lifecycle") === "sticky"
            ? "sticky"
            : "replaceable";

    if (!owner || !key) return null;

    return { node, owner, key, lifecycle };
}

function domNodeFromHtml(document: Document, html: string): Element {
    let template = document.createElement("template");
    template.innerHTML = html;

    let node = template.content.firstElementChild;
    if (!node) throw new Error("Could not create metadata DOM node from HTML");

    return node;
}

export class MetadataManager {
    #document: Document | null = null;
    #observer: MutationObserver | null = null;
    #scheduled = false;
    #options: MetadataManagerOptions;

    constructor(options: MetadataManagerOptions = {}) {
        this.#options = options;
    }

    hydrate(document: Document = window.document): void {
        this.dispose();
        this.#document = document;
        this.sync();

        this.#observer = new MutationObserver(() => {
            this.#scheduleSync();
        });

        this.#observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    dispose(): void {
        this.#observer?.disconnect();
        this.#observer = null;
        this.#document = null;
        this.#scheduled = false;
    }

    #scheduleSync(): void {
        if (this.#scheduled) return;
        this.#scheduled = true;

        queueMicrotask(() => {
            this.#scheduled = false;
            this.sync();
        });
    }

    sync(): void {
        let document = this.#document;
        if (!document) return;

        let desiredEntries = dedupeEntries(this.#readActiveEntries(document));
        let desiredKeys = new Set(
            desiredEntries.map(entry => `${entry.owner ?? "document"}:${entry.key}`),
        );

        let existing = [...document.head.querySelectorAll('[data-pitlane-metadata-managed="true"]')]
            .map(nodeToManaged)
            .filter((value): value is ExistingManagedNode => value !== null);

        for (let item of existing) {
            let fullKey = `${item.owner}:${item.key}`;
            if (desiredKeys.has(fullKey)) continue;
            if (item.lifecycle === "sticky") continue;
            item.node.remove();
        }

        for (let entry of desiredEntries) {
            this.#upsertEntry(document, entry);
        }
    }

    #readActiveEntries(document: Document): NormalizedMetadataEntry[] {
        let entries: NormalizedMetadataEntry[] = [];

        for (let template of document.querySelectorAll<HTMLTemplateElement>(
            'template[data-pitlane-metadata="true"]',
        )) {
            entries.push(...parseTemplateElement(template));
        }

        return entries;
    }

    #upsertEntry(document: Document, entry: NormalizedMetadataEntry): void {
        let owner = entry.owner ?? "document";
        let selector = `[data-pitlane-metadata-managed="true"][data-pitlane-metadata-owner="${cssEscape(
            owner,
        )}"][data-pitlane-metadata-key="${cssEscape(entry.key)}"]`;

        let current = document.head.querySelector(selector);
        let next = domNodeFromHtml(document, renderHeadEntryToHtml(entry));

        if (current) {
            if (current.outerHTML !== next.outerHTML) {
                current.replaceWith(next);
            }
            return;
        }

        document.head.append(next);
    }
}

export function createMetadataManager(options: MetadataManagerOptions = {}): MetadataManager {
    return new MetadataManager(options);
}
```

- [ ] **Step 4: Export implementation**

Append to `app/utils/metadata/index.ts`:

```ts
export { MetadataManager, createMetadataManager } from "./manager";
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm remix-test app/utils/metadata/manager.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/utils/metadata
git commit -m "feat(metadata): add client metadata manager"
```

---

## Task 9: Add frame response helpers

**Files:**

- Create: `app/utils/metadata/frames.ts`

- Modify: `app/utils/metadata/index.ts`

- Test: `app/utils/metadata/frames.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/utils/metadata/frames.test.ts`:

```ts
import assert from "remix/assert";
import { describe, it } from "remix/test";

import { normalizeFrameHtml, withMetadataFrames } from "./frames";
import { streamToString, stringToStream } from "./stream";

describe("frame metadata helpers", () => {
    it("leaves fragments alone", () => {
        assert.equal(normalizeFrameHtml("<section>Frame</section>"), "<section>Frame</section>");
    });

    it("unwraps full document frame responses to body content", () => {
        assert.equal(
            normalizeFrameHtml(
                "<html><head><title>Ignore</title></head><body><p>Frame</p></body></html>",
            ),
            "<p>Frame</p>",
        );
    });

    it("wraps string frame responses", async () => {
        let resolve = withMetadataFrames(
            async () => "<html><head></head><body><p>Frame</p></body></html>",
        );
        let result = await resolve("/frame", new AbortController().signal);

        assert.equal(result, "<p>Frame</p>");
    });

    it("wraps stream frame responses", async () => {
        let resolve = withMetadataFrames(async () =>
            stringToStream("<html><head></head><body><p>Frame</p></body></html>"),
        );
        let result = await resolve("/frame", new AbortController().signal);

        assert.ok(result instanceof ReadableStream);
        assert.equal(await streamToString(result as ReadableStream<Uint8Array>), "<p>Frame</p>");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm remix-test app/utils/metadata/frames.test.ts
```

Expected: FAIL because `./frames` does not exist.

- [ ] **Step 3: Add implementation**

Create `app/utils/metadata/frames.ts`:

```ts
import { streamToString, stringToStream } from "./stream";

export type MetadataFrameResponse = string | ReadableStream<Uint8Array>;

export type MetadataResolveFrame = (
    src: string,
    signal: AbortSignal,
    target?: string | null,
    context?: unknown,
) => MetadataFrameResponse | Promise<MetadataFrameResponse>;

const BODY_RE = /<body\b[^>]*>([\s\S]*?)<\/body>/i;

export function normalizeFrameHtml(html: string): string {
    let bodyMatch = html.match(BODY_RE);
    return bodyMatch ? bodyMatch[1] : html;
}

export function withMetadataFrames(resolveFrame: MetadataResolveFrame): MetadataResolveFrame {
    return async (src, signal, target, context) => {
        let result = await resolveFrame(src, signal, target, context);

        if (typeof result === "string") {
            return normalizeFrameHtml(result);
        }

        let html = await streamToString(result);
        return stringToStream(normalizeFrameHtml(html));
    };
}
```

- [ ] **Step 4: Export implementation**

Append to `app/utils/metadata/index.ts`:

```ts
export type { MetadataFrameResponse, MetadataResolveFrame } from "./frames";
export { normalizeFrameHtml, withMetadataFrames } from "./frames";
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm remix-test app/utils/metadata/frames.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/utils/metadata
git commit -m "feat(metadata): add frame metadata helpers"
```

---

## Task 10: Add Remix UI integration test

**Files:**

- Create: `app/utils/metadata/integration.test.tsx`

- [ ] **Step 1: Write integration test**

Create `app/utils/metadata/integration.test.tsx`:

```tsx
// @jsxRuntime classic
// @jsx createElement
import assert from "remix/assert";
import { describe, it } from "remix/test";
import { createElement, type Handle, type RemixNode } from "remix/ui";
import { renderToString } from "remix/ui/server";

import { Head, createMetadataManager, injectMetadataIntoHtml } from "./index";

function Layout(handle: Handle<{ children?: RemixNode }>) {
    return () => (
        <html>
            <head>
                <meta charset="utf-8" />
            </head>
            <body>{handle.props.children}</body>
        </html>
    );
}

function ChildPage() {
    return () => (
        <>
            <Head owner="child-page">
                <title>Child Page</title>
                <meta name="description" content="Child description" />
                <link rel="canonical" href="/child" />
            </Head>

            <main>Child page</main>
        </>
    );
}

async function nextMicrotask() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("metadata integration", () => {
    it("injects child metadata into SSR document head", async () => {
        let raw = await renderToString(
            <Layout>
                <ChildPage />
            </Layout>,
        );

        let html = injectMetadataIntoHtml(raw);

        assert.ok(html.includes('<meta charset="utf-8"'));
        assert.ok(html.includes("<title"));
        assert.ok(html.includes(">Child Page</title>"));
        assert.ok(html.includes('name="description"'));
        assert.ok(html.includes('href="/child"'));
        assert.ok(html.includes('data-pitlane-metadata-owner="child-page"'));
    });

    it("hydrates templates and removes replaceable metadata when the owner disappears", async () => {
        let raw = await renderToString(
            <Layout>
                <div id="frame">
                    <ChildPage />
                </div>
            </Layout>,
        );

        document.documentElement.innerHTML = raw.replace(/^<html>|<\/html>$/g, "");

        let manager = createMetadataManager();
        manager.hydrate(document);

        assert.equal(document.head.querySelector("title")?.textContent, "Child Page");

        document.getElementById("frame")?.remove();
        await nextMicrotask();

        assert.equal(document.head.querySelector("title"), null);

        manager.dispose();
    });
});
```

- [ ] **Step 2: Run integration test**

Run:

```bash
pnpm remix-test app/utils/metadata/integration.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run all metadata tests**

Run:

```bash
pnpm remix-test app/utils/metadata
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/utils/metadata/integration.test.tsx
git commit -m "test(metadata): cover Remix UI integration"
```

---

## Task 11: Add app usage wiring docs

**Files:**

- Create: `app/utils/metadata/README.md`

- [ ] **Step 1: Add README**

Create `app/utils/metadata/README.md`:

````md
# Metadata utilities

Frame-aware document metadata utilities for Remix UI.

## Component usage

Use lowercase document metadata tags inside `<Head>`:

```tsx
import { Head } from "~/utils/metadata";

function ProductPage(handle) {
    return () => (
        <>
            <Head>
                <title>{handle.props.product.name}</title>
                <meta name="description" content={handle.props.product.description} />
                <meta property="og:title" content={handle.props.product.name} />
                <link rel="canonical" href={`/products/${handle.props.product.slug}`} />
            </Head>

            <main>
                <h1>{handle.props.product.name}</h1>
            </main>
        </>
    );
}
```

## Server usage

Wrap `renderToStream()` with `renderWithMetadata()`:

```tsx
import { renderToStream } from "remix/ui/server";

import { renderWithMetadata, withMetadataFrames } from "~/utils/metadata";

export async function render(request: Request) {
    let stream = await renderWithMetadata(
        renderToStream(<App />, {
            frameSrc: request.url,
            resolveFrame: withMetadataFrames(async (src, signal, target, context) => {
                let url = new URL(src, context?.currentFrameSrc ?? request.url);
                let response = await fetch(url, {
                    headers: {
                        Accept: "text/html",
                        ...(target ? { "X-Remix-Target": target } : {}),
                    },
                    signal,
                });

                return response.body ?? (await response.text());
            }),
        }),
        {
            precedence: ["reset", "base", "theme", "route", "component"],
        },
    );

    return new Response(stream, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
        },
    });
}
```

## Client usage

Hydrate the metadata manager before or near Remix UI runtime startup:

```ts
import { run } from "remix/ui";

import { createMetadataManager, withMetadataFrames } from "~/utils/metadata";

let metadata = createMetadataManager({
    precedence: ["reset", "base", "theme", "route", "component"],
});

metadata.hydrate(document);

let app = run({
    async loadModule(moduleUrl, exportName) {
        let mod = await import(moduleUrl);
        return mod[exportName];
    },

    resolveFrame: withMetadataFrames(async (src, signal, target) => {
        let response = await fetch(src, {
            headers: {
                Accept: "text/html",
                ...(target ? { "X-Remix-Target": target } : {}),
            },
            signal,
        });

        return response.body ?? (await response.text());
    }),
});

await app.ready();
```

## Rules

- `<title>` is singleton and last-writer-wins.
- `<meta itemProp>` is ignored.
- `<link rel="stylesheet">` requires `href` and `precedence`.
- `<style>` requires `href` and `precedence`.
- `<script>` requires `src` and `async`.
- Replaceable metadata is removed when its owning `<Head>` template disappears.
- Sticky resources such as stylesheets, async scripts, and preloads remain after the owner disappears.

## Tradeoff

`renderWithMetadata()` buffers the whole SSR stream. That is the external-userland cost of injecting child/frame metadata into the initial document `<head>` without Remix core renderer hooks.
````

- [ ] **Step 2: Commit**

```bash
git add app/utils/metadata/README.md
git commit -m "docs(metadata): document metadata utilities"
```

---

## Task 12: Run final checks

**Files:**

- No source changes unless checks fail.

- [ ] **Step 1: Run metadata tests**

Run:

```bash
pnpm remix-test app/utils/metadata
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the app test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Commit final verification if any files changed**

```bash
git status --short
git add app/utils/metadata remix-test.config.ts
git commit -m "chore(metadata): verify metadata utilities"
```

Expected: if `git status --short` is empty, do not create a commit.

---

## Acceptance criteria

- `<Head>` accepts lowercase `<title>`, `<meta>`, `<link>`, `<style>`, and `<script>` children.
- `<Head>` does not render literal metadata into the body.
- SSR injection places discovered metadata into the real document `<head>`.
- SSR keeps transport templates in the body for client ownership tracking.
- The client manager hydrates existing templates and updates `document.head`.
- Conditional client rendering updates `document.head`.
- Removing an owner removes replaceable metadata.
- Removing an owner does not remove sticky resources.
- `withMetadataFrames()` normalizes full-document frame responses to body fragments.
- Frame reloads work by template insertion/removal observed by `MetadataManager`.
- Tests use `remix/test` and `remix/assert`, not Vitest.
- Implementation lives in `app/utils/metadata`, not a dedicated package.

## Known limitations

- `renderWithMetadata()` buffers the stream.
- Literal `<head>` tags inside frame/body fragments are not supported as declarations.
- Managed nodes are appended after existing static `<head>` content.
- Sticky resources are not removed when owners disappear.
- Sync scripts are unsupported.
- Inline `<style>` without `href` and `precedence` is unsupported.

[1]: https://react.dev/blog/2024/12/05/react-19?utm_source=chatgpt.com "React v19"
[2]: https://newreleases.io/project/github/remix-run/remix/release/remix%403.0.0-alpha.5?utm_source=chatgpt.com "remix-run/remix remix@3.0.0-alpha.5 on GitHub"
