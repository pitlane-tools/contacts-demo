import { clientEntry, type Handle, navigate, on } from "remix/component";

export let SearchBar = clientEntry(import.meta.url, (handle: Handle<{ query?: string }>) => {
    // `navigate()` settles when the targeted frame has finished swapping, so
    // this component can own its own pending state instead of reading a global
    // navigation bus. Counted, because each keystroke starts another one.
    let pendingSearches = 0;

    async function search(value: string) {
        let url = new URL(location.href);

        if (!value.trim()) {
            url.searchParams.delete("q");
            try {
                await navigate(url.toString(), { target: "sidebar" });
            } catch {
                // superseded by a later keystroke
            }
            return;
        }

        let isFirstSearch = url.searchParams.get("q") === null;
        url.searchParams.set("q", value);

        pendingSearches++;
        handle.update();

        try {
            await navigate(url.toString(), {
                history: isFirstSearch ? "replace" : "push",
                target: "sidebar",
            });
        } catch {
            // superseded by a later keystroke
        } finally {
            pendingSearches--;
            handle.update();
        }
    }

    return () => {
        let searching = pendingSearches > 0;

        return (
            <form data-rmx-target="sidebar" id="search-form" method="GET">
                <input
                    aria-label="Search contacts"
                    class={searching ? "loading" : ""}
                    defaultValue={handle.props.query ?? undefined}
                    id="q"
                    mix={on("input", event => search(event.currentTarget.value))}
                    name="q"
                    placeholder="Search"
                    type="search"
                />
                <div aria-hidden hidden={!searching} id="search-spinner" />
                <div aria-live="polite" class="sr-only" />
            </form>
        );
    };
});
