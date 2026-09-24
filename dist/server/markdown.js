export const header = (level, text) => `${'#'.repeat(Math.max(1, level))} ${text}`;
export const bold = (label, value) => `**${label}:** ${value}`;
export const trimWithEllipsis = (text, maxLength) => {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength))}...`;
};
//# sourceMappingURL=markdown.js.map