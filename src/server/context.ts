import type { AppleDevDocsClient } from '../apple-client.js';
import type { ServerState } from './state.js';
import type { AppleDocsDB } from './db/database.js';
import type { HybridSearchEngine } from './services/search/hybrid-search.js';

export type ToolResponse = {
	content: Array<{
		text: string;
		type: 'text';
	}>;
	isError?: boolean;
};


export type ServerContext = {
	client: AppleDevDocsClient;
	state: ServerState;
	db?: AppleDocsDB;
	searchEngine?: HybridSearchEngine;
};
