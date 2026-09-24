export type PlatformInfo = {
	name: string;
	introducedAt: string;
	beta?: boolean;
};

export type FrameworkData = {
	abstract: Array<{ text: string; type: string }>;
	metadata: {
		platforms: PlatformInfo[];
		role: string;
		title: string;
	};
	references: Record<string, ReferenceData>;
	topicSections: TopicSection[];
};

export type DocCToken = {
	kind:
		| 'keyword'
		| 'attribute'
		| 'identifier'
		| 'text'
		| 'genericParameter'
		| 'typeIdentifier'
		| 'externalParam'
		| 'internalParam'
		| string;
	text: string;
};

export type DocCDeclaration = {
	languages?: string[];
	platforms?: string[];
	tokens: DocCToken[];
};

export type DocCInlineContent = {
	type:
		| 'text'
		| 'codeVoice'
		| 'reference'
		| 'emphasis'
		| 'strong'
		| 'link'
		| string;
	text?: string;
	code?: string;
	identifier?: string;
	title?: string;
	destination?: string;
	inlineContent?: DocCInlineContent[];
};

export type DocCContentNode = {
	type:
		| 'paragraph'
		| 'heading'
		| 'codeListing'
		| 'unorderedList'
		| 'orderedList'
		| 'aside'
		| string;
	level?: number;
	text?: string;
	syntax?: string;
	code?: string[];
	style?: string;
	name?: string;
	inlineContent?: DocCInlineContent[];
	content?: DocCContentNode[];
	items?: Array<{ content: DocCContentNode[] }>;
};

export type DocCParameter = {
	name: string;
	content: DocCContentNode[];
};

export type DocCPrimaryContentSection = {
	kind: 'declarations' | 'parameters' | 'content' | 'mentions' | string;
	title?: string;
	declarations?: DocCDeclaration[];
	parameters?: DocCParameter[];
	content?: DocCContentNode[];
};

export type SymbolData = {
	abstract: Array<{ text: string; type: string }>;
	deprecationSummary?: DocCContentNode[];
	metadata: {
		platforms: PlatformInfo[];
		symbolKind: string;
		title: string;
	};
	primaryContentSections?: DocCPrimaryContentSection[];
	references: Record<string, ReferenceData>;
	topicSections: TopicSection[];
};

export type Technology = {
	abstract: Array<{ text: string; type: string }>;
	identifier: string;
	kind: string;
	role: string;
	title: string;
	url: string;
};

export type TopicSection = {
	anchor?: string;
	identifiers: string[];
	title: string;
};

export type ReferenceData = {
	title: string;
	kind?: string;
	abstract?: Array<{ text: string; type: string }>;
	platforms?: PlatformInfo[];
	url: string;
};

export type CacheEntry<T> = {
	data: T;
	timestamp: number;
};
