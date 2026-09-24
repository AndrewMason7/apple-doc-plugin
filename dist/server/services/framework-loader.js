import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
export const loadActiveFrameworkData = async ({ client, state, }) => {
    const activeTechnology = state.getActiveTechnology();
    if (!activeTechnology) {
        throw new McpError(ErrorCode.InvalidRequest, 'No technology selected. Use `discover_technologies` then `choose_technology` first.');
    }
    const cached = state.getActiveFrameworkData();
    if (cached) {
        return cached;
    }
    const identifierParts = activeTechnology.identifier.split('/');
    const frameworkName = identifierParts.at(-1);
    if (!frameworkName) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid technology identifier: ${activeTechnology.identifier}`);
    }
    const data = await client.getFramework(frameworkName);
    state.setActiveFrameworkData(data);
    return data;
};
//# sourceMappingURL=framework-loader.js.map