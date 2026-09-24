import { AppleDocsDB } from '../db/database.js';
import { CORE_FRAMEWORKS } from '../db/frameworks.js';

export function resolveFrameworkFromPath(
	path: string,
	fallback: string,
): string {
	const match = path.replace(/^\/+/, '').match(/^documentation\/([^/]+)/i);
	if (!match) return fallback;
	const slug = match[1].toLowerCase();
	if (slug === fallback.toLowerCase()) return fallback;
	if (slug === 'swift') return 'Swift';
	if (slug === 'synchronization') return 'Synchronization';
	if (slug === 'regexbuilder') return 'RegexBuilder';
	if (slug === 'distributed') return 'Distributed';
	const known = CORE_FRAMEWORKS.find((cf) => cf.toLowerCase() === slug);
	if (known) return known;
	return match[1].charAt(0).toUpperCase() + match[1].slice(1);
}

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

const FRAMEWORK_DEFAULT_PLATFORMS: Record<string, string[]> = {
	SwiftUI: [
		'iOS',
		'iPadOS',
		'Mac Catalyst',
		'macOS',
		'tvOS',
		'visionOS',
		'watchOS',
	],
	UIKit: ['iOS', 'iPadOS', 'Mac Catalyst', 'tvOS', 'visionOS'],
	Foundation: [
		'iOS',
		'iPadOS',
		'Mac Catalyst',
		'macOS',
		'tvOS',
		'visionOS',
		'watchOS',
	],
	SwiftData: [
		'iOS',
		'iPadOS',
		'Mac Catalyst',
		'macOS',
		'tvOS',
		'visionOS',
		'watchOS',
	],
	Combine: [
		'iOS',
		'iPadOS',
		'Mac Catalyst',
		'macOS',
		'tvOS',
		'visionOS',
		'watchOS',
	],
	AppKit: ['macOS'],
	Observation: [
		'iOS',
		'iPadOS',
		'Mac Catalyst',
		'macOS',
		'tvOS',
		'visionOS',
		'watchOS',
	],
	CoreLocation: [
		'iOS',
		'iPadOS',
		'Mac Catalyst',
		'macOS',
		'tvOS',
		'watchOS',
		'visionOS',
	],
};

export function indexFrameworkData(
	db: AppleDocsDB,
	framework: string,
	data: any,
	defaultPlatforms?: string[],
): number {
	if (!data?.references || typeof data.references !== 'object') return 0;
	let count = 0;

	const frameworkPlatforms = Array.isArray(data?.metadata?.platforms)
		? data.metadata.platforms.map((p: any) => p?.name || '').filter(Boolean)
		: defaultPlatforms || FRAMEWORK_DEFAULT_PLATFORMS[framework] || [];

	for (const [id, ref] of Object.entries<any>(data.references)) {
		if (!ref || typeof ref !== 'object') continue;
		if (ref.kind !== 'symbol' && ref.kind !== 'article') continue;
		if (!ref.title) continue;

		const abstractText = extractAbstract(ref.abstract);
		const platforms: string[] =
			Array.isArray(ref.platforms) && ref.platforms.length > 0
				? ref.platforms.map((p: any) => p?.name || '').filter(Boolean)
				: frameworkPlatforms;

		const kind = ref.symbolKind || ref.kind || 'symbol';
		const isPrimary = ['struct', 'class', 'protocol', 'enum', 'macro'].includes(
			kind.toLowerCase(),
		);

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
	const root = indexData?.interfaceLanguages?.swift?.[0];
	if (!root) return 0;

	const nodePlatforms =
		defaultPlatforms || FRAMEWORK_DEFAULT_PLATFORMS[framework] || [];
	let count = 0;

	function walk(node: DocCIndexNode) {
		if (node.path && node.title && node.type && node.type !== 'groupMarker') {
			const isPrimary = [
				'struct',
				'class',
				'protocol',
				'enum',
				'macro',
			].includes(node.type.toLowerCase());
			const targetFramework = resolveFrameworkFromPath(node.path, framework);
			db.insertSymbol({
				id: node.path,
				framework: targetFramework,
				title: node.title,
				kind: node.type,
				abstract: '', // Populated on-demand or during deep crawl
				path: node.path,
				platforms: nodePlatforms,
				isPrimaryType: isPrimary,
			});
			count++;
		}

		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				walk(child);
			}
		}
	}

	walk(root);
	return count;
}
