import type { Contact } from "#/data/contacts.ts";
import type { Handle } from "remix/component";

import { DeleteButton } from "#/actions/contacts/delete-button.tsx";
import { FavoriteButton } from "#/actions/contacts/favorite-button.tsx";
import { routes } from "#/routes.ts";
import { RestfulForm } from "#/ui/restful-form.tsx";

const AVATAR_PLACEHOLDER =
    "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png";

export function ShowContact(handle: Handle<{ contact: Contact; query?: string }>) {
    return () => {
        let props = handle.props;

        return (
            <div id="detail">
                <div id="contact">
                    <div>
                        <img
                            alt=""
                            key={props.contact.avatar}
                            src={props.contact.avatar ? props.contact.avatar : AVATAR_PLACEHOLDER}
                        />
                    </div>

                    <div>
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

                        {props.contact.bsky ? (
                            <p>
                                <a
                                    href={`https://bsky.app/profile/${props.contact.bsky}`}
                                    rel="noreferrer"
                                    target="_blank"
                                >
                                    @{props.contact.bsky}
                                </a>
                            </p>
                        ) : null}

                        {props.contact.notes ? <p>{props.contact.notes}</p> : null}

                        <div>
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
                            <DeleteButton contactId={props.contact.id} />
                        </div>
                    </div>
                </div>
            </div>
        );
    };
}
