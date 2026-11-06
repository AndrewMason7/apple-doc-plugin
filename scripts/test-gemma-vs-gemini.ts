/**
 * Empirical Benchmark: Local Gemma (EmbeddingGemma-2 Q8_0) vs Cloud Gemini (gemini-embedding-2 @ 768d)
 * Evaluates semantic retrieval quality across Apple Developer Documentation.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { LocalGemmaEmbeddingProvider } from '../src/server/services/search/local-gemma-provider.js';
import { GeminiSemanticSearch } from '../src/server/services/search/semantic-search.js';
import type { EmbeddingProvider } from '../src/server/services/search/embedding-provider.js';

if (existsSync('.env') && typeof process.loadEnvFile === 'function') {
	process.loadEnvFile();
}

interface TestDocument {
	id: string;
	framework: string;
	title: string;
	kind: string;
	abstract: string;
	textForEmbedding: string;
}

interface TestCase {
	query: string;
	category: string;
	targetId: string;
	altTargetId?: string | null;
	explanation: string;
}

interface QueryResult {
	query: string;
	category: string;
	targetTitle: string;
	gemma: {
		rank: number;
		targetScore: number;
		topDistractorTitle: string;
		topDistractorScore: number;
		margin: number;
		top5: Array<{ title: string; score: number }>;
		latencyMs: number;
	};
	gemini: {
		rank: number;
		targetScore: number;
		topDistractorTitle: string;
		topDistractorScore: number;
		margin: number;
		top5: Array<{ title: string; score: number }>;
		latencyMs: number;
	};
}

const TEST_CASES: TestCase[] = [
	{
		query: 'prevent sheet swipe dismiss',
		category: 'Behavioral Intent',
		targetId: '/documentation/swiftui/view/interactivedismissdisabled(_:)',
		explanation:
			'SwiftUI modifier to stop users from dragging down a modal sheet',
	},
	{
		query: 'run async code when view appears or value changes',
		category: 'Behavioral Intent',
		targetId: '/documentation/swiftui/view/task(id:name:priority:file:line:_:)',
		altTargetId: '/documentation/swiftui/view/task(name:priority:file:line:_:)',
		explanation:
			'SwiftUI .task modifier with cancellation and async lifetime bound to view',
	},
	{
		query: 'code to run before view appears',
		category: 'Behavioral Intent',
		targetId: '/documentation/swiftui/view/onappear(perform:)',
		explanation: 'Synchronous appearance lifecycle hook in SwiftUI',
	},
	{
		query: 'multi column navigation with sidebar and detail',
		category: 'Architectural / Layout',
		targetId: '/documentation/swiftui/navigationsplitview',
		explanation: 'Modern multi-column split layout for iPadOS/macOS/iOS',
	},
	{
		query: 'dismiss keyboard automatically when scrolling',
		category: 'Behavioral Intent',
		targetId: '/documentation/swiftui/view/scrolldismisseskeyboard(_:)',
		explanation: 'Controls software keyboard dismissal interaction on scroll',
	},
	{
		query: 'generate haptic vibration for user impact',
		category: 'Hardware / Sensory',
		targetId: '/documentation/uikit/uiimpactfeedbackgenerator',
		explanation: 'Taptic Engine physical impact feedback generator in UIKit',
	},
	{
		query: 'fetch location coordinates and track device gps',
		category: 'Hardware / Sensory',
		targetId: '/documentation/corelocation/cllocationmanager',
		explanation: 'CoreLocation GPS and heading manager service',
	},
	{
		query: 'persisted user preferences property wrapper',
		category: 'State & Storage',
		targetId: '/documentation/swiftui/appstorage',
		altTargetId: '/documentation/swiftui/scene/defaultappstorage(_:)',
		explanation: 'User defaults backed reactive property wrapper',
	},
	{
		query: 'react useEffect hook equivalent in swiftui',
		category: 'Cross-Framework Concept',
		targetId: '/documentation/swiftui/view/task(id:name:priority:file:line:_:)',
		altTargetId: '/documentation/swiftui/view/task(name:priority:file:line:_:)',
		explanation:
			'React developer asking for effect-like lifecycle hook in SwiftUI',
	},
	{
		query: 'android shared preferences key value persistence',
		category: 'Cross-Framework Concept',
		targetId: '/documentation/swiftui/appstorage',
		altTargetId: '/documentation/swiftui/scene/defaultappstorage(_:)',
		explanation: 'Android developer looking for SharedPreferences analogue',
	},
	{
		query: 'vertical flexbox layout with expanding spacing',
		category: 'Cross-Framework Concept',
		targetId: '/documentation/swiftui/vstack',
		altTargetId: '/documentation/swiftui/spacer',
		explanation: 'Web flex-direction column with justify-content space-between',
	},
	{
		query: 'listen to publisher stream and cancel subscription',
		category: 'Reactive Streams',
		targetId: '/documentation/combine/subscribers/sink',
		altTargetId:
			'/documentation/combine/publisher/sink(receivecompletion:receivevalue:)',
		explanation: 'Combine publisher subscriber stream terminal consumer',
	},
];

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dot = 0.0;
	let normA = 0.0;
	let normB = 0.0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom > 0 ? dot / denom : 0;
}

async function runBenchmark() {
	console.log(
		'========================================================================',
	);
	console.log(
		'  Apple Developer Documentation Semantic Search Quality Benchmark',
	);
	console.log(
		'  Local Gemma (EmbeddingGemma-2 Q8_0) vs Cloud Gemini (gemini-embedding-2 768d)',
	);
	console.log(
		'========================================================================\n',
	);

	const db = new Database('data/apple-docs.db', { readonly: true });

	// 1. Collect target symbols
	const targetIds = new Set<string>();
	for (const tc of TEST_CASES) {
		targetIds.add(tc.targetId);
		if (tc.altTargetId) targetIds.add(tc.altTargetId);
	}

	const testDocs: TestDocument[] = [];
	for (const id of targetIds) {
		const row = db
			.prepare(
				'SELECT id, framework, title, kind, abstract FROM symbols WHERE id = ?',
			)
			.get(id) as any;
		if (row) {
			testDocs.push({
				id: row.id,
				framework: row.framework,
				title: row.title,
				kind: row.kind,
				abstract: row.abstract || `${row.title} in ${row.framework}`,
				textForEmbedding: row.abstract || `${row.title} in ${row.framework}`,
			});
		}
	}

	// 2. Collect distractors: near-misses and diverse cross-framework symbols
	const distractorQueries = [
		"SELECT id, framework, title, kind, abstract FROM symbols WHERE framework = 'SwiftUI' AND abstract IS NOT NULL AND length(abstract) > 20 AND id NOT IN (" +
			[...targetIds].map((s) => `'${s}'`).join(',') +
			') ORDER BY RANDOM() LIMIT 25',
		"SELECT id, framework, title, kind, abstract FROM symbols WHERE framework IN ('UIKit', 'Foundation', 'Combine', 'CoreLocation') AND abstract IS NOT NULL AND length(abstract) > 20 AND id NOT IN (" +
			[...targetIds].map((s) => `'${s}'`).join(',') +
			') ORDER BY RANDOM() LIMIT 20',
	];

	for (const q of distractorQueries) {
		const rows = db.prepare(q).all() as any[];
		for (const row of rows) {
			testDocs.push({
				id: row.id,
				framework: row.framework,
				title: row.title,
				kind: row.kind,
				abstract: row.abstract,
				textForEmbedding: row.abstract,
			});
		}
	}

	console.log(
		`Corpus assembled: ${testDocs.length} symbols (${targetIds.size} target variants + ${testDocs.length - targetIds.size} distractors).\n`,
	);

	// 3. Initialize providers
	console.log('Initializing Local Gemma Provider...');
	const tGemmaInit = Date.now();
	const gemmaProvider = new LocalGemmaEmbeddingProvider();
	await gemmaProvider.embedQuery('warmup');
	const gemmaInitTime = Date.now() - tGemmaInit;
	console.log(`✓ Local Gemma ready (warmup took ${gemmaInitTime}ms)`);

	console.log('Initializing Cloud Gemini Provider (768d)...');
	const tGeminiInit = Date.now();
	const geminiProvider = new GeminiSemanticSearch();
	await geminiProvider.embedQuery('warmup');
	const geminiInitTime = Date.now() - tGeminiInit;
	console.log(`✓ Cloud Gemini ready (warmup took ${geminiInitTime}ms)\n`);

	// 4. Precompute corpus embeddings for both models
	console.log(`Embedding ${testDocs.length} documents with Local Gemma...`);
	const gemmaDocVectors = new Map<string, Float32Array>();
	const tGemmaDocs = Date.now();
	for (let i = 0; i < testDocs.length; i++) {
		const doc = testDocs[i];
		const vec = await gemmaProvider.embedDocument(
			doc.textForEmbedding,
			doc.title,
		);
		if (vec) gemmaDocVectors.set(doc.id, vec);
		if ((i + 1) % 15 === 0 || i === testDocs.length - 1) {
			process.stdout.write(`  Gemma: ${i + 1}/${testDocs.length}\r`);
		}
	}
	const gemmaDocsTime = Date.now() - tGemmaDocs;
	console.log(
		`\n✓ Gemma embedded ${gemmaDocVectors.size} docs in ${gemmaDocsTime}ms (${(gemmaDocsTime / testDocs.length).toFixed(1)}ms/doc)\n`,
	);

	console.log(`Embedding ${testDocs.length} documents with Cloud Gemini...`);
	const geminiDocVectors = new Map<string, Float32Array>();
	const tGeminiDocs = Date.now();
	for (let i = 0; i < testDocs.length; i++) {
		const doc = testDocs[i];
		const vec = await geminiProvider.embedDocument(
			doc.textForEmbedding,
			doc.title,
		);
		if (vec) geminiDocVectors.set(doc.id, vec);
		if ((i + 1) % 15 === 0 || i === testDocs.length - 1) {
			process.stdout.write(`  Gemini: ${i + 1}/${testDocs.length}\r`);
		}
	}
	const geminiDocsTime = Date.now() - tGeminiDocs;
	console.log(
		`\n✓ Gemini embedded ${geminiDocVectors.size} docs in ${geminiDocsTime}ms (${(geminiDocsTime / testDocs.length).toFixed(1)}ms/doc)\n`,
	);

	// 5. Run queries and compute search metrics
	const results: QueryResult[] = [];

	console.log('Running 12 test queries...\n');

	for (const tc of TEST_CASES) {
		const targetDoc = testDocs.find((d) => d.id === tc.targetId);
		const targetTitle = targetDoc ? targetDoc.title : tc.targetId;

		// Gemma query
		const t0Gemma = Date.now();
		const gemmaQueryVec = await gemmaProvider.embedQuery(tc.query);
		const gemmaLat = Date.now() - t0Gemma;

		const gemmaScores: Array<{ id: string; title: string; score: number }> = [];
		if (gemmaQueryVec) {
			for (const doc of testDocs) {
				const docVec = gemmaDocVectors.get(doc.id);
				if (docVec) {
					const score = cosineSimilarity(gemmaQueryVec, docVec);
					gemmaScores.push({ id: doc.id, title: doc.title, score });
				}
			}
		}
		gemmaScores.sort((a, b) => b.score - a.score);

		// Find target rank in Gemma
		const isMatch = (id: string) =>
			id === tc.targetId || (tc.altTargetId && id === tc.altTargetId);
		const gemmaRank = gemmaScores.findIndex((s) => isMatch(s.id)) + 1;
		const gemmaTargetScore = gemmaScores.find((s) => isMatch(s.id))?.score ?? 0;
		const gemmaTopDistractor = gemmaScores.find((s) => !isMatch(s.id))!;
		const gemmaMargin = gemmaTargetScore - (gemmaTopDistractor?.score ?? 0);

		// Gemini query
		const t0Gemini = Date.now();
		const geminiQueryVec = await geminiProvider.embedQuery(tc.query);
		const geminiLat = Date.now() - t0Gemini;

		const geminiScores: Array<{ id: string; title: string; score: number }> =
			[];
		if (geminiQueryVec) {
			for (const doc of testDocs) {
				const docVec = geminiDocVectors.get(doc.id);
				if (docVec) {
					const score = cosineSimilarity(geminiQueryVec, docVec);
					geminiScores.push({ id: doc.id, title: doc.title, score });
				}
			}
		}
		geminiScores.sort((a, b) => b.score - a.score);

		// Find target rank in Gemini
		const geminiRank = geminiScores.findIndex((s) => isMatch(s.id)) + 1;
		const geminiTargetScore =
			geminiScores.find((s) => isMatch(s.id))?.score ?? 0;
		const geminiTopDistractor = geminiScores.find((s) => !isMatch(s.id))!;
		const geminiMargin = geminiTargetScore - (geminiTopDistractor?.score ?? 0);

		results.push({
			query: tc.query,
			category: tc.category,
			targetTitle,
			gemma: {
				rank: gemmaRank,
				targetScore: gemmaTargetScore,
				topDistractorTitle: gemmaTopDistractor?.title ?? 'none',
				topDistractorScore: gemmaTopDistractor?.score ?? 0,
				margin: gemmaMargin,
				top5: gemmaScores.slice(0, 5),
				latencyMs: gemmaLat,
			},
			gemini: {
				rank: geminiRank,
				targetScore: geminiTargetScore,
				topDistractorTitle: geminiTopDistractor?.title ?? 'none',
				topDistractorScore: geminiTopDistractor?.score ?? 0,
				margin: geminiMargin,
				top5: geminiScores.slice(0, 5),
				latencyMs: geminiLat,
			},
		});
	}

	// 6. Aggregate metrics
	const calcMRR = (ranks: number[]) =>
		ranks.reduce((acc, r) => acc + (r > 0 ? 1 / r : 0), 0) / ranks.length;
	const calcRecallAtK = (ranks: number[], k: number) =>
		(ranks.filter((r) => r > 0 && r <= k).length / ranks.length) * 100;
	const calcMean = (nums: number[]) =>
		nums.reduce((a, b) => a + b, 0) / nums.length;

	const gemmaRanks = results.map((r) => r.gemma.rank);
	const geminiRanks = results.map((r) => r.gemini.rank);

	const summary = {
		totalQueries: results.length,
		corpusSize: testDocs.length,
		gemma: {
			mrr: calcMRR(gemmaRanks),
			recall1: calcRecallAtK(gemmaRanks, 1),
			recall3: calcRecallAtK(gemmaRanks, 3),
			recall5: calcRecallAtK(gemmaRanks, 5),
			meanTargetScore: calcMean(results.map((r) => r.gemma.targetScore)),
			meanDistractorScore: calcMean(
				results.map((r) => r.gemma.topDistractorScore),
			),
			meanMargin: calcMean(results.map((r) => r.gemma.margin)),
			meanLatencyMs: calcMean(results.map((r) => r.gemma.latencyMs)),
			initTimeMs: gemmaInitTime,
		},
		gemini: {
			mrr: calcMRR(geminiRanks),
			recall1: calcRecallAtK(geminiRanks, 1),
			recall3: calcRecallAtK(geminiRanks, 3),
			recall5: calcRecallAtK(geminiRanks, 5),
			meanTargetScore: calcMean(results.map((r) => r.gemini.targetScore)),
			meanDistractorScore: calcMean(
				results.map((r) => r.gemini.topDistractorScore),
			),
			meanMargin: calcMean(results.map((r) => r.gemini.margin)),
			meanLatencyMs: calcMean(results.map((r) => r.gemini.latencyMs)),
			initTimeMs: geminiInitTime,
		},
	};

	console.log(
		'\n========================================================================',
	);
	console.log('                          BENCHMARK SUMMARY');
	console.log(
		'========================================================================',
	);
	console.table({
		Metric: [
			'Recall@1 (Top 1)',
			'Recall@3 (Top 3)',
			'Recall@5 (Top 5)',
			'MRR (Mean Reciprocal Rank)',
			'Mean Target Cosine',
			'Mean Top Distractor',
			'Cosine Margin (Δ)',
			'Mean Query Latency (ms)',
			'Cold Init Latency (ms)',
		],
		'Local Gemma (Q8_0)': [
			`${summary.gemma.recall1.toFixed(1)}%`,
			`${summary.gemma.recall3.toFixed(1)}%`,
			`${summary.gemma.recall5.toFixed(1)}%`,
			summary.gemma.mrr.toFixed(3),
			summary.gemma.meanTargetScore.toFixed(4),
			summary.gemma.meanDistractorScore.toFixed(4),
			summary.gemma.meanMargin.toFixed(4),
			`${summary.gemma.meanLatencyMs.toFixed(1)} ms`,
			`${summary.gemma.initTimeMs} ms`,
		],
		'Cloud Gemini (768d)': [
			`${summary.gemini.recall1.toFixed(1)}%`,
			`${summary.gemini.recall3.toFixed(1)}%`,
			`${summary.gemini.recall5.toFixed(1)}%`,
			summary.gemini.mrr.toFixed(3),
			summary.gemini.meanTargetScore.toFixed(4),
			summary.gemini.meanDistractorScore.toFixed(4),
			summary.gemini.meanMargin.toFixed(4),
			`${summary.gemini.meanLatencyMs.toFixed(1)} ms`,
			`${summary.gemini.initTimeMs} ms`,
		],
	});

	console.log(
		'\n========================================================================',
	);
	console.log('                      DETAILED QUERY RESULTS');
	console.log(
		'========================================================================',
	);
	for (const r of results) {
		console.log(`\nQuery: "${r.query}" [${r.category}]`);
		console.log(`  Target: ${r.targetTitle}`);
		console.log(
			`  • Gemma : Rank #${r.gemma.rank} | Target Score: ${r.gemma.targetScore.toFixed(4)} | Distractor: ${r.gemma.topDistractorScore.toFixed(4)} | Δ: ${r.gemma.margin > 0 ? '+' : ''}${r.gemma.margin.toFixed(4)} | (${r.gemma.latencyMs}ms)`,
		);
		console.log(
			`  • Gemini: Rank #${r.gemini.rank} | Target Score: ${r.gemini.targetScore.toFixed(4)} | Distractor: ${r.gemini.topDistractorScore.toFixed(4)} | Δ: ${r.gemini.margin > 0 ? '+' : ''}${r.gemini.margin.toFixed(4)} | (${r.gemini.latencyMs}ms)`,
		);
		if (r.gemma.rank > 1) {
			console.log(
				`    ↳ Gemma #1 was: "${r.gemma.topDistractorTitle}" (${r.gemma.topDistractorScore.toFixed(4)})`,
			);
		}
		if (r.gemini.rank > 1) {
			console.log(
				`    ↳ Gemini #1 was: "${r.gemini.topDistractorTitle}" (${r.gemini.topDistractorScore.toFixed(4)})`,
			);
		}
	}

	// Write full output to JSON artifact
	const artifactPath = 'scripts/benchmark-results.json';
	writeFileSync(artifactPath, JSON.stringify({ summary, results }, null, 2));
	console.log(`\nDetailed benchmark report written to ${artifactPath}`);
	db.close();
}

runBenchmark().catch((err) => {
	console.error('Benchmark failed:', err);
	process.exit(1);
});
