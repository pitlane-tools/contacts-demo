# Replace Custom Frame Router with Built-in Frame Navigation APIs

## Summary

Replace the home-rolled frame router (`createFrames`, `NavigationEnhancer`, dedicated `/_frame/*` routes) with Remix's built-in frame navigation primitives: `navigate()`, `rmx-target` attributes on anchors, and the built-in navigation listener that `run()` installs.

The app moves from a two-frame architecture (sidebar + detail) with a custom route-to-frame-source mapping layer to a single-frame architecture (detail only) with an inline sidebar and a shell-or-fragment routing pattern.

## Architecture

### Before

- Two `<Frame>` elements: `sidebar` and `detail`
- Custom `createFrames()` router maps page URLs to `/_frame/*` source URLs
- `NavigationEnhancer` intercepts Navigation API events and reloads both frames
- Dedicated `/_frame/sidebar`, `/_frame/zero`, `/_frame/:id/show`, `/_frame/:id/edit` routes serve partial HTML

### After

- One `<Frame name="detail">` for the detail pane
- Sidebar rendered inline in `Document` (not a frame)
- Built-in navigation listener (installed by `run()`) intercepts link clicks with `rmx-target` attributes and navigations made via the Remix `navigate()` function
- Shell-or-fragment pattern: every route checks `x-remix-target: detail` header and returns either a full page or just the detail content
- No dedicated frame routes

### How SSR frame resolution avoids recursion

When the server renders `<Frame name="detail" src={url}>`, `renderToStream` calls `resolveFrame(src, target, ctx)` where `target` is the frame's `name` (i.e. `"detail"`). Our `resolveFrame` sets `x-remix-target: detail` on the internal sub-request. The route handler sees that header and returns just the detail fragment — no full document, no nested `<Frame>`, no recursion.

### Navigation patterns

| User action              | Navigation type                                           | What updates                        |
| ------------------------ | --------------------------------------------------------- | ----------------------------------- |
| Click contact in sidebar | `rmx-target="detail"` on `<a>`                            | Detail frame only                   |
| Search contacts          | `navigate(url)` (no target)                               | Top frame (sidebar + detail)        |
| Create new contact       | `fetch()` POST + `navigate(redirectUrl)`                  | Top frame                           |
| Save edited contact      | `fetch()` POST + `navigate(redirectUrl)`                  | Top frame                           |
| Delete contact           | `fetch()` POST + `navigate(redirectUrl)`                  | Top frame                           |
| Toggle favorite          | `fetch()` PATCH + `navigate(url, { history: "replace" })` | Top frame                           |
| Click Edit button        | `navigate(url, { target: "detail" })`                     | Detail frame only                   |
| Click Cancel button      | `navigation.back()` (browser API)                         | Traversal (intercepted by listener) |

All navigations are soft (client-side DOM diff). No hard browser refreshes.

### Form submission strategy

All mutation forms (`NewButton`, `DeleteConfirm`, `Favorite`, `EditButton`) are hydrated as client entries that call `event.preventDefault()`, perform the fetch manually, then trigger a soft navigation via Remix's `navigate()`. This is a deliberate shift from browser-native form submission to client-managed fetch + navigate, ensuring every mutation stays within the SPA navigation flow.

## Files to delete

- `src/lib/frame-router/core.ts` - Custom frame router implementation
- `src/lib/frame-router/types.ts` - Frame router types
- `src/frames.ts` - Frame router configuration
- `src/assets/Navigator.tsx` - Custom navigation interceptor component
- `src/routes/frames.tsx` - Dedicated frame partial routes
- `src/assets/CancelButton.tsx` - Consolidated into Buttons.tsx
- `src/assets/DeleteConfirm.tsx` - Consolidated into Buttons.tsx (renamed to `DeleteButton`)
- `src/components/Sidebar.tsx` - Inlined into Document.tsx

## Files to modify

### `src/routes.ts`

Remove the `frame` route group and the `route` import:

```tsx
import { createRoutes, resources } from "remix/fetch-router/routes";

export const routes = createRoutes({
    assets: "/assets/:file.js#:component",
    home: "/",
    contacts: {
        ...resources("/contacts", { exclude: ["index", "new"] }),
        favorite: { method: "PATCH", pattern: "/contacts/:id/favorite" },
    },
});
```

### `src/lib/render.tsx`

Add `documentWithSidebar()` and `isDetailFrameRequest()` helpers here (not in `router.tsx`) to avoid circular imports — `router.tsx` imports `contacts.tsx`, so `contacts.tsx` cannot import back from `router.tsx`.

