import { asyncContext } from "remix/middleware/async-context";
import { formData } from "remix/middleware/form-data";
import { methodOverride } from "remix/middleware/method-override";
import { render } from "remix/middleware/render";
import { createRouter, type MiddlewareContext } from "remix/router";

import contacts from "#/actions/contacts/controller.tsx";
import controller from "#/actions/controller.tsx";
import { assets } from "#/assets.ts";
import { database, uploadErrors } from "#/middleware.ts";
import { routes } from "#/routes.ts";
import { UPLOAD_LIMITS, uploadHandler } from "#/utils/uploads.ts";

// Static assets are served by Cloudflare's `assets` binding (wrangler.jsonc),
// which runs ahead of the Worker — `staticFiles()` is Node-fs-based and has no
// filesystem to read from here.
let middleware = [
    uploadErrors(),
    formData({ ...UPLOAD_LIMITS, uploadHandler }),
    methodOverride(),
    asyncContext(),
    database(),
    render({
        assets,
        onError(error) {
            // Streaming render failures. The middleware suppresses this for its
            // own internal frame sub-requests, so it reports once per request.
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

/**
 * Workers entry. `router.fetch()` rejects when an action or middleware throws,
 * so the boundary lives here: without it an uncaught error becomes workerd's
 * generic error page, which the browser's `resolveFrame` would then render
 * verbatim into the app's own error banner.
 */
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

if (import.meta.hot) {
    import.meta.hot.accept();
}
