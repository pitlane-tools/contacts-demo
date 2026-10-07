# Remix 3, Vite+, & Cloudflare Workers Best Practices Cookbook

A decision-oriented guide for building Remix 3 applications. Each recipe is self-contained: find the decision you're facing, read the heuristic, follow the pattern. This supplements the official API docs in `.claude/docs/remix/` with practical wisdom that isn't obvious from reading API surfaces alone.

## Project Structure

A typical Remix 3 & Vite project:

```
app/
  entry.server.tsx       # Server entry: router, middleware stack, route mapping
  entry.browser.tsx      # Client entry: run(), resolveFrame, error banner, focus preservation
  routes.ts              # Route definitions (single source of truth for URLs)
  middleware.ts          # App-defined middleware (database injection, upload errors)
  index.css              # Global styles
  actions/               # Route handlers — created with `createController`
    controller.tsx       # Root controller: `home`, `uploads`
    sidebar.tsx          # Renders the `sidebar` frame; shared by both controllers
    zero-state.tsx       # Empty-state content for the `detail` frame
    contacts/
      controller.tsx     # `show`, `edit`, `create`, `destroy`, `favorite`, `update`
      show-page.tsx      # Read-only detail view (server-only)
      form.tsx           # Create/edit form (server-only)
      not-found-page.tsx # 404 content for the `detail` frame
      delete-button.tsx  # Hydrated: confirm-then-submit
      favorite-button.tsx # Hydrated: optimistic star
      sidebar-item.tsx   # Hydrated: active/pending link state
  ui/                    # Components used by more than one route
    document.tsx         # Document shell: real <head>, sidebar chrome, both <Frame>s
    restful-form.tsx     # <form> that emits the `_method` override field
    search-bar.tsx       # Search-as-you-type input (hydrated)
    cancel-button.tsx    # history.back() button (hydrated)
  data/
    contacts.ts          # Table definition, typed queries, `contactName()`
    schemas.ts           # Data validation schemas (form + search params)
    meta.ts              # Site-wide metadata constants
    adapters/            # Platform-specific storage adapters (R2)
  utils/
    frames.ts            # `frameTarget(headers)` — guarded frame-target detection
    frames.test.ts
    page-metadata.ts     # Per-page title/description carried across frame swaps
    page-metadata.test.browser.ts
    pending-navigation.ts  # The single app-level navigation subscription
    uploads.ts           # Allowed MIME types, R2 storage, `uploadHandler`
db/
  migrations/            # Authored migrations — one directory per migration with up.sql / down.sql
  d1-migrations/         # Generated Wrangler-format .sql files (committed)
  apply-d1-migrations.ts # Applies SQL via `wrangler d1 migrations apply`
  generate-d1-migrations.ts # Compiles db/migrations/ → db/d1-migrations/
  seed.ts                # Idempotent local seed script
  lib/                   # Shared helpers for the db scripts
vite.config.ts           # Unified config: build, dev, fmt, lint, typecheck, db tasks
vitest.config.ts         # Vitest projects: `worker` (workerd) and `dom` (jsdom)
wrangler.jsonc           # Cloudflare bindings (D1, R2, assets)
```

**Naming:** every file is kebab-case, including the ones exporting a PascalCase component. `app/ui/search-bar.tsx` exports `SearchBar`. The file name describes the file; the export describes the value.

**Colocation:** a component lives next to the controller that renders it until a second controller needs it, at which point it moves to `app/ui/`. `ShowContact` and `EditContact` are only ever rendered by `app/actions/contacts/controller.tsx`, so they sit beside it as `show-page.tsx` and `form.tsx`. `RestfulForm` is used by the document shell, the contacts form, and the delete button, so it lives in `app/ui/`. `app/actions/sidebar.tsx` stays at the top level of `actions/` for the same reason: both the root and contacts controllers call it.

