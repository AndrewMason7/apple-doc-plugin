import type { ServerContext, ToolResponse } from '../context.js';
import type { Technology } from '../../apple-client.js';
import { type LocalSymbolIndexEntry } from '../services/local-symbol-index.js';
import { header, bold } from '../markdown.js';
import { resolveSymbol } from '../services/symbol-resolution.js';
import { buildNoTechnologyMessage } from './no-technology.js';

type QueryMode = 'exact-symbol' | 'wildcard' | 'keyword';

type SearchMatch = {
	abstract: string;
	kind: string;
	path: string;
	platforms: string[];
	score: number;
	source: 'exact-resolution' | 'framework-references' | 'local-index' | 'fts' | 'semantic' | 'hybrid';
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

const formatMatch = (match: SearchMatch): string[] => {
	const platforms =
		match.platforms.length > 0 ? match.platforms.join(', ') : 'All platforms';
	const frameworkInfo = match.framework ? ` (${match.framework})` : '';
	const lines = [
		`### ${match.title}${frameworkInfo}`,
		`   • **Kind:** ${match.kind}`,
		`   • **Path:** ${match.path}`,
		`   • **Platforms:** ${platforms}`,
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
	const noTechnology = buildNoTechnologyMessage(context);

	return async (args: {
		framework?: string;
		maxResults?: number;
		platform?: string;
		query: string;
		symbolType?: string;
	}): Promise<ToolResponse> => {
		const { query, maxResults = 20, platform, symbolType } = args;
		const queryMode = getQueryMode(query);
		const activeTechnology = state.getActiveTechnology();

		// Determine target framework: explicit param takes priority, then active state
		const targetFramework = args.framework || activeTechnology?.title || undefined;

		// 1. If high-performance searchEngine (SQLite FTS5 + Gemini) is available, use it!
		if (searchEngine) {
			const results = await searchEngine.search(query, {
				framework: targetFramework,
				limit: maxResults * 2,
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

			if (symbolType) {
				const lowerKind = symbolType.toLowerCase();
				filtered = filtered.filter((r) => r.kind.toLowerCase() === lowerKind);
			}

			const topResults = filtered.slice(0, maxResults);

			if (topResults.length > 0) {
				const lines: string[] = [
					header(1, `🔍 Search Results for "${query}"`),
					'',
					bold('Framework', targetFramework || 'All Apple Frameworks (Global)'),
					bold('Query Mode', queryMode),
					bold('Matches Found', String(topResults.length)),
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
		if (!activeTechnology && !targetFramework) {
			// If no technology is chosen and no searchEngine results, return clean suggestions
			const lines = [
				header(1, `🔍 No Results for "${query}"`),
				'',
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

		// If active technology was chosen, try live DocC symbol resolution fallback
		if (activeTechnology) {
			const exactMatchResponse = await tryExactSymbolMatch(
				client,
				activeTechnology,
				query,
				queryMode,
				platform,
				symbolType,
			);
			if (exactMatchResponse) {
				return exactMatchResponse;
			}
		}

		return {
			content: [
				{
					text: [
						header(1, `🔍 Search Results for "${query}"`),
						'',
						bold('Framework', targetFramework || 'Unknown'),
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
