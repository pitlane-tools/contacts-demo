import * as s from "remix/data-schema";
import { describe, expect, it } from "vitest";

import { UpdateSchema } from "#/data/schemas.ts";

function submit(fields: Record<string, string>) {
    let formData = new FormData();
    for (let [name, value] of Object.entries(fields)) formData.set(name, value);
    return s.parseSafe(UpdateSchema, formData);
}

const CONTACT = { bsky: "ada.bsky.social", first: "Ada", last: "Lovelace", notes: "hi" };

describe("UpdateSchema", () => {
    it("accepts a wholly blank submission", () => {
        // `create` makes an empty contact, so the edit form's first save is this.
        expect(submit({ bsky: "", first: "", last: "", notes: "" }).success).toBe(true);
    });

    it("accepts an omitted avatar, which is what an empty file input produces", () => {
        // `uploadHandler` returns undefined for an empty part, and the parser
        // drops the field rather than appending it.
        expect(submit(CONTACT).success).toBe(true);
    });

    it("accepts the upload path the server itself generated", () => {
        let result = submit({ ...CONTACT, avatar: "/uploads/avatar/1712345678901-abc.jpg" });
        expect(result.success).toBe(true);
    });

    it("rejects an avatar pointing anywhere but this app's uploads", () => {
        expect(submit({ ...CONTACT, avatar: "https://evil.example/x.png" }).success).toBe(false);
        expect(submit({ ...CONTACT, avatar: "//evil.example/x.png" }).success).toBe(false);
        expect(submit({ ...CONTACT, avatar: "/uploads/../../etc/passwd" }).success).toBe(false);
    });

    it("accepts a Bluesky handle with the @ people paste", () => {
        expect(submit({ ...CONTACT, bsky: "@markdalgleish.com" }).success).toBe(true);
    });

    it("rejects something that is not a handle", () => {
        expect(submit({ ...CONTACT, bsky: "not a handle" }).success).toBe(false);
        expect(submit({ ...CONTACT, bsky: "ada" }).success).toBe(false);
    });

    it("bounds the free-text fields", () => {
        expect(submit({ ...CONTACT, first: "a".repeat(101) }).success).toBe(false);
        expect(submit({ ...CONTACT, notes: "x".repeat(10_001) }).success).toBe(false);
    });
});
