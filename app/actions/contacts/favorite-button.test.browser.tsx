import { render } from "remix/component/test";
import { describe, expect, it, onTestFinished } from "vitest";

import { FavoriteButton } from "#/actions/contacts/favorite-button.tsx";

describe("FavoriteButton", () => {
    it("shows the current state but submits the desired one", () => {
        // A native submission has no JavaScript to flip anything, and
        // updateContact writes an absolute value rather than toggling. So the
        // value the button carries has to be the state the user wants next,
        // while the glyph still reflects the state they have now.
        let favorited = render(<FavoriteButton contactId={1} favorite={true} />);
        onTestFinished(favorited.cleanup);

        expect(favorited.$("button")?.getAttribute("value")).toBe("false");
        expect(favorited.$("button")?.textContent).toBe("★");

        let plain = render(<FavoriteButton contactId={1} favorite={false} />);
        onTestFinished(plain.cleanup);

        expect(plain.$("button")?.getAttribute("value")).toBe("true");
        expect(plain.$("button")?.textContent).toBe("☆");
    });

    it("posts to the contact's favorite route with a method override", () => {
        // RestfulForm renders POST plus a hidden _method, which methodOverride()
        // turns back into the PATCH the route declares.
        let result = render(<FavoriteButton contactId={7} favorite={false} />);

        let form = result.$("form") as HTMLFormElement | null;
        expect(form?.getAttribute("method")?.toUpperCase()).toBe("POST");
        expect(form?.getAttribute("action")?.endsWith("/contacts/7/favorite")).toBeTruthy();
        expect(result.$('input[name="_method"]')?.getAttribute("value")).toBe("PATCH");

        result.cleanup();
    });
});
