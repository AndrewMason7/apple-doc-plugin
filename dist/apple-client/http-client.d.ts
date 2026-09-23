export declare class HttpClient {
    private readonly cache;
    constructor();
    makeRequest<T>(path: string): Promise<T>;
    getDocumentation<T>(path: string): Promise<T>;
    clearCache(): void;
}
