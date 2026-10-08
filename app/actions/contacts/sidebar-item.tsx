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
