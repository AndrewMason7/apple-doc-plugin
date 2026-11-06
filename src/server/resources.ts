import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	ListResourcesRequestSchema,
	ListResourceTemplatesRequestSchema,
	ReadResourceRequestSchema,
	McpError,
	ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import type { ServerContext } from './context.js';
import { CORE_FRAMEWORKS } from './db/frameworks.js';
import { logger } from './logger.js';

export function registerResources(
	server: Server,
	context: ServerContext,
): void {
	const { db } = context;

	// List available static resources
	server.setRequestHandler(ListResourcesRequestSchema, async () => {
		const resources = [
			{
				uri: 'apple-docs://frameworks',
				name: 'Apple Documentation - Indexed Frameworks',
				description:
					'Complete list of indexed Apple frameworks with symbol counts and platform availability.',
				mimeType: 'application/json',
			},
		];

		// Include direct symbol list URIs for core frameworks
		const frameworkList = db ? db.getFrameworks() : [...CORE_FRAMEWORKS];
		for (const fw of frameworkList) {
			resources.push({
				uri: `apple-docs://symbols/${fw}`,
				name: `${fw} Primary Types and Symbols`,
				description: `Key classes, structs, protocols, and APIs for ${fw}.`,
				mimeType: 'application/json',
			});
		}

		return { resources };
	});

	// List URI templates for dynamic expansion
	server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
		resourceTemplates: [
			{
				uriTemplate: 'apple-docs://symbols/{framework}',
				name: 'Apple Documentation - Framework Symbols',
				description:
					'Primary types, protocols, structs, and symbols for a specific Apple framework.',
				mimeType: 'application/json',
			},
		],
	}));

	// Read resource content
	server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
		const { uri } = request.params;

		if (uri === 'apple-docs://frameworks') {
			let frameworkData: Array<{
				name: string;
				symbolCount: number;
				primaryTypeCount: number;
			}> = [];

			if (db) {
				const countsList = db.getFrameworkSymbolCounts();
				const countMap = new Map<string, number>(
					countsList.map((c) => [c.framework, c.count]),
				);
				const primaryCountsList = db.getFrameworkPrimarySymbolCounts();
				const primaryMap = new Map<string, number>(
					primaryCountsList.map((c) => [c.framework, c.count]),
				);
				const allFrameworks = Array.from(
					new Set([...CORE_FRAMEWORKS, ...db.getFrameworks()]),
				).sort();
				frameworkData = allFrameworks.map((name) => ({
					name,
					symbolCount: countMap.get(name) ?? 0,
					primaryTypeCount: primaryMap.get(name) ?? 0,
				}));
			} else {
				frameworkData = [...CORE_FRAMEWORKS].sort().map((name) => ({
					name,
					symbolCount: 0,
					primaryTypeCount: 0,
				}));
			}

			const payload = {
				uri,
				totalFrameworks: frameworkData.length,
				frameworks: frameworkData,
			};

			return {
				contents: [
					{
						uri,
						mimeType: 'application/json',
						text: JSON.stringify(payload, null, 2),
					},
				],
			};
		}

		const symbolsPrefix = 'apple-docs://symbols/';
		if (uri.startsWith(symbolsPrefix)) {
			const rawFramework = decodeURIComponent(
				uri.slice(symbolsPrefix.length).trim(),
			);
			if (!rawFramework) {
				throw new McpError(
					ErrorCode.InvalidParams,
					'Framework name is required in uri (e.g. apple-docs://symbols/SwiftUI)',
				);
			}

			const allFrameworks = Array.from(
				new Set([...CORE_FRAMEWORKS, ...(db ? db.getFrameworks() : [])]),
			);
			const matchedFramework = allFrameworks.find(
				(f) => f.toLowerCase() === rawFramework.toLowerCase(),
			);

			if (!matchedFramework) {
				throw new McpError(
					ErrorCode.InvalidRequest,
					`Framework "${rawFramework}" is not recognized as an Apple framework`,
				);
			}

			const symbols = db ? db.getPrimarySymbols(matchedFramework, 200) : [];
			const payload = {
				uri,
				framework: matchedFramework,
				count: symbols.length,
				symbols,
			};

			return {
				contents: [
					{
						uri,
						mimeType: 'application/json',
						text: JSON.stringify(payload, null, 2),
					},
				],
			};
		}

		logger.warn(`Resource not found for URI: ${uri}`);
		throw new McpError(
			ErrorCode.InvalidRequest,
			`Unknown resource URI: ${uri}`,
		);
	});
}
