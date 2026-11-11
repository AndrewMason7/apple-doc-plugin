(function () {
	'use strict';

	// Apple Docs dashboard tab — plain IIFE bundle (no build step), per the Hermes
	// dashboard plugin docs: https://hermes-agent.nousresearch.com/docs → Extending the Dashboard.
	// Talks only to this dashboard's own origin via SDK.fetchJSON (session-auth-injecting,
	// same-origin-only fetcher) against the plugin's own FastAPI router mounted at
	// /api/plugins/apple-doc-plugin/* (see dashboard/plugin_api.py).

	var SDK = window.__HERMES_PLUGIN_SDK__;
	if (!SDK || !window.__HERMES_PLUGINS__) return;

	var React = SDK.React;
	var hooks = SDK.hooks;
	var components = SDK.components;
	var fetchJSON = SDK.fetchJSON;

	var API = '/api/plugins/apple-doc-plugin';

	var Card = components.Card;
	var CardHeader = components.CardHeader;
	var CardTitle = components.CardTitle;
	var CardContent = components.CardContent;
	var Badge = components.Badge;
	var Button = components.Button;
	var Input = components.Input;

	function formatCount(n) {
		if (typeof n !== 'number' || !isFinite(n)) return '0';
		return n.toLocaleString();
	}

	function ResultRow(result) {
		return React.createElement(
			'div',
			{ key: result.id, className: 'border-b border-border pb-2 last:border-b-0 last:pb-0' },
			React.createElement(
				'div',
				{ className: 'flex flex-wrap items-center gap-2' },
				React.createElement(
					'a',
					{
						href: result.webUrl,
						target: '_blank',
						rel: 'noreferrer noopener',
						className: 'text-sm font-medium hover:underline',
					},
					result.title,
				),
				result.framework
					? React.createElement(Badge, { variant: 'secondary' }, result.framework)
					: null,
				result.kind
					? React.createElement(
							'span',
							{ className: 'text-xs text-muted-foreground' },
							result.kind,
						)
					: null,
			),
			result.abstract
				? React.createElement(
						'p',
						{ className: 'text-sm text-muted-foreground' },
						result.abstract,
					)
				: null,
		);
	}

	function AppleDocsPage() {
		var queryState = hooks.useState('');
		var query = queryState[0];
		var setQuery = queryState[1];

		var resultsState = hooks.useState([]);
		var results = resultsState[0];
		var setResults = resultsState[1];

		var statsState = hooks.useState(null);
		var stats = statsState[0];
		var setStats = statsState[1];

		var busyState = hooks.useState(false);
		var busy = busyState[0];
		var setBusy = busyState[1];

		var errorState = hooks.useState(null);
		var error = errorState[0];
		var setError = errorState[1];

		var metaState = hooks.useState(null);
		var meta = metaState[0];
		var setMeta = metaState[1];

		hooks.useEffect(function () {
			fetchJSON(API + '/status')
				.then(function (data) {
					setStats(data);
				})
				.catch(function () {
					setStats(null);
				});
		}, []);

		var runSearch = hooks.useCallback(
			function (event) {
				if (event && typeof event.preventDefault === 'function') {
					event.preventDefault();
				}
				var q = (query || '').trim();
				if (!q) return;
				setBusy(true);
				setError(null);
				fetchJSON(API + '/search?q=' + encodeURIComponent(q) + '&limit=25')
					.then(function (data) {
						var rows = (data && data.results) || [];
						setResults(rows);
						setMeta({
							count: rows.length,
							latencyMs: data && data.latencyMs,
							mode: data && data.mode,
						});
					})
					.catch(function (err) {
						setError(String((err && (err.message || err.detail)) || err));
						setResults([]);
						setMeta(null);
					})
					.then(function () {
						setBusy(false);
					});
			},
			[query],
		);

		return React.createElement(
			Card,
			null,
			React.createElement(
				CardHeader,
				null,
				React.createElement(CardTitle, null, 'Apple Docs'),
				React.createElement(
					'p',
					{ className: 'text-sm text-muted-foreground' },
					stats && typeof stats.symbolCount === 'number'
						? formatCount(stats.symbolCount) +
								' symbols · ' +
								formatCount(stats.frameworkCount) +
								' frameworks · offline SQLite FTS5 + idiom RRF'
						: 'Offline Apple SDK symbol search (SQLite FTS5 + cross-framework idiom RRF).',
				),
			),
			React.createElement(
				CardContent,
				{ className: 'space-y-4' },
				React.createElement(
					'form',
					{
						className: 'flex items-center gap-2',
						onSubmit: function (event) {
							event.preventDefault();
							runSearch(event);
						},
					},
					React.createElement(Input, {
						placeholder:
							'Symbol, wildcard (Grid*), React/Android idiom, or behavioral query…',
						value: query,
						onChange: function (event) {
							setQuery(event.target.value);
						},
					}),
					React.createElement(
						Button,
						{ type: 'submit', disabled: busy || !(query || '').trim() },
						busy ? 'Searching…' : 'Search',
					),
				),
				error
					? React.createElement(
							'p',
							{ className: 'text-sm text-destructive' },
							error,
						)
					: null,
				meta
					? React.createElement(
							'p',
							{ className: 'text-xs text-muted-foreground' },
							meta.count +
								' result' +
								(meta.count === 1 ? '' : 's') +
								(typeof meta.latencyMs === 'number'
									? ' · ' + Math.round(meta.latencyMs) + ' ms'
									: '') +
								(meta.mode ? ' · ' + meta.mode : ''),
						)
					: null,
				React.createElement(
					'div',
					{ className: 'space-y-2' },
					results.map(ResultRow),
				),
			),
		);
	}

	window.__HERMES_PLUGINS__.register('apple-doc-plugin', AppleDocsPage);
})();
