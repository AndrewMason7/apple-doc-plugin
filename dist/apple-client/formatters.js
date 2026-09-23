// Helper to extract text from abstract array
export const extractText = (abstract = []) => abstract?.map((item) => item.text).join('') || '';
// Helper to format platform availability
export const formatPlatforms = (platforms) => {
    if (!platforms || platforms.length === 0) {
        return 'All platforms';
    }
    return platforms
        .map((p) => `${p.name} ${p.introducedAt}${p.beta ? ' (Beta)' : ''}`)
        .join(', ');
};
//# sourceMappingURL=formatters.js.map