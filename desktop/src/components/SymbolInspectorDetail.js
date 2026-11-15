import {
	Badge,
	Button,
	Codicon,
	CopyButton,
	ScrollArea,
} from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import { GlyphSpinner } from './GlyphSpinner.js';
import {
	insertIntoChatComposer,
	safeOpenExternal,
} from '../services/host-bridge.js';

export function SymbolInspectorDetail({ ctx, item, liveDoc, loadingDoc }) {
	if (!item) {
		return jsx('div', {
			className:
				'h-full flex items-center justify-center p-8 text-xs text-(--ui-text-tertiary)',
			children:
				'Select any Apple SDK symbol on the left to inspect its Swift 6 declaration, availability, and DocC metadata.',
		});
	}

	const doc =
		liveDoc && liveDoc.ok && liveDoc.path === item.path ? liveDoc : item;
	const platforms = doc.platforms || item.platforms || [];
	const declaration = doc.declaration || item.declaration || '';
	const bareName = (doc.title || item.title || '')
		.split('(')[0]
		.replace(/^func\s+|^static\s+func\s+|^var\s+|^@/, '')
		.trim();
	const atToken = `@apple:${doc.framework}/${bareName}`;
	const docCall = `get_documentation({ "path": "${doc.path}", "framework": "${doc.framework}" })`;

	return jsx(ScrollArea, {
		className: 'h-full',
		children: jsxs('div', {
			className: 'p-5 flex flex-col gap-4',
			children: [
				jsxs('div', {
					className: 'flex items-start justify-between gap-3 flex-wrap',
					children: [
						jsxs('div', {
							className: 'flex flex-col gap-1 min-w-0',
							children: [
								jsxs('div', {
									className: 'flex items-center gap-2 flex-wrap',
									children: [
										jsx(Badge, {
											variant: 'muted',
											children: doc.framework,
										}),
										jsx('span', {
											className:
												'text-[11px] uppercase tracking-wider text-(--ui-text-tertiary)',
											children: doc.kind,
										}),
										doc.source
											? jsx('span', {
													className:
														'text-[10px] px-1.5 py-0.5 rounded border border-(--ui-stroke-secondary) text-(--ui-text-tertiary)',
													children: doc.source,
												})
											: null,
										loadingDoc ? jsx(GlyphSpinner, {}) : null,
									],
								}),
								jsx('h2', {
									className:
										'text-base font-semibold font-mono text-(--ui-text-primary) break-all mt-1',
									children: doc.title,
								}),
								jsx('span', {
									className:
										'text-[11px] font-mono text-(--ui-text-tertiary) break-all',
									children: doc.path,
								}),
							],
						}),
						jsxs('div', {
							className: 'flex items-center gap-1.5 flex-wrap',
							children: [
								jsx(Button, {
									size: 'sm',
									variant: 'muted',
									onClick: () => insertIntoChatComposer(ctx, atToken, true),
									children: `Insert ${atToken}`,
								}),
								jsx(CopyButton, { value: docCall }),
								jsx(Button, {
									size: 'sm',
									variant: 'ghost',
									onClick: () =>
										safeOpenExternal(
											ctx,
											doc.webUrl || `https://developer.apple.com${doc.path}`,
										),
									children: 'developer.apple.com ↗',
								}),
							],
						}),
					],
				}),

				platforms.length
					? jsxs('div', {
							className: 'flex items-center gap-1.5 flex-wrap',
							children: platforms.map((p) =>
								jsx('span', {
									key: p,
									className:
										'text-[11px] px-2 py-0.5 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/40 text-(--ui-text-secondary)',
									children: p,
								}),
							),
						})
					: null,

				doc.deprecation
					? jsxs('div', {
							className:
								'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/60 p-3 text-xs text-(--ui-text-primary)',
							children: [
								jsx('div', {
									className: 'font-semibold mb-1',
									children: 'Deprecation Notice',
								}),
								jsx('div', {
									className: 'text-(--ui-text-secondary)',
									children: doc.deprecation,
								}),
							],
						})
					: null,

				doc.abstract
					? jsx('p', {
							className: 'text-sm leading-relaxed text-(--ui-text-secondary)',
							children: doc.abstract,
						})
					: null,

				declaration
					? jsxs('div', {
							className: 'flex flex-col gap-1.5',
							children: [
								jsxs('div', {
									className: 'flex items-center justify-between',
									children: [
										jsx('span', {
											className:
												'text-[11px] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
											children: 'Swift Declaration',
										}),
										jsx(CopyButton, { value: declaration }),
									],
								}),
								jsx('pre', {
									className:
										'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/50 p-3 text-xs font-mono text-(--ui-text-primary) overflow-x-auto whitespace-pre-wrap',
									children: declaration,
								}),
							],
						})
					: null,

				Array.isArray(doc.parameters) && doc.parameters.length
					? jsxs('div', {
							className: 'flex flex-col gap-1.5',
							children: [
								jsx('span', {
									className:
										'text-[11px] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
									children: 'Parameters',
								}),
								jsxs('div', {
									className:
										'flex flex-col gap-1 text-xs text-(--ui-text-secondary)',
									children: doc.parameters.map((paramLine, idx) =>
										jsx('div', {
											key: idx,
											className:
												'rounded-md bg-(--ui-bg-input)/30 px-3 py-2 font-mono text-[11px]',
											children: paramLine,
										}),
									),
								}),
							],
						})
					: null,

				Array.isArray(doc.topics) && doc.topics.length
					? jsxs('div', {
							className: 'flex flex-col gap-2 pt-1',
							children: [
								jsx('span', {
									className:
										'text-[11px] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
									children: 'Related DocC Topics',
								}),
								...doc.topics.slice(0, 3).map((sec) =>
									jsxs(
										'div',
										{
											className:
												'rounded-lg border border-(--ui-stroke-secondary) p-3 flex flex-col gap-1',
											children: [
												jsx('div', {
													className:
														'text-xs font-semibold text-(--ui-text-primary)',
													children: sec.title,
												}),
												...(sec.items || []).map((it) =>
													jsxs(
														'div',
														{
															className:
																'text-[11px] text-(--ui-text-secondary)',
															children: [
																jsx('span', {
																	className:
																		'font-mono text-(--ui-text-primary)',
																	children: it.title,
																}),
																it.abstract ? ` — ${it.abstract}` : '',
															],
														},
														it.url || it.title,
													),
												),
											],
										},
										sec.title,
									),
								),
							],
						})
					: null,
			],
		}),
	});
}
