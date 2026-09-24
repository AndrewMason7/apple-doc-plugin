import type { DocCContentNode, DocCInlineContent, DocCPrimaryContentSection } from './types/index.js';
export declare const formatInlineContent: (nodes?: DocCInlineContent[]) => string;
export declare const formatContentNodes: (nodes?: DocCContentNode[]) => string;
export declare const formatDeclaration: (sections?: DocCPrimaryContentSection[]) => string | undefined;
export declare const formatDeprecation: (summary?: DocCContentNode[]) => string | undefined;
export declare const formatParameters: (sections?: DocCPrimaryContentSection[]) => string | undefined;
export declare const formatDiscussion: (sections?: DocCPrimaryContentSection[]) => string | undefined;
