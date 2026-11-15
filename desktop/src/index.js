/**
 * Apple Developer Documentation Studio — Hermes Desktop Plugin (`desktop/plugin.js`).
 *
 * Surfaces contributed strictly via `@hermes/plugin-sdk`:
 *  1. Workspace Page (`ROUTES_AREA`: `/apple-docs`) + Sidebar Nav (`SIDEBAR_NAV_AREA`)
 *     - 95.9k Symbol & DocC Explorer
 *     - Cross-Framework Idiom Rosetta Stone (React / Web CSS / Android Kotlin -> SwiftUI & Swift 6)
 *     - Swift / Xcode Compiler Diagnostic Grounding Lab (live simulator for `transform_terminal_output`)
 *     - 30-Framework Index Coverage & 1-Click Judge Showcase
 *  2. Dockable Right Inspector Pane (`PANES_AREA`: quick Apple API lookup beside chat)
 *  3. Inline Transcript Directive (`TRANSCRIPT_DIRECTIVE_AREA`: `::apple-doc{...}` rich API cards in chat)
 *  4. Statusbar Readiness Chip (`STATUSBAR_AREAS.right`) + Command Palette (`PALETTE_AREA`)
 */

import { PLUGIN_ID } from './data/constants.js';
import {
	buildContributions,
	registerContributions,
} from './contributions/register.js';

export default {
	id: PLUGIN_ID,
	name: 'Apple Developer Documentation',
	defaultEnabled: true,

	register(ctx) {
		if (ctx?.i18n?.register) {
			ctx.i18n.register({
				en: {
					statusTipLive: (n) => `Apple Docs (${n} symbols, live backend)`,
					statusTipOffline: (n) => `Apple Docs (${n} symbols, offline index)`,
					compilerPaneTitle: 'Xcode Error Hook',
					compilerPaneSubtitle: 'Offline deprecated-API migrations',
					compilerPlaceholder:
						'Paste swift build / xcodebuild error output here…',
					diagnoseBtn: 'Diagnose Errors',
					diagnosing: 'Diagnosing…',
					noDeprecated: 'No deprecated Apple symbols identified in output.',
				},
				ar: {
					statusTipLive: (n) => `توثيق أبل (${n} رمز، الخادم متصل)`,
					statusTipOffline: (n) => `توثيق أبل (${n} رمز، فهرس محلي)`,
					compilerPaneTitle: 'فاحص أخطاء Xcode',
					compilerPaneSubtitle: 'ترحيل واجهات API القديمة بدون نت',
					compilerPlaceholder: 'الصق مخرجات swift build أو xcodebuild هنا…',
					diagnoseBtn: 'تحليل الأخطاء',
					diagnosing: 'جاري التحليل…',
					noDeprecated: 'ما فيه رموز أبل مهجورة في المخرجات.',
				},
			});
		}

		return registerContributions(ctx, buildContributions(ctx));
	},
};
