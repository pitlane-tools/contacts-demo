import type { Contact } from "#/data/contacts.ts";
import type { Handle } from "remix/component";

import { routes } from "#/routes.ts";
import { CancelButton } from "#/ui/cancel-button.tsx";
import { RestfulForm } from "#/ui/restful-form.tsx";
import { ALLOWED_TYPES } from "#/utils/image-types.ts";

export function EditContact(handle: Handle<{ contact: Contact }>) {
    let props = handle.props;
    return () => (
        <div id="detail">
            <RestfulForm
                action={routes.contacts.update.href({ id: props.contact.id })}
                enctype="multipart/form-data"
                id="contact-form"
                method={routes.contacts.update.method}
            >
                <label>
                    <span>Name</span>
                    <input
                        aria-label="First name"
                        name="first"
                        placeholder="First"
                        type="text"
                        value={props.contact.first || undefined}
                    />
                    <input
                        aria-label="Last name"
                        name="last"
                        placeholder="Last"
                        type="text"
                        value={props.contact.last || undefined}
                    />
                </label>

                <label>
                    <span>Bluesky</span>
                    <input
                        name="bsky"
                        placeholder="jay.bsky.team"
                        type="text"
                        value={props.contact.bsky || undefined}
                    />
                </label>

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
                            <input
                                accept={ALLOWED_TYPES.join(",")}
                                hidden
                                name="avatar"
                                type="file"
                            />
                            <span>Choose Photo</span>
                        </label>
                    </div>
                </label>

                <label>
                    <span>Notes</span>
                    <textarea name="notes" rows={6} value={props.contact.notes || undefined} />
                </label>

                <p>
                    <button type="submit">Save</button>
                    <CancelButton />
                </p>
            </RestfulForm>
        </div>
    );
}
