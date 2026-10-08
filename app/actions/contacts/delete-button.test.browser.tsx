import { render } from "remix/component/test";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { DeleteButton } from "#/actions/contacts/delete-button.tsx";

function deleteForm() {
    let result = render(<DeleteButton contactId={7} />);
    onTestFinished(result.cleanup);
    return result;
}

/** Dispatches the submit the runtime would otherwise intercept. */
function submit(form: Element | null) {
    let event = new Event("submit", { bubbles: true, cancelable: true });
    form?.dispatchEvent(event);
    return event.defaultPrevented;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("DeleteButton", () => {
    it("lets the submission through when the deletion is confirmed", () => {
        // Nothing else may be prevented: the runtime drives the actual DELETE.
        vi.stubGlobal("confirm", () => true);

        expect(submit(deleteForm().$("form"))).toBe(false);
    });

    it("cancels the submission when the deletion is declined", () => {
        vi.stubGlobal("confirm", () => false);

        expect(submit(deleteForm().$("form"))).toBe(true);
    });

    it("submits a method override, since HTML forms cannot DELETE", () => {
        vi.stubGlobal("confirm", () => true);
        let result = deleteForm();

        expect(result.$("form")?.getAttribute("method")?.toUpperCase()).toBe("POST");
        expect(result.$('input[name="_method"]')?.getAttribute("value")).toBe("DELETE");
        expect(result.$("form")?.getAttribute("action")).toBe("/contacts/7");
    });
});
