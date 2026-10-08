import { describe, expect, it } from "vitest";

import { ALLOWED_TYPES, imageExtension } from "#/utils/image-types.ts";

const SAMPLES: Record<string, string> = {
    "image/avif": "photo.avif",
    "image/gif": "photo.gif",
    "image/jpeg": "photo.jpg",
    "image/png": "photo.png",
    "image/webp": "photo.webp",
};

describe("imageExtension", () => {
    it("accepts every type the file input advertises", () => {
        // Whatever `accept` offers must be storable, or the picker lies.
        for (let type of ALLOWED_TYPES) {
            expect(imageExtension(SAMPLES[type], type)).not.toBe(undefined);
        }
    });

    it("normalises the extension rather than echoing the filename's", () => {
        expect(imageExtension("photo.jpeg", "image/jpeg")).toBe("jpg");
        expect(imageExtension("PHOTO.JPG", "image/jpeg")).toBe("jpg");
    });

    it("rejects a file whose declared type disagrees with its extension", () => {
        // The stored-XSS shape: an SVG dressed up as a PNG, or the reverse.
        expect(imageExtension("evil.svg", "image/png")).toBe(undefined);
        expect(imageExtension("evil.png", "image/svg+xml")).toBe(undefined);
    });

    it("rejects types outside the allowlist even when they agree", () => {
        // SVG is excluded deliberately: it is script-bearing, and uploads are
        // served inline from this origin.
        expect(imageExtension("evil.svg", "image/svg+xml")).toBe(undefined);
        expect(imageExtension("doc.pdf", "application/pdf")).toBe(undefined);
        expect(imageExtension("page.html", "text/html")).toBe(undefined);
    });

    it("rejects a filename that would smuggle a path segment into the key", () => {
        expect(imageExtension("evil.j/pg", "image/jpeg")).toBe(undefined);
    });

    it("rejects a file with no usable extension", () => {
        expect(imageExtension("photo", "image/jpeg")).toBe(undefined);
        expect(imageExtension("", "image/jpeg")).toBe(undefined);
    });
});
