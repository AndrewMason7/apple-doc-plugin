import { AppleDocsDB } from '../db/database.js';
export declare function extractAbstract(abstractObj: any): string;
export declare function indexFrameworkData(db: AppleDocsDB, framework: string, data: any): number;
export interface DocCMediaItem {
    id: string;
    identifier: string;
    alt: string;
    url: string;
    mimeType: string;
}
export declare function extractMediaReferences(data: any): DocCMediaItem[];
export interface DocCIndexNode {
    title?: string;
    path?: string;
    type?: string;
    children?: DocCIndexNode[];
    external?: boolean;
}
export declare function indexFrameworkTree(db: AppleDocsDB, framework: string, indexData: any): number;
