export const header = (level: number, text: string): string =>
	`${'#'.repeat(Math.max(1, level))} ${text}`;

export const bold = (label: string, value: string): string =>
	`**${label}:** ${value}`;

export const trimWithEllipsis = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) {
		return text;
	}

	return `${text.slice(0, Math.max(0, maxLength))}...`;
};
