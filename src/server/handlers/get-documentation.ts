import type { ServerContext, ToolResponse } from '../context.js';
import type {
	SymbolData,
	ReferenceData,
	Technology,
	PlatformInfo,
} from '../../apple-client.js';
import type { DbSymbol } from '../db/database.js';
import { bold, header, trimWithEllipsis } from '../markdown.js';
import {
	formatDeclaration,
	formatDeprecation,
	formatParameters,
	formatDiscussion,
} from '../../apple-client/docc-formatter.js';
import { loadActiveFrameworkData } from '../services/framework-loader.js';
import { resolveSymbol } from '../services/symbol-resolution.js';
import { buildNoTechnologyMessage } from './no-technology.js';

const formatIdentifiers = (
	identifiers: string[],
	references: Record<string, ReferenceData> | undefined,
	client: ServerContext['client'],
): string[] => {
	const content: string[] = [];

	for (const id of identifiers.slice(0, 5)) {
		const ref = references?.[id];
		if (ref) {
			const refDesc = client.extractText(ref.abstract ?? []);
			content.push(`• **${ref.title}** - ${trimWithEllipsis(refDesc, 100)}`);
		}
	}

	if (identifiers.length > 5) {
		content.push(`*... and ${identifiers.length - 5} more items*`);
	}

	return content;
};

const formatTopicSections = (
	data: SymbolData,
	client: ServerContext['client'],
): string[] => {
	const content: string[] = [];

	if (data.topicSections?.length) {
		content.push('', header(2, 'API Reference'), '');
		for (const section of data.topicSections) {
			content.push(`### ${section.title}`);
			if (section.identifiers?.length) {
				content.push(
					...formatIdentifiers(section.identifiers, data.references, client),
				);
			}

			content.push('');
		}
	}

	return content;
};

