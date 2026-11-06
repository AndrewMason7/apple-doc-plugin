import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	ListPromptsRequestSchema,
	GetPromptRequestSchema,
	McpError,
	ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from './logger.js';

interface PromptDefinition {
	name: string;
	description: string;
	arguments: Array<{
		name: string;
		description: string;
		required: boolean;
	}>;
	buildMessages: (args: Record<string, string | undefined>) => Array<{
		role: 'user';
		content: {
			type: 'text';
			text: string;
		};
	}>;
}

const PROMPT_DEFINITIONS: PromptDefinition[] = [
	{
		name: 'modernize-navigation',
		description:
			'Migrate legacy SwiftUI NavigationView to modern iOS 16+ NavigationStack or NavigationSplitView with type-safe NavigationPath and navigationDestination.',
		arguments: [
			{
				name: 'code',
				description:
					'SwiftUI view source code containing legacy NavigationView',
				required: true,
			},
		],
		buildMessages: (args) => {
			const code = args.code || '';
			return [
				{
					role: 'user',
					content: {
						type: 'text',
						text: [
							'You are an expert Apple platforms engineer specializing in modern SwiftUI.',
							'Please refactor the following legacy SwiftUI code from deprecated `NavigationView` to modern `NavigationStack` or `NavigationSplitView` (iOS 16+).',
							'',
							'### Guidelines:',
							'1. Replace `NavigationView` with `NavigationStack(path: $path)` for stack-based navigation or `NavigationSplitView` for multi-column layouts.',
							'2. Replace `NavigationLink(destination: ...)` with `NavigationLink(value: ...)` paired with `.navigationDestination(for: DestinationType.self)`.',
							'3. Ensure destinations are decoupled and data-driven with Hashable value models.',
							'4. Preserve state, navigation titles (`.navigationTitle`), and toolbars (`.toolbar`).',
							'',
							'### Legacy Code:',
							'```swift',
							code,
							'```',
						].join('\n'),
					},
				},
			];
		},
	},
	{
		name: 'scaffold-swiftdata',
		description:
			'Scaffold a modern iOS 17+ SwiftData architecture including @Model classes, relationships, ModelContainer configuration, and SwiftUI @Query views.',
		arguments: [
			{
				name: 'entities',
				description:
					'Description of data entities, attributes, relationships, and persistence requirements',
				required: true,
			},
		],
		buildMessages: (args) => {
			const entities = args.entities || '';
			return [
				{
					role: 'user',
					content: {
						type: 'text',
						text: [
							'You are an expert Apple platforms engineer specializing in SwiftData and modern persistence architecture.',
							'Please scaffold a clean, production-grade SwiftData implementation based on the requirements below.',
							'',
							'### Requirements:',
							entities,
							'',
							'### Scaffolding Guidelines:',
							'1. Define models using `@Model final class ...` (SwiftData requires classes).',
							'2. Use `@Attribute(.unique)` where applicable for primary identifiers.',
							'3. Use `@Relationship(deleteRule: ...)` for explicit cascade/nullify rules.',
							'4. Configure `.modelContainer(for: ...)` on the SwiftUI `WindowGroup` or `@main App`.',
							'5. Provide an example view demonstrating `@Query` with `#Predicate` filtering and sort descriptors.',
							'6. Use Swift 6 strict concurrency best practices.',
						].join('\n'),
					},
				},
			];
		},
	},
	{
		name: 'audit-deprecation',
		description:
			'Audit Swift/SwiftUI/UIKit code for deprecated Apple platform APIs and suggest modern iOS 17+/18+ replacements with official documentation references.',
		arguments: [
			{
				name: 'code',
				description:
					'Swift source code to audit for deprecations and legacy patterns',
				required: true,
			},
		],
		buildMessages: (args) => {
			const code = args.code || '';
			return [
				{
					role: 'user',
					content: {
						type: 'text',
						text: [
							'You are an expert Apple platforms code reviewer and API modernization specialist.',
							'Audit the following Swift source code for deprecated Apple platform APIs, outdated patterns, and recommend modern replacements.',
							'',
							'### Specific Anti-Patterns to Audit:',
							'- `NavigationView` -> replace with `NavigationStack` / `NavigationSplitView`',
							'- `ObservableObject` / `@Published` -> modernize to `@Observable` (Observation framework)',
							'- Core Data boilerplate -> evaluate migration to `SwiftData`',
							'- Completion handler closures -> refactor to `async`/`await` and `Task`',
							'- Deprecated UIKit/AppKit components (e.g. `UIAlertView`, old collection views)',
							'',
							'### Target Code:',
							'```swift',
							code,
							'```',
							'',
							'For each detected deprecation, provide:',
							'1. Line/symbol identified',
							'2. Deprecation version and reason',
							'3. Recommended modern replacement symbol or pattern',
							'4. Refactored code snippet',
						].join('\n'),
					},
				},
			];
		},
	},
];

export function registerPrompts(server: Server): void {
	server.setRequestHandler(ListPromptsRequestSchema, async () => ({
		prompts: PROMPT_DEFINITIONS.map(
			({ name, description, arguments: args }) => ({
				name,
				description,
				arguments: args,
			}),
		),
	}));

	server.setRequestHandler(GetPromptRequestSchema, async (request) => {
		const { name, arguments: promptArgs = {} } = request.params;
		const definition = PROMPT_DEFINITIONS.find((p) => p.name === name);

		if (!definition) {
			logger.warn(`Prompt not found: ${name}`);
			throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
		}

		// Verify required arguments
		for (const reqArg of definition.arguments) {
			if (reqArg.required && !promptArgs[reqArg.name]) {
				throw new McpError(
					ErrorCode.InvalidParams,
					`Missing required prompt argument: "${reqArg.name}" for prompt "${name}"`,
				);
			}
		}

		return {
			description: definition.description,
			messages: definition.buildMessages(promptArgs),
		};
	});
}
