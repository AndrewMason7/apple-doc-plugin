import type { ServerContext, ToolResponse } from '../context.js';
import type { Technology } from '../../apple-client.js';
import { header, bold } from '../markdown.js';
import { resolveSymbol } from '../services/symbol-resolution.js';

type QueryMode = 'exact-symbol' | 'wildcard' | 'keyword';

type SearchMatch = {
	abstract: string;
	kind: string;
	path: string;
	platforms: string[];
	score: number;
	source:
		| 'exact-resolution'
		| 'framework-references'
		| 'local-index'
		| 'fts'
		| 'semantic'
		| 'hybrid';
	title: string;
	type: 'article' | 'symbol';
	framework?: string;
	mediaUrl?: string;
	mediaType?: string;
};

const looksLikeExactSymbol = (query: string): boolean => {
	if (query.includes('*') || query.includes('?') || query.includes(' ')) {
		return false;
	}

	return (
		/^[A-Z][a-zA-Z\d]*(?:[./][A-Z][a-zA-Z\d]*)*$/.test(query) ||
		query.startsWith('documentation/')
	);
};

const getQueryMode = (query: string): QueryMode => {
	if (query.includes('*') || query.includes('?')) {
		return 'wildcard';
	}

	if (looksLikeExactSymbol(query)) {
		return 'exact-symbol';
	}

	return 'keyword';
};

const isArticleKind = (kind: string): boolean => {
	const normalizedKind = kind.toLowerCase();
	return (
		normalizedKind === 'article' ||
		normalizedKind === 'overview' ||
		normalizedKind === 'tutorial' ||
		normalizedKind === 'guide' ||
		normalizedKind === 'ui_preview'
	);
};

const KIND_ALIASES: Record<string, string[]> = {
	func: [
		'func',
		'method',
		'function',
		'typemethod',
		'instancemethod',
		'operator',
	],
	function: [
		'func',
		'method',
		'function',
		'typemethod',
		'instancemethod',
		'operator',
	],
	method: ['method', 'func', 'function', 'typemethod', 'instancemethod'],
	init: ['init', 'initializer', 'constructor'],
	initializer: ['init', 'initializer', 'constructor'],
	property: [
		'property',
		'var',
		'variable',
		'typeproperty',
		'instanceproperty',
		'associatedtype',
	],
	var: ['property', 'var', 'variable', 'typeproperty', 'instanceproperty'],
	type: ['struct', 'class', 'enum', 'protocol', 'typealias'],
	struct: ['struct', 'structure'],
	class: ['class'],
	protocol: ['protocol'],
	enum: ['enum', 'enumeration'],
	typealias: ['typealias'],
	modifier: ['method', 'func', 'viewmodifier'],
	article: ['article', 'overview', 'tutorial', 'guide', 'ui_preview'],
};

const formatMatch = (match: SearchMatch): string[] => {
	const platforms =
		match.platforms.length > 0 ? match.platforms.join(', ') : 'All platforms';
	const frameworkInfo = match.framework ? ` (${match.framework})` : '';
	const fwArg = match.framework ? `, "framework": "${match.framework}"` : '';
	const lines = [
		`### ${match.title}${frameworkInfo}`,
		`   • **Kind:** ${match.kind}`,
		`   • **Path:** \`${match.path}\``,
		`   • **Platforms:** ${platforms}`,
		`   • **Doc Call:** \`get_documentation({ "path": "${match.path}"${fwArg} })\``,
		...(match.abstract ? [`   ${match.abstract}`] : []),
	];

	if (match.mediaUrl) {
		lines.push(`   ![Visual Preview](${match.mediaUrl})`);
	}

	lines.push('');
	return lines;
};

const formatNoResults = (queryMode: QueryMode): string[] => {
	const lines = [
		'No matching symbols or related documentation were found for this query.',
		'',
		'**Search Tips:**',
	];

	if (queryMode === 'exact-symbol') {
		lines.push(
			'• Check the exact symbol spelling and casing',
			'• Try a wildcard query such as `Grid*` or `*Style`',
			'• Try a broader keyword such as `grid` or `button style`',
		);
	} else if (queryMode === 'wildcard') {
		lines.push(
			'• Keep `*` and `?` to symbol names or short prefixes',
			'• Try a broader wildcard such as `Lazy*` or `*Item`',
			'• Remove wildcards and retry as a keyword search',
		);
	} else {
		lines.push(
			'• Try an exact API name such as `ButtonStyle` or `GridItem`',
			'• Try a wildcard query such as `Grid*` or `*Style`',
			'• Try related terms or a shorter keyword',
		);
	}

	return lines;
};