**No `public/` directories inside `app/`.** (The repo root still has one — Vite's static directory, copied into `dist/client` at build time. Different thing.) Upstream colocates `clientEntry()` components under `app/**/public/**`, but that is not a stylistic convention: it is the allowlist `remix/assets`' asset server matches when deciding which source files it may compile and serve. The guides call `allowFiles` "a security boundary, not merely compilation configuration". This app bundles with Vite, which resolves the browser module graph from the `clientEntry()` calls themselves, so such a directory would allowlist nothing and buy nothing. Hydrated components sit beside their server-only siblings, and `clientEntry()` in the source is the marker that a component crosses the network boundary.

**Why `entry.server.tsx` and not `router.ts`:** upstream names the server module `router.ts`. This app can't, for two reasons. It is the value of `main` in `wrangler.jsonc` (`"./app/entry.server.tsx"`), so it is the Cloudflare Workers module entry, and `app/ui/document.tsx` imports `#/entry.server.tsx?assets=ssr` to collect the SSR asset graph. The name is load-bearing in both places.

**Imports:** `#/` (from `package.json#imports`) for anything outside the current directory; plain relative imports only for same-directory siblings — `app/actions/controller.tsx` imports `./sidebar.tsx`, and `app/ui/document.tsx` imports `./restful-form.tsx`. See Recipe 36.

**Key principle:** Everything runs through `vite.config.ts`. There are no separate config files for linting, formatting, or building. The CLI is `vp` (Vite+).

A resource starts as a single file (`app/actions/posts.tsx`). Once its controller grows page components, promote it to a directory with `controller.tsx` at the root, which is what `app/actions/contacts/` is.

---

## Recipes

### 1. Should I hydrate this component?

**Decision:** Does this component need to respond to user interaction on the client?

**Heuristic:** Default to server-only. Only wrap a component with `clientEntry` when it needs one of these:

- Event handlers (`on("click")`, `on("submit")`, `on("input")`)
- Local state that changes without a full page navigation
- Access to browser APIs (`window`, `navigation`, `localStorage`)
- Optimistic updates or loading states
- Imports and uses another component which satisfies the above

**Server-only component** (no hydration, zero client JS):

```tsx
export function UserProfile(handle: Handle<{ user: User }>) {
    let props = handle.props;
    return () => (
        <div>
            <h1>{props.user.name}</h1>
            <p>{props.user.bio}</p>
        </div>
    );
}
```

**Hydrated component** (ships JS to client):

```tsx
export let LikeButton = clientEntry(
    import.meta.url,
    (handle: Handle<{ itemId: number; liked: boolean }>) => {
        let submitting = false;
        let liked!: boolean;

        return () => {
            let props = handle.props;
            if (!submitting) liked = props.liked;
            return (
                <form
                    mix={on("submit", async event => {
                        /* client logic */
                    })}
                >
                    {/* ... */}
                </form>
            );
        };
    },
);
```

**The pattern:** `clientEntry(import.meta.url, setupFn)` where `setupFn` receives a `Handle` and returns the render function. The setup function runs once on hydration; the render function runs on every update.

**What goes in setup vs. render:**

- **Setup:** Event listener registration (`target.addEventListener(type, fn, { signal: handle.signal })`), one-time initialization, state variable declarations, anything that should survive re-renders
- **Render:** JSX, derived values, conditional logic based on current props/state

**Important:** All props passed to a `clientEntry` component must be serializable (strings, numbers, booleans, plain objects, arrays). The server serializes them as JSON for the client to hydrate. You cannot pass functions, class instances, or DOM nodes as props to hydrated components.

**Why `import.meta.url`, and why you must not simplify it away.** Upstream passes it so its asset server can map a `file:` URL to a compiled, served module — `clientEntry`'s documented default is really `"/js/module.js#ExportName"` (`ui/src/runtime/client-entries.ts:56`). Here it is a _transform marker_: `@pitlane/dev` matches the literal `clientEntry(import.meta.url, …)` call shape and rewrites the argument at transform time. The compiled SSR bundle shows what it becomes:

```js
clientEntry(mergeAssets(__assets_manifest["client"]["app/actions/contacts/favorite-button.tsx"]).entry + "#FavoriteButton", …)
```

So the renderer never sees a `file:` entry ID and never consults an asset server. Replace the argument with a string and the transform stops matching.

**A failed hydration is silent.** `frame.ts:1323-1325` catches every client-entry load failure, logs `[createFrame] Failed to load module`, and returns `undefined` — it does not dispatch the runtime `error` event and does not reject `ready()`, so the app's error banner never fires. A broken island therefore degrades to its server-rendered markup. That is the right default, but it only helps if the markup works on its own, which is the real argument for Recipe 21's no-JS favorite toggle: an island that hydrates into behavior the HTML cannot express fails invisibly.

**Deliberately omitted.** Every upstream demo's browser entry also installs `processClientEntryPreloads` and routes `loadModule` through `remix/multiple-import-maps-polyfill`. Both exist solely to cope with import maps added after the initial document — the demos use the hook for nothing but `detectMultipleImportMapSupport()`. A Vite bundle has no import maps at all, so this app uses plain `import()` and sets no hook. The demos' `app.ready().catch(…)` is skipped too: `run()` already dispatches the error itself (`run.ts:167-170`), and the only rejection paths are sub-frame and pending-template failures, which cannot occur in a document where `render()` fills both frames server-side.

---

### 2. How should I handle form submissions?

**Decision:** Does this form need any JavaScript, or can the runtime drive it?

**Heuristic:** Write the plain form first and stop there. `run()` from `remix/component` already intercepts form submissions — GET _and_ POST — and routes them through frame reloads, so an ordinary `<form>` is already a client-side, frame-targeted submission with zero application code. Add a handler only when you need one of:

- A pre-submission guard (confirmation dialog) — an `on("submit")` listener that may `preventDefault()`.
- Optimistic UI (show the result before the server responds) — a hand-driven `fetch()`.

There is no app-level form interceptor. `app/entry.browser.tsx` registers exactly one `navigate` listener, and it only sets `focusReset` (see Recipe 11). Anything that reads `data-rmx-*` off a submit button and POSTs by hand is duplicating the runtime.

**What `run()` does for form navigations:**

- Intercepts both anchors (`a`, `area`) and forms. A form navigation's `event.sourceElement` is the form or its submitter, so the runtime resolves the owning `<form>` from either.
- Reads the frame-navigation attributes, **preferring the submitter's value over the form's**: `data-rmx-target`, `data-rmx-src`, `data-rmx-history`, `data-rmx-reset-scroll`. `data-rmx-document` on either opts out entirely and lets the browser do a real document navigation (Recipe 15).
- Honors submitter overrides for `formmethod` and `formenctype`, and bails out of interception for `method="dialog"` or `target="_blank"`.
- For non-GET submissions, collects the browser-generated `FormData` and hands it to `resolveFrame` as `{ formData, method, encType, signal }`. This includes the Chromium case where a submitter overrides a non-POST form to POST and `formdata` fires _after_ `navigate` — the runtime captures it from the `formdata` event and waits a macrotask for it.
- Encodes the body according to `encType` (`application/x-www-form-urlencoded` → `URLSearchParams`, `text/plain` → a CRLF-normalized `Blob`, otherwise the `FormData` itself) in its default frame resolver. A custom `resolveFrame` owns that choice; ours passes the `FormData` straight to `fetch`, which sends `multipart/form-data`, and the `formData()` middleware parses either.
- Swaps the response HTML into the targeted frame, following redirects on the way (`fetch` does that). When the resolver hands back the `Response` itself, the runtime reads `redirected`/`url` off it and starts a replacing navigation to the final URL, so a POST-then-redirect ends with the address bar matching the content it just painted (Recipe 11).
- Replaces rather than pushes the history entry when a submission posts back to the URL you're already on: via `NavigationPrecommitController.redirect()` where it exists, and on Safari (no precommit support as of Aug 2026) by `preventDefault()`ing and replaying the submission as a replacing `navigation.navigate()` call.
- Falls back to a real document navigation when the named target frame isn't mounted or the source is cross-origin.

**Pattern A — plain form, no JavaScript (the default).** The "New" button in `app/ui/document.tsx`:

```tsx
<RestfulForm action={routes.contacts.create.href()} method={routes.contacts.create.method}>
    <button type="submit">New</button>
</RestfulForm>
```

And the "Edit" form in `app/actions/contacts/show-page.tsx`, which additionally targets a frame:

```tsx
<RestfulForm
    action={routes.contacts.edit.href(
        { id: props.contact.id },
        { searchParams: { q: props.query } },
    )}
    method={routes.contacts.edit.method}
>
    <button mix={link({ target: "detail" })} type="submit">
        Edit
    </button>
</RestfulForm>
```

Neither form has a submit handler. With JavaScript disabled both work as browser form submissions; with it enabled, `run()` turns them into frame swaps. `ShowContact` is not even a client entry — a server-only component can drive a frame-targeted submission.

**Pattern B — guard only.** `app/actions/contacts/delete-button.tsx`:

```tsx
export let DeleteButton = clientEntry(import.meta.url, (handle: Handle<{ contactId: number }>) => {
    return () => (
        <RestfulForm
            action={routes.contacts.destroy.href({ id: handle.props.contactId })}
            method={routes.contacts.destroy.method}
            mix={on("submit", async event => {
                if (!confirm("Please confirm you want to delete this record.")) {
                    event.preventDefault();
                }
            })}
        >
            <button type="submit">Delete</button>
        </RestfulForm>
    );
});
```

The handler's entire job is to cancel. It never calls `fetch` or `navigate` — if the submission is not prevented, the runtime picks it up exactly as in Pattern A. This is the only reason this component is a `clientEntry` at all.

**Pattern C — hand-driven submit, for optimistic UI only.** `app/actions/contacts/favorite-button.tsx`:

```tsx
export let FavoriteButton = clientEntry(
    import.meta.url,
    (handle: Handle<{ contactId: number; favorite: boolean }>) => {
        let submitting = false;
        let favorite = handle.props.favorite;

        return () => {
            let props = handle.props;
            if (!submitting) {
                favorite = props.favorite;
            }

            return (
                <RestfulForm
                    action={routes.contacts.favorite.href({ id: props.contactId })}
                    method={routes.contacts.favorite.method}
                    mix={on("submit", async (event, signal) => {
                        event.preventDefault();

                        favorite = !favorite;
                        submitting = true;
                        await handle.update();

                        try {
                            let response = await fetch(event.currentTarget.action, {
                                method: event.currentTarget.method,
                                body: new FormData(event.currentTarget, event.submitter),
                                signal,
                            });

                            if (!response.ok && !response.redirected) {
                                throw response;
                            }

                            // The star renders in this frame and in the sidebar
                            // list, so refresh both rather than navigating: a
                            // navigation would touch history and reset scroll.
                            await Promise.all([
                                handle.frame.reload(),
                                handle.frames.get("sidebar")?.reload(),
                            ]);
                        } catch {
                            favorite = !favorite;
                        }

                        if (signal.aborted) return;
                        submitting = false;
                        handle.update();
                    })}
                >
                    <button
                        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
                        name="favorite"
                        type="submit"
                        value={favorite ? "true" : "false"}
                    >
                        {favorite ? "★" : "☆"}
                    </button>
                </RestfulForm>
            );
        };
    },
);
```

This is **not** how ordinary POSTs work anymore — it is the optimism escape hatch. The trade is explicit: because you `preventDefault()`, you own the request, the abort signal, the failure path, and the revert. Reach for it only when the UI must change before the server answers (Recipe 3). The `favorite` action returns JSON rather than HTML precisely because nothing swaps a frame automatically here.

**Re-sync with `reload()`, not `navigate()`.** After the write lands, refresh the regions whose server-rendered content is now stale by reloading those frames — `handle.frame` for the containing one, `handle.frames.get(name)` for another on the page. This is the canonical shape (the guides' "Name and reload frames"). Re-navigating to the current URL with `navigate(location.href, { history: "replace" })` is worse on three counts: it re-renders the whole document rather than the two stale regions, it runs a full Navigation API transition that rewrites the current history entry, and `resetScroll` defaults to `true` — so favoriting a contact would jump the page to the top. A reload changes no destination and does none of that.

**Method override for PUT/PATCH/DELETE:** HTML forms only support GET and POST. For other HTTP methods, use a hidden `_method` field with the `methodOverride()` middleware. `app/ui/restful-form.tsx` wraps the pattern so no form repeats the boilerplate:

```tsx
import type { Handle } from "remix/component";
import type { RequestMethod } from "remix/router";

export function RestfulForm(
    handle: Handle<JSX.IntrinsicHTMLElements["form"] & { method?: RequestMethod | "ANY" }>,
) {
    return () => {
        let { children, method, ...props } = handle.props;
        let isGET = method === "GET" || typeof method === "undefined";
        return (
            <form method={isGET ? "GET" : "POST"} {...props}>
                {!isGET && <input name="_method" type="hidden" value={method} />}
                {children}
            </form>
        );
    };
}
```

Now any form can use the route's actual HTTP method without manually managing hidden fields:

```tsx
<RestfulForm
    action={routes.contacts.update.href({ id: props.contact.id })}
    enctype="multipart/form-data"
    id="contact-form"
    method={routes.contacts.update.method}
>
    <button type="submit">Save</button>
</RestfulForm>
```

The `methodOverride()` middleware in your server entry reads `_method` from the form data and rewrites the request method before it reaches your controller — so it must be installed after `formData()` (Recipe 7). Using `routes.*.method` ensures the form always matches the route definition — if you change a route from `PATCH` to `PUT`, the forms update automatically.

---

### 3. How do I implement optimistic updates?

**Decision:** Should I update the UI before the server responds?

**Heuristic:** Use optimistic updates for toggle-like actions where:

- The expected outcome is predictable (toggling a boolean, incrementing a count)
- The action is unlikely to fail
- Instant feedback significantly improves perceived performance

**First check whether you need one at all.** An ordinary submission needs no JavaScript and no manual `fetch()`. Once `run()` starts, the runtime intercepts eligible same-origin forms itself and submits them through `resolveFrame` — honoring `data-rmx-target`, `data-rmx-src`, submitter `formmethod`/`formenctype` overrides, POST redirects, and history defaults. A client entry only has to exist when you want to add behavior _around_ that submission. `app/actions/contacts/delete-button.tsx` is the whole non-optimistic shape — it adds a confirmation dialog and otherwise lets the runtime drive the POST:

```tsx
export let DeleteButton = clientEntry(import.meta.url, (handle: Handle<{ contactId: number }>) => {
    return () => (
        <RestfulForm
            action={routes.contacts.destroy.href({ id: handle.props.contactId })}
            method={routes.contacts.destroy.method}
            mix={on("submit", async event => {
                if (!confirm("Please confirm you want to delete this record.")) {
                    event.preventDefault();
                }
            })}
        >
            <button type="submit">Delete</button>
        </RestfulForm>
    );
});
```

A hand-written `fetch()` is for the case the runtime deliberately does not cover: you want to hold the UI at a _predicted_ value, and the action answers with data rather than with frame HTML (`favorite` ends in `return Response.json(update)`).

**The pattern:**

1. Keep local state in the setup scope (survives re-renders)
2. On submit: update local state immediately, `await handle.update()` to re-render and receive an `AbortSignal`
3. Fire the fetch request
4. On success: trigger a soft navigation to sync server state
5. On failure: revert local state, call `handle.update()` again

`app/actions/contacts/favorite-button.tsx`:

```tsx
export let FavoriteButton = clientEntry(
    import.meta.url,
    (handle: Handle<{ contactId: number; favorite: boolean }>) => {
        let submitting = false;
        let favorite = handle.props.favorite;

        return () => {
            let props = handle.props;
            if (!submitting) {
                favorite = props.favorite;
            }

            return (
                <RestfulForm
                    action={routes.contacts.favorite.href({ id: props.contactId })}
                    method={routes.contacts.favorite.method}
                    mix={on("submit", async (event, signal) => {
                        event.preventDefault();

                        favorite = !favorite;
                        submitting = true;
                        await handle.update();

                        try {
                            let response = await fetch(event.currentTarget.action, {
                                method: event.currentTarget.method,
                                body: new FormData(event.currentTarget, event.submitter),
                                signal,
                            });

                            if (!response.ok && !response.redirected) {
                                throw response;
                            }

                            // The star renders in this frame and in the sidebar
                            // list, so refresh both rather than navigating: a
                            // navigation would touch history and reset scroll.
                            await Promise.all([
                                handle.frame.reload(),
                                handle.frames.get("sidebar")?.reload(),
                            ]);
                        } catch {
                            favorite = !favorite;
                        }

                        if (signal.aborted) return;
                        submitting = false;
                        handle.update();
                    })}
                >
                    <button
                        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
                        name="favorite"
                        type="submit"
                        value={favorite ? "true" : "false"}
                    >
                        {favorite ? "★" : "☆"}
                    </button>
                </RestfulForm>
            );
        };
    },
);
```

**Key details:**

- `let favorite = handle.props.favorite` seeds the setup-scope state from the first server-rendered props, so no definite-assignment assertion is needed — the value exists before the first render runs
- `if (!submitting) favorite = props.favorite` lets later server renders win, but only while no submission is in flight; that guard is what stops a stale prop from snapping the toggle back mid-request
- The `on()` handler's second argument is an `AbortSignal` scoped to the interaction — pass it to `fetch` so a disconnected or superseded component cancels its request, and check `signal.aborted` before touching state afterwards
- `await Promise.all([handle.frame.reload(), handle.frames.get("sidebar")?.reload()])` re-syncs exactly the two regions whose server HTML went stale. Prefer this to `navigate(location.href, …)`, which re-renders the whole document, runs a history-rewriting transition, and resets scroll by default
- `RestfulForm` renders `method="POST"` plus a hidden `_method` input, and `methodOverride()` in the middleware stack turns that into the `PATCH` the `favorite` route declares. `new FormData(event.currentTarget, event.submitter)` carries both `_method` and the submitter's `favorite` value, so the manual fetch hits exactly the same action as the unenhanced submission would

---

### 4. How do I build search-as-you-type?

**Decision:** How should search interact with the URL, history, and frame system?

**Heuristic:** Search should always be URL-driven (the query lives in a search param like `?q=`). This makes search results linkable, back-button friendly, and server-renderable. The component that starts the navigation owns its own pending state — there is no app-wide navigation bus to read.

**The pattern** (`app/ui/search-bar.tsx`, in full):

```tsx
import { clientEntry, type Handle, navigate, on } from "remix/component";

export let SearchBar = clientEntry(import.meta.url, (handle: Handle<{ query?: string }>) => {
    // `navigate()` settles when the targeted frame has finished swapping, so
    // this component can own its own pending state instead of reading a global
    // navigation bus. Counted, because each keystroke starts another one.
    let pendingSearches = 0;

    async function search(value: string) {
        let url = new URL(location.href);

        if (!value.trim()) {
            url.searchParams.delete("q");
            try {
                await navigate(url.toString(), { target: "sidebar" });
            } catch {
                // superseded by a later keystroke
            }
            return;
        }

        let isFirstSearch = url.searchParams.get("q") === null;
        url.searchParams.set("q", value);

        pendingSearches++;
        handle.update();

        try {
            await navigate(url.toString(), {
                history: isFirstSearch ? "replace" : "push",
                target: "sidebar",
            });
        } catch {
            // superseded by a later keystroke
        } finally {
            pendingSearches--;
            handle.update();
        }
    }

    return () => {
        let searching = pendingSearches > 0;

        return (
            <form data-rmx-target="sidebar" id="search-form" method="GET">
                <input
                    aria-label="Search contacts"
                    class={searching ? "loading" : ""}
                    defaultValue={handle.props.query ?? undefined}
                    id="q"
                    mix={on("input", event => search(event.currentTarget.value))}
                    name="q"
                    placeholder="Search"
                    type="search"
                />
                <div aria-hidden hidden={!searching} id="search-spinner" />
                <div aria-live="polite" class="sr-only" />
            </form>
        );
    };
});
```

**Why the component owns its pending state:** `navigate()` awaits the Navigation API transition, and the runtime's interception keeps that transition open until the targeted frame has actually swapped its content. The caller that started the navigation therefore already knows precisely when it begins and ends — no subscription required. See Recipe 10 for the full decision order.

**Why a counter instead of a boolean:** every keystroke starts another `navigate()`, and a superseded one rejects. With a boolean, the _earlier_ navigation's `finally` would clear the flag while the _later_ one is still in flight, dropping the spinner mid-search. `pendingSearches++` / `pendingSearches--` makes the indicator reflect "at least one search outstanding", which is the thing the user cares about. `handle.update()` after each mutation re-renders the input's `class` and the spinner's `hidden`.

**Why `replace` for the first search, `push` after:** the first keystroke overwrites the pre-search entry instead of stacking a one-character query on top of it, so Back doesn't step through "s", "sa", "sam". Later keystrokes push, so the user can still walk between meaningful search states.

**The empty-value branch:** when the input is cleared, `search()` deletes `q`, navigates immediately, and returns _before_ touching the counter. It skips the `isFirstSearch` logic (there is no new query to record) and skips the spinner (there is no query to report progress on) — the sidebar just goes back to the unfiltered list.

**Why `target: "sidebar"`:** the results live in the `sidebar` frame. Targeting it leaves the detail pane and the search input itself untouched while results stream in. Without frames, omit `target` and the top frame navigates.

**Why `data-rmx-target="sidebar"` on the `<form>` too:** the `on("input")` handler covers typing, but pressing Enter still submits the form. Without the attribute that submission is a full document navigation, which is a visibly different result from the same query typed a moment earlier. With it, both paths land in the same frame — and the form still degrades to a plain document navigation before the runtime starts.

**Why `try/catch` around every `navigate`:** rapid typing means each call aborts the previous one, and the aborted transition rejects. Catching keeps those expected rejections from surfacing as unhandled rejections — and, in this app, from reaching the global `error` banner wired up in `app/entry.browser.tsx`.

**Why focus survives:** `app/entry.browser.tsx` registers a `navigate` listener _after_ `run()` that calls `event.intercept({ focusReset: "manual" })`. `remix/component` never sets `focusReset`, so without that the input would lose focus on each swap.

---

### 5. How do frames work and when should I use them?

**Decision:** Should I use frames to split my page into independently-updatable regions?

**Heuristic:** Use frames when your page has regions that:

- Update independently (e.g., a navigation list and a content area)
- Have different data requirements
- Should be navigable without reloading the entire page

Not every app needs frames. A simple single-column page that always renders as a whole doesn't benefit from them. Frames shine in layouts with two or more regions that change at different times.

**Defining frames in your document** (`app/ui/document.tsx`):

```tsx
<body>
    <HMR />
    <div id="root">
        <div id="sidebar">
            <h1>{SITE.title}</h1>
            <div>
                <SearchBar query={q} />
                <RestfulForm
                    action={routes.contacts.create.href()}
                    method={routes.contacts.create.method}
                >
                    <button type="submit">New</button>
                </RestfulForm>
            </div>
            <Frame name="sidebar" src={url.toString()} />
        </div>
        <Frame name="detail" src={url.toString()} />
    </div>
</body>
```

Each `<Frame>` is a named region whose `src` tells the renderer where its content comes from. Both frames point at the current URL here, so one request produces the whole page: the controller's `ctx.render(<Document />)` walks the tree, hits each `<Frame>`, and re-enters the router to fill it in. On the client, frames are refetched through the `resolveFrame` callback passed to `run()` (Recipe 11).

**The server half is the `render()` middleware.** `render()` from `remix/middleware/render` is installed last in the middleware array (Recipe 7) and adds `ctx.render(node, init?)`, which returns an HTML `Response`. There is no app-level render helper — frame resolution is the framework's job now. For every nested `<Frame>` it encounters, the middleware:

- Resolves the frame's `src` against the _current_ frame source, not just the document URL, so nested frames compose.
- Re-enters the app through `context.router.fetch()` — an in-process sub-request, no network hop.
- Forwards the outer request's headers, so `Cookie`, `Authorization`, and session state reach the frame's action. Sessions and auth work inside frames for free.
- Strips headers that only describe the outer request's body or connection (`Content-Type`, `Content-Length`, `Host`, `Connection`, `Range`, the `If-*` conditionals, `Transfer-Encoding`, …) and every `sec-fetch-*` header, which would otherwise mislabel the sub-request's context.
- Sets `Accept: text/html`, `Accept-Encoding: identity`, `X-Remix-Frame: true`, `X-Remix-Top-Frame-Src`, and `X-Remix-Target` (deleting a stale target when the frame is unnamed).
- Coerces the sub-request to `GET`, so a frame can never replay the outer request's mutation.
- Follows `301/302/303/307/308` responses itself, up to 20 redirects, then throws.
- Trims the header set down to `Accept`, `Accept-Encoding`, `X-Remix-Frame`, and `X-Remix-Target` if a frame's `src` is cross-origin — credentials and the top-frame URL never leak off-origin.
- Cancels frame rendering when the original request aborts (the sub-request inherits `context.request.signal`, and the body is piped under the same signal).
- Requires an HTML response, and suppresses the `onError` hook for frame sub-requests so a failing fragment doesn't double-report.

**Server-side frame detection:** use `frameTarget()` from `app/utils/frames.ts` rather than reading the header directly:

```ts
/**
 * Name of the frame a request is targeting, or `null` for a normal navigation.
 *
 * Both headers are required. `X-Remix-Target` alone is not enough: a stray
 * target header on a top-level navigation would otherwise be served fragment
 * content in place of a whole document.
 */
export function frameTarget(headers: Headers): string | null {
    if (headers.get("x-remix-frame") !== "true") return null;
    return headers.get("x-remix-target");
}
```

The pairing is a safety property, not a formality. `X-Remix-Frame: true` is what identifies a request as a frame sub-request — the render middleware sets it on every in-process frame fetch, and `app/entry.browser.tsx` sets it on every browser frame fetch. `X-Remix-Target` only names _which_ frame. Requiring both means a top-level navigation that happens to carry a target header still gets a whole document instead of a bare fragment.

Controllers then branch on the name (`app/actions/controller.tsx`):

```tsx
async home(ctx) {
    let target = frameTarget(ctx.headers);

    if (target === "sidebar") return sidebar(ctx);
    if (target === "detail") return ctx.render(<ZeroState />);

    return ctx.render(<Document />);
},
```

**One `ctx.render()`, two output shapes.** There is no document response helper and no fragment response helper: the same call serves both. The renderer decides structurally — it flips to document mode when it walks an `<html>` tag in the tree. So the action doesn't pick a _response type_, it picks _what to build_: a tree rooted at `<Document />` (which renders `<html>`) yields a full page; a tree rooted at a `<nav>` or a `<div id="detail">` yields a fragment for one frame. Recipe 16 shows the three-way branch.

If you want a typed union of valid frame names, declare it once and use it wherever you set `data-rmx-target` (Recipe 15) — the server can stay loose, since `frameTarget()` returns a plain `string | null`.

**Factor shared frames into a helper.** `app/actions/sidebar.tsx` renders the `sidebar` frame for both the root and contacts controllers, taking only the slice of context it needs:

```tsx
/** The slice of the request context the sidebar frame needs. */
type SidebarContext = {
    render: RenderFunction;
    url: URL;
};

/** Renders the `sidebar` frame. Shared by the root and contacts controllers. */
export async function sidebar(ctx: SidebarContext, selected?: number): Promise<Response> {
    let { q } = s.parse(QuerySchema, ctx.url.searchParams);
    let contacts = await getContacts(q);

    return ctx.render(<nav>{/* … */}</nav>);
}
```

Typing the parameter as a structural slice (`{ render, url }`) rather than the full `RequestContext` keeps the helper callable from any controller whose context satisfies it, with no `getContext()` lookup and nothing to mock in a test. `RenderFunction` is a type-only import from `remix/middleware/render`.

---

### 6. How do I set up routing?

**Decision:** How should I define my app's URL structure?

**Heuristic:** Define all routes in a single `routes.ts` file. Use the `route()` helper for type-safe, centralized route definitions. Never hardcode URL strings in components or controllers.

**Basic route definition:**

```tsx
import { route, resources, get, patch } from "remix/routes";

export let routes = route({
    home: get("/"),
    uploads: get("/uploads/*key"),
    contacts: {
        ...resources("/contacts", { exclude: ["index", "new"] }),
        favorite: patch("/contacts/:id/favorite"),
    },
});
```

**HTTP method helpers:** Use `get()`, `post()`, `put()`, `patch()`, and `del()` to define routes with explicit HTTP methods. This is the preferred style for custom routes — it's shorter and clearer than the `{ method, pattern }` object form.

**What `resources()` generates:** RESTful route patterns following REST conventions. `resources("/contacts")` creates routes for `index`, `new`, `show`, `create`, `edit`, `update`, and `destroy`. Use `exclude` to omit routes you don't need:

```tsx
resources("/contacts", { exclude: ["index", "new"] });
```

**Wildcard parameters:** Use `*name` for catch-all segments. In the example above, `get("/uploads/*key")` matches `/uploads/avatar/123-abc.jpg` with `params.key = "avatar/123-abc.jpg"`.

**Using routes in components (type-safe URL generation):**

```tsx
routes.contacts.show.href({ id: 42 }); // "/contacts/42"
routes.contacts.edit.href({ id: 42 }, { q: "sam" }); // "/contacts/42/edit?q=sam"
routes.home.href(); // "/"
```

**Accessing the HTTP method:** Each route exposes a `.method` property that returns the HTTP method string. Use this with `RestfulForm` (see Recipe 2) to keep forms in sync with route definitions:

```tsx
routes.contacts.update.method; // "PATCH"
routes.contacts.destroy.method; // "DELETE"
routes.contacts.create.method; // "POST"
```

**Mapping routes to controllers in the server entry:**

```tsx
router.map(routes.home, async () => {
    /* ... */
});
router.map(routes.posts, postsController); // Maps all sub-routes to a controller
```

---

### 7. How do I structure my server entry?

**Decision:** What middleware do I need and in what order?

**Heuristic:** Middleware runs in order for every request. Put cheap/broad middleware first, expensive/specific middleware last, and the renderer last of all. Declare the middleware tuple `as const` and feed its type into `RouterTypes` via module augmentation so action handlers see precisely-typed `ctx` properties (e.g. `ctx.formData`, `ctx.render`, `ctx.get(Database)`).

**Recommended middleware stack** (`app/entry.server.tsx`):

```tsx
import { asyncContext } from "remix/middleware/async-context";
import { formData } from "remix/middleware/form-data";
import { methodOverride } from "remix/middleware/method-override";
import { render } from "remix/middleware/render";
import { createRouter, type MiddlewareContext } from "remix/router";

import contacts from "#/actions/contacts/controller.tsx";
import controller from "#/actions/controller.tsx";
import { database, uploadErrors } from "#/middleware.ts";
import { routes } from "#/routes.ts";
import { UPLOAD_LIMITS, uploadHandler } from "#/utils/uploads.ts";

let middleware = [
    uploadErrors(),
    formData({ ...UPLOAD_LIMITS, uploadHandler }),
    methodOverride(),
    asyncContext(),
    database(),
    render({
        onError(error) {
            console.error(error);
        },
    }),
] as const;

declare module "remix" {
    interface RouterTypes {
        context: MiddlewareContext<typeof middleware>;
    }
}

export let router = createRouter({ middleware });

router.map(routes, controller);
router.map(routes.contacts, contacts);

export default {
    async fetch(request) {
        try {
            return await router.fetch(request);
        } catch (error) {
            // An abort is the client leaving, not a server failure.
            if (!(request.signal.aborted && error === request.signal.reason)) {
                console.error(error);
            }

            return new Response("Internal Server Error", { status: 500 });
        }
    },
} satisfies ExportedHandler;
```

**Why this order matters:**

1. **`uploadErrors()` first.** It is the only middleware that needs to see errors from everything below it. It translates the failures raised while `formData()` is still streaming the body — a rejected MIME type into a 415, a breached size cap into a 413, a malformed body into a 400 — none of which any action can answer for. See Recipe 35.
2. **`formData()` before `methodOverride()`.** `methodOverride()` rewrites the request method from a `_method` form field, which means it has to read the _parsed_ form data. Invert these two and the override silently never fires.
3. **`asyncContext()` before `database()`.** `database()` calls `ctx.set(Database, db)`, and that store has to exist before anything writes to it. `asyncContext()` also makes the request context reachable from helpers that never received `ctx` — see Recipe 13.
4. **`render()` last.** It installs `ctx.render` and, when a frame in the tree needs filling, issues the sub-request back through `context.router.fetch()`. That re-entrant request must traverse the _whole_ stack — form parsing, database — so the renderer has to be the innermost middleware. Anything installed after it would be skipped on frame sub-requests.

**No `staticFiles()`.** Upstream's stack starts with it, and this app deliberately omits it. It is built on `node:fs`, and a deployed Worker has no filesystem to read; meanwhile `wrangler.jsonc` already declares `assets: { directory: "dist/client" }`, which Cloudflare serves _ahead_ of the Worker. The middleware was unreachable for exactly the paths it existed to serve. Chapter 3 says so directly: "On a worker, serve static assets through the platform."

**The `fetch` wrapper is the error boundary.** `router.fetch()` rejects when an action or middleware throws, and nothing downstream catches it. Without this wrapper an uncaught error becomes workerd's generic error page — which the browser's `resolveFrame` would then render verbatim into the app's own error banner. The abort guard matters too: a client disconnect is cancellation, not a server failure, so it is not logged.

**What `render()` gives you:** a single `ctx.render(node, init?)` that returns an HTML `Response`. There is no separate "document response" helper and "frame response" helper; the renderer decides the output shape structurally, flipping to document mode when it walks an `<html>` tag in the tree. Your action doesn't pick a response _type_ — it picks what to build:

```tsx
async home(ctx) {
    let target = frameTarget(ctx.headers);

    if (target === "sidebar") return sidebar(ctx);
    if (target === "detail") return ctx.render(<ZeroState />);

    return ctx.render(<Document />);
},
```

It also owns everything awkward about resolving a frame's `src` on the server: it forwards the incoming request's credentials and cookies, strips hop-by-hop headers and every `sec-fetch-*` header, forces the sub-request to `GET`, follows redirects up to a limit of 20, trims headers down to a safe subset when a frame points at another origin, and cancels in-flight frame work when the client disconnects. None of that is code you write.

**No `assets` option.** `render()` accepts `{ assets?, onError? }`, and this app passes neither. The `assets` server exists only to turn a `file:`-prefixed client-entry ID into a browser module URL. `@pitlane/dev`'s `clientEntryTransform` already does that at transform time: in server environments it rewrites the `import.meta.url` argument of `clientEntry(import.meta.url, …)` into `___clientEntryAssets.entry + "#ExportName"`, a public chunk URL. The entry ID the renderer sees is therefore never a `file:` URL, so it takes the pass-through branch and no asset server is consulted. Do not add `remix/assets`, `createAssetServer`, or `<ImportMap>` to a `@pitlane/dev` build — they solve a problem the transform has already solved.

**Don't catch thrown `Response`s.** A generic rescue middleware that does `catch (error) { if (error instanceof Response) return error }` has no upstream precedent. `fetch-router` never catches thrown Responses — its middleware runner has no `try`/`catch` at all, and its only `instanceof Response` check is on a middleware's _return_ value. Canonical code returns a `Response`; throwing one just means the framework sees an unhandled exception. `uploadErrors()` is the shape upstream actually demonstrates: catch one real error type you own, convert it to a response.

**The `RouterTypes` augmentation:** Declaring `interface RouterTypes { context: MiddlewareContext<typeof middleware> }` teaches `remix/router` about everything your stack contributes to the context. Inside actions, `ctx.formData` (from `formData()`), `ctx.render` (from `render()`), `ctx.params` (typed by the matched route pattern), and `ctx.get(Database)` (from `database()`) all become statically known — no manual typing required.

**HMR support:** The `if (import.meta.hot) ...` block at the bottom lets the dev server pick up server changes without restarting.

---

### 8. Where does my logic belong?

**Decision:** Should this code be in a controller, middleware, component, or utility?

**Heuristic:**

| Logic type                                     | Where it goes                     | Why                                                |
| ---------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| Request handling for a specific route          | **Actions** (`actions/`)          | Tied to a route's URL/method                       |
| Cross-cutting concern (auth, logging, parsing) | **`middleware.ts`**               | Runs across many routes                            |
| UI used by more than one route                 | **`app/ui/`**                     | Genuinely shared presentation                      |
| UI used by exactly one route                   | **`actions/<feature>/`**          | Colocated with the controller that renders it      |
| Data access / business rules                   | **Data layer** (`data/`)          | Reusable, testable                                 |
| Validation schemas                             | **`data/schemas.ts`**             | Shared between actions                             |
| Frame-target detection                         | **`utils/frames.ts`**             | One guarded rule, read by every controller         |
| Per-page title/description                     | **`utils/page-metadata.ts`**      | Server headers + browser applier, kept in one pair |
| In-flight navigation destination               | **`utils/pending-navigation.ts`** | The one thing frame events can't express           |
| Upload validation + storage                    | **`utils/uploads.ts`**            | Shared by middleware, controller, and the form     |
| Platform adapters (D1, R2)                     | **`data/adapters/`**              | Swappable implementations                          |

A few of those rows deserve their reasoning spelled out, because the obvious alternative is wrong:

- **`utils/frames.ts`** exists so no controller reads `x-remix-target` by hand. `frameTarget()` returns the target only when `x-remix-frame: true` is _also_ present — a stray target header on a top-level navigation must get a whole document, not a fragment.
- **`utils/page-metadata.ts`** pairs a server function and a browser function that have to agree on an encoding. Splitting them across layers is how they drift.
- **`utils/pending-navigation.ts`** is the only app-level navigation subscription, and it is deliberately narrow. Per-region pending UI belongs in the region: `app/ui/search-bar.tsx` just `await`s `navigate()` and counts its own in-flight searches. See Recipe 21 for the one case that needs more.

**Actions** are grouped per resource and constructed with `createController(route, definition)`. The route argument anchors the type system so each action receives a `ctx` with `ctx.params` matched to the route's pattern and `ctx.formData` typed from the form-data middleware:

```tsx
import { createController } from "remix/router";

import { routes } from "#/routes.ts";

export default createController(routes.posts, {
    actions: {
        async index(ctx) {
            /* ... */
        },
        async show(ctx) {
            /* ... */
        },
        async create(ctx) {
            /* ... */
        },
        async update(ctx) {
            /* ... */
        },
        async destroy(ctx) {
            /* ... */
        },
    },
});
```

`createController` (a) verifies your action names match the route definitions, (b) closes over the route type to type `ctx.params`, and (c) lets the result be passed to `router.map(routes.posts, controller)` without further typing.

**Middleware** is a function that receives `(ctx, next)` and returns a `Response`:

```tsx
export function database(): Middleware<DatabaseEntry> {
    // Built once per isolate: the binding is stable, so there is nothing to
    // rebuild per request.
    let db = createD1Database(env.DB);

    return (ctx, next) => {
        ctx.set(Database, db);
        return next();
    };
}
```

Call `next()` to pass through to the next middleware or the matched route handler. The `Middleware<...>` generic declares what the middleware adds to the context — when combined with the `RouterTypes` augmentation (Recipe 7), this makes `ctx.get(Database)` statically typed in every action.

Middleware is also where you turn an error into a response, when the code that raised it was too deep in the stack to answer for itself:

```tsx
export function uploadErrors(): Middleware {
    return async (_ctx, next) => {
        try {
            return await next();
        } catch (error) {
            if (error instanceof UnsupportedMediaTypeError) {
                return new Response(
                    "Unsupported image format. Please upload a JPEG, PNG, GIF, or WebP file.",
                    { status: 415 },
                );
            }

            throw error;
        }
    };
}
```

Catch a specific error type you own and return a response for it. Re-throw everything else — a middleware that swallows unknown errors turns bugs into blank pages.

---

### 9. How do I validate form data and search params?

**Decision:** How should I parse and validate incoming data?

**Heuristic:** Always validate at the boundary (where external data enters your system). Use `remix/data-schema` for type-safe parsing that handles coercion from form data strings to proper types.

**Defining schemas:**

```tsx
import * as s from "remix/data-schema";
import * as coerce from "remix/data-schema/coerce";
import * as f from "remix/data-schema/form-data";

// Search params: optional string
let SearchSchema = f.object({
    q: f.field(s.union([s.string(), s.undefined_()])),
});

// Form data with coercion: string "true"/"false" -> boolean
let ToggleSchema = f.object({
    enabled: f.field(coerce.boolean()),
});

// Form data with defaults: missing fields become empty strings
let ProfileSchema = f.object({
    name: f.field(s.defaulted(s.string(), "")),
    email: f.field(s.defaulted(s.string(), "")),
    bio: f.field(s.defaulted(s.string(), "")),
});
```

**Parsing in actions:**

```tsx
// Parse search params (URLSearchParams)
let { q } = s.parse(SearchSchema, ctx.url.searchParams);

// Parse form data (FormData from request body)
// `ctx.formData` is contributed by the `formData()` middleware (see Recipe 7)
// and typed via the RouterTypes augmentation.
let { enabled } = s.parse(ToggleSchema, ctx.formData);
let profile = s.parse(ProfileSchema, ctx.formData);
```

**Key concepts:**

- `f.object()` / `f.field()` handle FormData extraction (fields are always strings in the raw form)
- `coerce.boolean()` converts string `"true"`/`"false"` to actual booleans
- `s.defaulted()` provides fallback values for missing fields
- `s.union()` allows multiple types (e.g., string or undefined for optional params)
- `s.parse()` throws on validation failure -- you get typed data or an error, never silently wrong types

---

### 10. How do I show loading and pending states?

**Decision:** How do I indicate that something is loading or in-progress?

**Heuristic:** `remix/component` has **no app-wide navigation bus**, by design. Derive pending state as locally as possible: first from the navigation you yourself started, then from the frame that is actually reloading, and only as a last resort from an app-owned subscription.

**Decision order:**

**1. Your component triggers the navigation → `await navigate()` and track locally.**

`navigate(href, options)` resolves when the Navigation API transition finishes, which — for an intercepted, frame-aware navigation — is after the targeted frame has swapped. So the call site is already the best-informed place in the app. Increment a counter or set a flag around the `await`, call `handle.update()`, and you are done. `app/ui/search-bar.tsx` is the worked example; see Recipe 4 for why it counts instead of using a boolean.

The same trick applies to a reload you trigger yourself: `await handle.frame.reload()` (or `await handle.frames.get(name)?.reload()`) settles once that region has finished updating. `app/actions/contacts/favorite-button.tsx` is the worked example — it writes with `fetch()`, then awaits a reload of both frames whose server HTML the write invalidated. Prefer this to re-navigating to the current URL: a reload changes no destination, so it adds no history entry and does not reset scroll.

**2. Per-region pending UI → the frame's own events.**

A frame handle is an `EventTarget` that emits `reloadStart` and `reloadComplete`. You can reach one three ways:

| Accessor                  | Frame                                                        |
| ------------------------- | ------------------------------------------------------------ |
| `handle.frame`            | The nearest enclosing frame; always present, even during SSR |
| `handle.frames.get(name)` | A mounted named frame; `undefined` when it isn't mounted     |
| `handle.frames.top`       | The root frame for the current runtime tree (the document)   |

```tsx
export let ReloadIndicator = clientEntry(import.meta.url, (handle: Handle) => {
    let reloading = false;

    function setReloading(next: boolean) {
        reloading = next;
        handle.update();
    }

    handle.frame.addEventListener("reloadStart", () => setReloading(true), {
        signal: handle.signal,
    });
    handle.frame.addEventListener("reloadComplete", () => setReloading(false), {
        signal: handle.signal,
    });

    return () => <div aria-hidden class="spinner" hidden={!reloading} />;
});
```

No component in this app currently _listens_ for these events — search owns its own state, the favorite button awaits the reloads it triggers, and the sidebar uses the subscription below — but this is the canonical pattern for "this region is refreshing" when something _else_ triggered the reload. Registering in setup is safe during SSR: the server supplies a real frame handle, but nothing ever reloads server-side so the listener never fires, and `handle.signal` is an inert stub that discards the registration. Note that `handle.update()` **throws** during SSR, so it must only ever be reached from an event handler, never from setup itself.

`reloadStart` and `reloadComplete` are **bare `Event`s with no payload** — no destination, no form data, no previous URL. When you need the destination, read `frame.src`, which is the source the frame loads (and reloads) from. When you need the submitted values, you already have them at the call site that submitted them.

**3. Only if you need a broadcast frame events cannot give you → the app-owned subscription.**

`app/utils/pending-navigation.ts` exports `isServer`, `pendingDestination()`, and `onDestinationChange(listener, { signal })`. It is the single remaining app-level navigation subscription, and it exists for exactly one problem: a component that must re-render because of a navigation _it never participated in_. Recipe 21 covers that case in full. Reach for it only after ruling out (1) and (2).

**There is no framework-level "loading" vs. "submitting" distinction.** The runtime does not model a global navigation state machine at all: a frame is either reloading or it isn't. If your UI needs to distinguish a read from a write, that distinction lives where the request originates — the handler that called `fetch()` or submitted the form knows which it was.

**Server safety:** `onDestinationChange` returns immediately when `isServer`, so no listener is ever registered during SSR, and the module never touches `navigation` on the server. Components can import it unconditionally; guard anything that reads `location` or `document` with `isServer`.

---

### 11. How does SPA navigation work with frames?

**Decision:** How do I set up client-side navigation that works with the frame system?

**Heuristic:** The client entry (`app/entry.browser.tsx`) has exactly three pieces: `run()` with a `loadModule` and a `resolveFrame`, a global `error` listener that renders a banner, and one `navigate` listener that sets `focusReset: "manual"` — registered _after_ `run()`. Nothing else. No form interceptor (Recipe 2), no navigation bus (Recipe 21), no metadata manager.

**The whole client entry:**

```tsx
import type { Handle } from "remix/component";

import { createRoot, on, run } from "remix/component";

import { applyPageMetadata } from "#/utils/page-metadata.ts";

let app = run({
    async loadModule(moduleUrl, exportName) {
        // Runtime-selected by design: the runtime hands us a client-entry URL
        // resolved from the server-rendered hydration marker.
        let mod = await import(/* @vite-ignore */ moduleUrl);
        let exported = mod[exportName];

        if (typeof exported !== "function") {
            throw new TypeError(
                `Expected export '${exportName}' from '${moduleUrl}' to be a function`,
            );
        }

        return exported;
    },
    async resolveFrame(src, options) {
        let headers = new Headers({ accept: "text/html", "x-remix-frame": "true" });
        if (options?.target) headers.set("x-remix-target", options.target);

        let response = await fetch(src, {
            body: options?.formData,
            headers,
            method: options?.method ?? "GET",
            signal: options?.signal,
        });

        // Rejecting here is what surfaces the failure on the app's `error`
        // event, which the banner below renders.
        if (!response.ok) {
            let body = (await response.text()).trim();
            throw new Error(body || `${response.status} ${response.statusText}`);
        }

        applyPageMetadata(response.headers);

        // Return the Response, not its body: the runtime only learns a
        // submission was redirected from `response.redirected`/`response.url`,
        // and uses it to re-sync the address bar with the swapped content.
        return response;
    },
});

// Global error boundary — renders a dismissible banner for any error dispatched
// on the app runtime, including failed frame navigations and submissions.
let bannerHost = document.createElement("div");
document.body.insertBefore(bannerHost, document.body.firstChild);
let bannerRoot = createRoot(bannerHost);

function ErrorBanner(handle: Handle<{ message: string }>) {
    return () => (
        <div class="error-banner" role="alert">
            <span>{handle.props.message}</span>
            <button
                aria-label="Dismiss"
                mix={on("click", () => bannerRoot.render(null))}
                type="button"
            >
                {"\u00d7"}
            </button>
        </div>
    );
}

app.addEventListener("error", event => {
    let error = event.error;
    let message = error instanceof Error ? error.message : String(error);
    bannerRoot.render(<ErrorBanner message={message} />);
});

// Must be registered after `run` (last intercept() call wins for focusReset).
// `remix/component` never sets focusReset, so preserving focus across an enhanced
// navigation — the search input keeping focus while results stream in — is
// still the app's job.
navigation.addEventListener("navigate", event => {
    if (
        !event.canIntercept ||
        event.defaultPrevented ||
        // Traversals (back/forward) are handled by the built-in listener.
        event.navigationType === "traverse"
    ) {
        return;
    }

    event.intercept({ focusReset: "manual" });
});
```

**`run()`** installs the navigation listener, creates the top frame from `document.location.href`, registers named frames, and returns the app runtime — an event target with `frames.top`, `frames.get(name)`, `ready()`, `flush()`, and `dispose()`. Every anchor click and form submission is handled from here (Recipe 2); the app adds nothing.

**`loadModule`** resolves a hydrated `clientEntry()` back to its browser module. The runtime hands you a module URL and an export name from the server-rendered hydration marker, and you return the function. The `@vite-ignore` comment is required because the specifier is dynamic by construction.

**`resolveFrame`** is the one request the app owns. Its contract:

- Build the frame headers: `accept: text/html` plus `x-remix-frame: true`, and `x-remix-target` only when a named frame is being reloaded. These are the same two headers `frameTarget()` pairs on the server (Recipe 5), and this is the only place the client sets them — a hand-rolled `fetch()` elsewhere would silently omit them and get a whole document back.
- Pass through the runtime's `options`: `method` (defaulting to `GET`), `formData`, and `signal`. The signal is the navigation's — a superseded navigation aborts its in-flight frame fetch, which is what lets `SearchBar` fire one per keystroke (Recipe 4).
- **Throw on a non-ok response.** That rejection is the whole error path: the runtime catches it and dispatches a `ComponentErrorEvent` on the app runtime, which the `error` listener turns into the banner. Nothing in the app constructs or dispatches an `ErrorEvent` by hand anymore. The throw has to come _first_, before the response is handed back: a returned `Response` gets its body rendered as frame content regardless of status, so a 415 would paint the validation error into the detail frame instead of the banner.
- Call `applyPageMetadata(response.headers)` on the way out, so a `detail`-frame swap updates `document.title` and the description meta tag. See Recipe 22 for why a partial frame swap needs this and a full-document navigation does not.
- **Return the `Response`, not `response.body`.** The runtime unwraps it: a `Response` resolution is the only shape from which it can read `redirected` and `url`, and that is the signal it uses to start a replacing navigation so the address bar matches the swapped-in content. Return a body or a string and that re-sync is silently lost — a POST that ends in a redirect leaves the submitted action URL in the address bar while the redirect target's HTML renders. (Returning the body is legal, and fine for a resolver that only ever serves GETs, but there is no reason to give up the redirect information.)

**Why the `focusReset` listener must come after `run()`.** Multiple `navigate` listeners may each call `event.intercept()`; for options like `focusReset` and `scroll`, the _last_ call wins. `remix/component` never sets `focusReset`, so the browser's default (reset focus to the document) would apply and the search input would lose focus on every keystroke-driven frame update. Registering after `run()` makes the app's `{ focusReset: "manual" }` the winning option while leaving the runtime's `handler` — the actual frame reload — intact. There is no native equivalent to opt into; this listener is the reason it stays in the entry.

**Why traverse navigations are skipped.** Back/forward navigations restore frame state from the history entry inside the runtime's own listener, which sets `scroll: 'manual'` and lets the Navigation API perform its deferred scroll restoration. Adding `focusReset: "manual"` there would fight that restoration, so the app returns early for `navigationType === "traverse"`, and for events it can't intercept or that someone already prevented.

---

### 12. How should I manage history (push vs. replace)?

**Decision:** When should a navigation create a new history entry vs. replace the current one?

**Heuristic:**

| Scenario                                             | History mode          | Why                                                                    |
| ---------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| User clicks a link to a new page                     | **push** (default)    | Back should return to the previous page                                |
| Search-as-you-type, after the first keystroke        | **push**              | Back navigates between meaningful search states                        |
| First search keystroke                               | **replace**           | Overwrite the pre-search entry instead of stacking `?q=s` onto it      |
| Clearing the search input                            | **push** (default)    | The unfiltered list is its own destination                             |
| Re-syncing after an optimistic write                 | **no history at all** | Use `frame.reload()`, not `navigate()` — the destination never changed |
| Non-GET form submission back to the current URL      | **replace**           | Runtime default: a mutation that re-renders in place                   |
| GET submission, or any submission to a different URL | **push**              | Runtime default: a new destination                                     |

**From JavaScript** — `navigate()` takes a `history` option (`"push" | "replace"`), alongside `target`, `src`, and `resetScroll`:

```tsx
// Push (new history entry) — the default when `history` is omitted
await navigate(url.toString(), { target: "sidebar" });

// Conditional, as in `app/ui/search-bar.tsx`
await navigate(url.toString(), {
    history: isFirstSearch ? "replace" : "push",
    target: "sidebar",
});

// Re-syncing after a write is NOT a navigation — reload the stale frames
// instead, as `favorite-button.tsx` does:
await handle.frame.reload();
```

When the Navigation API isn't interceptable, `navigate()` degrades to `location.replace(href)` for `"replace"` and `location.assign(href)` otherwise — so the history semantics hold either way.

**From markup** — the runtime reads `data-rmx-history="push|replace"` directly off the anchor or form it intercepts, no client entry needed:

```tsx
<a data-rmx-history="replace" data-rmx-target="detail" href={href}>
    Details
</a>
```

The attribute is resolved next to `data-rmx-target`, `data-rmx-src`, and `data-rmx-reset-scroll` when the runtime inspects the navigation's source element, and it overrides the per-element default in the table above (including the automatic replacement of a non-GET submission to the current URL). `data-rmx-document` opts the element out of interception entirely, in which case history is whatever the browser does natively. This app doesn't need the attribute today — its one history override is the conditional `navigate()` call in the search bar.

---

### 13. How do I set up request-scoped data?

**Decision:** How do I make data (database connections, user sessions, etc.) available throughout a request?

**Heuristic:** Use context keys and middleware injection. Context keys are type-safe tokens that middleware `set()`s and handlers `get()`. Prefer passing context explicitly; reach for `getContext()` only where a function genuinely cannot receive it.

**Using built-in context keys:** Some packages export pre-defined context keys. For example, `remix/data-table` exports a `Database` key:

```tsx
import { Database } from "remix/data-table";
```

**Set it in middleware** (`app/middleware.ts`):

```tsx
import { createD1Database } from "@pitlane/data-table-d1";
import { env } from "cloudflare:workers";
import { Database } from "remix/data-table";
import { type Middleware } from "remix/router";

type DatabaseEntry = { key: typeof Database; value: Database };

export function database(): Middleware<DatabaseEntry> {
    // Built once per isolate: the binding is stable, so there is nothing to
    // rebuild per request.
    let db = createD1Database(env.DB);

    return (ctx, next) => {
        ctx.set(Database, db);
        return next();
    };
}
```

The `Middleware<DatabaseEntry>` generic tells `remix/router` what this middleware adds to the context. When combined with the `RouterTypes` augmentation in Recipe 7, `ctx.get(Database)` becomes typed in every action.

**Define custom context keys** when no built-in key exists:

```tsx
import { createContextKey } from "remix/router";
export let MyService = createContextKey<MyServiceType>();
```

**Read it in actions:**

```tsx
let db = ctx.get(Database);
```

**Why `asyncContext()` is still in the stack.** It exists for exactly one caller shape: a helper that is called _from_ an action but doesn't receive the action's `ctx`. Every query in `app/data/contacts.ts` is one of those:

```tsx
export async function getContacts(query?: string): Promise<Contact[]> {
    let db = getContext().get(Database);
    await fakeNetwork(`getContacts:${query}`);

    let contacts = await db.findMany(Contacts);

    if (query) {
        contacts = matchSorter(contacts, query, { keys: ["first", "last"] });
    }

    return sortBy(contacts, ["last", "createdAt"]);
}
```

Threading `ctx` through every call site just to reach a `Database` handle would put a request parameter on functions whose signatures are otherwise pure data access. This is the case async context is for.

**`render()` does not use async context.** It's worth being precise about this, because "the renderer needs `getContext()`" is an easy assumption to make. It doesn't. `render()` is built on `renderWith(context => …)`, so the `ctx.render` it installs is a closure that captured that request's context directly. `asyncContext()` could move or disappear and `ctx.render` would keep working — it stays in the stack for `app/data/contacts.ts`, nothing else.

**Prefer explicit context for action-adjacent helpers.** A function that renders part of a page is not a data-access helper; it's an extension of the action, and it should take the context as an argument. Declare the _slice_ it needs rather than the whole `RequestContext`, which keeps it callable from more than one controller and trivially testable (`app/actions/sidebar.tsx`):

```tsx
import type { RenderFunction } from "remix/middleware/render";

/** The slice of the request context the sidebar frame needs. */
type SidebarContext = {
    render: RenderFunction;
    url: URL;
};

/** Renders the `sidebar` frame. Shared by the root and contacts controllers. */
export async function sidebar(ctx: SidebarContext, selected?: number): Promise<Response> {
    let { q } = s.parse(QuerySchema, ctx.url.searchParams);
    let contacts = await getContacts(q);

    return ctx.render(/* ... */);
}
```

`RenderFunction` is `(node: RemixNode, init?: ResponseInit) => Response`, imported as a type from `remix/middleware/render`. Both controllers can call `sidebar(ctx)` because the real `ctx` structurally satisfies `SidebarContext` — no casting, no adapter. `app/actions/contacts/controller.tsx` declares its own slightly wider slice the same way:

```tsx
/** The slice of the request context a contact page needs. */
type ContactContext = {
    headers: Headers;
    params: Record<string, string | undefined>;
    render: RenderFunction;
    url: URL;
};
```

The rule of thumb: **data access reads context implicitly; rendering receives it explicitly.**

---

### 14. How do I compose the component factory pattern?

**Decision:** Why do components return functions, and how does this affect composition?

**Heuristic:** Every Remix 3 component is a factory — a function that returns a render function. The outer function is the "setup" phase (runs once); the inner function is the "render" phase (runs on every update).

**Server-only component** (`app/ui/restful-form.tsx`, in full):

```tsx
export function RestfulForm(
    handle: Handle<JSX.IntrinsicHTMLElements["form"] & { method?: RequestMethod | "ANY" }>,
) {
    return () => {
        let { children, method, ...props } = handle.props;
        let isGET = method === "GET" || typeof method === "undefined";
        return (
            <form method={isGET ? "GET" : "POST"} {...props}>
                {!isGET && <input name="_method" type="hidden" value={method} />}
                {children}
            </form>
        );
    };
}
```

For server-only components the setup phase is usually empty — there's no persistent state to hold, and every derived value belongs in the render function where it sees current props. The factory shape is still required.

**Hydrated component:** setup is where you register listeners once, and where mutable state lives so it survives re-renders. `app/actions/contacts/sidebar-item.tsx`, trimmed:

```tsx
export let SidebarItem = clientEntry(import.meta.url, (handle: Handle<SidebarItem.Props>) => {
    // Setup: runs once on hydration
    onDestinationChange(() => handle.update(), { signal: handle.signal });

    return () => {
        // Render: runs on every update, always against current props
        let { selected, query, contact } = handle.props;
        let currentMatch = isServer ? null : matcher.match(location.href);
        let isActive = Number(currentMatch?.params?.id ?? selected) === contact.id;
        // …derive pending state, then return the <li>
    };
});
```

`handle.signal` aborts when the component disconnects, so a listener registered in setup never outlives its component. Mutable setup-scope variables are the state model: `app/ui/search-bar.tsx` keeps a `pendingSearches` counter in setup, mutates it from an event handler, and calls `handle.update()` to re-render — no store, no hooks, no dependency arrays.

**Composing components:** use standard JSX composition. Server-only components can contain hydrated components, creating islands of interactivity. `app/actions/contacts/show-page.tsx` is server-only; the `FavoriteButton` inside it is a client entry:

```tsx
export function ShowContact(handle: Handle<{ contact: Contact; query?: string }>) {
    return () => {
        let props = handle.props;

        return (
            <div id="detail">
                {/* … */}
                <h1>
                    {props.contact.first || props.contact.last ? (
                        <>
                            {props.contact.first} {props.contact.last}
                        </>
                    ) : (
                        <i>No Name</i>
                    )}{" "}
                    <FavoriteButton
                        contactId={props.contact.id}
                        favorite={props.contact.favorite ?? false}
                    />
                </h1>
                {/* … */}
            </div>
        );
    };
}
```

This is the islands architecture pattern: the server renders the full page, but only the interactive pieces ship JavaScript to the client. The surrounding server-only markup is static HTML with zero runtime cost.

---

### 15. How do I target a specific frame from links and forms?

**Decision:** How do I make a link or a form update a specific frame instead of the whole page?

**Heuristic:** Set `data-rmx-target` on the `<a>` or the `<form>` that navigates. Both prop types declare the `data-rmx-*` attributes, so it is a plain typed JSX prop — no mixin, no client entry, no submit handler.

**On anchors.** From `app/actions/contacts/sidebar-item.tsx`:

```tsx
<a
    class={isActive ? "active" : isPending ? "pending" : undefined}
    data-rmx-target="detail"
    href={routes.contacts.show.href(
        { id: contact.id },
        { searchParams: { q: query } },
    )}
>
```

The runtime's anchor path reads the attributes straight off the closest `a`/`area`, so this needs no JavaScript of its own.

**On forms — the attribute goes on the `<form>`, not the button.** This is the canonical shape: once `run({ resolveFrame })` starts, an eligible same-origin form follows the same frame-navigation path as a link. From `app/actions/contacts/show-page.tsx`:

```tsx
<RestfulForm
    action={routes.contacts.edit.href(
        { id: props.contact.id },
        { searchParams: { q: props.query } },
    )}
    data-rmx-target="detail"
    method={routes.contacts.edit.method}
>
    <button type="submit">Edit</button>
</RestfulForm>
```

`RestfulForm` spreads its extra props onto the underlying `<form>`, so `data-rmx-target` lands where the runtime looks for it.

**Submitter attributes beat form attributes.** The runtime checks the submitter first and falls back to the `<form>` for every attribute in the vocabulary — the frame-targeting analogue of `formaction`. That only matters for one form with several submit buttons that should land their responses in _different_ frames. Reach for it then, and be aware of the cost: `ButtonHTMLProps` does not declare the `data-rmx-*` attributes (only `AnchorHTMLProps` and `FormHTMLProps` do), so a button-level override needs a small `createMixin` wrapper to set them. Put the attribute on the `<form>` whenever every submitter agrees, which is almost always.

Do **not** reach for `remix/component`'s own `link()` mixin here. On a non-anchor host it applies _link_ semantics: it sets `role="link"`, forces a button's `type` to `"button"`, and navigates from a `preventDefault`ed click — which cancels the form submission entirely.

**The attribute vocabulary the runtime reads:**

| Attribute               | Value                   | Effect                                                                                                            |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `data-rmx-target`       | frame name              | Reload that named frame. Absent → the top frame. Unmounted name → document navigation.                            |
| `data-rmx-src`          | same-origin URL         | Source to fetch for the frame. Defaults to the destination URL; cross-origin falls back to a document navigation. |
| `data-rmx-history`      | `"push"` \| `"replace"` | Overrides the default entry handling (a submission back to the current URL replaces).                             |
| `data-rmx-reset-scroll` | `"false"` to opt out    | Any other value (or absence) resets scroll; `"false"` also implies `scroll: "manual"`.                            |
| `data-rmx-document`     | present                 | Opt out of interception entirely — let the browser perform a real document navigation.                            |

`data-rmx-document` is also how you escape the SPA for a link that must reload the page (a `download` attribute has the same effect on anchors).

**Programmatic equivalent.** `navigate()` takes the same four knobs (`target`, `src`, `history`, `resetScroll`) as an options object. From `app/ui/search-bar.tsx`:

```tsx
await navigate(url.toString(), {
    history: isFirstSearch ? "replace" : "push",
    target: "sidebar",
});
```

`navigate()` returns a promise that settles when the Navigation API transition finishes — i.e. once the targeted frame has swapped — which is how `SearchBar` derives its own pending state without a global navigation bus (Recipe 10).

**Use plain attributes for markup-driven navigation and `navigate()` for programmatic navigation.** They feed the same runtime state; the attributes are just the declarative form. If you want compile-time validation of frame names, narrow the mixin's `target` to a union literal (`"sidebar" | "detail"`) — the server side stays a plain string, since `frameTarget()` returns `string | null` (Recipe 5).

---

### 16. How do I handle the full-page vs. frame response decision?

**Decision:** My controller handles the same route for initial loads and frame updates. How do I return the right response?

**Heuristic:** Call `frameTarget(ctx.headers)` (Recipe 5) once, then branch on the frame name. Every branch ends in `ctx.render()`; what differs is the tree you hand it. Factor the branch into one helper per layout so the actions stay one-liners.

`app/actions/contacts/controller.tsx`:

```tsx
/** A contact's detail-frame content plus the page metadata that describes it. */
type DetailPage = PageMetadata & { node: RemixNode };

/** The slice of the request context a contact page needs. */
type ContactContext = {
    headers: Headers;
    params: Record<string, string | undefined>;
    render: RenderFunction;
    url: URL;
};

/**
 * Serves whichever of the three shapes the request asked for: the `sidebar`
 * frame, the `detail` frame, or the whole document.
 */
async function contactPage(
    ctx: ContactContext,
    detail: (contact: Contact) => DetailPage,
): Promise<Response> {
    let { id } = s.parse(IdSchema, ctx.params);
    let target = frameTarget(ctx.headers);

    if (target === "sidebar") {
        return sidebar(ctx, id);
    }

    let contact = await getContact(id);
    if (!contact) {
        return redirect(routes.home.href());
    }

    let page = detail(contact);

    if (target === "detail") {
        return ctx.render(page.node, { headers: pageMetadataHeaders(page) });
    }

    return ctx.render(<Document description={page.description} title={page.title} />);
}
```

The callback returns a `DetailPage` — the frame's node _plus_ its title and optional description — so one description of the page serves both the fragment and the document. Actions supply only that:

```tsx
async show(ctx) {
    let { q } = s.parse(QuerySchema, ctx.url.searchParams);

    return await contactPage(ctx, contact => ({
        description: contact.notes || (contact.bsky ? `@${contact.bsky}` : undefined),
        node: <ShowContact contact={contact} query={q} />,
        title: `${contactName(contact)} · ${SITE.title}`,
    }));
},
async edit(ctx) {
    return await contactPage(ctx, contact => ({
        node: <EditContact contact={contact} />,
        title: `Edit ${contactName(contact)} · ${SITE.title}`,
    }));
},
```

**What each branch produces:**

- **`sidebar`** — delegates to the shared `sidebar()` helper, which renders a `<nav>`. It receives `id` so the server-rendered items know which one is selected.
- **`detail`** — renders just the detail node, and attaches `pageMetadataHeaders(page)` to the response. A partial frame swap doesn't reconcile `<head>`, so the title and description ride along as response headers and the browser applies them as the frame resolves. See Recipe 22.
- **Neither (a normal navigation)** — renders `<Document />` with the same title and description, which land in the document's real `<head>`. This is the no-JavaScript path and the initial load, and it is where the `<Frame>` elements cause the render middleware to fetch both regions in-process.

Note there is no `try/catch` around this. A missing contact is a `redirect()` — an ordinary returned response, which the render middleware follows when the request is a frame sub-request and `fetch` follows in the browser. Only genuinely exceptional failures belong in a catch, and those are better handled by a middleware that converts one known error type (see `uploadErrors()` in Recipe 35).

**Also `ctx` is passed, not fetched.** `ContactContext` is a structural slice — `headers`, `params`, `render`, `url` — so the helper never calls `getContext()`, has no hidden dependency on the async-context middleware, and can be called with a literal in a test.

**The alternative: give the frame its own route.** Instead of one URL that serves three shapes, point the frame at a dedicated path. This app has no such route — sketched here for contrast:

```tsx
<Frame name="detail" src={routes.contacts.detail.href({ id })} />
```

That route's action only ever returns the fragment, so it needs no `frameTarget()` check at all — the branch disappears, and the fragment becomes independently addressable and cacheable. Prefer it when the region's data or cache lifetime genuinely differs from the page's, or when several different pages embed the same region.

Prefer the header check — the shape this app uses — when the frame's content _is_ the page: `/contacts/5` must be bookmarkable, must render a full document for a cold load or a crawler, and must serve the same content as a fragment for a client-side swap. One URL, one action, three renderings, and progressive enhancement falls out for free.

---

### 17. How should I define database tables, migrations, and queries?

**Decision:** How do I set up typed database access with `remix/data-table`?

**Heuristic:** Define table schemas using `column` and `table`, derive TypeScript types with `TableRow`, use migration utilities to create tables, and access the database through the request context.

**Table definition:**

```tsx
import { column as c, table, type TableRow } from "remix/data-table";

export let Posts = table({
    name: "posts",
    columns: {
        id: c.integer().primaryKey(),
        title: c.text().notNull(),
        body: c.text().notNull(),
        published: c.boolean().default(false),
        createdAt: c.timestamp().defaultNow(),
    },
});

export type Post = TableRow<typeof Posts>;
```

**Timestamp columns:** Use `c.timestamp().defaultNow()` for creation timestamps. The value is automatically populated on insert -- you don't need to pass it when creating records:

```tsx
// createdAt is filled in automatically
let post = await db.create(Posts, { title: "Hello", body: "World" }, { returnRow: true });
```

**Migrations:** When deploying to Cloudflare D1, author migrations as plain SQL under `db/migrations/` — one directory per migration holding a required `up.sql` and an optional `down.sql` — then compile them to deterministic `.sql` files in `db/d1-migrations/` (committed to git). Cloudflare's own `wrangler d1 migrations apply` consumes the generated SQL — both `--local` and `--remote` use the same files.

```
db/migrations/20260213161402_create_posts/up.sql
db/migrations/20260213161402_create_posts/down.sql
```

```sql
-- up.sql
create table if not exists "posts" ("id" integer, "title" text not null, "body" text not null, "createdAt" text default current_timestamp, constraint "posts_pk" primary key ("id"));
create index if not exists "posts_title_createdat_idx" on "posts" ("title", "createdAt");
```

```sql
-- down.sql
drop table if exists "posts";
```

> **D1 constraint:** Migrations MUST contain only DDL. Data manipulation belongs in a standalone seed script (see "Seed data" below).
>
> Per-migration transaction behavior is set with a directive on the first non-blank line of `up.sql`: `-- data-table/transaction: none` (modes: `auto` default, `required`, `none`).

**Compiling to SQL** — `generateD1Migrations` from `@pitlane/data-table-d1/migrations` reads each migration's `up.sql` and writes one Wrangler-shaped `.sql` file per migration, then deletes generated files with no migration behind them so the output directory is a pure function of the input one:

```tsx
// db/generate-d1-migrations.ts
import { generateD1Migrations } from "@pitlane/data-table-d1/migrations";
import path from "node:path";

import { parseWranglerConfig } from "./lib/wrangler-config.ts";

let { d1 } = parseWranglerConfig();

let generated = await generateD1Migrations({ to: d1.migrationsDir });

console.log(
    `Generated ${generated.length} migration(s) into ${path.relative(".", d1.migrationsDir)}`,
);
```

Read the output directory from `wrangler.jsonc`'s `migrations_dir` rather than hardcoding it, so the generator and D1's own migration runner can never disagree about where the files live. `from` defaults to `db/migrations`.

The helper copies each `up.sql` **verbatim** rather than splitting it into statements. Splitting is the job of whatever executes the file, and a splitter naive enough to live in a generator would corrupt any migration with a semicolon inside a string literal or a `begin ... end` trigger body. It throws when the source directory holds no migrations, or when a migration's `up` is empty — a migration runner is the worst place to discover either.

`schema.createTable()` reads column definitions directly from the `table()` call, so you never write raw SQL for table creation. `schema.createIndex()` takes the table and an array of column names. Use `{ ifNotExists: true }` / `{ ifExists: true }` for idempotent migrations.

**Seed data** lives in a separate standalone script (`db/seed.ts`), not a migration. It connects to D1 via Wrangler's `getPlatformProxy` and inserts rows directly:

```tsx
// db/seed.ts
import { createD1Database } from "@pitlane/data-table-d1";
import { getPlatformProxy } from "wrangler";

import { Posts } from "#/data/posts.ts";

let proxy = await getPlatformProxy<Env>({ configPath: "./wrangler.jsonc", persist: true });

try {
    let db = createD1Database(proxy.env.DB);

    let count = await db.count(Posts);
    if (count > 0) {
        console.log(`Seed skipped: ${count} row(s) already present.`);
        process.exit(0);
    }

    for (let post of SEED_POSTS) {
        await db.create(Posts, post);
    }
} finally {
    await proxy.dispose();
    process.exit(0);
}
```

The seed runs only against local D1 (via `getPlatformProxy`) — production starts empty.

**Query functions** access the database through context:

```tsx
export async function getPosts(): Promise<Post[]> {
    let db = getContext().get(Database);
    return await db.findMany(Posts);
}
```

**Key pattern:** Data access functions use `getContext()` to get the database rather than accepting it as a parameter. This keeps function signatures clean and works anywhere in the call stack as long as `asyncContext()` middleware is active.

---

### 18. How do I evolve my database schema over time?

**Decision:** My app is already running in production and I need to add a column, rename a table, or make another schema change. How do I manage this?

**Heuristic:** Use migration files — one per schema change, timestamped and ordered. Each migration has an `up` (apply) and `down` (revert) function. On Cloudflare D1, compile them to `.sql` and let Wrangler's `d1 migrations apply` track which have run via its built-in `d1_migrations` journal table.

**Project structure:**

```
db/
  migrations/                                # Source SQL migrations
    20260228090000_create_posts/{up,down}.sql
    20260315140000_add_published_at/{up,down}.sql
    20260320100000_add_tags/{up,down}.sql
  d1-migrations/                             # Generated .sql (committed)
    20260228090000_create_posts.sql
    20260315140000_add_published_at.sql
    20260320100000_add_tags.sql
  generate-d1-migrations.ts                  # up.sql → Wrangler-format .sql
  apply-d1-migrations.ts                     # Shells out to `wrangler d1 migrations apply`
  seed.ts                                    # Standalone seed script
  lib/                                       # Shared helpers
```

Name each migration directory as `YYYYMMDDHHmmss_name/`. The `id` and `name` are inferred from the directory name. `up.sql` is required; `down.sql` is optional and powers `remix db rollback`.

**Writing a migration that adds a column:**

```sql
-- 20260315140000_add_published_at/up.sql
alter table "posts" add column "publishedAt" timestamptz;
```

```sql
-- 20260315140000_add_published_at/down.sql
alter table "posts" drop column "publishedAt";
```

**Other common schema changes** — write them as ordinary SQL for your dialect:

```sql
alter table "posts" add column "subtitle" text;
alter table "posts" drop column "subtitle";
alter table "posts" add constraint "posts_pk" primary key ("id");
alter table "posts" add constraint "posts_author_fk" foreign key ("author_id") references "authors" ("id");
```

Data backfills run as plain statements alongside the schema change in the same `up.sql`:

```sql
-- 20260320100000_add_status/up.sql
alter table "posts" add column "status" text not null default 'draft';
update "posts" set "status" = 'published' where "published" = true;
```

**Defensive checks:** SQLite and Postgres both support `if not exists` / `if exists` guards, which replace the old `schema.hasTable()` / `schema.hasColumn()` helpers:

```sql
create table if not exists "posts" ("id" integer primary key);
drop index if exists "posts_legacy_idx";
```

> **Checksums:** a migration's checksum is `sha256(up)`. Editing an `up.sql` that has already been applied changes its checksum, so keep ids stable and add a new migration instead of rewriting an applied one.

**The two-step Cloudflare D1 workflow:**

1. **Generate** — `vp run db:migrations:generate` reads each migration's `up.sql` through `loadMigrations()` and writes one deterministic `.sql` file per source migration into `db/d1-migrations/`. These files are committed to git.
2. **Apply** — `vp run db:migrations:apply:local` (or `:remote`) shells out to `wrangler d1 migrations apply DB --local` (or `--remote`), which reads `db/d1-migrations/` and uses Wrangler's own `d1_migrations` journal table on the target database.

The apply helper is a thin wrapper around `wrangler`:

```tsx
// db/apply-d1-migrations.ts (simplified)
import { parseArgs } from "node:util";

import { buildApplyCommand, runApplyCommand } from "./lib/wrangler-cli.ts";
import { parseWranglerConfig } from "./lib/wrangler-config.ts";

let { values } = parseArgs({
    options: {
        local: { type: "boolean", default: false },
        remote: { type: "boolean", default: false },
    },
});
let target: "local" | "remote" = values.local ? "local" : "remote";

let config = parseWranglerConfig();
let cmd = buildApplyCommand({
    d1Binding: config.d1.binding,
    target,
    configPath: config.configPath,
});

let { stdout, stderr } = await runApplyCommand(cmd);
process.stdout.write(stdout);
process.stderr.write(stderr);
```

The `--remote` target needs `CLOUDFLARE_API_TOKEN` (or `CLOUDFLARE_API_KEY`) in the environment.

**Wiring it into Vite+ tasks** (`vite.config.ts`):

```ts
run: {
    tasks: {
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
        "db:seed": {
            dependsOn: ["db:migrations:apply:local"],
            command: "node db/seed.ts",
        },
        "db:reset": {
            command: "rm -rf .wrangler/state/v3/d1",
        },
    },
},
```

This makes `vp dev` (which `dependsOn: ["typegen", "db:seed"]`) idempotently regenerate SQL, apply migrations locally, and seed demo rows before starting the server.

**`wrangler.jsonc` setup:** Point `migrations_dir` at `db/d1-migrations/` (relative to the wrangler config file):

```jsonc
"d1_databases": [
    {
        "binding": "DB",
        "database_name": "my-db",
        "database_id": "local",
        // Generated by `vp db:migrations:generate` from db/migrations/*.ts.
        "migrations_dir": "./db/d1-migrations"
    }
]
```

**The development workflow:**

When you need to change your schema, you update three things together in the same commit:

1. **Update the `table()` definition** in your source code to reflect the desired schema (e.g., add the new column to the `columns` object).
2. **Write a TS migration** in `db/migrations/` that transitions the database (e.g., `schema.alterTable` with `table.addColumn`).
3. **Regenerate `db/d1-migrations/`** by running `vp run db:migrations:generate` and commit the resulting `.sql` file alongside the source.

The `table()` definition is the source of truth for what the schema looks like _now_. The TS migration describes _how to get there_. The committed `.sql` is the artifact Wrangler actually applies — keeping it under source control means CI/CD doesn't need to compile TS at deploy time, and `--local` and `--remote` are guaranteed to apply byte-identical SQL.

**At deploy time**, apply migrations before the worker takes traffic:

```sh
vp run db:migrations:deploy && wrangler deploy
```

Wrangler's `d1_migrations` journal table tracks which migrations have already been applied, so this is always safe — it only applies new ones.

**Key principles:**

- **One migration per change:** Each migration should do one logical thing (add a column, create a table, backfill data). This keeps rollbacks predictable.
- **Migrations are append-only:** Never edit a migration that has already been applied in production. Write a new migration instead.
- **Table definition and migration in the same commit:** The `table()` definition describes the _current_ state; the migration describes the _transition_. Shipping them together guarantees the code and database stay in sync.
- **Use `dryRun` in CI:** Review generated SQL before deploying to catch dialect-specific issues.

---

### 19. How do I handle redirects after mutations?

**Decision:** What should happen after a create/update/delete?

**Heuristic:** Follow the Post/Redirect/Get pattern. After every mutation, redirect to the appropriate page. Import `redirect` from `remix/response/redirect`:

```tsx
import { redirect } from "remix/response/redirect";

// After create: redirect to the edit page for the new record
async create() {
    let id = await createPost();
    return redirect(routes.posts.edit.href({ id }));
}

// After update: redirect to the show page
async update(ctx) {
    let data = s.parse(PostSchema, ctx.formData);
    let { id } = s.parse(IdSchema, ctx.params);
    await updatePost(id, data);
    return redirect(routes.posts.show.href({ id }));
}

// After delete: redirect to the index or home
async destroy(ctx) {
    let { id } = s.parse(IdSchema, ctx.params);
    await deletePost(id);
    return redirect(routes.posts.index.href());
}
```

**Why PRG matters:** It prevents duplicate submissions on refresh and ensures the browser's back button works correctly.

**For non-navigating mutations** (like toggling a boolean field), return data instead of redirecting:

```tsx
async toggle(ctx) {
    let { enabled } = s.parse(ToggleSchema, ctx.formData);
    let { id } = s.parse(IdSchema, ctx.params);
    let updated = await updateItem(id, { enabled });
    return Response.json(updated);
}
```

The client handles the state update optimistically and doesn't need a redirect.

---

### 20. How do I configure Vite+ for a Remix project?

**Decision:** What does my `vite.config.ts` need?

**Heuristic:** Keep it minimal. The Remix plugin handles most of the build configuration. When deploying to Cloudflare Workers, add the `@cloudflare/vite-plugin` to handle Workers-specific bundling and binding injection.

```tsx
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
    server: { port: 1612 },
    css: { transformer: "lightningcss" },
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
            "db:reset": { command: "rm -rf .wrangler/state/v3/d1" },
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
                input: ["wrangler.jsonc"],
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
            deploy: { command: "wrangler deploy", cache: false },
        },
    },
    fmt: {/* Oxfmt options */},
    lint: {/* Oxlint options */},
});
```

**Plugin configuration:**

- `remix({ serverHandler: false })` — Lets `@cloudflare/vite-plugin` own dev-time request handling inside workerd.
- `cloudflare({ viteEnvironment: { name: "ssr" } })` — Tells the Cloudflare Vite plugin which build environment contains the server entry. This plugin handles Workers-specific bundling, injects platform bindings (D1, R2, etc.) during dev, and produces a deployable worker bundle.

**Run tasks:** The `run.tasks` config defines orchestrated commands that `vp run <task>` executes. Key patterns:

- **`dependsOn`:** Ensures prerequisites run first. `dev` chains `typegen` (generates `Env` types from `wrangler.jsonc`) and `db:seed` (which itself chains `db:migrations:apply:local` → `db:migrations:generate`).
- **`input`:** File-based cache invalidation. `typegen` only reruns when `wrangler.jsonc` changes.
- **`cache: false`:** Disables caching for tasks that should always run (typecheck, deploy, migrations).
- **`db:reset`:** Deletes local D1 state for a clean slate during development.
- **`test`:** Runs Vitest (see Recipe 32). Depends on `db:migrations:generate` so the schema the worker tests apply is never stale.

**What `@pitlane/dev`'s `remix()` plugin provides:**

- **Build orchestration:** Builds SSR then client environments, with separate output directories (`dist/ssr`, `dist/client`)
- **Preview server:** Loads the built SSR entry and creates a request listener for `vp preview`
- **Client entry transforms:** Automatically resolves `import.meta.url` in `clientEntry()` calls to the correct asset URLs for both server and client environments
- **Error suppression:** Prevents abort errors from cancelled requests (e.g., search-as-you-type) from triggering the Vite error overlay

**Commands:**

- `vp dev` — start dev server with HMR (runs typegen + migrations + seed first)
- `vp build` — production build
- `vp preview` — preview production build locally
- `vp check` — format + lint + typecheck in one pass
- `vp run test` — run the Vitest suite (worker + dom projects)
- `vp run db:migrations:deploy` — generate SQL + apply to remote D1
- `vp run deploy` — deploy to Cloudflare Workers
- `vp run db:reset` — wipe local D1 database

---

### 21. How do I derive active/pending state for navigation items?

**Decision:** How does a list item know if it's currently active or being navigated to?

**Heuristic:** Match route patterns against the current URL (for active) and against the in-flight navigation's destination (for pending). Both have to be derived on the client, because a frame-targeted navigation re-renders only the targeted frame — components in _other_ frames keep their original server-provided props.

`app/actions/contacts/sidebar-item.tsx`, in full:

```tsx
import { clientEntry, type Handle, type SerializableProps } from "remix/component";
import { createMultiMatcher } from "remix/route-pattern/match";

import { routes } from "#/routes.ts";
import { isServer, onDestinationChange, pendingDestination } from "#/utils/pending-navigation.ts";

let matcher = createMultiMatcher<true>();
matcher.add(routes.contacts.show.pattern, true);
matcher.add(routes.contacts.edit.pattern, true);

export namespace SidebarItem {
    export interface Props extends SerializableProps {
        selected: string;
        query?: string;

        contact: {
            id: number;
            first?: string;
            last?: string;
            favorite?: boolean;
        };
    }
}

export let SidebarItem = clientEntry(import.meta.url, (handle: Handle<SidebarItem.Props>) => {
    onDestinationChange(() => handle.update(), { signal: handle.signal });

    return () => {
        let { selected, query, contact } = handle.props;
        // Derive active state from the current URL on the client, since
        // frame-targeted navigations don't re-render the sidebar and the
        // server-provided `selected` prop becomes stale.
        let currentMatch = isServer ? null : matcher.match(location.href);
        let isActive = Number(currentMatch?.params?.id ?? selected) === contact.id;

        let pending = pendingDestination();
        let destinationMatch = pending ? matcher.match(pending.href) : null;
        // Only show pending for contacts that aren't already active
        let isPathChange = !isServer && pending?.pathname !== location.pathname;
        let isPending =
            !isActive && isPathChange && Number(destinationMatch?.params.id) === contact.id;

        return (
            <li>
                <a
                    class={isActive ? "active" : isPending ? "pending" : undefined}
                    data-rmx-target="detail"
                    href={routes.contacts.show.href(
                        { id: contact.id },
                        { searchParams: { q: query } },
                    )}
                >
                    {contact.first || contact.last ? (
                        <>
                            {contact.first} {contact.last}
                        </>
                    ) : (
                        <i>No Name</i>
                    )}
                    {contact.favorite ? <span>{"\u2605"}</span> : null}
                </a>
            </li>
        );
    };
});
```

**The anchor needs no mixin.** `data-rmx-target="detail"` is a plain typed JSX prop — `AnchorHTMLProps` declares the `data-rmx-*` attributes, and the runtime reads them off the source element when it intercepts the click. The same is true of the `<form>` that the Edit button submits (see Recipe 15). The app owns no link mixin at all.

**Why this is the one place a shared subscription survives.** Recipe 10's decision order rules out both cheaper options here:

- The item can't `await navigate()`, because the runtime performs the navigation from the anchor itself; nothing in the component's own code starts it.
- Frame `reloadStart`/`reloadComplete` can't drive it either, and this is the crux: when one item becomes active, the item **losing** active state must also re-render — and that component never received the click. It sits in the `sidebar` frame, which isn't the frame reloading (the click targets `detail`), so no frame event it can observe ever fires. `remix/component` has no broadcast for "sibling components, your active state may have changed".

So the app owns a minimal primitive. `app/utils/pending-navigation.ts` is roughly 55 lines replacing a 111-line navigation state machine, and it exposes exactly three things:

```ts
export let isServer = typeof window === "undefined";

/** Destination of the in-flight navigation, or `null` when idle. */
export function pendingDestination(): URL | null {
    return destination;
}

/** Subscribes to destination changes for the lifetime of `signal`. */
export function onDestinationChange(listener: () => void, options: { signal: AbortSignal }): void {
    // No navigation events fire on the server, so never register there.
    if (isServer) return;

    listeners.add(listener);
    options.signal.addEventListener("abort", () => listeners.delete(listener));
}
```

It tracks the Navigation API directly, and deliberately waits for the whole transition rather than the URL commit:

```ts
if (!isServer) {
    navigation.addEventListener("navigate", event => {
        setDestination(new URL(event.destination.url));
    });

    // The runtime's listener commits the URL before frame content arrives, so
    // wait for the whole transition to keep pending state visible until the
    // frame has actually swapped.
    navigation.addEventListener("currententrychange", () => {
        let transition = navigation.transition;

        if (!transition) {
            setDestination(null);
            return;
        }

        // An aborted transition rejects; the navigation replacing it fires its
        // own currententrychange.
        transition.finished.then(
            () => setDestination(null),
            () => {},
        );
    });
}
```

This is a deliberate, justified, narrow addition — not a framework gap being papered over. Before adding anything like it, confirm your case really is "a component must re-render because of a navigation it never participated in". Anything else belongs in Recipe 10's first two tiers.

**Why derive from the URL instead of props:** frame-targeted navigations don't re-render components outside the targeted frame, so a server-provided `selected` prop goes stale as soon as the user clicks. Reading `location.href` gives the true current state.

**The `selected` prop is the server fallback** for the initial render and for no-JS environments; on the client the URL-derived match takes precedence via `currentMatch?.params?.id ?? selected`. The `isServer` guards are what let the same component render in both places.

---

### 22. How do I update head metadata during frame navigations?

**Decision:** How do I change `<title>` and `<meta name="description">` when frame content changes without a full page load?

**Heuristic:** Render metadata literally, in the document's real `<head>`, and pass it down as props. For a _partial_ frame swap — where there is no document `<head>` in the response — carry the metadata on response **headers** and apply it in the browser's `resolveFrame`. There is no metadata collection layer, and nothing hoists head elements out of arbitrary component subtrees.

**Half 1 — the document owns the baseline.** `app/ui/document.tsx` takes the page's metadata as props:

```tsx
export namespace Document {
    export interface Props {
        description?: string;
        title?: string;
    }
}
```

and renders it inside its own `<head>`, falling back to the site title:

```tsx
<head>
    <meta charSet="utf-8" />
    <meta content="width=device-width, initial-scale=1" name="viewport" />

    <title>{handle.props.title ?? SITE.title}</title>
    {handle.props.description ? (
        <meta content={handle.props.description} name="description" />
    ) : null}

    {/* icons, stylesheets, and client-entry assets follow */}
</head>
```

Controllers supply the values. `app/actions/contacts/controller.tsx` builds a `DetailPage` (`PageMetadata & { node: RemixNode }`) per action and hands the same object to whichever response shape the request asked for:

```tsx
let page = detail(contact);

if (target === "detail") {
    return ctx.render(page.node, { headers: pageMetadataHeaders(page) });
}

return ctx.render(<Document description={page.description} title={page.title} />);
```

```tsx
async show(ctx) {
    let { q } = s.parse(QuerySchema, ctx.url.searchParams);

    return await contactPage(ctx, contact => ({
        description: contact.notes || (contact.bsky ? `@${contact.bsky}` : undefined),
        node: <ShowContact contact={contact} query={q} />,
        title: `${contactName(contact)} · ${SITE.title}`,
    }));
},
```

**Half 2 — partial frame swaps carry metadata on headers.** `app/utils/page-metadata.ts` is the whole mechanism:

```ts
export type PageMetadata = {
    description?: string;
    title: string;
};

const TITLE_HEADER = "x-page-title";
const DESCRIPTION_HEADER = "x-page-description";

/**
 * Response headers carrying page metadata. Values are percent-encoded because
 * header values are ASCII-only and contact names are not.
 */
export function pageMetadataHeaders(metadata: PageMetadata): Record<string, string> {
    let headers: Record<string, string> = {
        [TITLE_HEADER]: encodeURIComponent(metadata.title),
    };

    if (metadata.description) {
        headers[DESCRIPTION_HEADER] = encodeURIComponent(metadata.description);
    }

    return headers;
}

/** Applies a frame response's page metadata to the live document. */
export function applyPageMetadata(headers: Headers): void {
    let title = headers.get(TITLE_HEADER);
    if (title === null) return;

    document.title = decodeURIComponent(title);

    let description = headers.get(DESCRIPTION_HEADER);
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');

    if (description === null) {
        meta?.remove();
        return;
    }

    if (!meta) {
        meta = document.createElement("meta");
        meta.name = "description";
        document.head.appendChild(meta);
    }

    meta.content = decodeURIComponent(description);
}
```

The browser side is one call inside `resolveFrame` in `app/entry.browser.tsx`, so _every_ frame response gets the treatment without any component opting in:

```tsx
async resolveFrame(src, options) {
    let headers = new Headers({ accept: "text/html", "x-remix-frame": "true" });
    if (options?.target) headers.set("x-remix-target", options.target);

    let response = await fetch(src, {
        body: options?.formData,
        headers,
        method: options?.method ?? "GET",
        signal: options?.signal,
    });

    // Rejecting here is what surfaces the failure on the app's `error`
    // event, which the banner below renders.
    if (!response.ok) {
        let body = (await response.text()).trim();
        throw new Error(body || `${response.status} ${response.statusText}`);
    }

    applyPageMetadata(response.headers);

    // Return the Response, not its body: the runtime only learns a
    // submission was redirected from `response.redirected`/`response.url`,
    // and uses it to re-sync the address bar with the swapped content.
    return response;
}
```

**Why the split — the exact runtime boundary.** The two paths handle `<head>` differently:

- **Full-document navigation:** the runtime parses the response with `DOMParser`, then DOM-diffs the live `document.head` against the response's `head` (and likewise `body`). So the `<title>` and `<meta>` that `Document` renders reconcile natively — an existing title is updated, a description that disappears is removed. Nothing app-level is involved.
- **Partial / named-frame swap:** frame HTML is parsed as a _fragment_ (`template.innerHTML` on a `<template>`), and the only head handling on that path removes `<head>` elements that have **no child nodes**. A populated nested `<head>` is never hoisted into the document — it is either discarded by fragment parsing or reconciled into the frame's own region, where it does nothing. A `detail`-frame response therefore _cannot_ express its title in markup, which is why it expresses it on the response instead.

**Why percent-encoding:** header values are ASCII byte strings, and contact names are not — `"Ada Lovelace · Remix 3 Contacts"` alone contains a non-ASCII separator. `encodeURIComponent` on the server and `decodeURIComponent` in the browser make arbitrary titles transportable without restricting what a contact may be called.

**Absent header means "leave it alone":** `applyPageMetadata` returns immediately when there is no title header, so JSON responses and frames that don't describe a page never clobber the document's metadata. A present title with an absent description removes a stale description — the same net effect the document diff would have had.

**What's pinned by tests:** `app/utils/page-metadata.test.browser.ts` covers the contract end to end by round-tripping through both functions — the non-ASCII title survives the ASCII-only header, a second page upserts the description instead of duplicating it, a page without a description drops the previous one, and an empty `Headers` leaves the document untouched.

**Scope, stated plainly:** this mechanism handles `<title>` and `<meta name="description">`. It does not handle per-frame `<link>` tags, Open Graph sets, precedence between several frames contributing metadata, or removal keyed to a frame unmounting. None of that is implemented, and there is no collection layer to extend — a page that needs richer head content should be served as a full document, whose `<head>` the runtime reconciles for free.

---

### 23. How do asset imports work in the document shell?

**Decision:** How do I wire up scripts, stylesheets, and preload links in my HTML document?

**Heuristic:** Use Vite's asset import specifiers to resolve paths at build time. Never hardcode asset paths in components.

**The three import types:**

```tsx
// Client entry module — resolves hydration script + its dependencies
import clientAssets from "#/entry.browser.tsx?assets=client";

// SSR assets — resolves server-rendered module dependencies (CSS, JS preloads)
import serverAssets from "#/entry.server.tsx?assets=ssr";

// Standalone stylesheet — resolves to a URL string
import styles from "#/index.css?url";
```

**Merging assets in the document shell:**

```tsx
import { mergeAssets } from "@pitlane/dev/runtime";

import clientAssets from "#/entry.browser.tsx?assets=client";
import serverAssets from "#/entry.server.tsx?assets=ssr";
import styles from "#/index.css?url";

export function Document() {
    let { css, js } = mergeAssets(clientAssets, serverAssets);

    return () => (
        <html lang="en">
            <head>
                {/* Standalone CSS file — use ?url import */}
                <link href={styles} rel="stylesheet" />

                {/* Asset-resolved CSS from component modules */}
                {css.map(attrs => (
                    <link key={attrs.href} {...attrs} rel="stylesheet" />
                ))}

                {/* Client entry script */}
                <script async src={clientAssets.entry} type="module" />

                {/* Preload links for JS dependencies */}
                {js.map(attrs => (
                    <link key={attrs.href} {...attrs} rel="modulepreload" />
                ))}
            </head>
            <body>{/* ... */}</body>
        </html>
    );
}
```

**Key rules:**

- Use `?assets=client` for the client entry module (the one passed to `run()`)
- Use `?assets=ssr` for server-rendered modules that contribute CSS or JS to the document. Only use this for module assets (`.tsx`, `.ts`), not plain `.css` files
- Use `?url` for standalone stylesheets — this gives you a plain URL string for a `<link>` tag
- Render `clientAssets.entry` as the `<script>` src — never hardcode `/remix/assets/...` paths
- Pitlane transforms `import.meta.url` in strict, top-level `export const Name = clientEntry(import.meta.url, …)` calls into the correct `?assets=client` imports automatically, so component files remain source-oriented

---

### 24. How should I style components?

**Decision:** Should I use CSS files, the `css()` mixin, or inline `style`?

**Heuristic:** Prefer external `.css` files for app-wide styles. Use the `css()` mixin for component-scoped static rules when you don't want a separate stylesheet. Use `style` only for truly dynamic values, and prefer setting CSS custom properties over direct inline styles.

**External CSS (default choice):**

```tsx
import styles from "#/index.css?url";

// In your document shell:
<link href={styles} rel="stylesheet" />;
```

**The `css()` mixin for component-scoped rules:**

```tsx
import { css } from "remix/component";

<button
    mix={[
        css({
            color: "white",
            backgroundColor: "var(--color-primary)",
            "&:hover": { backgroundColor: "var(--color-primary-dark)" },
            "&:focus-visible": { outline: "2px solid var(--color-focus)" },
            "@media (max-width: 768px)": { width: "100%" },
        }),
    ]}
>
    Submit
</button>;
```

`css()` supports nested selectors (`&:hover`, `&::before`), media queries, and pseudo-elements — things you can't do with `style`. It generates real stylesheet rules, so it's more performant than inline styles for static values.

**Dynamic values with CSS custom properties:**

When a value changes based on state, set a CSS custom property via `style` and reference it from `css()` or your stylesheet:

```tsx
<div
    mix={[
        css({
            backgroundColor: "var(--bg)",
            transition: "background-color 200ms ease",
        }),
    ]}
    style={{ "--bg": isActive ? "var(--color-active)" : "var(--color-muted)" }}
>
    {children}
</div>
```

**Why custom properties over direct inline styles:** CSS custom properties keep your styling in one system. Stylesheets and `css()` rules can reference the same property, transitions work naturally, and you avoid specificity fights between inline styles and your CSS rules.

**When to use each:**

| Approach                       | Use for                                       | Example                                         |
| ------------------------------ | --------------------------------------------- | ----------------------------------------------- |
| `.css` files                   | App-wide layout, typography, resets           | Global stylesheet                               |
| `css()` mixin                  | Component-scoped static rules with selectors  | Hover states, media queries, pseudo-elements    |
| `style` with custom properties | Dynamic values that change with state         | Active/inactive colors, computed positions      |
| Direct `style`                 | Rare — only for truly one-off computed values | `style={{ transform: \`translateX(${x}px)\` }}` |

---

### 25. How do I access DOM nodes directly?

**Decision:** I need to focus an input, measure an element, or do other imperative DOM work.

**Heuristic:** Use the `ref()` mixin to get a callback with the DOM node. For work that depends on updated rendered state (focus after a state change, measurement after layout), use `handle.queueTask()` instead.

**Basic ref (fires on insert):**

```tsx
import { ref } from "remix/component";

<input mix={[ref(node => node.focus())]} />;
```

**Storing a ref for later use:**

```tsx
let textareaNode: HTMLTextAreaElement | undefined;

return () => (
    <textarea
        mix={[
            ref(node => {
                textareaNode = node;
            }),
            on("input", () => {
                if (textareaNode) {
                    textareaNode.style.height = "auto";
                    textareaNode.style.height = `${textareaNode.scrollHeight}px`;
                }
            }),
        ]}
    />
);
```

**When to use `ref()` vs `handle.queueTask()`:**

- `ref()` fires when the node is first inserted into the DOM — use it for one-time setup (autofocus, attaching third-party libraries, storing the node reference)
- `handle.queueTask()` runs after each render commit — use it when you need the DOM to reflect the latest state before doing measurement, focus, or scroll work (see Recipe 28)

---

### 26. How do I animate elements?

**Decision:** How do I add enter, exit, or layout animations to elements?

**Heuristic:** Use the animation mixins — `animateEntrance()`, `animateExit()`, and `animateLayout()`. They ship in the separate `@remix-run/ui` package, so add that dependency before importing from `@remix-run/ui/animation`. Always provide a stable `key` on elements that should transition.

**Enter animation:**

```tsx
import { animateEntrance } from "@remix-run/ui/animation";

<div
    mix={[
        animateEntrance({
            opacity: 0,
            transform: "translateY(8px)",
            duration: 180,
            easing: "ease-out",
        }),
    ]}
/>;
```

**Toggle visibility with enter + exit:**

```tsx
import { animateEntrance, animateExit } from "@remix-run/ui/animation";

{
    isVisible && (
        <div
            key="panel"
            mix={[
                animateEntrance({ opacity: 0, transform: "scale(0.98)", duration: 180 }),
                animateExit({
                    opacity: 0,
                    transform: "scale(0.98)",
                    duration: 120,
                    easing: "ease-in",
                }),
            ]}
        />
    );
}
```

**List reordering with layout animation:**

```tsx
import { animateLayout, spring } from "@remix-run/ui/animation";

{
    items.map(item => (
        <li key={item.id} mix={[animateLayout({ ...spring({ duration: 500, bounce: 0.2 }) })]}>
            {item.name}
        </li>
    ));
}
```

**Shared-layout swap (crossfade between two states):**

```tsx
<div mix={[css({ display: "grid", "& > *": { gridArea: "1 / 1" } })]}>
    {state ? (
        <div key="a" mix={[animateEntrance({ opacity: 0 }), animateExit({ opacity: 0 })]} />
    ) : (
        <div key="b" mix={[animateEntrance({ opacity: 0 }), animateExit({ opacity: 0 })]} />
    )}
</div>
```

**Practical guidance:**

- Always `key` conditional or list elements you expect to transition
- Use `animateLayout()` only on the element whose position or size changes
- For spring-style timing, spread `spring()` or `spring("snappy")` into the mixin config
- Default to `...spring()` for duration and easing in most cases — it produces natural motion
- Keep one clear intent per mixin: entrance starts from an initial style, exit ends at a final style

---

### 27. How do I handle keyboard and press interactions?

**Decision:** I need keyboard shortcuts, key-specific handlers, or unified pointer+keyboard press behavior.

**Heuristic:** Reach for a real interactive element first — `<button>`, `<a>`, `<input>` — and let the platform supply the keyboard and pointer semantics. Remix 3 ships no key or press helpers: `remix/component` exports `on()`, and key dispatch is branching you write yourself. Frame-targeted navigation needs no helper at all — it is a plain `data-rmx-target` attribute (see Recipe 15).

**Key-specific handling — branch inside one `keydown` listener:**

```tsx
import { on } from "remix/component";

<div
    tabindex="0"
    mix={[
        on("keydown", event => {
            if (event.key === "Escape") {
                closePanel();
                handle.update();
                return;
            }

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (event.key === "ArrowDown") focusNextItem();
                else focusPreviousItem();
            }
        }),
    ]}
/>;
```

Keep the listener on the element that owns focus, and `preventDefault()` only the keys you actually consume — arrow keys scroll the page otherwise.

**Press behavior — prefer a real `<button>`:**

```tsx
<button
    mix={[
        on("click", () => {
            toggleSelection();
            handle.update();
        }),
    ]}
    type="button"
>
    Select
</button>
```

A `<button>` already fires `click` for pointer taps, Enter, and Space, and it is focusable and announced as a control. When the host genuinely can't be a button, you own the whole contract: `role="button"`, `tabindex="0"`, an `on("click")` handler, and an `on("keydown")` that calls the same handler for `Enter` and `" "`. Long press has no built-in either — build it from `pointerdown`/`pointerup` and a timer, and only when the interaction is real.

For the composite controls that need this machinery — menus, listboxes, comboboxes, selects, tabs — install `@remix-run/ui` and import the headless primitive (`@remix-run/ui/menu`, `@remix-run/ui/listbox`, …) rather than re-deriving focus and key handling.

**Frame targeting needs no mixin.**

Set `data-rmx-target` directly on the `<a>` or `<form>` that navigates — both prop types declare the `data-rmx-*` attributes, and the runtime reads them off the source element when it intercepts:

```tsx
<a data-rmx-target="detail" href={routes.contacts.show.href({ id })}>
    View
</a>
```

Prefer real `<a>` tags and `<form><button type="submit">` pairs — they're accessible and work without JavaScript. `remix/component` also exports a `link()` mixin that makes any element behave like a navigation link, but it is a _link_ mixin: on a non-anchor host it sets `role="link"` and navigates from a `preventDefault`ed click. Reserve it for cases where an anchor isn't practical, and never put it on a submit button — it would cancel the submission.

---

### 28. How do I do post-render DOM work?

**Decision:** I need to focus an element, scroll to a position, or measure layout after a state change.

**Heuristic:** Use `handle.queueTask()` for work that depends on the DOM reflecting the latest render. Use `await handle.update()` when you need to chain state change → DOM work sequentially in an event handler.

**`handle.queueTask()` — runs after each render commit:**

```tsx
export let Accordion = clientEntry(import.meta.url, (handle: Handle) => {
    let open = false;
    let contentNode: HTMLElement | undefined;

    return () => (
        <div>
            <button
                mix={[
                    on("click", () => {
                        open = !open;
                        handle.update();
                    }),
                ]}
            >
                Toggle
            </button>
            {open && (
                <div
                    mix={[
                        ref(node => {
                            contentNode = node;
                        }),
                    ]}
                >
                    {handle.queueTask(() => {
                        contentNode?.querySelector("input")?.focus();
                    })}
                    <input placeholder="Now focused" />
                </div>
            )}
        </div>
    );
});
```

**`await handle.update()` — sequential state-then-DOM in event handlers:**

```tsx
on("submit", async event => {
    event.preventDefault();
    submitting = true;
    let signal = await handle.update();

    // DOM now reflects submitting=true, safe to read layout or focus
    let response = await fetch(url, { method: "POST", body: formData, signal });
    // ...
});
```

The `await` on `handle.update()` waits for the render commit and returns an `AbortSignal` that cancels if the component unmounts.

**When to use each:**

| Pattern                 | Use for                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `handle.queueTask(fn)`  | Post-render work triggered by state changes in render (focus, scroll, measurement) |
| `await handle.update()` | Sequential async flows where you need the DOM updated before continuing            |
| `ref(node => ...)`      | One-time setup when the node is first inserted (see Recipe 25)                     |

**Important:** When state changes what exists in the DOM (e.g., conditionally rendering an element), always do focus, scroll, and measurement work in `handle.queueTask()` or after `await handle.update()` — never inline in the render function, since the DOM hasn't committed yet.

---

### 29. When should I use persistent listeners vs session-based listeners?

**Decision:** Should this event listener live for the element's entire lifetime, or only during an active interaction?

**Heuristic:** Use `mix={[on(...)]}` for behavior that should always be active. Use imperative `addEventListener` with a scoped `AbortController` for listeners that should only exist during a short-lived interaction session (like a drag, a resize handle, or a long-press).

**Persistent listener (always active):**

```tsx
<div
    mix={[
        on("pointerdown", event => {
            startDragSession(event);
        }),
    ]}
/>
```

The `on()` mixin attaches when the element mounts and detaches when it unmounts. It survives re-renders.

**Session-based listeners (active only during interaction):**

```tsx
on("pointerdown", event => {
    let controller = new AbortController();
    let { signal } = controller;

    // These listeners only exist while dragging
    addEventListener(
        "pointermove",
        event => {
            updatePosition(event);
            handle.update();
        },
        { signal },
    );

    addEventListener(
        "pointerup",
        () => {
            finishDrag();
            controller.abort(); // Tear down all session listeners
            handle.update();
        },
        { signal },
    );

    addEventListener(
        "pointercancel",
        () => {
            cancelDrag();
            controller.abort();
            handle.update();
        },
        { signal },
    );
});
```

**Why this matters:** Persistent `pointermove` listeners on `window` that are only useful during a drag are wasteful and can cause subtle bugs if they fire between interactions. Scoping listeners to a session signal makes cleanup automatic and explicit.

**The rule of thumb:**

| Listener type                  | Pattern                                              | Example                                             |
| ------------------------------ | ---------------------------------------------------- | --------------------------------------------------- |
| Always needed while mounted    | `mix={[on(...)]}`                                    | Click handlers, submit handlers, keyboard shortcuts |
| Only needed during interaction | Imperative `addEventListener` with `AbortController` | Drag tracking, resize handles, pointer capture      |
| Global, for component lifetime | `addEventListener(..., { signal: handle.signal })`   | Window resize, navigation state changes             |

---

### 30. When and how do I create reusable mixins?

**Decision:** Should I extract this behavior into a `createMixin()`, or keep it local?

**Heuristic:** Reach for `createMixin()` only when the behavior is genuinely reusable host-element behavior that composes low-level DOM events into a semantic interaction. If the logic is local submit state, a one-off event handler, or a small async helper, keep it in the component.

**When to use `createMixin()`:**

- You're packaging reusable host behavior that composes low-level DOM events into one semantic interaction (e.g., drag-and-drop, hold-to-confirm, swipe gestures)
- The interaction keeps timing/pointer/gesture state that belongs to the host element
- You want to dispatch custom events or attach reusable behavior to different elements

**When NOT to use `createMixin()`:**

- The logic is only used once — prefer `on()` + setup-scope state
- The shared part is an async helper or request helper — share the helper, not a mixin
- It's form-local state (`submitting`, `error`) — keep it in the component
- You're doing it to feel "more Remix-like" — only extract when it pays for itself

**Basic mixin — pure prop transform:**

```tsx
import { createMixin } from "remix/component";

let withTitle = createMixin(() => (title: string, props: { title?: string }) => (
    <handle.element {...props} title={title} />
));
```

**Lifecycle-managed mixin — imperative setup on insert:**

```tsx
let withAutofocus = createMixin<HTMLElement>(handle => {
    handle.addEventListener("insert", event => {
        event.node.focus();
    });

    return props => <handle.element {...props} />;
});
```

**Core lifecycle semantics:**

1. A mixin handle is tied to one mounted host node lifecycle
2. `insert` fires when the host node is available for imperative setup
3. `remove` fires for teardown of that lifecycle
4. `handle.queueTask(fn)` runs post-commit and receives `(node, signal)` for mixins
5. Render functions should stay pure — side effects belong in `insert`, `remove`, or queued work

**Post-commit DOM work in a mixin:**

```tsx
handle.queueTask((node, signal) => {
    node.removeEventListener(prevType, stableHandler);
    node.addEventListener(nextType, stableHandler);
});
```

Only use `signal` when the work is async or cancellation-sensitive. Don't add `signal.aborted` checks for purely synchronous work.

---

### 31. How do I use SVG sprites?

**Decision:** How should I manage icons and SVG assets?

**Heuristic:** Use an SVG sprite sheet — a single SVG file containing all icons as `<symbol>` elements. Import the sprite URL from the source asset and reference individual icons by fragment ID. Never hardcode sprite paths.

**Setting up the sprite file** (`app/icons.svg`):

```xml
<svg xmlns="http://www.w3.org/2000/svg">
    <defs>
        <symbol id="icon-search" viewBox="0 0 24 24">
            <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                  stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
        </symbol>
        <symbol id="icon-plus" viewBox="0 0 24 24">
            <path d="M12 4.5v15m7.5-7.5h-15"
                  stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
        </symbol>
        <symbol id="icon-trash" viewBox="0 0 24 24">
            <path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
        </symbol>
    </defs>
</svg>
```

**Importing the sprite:**

```tsx
import iconsHref from "#/icons.svg?url";
```

**Using icons in components:**

```tsx
function Icon(props: { name: string; size?: number }) {
    let size = props.size ?? 20;
    return () => (
        <svg aria-hidden="true" width={size} height={size}>
            <use href={`${iconsHref}#icon-${props.name}`} />
        </svg>
    );
}

