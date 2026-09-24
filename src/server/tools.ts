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
				'Explore and filter available Apple technologies/frameworks before choosing one',
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
				'(Optional / Legacy) Select the framework/technology to scope subsequent searches and documentation lookups. ' +
				'In most cases, you can pass framework directly to search_symbols or get_documentation without setting session state.',
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
				'(Optional / Legacy) Report the currently selected technology in session state',
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
				'Get detailed documentation for specific symbols, including Swift syntax declarations, parameters, deprecation notices, and code examples. ' +
				'Can be optionally scoped to a framework directly via the framework argument without needing choose_technology.',
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
				'[PRIMARY & PREFERRED] Search Apple Developer Documentation by natural language intent, behavioral description, concept, or symbol name (powered by Gemini hybrid embeddings + SQLite FTS5). ' +
				'Always prefer this tool over search_symbols for discovering Apple APIs, modern replacements, UI patterns, and framework behavior (e.g. "prevent sheet swipe dismiss", "background location tracking when screen is off", "store auth token securely in keychain", "NavigationSplitView", "react useEffect on mount equivalent").',
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
				}),
		},
		{
			name: 'search_symbols',
			description:
				'(Secondary / Wildcard Pattern Search) Direct symbol lookup and wildcard pattern matching (*, ?). ' +
				'Always prefer semantic_search unless you specifically require raw wildcard globbing (e.g. "Grid*", "*Style").',
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
				buildSearchSymbolsHandler(context)(
					args as {
						framework?: string;
						maxResults?: number;
						platform?: string;
						query: string;
						symbolType?: string;
					},
				),
		},
		{
			name: 'get_version',
			description:
				'Get the current version information of the Apple Doc MCP server',
			inputSchema: {
				type: 'object',
				required: [],
				properties: {},
			},
			handler: () => buildVersionHandler()(),
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