export const buildSearchSymbolsHandler = (context: ServerContext) => {
	const { client, state, searchEngine } = context;

	return async (args: {
		framework?: string;
		maxResults?: number;
		platform?: string;
		query: string;
		symbolType?: string;
		preferSemantic?: boolean;
		lexicalOnly?: boolean;
	}): Promise<ToolResponse> => {
		const {
			query,
			maxResults = 20,
			platform,
			symbolType,
			preferSemantic,
			lexicalOnly,
		} = args;

		if (typeof query !== 'string' || query.trim().length === 0) {
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: 'Error: A non-empty "query" parameter is required.',
					},
				],
			};
		}

		const rawMaxResults =
			typeof maxResults === 'number' && Number.isFinite(maxResults)
				? Math.floor(maxResults)
				: 20;
		const clampedMaxResults = Math.min(Math.max(1, rawMaxResults), 100);

		const queryMode = getQueryMode(query);

		// Determine target framework: explicit param takes priority. Global search does NOT inherit sticky session state.
		const targetFramework =
			args.framework && args.framework.trim().length > 0
				? args.framework.trim()
				: undefined;

		// 1. If high-performance searchEngine (SQLite FTS5 + Gemini) is available, use it!
		if (searchEngine) {
			const results = await searchEngine.search(query, {
				framework: targetFramework,
				limit: clampedMaxResults * 2,
				preferSemantic,
				lexicalOnly,
			});

			let filtered = results;
			if (platform) {
				const lowerPlat = platform.toLowerCase();
				filtered = filtered.filter(
					(r) =>
						r.platforms.length === 0 ||
						r.platforms.some((p) => p.toLowerCase().includes(lowerPlat)),
				);
			}

			let kindNotice: string | undefined;
			if (symbolType) {
				const lowerKind = symbolType.toLowerCase().trim();
				const targetKinds = KIND_ALIASES[lowerKind] || [lowerKind];
				const kindFiltered = filtered.filter((r) =>
					targetKinds.includes(r.kind.toLowerCase()),
				);
				if (kindFiltered.length > 0) {
					filtered = kindFiltered;
				} else {
					kindNotice = `Filter "${symbolType}" matched 0 symbols; showing all kinds`;
				}
			}

			const topResults = filtered.slice(0, clampedMaxResults);

			if (topResults.length > 0) {
				let searchModeDesc: string;
				if (lexicalOnly) {
					searchModeDesc = 'Lexical only (SQLite FTS5)';
				} else if (preferSemantic) {
					const hasSemanticAuth = Boolean(
						searchEngine?.semanticSearch.hasAuth(),
					);
					const isCircuitOpen = Boolean(
						searchEngine?.semanticSearch.isCircuitOpen(),
					);
					const usedSemantic = results.some(
						(r) => r.source === 'hybrid' || r.source === 'semantic',
					);
					if (usedSemantic) {
						searchModeDesc = 'Hybrid (SQLite FTS5 + Gemini embeddings)';
					} else if (!hasSemanticAuth) {
						searchModeDesc =
							'Lexical fallback (No Gemini credentials configured; running offline FTS5)';
					} else if (isCircuitOpen) {
						searchModeDesc =
							'Lexical fallback (Gemini API circuit breaker is currently open)';
					} else {
						searchModeDesc = 'Lexical fallback (SQLite FTS5)';
					}
				} else {
					searchModeDesc = 'Hybrid / Lexical (SQLite FTS5)';
				}

				const lines: string[] = [
					header(1, `🔍 Search Results for "${query}"`),
					'',
					bold('Framework', targetFramework || 'All Apple Frameworks (Global)'),
					bold('Search Mode', searchModeDesc),
					bold('Query Mode', queryMode),
					bold('Matches Found', String(topResults.length)),
					...(kindNotice ? [bold('Kind Filter Note', kindNotice)] : []),
					'',
				];

				const symbolMatches = topResults.filter((r) => !isArticleKind(r.kind));
				const articleMatches = topResults.filter((r) => isArticleKind(r.kind));

				if (symbolMatches.length > 0) {
					lines.push(header(2, 'Symbols'), '');
					for (const sym of symbolMatches) {
						lines.push(
							...formatMatch({
								title: sym.title,
								framework: sym.framework,
								kind: sym.kind,
								path: sym.path,
								platforms: sym.platforms,
								abstract: sym.abstract,
								score: sym.score,
								source: sym.source,
								type: 'symbol',
								mediaUrl: sym.mediaUrl,
								mediaType: sym.mediaType,
							}),
						);
					}
				}

				if (articleMatches.length > 0) {
					lines.push(header(2, 'Articles & Guides'), '');
					for (const art of articleMatches) {
						lines.push(
							...formatMatch({
								title: art.title,
								framework: art.framework,
								kind: art.kind,
								path: art.path,
								platforms: art.platforms,
								abstract: art.abstract,
								score: art.score,
								source: art.source,
								type: 'article',
								mediaUrl: art.mediaUrl,
								mediaType: art.mediaType,
							}),
						);
					}
				}

				return {
					content: [{ text: lines.join('\n'), type: 'text' }],
				};
			}
		}

		// 2. Legacy fallback when searchEngine has no results or isn't initialized
		const fallbackNotice =
			preferSemantic && !searchEngine?.semanticSearch.hasAuth()
				? '*Note: Running in lexical fallback mode because no Gemini API credentials are configured.*'
				: preferSemantic && searchEngine?.semanticSearch.isCircuitOpen()
					? '*Note: Running in lexical fallback mode because Gemini API circuit breaker is currently open.*'
					: undefined;

		if (!targetFramework) {
			// If no technology is chosen and no searchEngine results, return clean suggestions
			const lines = [
				header(1, `🔍 No Results for "${query}"`),
				'',
				...(fallbackNotice ? [fallbackNotice, ''] : []),
				'No symbols found in the index for this query.',
				'',
				'**Suggestions:**',
				'• Try searching with an explicit framework: `search_symbols(query: "...", framework: "SwiftUI")`',
				'• Or discover technologies with `discover_technologies`',
			];
			return {
				content: [{ text: lines.join('\n'), type: 'text' }],
			};
		}

		// If a target framework was explicitly requested, try live DocC symbol resolution fallback
		const targetTech: Technology = {
			identifier: `doc://com.apple.documentation/documentation/${targetFramework}`,
			title: targetFramework,
			kind: 'symbol',
			role: 'collection',
			url: `/documentation/${targetFramework.toLowerCase()}`,
			abstract: [],
		};

		const exactMatchResponse = await tryExactSymbolMatch(
			client,
			targetTech,
			query,
			queryMode,
			platform,
			symbolType,
		);
		if (exactMatchResponse) {
			return exactMatchResponse;
		}

		return {
			content: [
				{
					text: [
						header(1, `🔍 Search Results for "${query}"`),
						'',
						bold('Framework', targetFramework || 'Unknown'),
						...(fallbackNotice ? ['', fallbackNotice] : []),
						'',
						...formatNoResults(queryMode),
					].join('\n'),
					type: 'text',
				},
			],
		};
	};
};

