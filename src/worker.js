/**
 * Open Wegram Bot - Cloudflare Worker Entry Point
 * A two-way private messaging Telegram bot
 *
 * GitHub Repository: https://github.com/wozulong/open-wegram-bot
 */

import {handleRequest} from './core.js';
import {createStateStore} from './state-store.js';

export default {
    async fetch(request, env, ctx) {
        const config = {
            prefix: env.PREFIX || 'public',
            secretToken: env.SECRET_TOKEN || '',
            welcomeMessage: env.WELCOME_MESSAGE || '',
            stateStore: createStateStore({
                namespace: `cf:${env.PREFIX || 'public'}`,
                cloudflareKv: env.STATE_KV
            })
        };

        return handleRequest(request, config);
    }
};
