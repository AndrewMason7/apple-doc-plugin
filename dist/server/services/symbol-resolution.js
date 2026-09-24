import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
const normalizePath = (path) => path.startsWith('/') ? path.slice(1) : path;
const getFrameworkName = (technology) => {
    const frameworkName = technology.identifier.split('/').at(-1);
    if (!frameworkName) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid technology identifier: ${technology.identifier}`);
    }
    return frameworkName;
};
const buildCandidatePaths = (technology, path, frameworkOverride) => {
    const normalizedPath = normalizePath(path.trim());
    const frameworkName = frameworkOverride || getFrameworkName(technology);
    const candidates = new Set();
    if (normalizedPath && !normalizedPath.startsWith('documentation/')) {
        candidates.add(`documentation/${frameworkName}/${normalizedPath}`);
    }
    if (normalizedPath) {
        candidates.add(normalizedPath);
    }
    return [...candidates];
};
export const resolveSymbol = async (client, technology, path, frameworkOverride) => {
    let lastError;
    for (const candidate of buildCandidatePaths(technology, path, frameworkOverride)) {
        try {
            const data = await client.getSymbol(candidate);
            return { data, targetPath: candidate };
        }
        catch (error) {
            lastError = error;
        }
    }
    throw new McpError(ErrorCode.InvalidRequest, `Failed to load documentation for "${path}": ${lastError instanceof Error ? lastError.message : String(lastError)}`);
};
//# sourceMappingURL=symbol-resolution.js.map