import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ServerContext } from './context.js';
import { buildDiscoverHandler } from './handlers/discover.js';
import { buildChooseTechnologyHandler } from './handlers/choose-technology.js';
import { buildCurrentTechnologyHandler } from './handlers/current-technology.js';
import { buildGetDocumentationHandler } from './handlers/get-documentation.js';
import { buildSearchSymbolsHandler } from './handlers/search-symbols.js';
import { buildVersionHandler } from './handlers/version.js';

type ToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handler: (
		args: Record<string, unknown>,
	) => Promise<{ content: Array<{ text: string; type: 'text' }> }>;
};

export const registerTools = (server: Server, context: ServerContext) => {
	const toolDefinitions: ToolDefinition[] = [
		{
			name: 'discover_technologies',
			description:
				'List and filter Apple frameworks that are indexed in the local database.',
			inputSchema: {
				type: 'object',
				required: [],
				properties: {
					page: {
						type: 'number',
						description: 'Optional page number (default 1)',
					},
					pageSize: {
						type: 'number',
						description: 'Optional page size (default 25, max 100)',
					},
					query: {
						type: 'string',
						description: 'Optional keyword to filter technologies',
					},
				},
			},
			handler: (args) => buildDiscoverHandler(context)(args),
		},
		{
			name: 'choose_technology',
			description:
				'Optional session default only. Sets the default framework for subsequent queries in this session. ' +
				'Note: Every search and documentation tool already accepts an optional "framework" argument directly ' +
				'(e.g., search_symbols({ query: "Button", framework: "SwiftUI" }), ' +
				'semantic_search({ query: "sheet dismiss", framework: "SwiftUI" }), or ' +
				'get_documentation({ path: "Button", framework: "SwiftUI" })). ' +
				'Calling choose_technology is optional; passing framework on individual tool calls is preferred.',
			inputSchema: {
				type: 'object',
				required: [],
				properties: {
					identifier: {
						type: 'string',
						description:
							'Optional technology identifier (e.g. doc://.../SwiftUI)',
					},
					name: {
						type: 'string',
						description: 'Technology name/title (e.g. SwiftUI)',
					},
				},
			},
			handler: (args) =>
				buildChooseTechnologyHandler(context)(
					args as { identifier?: string; name?: string },
				),
		},
		{
			name: 'current_technology',
			description:
				'Read the currently selected technology/framework from optional session default state.',
			inputSchema: {
				type: 'object',
				required: [],
				properties: {},
			},
			handler: () => buildCurrentTechnologyHandler(context)(),
		},
		{
			name: 'get_documentation',
			description:
				'Point lookup for detailed symbol or article documentation (Swift syntax declarations, parameters, return types, deprecations). ' +
				'Queries local SQLite database first, falling back to Apple DocC CDN. Not a search tool. ' +
				'Pass framework directly (e.g. framework: "SwiftUI") if known.',
			inputSchema: {
				type: 'object',
				required: ['path'],
				properties: {
					framework: {
						type: 'string',
						description:
							'Optional framework name (e.g. "SwiftUI", "UIKit"). If omitted, framework is auto-detected from path or local database.',
					},
					path: {
						type: 'string',
						description:
							'Symbol path or relative name (e.g. "View", "GridItem", "documentation/SwiftUI/NavigationStack")',
					},
				},
			},
			handler: (args) =>
				buildGetDocumentationHandler(context)(
					args as { path: string; framework?: string },
				),
		},
		{
			name: 'semantic_search',
			description:
				'Hybrid search combining SQLite FTS5 lexical search and Gemini 3072-dim vector embeddings with Reciprocal Rank Fusion (RRF). ' +
				'Search by natural language intent, conceptual query, or API name. ' +
				'If Gemini credentials (GEMINI_API_KEY / ADC) are unavailable or circuit breaker is open, automatically falls back to lexical search with notice in result text.',
			inputSchema: {
				type: 'object',
				required: ['query'],
				properties: {
					framework: {
						type: 'string',
						description:
							'Optional framework name to scope semantic search (e.g. "SwiftUI", "UIKit", "LocalAuthentication")',
					},
					maxResults: {
						type: 'number',
						description:
							'Optional maximum number of results (default 20, max 100)',
					},
					platform: {
						type: 'string',
						description:
							'Optional platform filter (iOS, macOS, watchOS, visionOS)',
					},
					query: {
						type: 'string',
						description:
							'Natural language description of the desired behavior, UI pattern, concept, or symbol name (e.g. "three column sidebar split view diagram", "biometric face id authentication", "NavigationSplitView")',
					},
					symbolType: {
						type: 'string',
						description:
							'Optional symbol kind filter (struct, class, protocol, func, etc.)',
					},
				},
			},
			handler: (args) =>
				buildSearchSymbolsHandler(context)({
					...(args as {
						framework?: string;
						maxResults?: number;
						platform?: string;
						query: string;
						symbolType?: string;
					}),
					preferSemantic: true,
					lexicalOnly: false,
				}),
		},
		{
			name: 'search_symbols',
			description:
				'Lexical symbol search using SQLite FTS5 BM25 with exact-title boosting and wildcard pattern matching (*, ?). ' +
				'Accepts optional framework, platform, and symbolType. Purely local lexical search; does not call Gemini.',
			inputSchema: {
				type: 'object',
				required: ['query'],
				properties: {
					framework: {
						type: 'string',
						description:
							'Optional framework name to scope search (e.g. "SwiftUI", "UIKit", "SwiftData"). If omitted, searches across all indexed Apple frameworks.',
					},
					maxResults: {
						type: 'number',
						description:
							'Optional maximum number of results (default 20, max 100)',
					},
					platform: {
						type: 'string',
						description:
							'Optional platform filter (iOS, macOS, watchOS, visionOS)',
					},
					query: {
						type: 'string',
						description:
							'The search query: can be an exact symbol name ("NavigationSplitView"), wildcard pattern ("Grid*"), or keyword ("button style")',
					},
					symbolType: {
						type: 'string',
						description:
							'Optional symbol kind filter (struct, class, protocol, func, etc.)',
					},
				},
			},
			handler: (args) =>
				buildSearchSymbolsHandler(context)({
					...(args as {
						framework?: string;
						maxResults?: number;
						platform?: string;
						query: string;
						symbolType?: string;
					}),
					lexicalOnly: true,
				}),
		},
		{
			name: 'get_version',
			description:
				'Get the current server version and runtime index metadata (symbol count, indexed frameworks, snapshot build timestamp, embedding status)',
			inputSchema: {
				type: 'object',
				required: [],
				properties: {},
			},
			handler: () => buildVersionHandler(context)(),
		},
		{
			name: 'index_info',
			description:
				'Get runtime SQLite index metadata including symbol count, indexed frameworks, snapshot build timestamp, and embedding status',
			inputSchema: {
				type: 'object',
				required: [],
				properties: {},
			},
			handler: () => buildVersionHandler(context)(),
		},
	];

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: toolDefinitions.map(({ name, description, inputSchema }) => ({
			name,
			description,
			inputSchema,
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const tool = toolDefinitions.find(
			(entry) => entry.name === request.params.name,
		);
		if (!tool) {
			return {
				isError: true,
				content: [
					{ type: 'text', text: `Unknown tool: ${request.params.name}` },
				],
			};
		}

		try {
			return await tool.handler(request.params.arguments ?? {});
		} catch (error) {
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: `Error executing tool ${request.params.name}: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	});
};