// Usage:
<Icon name="search" />
<Icon name="plus" size={16} />
<Icon name="trash" size={24} />
```

**Key rules:**

- Import the sprite with `?url` so Vite resolves the correct path in both dev and production builds
- Reference icons with `<use href={...}>` using the sprite URL + `#symbol-id`
- Use `aria-hidden="true"` on decorative icons. For meaningful icons, add an accessible label via `aria-label` on the `<svg>` or wrap it with visually hidden text
- Use `currentColor` for `stroke` and `fill` in the sprite so icons inherit their color from CSS
- Keep all icons in a single sprite file for a single network request — the browser caches it across pages

**Adding new icons:** Add a new `<symbol>` element to the sprite file with a unique `id` and `viewBox`. Reference it with the same `Icon` component pattern. No build step or code generation needed.

**Why sprites over inline SVGs:** Inline SVGs duplicate markup in every instance and increase HTML payload. A sprite is fetched once, cached, and each `<use>` reference is just a few bytes. This is especially important in server-rendered apps where you want to minimize HTML size.

---

### 32. How do I test components?

**Decision:** How do I test this app — the router, a controller, a component?

**Heuristic:** Vitest, with two projects. Server tests run **inside workerd** via `@cloudflare/vitest-plugin`, so `cloudflare:workers`, D1 and R2 are real. DOM tests run under jsdom. Which one a file lands in is decided by the `*.test.browser.*` suffix.

