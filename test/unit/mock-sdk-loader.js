import { register } from 'node:module';

const loaderCode = `
	const sdkNames = [
		'Badge', 'Button', 'Codicon', 'CopyButton', 'EmptyState', 'GlyphSpinner',
		'Input', 'RowButton', 'ScrollArea', 'SearchField', 'SegmentedControl', 'Select',
		'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue', 'Separator',
		'StatusDot', 'Tabs', 'TabsList', 'TabsTrigger', 'Textarea', 'Tip'
	];

	export async function load(url, context, nextLoad) {
		if (url === 'mock://sdk') {
			const source = \`
				const noop = () => null;
				\${sdkNames.map((n) => \`export const \${n} = noop;\`).join('\\n')}
				export const PALETTE_AREA = 'palette';
				export const PANES_AREA = 'panes';
				export const ROUTES_AREA = 'routes';
				export const SIDEBAR_NAV_AREA = 'sidebar.nav';
				export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' };
				export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directive';
				export const haptic = () => {};
				export const host = {
					navigate: () => {},
					notify: () => {},
					undismissPane: () => {},
					revealPane: () => {},
					composer: { insertText: async () => true, setDraft: async () => true },
				};
				export const useMutation = () => ({ mutate: () => {}, data: null, isPending: false });
				export const usePluginI18n = () => (k) => k;
				export const useQuery = () => ({ data: null, isFetching: false });
			\`;
			return { format: 'module', shortCircuit: true, source };
		}
		if (url === 'mock://react') {
			return {
				format: 'module',
				shortCircuit: true,
				source: 'export const useEffect = () => {}; export const useMemo = (fn) => fn(); export const useState = (v) => [typeof v === "function" ? v() : v, () => {}];',
			};
		}
		if (url === 'mock://jsx') {
			return {
				format: 'module',
				shortCircuit: true,
				source: 'export const Fragment = (props) => props?.children ?? null; export const jsx = (type, props) => ({ type, props }); export const jsxs = (type, props) => ({ type, props });',
			};
		}
		return nextLoad(url, context);
	}

	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@hermes/plugin-sdk') return { url: 'mock://sdk', shortCircuit: true };
		if (specifier === 'react') return { url: 'mock://react', shortCircuit: true };
		if (specifier === 'react/jsx-runtime') return { url: 'mock://jsx', shortCircuit: true };
		return nextResolve(specifier, context);
	}
`;

register(
	`data:text/javascript;base64,${Buffer.from(loaderCode).toString('base64')}`,
);
