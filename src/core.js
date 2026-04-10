/**
 * Open Wegram Bot - Core Logic
 * Shared code between Cloudflare Worker and Vercel deployments
 */

import {createInMemoryStateStore} from './state-store.js';

const MESSAGE_UPDATES = ['message', 'edited_message'];
const SUPPORTED_MEDIA_TYPES = ['animation', 'audio', 'document', 'photo', 'video'];
const COMMANDS = new Set(['start', 'setwelcome', 'clearwelcome', 'block', 'unblock']);

export function validateSecretToken(token) {
    return token.length > 15 && /[A-Z]/.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
}

export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {'Content-Type': 'application/json'}
    });
}

export async function postToTelegramApi(token, method, body) {
    return fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
}

async function callTelegramApi(token, method, body) {
    const response = await postToTelegramApi(token, method, body);
    const result = await response.json();

    if (!response.ok || !result.ok) {
        throw new Error(result.description || `Telegram API request failed with status ${response.status}`);
    }

    return result.result;
}

function buildStoreKey(botToken, ...parts) {
    return ['owb', 'v1', botToken, ...parts].join(':');
}

async function getStoredJson(stateStore, key, fallback = null) {
    const rawValue = await stateStore.get(key);
    if (rawValue === null || rawValue === undefined || rawValue === '') {
        return fallback;
    }

    try {
        return JSON.parse(rawValue);
    } catch (error) {
        console.warn(`Failed to parse state value for key "${key}":`, error);
        return fallback;
    }
}

async function setStoredJson(stateStore, key, value) {
    await stateStore.set(key, JSON.stringify(value));
}

function getReplySenderUid(message) {
    const button = message?.reply_markup?.inline_keyboard?.[0]?.[0];
    if (!button) {
        return null;
    }

    if (button.callback_data) {
        return button.callback_data;
    }

    if (button.url?.startsWith('tg://user?id=')) {
        return button.url.split('tg://user?id=')[1];
    }

    return null;
}

function parseCommand(text) {
    if (typeof text !== 'string') {
        return null;
    }

    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
        return null;
    }

    const boundary = trimmed.search(/\s/);
    const head = boundary === -1 ? trimmed : trimmed.slice(0, boundary);
    const args = boundary === -1 ? '' : trimmed.slice(boundary + 1).trim();
    const command = head.slice(1).split('@')[0].toLowerCase();
    if (!COMMANDS.has(command)) {
        return null;
    }

    return {command, args};
}

function getUpdateMessage(update) {
    if (update.edited_message) {
        return {message: update.edited_message, edited: true};
    }

    if (update.message) {
        return {message: update.message, edited: false};
    }

    return null;
}

function getSenderName(chat) {
    if (chat.username) {
        return `@${chat.username}`;
    }

    return [chat.first_name, chat.last_name].filter(Boolean).join(' ') || 'Unknown User';
}

function createSenderButton(senderName, senderUid, withUrl) {
    if (withUrl) {
        return {
            text: `From: ${senderName} (${senderUid})`,
            url: `tg://user?id=${senderUid}`
        };
    }

    return {
        text: `From: ${senderName} (${senderUid})`,
        callback_data: senderUid
    };
}

function getMediaPayload(message) {
    for (const mediaType of SUPPORTED_MEDIA_TYPES) {
        if (!message[mediaType]) {
            continue;
        }

        if (mediaType === 'photo') {
            const photo = message.photo[message.photo.length - 1];
            if (!photo?.file_id) {
                return null;
            }

            return {type: mediaType, fileId: photo.file_id};
        }

        if (message[mediaType]?.file_id) {
            return {type: mediaType, fileId: message[mediaType].file_id};
        }
    }

    return null;
}

function buildEditableMessagePayload(message) {
    if (typeof message.text === 'string') {
        return {
            method: 'editMessageText',
            body: {
                text: message.text,
                entities: message.entities
            }
        };
    }

    const media = getMediaPayload(message);
    if (media) {
        return {
            method: 'editMessageMedia',
            body: {
                media: {
                    type: media.type,
                    media: media.fileId,
                    caption: message.caption,
                    caption_entities: message.caption_entities
                }
            }
        };
    }

    return null;
}

async function saveMessageMirror(stateStore, botToken, sourceMessage, targetChatId, targetMessageId, peerUserId, replyMarkup = null) {
    const key = buildStoreKey(botToken, 'mirror', sourceMessage.chat.id, sourceMessage.message_id);
    await setStoredJson(stateStore, key, {
        targetChatId: String(targetChatId),
        targetMessageId,
        peerUserId: peerUserId ? String(peerUserId) : null,
        replyMarkup
    });
}

async function getMessageMirror(stateStore, botToken, chatId, messageId) {
    const key = buildStoreKey(botToken, 'mirror', chatId, messageId);
    return await getStoredJson(stateStore, key);
}

async function hasSeenUser(stateStore, botToken, userId) {
    const value = await stateStore.get(buildStoreKey(botToken, 'seen', userId));
    return value === '1';
}

async function markUserSeen(stateStore, botToken, userId) {
    await stateStore.set(buildStoreKey(botToken, 'seen', userId), '1');
}

