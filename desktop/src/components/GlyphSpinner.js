import { Codicon, GlyphSpinner as SdkGlyphSpinner } from '@hermes/plugin-sdk';
import { jsx } from 'react/jsx-runtime';

export function GlyphSpinner({ className = '' }) {
	if (typeof SdkGlyphSpinner === 'function') {
		return jsx(SdkGlyphSpinner, { className });
	}
	return jsx(Codicon, {
		name: 'loading',
		className:
			`inline-block animate-spin text-(--ui-accent) text-xs ${className}`.trim(),
	});
}
