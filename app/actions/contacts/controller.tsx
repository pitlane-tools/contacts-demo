import type { PageMetadata } from "#/utils/page-metadata.ts";
import type { RemixNode } from "remix/component";
import type { RenderFunction } from "remix/middleware/render";

import { EditContact } from "#/actions/contacts/form.tsx";
import { ContactNotFound } from "#/actions/contacts/not-found-page.tsx";
import { ShowContact } from "#/actions/contacts/show-page.tsx";
import { sidebar } from "#/actions/sidebar.tsx";
import {
    type Contact,
    contactName,
    createContact,
    deleteContact,
    getContact,
    updateContact,
} from "#/data/contacts.ts";
import { SITE } from "#/data/meta.ts";
import { FavoriteSchema, IdSchema, searchQuery, UpdateSchema } from "#/data/schemas.ts";
import { routes } from "#/routes.ts";
import { Document } from "#/ui/document.tsx";
import { frameTarget } from "#/utils/frames.ts";
import { pageMetadataHeaders } from "#/utils/page-metadata.ts";
import * as s from "remix/data-schema";
import { redirect } from "remix/response/redirect";
import { createController } from "remix/router";

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
 * The parsed `:id`, or a 400 when the path segment is not a contact id.
 *
 * `/contacts/:id` matches any segment, so a malformed id is ordinary invalid
 * input from the client — an expected outcome that gets a response, not a
 * thrown error.
 */
function contactId(params: ContactContext["params"]): number | Response {
    let result = s.parseSafe(IdSchema, params);
    if (!result.success) return new Response("Invalid contact id", { status: 400 });
    return result.value.id;
}

/**
 * A 404 in whichever shape the request asked for: the detail fragment for a
 * frame request, otherwise a whole document whose detail frame renders it.
 */
function contactNotFound(ctx: ContactContext): Response {
    let page = { node: <ContactNotFound />, title: `Not found · ${SITE.title}` };

    if (frameTarget(ctx.headers) === "detail") {
        return ctx.render(page.node, { headers: pageMetadataHeaders(page), status: 404 });
    }

    return ctx.render(<Document title={page.title} />, { status: 404 });
}

/**
 * Serves whichever of the three shapes the request asked for: the `sidebar`
 * frame, the `detail` frame, or the whole document.
 */
async function contactPage(
    ctx: ContactContext,
    detail: (contact: Contact) => DetailPage,
): Promise<Response> {
    let id = contactId(ctx.params);
    if (id instanceof Response) return id;

    let target = frameTarget(ctx.headers);

    if (target === "sidebar") {
        return sidebar(ctx, id);
    }

    let contact = await getContact(id);
    if (!contact) {
        return contactNotFound(ctx);
    }

    let page = detail(contact);

    if (target === "detail") {
        return ctx.render(page.node, { headers: pageMetadataHeaders(page) });
    }

    return ctx.render(<Document description={page.description} title={page.title} />);
}

export default createController(routes.contacts, {
    actions: {
        async show(ctx) {
            let q = searchQuery(ctx.url);

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
        async create() {
            let id = await createContact();
            return redirect(routes.contacts.edit.href({ id }));
        },
        async destroy(ctx) {
            let id = contactId(ctx.params);
            if (id instanceof Response) return id;

            await deleteContact(id);
            return redirect(routes.home.href());
        },
        async favorite(ctx) {
            let id = contactId(ctx.params);
            if (id instanceof Response) return id;

            let parsed = s.parseSafe(FavoriteSchema, ctx.formData);
            if (!parsed.success) {
                return new Response("Invalid favorite value", { status: 400 });
            }

            let contact = await getContact(id);
            // Both callers read only the status here, so a page would be waste.
            if (!contact) {
                return new Response("Contact not found", { status: 404 });
            }

            await updateContact(id, { favorite: parsed.value.favorite });

            // The enhanced submission reloads the frames itself, so it only
            // needs to know the write landed. Sending no body keeps `fetch`
            // from following a redirect and downloading the page to discard it.
            if (frameTarget(ctx.headers) === "detail") {
                return new Response(null, { status: 204 });
            }

            // Unenhanced submission: POST/Redirect/GET back to the contact.
            return redirect(routes.contacts.show.href({ id }));
        },
        async update(ctx) {
            let id = contactId(ctx.params);
            if (id instanceof Response) return id;

            let parsed = s.parseSafe(UpdateSchema, ctx.formData);
            if (!parsed.success) {
                return new Response("Invalid contact details", { status: 400 });
            }

            let contact = await getContact(id);
            if (!contact) {
                return contactNotFound(ctx);
            }

            let updates = parsed.value;

            // Preserve existing avatar when no new file is uploaded
            if (!updates.avatar) {
                updates.avatar = contact.avatar ?? "";
            }

            await updateContact(id, updates);

            return redirect(routes.contacts.show.href({ id }));
        },
    },
});
