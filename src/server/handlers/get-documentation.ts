import type { ServerContext, ToolResponse } from '../context.js';
import type { SymbolData, ReferenceData, Technology } from '../../apple-client.js';
import { bold, header, trimWithEllipsis } from '../markdown.js';
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

	return async ({ path }: { path: string }): Promise<ToolResponse> => {
		if (typeof path !== 'string' || path.trim().length === 0) {
			return {
				isError: true,
				content: [{ type: 'text', text: 'Error: A non-empty "path" parameter is required.' }],
			};
		}

		let activeTechnology = state.getActiveTechnology();

		// If no technology is explicitly selected, check local database or path prefix
		if (!activeTechnology && db) {
			const dbSym = db.getSymbolByPath(path);
			if (dbSym) {
				activeTechnology = {
					identifier: `doc://com.apple.documentation/documentation/${dbSym.framework}`,
					title: dbSym.framework,
					kind: 'symbol',
					role: 'collection',
					url: `/documentation/${dbSym.framework.toLowerCase()}`,
					abstract: [],
				};
			}
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
			return noTechnology();
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
			const framework = await loadActiveFrameworkData(effectiveContext);

			const { data }: { data: SymbolData; targetPath: string } =
				await resolveSymbol(client, activeTechnology, path);

			const title = data.metadata?.title || 'Symbol';
			const kind = data.metadata?.symbolKind || 'Unknown';
			const platforms = client.formatPlatforms(
				data.metadata?.platforms ?? framework.metadata?.platforms ?? [],
			);
			const description = client.extractText(data.abstract);

			const content: string[] = [
				header(1, title),
				'',
				bold('Technology', activeTechnology.title),
				bold('Type', kind),
				bold('Platforms', platforms),
				'',
				header(2, 'Overview'),
				description,
			];

			content.push(...formatTopicSections(data, client));

			return {
				content: [{ text: content.join('\n'), type: 'text' }],
			};
		} catch (error) {
			// If online fetch fails, check if local db has symbol metadata to return as graceful fallback
			const dbSym = db?.getSymbolByPath(path);
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
									dbSym.platforms.length > 0 ? dbSym.platforms.join(', ') : 'All platforms',
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

			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: `Failed to load documentation for "${path}": ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	};
};
