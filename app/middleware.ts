import { createD1Database } from "@pitlane/data-table-d1";
import { env } from "cloudflare:workers";
import { Database } from "remix/data-table";
import { FormDataParseError, MaxFilesExceededError } from "remix/form-data-parser";
import {
    MaxFileSizeExceededError,
    MaxHeaderSizeExceededError,
    MaxPartsExceededError,
    MaxTotalSizeExceededError,
    MultipartParseError,
} from "remix/multipart-parser";
import { type Middleware } from "remix/router";

import { UnsupportedMediaTypeError } from "#/utils/uploads.ts";

type DatabaseEntry = { key: typeof Database; value: Database };

export function database(): Middleware<DatabaseEntry> {
    // Built once per isolate: the binding is stable, so there is nothing to
    // rebuild per request.
    let db = createD1Database(env.DB);

    return (ctx, next) => {
        ctx.set(Database, db);
        return next();
    };
}

/**
 * Turns the failures raised while `formData()` is still streaming the body into
 * responses. They happen before any action runs, so nothing downstream can
 * answer for them, and without this they would reach the Workers boundary as
 * uncaught errors and become a generic 500.
 */
export function uploadErrors(): Middleware {
    return async (_ctx, next) => {
        try {
            return await next();
        } catch (error) {
            if (error instanceof UnsupportedMediaTypeError) {
                return new Response(
                    "Unsupported image format. Please upload a JPEG, PNG, GIF, AVIF, or WebP file.",
                    { status: 415 },
                );
            }

            if (
                error instanceof MaxFileSizeExceededError ||
                error instanceof MaxTotalSizeExceededError ||
                error instanceof MaxFilesExceededError ||
                error instanceof MaxPartsExceededError ||
                error instanceof MaxHeaderSizeExceededError
            ) {
                return new Response("Upload is too large. Images must be 5 MB or smaller.", {
                    status: 413,
                });
            }

            // Anything else from the parser is a malformed body, not a server fault.
            if (error instanceof MultipartParseError || error instanceof FormDataParseError) {
                return new Response("Malformed form submission", { status: 400 });
            }

            throw error;
        }
    };
}
