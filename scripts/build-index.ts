import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { AppleDocsDB } from '../src/server/db/database.js';
import {
  indexFrameworkData,
  indexFrameworkTree,
  extractMediaReferences,
} from '../src/server/services/indexer.js';
import { GeminiSemanticSearch } from '../src/server/services/search/semantic-search.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file natively if available
if (typeof process.loadEnvFile === 'function') {
  const projectEnv = join(__dirname, '../.env');
  try {
    if (existsSync(projectEnv)) {
      process.loadEnvFile(projectEnv);
    } else {
      process.loadEnvFile();
    }
  } catch {}
}

const CORE_FRAMEWORKS = [

  'SwiftUI',
  'UIKit',
  'Foundation',
  'SwiftData',
  'Combine',
  'AppKit',
  'Observation',
  'CoreLocation',
];

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  referer: 'https://developer.apple.com/documentation',
};

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await axios.get(url, { headers, timeout: 15000 });
    return res.data;
  } catch (err) {
    console.error(`Failed to fetch ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function buildIndex() {
  const dataDir = join(__dirname, '../data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = join(dataDir, 'apple-docs.db');
  console.error(`🚀 Initializing database at ${dbPath}...`);
  const db = new AppleDocsDB(dbPath);

  const semantic = new GeminiSemanticSearch();
  const canEmbed = semantic.hasAuth();
  if (canEmbed) {
    console.error('✨ Gemini credentials detected (API Key or ADC)! Multimodal vector embeddings enabled.');
  } else {
    console.error('ℹ️ No GEMINI_API_KEY or ADC credentials provided; proceeding with pure FTS5 indexing.');
  }


  let totalIndexed = 0;

  for (const framework of CORE_FRAMEWORKS) {
    const slug = framework.toLowerCase();
    console.error(`\n📦 Indexing framework: ${framework}...`);

    // 1. Fetch framework overview documentation (contains rich abstracts for top symbols)
    const docUrl = `https://developer.apple.com/tutorials/data/documentation/${slug}.json`;
    const docData = await fetchJson(docUrl);
    if (docData) {
      const count = indexFrameworkData(db, framework, docData);
      console.error(`   • Indexed ${count} top-level symbols and abstracts`);
      totalIndexed += count;

      // Embed framework overview if semantic enabled
      if (canEmbed && docData.metadata?.title) {
        const title = docData.metadata.title;
        const abstract = docData.abstract
          ? Array.isArray(docData.abstract)
            ? docData.abstract.map((p: any) => p.text || '').join(' ')
            : ''
          : '';
        const summary = `${title}: ${abstract}`.trim();
        const vec = await semantic.embedQuery(summary);
        if (vec) {
          db.insertSemanticItem({
            id: `tech-${slug}`,
            framework,
            title,
            kind: 'technology',
            summary,
            path: `/documentation/${slug}`,
            embedding: vec,
          });
          console.error(`   • Embedded overview for ${framework}`);
        }
      }

      // Extract and embed visual media previews (diagrams, layout screenshots)
      if (canEmbed) {
        const mediaItems = extractMediaReferences(docData);
        if (mediaItems.length > 0) {
          console.error(`   • Found ${mediaItems.length} visual media references; embedding...`);
          for (const item of mediaItems) {
            try {
              const imgRes = await axios.get(item.url, {
                responseType: 'arraybuffer',
                headers,
                timeout: 10000,
              });
              const base64 = Buffer.from(imgRes.data).toString('base64');
              const vec = await semantic.embedMultimodal(item.alt, base64, item.mimeType);
              if (vec) {
                db.insertSemanticItem({
                  id: `media-${item.identifier}`,
                  framework,
                  title: item.alt ? item.alt.slice(0, 100) : item.identifier,
                  kind: 'ui_preview',
                  summary: item.alt || `${framework} layout preview`,
                  path: `/documentation/${slug}`,
                  mediaUrl: item.url,
                  mediaType: item.mimeType,
                  embedding: vec,
                });
                console.error(`     ✓ Embedded visual preview: ${item.identifier}`);
              }
            } catch (err) {
              console.warn(
                `     ⚠ Could not embed media ${item.url}:`,
                err instanceof Error ? err.message : err
              );
            }
          }
        }
      }
    }

    // 2. Fetch comprehensive index tree
    const indexUrl = `https://developer.apple.com/tutorials/data/index/${slug}`;
    const treeData = await fetchJson(indexUrl);
    if (treeData) {
      const treeCount = indexFrameworkTree(db, framework, treeData);
      console.error(`   • Indexed ${treeCount} symbol tree nodes`);
      totalIndexed += treeCount;
    }
  }

  console.error(`\n🎉 Indexing complete! Total symbols indexed: ${totalIndexed}`);
  db.close();
}

buildIndex().catch((err) => {
  console.error('Fatal error building index:', err);
  process.exit(1);
});
