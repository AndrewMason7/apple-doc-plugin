import { CORE_FRAMEWORKS } from './frameworks.js';

/**
 * Canonical Apple framework names keyed by the lowercase slug DocC uses in
 * documentation paths. Anything absent here falls back to the framework the
 * caller already knows about, so attribution never invents a name.
 */
const CANONICAL_SLUGS: Record<string, string> = {
	swiftui: 'SwiftUI',
	uikit: 'UIKit',
	foundation: 'Foundation',
	swiftdata: 'SwiftData',
	combine: 'Combine',
	appkit: 'AppKit',
	observation: 'Observation',
	corelocation: 'CoreLocation',
	swift: 'Swift',
	regexbuilder: 'RegexBuilder',
	synchronization: 'Synchronization',
	distributed: 'Distributed',
	widgetkit: 'WidgetKit',
	avfoundation: 'AVFoundation',
	avfaudio: 'AVFAudio',
	passkit: 'PassKit',
	bundleresources: 'BundleResources',
	xcode: 'Xcode',
	visionos: 'visionOS',
	objectivec: 'ObjectiveC',
	storekit: 'StoreKit',
	cloudkit: 'CloudKit',
	mapkit: 'MapKit',
	coregraphics: 'CoreGraphics',
	coreimage: 'CoreImage',
	coredata: 'CoreData',
	avkit: 'AVKit',
	webkit: 'WebKit',
	cryptokit: 'CryptoKit',
	os: 'os',
	darwin: 'Darwin',
	dispatch: 'Dispatch',
};

const DOCUMENTATION_SEGMENT = '/documentation/';

/**
 * Extract the framework slug from any DocC identifier shape the indexer sees:
 *   doc://com.apple.SwiftUI/documentation/SwiftUI/AngularGradient
 *   /documentation/uikit/nsview
 *   documentation/regexbuilder/regex
 *   swiftui/view
 *   uikit
 */
export function frameworkSlugFromPath(raw: string): string | undefined {
	if (typeof raw !== 'string') return undefined;

	let value = raw.trim();
	if (!value) return undefined;

	const markerIndex = value.toLowerCase().indexOf(DOCUMENTATION_SEGMENT);
	if (markerIndex !== -1) {
		value = value.slice(markerIndex + DOCUMENTATION_SEGMENT.length);
	} else if (value.toLowerCase().startsWith('documentation/')) {
		value = value.slice('documentation/'.length);
	} else {
		value = value.replace(/^\/+/, '');
	}

	const slug = value.split('/')[0]?.trim().toLowerCase();
	return slug ? slug : undefined;
}

/**
 * Map a path slug to the canonical framework name. Returns undefined when the
 * slug is not a known framework, so callers can keep their own attribution
 * instead of fabricating one from a random path segment.
 */
export function canonicalFrameworkFromSlug(
	slug: string | undefined,
): string | undefined {
	if (!slug) return undefined;

	const direct = CANONICAL_SLUGS[slug];
	if (direct) return direct;

	const core = CORE_FRAMEWORKS.find(
		(framework) => framework.toLowerCase() === slug,
	);
	return core;
}
