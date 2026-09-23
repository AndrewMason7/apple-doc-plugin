import type { PlatformInfo } from './types/index.js';
export declare const extractText: (abstract?: Array<{
    text: string;
    type: string;
}>) => string;
export declare const formatPlatforms: (platforms: PlatformInfo[]) => string;