```tsx
import type { RemixNode } from "remix/component";

import { matchSorter } from "match-sorter";
import { getContext } from "remix/async-context-middleware";
import { renderToStream } from "remix/component/server";
import { createHtmlResponse as html } from "remix/response/html";

import { Document } from "~/components/Document.tsx";
import { getContacts } from "~/lib/database/contacts.ts";
import { router } from "~/router.tsx";

export function isDetailFrameRequest(): boolean {
    return getContext().request.headers.get("x-remix-target") === "detail";
}

export async function documentWithSidebar(selected?: string | number) {
    const { url } = getContext();
    const query = url.searchParams.get("q");
    let contacts = await getContacts(query);
    if (query) {
        contacts = matchSorter(contacts, query, { keys: ["first", "last"] });
    }
    return render.document(
        <Document contacts={contacts} query={query} selected={String(selected ?? "")} />,
    );
}

export const render = {
    frame(node: RemixNode): Response {
        return new Response(renderToStream(node), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    },
    document(node: RemixNode): Response {
        const context = getContext();
        return html(
            renderToStream(node, {
                frameSrc: context.url,
                async resolveFrame(src, target, ctx) {
                    const url = new URL(src, ctx?.currentFrameSrc ?? context.url);
                    const headers = new Headers({ accept: "text/html" });
                    if (target) headers.set("x-remix-target", target);
                    const response = await router.fetch(new Request(url, { headers }));

                    if (!response.ok) {
                        throw new Error(`Failed to resolve frame ${url.pathname}`);
                    }

                    return response.body ?? (await response.text());
                },
            }),
        );
    },
};
```

The `x-remix-frame` header is set by the client-side `resolveFrame` to indicate a frame request from the browser. The server-side internal sub-requests don't need it — they use `x-remix-target` directly.

### `src/router.tsx`

Remove the frame controller mapping. The home route uses `isDetailFrameRequest` and `documentWithSidebar` from `render.tsx`:

```tsx
import { asyncContext } from "remix/async-context-middleware";
import { createRouter } from "remix/fetch-router";
import { formData } from "remix/form-data-middleware";
import { methodOverride } from "remix/method-override-middleware";
import { staticFiles } from "remix/static-middleware";

import { ZeroState } from "~/components/ZeroState.tsx";

import { loadDatabase } from "./lib/database/middleware.ts";
import { documentWithSidebar, isDetailFrameRequest, render } from "./lib/render.tsx";
import { routes } from "./routes.ts";
import contacts from "./routes/contacts.tsx";

export const router = createRouter({
    middleware: [
        staticFiles("./public"),
        formData(),
        methodOverride(),
        asyncContext(),
        await loadDatabase(),
    ],
});

router.map(routes.home, {
    actions: {
        async index() {
            if (isDetailFrameRequest()) {
                return render.frame(<ZeroState />);
            }
            return documentWithSidebar();
        },
    },
});
router.map(routes.contacts, contacts);
```

### `src/routes/contacts.tsx`

Each GET action checks `isDetailFrameRequest()` and returns either the detail fragment or the full document. POST actions do their mutation and redirect as before.

```tsx
import type { RemixNode } from "remix/component";
import type { Controller } from "remix/fetch-router";

import { redirect } from "remix/response/redirect";

import { EditContact } from "~/components/EditContact.tsx";
import { ShowContact } from "~/components/ShowContact.tsx";
import { ZeroState } from "~/components/ZeroState.tsx";
import {
    type Contact,
    createContact,
    deleteContact,
    getContact,
    updateContact,
} from "~/lib/database/contacts.ts";
import { documentWithSidebar, isDetailFrameRequest, render } from "~/lib/render.tsx";
import { routes } from "~/routes.ts";

// Shell-or-fragment helper for GET pages that show a single contact.
// Returns the detail fragment when `x-remix-target: detail` is set,
// or the full document otherwise.
async function contactPage(
    context: { params: { id?: string | number }; url: URL },
    detail: (contact: Contact) => RemixNode,
) {
    if (!context.params.id) {
        return redirect(routes.home.href());
    }

    if (isDetailFrameRequest()) {
        const contact = await getContact(Number(context.params.id));
        if (!contact) return render.frame(<ZeroState />);
        return render.frame(detail(contact));
    }

    return documentWithSidebar(context.params.id);
}

export default {
    actions: {
        show: context =>
            contactPage(context, contact => (
                <ShowContact contact={contact} query={context.url.searchParams.get("q")} />
            )),
        edit: context => contactPage(context, contact => <EditContact contact={contact} />),
        async create() {
            const id = await createContact();
            return redirect(routes.contacts.edit.href({ id }));
        },
        async destroy(context) {
            await deleteContact(Number(context.params.id));
            return redirect(routes.home.href());
        },
        async favorite(context) {
            const formData = context.get(FormData);
            const update = await updateContact(Number(context.params.id), {
                favorite: formData.get("favorite") === "true",
            });
            return Response.json(update);
        },
        async update(context) {
            const contact = await getContact(Number(context.params.id));

            if (!contact) {
                return redirect(routes.home.href());
            }

            const formData = context.get(FormData);
            const updates: Partial<Contact> = {
                first: formData.get("first") as string,
                last: formData.get("last") as string,
                avatar: formData.get("avatar") as string,
                bsky: formData.get("bsky") as string,
                notes: formData.get("notes") as string,
            };

            await updateContact(Number(context.params.id), updates);

            return redirect(routes.contacts.show.href({ id: context.params.id }));
        },
    },
} satisfies Controller<typeof routes.contacts>;
```

