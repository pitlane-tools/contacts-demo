/**
 * Destination of the in-flight navigation, if any.
 *
 * `remix/component` has no app-wide navigation bus by design — per-region pending UI
 * is built from a frame's own `reloadStart`/`reloadComplete` events, and a
 * caller that triggers a navigation itself can just await `navigate()`.
 *
 * Sidebar items need something neither of those gives them: when one item
 * becomes active *every* item has to re-render, including the one losing active
 * state, which never received the click. So this narrow subscription over the
 * Navigation API stays app-owned.
 */

export let isServer = typeof window === "undefined";

let destination: URL | null = null;
let listeners = new Set<() => void>();

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

function setDestination(next: URL | null): void {
    destination = next;
    for (let listener of listeners) listener();
}

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