**Why not `remix test`.** It is a fine runner, but its server pool is plain `node:worker_threads`, and this app binds `cloudflare:workers` at module scope (`middleware.ts`, `utils/uploads.ts`). Importing the router there fails before a single test runs:

```
import('./app/utils/uploads.ts')  -> ERR_UNSUPPORTED_ESM_URL_SCHEME  (protocol 'cloudflare:')
```

The usual workaround is a `createAppRouter(options)` factory so tests can inject fakes. Running the tests in the actual runtime is better: no seam to maintain, and what you exercise is what deploys.

**Configuration** — `vitest.config.ts`:

```ts
let migrations = await readD1Migrations("./db/d1-migrations");

export default defineConfig({
    test: {
        projects: [
            {
                plugins: [
                    remix({ serverHandler: false }),
                    cloudflareTest({
                        miniflare: {
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
                plugins: [withoutHmr(remix({ serverHandler: false }))],
                test: {
                    environment: "jsdom",
                    include: ["app/**/*.test.browser.ts", "app/**/*.test.browser.tsx"],
                    name: "dom",
                },
            },
        ],
    },
});
```

Four details that are easy to get wrong:

- **The app's Vite plugins belong in both projects.** `@pitlane/dev`'s `remix()` provides `clientEntry()`, `?assets=ssr` and `pitlane:dev`. Without it the module graph will not even import.
- **Component HMR must be filtered out of the `dom` project.** It rewrites modules to talk to a dev-server registry no test runtime provides, and fails with `Cannot read properties of undefined (reading 'componentNamesByModuleUrl')`. It is a `vite dev` concern.
- **D1 needs its schema as data.** Workerd has no filesystem, so `readD1Migrations()` reads the generated SQL in Node at config time and a setup file applies it with `applyD1Migrations()`. `vp run test` depends on `db:migrations:generate` so the two cannot drift.
- **Set `NODE_ENV=test` as a binding.** `fakeNetwork()` sleeps 1–3s per uncached call unless it sees it, and workerd does not set it. Worth 9.1s → 1.6s on this suite.

