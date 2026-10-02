import type { Technology } from '../apple-client.js';

export type LastDiscovery = {
	query?: string;
	results: Technology[];
};

export class ServerState {
	private lastDiscovery?: LastDiscovery;

	getLastDiscovery(): LastDiscovery | undefined {
		return this.lastDiscovery;
	}

	setLastDiscovery(lastDiscovery: LastDiscovery | undefined) {
		this.lastDiscovery = lastDiscovery;
	}
}
