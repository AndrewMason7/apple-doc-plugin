import type { ServerContext, ToolResponse } from '../context.js';
export declare const buildGetDocumentationHandler: (context: ServerContext) => (args: {
    path: string;
    framework?: string;
}) => Promise<ToolResponse>;
