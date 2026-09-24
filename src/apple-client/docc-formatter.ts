import type {
	DocCContentNode,
	DocCInlineContent,
	DocCPrimaryContentSection,
} from './types/index.js';

export const formatInlineContent = (nodes?: DocCInlineContent[]): string => {
	if (!nodes || !Array.isArray(nodes)) {
		return '';
	}

	return nodes
		.map((node) => {
			if (!node || typeof node !== 'object') {
				return '';
			}
			if (node.type === 'text') {
				return node.text ?? '';
			}
			if (node.type === 'codeVoice') {
				return `\`${node.code ?? ''}\``;
			}
			if (node.type === 'reference') {
				const title =
					node.title ||
					node.identifier?.split('/').pop()?.replace(/-/g, ' ') ||
					'reference';
				return `\`${title}\``;
			}
			if (node.type === 'emphasis') {
				return `*${formatInlineContent(node.inlineContent)}*`;
			}
			if (node.type === 'strong') {
				return `**${formatInlineContent(node.inlineContent)}**`;
			}
			if (node.type === 'link') {
				return `[${node.title || node.destination || 'Link'}](${node.destination || ''})`;
			}
			if (node.inlineContent) {
				return formatInlineContent(node.inlineContent);
			}
			return node.text ?? '';
		})
		.join('');
};

export const formatContentNodes = (nodes?: DocCContentNode[]): string => {
	if (!nodes || !Array.isArray(nodes)) {
		return '';
	}

	const parts: string[] = [];

	for (const node of nodes) {
		if (!node || typeof node !== 'object') {
			continue;
		}

		if (node.type === 'paragraph') {
			const text = formatInlineContent(node.inlineContent).trim();
			if (text) {
				parts.push(text);
			}
		} else if (node.type === 'heading') {
			const level = Math.min(Math.max(node.level ?? 2, 1), 6);
			const hashes = '#'.repeat(level);
			parts.push(`${hashes} ${node.text || ''}`);
		} else if (node.type === 'codeListing') {
			const lang = node.syntax || 'swift';
			const code = Array.isArray(node.code) ? node.code.join('\n') : '';
			parts.push(`\`\`\`${lang}\n${code}\n\`\`\``);
		} else if (node.type === 'unorderedList' && Array.isArray(node.items)) {
			const listItems = node.items
				.map((item) => `- ${formatContentNodes(item.content).trim()}`)
				.filter(Boolean)
				.join('\n');
			if (listItems) {
				parts.push(listItems);
			}
		} else if (node.type === 'aside') {
			const style = (node.style || 'NOTE').toUpperCase();
			const content = formatContentNodes(node.content).trim();
			if (content) {
				parts.push(`> [!${style}]\n> ${content.replace(/\n/g, '\n> ')}`);
			}
		}
	}

	return parts.join('\n\n');
};

export const formatDeclaration = (
	sections?: DocCPrimaryContentSection[],
): string | undefined => {
	if (!sections || !Array.isArray(sections)) {
		return undefined;
	}

	const declSection = sections.find((s) => s.kind === 'declarations');
	if (
		!declSection ||
		!Array.isArray(declSection.declarations) ||
		declSection.declarations.length === 0
	) {
		return undefined;
	}

	const firstDecl = declSection.declarations[0];
	if (
		!firstDecl ||
		!Array.isArray(firstDecl.tokens) ||
		firstDecl.tokens.length === 0
	) {
		return undefined;
	}

	const lang = firstDecl.languages?.[0] || 'swift';
	const rawCode = firstDecl.tokens
		.map((t) => t.text)
		.join('')
		.trim();
	if (!rawCode) {
		return undefined;
	}

	return `\`\`\`${lang}\n${rawCode}\n\`\`\``;
};

export const formatDeprecation = (
	summary?: DocCContentNode[],
): string | undefined => {
	if (!summary || !Array.isArray(summary) || summary.length === 0) {
		return undefined;
	}

	const content = formatContentNodes(summary).trim();
	if (!content) {
		return undefined;
	}

	return `> [!WARNING]\n> **Deprecated**: ${content.replace(/\n/g, '\n> ')}`;
};

export const formatParameters = (
	sections?: DocCPrimaryContentSection[],
): string | undefined => {
	if (!sections || !Array.isArray(sections)) {
		return undefined;
	}

	const paramsSection = sections.find((s) => s.kind === 'parameters');
	if (
		!paramsSection ||
		!Array.isArray(paramsSection.parameters) ||
		paramsSection.parameters.length === 0
	) {
		return undefined;
	}

	const items = paramsSection.parameters
		.map((param) => {
			const desc = formatContentNodes(param.content).trim();
			return desc ? `- \`${param.name}\`: ${desc}` : `- \`${param.name}\``;
		})
		.filter(Boolean);

	if (items.length === 0) {
		return undefined;
	}

	return `### Parameters\n${items.join('\n')}`;
};

export const formatDiscussion = (
	sections?: DocCPrimaryContentSection[],
): string | undefined => {
	if (!sections || !Array.isArray(sections)) {
		return undefined;
	}

	const contentSections = sections.filter((s) => s.kind === 'content');
	if (!contentSections.length) {
		return undefined;
	}

	const textBlocks = contentSections
		.map((s) => formatContentNodes(s.content).trim())
		.filter(Boolean);

	if (!textBlocks.length) {
		return undefined;
	}

	return textBlocks.join('\n\n');
};
