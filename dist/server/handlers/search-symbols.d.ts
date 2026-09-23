import type { ServerContext, ToolResponse } from '../context.js';
export declare const buildSearchSymbolsHandler: (context: ServerContext) => (args: {
    framework?: string;
    maxResults?: number;
    platform?: string;
    query: string;
    symbolType?: string;
}) => Promise<ToolResponse>;
