import { bold, header, trimWithEllipsis } from '../markdown.js';
import { formatDeclaration, formatDeprecation, formatParameters, formatDiscussion, } from '../../apple-client/docc-formatter.js';
import { loadActiveFrameworkData } from '../services/framework-loader.js';
import { resolveSymbol } from '../services/symbol-resolution.js';
import { buildNoTechnologyMessage } from './no-technology.js';
const formatIdentifiers = (identifiers, references, client) => {
    const content = [];
    for (const id of identifiers.slice(0, 5)) {
        const ref = references?.[id];
        if (ref) {
            const refDesc = client.extractText(ref.abstract ?? []);
            content.push(`• **${ref.title}** - ${trimWithEllipsis(refDesc, 100)}`);
        }
    }
    if (identifiers.length > 5) {
        content.push(`*... and ${identifiers.length - 5} more items*`);
    }
    return content;
};
const formatTopicSections = (data, client) => {
    const content = [];
    if (data.topicSections?.length) {
        content.push('', header(2, 'API Reference'), '');
        for (const section of data.topicSections) {
            content.push(`### ${section.title}`);
            if (section.identifiers?.length) {
                content.push(...formatIdentifiers(section.identifiers, data.references, client));
            }
            content.push('');
        }
    }
    return content;
};
export const buildGetDocumentationHandler = (context) => {
    const { client, state, db } = context;
    const noTechnology = buildNoTechnologyMessage(context);
    return async (args) => {
        const { path, framework: frameworkArg } = args;
        if (typeof path !== 'string' || path.trim().length === 0) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: 'Error: A non-empty "path" parameter is required.',
                    },
                ],
            };
        }
        let activeTechnology = state.getActiveTechnology();
        if (frameworkArg &&
            typeof frameworkArg === 'string' &&
            frameworkArg.trim().length > 0) {
            const cleanFw = frameworkArg.trim();
            activeTechnology = {
                identifier: `doc://com.apple.documentation/documentation/${cleanFw}`,
                title: cleanFw,
                kind: 'symbol',
                role: 'collection',
                url: `/documentation/${cleanFw.toLowerCase()}`,
                abstract: [],
            };
        }
        // If no technology is explicitly selected, check local database or path prefix
        if (!activeTechnology && db) {
            const dbSym = db.getSymbolByPath(path);
            if (dbSym) {
                activeTechnology = {
                    identifier: `doc://com.apple.documentation/documentation/${dbSym.framework}`,
                    title: dbSym.framework,
                    kind: 'symbol',
                    role: 'collection',
                    url: `/documentation/${dbSym.framework.toLowerCase()}`,
                    abstract: [],
                };
            }
        }
        if (!activeTechnology) {
            const match = path.replace(/^\/+/, '').match(/^documentation\/([^/]+)/i);
            if (match) {
                const fw = match[1];
                activeTechnology = {
                    identifier: `doc://com.apple.documentation/documentation/${fw}`,
                    title: fw,
                    kind: 'symbol',
                    role: 'collection',
                    url: `/documentation/${fw.toLowerCase()}`,
                    abstract: [],
                };
            }
        }
        if (!activeTechnology) {
            return noTechnology();
        }
        try {
            const effectiveContext = state.getActiveTechnology()
                ? context
                : {
                    ...context,
                    state: new Proxy(state, {
                        get(target, prop, receiver) {
                            if (prop === 'getActiveTechnology') {
                                return () => activeTechnology;
                            }
                            return Reflect.get(target, prop, receiver);
                        },
                    }),
                };
            let frameworkPlatforms = [];
            try {
                const framework = await loadActiveFrameworkData(effectiveContext);
                frameworkPlatforms = framework.metadata?.platforms ?? [];
            }
            catch {
                // Fall back gracefully if full framework metadata isn't available
            }
            const { data } = await resolveSymbol(client, activeTechnology, path, frameworkArg);
            const title = data.metadata?.title || 'Symbol';
            const kind = data.metadata?.symbolKind || 'Unknown';
            const platforms = client.formatPlatforms(data.metadata?.platforms ?? frameworkPlatforms);
            const description = client.extractText(data.abstract);
            const content = [
                header(1, title),
                '',
                bold('Technology', activeTechnology.title),
                bold('Type', kind),
                bold('Platforms', platforms),
                '',
            ];
            const deprecation = formatDeprecation(data.deprecationSummary);
            if (deprecation) {
                content.push(deprecation, '');
            }
            const declaration = formatDeclaration(data.primaryContentSections);
            if (declaration) {
                content.push(header(2, 'Declaration'), declaration, '');
            }
            if (description) {
                content.push(header(2, 'Overview'), description, '');
            }
            const parameters = formatParameters(data.primaryContentSections);
            if (parameters) {
                content.push(parameters, '');
            }
            const discussion = formatDiscussion(data.primaryContentSections);
            if (discussion) {
                content.push(header(2, 'Discussion'), discussion, '');
            }
            content.push(...formatTopicSections(data, client));
            return {
                content: [{ text: content.join('\n').trim(), type: 'text' }],
            };
        }
        catch (error) {
            // If online fetch fails, check if local db has symbol metadata to return as graceful fallback
            const dbSym = db?.getSymbolByPath(path);
            if (dbSym) {
                return {
                    content: [
                        {
                            text: [
                                header(1, dbSym.title),
                                '',
                                bold('Technology', dbSym.framework),
                                bold('Type', dbSym.kind),
                                bold('Platforms', dbSym.platforms.length > 0
                                    ? dbSym.platforms.join(', ')
                                    : 'All platforms'),
                                '',
                                header(2, 'Overview'),
                                dbSym.abstract ||
                                    `Official Apple documentation available at https://developer.apple.com${dbSym.path}`,
                            ].join('\n'),
                            type: 'text',
                        },
                    ],
                };
            }
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Failed to load documentation for "${path}": ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    };
};
//# sourceMappingURL=get-documentation.js.map