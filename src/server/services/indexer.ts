import { AppleDocsDB } from '../db/database.js';
import {
	CORE_FRAMEWORKS,
	FRAMEWORK_DEFAULT_PLATFORMS,
} from '../db/frameworks.js';
import {
	canonicalFrameworkFromSlug,
	frameworkSlugFromPath,
} from '../db/path-attribution.js';

/**
 * Resolve the framework that owns a DocC path.
 *
 * DocC references mix absolute paths (`/documentation/uikit/nsview`), bundle
 * identifiers (`doc://com.apple.SwiftUI/documentation/SwiftUI/AnyView`), bare
 * slugs (`uikit`) and relative paths (`swiftui/view`). Only the segment after
 * `documentation/` is authoritative; anything unrecognised keeps the caller's
 * fallback instead of being mis-attributed to the page being indexed.
 */
export function resolveFrameworkFromPath(
	path: string,
	fallback: string,
): string {
	const slug = frameworkSlugFromPath(path);
	if (!slug) return fallback;
	if (slug === fallback.toLowerCase()) return fallback;

	const canonical = canonicalFrameworkFromSlug(slug);
	if (!canonical) return fallback;

	return canonical;
}

/**
 * Canonical DocC symbol kinds keyed by every heading form Apple publishes in
 * `symbolKind` and `roleHeading`. Without an entry here the kind is *unknown* —
 * we never guess a type from a title, because a wrong kind corrupts filters.
 */
const SYMBOL_KIND_ALIASES: Record<string, string> = {
	structure: 'struct',
	struct: 'struct',
	class: 'class',
	protocol: 'protocol',
	enumeration: 'enum',
	enum: 'enum',
	macro: 'macro',
	'type alias': 'typealias',
	typealias: 'typealias',
	'instance method': 'method',
	'type method': 'method',
	'class method': 'method',
	func: 'func',
	function: 'func',
	method: 'method',
	'instance property': 'property',
	'type property': 'property',
	'class property': 'property',
	property: 'property',
	'global variable': 'var',
	variable: 'var',
	var: 'var',
	initializer: 'init',
	init: 'init',
	operator: 'op',
	case: 'case',
	subscript: 'subscript',
	'instance subscript': 'subscript',
	'type subscript': 'subscript',
	'associated type': 'associatedtype',
	module: 'module',
	article: 'article',
	collection: 'collection',
	'ui preview': 'ui_preview',
	guide: 'guide',
	tutorial: 'tutorial',
	overview: 'overview',
	'sample code': 'sampleCode',
	samplecode: 'sampleCode',
	union: 'union',
	dictionary: 'dictionary',
	'property list key': 'property',
	object: 'dictionary',
};

/** Kinds that carry no classification and must never satisfy a kind filter. */
export const UNKNOWN_KINDS = ['symbol', 'unknown'] as const;

export const isUnknownKind = (kind: string | undefined): boolean =>
	typeof kind !== 'string' ||
	UNKNOWN_KINDS.includes(kind.trim().toLowerCase() as 'symbol' | 'unknown');

/**
 * Derive a symbol kind from DocC payloads.
 *
 * `metadata.symbolKind` / `roleHeading` are authoritative; reference objects in
 * a page's `references` map usually carry neither, and in that case the honest
 * answer is `unknown` — not `symbol`, which reads like a classification and
 * silently satisfies nothing (or worse, everything) when filtered.
 */
export function resolveSymbolKind(ref: any): string {
	if (!ref || typeof ref !== 'object') return 'unknown';

	for (const authority of [ref.symbolKind, ref.roleHeading]) {
		if (typeof authority !== 'string') continue;
		const key = authority.trim().toLowerCase();
		if (!key) continue;
		const mapped = SYMBOL_KIND_ALIASES[key];
		if (mapped) return mapped;
	}

	if (typeof ref.kind === 'string') {
		const kind = ref.kind.trim().toLowerCase();
		if (kind === 'article') return 'article';
		if (kind === 'collection') return 'collection';
		if (UNKNOWN_KINDS.includes(kind as 'symbol' | 'unknown')) return 'unknown';
		if (kind) return kind;
	}

	return 'unknown';
}

