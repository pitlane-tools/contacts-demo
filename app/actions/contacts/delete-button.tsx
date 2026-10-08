import type { Handle } from "remix/component";

import { clientEntry, on } from "remix/component";

import { routes } from "#/routes.ts";
import { RestfulForm } from "#/ui/restful-form.tsx";

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