Note: `show` and `edit` use the shared `contactPage` helper with different detail callbacks, keeping the shell-or-fragment logic DRY.

### `src/components/Document.tsx`

Sidebar rendered inline. Single detail frame. Document receives props from route handlers.

The `selected` prop is `string` (empty string for no selection) rather than `string | null`. The `Sidebar` and `SidebarItem` prop types for `selected` should be updated to match.

The `Sidebar` component is inlined directly into `Document` since it's now just a simple list with no independent lifecycle.

```tsx
import { getContext } from "remix/async-context-middleware";
import { Frame } from "remix/component";

import type { Contact } from "~/lib/database/contacts.ts";

import { NewButton } from "~/assets/Buttons.tsx";
import { SearchBar } from "~/assets/SearchBar.tsx";
import { SidebarItem } from "~/assets/SidebarItem.tsx";

export function Document() {
    const { url } = getContext();

    return (props: { contacts: Contact[]; query: string | null; selected: string }) => (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta content="width=device-width, initial-scale=1" name="viewport" />
                <title>Remix 3 Contacts</title>
                <link href="/index.css" rel="stylesheet" />
                <link href="/favicon-32.png" rel="icon" sizes="32x32" />
                <link href="/favicon-128.png" rel="icon" sizes="128x128" />
                <link href="/favicon-180.png" rel="icon" sizes="180x180" />
                <link href="/favicon-192.png" rel="icon" sizes="192x192" />
                <link href="/favicon-180.png" rel="apple-touch-icon" sizes="180x180" />
                <script async src="/assets/entry.js" type="module" />
            </head>
            <body>
                <div id="root">
                    <div id="sidebar">
                        <h1>Remix 3 Contacts</h1>
                        <div>
                            <SearchBar query={props.query} />
                            <NewButton />
                        </div>
                        <nav>
                            {props.contacts.length ? (
                                <ul>
                                    {props.contacts.map(contact => (
                                        <SidebarItem
                                            contact={contact}
                                            query={props.query}
                                            selected={props.selected}
                                        />
                                    ))}
                                </ul>
                            ) : (
                                <p>
                                    <i>No contacts</i>
                                </p>
                            )}
                        </nav>
                    </div>
                    <Frame name="detail" src={url.toString()} />
                </div>
            </body>
        </html>
    );
}
```

### `src/assets/entry.tsx`

Update `resolveFrame` to send frame headers so the server knows which partial to return:

```tsx
import { run } from "remix/component";

run({
    async loadModule(moduleUrl, exportName) {
        const mod = await import(moduleUrl);
        const exported = mod[exportName];

        if (typeof exported !== "function") {
            throw new TypeError(
                `Expected export '${exportName}' from '${moduleUrl}' to be a function`,
            );
        }

        return exported;
    },
    async resolveFrame(src, signal, target) {
        const headers = new Headers({ accept: "text/html", "x-remix-frame": "true" });
        if (target) headers.set("x-remix-target", target);
        const response = await fetch(src, { headers, signal });
        return response.body ?? (await response.text());
    },
});
```

The `x-remix-frame` header signals to the server that this is a frame sub-request from the client (as opposed to a direct page load). The `x-remix-target` header identifies which named frame is being resolved.

### `src/lib/navigation.ts`

Delete `NavigationEnhancer`, `NavigateEvent`, `RouterEventMap`, and the `NavigateEvent` namespace. Keep:

- `Navigating` class and the global `Navigation` type augmentation (tracks pending navigation state for UI)
- `DestinationChangeEvent`
- `navigating` singleton
- `isServer` flag
- `NavigatingEventMap` type
- `NavigationStates` / `NavigationState` types

