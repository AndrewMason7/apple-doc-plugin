/**
 * Apple Developer Documentation Studio — Host Bridge Services
 */

import { haptic, host } from '@hermes/plugin-sdk';
import { PLUGIN_ID } from '../data/constants.js';

export function safeHaptic(type = 'tap') {
	try {
		if (typeof haptic === 'function') haptic(type);
	} catch {}
}

export function safeNavigate(path) {
	try {
		if (typeof host?.navigate === 'function') {
			host.navigate(path);
		}
	} catch {}
}

export function safeOpenPane(paneId = 'inspector-pane') {
	try {
		const scopedId = paneId.includes(':') ? paneId : `${PLUGIN_ID}:${paneId}`;
		if (typeof host?.undismissPane === 'function') {
			host.undismissPane(scopedId);
		}
		if (typeof host?.revealPane === 'function') {
			host.revealPane(scopedId);
			return true;
		}
	} catch {}
	return false;
}

export function safeNotify(message, kind = 'info') {
	try {
		if (typeof host?.notify === 'function') {
			host.notify({ kind, message });
		}
	} catch {}
}

export async function safeWriteClipboard(ctx, text) {
	try {
		if (ctx?.os?.writeClipboard) {
			return Boolean(await ctx.os.writeClipboard(text));
		}
	} catch {}
	return false;
}

export function safeOpenExternal(ctx, url) {
	try {
		if (ctx?.os?.openExternal) {
			return ctx.os.openExternal(url);
		}
	} catch {}
	return false;
}

export async function insertIntoChatComposer(
	ctx,
	text,
	navigateToChat = false,
	sessionId = null,
) {
	safeHaptic('tap');
	try {
		if (navigateToChat) {
			safeNavigate('/');
		}
		if (typeof host?.composer?.insertText === 'function') {
			const inserted = await host.composer.insertText(sessionId ?? null, text, {
				mode: 'inline',
			});
			if (inserted) {
				safeNotify(`Inserted ${text} into chat composer`, 'success');
				return;
			}
		}
	} catch {
		// Fall back to clipboard when no active chat composer is mounted
	}
	const copied = await safeWriteClipboard(ctx, text);
	safeNotify(
		copied
			? `Copied ${text} to clipboard (open a chat to paste)`
			: 'Could not insert into composer',
		copied ? 'info' : 'error',
	);
}

export async function sendDemoCommandInChat(ctx, sessionId = null) {
	safeHaptic('tap');
	const cmd = '/apple-docs demo';
	try {
		safeNavigate('/');
		if (typeof host?.composer?.setDraft === 'function') {
			const ok = await host.composer.setDraft(sessionId ?? null, cmd);
			if (ok) {
				safeNotify(
					'Loaded `/apple-docs demo` in composer — press Enter to run!',
					'success',
				);
				return;
			}
		}
	} catch {
		// Fallback to clipboard
	}
	const copied = await safeWriteClipboard(ctx, cmd);
	safeNotify(
		copied
			? 'Copied `/apple-docs demo` to clipboard — paste in any chat!'
			: 'Could not copy `/apple-docs demo`',
		copied ? 'info' : 'error',
	);
}
