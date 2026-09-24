import type { ServerContext, ToolResponse } from '../context.js';
import { bold, header, trimWithEllipsis } from '../markdown.js';
import { CORE_FRAMEWORKS } from '../db/frameworks.js';
import type { Technology } from '../../apple-client.js';

const formatPagination = (
	query: string | undefined,
	currentPage: number,
	totalPages: number,
): string[] => {
	if (totalPages <= 1) {
		return [];
	}

	const safeQuery = query ?? '';
	const items: string[] = [];
	if (currentPage > 1) {
		items.push(
			`• Previous: \`discover_technologies({ "query": "${safeQuery}", "page": ${currentPage - 1} })\``,
		);
	}

	if (currentPage < totalPages) {
		items.push(
			`• Next: \`discover_technologies({ "query": "${safeQuery}", "page": ${currentPage + 1} })\``,
		);
	}

	return ['*Pagination*', ...items];
};

export const buildDiscoverHandler =
	({ client, state, db }: ServerContext) =>
	async (args: {
		query?: string;
		page?: number;
		pageSize?: number;
	}): Promise<ToolResponse> => {
		const { query, page = 1, pageSize = 25 } = args;

		let technologies: Record<string, Technology> = {};
		try {
			technologies = await client.getTechnologies();
		} catch {}

		const dbCounts = db ? db.getFrameworkSymbolCounts() : [];
		const dbCountMap = new Map<string, number>(
			dbCounts.map((c) => [c.framework.toLowerCase(), c.count]),
		);

		// Merge CORE_FRAMEWORKS and any frameworks present in DB
		const frameworkNames: string[] = [...CORE_FRAMEWORKS];
		for (const c of dbCounts) {
			if (
				!frameworkNames.some(
					(n) => n.toLowerCase() === c.framework.toLowerCase(),
				)
			) {
				frameworkNames.push(c.framework);
			}
		}

		const frameworks = frameworkNames.map((name) => {
			const lower = name.toLowerCase();
			const found = Object.values(technologies).find(
				(t) => t && t.title && t.title.toLowerCase() === lower,
			);
			const count = dbCountMap.get(lower) ?? 0;
			if (found) {
				return {
					identifier: found.identifier || `documentation/${lower}`,
					title: found.title,
					abstract: found.abstract,
					symbolCount: count,
				};
			}
			return {
				identifier: `documentation/${lower}`,
				title: name,
				abstract: [{ text: `${name} framework`, type: 'text' }],
				symbolCount: count,
			};
		});

		if (db && dbCounts.length > 0) {
			frameworks.sort(
				(a, b) =>
					b.symbolCount - a.symbolCount || a.title.localeCompare(b.title),
			);
		}

		let filtered = frameworks;
		if (query) {
			const lowerQuery = query.toLowerCase();
			filtered = frameworks.filter(
				(tech) =>
					tech.title.toLowerCase().includes(lowerQuery) ||
					client.extractText(tech.abstract).toLowerCase().includes(lowerQuery),
			);
		}

		const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
		const currentPage = Math.min(Math.max(page, 1), totalPages);
		const start = (currentPage - 1) * pageSize;
		const pageItems = filtered.slice(start, start + pageSize);

		state.setLastDiscovery({ query, results: pageItems as any });

		const lines: string[] = [
			header(
				1,
				`Discover Apple Technologies${query ? ` (filtered by "${query}")` : ''}`,
			),
			'\n',
			bold('Total indexed frameworks', frameworks.length.toString()),
			bold('Matches', filtered.length.toString()),
			bold('Page', `${currentPage} / ${totalPages}`),
			'\n',
			header(2, 'Indexed Frameworks'),
		];

		for (const framework of pageItems) {
			const description = client.extractText(framework.abstract);
			lines.push(`### ${framework.title}`);
			if (description) {
				lines.push(`   ${trimWithEllipsis(description, 180)}`);
			}

			lines.push(
				`   • **Identifier:** ${framework.identifier}`,
				`   • **Symbols Indexed:** ${framework.symbolCount.toLocaleString()}`,
				`   • **Usage:** Pass \`framework: "${framework.title}"\` to \`semantic_search\` or \`search_symbols\``,
				'',
			);
		}

		lines.push(
			...formatPagination(query, currentPage, totalPages),
			'\n## Next Step',
			'Pass `framework: "<FrameworkName>"` directly to `semantic_search`, `search_symbols`, or `get_documentation`. Setting session state via `choose_technology` is optional.',
		);

		return {
			content: [
				{
					text: lines.join('\n'),
					type: 'text',
				},
			],
		};
	};
