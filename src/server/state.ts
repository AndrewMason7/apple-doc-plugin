import type { FrameworkData, Technology } from '../apple-client.js';

export type LastDiscovery = {
	query?: string;
	results: Technology[];
};

export class ServerState {
	private activeTechnology?: Technology;
	private activeFrameworkData?: FrameworkData;
	private lastDiscovery?: LastDiscovery;

	getActiveTechnology(): Technology | undefined {
		return this.activeTechnology;
	}

	setActiveTechnology(technology: Technology | undefined) {
		const previousTechnology = this.activeTechnology;
		this.activeTechnology = technology;

		if (
			!technology ||
			previousTechnology?.identifier !== technology.identifier
		) {
			this.activeFrameworkData = undefined;
		}
	}

	getActiveFrameworkData(): FrameworkData | undefined {
		return this.activeFrameworkData;
	}

	setActiveFrameworkData(data: FrameworkData | undefined) {
		this.activeFrameworkData = data;
	}

	clearActiveFrameworkData() {
		this.activeFrameworkData = undefined;
	}

	getLastDiscovery(): LastDiscovery | undefined {
		return this.lastDiscovery;
	}

	setLastDiscovery(lastDiscovery: LastDiscovery | undefined) {
		this.lastDiscovery = lastDiscovery;
	}
}
