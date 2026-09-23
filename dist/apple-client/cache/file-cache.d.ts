import type { FrameworkData, SymbolData, Technology } from '../types/index.js';
export declare class FileCache {
    private readonly docsDir;
    private readonly technologiesCachePath;
    constructor(baseDir?: string);
    loadFramework(frameworkName: string): Promise<FrameworkData | undefined>;
    saveFramework(frameworkName: string, data: FrameworkData): Promise<void>;
    loadSymbol(path: string): Promise<SymbolData | undefined>;
    saveSymbol(path: string, data: SymbolData): Promise<void>;
    loadTechnologies(): Promise<Record<string, Technology> | undefined>;
    saveTechnologies(technologies: Record<string, Technology>): Promise<void>;
    private sanitizeFrameworkName;
    private ensureCacheDir;
    private getCachePath;
}
