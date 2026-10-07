import { describe, expect, it } from "vitest";

import { applyPageMetadata, pageMetadataHeaders } from "#/utils/page-metadata.ts";

function apply(metadata: Parameters<typeof pageMetadataHeaders>[0]): void {
    applyPageMetadata(new Headers(pageMetadataHeaders(metadata)));
}

function description(): string | null {
    return (
        document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null
    );
}

describe("page metadata", () => {
    it("round-trips a non-ASCII title through an ASCII-only header", () => {
        apply({ title: "Ada Lovelace · Remix 3 Contacts" });
        expect(document.title).toBe("Ada Lovelace · Remix 3 Contacts");
    });

    it("upserts the description rather than duplicating it", () => {
        apply({ description: "first", title: "one" });
        apply({ description: "second", title: "two" });

        expect(document.head.querySelectorAll('meta[name="description"]').length).toBe(1);
        expect(description()).toBe("second");
    });

    it("drops a stale description when the next page has none", () => {
        apply({ description: "present", title: "one" });
        apply({ title: "two" });

        expect(description()).toBe(null);
    });

    it("leaves the document alone when a response carries no metadata", () => {
        apply({ title: "kept" });
        applyPageMetadata(new Headers());

        expect(document.title).toBe("kept");
    });
});
