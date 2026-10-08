import type { Handle } from "remix/component";
import type { RequestMethod } from "remix/router";

export function RestfulForm(
    handle: Handle<JSX.IntrinsicHTMLElements["form"] & { method?: RequestMethod | "ANY" }>,
) {
    return () => {
        let { children, method, ...props } = handle.props;
        let isGET = method === "GET" || typeof method === "undefined";
        return (
            <form method={isGET ? "GET" : "POST"} {...props}>
                {!isGET && <input name="_method" type="hidden" value={method} />}
                {children}
            </form>
        );
    };
}
