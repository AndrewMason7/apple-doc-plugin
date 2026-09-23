import { AppleDocsDB } from '../db/database.js';
export declare function extractAbstract(abstractObj: any): string;
export declare function indexFrameworkData(db: AppleDocsDB, framework: string, data: any): number;
export interface DocCIndexNode {
    title?: string;
    path?: string;
    type?: string;
    children?: DocCIndexNode[];
    external?: boolean;
}
export declare function indexFrameworkTree(db: AppleDocsDB, framework: string, indexData: any): number;