async function isBlockedUser(stateStore, botToken, userId) {
    const value = await stateStore.get(buildStoreKey(botToken, 'blocked', userId));
    return value === '1';
}

async function setBlockedUser(stateStore, botToken, userId, blocked) {
    const key = buildStoreKey(botToken, 'blocked', userId);
    if (blocked) {
        await stateStore.set(key, '1');
        return;
    }

    await stateStore.delete(key);
}

async function getWelcomeMessage(stateStore, botToken, defaultWelcomeMessage) {
    const stored = await stateStore.get(buildStoreKey(botToken, 'welcome'));
    if (stored !== null && stored !== undefined && stored !== '') {
        return stored;
    }

    return defaultWelcomeMessage || '';
}

async function setWelcomeMessage(stateStore, botToken, text) {
    await stateStore.set(buildStoreKey(botToken, 'welcome'), text);
}

async function clearWelcomeMessage(stateStore, botToken) {
    await stateStore.delete(buildStoreKey(botToken, 'welcome'));
}

async function sendOwnerNotice(botToken, ownerUid, text, replyToMessageId = null) {
    const payload = {
        chat_id: parseInt(ownerUid),
        text
    };

    if (replyToMessageId) {
        payload.reply_parameters = {message_id: replyToMessageId};
    }

    await callTelegramApi(botToken, 'sendMessage', payload);
}

async function sendWelcomeMessage(botToken, userId, text) {
    if (!text) {
        return;
    }

    await callTelegramApi(botToken, 'sendMessage', {
        chat_id: parseInt(userId),
        text
    });
}

async function copyAndTrackMessage(stateStore, botToken, sourceMessage, targetChatId, peerUserId, replyMarkup = null) {
    const copyPayload = {
        chat_id: parseInt(targetChatId),
        from_chat_id: sourceMessage.chat.id,
        message_id: sourceMessage.message_id
    };

    if (replyMarkup) {
        copyPayload.reply_markup = replyMarkup;
    }

    const result = await callTelegramApi(botToken, 'copyMessage', copyPayload);
    await saveMessageMirror(stateStore, botToken, sourceMessage, targetChatId, result.message_id, peerUserId, replyMarkup);
    return result;
}

async function syncEditedMessage(stateStore, botToken, message) {
    const mirror = await getMessageMirror(stateStore, botToken, message.chat.id, message.message_id);
    if (!mirror) {
        return;
    }

    if (mirror.peerUserId && await isBlockedUser(stateStore, botToken, mirror.peerUserId)) {
        return;
    }

    const editPayload = buildEditableMessagePayload(message);
    if (!editPayload) {
        return;
    }

    const requestBody = {
        chat_id: parseInt(mirror.targetChatId),
        message_id: mirror.targetMessageId,
        ...editPayload.body
    };

    if (mirror.replyMarkup) {
        requestBody.reply_markup = mirror.replyMarkup;
    }

    await callTelegramApi(botToken, editPayload.method, requestBody);
}

async function handleOwnerCommand(stateStore, ownerUid, botToken, message, command) {
    if (command.command === 'setwelcome') {
        if (!command.args) {
            await sendOwnerNotice(botToken, ownerUid, 'Usage: /setwelcome <text>', message.message_id);
            return true;
        }

        await setWelcomeMessage(stateStore, botToken, command.args);
        await sendOwnerNotice(botToken, ownerUid, 'Welcome message updated.', message.message_id);
        return true;
    }

    if (command.command === 'clearwelcome') {
        await clearWelcomeMessage(stateStore, botToken);
        await sendOwnerNotice(botToken, ownerUid, 'Custom welcome message cleared.', message.message_id);
        return true;
    }

    if (command.command === 'block' || command.command === 'unblock') {
        let targetUid = command.args;
        if (!targetUid && message.reply_to_message) {
            targetUid = getReplySenderUid(message.reply_to_message);
        }

        if (!targetUid) {
            await sendOwnerNotice(botToken, ownerUid, `Usage: /${command.command} <user_id> or reply to a forwarded message`, message.message_id);
            return true;
        }

        const blocked = command.command === 'block';
        await setBlockedUser(stateStore, botToken, targetUid, blocked);
        await sendOwnerNotice(botToken, ownerUid, `${blocked ? 'Blocked' : 'Unblocked'} user ${targetUid}.`, message.message_id);
        return true;
    }

    return false;
}

async function handleOwnerReply(stateStore, ownerUid, botToken, message, reply) {
    const senderUid = getReplySenderUid(reply);
    if (!senderUid) {
        return;
    }

    if (await isBlockedUser(stateStore, botToken, senderUid)) {
        await sendOwnerNotice(botToken, ownerUid, `User ${senderUid} is blocked. Use /unblock ${senderUid} before replying.`, message.message_id);
        return;
    }

    await copyAndTrackMessage(stateStore, botToken, message, senderUid, senderUid);
}

async function handleUserStart(stateStore, botToken, message, defaultWelcomeMessage) {
    const senderUid = String(message.chat.id);
    if (await hasSeenUser(stateStore, botToken, senderUid)) {
        return;
    }

    await markUserSeen(stateStore, botToken, senderUid);
    const welcomeMessage = await getWelcomeMessage(stateStore, botToken, defaultWelcomeMessage);
    await sendWelcomeMessage(botToken, senderUid, welcomeMessage);
}

