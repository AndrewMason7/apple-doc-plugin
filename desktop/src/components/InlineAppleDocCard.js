import { Badge, Button, Codicon, CopyButton } from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import { STUDIO_ROUTE } from '../data/constants.js';
import {
	safeOpenExternal,
	safeOpenPane,
	safeNavigate,
} from '../services/host-bridge.js';

export function InlineAppleDocCard({ ctx, attrs }) {
	const safeAttrs = attrs && typeof attrs === 'object' ? attrs : {};
	const rawTitle = safeAttrs.title ?? safeAttrs.symbol;
	const title =
		typeof rawTitle === 'string' && rawTitle.trim()
			? rawTitle.trim()
			: 'Apple SDK Symbol';
	const framework =
		typeof safeAttrs.framework === 'string' && safeAttrs.framework.trim()
			? safeAttrs.framework.trim()
			: 'SwiftUI';
	const kind =
		typeof safeAttrs.kind === 'string' && safeAttrs.kind.trim()
			? safeAttrs.kind.trim()
			: 'symbol';
	const rawPath = safeAttrs.path;
	const path =
		typeof rawPath === 'string' && rawPath.trim()
			? rawPath.trim().replace(/^doc:\/\/[^/]+/, '')
			: `/documentation/${framework.toLowerCase()}`;
	const summary =
		typeof safeAttrs.summary === 'string'
			? safeAttrs.summary
			: typeof safeAttrs.abstract === 'string'
				? safeAttrs.abstract
				: '';
	const platforms = Array.isArray(safeAttrs.platforms)
		? safeAttrs.platforms.map((p) => String(p).trim()).filter(Boolean)
		: typeof safeAttrs.platforms === 'string'
			? safeAttrs.platforms
					.split(',')
					.map((p) => p.trim())
					.filter(Boolean)
			: [];
	const webUrl = `https://developer.apple.com${path.startsWith('/') ? path : '/' + path}`;
	const cleanRef = `@apple:${framework}/${title
		.split('(')[0]
		.replace(/^func\s+|^var\s+|^@/, '')
		.trim()}`;

	return jsxs('div', {
		className:
			'my-2 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-surface-secondary)/50 px-4 py-3 flex flex-col gap-2',
		children: [
			jsxs('div', {
				className: 'flex items-center justify-between gap-2 flex-wrap',
				children: [
					jsxs('div', {
						className: 'flex items-center gap-2 min-w-0',
						children: [
							jsx(Codicon, {
								name: 'book',
								className: 'text-(--ui-accent) shrink-0',
							}),
							jsx('span', {
								className:
									'font-mono text-xs font-semibold text-(--ui-text-primary) break-all',
								children: title,
							}),
							jsx(Badge, { variant: 'muted', children: framework }),
							jsx('span', {
								className:
									'text-[11px] uppercase tracking-wider text-(--ui-text-tertiary)',
								children: kind,
							}),
						],
					}),
					jsxs('div', {
						className: 'flex items-center gap-1.5 shrink-0',
						children: [
							jsx(Button, {
								size: 'sm',
								variant: 'ghost',
								onClick: () =>
									insertIntoChatComposer(ctx, cleanRef, false, sessionId),
								children: 'Cite @apple:',
							}),
							jsx(Button, {
								size: 'sm',
								variant: 'ghost',
								onClick: () => {
									safeHaptic('tap');
									safeNavigate(STUDIO_ROUTE);
								},
								children: 'Open Studio',
							}),
							jsx(Button, {
								size: 'sm',
								variant: 'ghost',
								onClick: () => safeOpenExternal(ctx, webUrl),
								children: 'Apple Docs ↗',
							}),
						],
					}),
				],
			}),
			summary
				? jsx('p', {
						className: 'text-xs leading-relaxed text-(--ui-text-secondary)',
						children: summary,
					})
				: null,
			platforms.length
				? jsxs('div', {
						className: 'flex items-center gap-1.5 flex-wrap pt-0.5',
						children: platforms.slice(0, 6).map((p) =>
							jsx('span', {
								key: p,
								className:
									'text-[10px] px-1.5 py-0.5 rounded border border-(--ui-stroke-secondary) text-(--ui-text-tertiary)',
								children: p,
							}),
						),
					})
				: null,
		],
	});
}
