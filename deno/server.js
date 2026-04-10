/**
 * Open Wegram Bot - Deno Entry Point
 * A two-way private messaging Telegram bot
 *
 * GitHub Repository: https://github.com/wozulong/open-wegram-bot
 */

import {handleRequest} from "../src/core.js";
import {createStateStore} from "../src/state-store.js";

let denoKv = null;
try {
    denoKv = await Deno.openKv(Deno.env.get("STATE_KV_PATH") || undefined);
} catch (error) {
    console.warn("Deno KV unavailable, falling back to in-memory state store.", error);
}

const stateStore = createStateStore({
    namespace: "deno",
    denoKv
});

Deno.serve(async (req) => {
    const request = new Request(req.url, {
        method: req.method,
        headers: new Headers(req.headers),
        body: req.method !== "GET" && req.method !== "HEAD" ? await req.text() : null
    });

    const config = {
        prefix: Deno.env.get("PREFIX") || "public",
        secretToken: Deno.env.get("SECRET_TOKEN") || "",
        welcomeMessage: Deno.env.get("WELCOME_MESSAGE") || "",
        stateStore
    };

    const response = await handleRequest(request, config);

    const body = await response.text();

    return new Response(body, {
        status: response.status,
        headers: {
            "Content-Type": response.headers.get("Content-Type") || "text/plain",
        },
    });
});
