import type { Handle } from "remix/component";

import { clientEntry, on } from "remix/component";

import { routes } from "#/routes.ts";
import { RestfulForm } from "#/ui/restful-form.tsx";

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

                        // Read the form and payload before the optimistic
                        // re-render: `currentTarget` is only valid during
                        // dispatch, and the button submits the state it wants,
                        // so once `favorite` flips the DOM carries the opposite.
                        let form = event.currentTarget;
                        let body = new FormData(form, event.submitter);

                        favorite = !favorite;
                        submitting = true;
                        await handle.update();

                        try {
                            let response = await fetch(form.action, {
                                body,
                                // Identifies this as the enhanced path, so the
                                // action answers 204 instead of redirecting.
                                headers: {
                                    "x-remix-frame": "true",
                                    "x-remix-target": "detail",
                                },
                                method: form.method,
                                signal,
                            });

                            if (!response.ok) {
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
                        disabled={submitting}
                        name="favorite"
                        type="submit"
                        value={favorite ? "false" : "true"}
                    >
                        {favorite ? "★" : "☆"}
                    </button>
                </RestfulForm>
            );
        };
    },
);
