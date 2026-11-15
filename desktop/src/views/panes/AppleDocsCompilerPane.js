import { useMemo, useState } from 'react';
import {
	Badge,
	Button,
	Codicon,
	CopyButton,
	ScrollArea,
	Textarea,
	useMutation,
	usePluginI18n,
} from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import { PLUGIN_ID, STUDIO_ROUTE } from '../../data/constants.js';
import { COMPILER_PRESETS } from '../../data/fallbacks.js';
import { GlyphSpinner } from '../../components/GlyphSpinner.js';
import {
	localDiagnoseFallback,
	runPluginDiagnose,
} from '../../services/search-service.js';
import {
	safeHaptic,
	safeNavigate,
	safeOpenExternal,
	insertIntoChatComposer,
} from '../../services/host-bridge.js';

export function CompactCompilerLab({ ctx, rows = 4 }) {
	const t = usePluginI18n(PLUGIN_ID);
	const [compilerLog, setCompilerLog] = useState(COMPILER_PRESETS[0].log);

	const diagnoseMutation = useMutation({
		mutationFn: (textToAnalyze) => runPluginDiagnose(ctx, textToAnalyze),
	});

	const diagResult = useMemo(
		() =>
			diagnoseMutation.data?.result ||
			localDiagnoseFallback(COMPILER_PRESETS[0].log),
		[diagnoseMutation.data],
	);
	const diagnosing = diagnoseMutation.isPending;

	const runCompilerDiagnosis = (text) => {
		const body = typeof text === 'string' && text ? text : compilerLog;
		diagnoseMutation.mutate(body);
	};

	const findings =
		diagResult && Array.isArray(diagResult.findings) ? diagResult.findings : [];

	return jsxs('div', {
		className: 'flex-1 min-h-0 flex flex-col gap-2',
		children: [
			jsxs('div', {
				className: 'flex items-center gap-1 flex-wrap shrink-0',
				children: COMPILER_PRESETS.map((preset) =>
					jsx(
						Button,
						{
							size: 'xs',
							variant: 'outline',
							onClick: () => {
								setCompilerLog(preset.log);
								runCompilerDiagnosis(preset.log);
							},
							className: 'font-mono text-[10px] max-w-[150px] truncate',
							children: preset.label,
						},
						preset.label,
					),
				),
			}),
			jsx(Textarea, {
				value: compilerLog,
				onChange: (e) => setCompilerLog(e.target.value),
				rows,
				className: 'font-mono text-[10px] shrink-0',
				placeholder: t('compilerPlaceholder'),
			}),
			jsx(Button, {
				size: 'xs',
				variant: 'secondary',
				onClick: () => runCompilerDiagnosis(compilerLog),
				children: diagnosing ? t('diagnosing') : t('diagnoseBtn'),
			}),
			jsx(ScrollArea, {
				className: 'flex-1 min-h-0',
				children: jsxs('div', {
					className: 'flex flex-col gap-1.5 pr-1',
					children: findings.length
						? findings.map((f, idx) => {
								const replacementText = f.replacement || f.suggestion || '';
								const reasonText = f.reason || f.issue || '';
								const cleanInsertToken = replacementText
									.split('/')[0]
									.replace(/^@/, '')
									.split('(')[0]
									.trim();
								return jsxs(
									'div',
									{
										className:
											'rounded-lg border border-(--ui-stroke-secondary) p-2 flex flex-col gap-1 bg-(--ui-surface-secondary)/30',
										children: [
											jsxs('div', {
												className: 'flex items-center justify-between gap-1.5',
												children: [
													jsx('span', {
														className:
															'font-mono text-[10px] font-semibold text-(--ui-accent) truncate',
														children: f.symbol,
													}),
													jsx(Badge, {
														variant: 'muted',
														className: 'text-[9px] shrink-0',
														children: f.framework,
													}),
												],
											}),
											reasonText
												? jsx('p', {
														className: 'text-[10px] text-(--ui-text-tertiary)',
														children: reasonText,
													})
												: null,
											replacementText
												? jsxs('div', {
														className:
															'flex items-center justify-between gap-1 pt-1 border-t border-(--ui-stroke-secondary)/40',
														children: [
															jsx('span', {
																className:
																	'text-[10px] font-mono text-(--ui-text-primary) truncate',
																children: `→ ${replacementText}`,
															}),
															cleanInsertToken
																? jsx(Button, {
																		size: 'xs',
																		variant: 'ghost',
																		onClick: () =>
																			insertIntoChatComposer(
																				ctx,
																				`@apple:${f.framework}/${cleanInsertToken}`,
																				false,
																			),
																		children: 'Insert @apple:',
																	})
																: null,
														],
													})
												: null,
											f.fixSnippet
												? jsx('pre', {
														className:
															'rounded bg-(--ui-bg-input)/50 p-1.5 text-[9px] font-mono text-(--ui-text-secondary) overflow-x-auto',
														children: f.fixSnippet,
													})
												: null,
										],
									},
									`finding-${idx}`,
								);
							})
						: jsx('p', {
								className: 'text-[10px] text-(--ui-text-tertiary) p-2',
								children: t('noDeprecated'),
							}),
				}),
			}),
		],
	});
}

/**
 * Second docked pane: the Xcode Error Hook Lab, standalone.
 *
 * Not decoration — the desktop pane shell treats a plugin that owns exactly ONE
 * pane as disposable: closing that pane calls `setPluginEnabled(pluginId,
 * false)`, which unregisters every contribution the plugin ever made (the
 * sessions-sidebar row, the /apple-docs page, the statusbar chip, the palette
 * commands). With two panes, closing either one only dismisses that pane, so
 * the Apple Docs entry point can never be nuked by closing the docked studio.
 */
export function AppleDocsCompilerPane({ ctx }) {
	const t = usePluginI18n(PLUGIN_ID);

	return jsxs('div', {
		className: 'h-full w-full flex flex-col overflow-hidden p-3 gap-2',
		children: [
			jsxs('div', {
				className: 'flex items-center justify-between gap-2 shrink-0',
				children: [
					jsxs('div', {
						className: 'flex items-center gap-1.5 min-w-0',
						children: [
							jsx(Codicon, {
								name: 'warning',
								className: 'text-(--ui-accent) shrink-0',
							}),
							jsxs('div', {
								className: 'min-w-0',
								children: [
									jsx('div', {
										className:
											'text-xs font-semibold text-(--ui-text-primary) truncate',
										children: t('compilerPaneTitle'),
									}),
									jsx('div', {
										className: 'text-[10px] text-(--ui-text-tertiary) truncate',
										children: t('compilerPaneSubtitle'),
									}),
								],
							}),
						],
					}),
					jsx(Button, {
						size: 'xs',
						variant: 'ghost',
						onClick: () => safeNavigate(STUDIO_ROUTE),
						children: 'Studio ↗',
					}),
				],
			}),
			jsx(CompactCompilerLab, { ctx, rows: 5 }),
		],
	});
}
