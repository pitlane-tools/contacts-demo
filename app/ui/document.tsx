import type { Handle } from "remix/component";

import { SITE } from "#/data/meta.ts";
import { searchQuery } from "#/data/schemas.ts";
import clientAssets from "#/entry.browser.tsx?assets=client";
import serverAssets from "#/entry.server.tsx?assets=ssr";
import styles from "#/index.css?url";
import { routes } from "#/routes.ts";
import { SearchBar } from "#/ui/search-bar.tsx";
import { mergeAssets } from "@pitlane/dev/runtime";
import { HMR } from "pitlane:dev";
import { Frame } from "remix/component";
import { getContext } from "remix/middleware/async-context";

import { RestfulForm } from "./restful-form.tsx";

export namespace Document {
    export interface Props {
        description?: string;
        title?: string;
    }
}

export function Document(handle: Handle<Document.Props>) {
    let { url } = getContext();
    let q = searchQuery(url);
    let { css, js } = mergeAssets(clientAssets, serverAssets);

    return () => (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta content="width=device-width, initial-scale=1" name="viewport" />

                <title>{handle.props.title ?? SITE.title}</title>
                {handle.props.description ? (
                    <meta content={handle.props.description} name="description" />
                ) : null}

                <link href="/favicon.ico" rel="icon" sizes="32x32" />
                <link href="/favicon.svg" rel="icon" sizes="any" type="image/svg+xml" />
                <link href="/favicon-180.png" rel="apple-touch-icon" sizes="180x180" />

                <link href={styles} rel="stylesheet" />
                {css.map(attrs => (
                    <link key={attrs.href} {...attrs} rel="stylesheet" />
                ))}

                <script async src={clientAssets.entry} type="module" />
                {js.map(attrs => (
                    <link key={attrs.href} {...attrs} rel="modulepreload" />
                ))}
            </head>
            <body>
                <HMR />
                <div id="root">
                    <div id="sidebar">
                        <h1>{SITE.title}</h1>
                        <div>
                            <SearchBar query={q} />
                            <RestfulForm
                                action={routes.contacts.create.href()}
                                method={routes.contacts.create.method}
                            >
                                <button type="submit">New</button>
                            </RestfulForm>
                        </div>
                        <Frame name="sidebar" src={url.toString()} />
                    </div>
                    <Frame name="detail" src={url.toString()} />
                </div>
            </body>
        </html>
    );
}
