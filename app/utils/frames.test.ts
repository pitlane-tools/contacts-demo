import { describe, expect, it } from "vitest";

import { frameTarget } from "#/utils/frames.ts";

describe("frameTarget", () => {
    it("reads the target of a frame request", () => {
        let headers = new Headers({ "x-remix-frame": "true", "x-remix-target": "detail" });
        expect(frameTarget(headers)).toBe("detail");
    });

    it("ignores a target without the frame header so a navigation cannot be served a fragment", () => {
        let headers = new Headers({ "x-remix-target": "detail" });
        expect(frameTarget(headers)).toBe(null);
    });

    it("returns null for a frame request with no target", () => {
        let headers = new Headers({ "x-remix-frame": "true" });
        expect(frameTarget(headers)).toBe(null);
    });
});
