export class ServerState {
    activeTechnology;
    activeFrameworkData;
    lastDiscovery;
    getActiveTechnology() {
        return this.activeTechnology;
    }
    setActiveTechnology(technology) {
        const previousTechnology = this.activeTechnology;
        this.activeTechnology = technology;
        if (!technology ||
            previousTechnology?.identifier !== technology.identifier) {
            this.activeFrameworkData = undefined;
        }
    }
    getActiveFrameworkData() {
        return this.activeFrameworkData;
    }
    setActiveFrameworkData(data) {
        this.activeFrameworkData = data;
    }
    clearActiveFrameworkData() {
        this.activeFrameworkData = undefined;
    }
    getLastDiscovery() {
        return this.lastDiscovery;
    }
    setLastDiscovery(lastDiscovery) {
        this.lastDiscovery = lastDiscovery;
    }
}
//# sourceMappingURL=state.js.map