**Integration test** — drive the deployed entry through `exports.default.fetch()`:

```ts
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

function fetchApp(path: string, init?: RequestInit) {
    return exports.default.fetch(`https://contacts.test${path}`, init);
}

beforeEach(async () => {
    await env.DB.prepare("delete from contacts").run();
});

describe("missing contacts", () => {
    it("answers 404 rather than redirecting", async () => {
        expect((await fetchApp("/contacts/99999")).status).toBe(404);
    });
});
```

This runs the whole stack — middleware, method override, router, controller, render middleware, D1. `SELF` from `cloudflare:test` does the same thing and is deprecated in favour of the above.

**Component test** — `render()` from `remix/component/test` works unchanged under jsdom:

```tsx
import { render } from "remix/component/test";
import { describe, expect, it, onTestFinished } from "vitest";

describe("FavoriteButton", () => {
    it("shows the current state but submits the desired one", () => {
        let result = render(<FavoriteButton contactId={1} favorite={true} />);
        onTestFinished(result.cleanup);

        expect(result.$("button")?.getAttribute("value")).toBe("false");
    });
});
```

**High-value testing patterns:**

- **Prefer the router boundary.** A `fetchApp()` assertion covers routing, middleware ordering, validation and rendering in one cheap test. Reach for a unit test when the logic is genuinely standalone — `imageExtension`, `frameTarget`, the schemas.
- **Pure modules stay pure.** `app/utils/image-types.ts` exists partly so the upload allowlist can be tested without dragging in an R2 binding. That split is worth preserving.
- **Prove the test fails first.** When a test pins a bug fix, flip the fix back and watch it fail. `favorite-button.test.browser.tsx` was checked against the pre-fix expression.

**What to avoid:**

- Testing implementation-only markers (data attributes, internal class names) unless they're the only stable assertion point
- Over-mocking framework behavior that can be exercised with a real request
- Repeating the same navigation assertion across many paths when one representative flow proves the behavior

**Known wart:** the worker project prints `[collectCss] Failed to transform 'cloudflare:workers'` on every run. It is Vite's Node-side CSS scan walking a graph with workerd-only imports; harmless, and not suppressible via `server.deps.external` or `css: false`.

---

### 33. How do I manage sessions and cookies?

**Decision:** How do I persist user data across requests (sessions, preferences, flash messages)?

**Heuristic:** Use the `session()` middleware to automatically load and save sessions per request. Never manipulate `document.cookie` directly — use Remix's cookie utilities. Always sign session cookies.

**Setting up session middleware:**

```tsx
import { createCookie } from "remix/cookie";
import { session } from "remix/middleware/session";
import { Session } from "remix/session";
import { createCookieSessionStorage } from "remix/session-storage/cookie";

