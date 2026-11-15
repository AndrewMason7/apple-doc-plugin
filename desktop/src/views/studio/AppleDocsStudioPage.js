import { useEffect, useMemo, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
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
	Separator,
	StatusDot,
	Tabs,
	TabsList,
	TabsTrigger,
	Textarea,
	Tip,
	useMutation,
	usePluginI18n,
	useQuery,
} from '@hermes/plugin-sdk';
import {
	PLUGIN_ID,
	STUDIO_ROUTE,
	TOP_FRAMEWORK_PILLS,
} from '../../data/constants.js';
import {
	FALLBACK_STATS,
	FALLBACK_SYMBOLS,
	FALLBACK_IDIOMS,
	COMPILER_PRESETS,
} from '../../data/fallbacks.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { GlyphSpinner } from '../../components/GlyphSpinner.js';
import { SymbolInspectorDetail } from '../../components/SymbolInspectorDetail.js';
import {
	fetchPluginStatus,
	fetchPluginIdioms,
	fetchPluginSearch,
	fetchPluginDoc,
	runPluginDiagnose,
	localDiagnoseFallback,
} from '../../services/search-service.js';
import {
	safeHaptic,
	safeNavigate,
	safeOpenExternal,
	safeOpenPane,
	safeNotify,
	insertIntoChatComposer,
	sendDemoCommandInChat,
} from '../../services/host-bridge.js';

