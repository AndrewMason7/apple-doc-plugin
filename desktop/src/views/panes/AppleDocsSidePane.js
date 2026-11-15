import { useMemo, useState } from 'react';
import {
	Badge,
	Button,
	Codicon,
	CopyButton,
	EmptyState,
	RowButton,
	ScrollArea,
	SearchField,
	SegmentedControl,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	StatusDot,
	Tip,
	usePluginI18n,
	useQuery,
} from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import {
	PLUGIN_ID,
	STUDIO_ROUTE,
	TOP_FRAMEWORK_PILLS,
} from '../../data/constants.js';
import { FALLBACK_SYMBOLS } from '../../data/fallbacks.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { GlyphSpinner } from '../../components/GlyphSpinner.js';
import { SymbolInspectorDetail } from '../../components/SymbolInspectorDetail.js';
import {
	fetchPluginSearch,
	fetchPluginDoc,
} from '../../services/search-service.js';
import {
	safeHaptic,
	safeNavigate,
	safeOpenExternal,
	insertIntoChatComposer,
} from '../../services/host-bridge.js';

export function AppleDocsSidePane({ ctx }) {
	const [q, setQ] = useState('');
	const [framework, setFramework] = useState('');
	const [searchMode, setSearchMode] = useState('semantic');
	const [selectedSymbol, setSelectedSymbol] = useState(null);

	const debouncedQ = useDebouncedValue(q, 180);
	const targetQ = debouncedQ.trim();
	const hasQuery = Boolean(targetQ || framework);

	const searchQuery = useQuery({
		queryKey: [PLUGIN_ID, 'search', targetQ, framework, searchMode, 15],
		queryFn: () =>
			fetchPluginSearch(ctx, {
				q: targetQ,
				framework,
				mode: searchMode,
				limit: 15,
			}),
		enabled: hasQuery,
		staleTime: 15_000,
		placeholderData: (prev) => prev,
	});
	const docQuery = useQuery({
		queryKey: [
			PLUGIN_ID,
			'doc',
			selectedSymbol?.path || '',
			selectedSymbol?.framework || '',
		],
		queryFn: () =>
			fetchPluginDoc(ctx, {
				path: selectedSymbol?.path,
				framework: selectedSymbol?.framework,
			}),
		enabled: Boolean(selectedSymbol && selectedSymbol.path),
		staleTime: 60_000,
	});

	const items = useMemo(
		() =>
			hasQuery
				? Array.isArray(searchQuery.data?.data?.results)
					? searchQuery.data.data.results
					: localSearchFallback(targetQ, framework).results
				: [],
		[hasQuery, searchQuery.data, targetQ, framework],
	);
	const searching = searchQuery.isFetching;
	const liveDoc = selectedSymbol ? docQuery.data || null : null;
	const loadingDoc = docQuery.isFetching;

	return jsxs('div', {
		className:
			'h-full w-full flex flex-col overflow-hidden bg-(--ui-surface-background) text-(--ui-text-primary)',
		children: [
			jsxs('div', {
				className:
					'px-3 py-2.5 border-b border-(--ui-stroke-secondary) flex items-center justify-between gap-2 shrink-0 bg-(--ui-surface-background)',
				children: [
					jsxs('div', {
						className: 'flex items-center gap-1.5 min-w-0',
						children: [
							jsx(Codicon, {
								name: 'book',
								className: 'text-(--ui-accent) text-sm shrink-0',
							}),
							jsx('span', {
								className: 'text-xs font-semibold truncate',
								children: ' Apple Docs',
							}),
						],
					}),
					jsx(Button, {
						size: 'xs',
						variant: 'ghost',
						title: 'Open in Full Studio Page',
						onClick: () => safeNavigate(STUDIO_ROUTE),
						children: 'Studio ↗',
					}),
				],
			}),

			selectedSymbol
				? jsxs('div', {
						className: 'flex-1 min-h-0 flex flex-col',
						children: [
							jsxs('div', {
								className:
									'px-2.5 py-1.5 border-b border-(--ui-stroke-secondary) flex items-center justify-between gap-2 shrink-0 bg-(--ui-surface-secondary)',
								children: [
									jsx(Button, {
										size: 'xs',
										variant: 'ghost',
										onClick: () => setSelectedSymbol(null),
										children: '← Results',
									}),
									jsx('span', {
										className:
											'text-[10px] font-mono text-(--ui-text-tertiary) truncate max-w-[180px]',
										children: selectedSymbol.title,
									}),
								],
							}),
							jsx('div', {
								className: 'flex-1 min-h-0',
								children: jsx(SymbolInspectorDetail, {
									ctx,
									item: selectedSymbol,
									liveDoc,
									loadingDoc,
								}),
							}),
						],
					})
				: jsxs('div', {
						className: 'flex-1 min-h-0 flex flex-col p-3 gap-2.5',
						children: [
							jsx(SearchField, {
								value: q,
								onChange: (e) =>
									setQ(typeof e === 'string' ? e : (e?.target?.value ?? '')),
								placeholder: 'Search symbols, Grid*, or React idiom…',
							}),
							jsxs('div', {
								className: 'flex items-center gap-2',
								children: [
									jsxs(Select, {
										value: framework || '__all__',
										onValueChange: (val) =>
											setFramework(val === '__all__' ? '' : val),
										children: [
											jsx(SelectTrigger, {
												size: 'sm',
												className: 'flex-1 min-w-0',
												children: jsx(SelectValue, {
													placeholder: 'All Frameworks',
												}),
											}),
											jsxs(SelectContent, {
												children: TOP_FRAMEWORK_PILLS.map((fw) =>
													jsx(
														SelectItem,
														{
															value: fw || '__all__',
															children: fw || 'All Frameworks',
														},
														fw || '__all__',
													),
												),
											}),
										],
									}),
									jsx(SegmentedControl, {
										value: searchMode,
										onChange: setSearchMode,
										options: [
											{ id: 'semantic', label: 'Hybrid' },
											{ id: 'lexical', label: 'FTS5' },
										],
									}),
								],
							}),
							jsx('div', {
								className: 'text-[10px] text-(--ui-text-tertiary)',
								children: searching ? 'Searching…' : `${items.length} results`,
							}),
							jsx(ScrollArea, {
								className: 'flex-1 min-h-0',
								children: items.length
									? jsxs('div', {
											className: 'flex flex-col gap-2 pr-1',
											children: items.map((it) => {
												const bare = (it.title || '')
													.split('(')[0]
													.replace(/^func\s+|^var\s+|^@/, '')
													.trim();
												const refToken = `@apple:${it.framework}/${bare}`;
												return jsxs(
													'div',
													{
														className:
															'rounded-lg border border-(--ui-stroke-secondary) p-2.5 flex flex-col gap-1.5 hover:bg-(--ui-control-hover-background)/50 transition-colors',
														children: [
															jsxs('div', {
																className:
																	'flex items-center justify-between gap-1.5 cursor-pointer',
																onClick: () => setSelectedSymbol(it),
																children: [
																	jsx('span', {
																		className:
																			'font-mono text-[11px] font-semibold text-(--ui-text-primary) truncate',
																		children: it.title,
																	}),
																	jsx(Badge, {
																		variant: 'muted',
																		className: 'text-[9px] shrink-0',
																		children: it.framework,
																	}),
																],
															}),
															it.abstract
																? jsx('p', {
																		className:
																			'text-[11px] text-(--ui-text-tertiary) line-clamp-2 cursor-pointer',
																		onClick: () => setSelectedSymbol(it),
																		children: it.abstract,
																	})
																: null,
															jsxs('div', {
																className:
																	'flex items-center justify-between gap-1 pt-1 border-t border-(--ui-stroke-secondary)/40',
																children: [
																	jsx(Button, {
																		size: 'xs',
																		variant: 'ghost',
																		onClick: () => setSelectedSymbol(it),
																		children: 'Docs →',
																	}),
																	jsx(Button, {
																		size: 'xs',
																		variant: 'ghost',
																		onClick: () =>
																			insertIntoChatComposer(
																				ctx,
																				refToken,
																				false,
																			),
																		children: 'Insert @apple:',
																	}),
																],
															}),
														],
													},
													it.id || it.path,
												);
											}),
										})
									: jsx(EmptyState, {
											title: hasQuery
												? 'No matching symbols'
												: 'Search Apple Docs',
											description: hasQuery
												? 'Try a broader query or switch framework.'
												: 'Type a symbol name, wildcard (Grid*), or React idiom.',
										}),
							}),
						],
					}),
		],
	});
}

const AppleDocsQuickPane = AppleDocsSidePane;
export { AppleDocsSidePane as AppleDocsQuickPane };
