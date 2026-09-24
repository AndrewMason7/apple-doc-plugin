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
			name: 'search_symbols',
			description:
				'Search Apple developer documentation with sub-millisecond symbol-first results across all indexed Apple frameworks. ' +
				'Can be optionally scoped to a framework (via the framework argument or choose_technology). ' +
				'Supports exact symbol resolution, wildcards (*, ?), and conceptual intent searches.',
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
						description: 'Optional maximum number of results (default 20)',
					},
					platform: {
						type: 'string',
						description: 'Optional platform filter (iOS, macOS, etc.)',
					},
					query: {
						type: 'string',
						description:
							'Search keywords with wildcard support (* for any characters, ? for single character)',
					},
					symbolType: {
						type: 'string',
						description: 'Optional symbol kind filter (class, protocol, etc.)',
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