const tryExactSymbolMatch = async (
	client: ServerContext['client'],
	activeTechnology: Technology,
	query: string,
	queryMode: QueryMode,
	platform?: string,
	symbolType?: string,
): Promise<ToolResponse | undefined> => {
	if (queryMode !== 'exact-symbol') {
		return undefined;
	}

	try {
		const resolved = await resolveSymbol(client, activeTechnology, query);
		if (!resolved) {
			return undefined;
		}

		const { targetPath, data } = resolved;

		if (platform) {
			const platforms =
				data.metadata?.platforms?.map((item) => item.name).filter(Boolean) ??
				[];
			if (
				!platforms.some((item) =>
					item.toLowerCase().includes(platform.toLowerCase()),
				)
			) {
				return undefined;
			}
		}

		if (symbolType && data.metadata?.symbolKind) {
			if (data.metadata.symbolKind.toLowerCase() !== symbolType.toLowerCase()) {
				return undefined;
			}
		}

		return {
			content: [
				{
					text: [
						header(1, `🔍 Search Results for "${query}"`),
						'',
						bold('Technology', activeTechnology.title),
						bold('Query Mode', queryMode),
						bold('Search Source', 'exact-resolution'),
						bold('Symbol Matches', '1'),
						bold('Article Matches', '0'),
						'',
						header(2, 'Exact Match'),
						'',
						...formatMatch({
							abstract: client.extractText(data.abstract),
							kind: data.metadata?.symbolKind ?? 'symbol',
							path: targetPath,
							platforms:
								data.metadata?.platforms
									?.map((item) => item.name)
									.filter(Boolean) ?? [],
							score: 1000,
							source: 'exact-resolution',
							title: data.metadata?.title ?? query,
							type: 'symbol',
							framework: activeTechnology.title,
						}),
					].join('\n'),
					type: 'text',
				},
			],
		};
	} catch {
		return undefined;
	}
};
