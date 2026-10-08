import type { FileUpload } from "remix/form-data-parser";

import { env } from "cloudflare:workers";

import { R2FileStorage } from "#/data/adapters/r2-file-storage.ts";
import { routes } from "#/routes.ts";
import { imageExtension } from "#/utils/image-types.ts";

export let uploadStorage = new R2FileStorage(env.FILES);

/**
 * Caps handed to `formData()`. An avatar is one modest image, and the edit form
 * sends six parts, so these bound the request well below anything a Worker
 * should be asked to buffer.
 */
export const UPLOAD_LIMITS = {
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 1,
    maxParts: 20,
    maxTotalSize: 6 * 1024 * 1024,
};

/**
 * Thrown while the form body is still streaming, so it cannot be turned into a
 * response at the throw site. {@link uploadErrors} converts it to a 415.
 */
export class UnsupportedMediaTypeError extends Error {
    constructor(description: string) {
        super(`Unsupported image format: ${description}`);
        this.name = "UnsupportedMediaTypeError";
    }
}

/** Stores an upload in R2 and returns the URL used as the form field's value. */
export async function uploadHandler(file: FileUpload): Promise<string | undefined> {
    // Empty file inputs still produce a multipart part — skip them
    if (file.size === 0) {
        return undefined;
    }

    let extension = imageExtension(file.name, file.type);
    if (extension === undefined) {
        throw new UnsupportedMediaTypeError(`${file.type || "unknown"} (${file.name})`);
    }

    let suffix = Math.random().toString(36).substring(7);
    let key = `${file.fieldName}/${Date.now()}-${suffix}.${extension}`;

    await uploadStorage.set(key, file);
    return routes.uploads.href({ key });
}