These are used by `SidebarItem` and `SearchBar` for active/pending state tracking. `Navigating` observes the Navigation API's events but does not intercept — it works alongside the built-in listener.

### `src/assets/SidebarItem.tsx`

Replace `frames.$.match()` with a lightweight `TrieMatcher` scoped to contact routes. Full updated component:

```tsx
import {
    addEventListeners,
    clientEntry,
    type Handle,
    type SerializableProps,
} from "remix/component";
import { TrieMatcher } from "remix/route-pattern";

import { navigating } from "~/lib/navigation.ts";
import { routes } from "~/routes.ts";

const matcher = new TrieMatcher<true>();
matcher.add(routes.contacts.show.pattern, true);
matcher.add(routes.contacts.edit.pattern, true);

export namespace SidebarItem {
    export interface Props extends SerializableProps {
        selected: string;
        query: string | null;

        contact: {
            id: number;
            first?: string;
            last?: string;
            favorite?: boolean;
        };
    }
}

export const SidebarItem = clientEntry(
    routes.assets.href({ file: "SidebarItem", component: "SidebarItem" }),
    function SidebarItem(handle: Handle) {
        addEventListeners(navigating, handle.signal, {
            destinationchange() {
                handle.update();
            },
        });

        return ({ selected, query, contact }: SidebarItem.Props) => {
            const destination = matcher.match(navigating.to.url);
            const isPending = Number(destination?.params.id) === contact.id;
            const isActive = Number(selected) === contact.id;

            return (
                <li>
                    <a
                        class={isActive ? "active" : isPending ? "pending" : undefined}
                        href={routes.contacts.show.href({ id: contact.id }, { q: query })}
                        rmx-target="detail"
                    >
                        {contact.first || contact.last ? (
                            <>
                                {contact.first} {contact.last}
                            </>
                        ) : (
                            <i>No Name</i>
                        )}
                        {contact.favorite ? <span>&#9733;</span> : null}
                    </a>
                </li>
            );
        };
    },
);
```

Key changes:

- `selected` prop type changed from `string | null` to `string` (empty string = no selection)
- `frames` import removed, replaced with `TrieMatcher` from `remix/route-pattern`
- `rmx-target="detail"` added to the `<a>` element

### `src/assets/SearchBar.tsx`

Switch from browser `navigation.navigate()` to Remix `navigate()`. The Remix `navigate()` function ensures the built-in listener intercepts the navigation (it sets Remix state). Without a target, this triggers a top-frame update.

Note: Remix's `navigate()` options use `"push" | "replace"` (no `"auto"`), so the existing `"auto"` changes to `"push"`.

```tsx
import { addEventListeners, clientEntry, type Handle, navigate, on } from "remix/component";

import { navigating } from "~/lib/navigation.ts";
import { routes } from "~/routes.ts";

export const SearchBar = clientEntry(
    routes.assets.href({ file: "SearchBar", component: "SearchBar" }),
    function SearchBar(handle: Handle) {
        addEventListeners(navigating, handle.signal, {
            destinationchange() {
                handle.update();
            },
        });

        return (props: { query: string | null }) => {
            const searching = Boolean(navigating.to.url?.searchParams.has("q"));
            return (
                <form id="search-form" method="GET">
                    <input
                        aria-label="Search contacts"
                        class={searching ? "loading" : ""}
                        defaultValue={props.query ?? undefined}
                        id="q"
                        mix={on("input", async event => {
                            const url = new URL(location.href);

                            if (!event.currentTarget.value.trim()) {
                                url.searchParams.delete("q");
                                navigate(url.toString());
                                return;
                            }

                            const isFirstSearch = url.searchParams.get("q") === null;

                            url.searchParams.set("q", event.currentTarget.value);
                            navigate(url.toString(), {
                                history: isFirstSearch ? "replace" : "push",
                            });
                        })}
                        name="q"
                        placeholder="Search"
                        type="search"
                    />
                    <div aria-hidden hidden={!searching} id="search-spinner" />
                    <div aria-live="polite" class="sr-only" />
                </form>
            );
        };
    },
);
```

### `src/components/ShowContact.tsx`

Update imports: `EditButton` and `DeleteButton` from `~/assets/Buttons.tsx`, `Favorite` from `~/assets/Favorite.tsx`. Replace the Edit `<form>` with `<EditButton contactId={contact.id} query={query} />` and `<DeleteConfirm>` with `<DeleteButton>`.

### `src/components/EditContact.tsx`

Update `CancelButton` import to `~/assets/Buttons.tsx`.

## New file

### `src/assets/Buttons.tsx`

