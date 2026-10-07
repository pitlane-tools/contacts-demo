import { createD1Database } from "pitlane/data-table-d1";
import { getPlatformProxy } from "wrangler";

import { Contacts } from "#/data/contacts.ts";

// Seeds the local D1 with demo contacts. Idempotent: skips when the
// `contacts` table already has rows. Schema migrations are applied
// separately via `wrangler d1 migrations apply --local`. See db/README.md.

const SEED_CONTACTS = [
    {
        first: "Brooks",
        last: "Lybrand",
        avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:l7sltcx6yitxew2vgcrn72ge/bafkreihj5npizsg62l37ienf5tgsfxopjcdywg2rzwaqdrcf7t2dtngpxq",
        bsky: "brookslybrand.bsky.social",
    },
    {
        first: "Mark",
        last: "Dalgleish",
        avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:hucjy724rz245jjd3ismnwcy/bafkreifecuk7zywjcxraqr75ua7hp3jtj2g5zygifh3cmzbe3hpsnqr7ye@jpeg",
        bsky: "markdalgleish.com",
    },
    {
        first: "Pedro",
        last: "Cattori",
        avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:6zwkx24n4vucdcfgzbwzfy57/bafkreihecdr73d63xajbsrr525j7mih4dymzc5scaz7fr6qtyuouenrheu@jpeg",
        bsky: "pedrocattori.com",
    },
    {
        first: "Kent C.",
        last: "Dodds",
        avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:xzefkiajzjmmyp6zq6ftczg3/bafkreicjzokch3d33ikmot252ilfmlzfnqv6vbhonzcftdslmql3db5tfm@jpeg",
        bsky: "kentcdodds.com",
    },
    {
        first: "Jacob",
        last: "Ebey",
        avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:twegdcgytckr5cxm57gyruxa/bafkreidx3bmu6wprocniiyrpwnpwljky6rat7bjccxxoc66ncybhzt5qxu@jpeg",
        bsky: "ebey.bsky.social",
    },
];

let proxy = await getPlatformProxy<Env>({
    configPath: "./wrangler.jsonc",
    persist: true,
});

try {
    let db = createD1Database(proxy.env.DB);

    let count = await db.count(Contacts);
    if (count > 0) {
        console.log(`Seed skipped: ${count} contact(s) already present.`);
        process.exit(0);
    }

    for (let contact of SEED_CONTACTS) {
        await db.create(Contacts, {
            first: contact.first,
            last: contact.last,
            avatar: contact.avatar,
            bsky: contact.bsky,
            notes: "",
            favorite: false,
            createdAt: `${Date.now()}`,
        });
    }

    console.log(`Seeded ${SEED_CONTACTS.length} contact(s).`);
} finally {
    await proxy.dispose();
    process.exit(0);
}
