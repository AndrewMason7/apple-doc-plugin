import { AppleDocsDB } from '../db/database.js';

export function extractAbstract(abstractObj: any): string {
  if (!abstractObj) return '';
  if (typeof abstractObj === 'string') return abstractObj.trim();
  if (Array.isArray(abstractObj)) {
    return abstractObj
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return part.text || '';
        return '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

export function indexFrameworkData(db: AppleDocsDB, framework: string, data: any): number {
  if (!data?.references || typeof data.references !== 'object') return 0;
  let count = 0;

  for (const [id, ref] of Object.entries<any>(data.references)) {
    if (!ref || typeof ref !== 'object') continue;
    if (ref.kind !== 'symbol' && ref.kind !== 'article') continue;
    if (!ref.title) continue;

    const abstractText = extractAbstract(ref.abstract);
    const platforms: string[] = Array.isArray(ref.platforms)
      ? ref.platforms.map((p: any) => p?.name || '').filter(Boolean)
      : [];

    const kind = ref.symbolKind || ref.kind || 'symbol';
    const isPrimary = ['struct', 'class', 'protocol', 'enum', 'macro'].includes(kind.toLowerCase());

    const symbolPath = ref.url || id;

    db.insertSymbol({
      id: symbolPath,
      framework,
      title: ref.title,
      kind,
      abstract: abstractText,
      path: symbolPath,
      platforms,
      isPrimaryType: isPrimary,
    });
    count++;
  }

  return count;
}

export interface DocCIndexNode {
  title?: string;
  path?: string;
  type?: string;
  children?: DocCIndexNode[];
  external?: boolean;
}

export function indexFrameworkTree(db: AppleDocsDB, framework: string, indexData: any): number {
  const root = indexData?.interfaceLanguages?.swift?.[0];
  if (!root) return 0;

  let count = 0;

  function walk(node: DocCIndexNode) {
    if (node.path && node.title && node.type && node.type !== 'groupMarker') {
      const isPrimary = ['struct', 'class', 'protocol', 'enum', 'macro'].includes(
        node.type.toLowerCase()
      );
      db.insertSymbol({
        id: node.path,
        framework,
        title: node.title,
        kind: node.type,
        abstract: '', // Populated on-demand or during deep crawl
        path: node.path,
        platforms: [],
        isPrimaryType: isPrimary,
      });
      count++;
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return count;
}