Contains `NewButton`, `EditButton`, `CancelButton`, and `DeleteButton`. Each export has its own `clientEntry` with a distinct `#ExportName` in the asset URL so esbuild bundles them together but hydration targets them individually.

`Favorite` stays in its own file (`src/assets/Favorite.tsx`) since it has more complex state management (optimistic updates, abort signals).

```tsx
import { clientEntry, navigate, on } from "remix/component";

import { routes } from "~/routes.ts";

export const NewButton = clientEntry(
    routes.assets.href({ file: "Buttons", component: "NewButton" }),
    function NewButton() {
        return () => (
            <form
                action={routes.contacts.create.href()}
                method="POST"
                mix={on("submit", async event => {
                    event.preventDefault();
                    const response = await fetch(event.currentTarget.action, {
                        method: "POST",
                    });
                    navigate(response.url);
                })}
            >
                <button type="submit">New</button>
            </form>
        );
    },
);

export const EditButton = clientEntry(
    routes.assets.href({ file: "Buttons", component: "EditButton" }),
    function EditButton() {
        return (props: { contactId: number; query: string | null }) => (
            <form
                action={routes.contacts.edit.href({ id: props.contactId }, { q: props.query })}
                method="GET"
                mix={on("submit", event => {
                    event.preventDefault();
                    navigate(event.currentTarget.action, { target: "detail" });
                })}
            >
                <button type="submit">Edit</button>
            </form>
        );
    },
);

export const CancelButton = clientEntry(
    routes.assets.href({ file: "Buttons", component: "CancelButton" }),
    function CancelButton() {
        return () => (
            <button
                mix={on("click", () => {
                    navigation.back();
                })}
                type="button"
            >
                Cancel
            </button>
        );
    },
);

export const DeleteButton = clientEntry(
    routes.assets.href({ file: "Buttons", component: "DeleteButton" }),
    function DeleteButton() {
        return (props: { contactId: number }) => (
            <form
                action={routes.contacts.destroy.href({ id: props.contactId })}
                method="POST"
                mix={on("submit", async event => {
                    event.preventDefault();
                    if (!confirm("Please confirm you want to delete this record.")) return;
                    const response = await fetch(event.currentTarget.action, {
                        method: "POST",
                        body: new FormData(event.currentTarget, event.submitter),
                    });
                    navigate(response.url);
                })}
            >
                <input name="_method" type="hidden" value={routes.contacts.destroy.method} />
                <button type="submit">Delete</button>
            </form>
        );
    },
);
```

### `src/assets/Favorite.tsx`

Stays in its own file. Replace `navigation.reload()` with Remix `navigate()`:

```tsx
import { clientEntry, type Handle, navigate, on } from "remix/component";

import { routes } from "~/routes.ts";

export const Favorite = clientEntry(
    routes.assets.href({ file: "Favorite", component: "Favorite" }),
    function Favorite(handle: Handle) {
        const route = routes.contacts.favorite;
        let submitting = false;
        let favorite!: boolean;

        return (props: { contactId: number; favorite: boolean }) => {
            if (!submitting) {
                favorite = props.favorite;
            }

            return (
                <form
                    action={route.href({ id: props.contactId })}
                    method="POST"
                    mix={on("submit", async event => {
                        event.preventDefault();
                        favorite = !favorite;
                        submitting = true;
                        const signal = await handle.update();

                        try {
                            const response = await fetch(event.currentTarget.action, {
                                method: event.currentTarget.method,
                                body: new FormData(event.currentTarget, event.submitter),
                                signal,
                            });
                            if (!response.ok && !response.redirected) throw response;
                            submitting = false;
                            navigate(window.location.href, { history: "replace" });
                        } catch {
                            favorite = !favorite;
                            submitting = false;
                            handle.update();
                        }
                    })}
                >
                    <input name="_method" type="hidden" value={route.method} />
                    <input name="id" type="hidden" value={props.contactId} />
                    <button
                        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
                        name="favorite"
                        type="submit"
                        value={favorite ? "true" : "false"}
                    >
                        {favorite ? "\u2605" : "\u2606"}
                    </button>
                </form>
            );
        };
    },
);
```

## Verification

After implementation, verify:

1. `pnpm run typecheck` passes
2. `pnpm run lint` and `pnpm run fmt` pass
3. Clicking a sidebar contact updates only the detail pane (no sidebar flicker)
4. Search updates both sidebar and detail
5. Create, edit (save), delete, and favorite all work without hard refresh
6. Back/forward browser navigation works
7. Active/pending CSS classes on sidebar items still work
8. Edit button navigates to the edit form within the detail frame
9. Cancel button navigates back