export function AppleDocsStudioPage({ ctx }) {
	const [activeTab, setActiveTab] = useState('explorer');

	const [query, setQuery] = useState('');
	const [frameworkFilter, setFrameworkFilter] = useState('');
	const [searchMode, setSearchMode] = useState('semantic');
	const [selectedSymbol, setSelectedSymbol] = useState(null);

	const [ecoFilter, setEcoFilter] = useState('all');
	const [compilerLog, setCompilerLog] = useState(COMPILER_PRESETS[0].log);

	const debouncedQuery = useDebouncedValue(query, 160);
	const hasQuery = Boolean(debouncedQuery.trim() || frameworkFilter);

	const statusQuery = useQuery({
		queryKey: [PLUGIN_ID, 'status'],
		queryFn: () => fetchPluginStatus(ctx),
		staleTime: 30_000,
	});
	const idiomsQuery = useQuery({
		queryKey: [PLUGIN_ID, 'idioms'],
		queryFn: () => fetchPluginIdioms(ctx),
		staleTime: 60_000,
	});
	const searchQuery = useQuery({
		queryKey: [
			PLUGIN_ID,
			'search',
			debouncedQuery,
			frameworkFilter,
			searchMode,
			25,
		],
		queryFn: () =>
			fetchPluginSearch(ctx, {
				q: debouncedQuery,
				framework: frameworkFilter,
				mode: searchMode,
				limit: 25,
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
	const diagnoseMutation = useMutation({
		mutationFn: (textToAnalyze) => runPluginDiagnose(ctx, textToAnalyze),
	});

	const stats = statusQuery.data?.stats || FALLBACK_STATS;
	const idioms = idiomsQuery.data || FALLBACK_IDIOMS;
	const searchResult = useMemo(
		() =>
			hasQuery
				? searchQuery.data?.data ||
					localSearchFallback(debouncedQuery, frameworkFilter)
				: { results: [], latencyMs: 0 },
		[hasQuery, searchQuery.data, debouncedQuery, frameworkFilter],
	);
	const searching = searchQuery.isFetching;
	const liveDoc = docQuery.data || null;
	const loadingDoc = docQuery.isFetching;
	const apiLive = Boolean(
		statusQuery.data?.apiLive ||
		searchQuery.data?.apiLive ||
		diagnoseMutation.data?.apiLive,
	);
	const diagResult = useMemo(
		() =>
			diagnoseMutation.data?.result ||
			localDiagnoseFallback(COMPILER_PRESETS[0].log),
		[diagnoseMutation.data],
	);
	const diagnosing = diagnoseMutation.isPending;

	useEffect(() => {
		const results = searchResult?.results || [];
		if (results.length === 0) {
			return;
		}
		setSelectedSymbol((prev) => {
			if (prev && results.some((r) => r.path === prev.path)) {
				return prev;
			}
			return results[0];
		});
	}, [searchResult]);

	const runCompilerDiagnosis = (textToAnalyze) => {
		diagnoseMutation.mutate(textToAnalyze);
	};

	const filteredIdioms = useMemo(() => {
		if (ecoFilter === 'all') return idioms;
		return idioms.filter((i) => i.ecosystem === ecoFilter);
	}, [idioms, ecoFilter]);

	return jsxs('div', {
		className: 'h-full w-full flex flex-col overflow-hidden',
		children: [
			jsxs('div', {
				className:
					'px-6 py-4 border-b border-(--ui-stroke-secondary) flex items-center justify-between gap-4 flex-wrap shrink-0',
				children: [
					jsxs('div', {
						className: 'flex items-center gap-3 min-w-0',
						children: [
							jsx(Codicon, {
								name: 'book',
								className: 'text-(--ui-accent) text-lg shrink-0',
							}),
							jsxs('div', {
								className: 'min-w-0',
								children: [
									jsxs('div', {
										className: 'flex items-center gap-2',
										children: [
											jsx('h1', {
												className:
													'text-base font-semibold text-(--ui-text-primary) truncate',
												children: 'Apple Developer Documentation',
											}),
											jsxs('span', {
												className:
													'inline-flex items-center gap-1.5 text-[11px] text-(--ui-text-tertiary) shrink-0',
												children: [
													jsx(StatusDot, {
														tone: apiLive ? 'success' : 'neutral',
													}),
													apiLive
														? `${(stats.symbolCount || 95899).toLocaleString()} live`
														: 'Offline index',
												],
											}),
										],
									}),
								],
							}),
						],
					}),
					jsxs('div', {
						className: 'flex items-center gap-3 flex-wrap',
						children: [
							jsx(Tabs, {
								value: activeTab,
								onValueChange: (val) => {
									haptic('tap');
									setActiveTab(val);
								},
								children: jsxs(TabsList, {
									children: [
										jsx(TabsTrigger, {
											value: 'explorer',
											children: 'Explorer',
										}),
										jsx(TabsTrigger, {
											value: 'idioms',
											children: 'Idioms',
										}),
										jsx(TabsTrigger, {
											value: 'compiler',
											children: 'Xcode Hook',
										}),
										jsx(TabsTrigger, {
											value: 'frameworks',
											children: 'Frameworks',
										}),
									],
								}),
							}),
							jsx(Button, {
								size: 'sm',
								variant: 'ghost',
								onClick: () => {
									safeOpenPane('inspector-pane');
									safeNavigate('/');
								},
								children: 'Side Pane',
							}),
							jsx(Button, {
								size: 'sm',
								variant: 'ghost',
								onClick: () => safeNavigate('/'),
								children: '← Chat',
							}),
						],
					}),
				],
			}),

			activeTab === 'explorer'
				? jsxs('div', {
						className: 'flex-1 min-h-0 flex flex-col',
						children: [
							jsxs('div', {
								className:
									'px-6 py-3 border-b border-(--ui-stroke-secondary) flex flex-col gap-2.5 shrink-0',
								children: [
									jsxs('div', {
										className: 'flex items-center gap-2.5 flex-wrap',
										children: [
											jsx('div', {
												className: 'flex-1 min-w-[240px]',
												children: jsx(SearchField, {
													value: query,
													onChange: (e) =>
														setQuery(
															typeof e === 'string'
																? e
																: (e?.target?.value ?? ''),
														),
													placeholder:
														'Search Apple symbols, wildcards (Grid*), or React idioms…',
												}),
											}),
											jsxs(Select, {
												value: frameworkFilter || '__all__',
												onValueChange: (val) =>
													setFrameworkFilter(val === '__all__' ? '' : val),
												children: [
													jsx(SelectTrigger, {
														size: 'sm',
														className: 'w-[170px]',
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
											jsx('span', {
												className:
													'text-[11px] font-mono text-(--ui-text-tertiary)',
												children: searching
													? 'Searching…'
													: `${(searchResult.results || []).length} hits · ${searchResult.latencyMs ?? 1.5} ms`,
											}),
										],
									}),
									searchResult.expansion &&
									Array.isArray(searchResult.expansion.matchedIdioms) &&
									searchResult.expansion.matchedIdioms.length > 0
										? jsxs('div', {
												className:
													'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/40 px-3 py-2 text-xs flex items-center gap-2 flex-wrap',
												children: [
													jsx(Codicon, {
														name: 'sparkle',
														className: 'text-(--ui-accent)',
													}),
													jsx('span', {
														className: 'font-medium text-(--ui-text-primary)',
														children: `Idiom Expansion (${searchResult.expansion.matchedIdioms[0].ecosystem} → Apple):`,
													}),
													jsx('span', {
														className: 'text-(--ui-text-secondary)',
														children:
															searchResult.expansion.matchedIdioms[0]
																.description,
													}),
												],
											})
										: null,
								],
							}),

							jsxs('div', {
								className: 'flex-1 min-h-0 grid grid-cols-12',
								children: [
									jsx('div', {
										className:
											'col-span-5 border-r border-(--ui-stroke-secondary) min-h-0',
										children: jsx(ScrollArea, {
											className: 'h-full',
											children: jsxs('div', {
												className: 'p-2 flex flex-col gap-1',
												children: [
													(searchResult.results || []).length === 0 &&
													!searching
														? jsx(EmptyState, {
																title: hasQuery
																	? 'No matching symbols'
																	: 'Search Apple Docs',
																description: hasQuery
																	? 'Try a broader query or reset the framework filter.'
																	: 'Type a symbol name, wildcard (Grid*), or pick a framework.',
															})
														: null,
													...(searchResult.results || []).map((item) => {
														const selected =
															selectedSymbol &&
															selectedSymbol.path === item.path;
														return jsx(
															RowButton,
															{
																onClick: () => setSelectedSymbol(item),
																className: selected
																	? 'w-full text-left px-3 py-2.5 rounded-lg bg-(--ui-control-hover-background) border border-(--ui-stroke-secondary) flex flex-col gap-1 cursor-pointer'
																	: 'w-full text-left px-3 py-2.5 rounded-lg hover:bg-(--ui-control-hover-background)/60 border border-transparent flex flex-col gap-1 cursor-pointer',
																children: jsxs(Fragment, {
																	children: [
																		jsxs('div', {
																			className:
																				'flex items-center justify-between gap-2',
																			children: [
																				jsx('span', {
																					className:
																						'font-mono text-xs font-medium text-(--ui-text-primary) truncate',
																					children: item.title,
																				}),
																				jsx('span', {
																					className:
																						'text-[10px] px-1.5 py-0.5 rounded bg-(--ui-bg-input)/60 text-(--ui-text-tertiary) shrink-0',
																					children: item.framework,
																				}),
																			],
																		}),
																		item.abstract
																			? jsx('p', {
																					className:
																						'text-[11px] text-(--ui-text-tertiary) line-clamp-2',
																					children: item.abstract,
																				})
																			: null,
																	],
																}),
															},
															item.id || item.path,
														);
													}),
												],
											}),
										}),
									}),
									jsx('div', {
										className: 'col-span-7 min-h-0',
										children: jsx(SymbolInspectorDetail, {
											ctx,
											item: selectedSymbol,
											liveDoc,
											loadingDoc,
										}),
									}),
								],
							}),
						],
					})
				: null,

			activeTab === 'idioms'
				? jsx(ScrollArea, {
						className: 'flex-1 min-h-0',
						children: jsxs('div', {
							className: 'p-6 flex flex-col gap-4',
							children: [
								jsxs('div', {
									className:
										'flex items-center justify-between gap-3 flex-wrap',
									children: [
										jsxs('div', {
											children: [
												jsx('h2', {
													className:
														'text-sm font-semibold text-(--ui-text-primary)',
													children: 'Cross-Framework Idiom Rosetta Stone',
												}),
												jsx('p', {
													className: 'text-xs text-(--ui-text-tertiary)',
													children:
														'Click any React, Web CSS, or Android/Kotlin concept to inspect its verified Swift 6 / SwiftUI equivalent in the 95.9k symbol index.',
												}),
											],
										}),
										jsx(SegmentedControl, {
											value: ecoFilter,
											onValueChange: setEcoFilter,
											options: [
												{ value: 'all', label: 'All Ecosystems' },
												{ value: 'react', label: 'React' },
												{ value: 'web', label: 'Web / CSS' },
												{ value: 'android', label: 'Android / Kotlin' },
											],
										}),
									],
								}),
								jsxs('div', {
									className: 'grid grid-cols-1 md:grid-cols-2 gap-3',
									children: filteredIdioms.map((entry) =>
										jsxs(
											'div',
											{
												className:
													'rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/25 p-4 flex flex-col gap-2.5',
												children: [
													jsxs('div', {
														className:
															'flex items-center justify-between gap-2',
														children: [
															jsxs('div', {
																className: 'flex items-center gap-2',
																children: [
																	jsx(Badge, {
																		variant: 'muted',
																		children: entry.ecosystem,
																	}),
																	jsx('span', {
																		className:
																			'font-mono text-sm font-semibold text-(--ui-text-primary)',
																		children: entry.idiom,
																	}),
																],
															}),
															jsx(Button, {
																size: 'sm',
																variant: 'ghost',
																onClick: () => {
																	setQuery(entry.idiom);
																	setSearchMode('semantic');
																	setFrameworkFilter('');
																	setActiveTab('explorer');
																},
																children: 'Explore in Index →',
															}),
														],
													}),
													jsx('p', {
														className: 'text-xs text-(--ui-text-secondary)',
														children: entry.description,
													}),
													jsxs('div', {
														className: 'flex items-center gap-1.5 flex-wrap',
														children: (entry.appleSymbols || []).map((sym) =>
															jsx(
																'button',
																{
																	type: 'button',
																	onClick: () => {
																		setQuery(
																			sym.replace(/^@/, '').split('(')[0],
																		);
																		setFrameworkFilter('');
																		setActiveTab('explorer');
																	},
																	className:
																		'px-2 py-0.5 rounded font-mono text-[11px] border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/50 text-(--ui-accent) hover:bg-(--ui-control-hover-background) cursor-pointer',
																	children: sym,
																},
																sym,
															),
														),
													}),
													entry.snippet
														? jsx('pre', {
																className:
																	'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/50 p-2.5 text-[11px] font-mono text-(--ui-text-primary) overflow-x-auto',
																children: entry.snippet,
															})
														: null,
												],
											},
											entry.idiom,
										),
									),
								}),
							],
						}),
					})
				: null,

			activeTab === 'compiler'
				? jsx(ScrollArea, {
						className: 'flex-1 min-h-0',
						children: jsxs('div', {
							className: 'p-6 flex flex-col gap-4',
							children: [
								jsxs('div', {
									className:
										'flex items-center justify-between gap-3 flex-wrap',
									children: [
										jsxs('div', {
											children: [
												jsx('h2', {
													className:
														'text-sm font-semibold text-(--ui-text-primary)',
													children:
														'Automatic Swift & Xcode Compiler Grounding Hook (`transform_terminal_output`)',
												}),
												jsx('p', {
													className: 'text-xs text-(--ui-text-tertiary)',
													children:
														'Whenever Hermes runs a failing `swift build`, `swift test`, `swiftc`, or `xcodebuild` command, our lifecycle hook extracts deprecated/missing APIs and injects verified DocC replacements in <4ms.',
												}),
											],
										}),
										jsxs('div', {
											className: 'flex items-center gap-1.5 flex-wrap',
											children: COMPILER_PRESETS.map((preset) =>
												jsx(
													Button,
													{
														size: 'sm',
														variant: 'ghost',
														onClick: () => {
															setCompilerLog(preset.log);
															runCompilerDiagnosis(preset.log);
														},
														children: preset.label,
													},
													preset.id,
												),
											),
										}),
									],
								}),
								jsxs('div', {
									className: 'flex flex-col gap-2',
									children: [
										jsx(Textarea, {
											rows: 5,
											value: compilerLog,
											onChange: (e) => setCompilerLog(e.target.value),
											className: 'font-mono text-xs',
										}),
										jsxs('div', {
											className: 'flex items-center justify-between',
											children: [
												jsx('span', {
													className:
														'text-[11px] text-(--ui-text-tertiary) font-mono',
													children: `Analyzed in ${diagResult.latencyMs ?? 1.8} ms · ${(diagResult.findings || []).length} DocC replacement(s) grounded`,
												}),
												jsx(Button, {
													size: 'sm',
													variant: 'muted',
													onClick: () => runCompilerDiagnosis(compilerLog),
													children: diagnosing
														? 'Analyzing…'
														: 'Ground Compiler Output',
												}),
											],
										}),
									],
								}),
								jsxs('div', {
									className: 'flex flex-col gap-3',
									children: (diagResult.findings || []).map((f) =>
										jsxs(
											'div',
											{
												className:
													'rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/30 p-4 flex flex-col gap-2',
												children: [
													jsxs('div', {
														className:
															'flex items-center justify-between gap-2 flex-wrap',
														children: [
															jsxs('div', {
																className: 'flex items-center gap-2',
																children: [
																	jsx('span', {
																		className:
																			'font-mono text-xs line-through text-(--ui-text-tertiary)',
																		children: f.symbol,
																	}),
																	jsx('span', {
																		className:
																			'text-xs text-(--ui-text-tertiary)',
																		children: '→',
																	}),
																	jsx('span', {
																		className:
																			'font-mono text-xs font-semibold text-(--ui-accent)',
																		children: f.replacement,
																	}),
																	jsx(Badge, {
																		variant: 'muted',
																		children: f.framework,
																	}),
																],
															}),
															jsx(Button, {
																size: 'sm',
																variant: 'ghost',
																onClick: () => {
																	setQuery(
																		f.replacement
																			.split('/')[0]
																			.replace(/^@/, '')
																			.split('(')[0]
																			.trim(),
																	);
																	setFrameworkFilter(f.framework);
																	setActiveTab('explorer');
																},
																children: `Inspect ${f.docPath}`,
															}),
														],
													}),
													jsx('p', {
														className: 'text-xs text-(--ui-text-secondary)',
														children: f.reason,
													}),
													f.fixSnippet
														? jsx('pre', {
																className:
																	'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/50 p-2.5 text-[11px] font-mono text-(--ui-text-primary) overflow-x-auto',
																children: f.fixSnippet,
															})
														: null,
												],
											},
											f.symbol,
										),
									),
								}),
							],
						}),
					})
				: null,

			activeTab === 'frameworks'
				? jsx(ScrollArea, {
						className: 'flex-1 min-h-0',
						children: jsxs('div', {
							className: 'p-6 flex flex-col gap-4',
							children: [
								jsxs('div', {
									className: 'grid grid-cols-2 md:grid-cols-4 gap-3',
									children: [
										{
											label: 'Offline Symbols',
											val: (stats.symbolCount || 95899).toLocaleString(),
										},
										{
											label: 'Apple Frameworks',
											val: String(stats.frameworkCount || 30),
										},
										{
											label: 'Cross-Framework Idioms',
											val: String(stats.idiomCount || 16),
										},
										{
											label: 'FTS5 Query Speed',
											val: `${stats.latencyMs || 2.8} ms`,
										},
									].map((kpi) =>
										jsxs(
											'div',
											{
												className:
													'rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-input)/30 p-4 flex flex-col gap-1',
												children: [
													jsx('span', {
														className:
															'text-lg font-bold font-mono text-(--ui-text-primary)',
														children: kpi.val,
													}),
													jsx('span', {
														className:
															'text-[11px] uppercase tracking-wider text-(--ui-text-tertiary)',
														children: kpi.label,
													}),
												],
											},
											kpi.label,
										),
									),
								}),
								jsx(Separator, {}),
								jsxs('div', {
									className:
										'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5',
									children: (stats.frameworks || FALLBACK_STATS.frameworks).map(
										(fw) => {
											const maxCount =
												stats.frameworks?.[0]?.symbolCount || 20000;
											const pct = Math.max(
												4,
												Math.min(
													100,
													Math.round((fw.symbolCount / maxCount) * 100),
												),
											);
											return jsx(
												RowButton,
												{
													onClick: () => {
														setFrameworkFilter(fw.name);
														setQuery('*');
														setSearchMode('lexical');
														setActiveTab('explorer');
													},
													className:
														'rounded-lg border border-(--ui-stroke-secondary) p-3 hover:bg-(--ui-control-hover-background) flex flex-col gap-1.5 text-left cursor-pointer',
													children: jsxs(Fragment, {
														children: [
															jsxs('div', {
																className:
																	'flex items-center justify-between text-xs',
																children: [
																	jsx('span', {
																		className:
																			'font-semibold text-(--ui-text-primary)',
																		children: fw.name,
																	}),
																	jsx('span', {
																		className:
																			'font-mono text-[11px] text-(--ui-text-tertiary)',
																		children: `${fw.symbolCount.toLocaleString()} symbols`,
																	}),
																],
															}),
															jsx('div', {
																className:
																	'h-1.5 w-full rounded-full bg-(--ui-bg-input) overflow-hidden',
																children: jsx('div', {
																	className:
																		'h-full rounded-full bg-(--ui-accent)',
																	style: { width: `${pct}%` },
																}),
															}),
														],
													}),
												},
												fw.name,
											);
										},
									),
								}),
							],
						}),
					})
				: null,
		],
	});
}
