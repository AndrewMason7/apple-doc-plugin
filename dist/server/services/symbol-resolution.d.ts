import type { AppleDevDocsClient, SymbolData, Technology } from '../../apple-client.js';
export declare const resolveSymbol: (client: AppleDevDocsClient, technology: Technology, path: string, frameworkOverride?: string) => Promise<{
    data: SymbolData;
    targetPath: string;
}>;
