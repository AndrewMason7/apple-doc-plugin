import type { ServerContext, ToolResponse } from '../context.js';
import { header, bold } from '../markdown.js';

export const buildNoTechnologyMessage =
	({ client, state }: ServerContext) =>
	async (): Promise<ToolResponse> => {
		const lastDiscovery = state.getLastDiscovery();

		// Get available technologies for better guidance
		let availableTechnologies: string[] = [];
		try {
			const technologies = await client.getTechnologies();
			// Filter out invalid entries and get only proper technologies
			availableTechnologies = Object.values(technologies)
				.filter(
					(tech) =>
						tech.title && tech.kind === 'symbol' && tech.role === 'collection',
				)
				.slice(0, 8)
				.map((t) => t.title);
		} catch (error) {
			console.warn('Failed to get technologies for error message:', error);
		}

		const lines = [
			header(1, 'ℹ️ Technology Selection Recommended'),
			'',
			bold(
				'📌 Context Guidance:',
				'For unqualified symbol documentation lookups (e.g. `get_documentation({ "path": "View" })`), choosing a technology clarifies which framework to look in. Note: `search_symbols` is fully capable of searching across all Apple frameworks globally without selecting a technology.',
			),
			'',
			'Apple developer documentation is organized by technology/framework.',
			'',
			header(2, '🔧 Recommended Workflow'),
			'',
			bold('Option A:', 'Search globally across all Apple frameworks'),
			'• `search_symbols { "query": "Button" }` — search across all frameworks',
			'• `search_symbols { "query": "Grid*", "framework": "SwiftUI" }` — search with explicit framework',
			'',
			bold('Option B:', 'Scope session to a specific technology'),
			'• `discover_technologies()` — explore available Apple frameworks',
			'• `choose_technology({ "name": "SwiftUI" })` — scope future lookups to SwiftUI',
			'• `get_documentation({ "path": "View" })` — view detailed docs within selected technology',
			'',
			header(2, '📚 Available Technologies'),
		];

		if (availableTechnologies.length > 0) {
			lines.push('', 'Popular technologies you can choose from:');
			for (const tech of availableTechnologies) {
				lines.push(
					`• **${tech}** — \`choose_technology({ "name": "${tech}" })\``,
				);
			}

			if (availableTechnologies.length === 8) {
				lines.push(
					'• **...and many more** — use `discover_technologies` to see all options',
				);
			}
		} else {
			lines.push(
				'',
				'Use `discover_technologies` to see all available Apple technologies.',
			);
		}

		lines.push(
			'',
			header(2, '💡 Quick Start Examples'),
			'',
			'**For SwiftUI development:**',
			'1. `discover_technologies({ "query": "swiftui" })`',
			'2. `choose_technology({ "name": "SwiftUI" })`',
			'3. `search_symbols({ "query": "Button" })`',
			'',
			'**For UIKit development:**',
			'1. `discover_technologies({ "query": "uikit" })`',
			'2. `choose_technology({ "name": "UIKit" })`',
			'3. `search_symbols({ "query": "UIButton" })`',
		);

		if (lastDiscovery?.results?.length) {
			lines.push('', header(2, '🔄 Recently Discovered'));
			for (const result of lastDiscovery.results.slice(0, 3)) {
				lines.push(
					`• **${result.title}** — \`choose_technology({ "name": "${result.title}" })\``,
				);
			}
		}

		return {
			content: [{ text: lines.join('\n'), type: 'text' }],
		};
	};