// 1. Create a signed cookie (secrets are required)
let sessionCookie = createCookie("__session", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    secrets: [env.SESSION_SECRET],
});

// 2. Choose a storage strategy
let sessionStorage = createCookieSessionStorage();

// 3. Add the middleware to your router
let router = createRouter({
    middleware: [
        // ... other middleware
        session(sessionCookie, sessionStorage),
    ],
});
```

The middleware reads the session from the cookie on each request, makes it available as `context.get(Session)`, and automatically saves changes and sets the response cookie.

**Reading and writing session data in actions:**

```tsx
router.map(
    routes.user,
    createController(routes.user, {
        actions: {
            // POST
            preferences(ctx) {
                let session = ctx.get(Session);
                let { theme } = s.parse(ThemeSchema, ctx.formData);
                session.set("theme", theme);
                return redirect(routes.user.settings.href());
            },
            // GET
            settings(ctx) {
                let session = ctx.get(Session);
                let theme = session.get("theme") ?? "system";
                return frame(render(<Settings theme={theme} />));
            },
        },
    }),
);
```

**Flash messages (persist for one request only):**

```tsx
router.map(
    routes.contacts,
    createController(routes.contacts, {
        actions: {
            // In the action — set the flash
            async create(ctx) {
                let contact = await createContact(ctx.formData);
                let session = ctx.get(Session);
                session.flash("message", `Created ${contact.name}`);
                return redirect(routes.contacts.show.href({ id: contact.id }));
            },
            // In the next request — read and display it
            async show(ctx) {
                let session = ctx.get(Session);
                let flash = session.get("message"); // Available once, then gone
                let contact = await getContact(Number(ctx.params.id));
                return frame(render(<ContactDetail contact={contact} flash={flash} />));
            },
        },
    }),
);
```

Flash values are available on the next request after they're set, then automatically cleared. This is the standard pattern for success/error notifications after form submissions.

**Storage strategies:**

| Strategy           | Import                         | Best for                                             |
| ------------------ | ------------------------------ | ---------------------------------------------------- |
| Cookie storage     | `remix/session-storage/cookie` | Small session data (< 4KB), no server storage needed |
| Filesystem storage | `remix/session-storage/fs`     | Production servers with persistent disk              |
| Memory storage     | `remix/session-storage/memory` | Development and testing only                         |

**Cookie security:**

- Always provide `secrets` — session cookies must be signed to prevent tampering
- Use `httpOnly: true` to prevent client-side JavaScript access
- Use `secure: true` in production (HTTPS only)
- Use `sameSite: "lax"` to prevent CSRF on cross-site requests

**Secret rotation:** When rotating secrets, add the new secret to the beginning of the array. Existing cookies signed with old secrets can still be parsed, and new cookies will be signed with the new secret:

```tsx
let sessionCookie = createCookie("__session", {
    secrets: [env.NEW_SECRET, env.OLD_SECRET], // New first, old second
});
```

**Session security:** Regenerate the session ID after privilege changes (login, role change) to prevent session fixation attacks:

```tsx
session.regenerateId(); // New ID, keeps data
session.regenerateId(true); // New ID, deletes old session data
```

**Destroying sessions (logout):**

```tsx
session.destroy(); // Clears all data, clears client cookie on next response
```

---

### 34. How do I add authentication?

**Decision:** How do I implement login/logout with session-based auth, and optionally external OAuth providers?

**Heuristic:** Use `remix/auth` for the login flow (verifying credentials or handling OAuth callbacks) and `remix/middleware/auth` for protecting routes on subsequent requests. Auth forms should use standard `<form>` submissions for progressive enhancement — authentication must work without client-side JavaScript.

**The auth middleware stack:**

```tsx
import { auth, createSessionAuthScheme, requireAuth } from "remix/middleware/auth";
import { session } from "remix/middleware/session";
import { Session } from "remix/session";

