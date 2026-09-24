import type { FrameworkData, SymbolData, Technology } from './apple-client/types/index.js';
export type { PlatformInfo, FrameworkData, SymbolData, Technology, TopicSection, ReferenceData, } from './apple-client/types/index.js';
export declare class AppleDevDocsClient {
    extractText: (abstract?: Array<{
        text: string;
        type: string;
    }>) => string;
    formatPlatforms: (platforms: import("./apple-client/types/index.js").PlatformInfo[]) => string;
    private readonly httpClient;
    private readonly fileCache;
    constructor();
    getFramework(frameworkName: string): Promise<FrameworkData>;
    getSymbol(path: string): Promise<SymbolData>;
    getTechnologies(): Promise<Record<string, Technology>>;
}
