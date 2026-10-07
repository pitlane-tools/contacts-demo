import { createAssetResolver } from "@pitlane/assets";
import manifest from "@pitlane/assets/manifest";

export let assets = createAssetResolver(manifest);

export let scriptEntry = await assets.getScriptEntry("app/entry.browser.tsx");
export let stylesheets = await assets.getStylesheets("app/entry.server.tsx");
export let indexStylesheetHref = await assets.getHref("app/index.css");
