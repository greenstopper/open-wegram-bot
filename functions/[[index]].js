/**
 * Open Wegram Bot - EdgeOne Entry Point
 * A two-way private messaging Telegram bot
 *
 * GitHub Repository: https://github.com/wozulong/open-wegram-bot
 */

import {handleRequest} from '../src/core.js';

export default async function onRequest(context) {
    const req = context.request;
    const request = new Request(req.url, {
        method: req.method,
        headers: new Headers(req.headers),
        body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : null
    });

    const config = {
        prefix: context.env.EDGEONE_PREFIX || 'public',
        secretToken: context.env.SECRET_TOKEN || '',
        blockedTokens: context.env.BLOCKED_TOKENS || '',
        blockedUsers: context.env.BLOCKED_USERS || '',
        blockLinks: context.env.BLOCK_LINKS || ''
    };

    const response = await handleRequest(request, config);

    const body = await response.text();

    return new Response(body, {
        status: response.status,
        headers: {
            'Content-Type': response.headers.get('Content-Type') || 'text/plain',
        },
    });
}