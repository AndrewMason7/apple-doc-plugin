/**
 * Apple Developer Documentation Studio — Statusbar Chip
 */

import { StatusDot, Tip, usePluginI18n, useQuery } from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import { PLUGIN_ID, STUDIO_ROUTE } from '../../data/constants.js';
import { FALLBACK_STATS } from '../../data/fallbacks.js';
import { fetchPluginStatus } from '../../services/search-service.js';
import {
	safeHaptic,
	safeNavigate,
	safeOpenPane,
} from '../../services/host-bridge.js';

export function formatCompactCount(count) {
	const num = Number(count) || 0;
	if (num >= 1000) {
		return `${(num / 1000).toFixed(1)}k`;
	}
	return String(num);
}

export function AppleDocsStatusChip({ ctx }) {
	const t = usePluginI18n(PLUGIN_ID);
	const statusQuery = useQuery({
		queryKey: [PLUGIN_ID, 'status'],
		queryFn: () => fetchPluginStatus(ctx),
		staleTime: 30_000,
	});
	const stats = statusQuery.data?.stats || FALLBACK_STATS;
	const apiLive = Boolean(statusQuery.data?.apiLive);
	const symbolCount = stats.symbolCount || FALLBACK_STATS.symbolCount;
	const compact = formatCompactCount(symbolCount);

	return jsx(Tip, {
		label: apiLive
			? t('statusTipLive', symbolCount.toLocaleString())
			: t('statusTipOffline', symbolCount.toLocaleString()),
		children: jsxs('button', {
			type: 'button',
			onClick: () => {
				safeHaptic('tap');
				if (!safeOpenPane('inspector-pane')) {
					safeNavigate(STUDIO_ROUTE);
				}
			},
			className:
				'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-(--ui-text-tertiary) hover:text-(--ui-text-primary) hover:bg-(--chrome-action-hover) transition-colors cursor-pointer',
			children: [
				jsx(StatusDot, {
					tone: apiLive ? 'success' : 'neutral',
				}),
				` ${compact} Docs`,
			],
		}),
	});
}