const PRIMARY_TYPE_KINDS = [
	'struct',
	'class',
	'protocol',
	'enum',
	'macro',
	'union',
];

export const isPrimaryTypeKind = (kind: string): boolean =>
	PRIMARY_TYPE_KINDS.includes(kind.toLowerCase());

function extractAbstract(abstractObj: any): string {
	if (!abstractObj) return '';
	if (typeof abstractObj === 'string') return abstractObj.trim();
	if (Array.isArray(abstractObj)) {
		return abstractObj
			.map((part) => {
				if (typeof part === 'string') return part;
				if (part && typeof part === 'object' && 'text' in part)
					return part.text || '';
				return '';
			})
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
	}
	return '';
}

export function indexFrameworkData(
	db: AppleDocsDB,
	framework: string,
	data: any,
	defaultPlatforms?: string[],
): number {
	let count = 0;

	const frameworkPlatforms = Array.isArray(data?.metadata?.platforms)
		? data.metadata.platforms.map((p: any) => p?.name || '').filter(Boolean)
		: defaultPlatforms || FRAMEWORK_DEFAULT_PLATFORMS[framework] || [];

	// Index page root symbol if present
	if (data?.metadata?.title && (data?.identifier?.url || data?.identifier)) {
		const rawUrl =
			typeof data.identifier?.url === 'string'
				? data.identifier.url
				: typeof data.identifier === 'string'
					? data.identifier
					: '';
		const pagePath = rawUrl.replace(/^doc:\/\/[^/]+/, '');
		if (pagePath.startsWith('/documentation/')) {
			const kind = resolveSymbolKind({
				symbolKind: data.metadata?.symbolKind,
				roleHeading: data.metadata?.roleHeading,
				kind: data.kind || 'symbol',
			});
			const isPrimary = isPrimaryTypeKind(kind);
			const targetFramework = resolveFrameworkFromPath(pagePath, framework);
			db.insertSymbol({
				id: pagePath,
				framework: targetFramework,
				title: data.metadata.title,
				kind,
				abstract: extractAbstract(data.abstract),
				path: pagePath,
				platforms: frameworkPlatforms,
				isPrimaryType: isPrimary,
			});
			count++;
		}
	}

	if (data?.references && typeof data.references === 'object') {
		for (const [id, ref] of Object.entries<any>(data.references)) {
			if (!ref || typeof ref !== 'object') continue;
			if (ref.kind !== 'symbol' && ref.kind !== 'article') continue;
			if (!ref.title) continue;

			const abstractText = extractAbstract(ref.abstract);
			const platforms: string[] =
				Array.isArray(ref.platforms) && ref.platforms.length > 0
					? ref.platforms.map((p: any) => p?.name || '').filter(Boolean)
					: frameworkPlatforms;

			const kind = resolveSymbolKind(ref);
			const isPrimary = isPrimaryTypeKind(kind);

			const symbolPath = ref.url || id;
			const targetFramework = resolveFrameworkFromPath(symbolPath, framework);

			db.insertSymbol({
				id: symbolPath,
				framework: targetFramework,
				title: ref.title,
				kind,
				abstract: abstractText,
				path: symbolPath,
				platforms,
				isPrimaryType: isPrimary,
			});
			count++;
		}
	}

	return count;
}

export interface DocCMediaItem {
	id: string;
	identifier: string;
	alt: string;
	url: string;
	mimeType: string;
}

