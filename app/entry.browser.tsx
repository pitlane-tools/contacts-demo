import type { Handle } from "remix/component";

import { revalidate } from "@pitlane/vite-plugin-remix/hmr";
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

        // Same policy as the runtime's default resolver: 2xx, and 4xx that
        // carry HTML, are content — a 404 contact renders its own page in the
        // frame. Everything else is a failure, and rejecting here is what
        // surfaces it on the app's `error` event for the banner below.
        let isHtml = response.headers.get("content-type")?.startsWith("text/html") ?? false;
        if (!response.ok && !(isHtml && response.status < 500)) {
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

// Server-only edits in `vite dev` revalidate the page in place.
if (import.meta.hot) {
    import.meta.hot.on("server:update", () => revalidate(app));
}

// Global error boundary — renders a dismissible banner for any error dispatched
// on the app runtime, including failed frame navigations and submissions.
let bannerHost = document.createElement("div");
document.body.insertBefore(bannerHost, document.body.firstChild);
let bannerRoot = createRoot(bannerHost);

function ErrorBanner(handle: Handle<{ message: string }>) {
    return () => (
        <div id="app-error-banner" role="alert">
            <p>{handle.props.message}</p>
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
