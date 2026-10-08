import { render } from "remix/component/test";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { SidebarItem } from "#/actions/contacts/sidebar-item.tsx";

// `pending-navigation.ts` subscribes to the Navigation API at module scope,
// which jsdom does not implement. Mocking this one app-owned seam lets the
// tests drive the two inputs the component actually derives from.
const NAV = vi.hoisted(() => ({ pending: null as URL | null }));

vi.mock("#/utils/pending-navigation.ts", () => ({
    isServer: false,
    onDestinationChange: () => {},
    pendingDestination: () => NAV.pending,
}));

const ADA = { first: "Ada", id: 2, last: "Lovelace" };

function show(props: Partial<SidebarItem.Props> = {}) {
    let result = render(<SidebarItem contact={ADA} selected="" {...props} />);
    onTestFinished(result.cleanup);
    return result;
}

function at(path: string) {
    history.pushState({}, "", path);
    onTestFinished(() => history.pushState({}, "", "/"));
}

describe("SidebarItem", () => {
    it("marks the contact in the current URL active", () => {
        at("/contacts/2");
        expect(show().$("a")?.getAttribute("class")).toBe("active");
    });

    it("leaves other contacts unmarked", () => {
        at("/contacts/99");
        expect(show().$("a")?.getAttribute("class")).toBe(null);
    });

    it("falls back to the server's selected id when the URL matches no contact", () => {
        // The sidebar frame is not re-rendered by a detail navigation, so the
        // prop is the only signal on a URL the matcher does not recognise.
        at("/");
        expect(show({ selected: "2" }).$("a")?.getAttribute("class")).toBe("active");
    });

    it("marks the navigation destination pending", () => {
        at("/contacts/99");
        NAV.pending = new URL("http://localhost:3000/contacts/2");
        onTestFinished(() => {
            NAV.pending = null;
        });

        expect(show().$("a")?.getAttribute("class")).toBe("pending");
    });

    it("never marks the already-active contact pending", () => {
        at("/contacts/2");
        NAV.pending = new URL("http://localhost:3000/contacts/2");
        onTestFinished(() => {
            NAV.pending = null;
        });

        expect(show().$("a")?.getAttribute("class")).toBe("active");
    });

    it("stays active while navigating to its own edit page", () => {
        // Same contact, different path — the only case where a contact is both
        // active and the pending destination. It must not flicker to "pending".
        at("/contacts/2");
        NAV.pending = new URL("http://localhost:3000/contacts/2/edit");
        onTestFinished(() => {
            NAV.pending = null;
        });

        expect(show().$("a")?.getAttribute("class")).toBe("active");
    });

    it("targets the detail frame and carries the search query", () => {
        at("/");
        let link = show({ query: "ada" }).$("a");

        expect(link?.getAttribute("data-rmx-target")).toBe("detail");
        expect(link?.getAttribute("href")).toBe("/contacts/2?q=ada");
    });

    it("names an unnamed contact and stars a favorite", () => {
        at("/");
        let unnamed = show({ contact: { id: 3 } });
        expect(unnamed.$("i")?.textContent).toBe("No Name");

        let starred = show({ contact: { ...ADA, favorite: true } });
        expect(starred.$("span")?.textContent).toBe("★");
    });
});
