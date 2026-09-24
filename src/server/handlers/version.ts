import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJsonPath = join(__dirname, '../../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
	version: string;
	name: string;
	description: string;
	author: string;
	repository?: { url: string };
};

import type { ServerContext, ToolResponse } from '../context.js';
import { CORE_FRAMEWORKS } from '../db/frameworks.js';

export interface IndexMetadata {
	version: string;
	serverName: string;
	dbPath: string;
	symbolCount: number;
	indexedFrameworks: string[];
	builtAt: string;
	embeddingsPresent: boolean;
}

export const getIndexMetadata = (context?: ServerContext): IndexMetadata => {
	const db = context?.db;
	const symbolCount = db ? db.getSymbolCount() : 0;
	const dbFrameworks = db ? db.getIndexedFrameworks() : [];
	const indexedFrameworks =
		dbFrameworks.length > 0 ? dbFrameworks : [...CORE_FRAMEWORKS];
	const builtAt = db?.getMeta('built_at') || 'Not recorded in snapshot';
	const embeddingsPresent = db ? db.hasEmbeddings() : false;
	const dbPath = db?.dbPath || 'None (uninitialized)';

	return {
		version: packageJson.version,
		serverName: packageJson.name,
		dbPath,
		symbolCount,
		indexedFrameworks,
		builtAt,
		embeddingsPresent,
	};
};

export const buildVersionHandler =
	(context?: ServerContext) => async (): Promise<ToolResponse> => {
		const meta = getIndexMetadata(context);

		const text = `Apple Doc MCP Server Version & Index Information:

📦 Server Version: ${meta.version}
🏷️ Server Name: ${meta.serverName}
📝 Description: ${packageJson.description}
📁 Database Path: ${meta.dbPath}
📊 Indexed Symbols: ${meta.symbolCount}
📦 Indexed Frameworks: ${meta.indexedFrameworks.join(', ')}
🕒 Snapshot Built At: ${meta.builtAt}
✨ Embeddings Present: ${meta.embeddingsPresent ? 'Yes (hybrid multimodal search enabled)' : 'No (lexical FTS5 only)'}
👤 Author: ${packageJson.author}
🔗 Repository: ${packageJson.repository?.url ?? 'N/A'}`;

		return {
			content: [
				{
					type: 'text',
					text,
				},
			],
		};
	};