let router = createRouter({
    middleware: [
        session(sessionCookie, sessionStorage),
        formData(),
        auth({
            schemes: [
                createSessionAuthScheme({
                    // Read the auth record from the session
                    read(session) {
                        return session.get("auth") as { userId: string } | null;
                    },
                    // Verify the record is still valid (look up user)
                    verify(value) {
                        return users.getById(value.userId);
                    },
                    // Clean up on invalidation
                    invalidate(session) {
                        session.unset("auth");
                    },
                }),
            ],
        }),
    ],
});
```

**Credentials login (email/password):**

```tsx
import { completeAuth, createCredentialsAuthProvider, verifyCredentials } from "remix/auth";
import { redirect } from "remix/response/redirect";

let passwordProvider = createCredentialsAuthProvider({
    parse(ctx) {
        let { email, password } = s.parse(AuthSchema, ctx.formData);
        return { email, password };
    },
    async verify({ email, password }) {
        return await users.verifyPassword(email, password);
    },
});

router.map(routes.auth.login.action, {
    async handler(ctx) {
        let user = await verifyCredentials(passwordProvider, ctx);

        if (user === null) {
            let session = ctx.get(Session);
            session.flash("error", "Invalid email or password");
            return redirect(routes.auth.login.href());
        }

        // Rotate session ID (prevents session fixation) and write auth record
        let session = completeAuth(ctx);
        session.set("auth", { userId: user.id });
        return redirect(routes.dashboard.href());
    },
});
```

**The login form (progressive enhancement):**

```tsx
export function LoginForm(handle: Handle<{ error?: string }>) {
    let props = handle.props;
    return () => (
        <form action={routes.auth.login.action.href()} method={routes.auth.login.action.method}>
            {props.error && <p class="error">{props.error}</p>}
            <label>
                Email
                <input name="email" type="email" required />
            </label>
            <label>
                Password
                <input name="password" type="password" required />
            </label>
            <button type="submit">Log in</button>
        </form>
    );
}
```

This form works with JavaScript disabled — it's a standard HTML POST. No `clientEntry` needed for the basic flow.

**Logout:**

```tsx
router.map(routes.auth.logout, {
    handler({ get }) {
        let session = get(Session);
        session.unset("auth");
        session.regenerateId(true); // Delete old session data
        return redirect(routes.auth.login.href());
    },
});
```

The logout form is also a plain `<form method="POST">` — no JavaScript required:

```tsx
<form action={routes.auth.logout.href()} method={routes.auth.logout.method}>
    <button type="submit">Log out</button>
</form>
```

**Protecting routes:**

```tsx
import type { GoodAuth } from "remix/middleware/auth";

import { Auth, requireAuth } from "remix/middleware/auth";

router.map(routes.dashboard, {
    middleware: [requireAuth()],
    handler(ctx) {
        let { identity } = ctx.get(Auth) as GoodAuth<User>;
        return ctx.render(<Dashboard user={identity} />);
    },
});
```

`requireAuth()` returns `401 Unauthorized` by default. Customize with `onFailure` to redirect to login or return a frame-aware response:

```tsx
let requireLogin = requireAuth({
    onFailure(ctx) {
        let isFrame = ctx.request.headers.get("x-remix-frame") === "true";
        if (isFrame) {
            return frame(render(<p>Please log in</p>), { status: 401 });
        }
        return redirect(routes.auth.login.href());
    },
});
```

**External auth (OAuth/OIDC — e.g., Google):**

```tsx
import {
    completeAuth,
    createGoogleAuthProvider,
    finishExternalAuth,
    startExternalAuth,
} from "remix/auth";

let googleProvider = createGoogleAuthProvider({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: new URL(routes.auth.google.callback.href(), process.env.APP_ORIGIN),
});

// Start the OAuth redirect
router.map(routes.auth.google.login, {
    handler: context =>
        startExternalAuth(googleProvider, context, {
            returnTo: context.url.searchParams.get("returnTo"),
        }),
});

