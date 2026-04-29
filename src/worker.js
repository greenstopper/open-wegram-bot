/**
 * Open Wegram Bot - Cloudflare Worker Entry Point
 * A two-way private messaging Telegram bot
 *
 * GitHub Repository: https://github.com/wozulong/open-wegram-bot
 */

import {handleRequest} from './core.js';

export default {
    async fetch(request, env, ctx) {
        const config = {
            prefix: env.PREFIX || 'public',
            secretToken: env.SECRET_TOKEN || '',
            blockedTokens: env.BLOCKED_TOKENS || '',
            blockedUsers: env.BLOCKED_USERS || '',
            blockLinks: env.BLOCK_LINKS || ''
        };

        return handleRequest(request, config);
    }
};