export function extractMediaReferences(data: any): DocCMediaItem[] {
	if (!data?.references || typeof data.references !== 'object') return [];
	const items: DocCMediaItem[] = [];

	for (const [id, ref] of Object.entries<any>(data.references)) {
		if (!ref || typeof ref !== 'object') continue;
		if (ref.type !== 'image' && ref.type !== 'video' && ref.kind !== 'image')
			continue;

		const alt = ref.alt || ref.title || '';
		const variants: any[] = Array.isArray(ref.variants) ? ref.variants : [];

		let selectedVariant = variants.find(
			(v) =>
				Array.isArray(v.traits) &&
				v.traits.includes('light') &&
				v.traits.includes('2x'),
		);
		if (!selectedVariant) {
			selectedVariant = variants.find(
				(v) => Array.isArray(v.traits) && v.traits.includes('light'),
			);
		}
		if (!selectedVariant && variants.length > 0) {
			selectedVariant = variants[0];
		}

		if (selectedVariant?.url) {
			const rawUrl: string = selectedVariant.url;
			const fullUrl = rawUrl.startsWith('http')
				? rawUrl
				: `https://developer.apple.com/tutorials${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;

			const ext = fullUrl.split('.').pop()?.toLowerCase();
			let mimeType = 'image/png';
			if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
			else if (ext === 'svg') mimeType = 'image/svg+xml';
			else if (ext === 'mp4') mimeType = 'video/mp4';

			items.push({
				id,
				identifier: ref.identifier || id,
				alt,
				url: fullUrl,
				mimeType,
			});
		}
	}

	return items;
}

interface DocCIndexNode {
	title?: string;
	path?: string;
	type?: string;
	children?: DocCIndexNode[];
	external?: boolean;
}

export function indexFrameworkTree(
	db: AppleDocsDB,
	framework: string,
	indexData: any,
	defaultPlatforms?: string[],
): number {
	const interfaceLanguages = indexData?.interfaceLanguages;
	if (!interfaceLanguages || typeof interfaceLanguages !== 'object') return 0;

	// Swift is walked first to give its titles priority on collision, followed by occ
	// and any additional interface languages (e.g. c, objc, metal).
	const orderedKeys: string[] = [];
	if ('swift' in interfaceLanguages) orderedKeys.push('swift');
	if ('occ' in interfaceLanguages) orderedKeys.push('occ');
	for (const key of Object.keys(interfaceLanguages)) {
		if (key !== 'swift' && key !== 'occ') {
			orderedKeys.push(key);
		}
	}

	const allRoots: DocCIndexNode[] = [];
	for (const lang of orderedKeys) {
		const raw = interfaceLanguages[lang];
		if (Array.isArray(raw)) {
			for (const item of raw) {
				if (item && typeof item === 'object') {
					allRoots.push(item);
				}
			}
		} else if (raw && typeof raw === 'object') {
			allRoots.push(raw);
		}
	}

	if (allRoots.length === 0) return 0;

	let count = 0;
	const seenPaths = new Set<string>();
	const visitedNodes = new Set<DocCIndexNode>();

	function walk(node: DocCIndexNode) {
		if (!node || typeof node !== 'object') return;
		if (visitedNodes.has(node)) return;
		visitedNodes.add(node);

		if (node.path && node.title && node.type && node.type !== 'groupMarker') {
			const cleanPath = node.path.replace(/^doc:\/\/[^/]+/, '') || node.path;
			const pathKey = cleanPath.toLowerCase();
			if (!seenPaths.has(pathKey)) {
				seenPaths.add(pathKey);
				// The DocC navigation tree is the authoritative source for primary
				// type kinds, so it is normalised through the same resolver.
				const kind = resolveSymbolKind({ symbolKind: node.type });
				const isPrimary = isPrimaryTypeKind(kind);
				const targetFramework = resolveFrameworkFromPath(cleanPath, framework);
				const platforms =
					defaultPlatforms ||
					FRAMEWORK_DEFAULT_PLATFORMS[targetFramework] ||
					FRAMEWORK_DEFAULT_PLATFORMS[framework] ||
					[];
				db.insertSymbol({
					id: cleanPath,
					framework: targetFramework,
					title: node.title,
					kind,
					abstract: '', // Populated on-demand or during deep crawl
					path: cleanPath,
					platforms,
					isPrimaryType: isPrimary,
				});
				count++;
			}
		}

		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				walk(child);
			}
		}
	}

	for (const root of allRoots) {
		walk(root);
	}

	return count;
}