export const buildGetDocumentationHandler = (context: ServerContext) => {
	const { client, state, db } = context;
	const noTechnology = buildNoTechnologyMessage(context);

	return async (args: {
		path: string;
		framework?: string;
	}): Promise<ToolResponse> => {
		const { path, framework: frameworkArg } = args;
		if (typeof path !== 'string' || path.trim().length === 0) {
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: 'Error: A non-empty "path" parameter is required.',
					},
				],
			};
		}

		let resolvedPath = path;
		let localDbSymbol: DbSymbol | undefined;

		// 1. First, check local SQLite database using multi-stage resolution
		if (db) {
			const resolution = db.resolveSymbol(path, frameworkArg);
			if (resolution.candidates && resolution.candidates.length > 1) {
				return {
					isError: true,
					content: [
						{
							type: 'text',
							text: [
								`UNRESOLVED: Multiple symbols match "${path}". Please disambiguate by passing the exact path or framework:`,
								'',
								...resolution.candidates.map(
									(c) =>
										`• **${c.title}** (${c.framework} ${c.kind})\n   Path: \`${c.path}\`\n   Call: \`get_documentation({ "path": "${c.path}", "framework": "${c.framework}" })\``,
								),
							].join('\n'),
						},
					],
				};
			}

			if (resolution.symbol) {
				localDbSymbol = resolution.symbol;
				resolvedPath = resolution.symbol.path;
			}
		}

		let activeTechnology = state.getActiveTechnology();

		if (localDbSymbol) {
			activeTechnology = {
				identifier: `doc://com.apple.documentation/documentation/${localDbSymbol.framework}`,
				title: localDbSymbol.framework,
				kind: 'symbol',
				role: 'collection',
				url: `/documentation/${localDbSymbol.framework.toLowerCase()}`,
				abstract: [],
			};
		} else if (
			frameworkArg &&
			typeof frameworkArg === 'string' &&
			frameworkArg.trim().length > 0
		) {
			const cleanFw = frameworkArg.trim();
			activeTechnology = {
				identifier: `doc://com.apple.documentation/documentation/${cleanFw}`,
				title: cleanFw,
				kind: 'symbol',
				role: 'collection',
				url: `/documentation/${cleanFw.toLowerCase()}`,
				abstract: [],
			};
		}

		if (!activeTechnology) {
			const match = path.replace(/^\/+/, '').match(/^documentation\/([^/]+)/i);
			if (match) {
				const fw = match[1];
				activeTechnology = {
					identifier: `doc://com.apple.documentation/documentation/${fw}`,
					title: fw,
					kind: 'symbol',
					role: 'collection',
					url: `/documentation/${fw.toLowerCase()}`,
					abstract: [],
				};
			}
		}

		if (!activeTechnology) {
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: [
							`UNRESOLVED: Could not resolve Apple technology or framework for "${path}".`,
							'',
							'**Suggestions:**',
							`• Pass an explicit framework parameter: \`get_documentation({ "path": "${path}", "framework": "SwiftUI" })\``,
							`• Search for the symbol first: \`search_symbols({ "query": "${path}" })\` or \`semantic_search({ "query": "${path}" })\``,
							'• Run `discover_technologies()` to see indexed frameworks',
						].join('\n'),
					},
				],
			};
		}

		try {
			const effectiveContext = state.getActiveTechnology()
				? context
				: {
						...context,
						state: new Proxy(state, {
							get(target, prop, receiver) {
								if (prop === 'getActiveTechnology') {
									return () => activeTechnology;
								}
								return Reflect.get(target, prop, receiver);
							},
						}),
					};

			let frameworkPlatforms: PlatformInfo[] = [];
			try {
				const framework = await loadActiveFrameworkData(effectiveContext);
				frameworkPlatforms = framework.metadata?.platforms ?? [];
			} catch {
				// Fall back gracefully if full framework metadata isn't available
			}

			const { data }: { data: SymbolData; targetPath: string } =
				await resolveSymbol(
					client,
					activeTechnology,
					resolvedPath,
					frameworkArg,
				);

			const title = data.metadata?.title || 'Symbol';
			const kind = data.metadata?.symbolKind || 'Unknown';
			const platforms = client.formatPlatforms(
				data.metadata?.platforms ?? frameworkPlatforms,
			);
			const description = client.extractText(data.abstract);

			const content: string[] = [
				header(1, title),
				'',
				bold('Technology', activeTechnology.title),
				bold('Type', kind),
				bold('Platforms', platforms),
				'',
			];

			const deprecation = formatDeprecation(data.deprecationSummary);
			if (deprecation) {
				content.push(deprecation, '');
			}

			const declaration = formatDeclaration(data.primaryContentSections);
			if (declaration) {
				content.push(header(2, 'Declaration'), declaration, '');
			}

			if (description) {
				content.push(header(2, 'Overview'), description, '');
			}

			const parameters = formatParameters(data.primaryContentSections);
			if (parameters) {
				content.push(parameters, '');
			}

			const discussion = formatDiscussion(data.primaryContentSections);
			if (discussion) {
				content.push(header(2, 'Discussion'), discussion, '');
			}

			content.push(...formatTopicSections(data, client));

			return {
				content: [{ text: content.join('\n').trim(), type: 'text' }],
			};
		} catch (error) {
			// If online fetch fails, check if local db has symbol metadata to return as graceful fallback
			const dbSym = localDbSymbol || db?.getSymbolByPath(resolvedPath);
			if (dbSym) {
				return {
					content: [
						{
							text: [
								header(1, dbSym.title),
								'',
								bold('Technology', dbSym.framework),
								bold('Type', dbSym.kind),
								bold(
									'Platforms',
									dbSym.platforms.length > 0
										? dbSym.platforms.join(', ')
										: 'All platforms',
								),
								'',
								header(2, 'Overview'),
								dbSym.abstract ||
									`Official Apple documentation available at https://developer.apple.com${dbSym.path}`,
							].join('\n'),
							type: 'text',
						},
					],
				};
			}

			const errorMsg = error instanceof Error ? error.message : String(error);
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: [
							`UNRESOLVED: Failed to load documentation for "${path}": ${errorMsg}`,
							'',
							'**Suggestions:**',
							`• Verify the symbol spelling or query using \`search_symbols({ "query": "${path}" })\``,
							`• Try passing the framework explicitly: \`get_documentation({ "path": "${path}", "framework": "SwiftUI" })\``,
						].join('\n'),
					},
				],
			};
		}
	};
};