async function handleIncomingUserMessage(stateStore, ownerUid, botToken, message) {
    const sender = message.chat;
    const senderUid = String(sender.id);
    const senderName = getSenderName(sender);
    const replyMarkup = {
        inline_keyboard: [[createSenderButton(senderName, senderUid, true)]]
    };

    try {
        await copyAndTrackMessage(stateStore, botToken, message, ownerUid, senderUid, replyMarkup);
    } catch (error) {
        replyMarkup.inline_keyboard[0][0] = createSenderButton(senderName, senderUid, false);
        await copyAndTrackMessage(stateStore, botToken, message, ownerUid, senderUid, replyMarkup);
    }
}

function getStateStore(config) {
    return config.stateStore || createInMemoryStateStore('open-wegram-bot');
}

export async function handleInstall(request, ownerUid, botToken, prefix, secretToken) {
    if (!validateSecretToken(secretToken)) {
        return jsonResponse({
            success: false,
            message: 'Secret token must be at least 16 characters and contain uppercase letters, lowercase letters, and numbers.'
        }, 400);
    }

    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.hostname}`;
    const webhookUrl = `${baseUrl}/${prefix}/webhook/${ownerUid}/${botToken}`;

    try {
        await callTelegramApi(botToken, 'setWebhook', {
            url: webhookUrl,
            allowed_updates: MESSAGE_UPDATES,
            secret_token: secretToken
        });

        return jsonResponse({success: true, message: 'Webhook successfully installed.'});
    } catch (error) {
        return jsonResponse({success: false, message: `Error installing webhook: ${error.message}`}, 500);
    }
}

export async function handleUninstall(botToken, secretToken) {
    if (!validateSecretToken(secretToken)) {
        return jsonResponse({
            success: false,
            message: 'Secret token must be at least 16 characters and contain uppercase letters, lowercase letters, and numbers.'
        }, 400);
    }

    try {
        await callTelegramApi(botToken, 'deleteWebhook', {});
        return jsonResponse({success: true, message: 'Webhook successfully uninstalled.'});
    } catch (error) {
        return jsonResponse({success: false, message: `Error uninstalling webhook: ${error.message}`}, 500);
    }
}

export async function handleWebhook(request, ownerUid, botToken, secretToken, config = {}) {
    if (secretToken !== request.headers.get('X-Telegram-Bot-Api-Secret-Token')) {
        return new Response('Unauthorized', {status: 401});
    }

    const update = await request.json();
    const payload = getUpdateMessage(update);
    if (!payload) {
        return new Response('OK');
    }

    const {message, edited} = payload;
    const reply = message.reply_to_message;
    const stateStore = getStateStore(config);
    const isOwnerMessage = message.chat.id.toString() === ownerUid;
    const command = parseCommand(message.text);

    try {
        if (edited) {
            if (!isOwnerMessage && await isBlockedUser(stateStore, botToken, String(message.chat.id))) {
                return new Response('OK');
            }

            await syncEditedMessage(stateStore, botToken, message);
            return new Response('OK');
        }

        if (isOwnerMessage && command) {
            await handleOwnerCommand(stateStore, ownerUid, botToken, message, command);
            return new Response('OK');
        }

        if (isOwnerMessage) {
            if (reply) {
                await handleOwnerReply(stateStore, ownerUid, botToken, message, reply);
            }

            return new Response('OK');
        }

        const senderUid = String(message.chat.id);
        if (await isBlockedUser(stateStore, botToken, senderUid)) {
            return new Response('OK');
        }

        if (command?.command === 'start') {
            await handleUserStart(stateStore, botToken, message, config.welcomeMessage);
            return new Response('OK');
        }

        await markUserSeen(stateStore, botToken, senderUid);
        await handleIncomingUserMessage(stateStore, ownerUid, botToken, message);
        return new Response('OK');
    } catch (error) {
        console.error('Error handling webhook:', error);
        return new Response('Internal Server Error', {status: 500});
    }
}

export async function handleRequest(request, config) {
    const {prefix, secretToken} = config;

    const url = new URL(request.url);
    const path = url.pathname;

    const INSTALL_PATTERN = new RegExp(`^/${prefix}/install/([^/]+)/([^/]+)$`);
    const UNINSTALL_PATTERN = new RegExp(`^/${prefix}/uninstall/([^/]+)$`);
    const WEBHOOK_PATTERN = new RegExp(`^/${prefix}/webhook/([^/]+)/([^/]+)$`);

    let match;

    if (match = path.match(INSTALL_PATTERN)) {
        return handleInstall(request, match[1], match[2], prefix, secretToken);
    }

    if (match = path.match(UNINSTALL_PATTERN)) {
        return handleUninstall(match[1], secretToken);
    }

    if (match = path.match(WEBHOOK_PATTERN)) {
        return handleWebhook(request, match[1], match[2], secretToken, config);
    }

    return new Response('Not Found', {status: 404});
}
