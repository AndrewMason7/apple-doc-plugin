import { AppleDocsDB } from '../db/database.js';
export declare function indexFrameworkData(db: AppleDocsDB, framework: string, data: any, defaultPlatforms?: string[]): number;
export interface DocCMediaItem {
    id: string;
    identifier: string;
    alt: string;
    url: string;
    mimeType: string;
}
export declare function extractMediaReferences(data: any): DocCMediaItem[];
export declare function indexFrameworkTree(db: AppleDocsDB, framework: string, indexData: any, defaultPlatforms?: string[]): number;
