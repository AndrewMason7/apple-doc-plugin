import type { FrameworkData, Technology } from '../apple-client.js';
export type LastDiscovery = {
    query?: string;
    results: Technology[];
};
export declare class ServerState {
    private activeTechnology?;
    private activeFrameworkData?;
    private lastDiscovery?;
    getActiveTechnology(): Technology | undefined;
    setActiveTechnology(technology: Technology | undefined): void;
    getActiveFrameworkData(): FrameworkData | undefined;
    setActiveFrameworkData(data: FrameworkData | undefined): void;
    clearActiveFrameworkData(): void;
    getLastDiscovery(): LastDiscovery | undefined;
    setLastDiscovery(lastDiscovery: LastDiscovery | undefined): void;
}