// Handle the callback
router.map(routes.auth.google.callback, {
    async handler(context) {
        let { result, returnTo } = await finishExternalAuth(googleProvider, context);
        let user = await users.upsertFromGoogle(result.profile);
        let session = completeAuth(context);
        session.set("auth", { userId: user.id });
        return redirect(returnTo ?? routes.dashboard.href());
    },
});
```

**Built-in providers:** Google, Microsoft, Okta, Auth0 (OIDC); GitHub, Facebook, X (OAuth). Create providers at module scope for boot-time validation. For custom OIDC providers, use `createOIDCAuthProvider()`.

**The external auth flow:**

1. Create the provider once at module scope
2. Call `startExternalAuth()` from the login route — redirects to the provider
3. Call `finishExternalAuth()` from the callback route — validates the response
4. Call `completeAuth(context)` to rotate the session ID
5. Write your auth record and redirect

**Multiple auth schemes:** The `auth()` middleware tries each scheme in order. Use this for APIs that accept both session cookies and bearer tokens:

```tsx
import { createBearerTokenAuthScheme, createSessionAuthScheme } from "remix/middleware/auth";

auth({
    schemes: [
        createSessionAuthScheme({/* ... */}),
        createBearerTokenAuthScheme({
            async verify(token) {
                return apiKeys.validate(token);
            },
        }),
    ],
});
```

---

### 35. How do I handle file uploads?

**Decision:** How do I accept, validate, store, and serve user-uploaded files?

**Heuristic:** Use the `formData()` middleware with a custom `uploadHandler` to intercept file fields during form parsing. Store files in a durable backend (R2, filesystem) and return a URL string that replaces the file field in the parsed FormData. Serve uploaded files through a dedicated route. Keep the allow-list, the storage handle, and the handler in one module (`app/utils/uploads.ts`) so middleware, controller, and form all read the same source.

**The upload module** (`app/utils/uploads.ts`):

```tsx
import type { FileUpload } from "remix/form-data-parser";

import { env } from "cloudflare:workers";

import { R2FileStorage } from "#/data/adapters/r2-file-storage.ts";
import { routes } from "#/routes.ts";

const ALLOWED_TYPE: Record<string, true> = {
    "image/avif": true,
    "image/gif": true,
    "image/jpeg": true,
    "image/png": true,
    "image/svg+xml": true,
    "image/webp": true,
};

/** Value for a file input's `accept` attribute. */
export const ALLOWED_TYPES = Object.keys(ALLOWED_TYPE);

export let uploadStorage = new R2FileStorage(env.FILES);

/**
 * Thrown while the form body is still streaming, so it cannot be turned into a
 * response at the throw site. {@link uploadErrors} converts it to a 415.
 */
export class UnsupportedMediaTypeError extends Error {
    constructor(type: string) {
        super(`Unsupported image format: ${type}`);
        this.name = "UnsupportedMediaTypeError";
    }
}

/** Stores an upload in R2 and returns the URL used as the form field's value. */
export async function uploadHandler(file: FileUpload): Promise<string | undefined> {
    // Empty file inputs still produce a multipart part — skip them
    if (file.size === 0) {
        return undefined;
    }

    if (!ALLOWED_TYPE[file.type]) {
        throw new UnsupportedMediaTypeError(file.type);
    }

    let ext = file.name.split(".").pop() || "jpg";
    let key = `${file.fieldName}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

    await uploadStorage.set(key, file);
    return routes.uploads.href({ key });
}
```

**Key details:**

- The handler receives a `FileUpload` object (a `File` with metadata) for every file field in the form.
- Return a **string** to replace the file with a URL, or `undefined` to drop the field entirely. An empty file input still produces a multipart part, so `file.size === 0` must return `undefined` — otherwise the action would overwrite a saved avatar with `""` on every save that didn't pick a new photo.
- Build the returned URL via `routes.uploads.href({ key })` so it stays in sync with the route definition (see Recipe 6) — never hardcode `/uploads/${key}`.
- Generate unique keys from field name + timestamp + random suffix to prevent collisions.
- `ALLOWED_TYPE` is a `Record<string, true>` because the hot path is a single membership test — `!ALLOWED_TYPE[file.type]` is a property lookup, no `Set` to allocate or `Array.includes` to scan. `ALLOWED_TYPES` is derived from it with `Object.keys()`, so the `accept` attribute and the server check can never disagree.

**Why the handler throws instead of returning a `Response`.** The handler runs _inside_ `formData()`, while the multipart body is still being parsed. There is no `next()` to short-circuit and no response to return from where it stands: it is a callback in the middle of a stream, not a middleware. So it throws a typed error, `formData()` re-throws it, and `uploadErrors()` — installed first in the stack (Recipe 7) — catches it and produces the actual HTTP response:

```tsx
export function uploadErrors(): Middleware {
    return async (_ctx, next) => {
        try {
            return await next();
        } catch (error) {
            if (error instanceof UnsupportedMediaTypeError) {
                return new Response(
                    "Unsupported image format. Please upload a JPEG, PNG, GIF, or WebP file.",
                    { status: 415 },
                );
            }

            throw error;
        }
    };
}
```

Note what this is _not_: it does not catch thrown `Response` objects. Throwing a `Response` and expecting a middleware to unwrap it has no upstream precedent — `fetch-router` never catches thrown Responses. Throw a domain error; let a middleware that understands that error decide the status.

**Wiring the handler into middleware:**

```tsx
formData({ uploadHandler }),
```

Non-file fields are parsed normally; file fields are routed through your handler.

**Important timing consideration:** `formData()` sits _above_ `asyncContext()` in the stack, so the handler runs before request context exists. `getContext()` is not available inside it. Access platform bindings directly at module scope instead — which is what `uploadStorage` is:

```tsx
import { env } from "cloudflare:workers";
export let uploadStorage = new R2FileStorage(env.FILES);
```

Keeping this in `app/utils/uploads.ts` rather than the controller matters for a second reason: the file input's `accept` value comes from the same module. If `ALLOWED_TYPES` lived in the controller, a UI component would have to import from the controller layer, dragging a module-scope Cloudflare binding into the component graph with it.

**Serving uploaded files** — register a `GET /uploads/*key` action that streams from R2:

```tsx
async uploads(ctx) {
    let file = await uploadStorage.get(ctx.params.key);

    if (!file) {
        return new Response("File not found", { status: 404 });
    }

    return sendFile(file, ctx.request, {
        cacheControl: "public, max-age=31536000",
    });
},
```

Use `createFileResponse` from `remix/response/file` (imported here as `sendFile`) to serve files with proper headers — content type, range requests, caching. The `cacheControl` option sets a long cache lifetime, which is safe because upload keys are unique per write.

**The upload form** — `accept` comes straight from the module that enforces it:

```tsx
<label>
    <span>Avatar</span>
    <div id="contact-form-avatar">
        <img
            alt="Current avatar"
            src={
                props.contact.avatar ||
                "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png"
            }
        />
        <label class="avatar-upload">
            <input accept={ALLOWED_TYPES.join(",")} hidden name="avatar" type="file" />
            <span>Choose Photo</span>
        </label>
    </div>
</label>
```

**Key rules:**

- Set `enctype="multipart/form-data"` on the form — without it, the browser sends file fields as empty strings.
- `accept` filters the file picker; it is a client-side hint only. The server check in `uploadHandler` is the one that counts.
- Use a hidden file input with a styled label for a custom upload button appearance.
- In your controller, check whether a new file arrived. If not, preserve the existing value:

```tsx
let updates = s.parse(UpdateSchema, ctx.formData);

// Preserve existing avatar when no new file is uploaded
if (!updates.avatar) {
    updates.avatar = contact.avatar ?? "";
}
```

**Defining the upload route:** Use a wildcard route to match nested file keys:

```tsx
uploads: get("/uploads/*key"),
```

This matches paths like `/uploads/avatar/1712345678-abc123.jpg`, with the full path after `/uploads/` captured as `params.key`.

---

### 36. How should I set up import aliases?

**Decision:** How do I avoid deep relative imports like `../../../ui/cancel-button.tsx`?

**Heuristic:** Use `package.json#imports` (Node.js subpath imports) instead of `tsconfig.json#paths`. Subpath imports are a runtime standard — they work in Node.js, Vite, Cloudflare Workers, and every bundler without additional configuration or plugins. TypeScript paths, by contrast, are a compile-time-only feature that requires bundler-specific `tsconfigPaths` plugins and can silently diverge between what TypeScript resolves and what your runtime resolves.

**Setting up the alias in `package.json`:**

```json
{
    "imports": {
        "#/*": "./app/*"
    }
}
```

The `#` prefix is required by the Node.js subpath imports spec. This maps `#/ui/search-bar.tsx` to `./app/ui/search-bar.tsx`.

**Using aliases in source code:**

```tsx
import { getContacts } from "#/data/contacts.ts";
import { database, uploadErrors } from "#/middleware.ts";
import { routes } from "#/routes.ts";
import { SearchBar } from "#/ui/search-bar.tsx";
import { frameTarget } from "#/utils/frames.ts";
import { pendingDestination } from "#/utils/pending-navigation.ts";
import { uploadHandler } from "#/utils/uploads.ts";
```

Include the file extension. The lint config enforces it (`import/extensions` with `ignorePackages`), and it is what makes the same specifier resolve identically in Node, Vite, and Workers.

**When to use a relative import instead.** `#/` is for crossing a directory boundary. For a sibling in the same directory, a relative import is shorter and says something true — that these two files are a unit:

```tsx
// app/actions/controller.tsx
import { sidebar } from "./sidebar.tsx";

// app/ui/document.tsx
import { RestfulForm } from "./restful-form.tsx";
```

That's the whole rule: `./sibling.tsx` for same-directory, `#/…` for everything else. `../` never appears — if you're reaching for it, use the alias.

**What you don't need:**

- No `paths` in `tsconfig.json` — TypeScript reads `package.json#imports` natively when `moduleResolution` is set to `"bundler"` (or `"node16"` / `"nodenext"`)
- No `resolve.alias` in `vite.config.ts` — Vite resolves `#` imports from `package.json` automatically
- No `resolve: { tsconfigPaths: true }` — this was needed for the old `~/` convention but is unnecessary with subpath imports

**Why `#` over `~` or `@`:**

| Prefix | Source                       | Runtime support                    | Requires plugin       |
| ------ | ---------------------------- | ---------------------------------- | --------------------- |
| `#`    | Node.js subpath imports spec | Yes (Node, Vite, Workers, Bun)     | No                    |
| `~`    | Convention (tsconfig paths)  | No — compile-time only             | Yes (`tsconfigPaths`) |
| `@`    | Convention (tsconfig paths)  | Conflicts with npm scoped packages | Yes                   |

The `#` prefix is the only one that works everywhere without configuration beyond `package.json`. It's a real module resolution feature, not a build-tool convention.

**The full `tsconfig.json`** — notice no `paths` section:

```json
{
    "include": ["**/*.ts", "**/*.tsx"],
    "exclude": ["dist"],
    "compilerOptions": {
        "lib": ["DOM", "DOM.Iterable", "ESNext"],
        "target": "ESNext",
        "module": "ESNext",
        "types": ["@types/node", "vite-plus/client", "@pitlane/dev/assets"],
        "moduleResolution": "bundler",
        "jsx": "react-jsx",
        "jsxImportSource": "remix/component",
        "esModuleInterop": true,
        "resolveJsonModule": true,
        "allowImportingTsExtensions": true,

        "checkJs": true,
        "verbatimModuleSyntax": true,
        "skipLibCheck": true,
        "strict": true,
        "noEmit": true
    }
}
```

**Migration from `~` or `@` aliases:** Replace the prefix in all import statements and remove the `paths` entry from `tsconfig.json` and any `tsconfigPaths` plugin from `vite.config.ts`.

---

### 37. How do I deploy to Cloudflare Workers with D1 and R2?

**Decision:** How do I configure my Remix app to run on Cloudflare Workers with D1 (database) and R2 (file storage)?

**Heuristic:** Use `wrangler.jsonc` to declare your bindings, the `@cloudflare/vite-plugin` for dev/build integration, and platform-specific adapters for D1 and R2. Access bindings through `cloudflare:workers` at the top level and through request context in middleware.

**Wrangler configuration** (`wrangler.jsonc`):

```jsonc
{
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "my-app",
    "main": "./app/entry.server.tsx",
    "assets": { "directory": "dist/client" },
    "compatibility_date": "2026-04-02",
    "compatibility_flags": ["nodejs_compat"],
    "d1_databases": [
        {
            "binding": "DB",
            "database_name": "my-db",
            "database_id": "local",
            // Generated by `vp db:migrations:generate` from db/migrations/*.ts.
            // `migrations_dir` is resolved relative to this wrangler config file.
            "migrations_dir": "./db/d1-migrations",
        },
    ],
    "r2_buckets": [{ "binding": "FILES", "bucket_name": "my-files" }],
}
```

**Key fields:**

- `main` — Your server entry point. Cloudflare Workers loads this as the request handler.
- `assets.directory` — Points to the client build output. Workers serves these as static assets before hitting your server code.
- `compatibility_flags: ["nodejs_compat"]` — Enables Node.js API compatibility (required for `node:` imports like `node:path`, `node:timers/promises`).
- `d1_databases` — Declares D1 database bindings. Use `"database_id": "local"` for development; replace with the real ID for production. The `migrations_dir` points Wrangler at the generated SQL files (see Recipe 18).
- `r2_buckets` — Declares R2 object storage bindings.

**Generating types from bindings:**

Run `wrangler types` to generate a `worker-configuration.d.ts` file with the `Env` interface. This gives TypeScript knowledge of your bindings:

```tsx
// Auto-generated by `wrangler types`
interface Env {
    DB: D1Database;
    FILES: R2Bucket;
}
```

Wire this into your `vite.config.ts` as a run task so types are regenerated when `wrangler.jsonc` changes:

```tsx
run: {
    tasks: {
        typegen: {
            input: ["wrangler.jsonc"],
            command: "wrangler types",
        },
    },
},
```

**Accessing bindings:**

```tsx
// At module scope (for code that runs outside middleware, like upload handlers)
import { env } from "cloudflare:workers";
let db = env.DB;
let bucket = env.FILES;

// In middleware (preferred — inject into request context)
import { createD1Database } from "@pitlane/data-table-d1";
import { env } from "cloudflare:workers";
import { Database } from "remix/data-table";
import { type Middleware } from "remix/router";

type DatabaseEntry = { key: typeof Database; value: Database };

export function database(): Middleware<DatabaseEntry> {
    // Built once per isolate: the binding is stable, so there is nothing to
    // rebuild per request.
    let db = createD1Database(env.DB);

    return (ctx, next) => {
        ctx.set(Database, db);
        return next();
    };
}
```

**When to use `env` directly vs. context injection:**

| Approach                                           | When to use                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `import { env } from "cloudflare:workers"`         | Module-scope initialization, code that runs before middleware (e.g., upload handlers) |
| `ctx.get(Database)` / `getContext().get(Database)` | Controllers and data access functions — testable, swappable                           |

**Connecting `remix/data-table` to D1:**

Don't hand-write an adapter. `@pitlane/data-table-d1` supplies `createD1Database(binding, options?)`, which returns a `D1Database extends Database<"sqlite">` — every query, persistence, and migration method comes from `remix/data-table` unchanged:

```tsx
import { createD1Database } from "@pitlane/data-table-d1";
import { env } from "cloudflare:workers";

let db = createD1Database(env.DB);
let contacts = await db.findMany(Contacts);
```

Its Node-only migration half lives behind a separate `@pitlane/data-table-d1/migrations` entry point so nothing from it can reach a Worker bundle — see Recipe 18.

**D1 limitations to know:**

- **No transactions.** D1 has none, so `transaction()` refuses by default (`transactions: "throw"`). Passing `transactions: "unsafe-nonatomic"` accepts the call and gives up atomicity. Prefer `db.batch([...])`, which runs `sql` statements together atomically:

    ```tsx
    import { sql } from "remix/data-table";

    await db.batch([
        sql`insert into contacts (first, last) values (${first}, ${last})`,
        sql`update counters set contacts = contacts + 1`,
    ]);
    ```

- **Migrations run through Wrangler,** not `remix db`. Generate flat `.sql` files and apply them with `wrangler d1 migrations apply` (Recipe 18).
- **Per-statement cost is observable.** Pass `onStatement` to see the rows read, rows written, and duration D1 reported for each statement — the usual way to find an unindexed query before it shows up on a bill.

**Writing an R2 file storage adapter:**

Implement the `FileStorage` interface from `remix/file-storage` to wrap R2:

```tsx
import type { FileStorage } from "remix/file-storage";

export class R2FileStorage implements FileStorage {
    #r2: R2Bucket;

    constructor(r2: R2Bucket) {
        this.#r2 = r2;
    }

    async get(key: string): Promise<File | null> {
        let object = await this.#r2.get(key);
        if (!object) return null;
        let buffer = await object.arrayBuffer();
        return new File([buffer], object.key, {
            type: object.httpMetadata?.contentType,
        });
    }

    async set(key: string, file: File): Promise<void> {
        await this.#r2.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type },
            customMetadata: { name: file.name },
        });
    }

    async remove(key: string): Promise<void> {
        await this.#r2.delete(key);
    }

    async has(key: string): Promise<boolean> {
        return (await this.#r2.head(key)) != null;
    }
}
```

**The development workflow:**

1. `wrangler.jsonc` declares your D1 + R2 bindings and points `migrations_dir` at `./db/d1-migrations`
2. `wrangler types` generates the `Env` interface (wired into Vite+ via the `typegen` task — see Recipe 20)
3. The Cloudflare Vite plugin (`@cloudflare/vite-plugin`) injects local proxies for D1/R2 during `vp dev`
4. `vp run db:migrations:apply:local` (chained from `vp dev`) compiles and applies SQL migrations to the local D1
5. Local D1 state persists in `.wrangler/state/v3/d1/` — `vp run db:reset` wipes it
6. `vp run db:migrations:deploy` (or `db:migrations:apply:remote`) applies SQL migrations to the remote database — needs `CLOUDFLARE_API_TOKEN`
7. `vp run deploy` (i.e. `wrangler deploy`) pushes your built worker to Cloudflare

**Production setup:**

Before deploying, create the D1 database and R2 bucket on Cloudflare, then update `wrangler.jsonc` with the real `database_id`:

```sh
wrangler d1 create my-db
wrangler r2 bucket create my-files
```

Replace `"database_id": "local"` with the ID returned by `wrangler d1 create`. Then run `vp run db:migrations:deploy` once to seed the schema on the remote DB.
