export const CORE_FRAMEWORKS = [
	'SwiftUI',
	'UIKit',
	'Foundation',
	'SwiftData',
	'Combine',
	'AppKit',
	'Observation',
	'CoreLocation',
] as const;

export type CoreFramework = (typeof CORE_FRAMEWORKS)[number];
