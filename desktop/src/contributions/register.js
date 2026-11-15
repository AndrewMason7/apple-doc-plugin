/**
 * Apple Developer Documentation Studio — Contributions Registrar
 */

import {
	PALETTE_AREA,
	PANES_AREA,
	ROUTES_AREA,
	SIDEBAR_NAV_AREA,
	STATUSBAR_AREAS,
	TRANSCRIPT_DIRECTIVE_AREA,
} from '@hermes/plugin-sdk';
import { jsx } from 'react/jsx-runtime';
import { STUDIO_ROUTE } from '../data/constants.js';
import { AppleDocsStudioPage } from '../views/studio/AppleDocsStudioPage.js';
import { AppleDocsSidePane } from '../views/panes/AppleDocsSidePane.js';
import { AppleDocsCompilerPane } from '../views/panes/AppleDocsCompilerPane.js';
import { AppleDocsStatusChip } from '../views/status/AppleDocsStatusChip.js';
import { InlineAppleDocCard } from '../components/InlineAppleDocCard.js';
import {
	safeNavigate,
	safeOpenPane,
	sendDemoCommandInChat,
} from '../services/host-bridge.js';

export function registerContributions(ctx, entries) {
	if (typeof ctx?.registerMany === 'function') {
		return ctx.registerMany(entries);
	}
	if (typeof ctx?.register === 'function') {
		const disposers = [];
		for (const entry of entries) {
			try {
				const dispose = ctx.register(entry);
				if (typeof dispose === 'function') disposers.push(dispose);
			} catch (err) {
				console.warn(
					`[apple-doc-plugin] failed to register contribution ${entry.id}:`,
					err,
				);
			}
		}
		return () => {
			for (const dispose of disposers) dispose();
		};
	}
	return undefined;
}

export function buildContributions(ctx) {
	const statusbarArea =
		(STATUSBAR_AREAS && STATUSBAR_AREAS.right) || 'statusBar.right';

	return [
		{
			id: 'studio-route',
			area: ROUTES_AREA,
			data: { path: STUDIO_ROUTE },
			render: () => jsx(AppleDocsStudioPage, { ctx }),
		},
		{
			// Route-agnostic sidebar entry: `data.path` navigates to /apple-docs
			// when clicked, without gating visibility to a single route.
			id: 'sidebar-nav',
			area: SIDEBAR_NAV_AREA,
			order: 62,
			data: {
				path: STUDIO_ROUTE,
				label: 'Apple Docs',
				codicon: 'book',
			},
		},
		{
			id: 'inspector-pane',
			area: PANES_AREA,
			title: 'Apple Docs',
			data: {
				placement: 'right',
				width: '380px',
				dock: {
					pane: 'workspace',
					pos: 'right',
				},
			},
			render: () => jsx(AppleDocsSidePane, { ctx }),
		},
		{
			// Second pane: keeps Close as a dismiss instead of disabling the
			// entire plugin when the user closes one pane.
			id: 'compiler-pane',
			area: PANES_AREA,
			title: 'Apple Docs: Xcode Errors',
			data: {
				placement: 'right',
				width: '360px',
				dock: {
					pane: 'workspace',
					pos: 'right',
				},
			},
			render: () => jsx(AppleDocsCompilerPane, { ctx }),
		},
		{
			id: 'inline-directive',
			area: TRANSCRIPT_DIRECTIVE_AREA,
			data: {
				name: 'apple-doc',
				render: (props) =>
					jsx(InlineAppleDocCard, {
						ctx,
						attrs: props?.attrs || {},
						sessionId: props?.sessionId,
						streaming: props?.streaming,
					}),
			},
		},
		{
			id: 'statusbar-chip',
			area: statusbarArea,
			order: 118,
			render: () => jsx(AppleDocsStatusChip, { ctx }),
		},
		{
			id: 'palette-open',
			area: PALETTE_AREA,
			data: {
				id: 'apple-docs.open-studio',
				label: 'Apple Docs: Open Documentation (Side Pane)',
				keywords: [
					'apple',
					'swift',
					'swiftui',
					'ios',
					'macos',
					'docc',
					'xcode',
					'documentation',
					'side',
					'pane',
				],
				run: () => {
					if (!safeOpenPane('inspector-pane')) {
						safeNavigate(STUDIO_ROUTE);
					}
				},
			},
		},
		{
			id: 'palette-compiler',
			area: PALETTE_AREA,
			data: {
				id: 'apple-docs.open-compiler',
				label: 'Apple Docs: Open Xcode Error Hook (Side Pane)',
				keywords: [
					'apple',
					'xcode',
					'swift',
					'error',
					'build',
					'deprecated',
					'compiler',
				],
				run: () => {
					if (!safeOpenPane('compiler-pane')) {
						safeNavigate(STUDIO_ROUTE);
					}
				},
			},
		},
		{
			id: 'palette-demo',
			area: PALETTE_AREA,
			data: {
				id: 'apple-docs.run-demo',
				label: 'Apple Docs: Load /apple-docs demo Showcase in Chat',
				keywords: ['apple', 'demo', 'hackathon', 'benchmark', 'swiftui'],
				run: () => sendDemoCommandInChat(ctx),
			},
		},
	];
}
