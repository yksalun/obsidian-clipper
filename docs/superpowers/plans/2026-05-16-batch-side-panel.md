# Batch Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chrome/Chromium side panel Batch tab that extracts visible links from the active page, lets users edit the queue, and clips each link into Obsidian with the selected template.

**Architecture:** Keep the existing Webpack extension architecture. Add small utilities for link extraction, queue state, and batch rendering; add background messages for temporary tab extraction; wire a focused Batch tab controller into the existing side panel without changing the popup flow.

**Tech Stack:** TypeScript, WebExtension APIs via `webextension-polyfill`, Chrome side panel, Vitest, linkedom, existing Defuddle/template/Obsidian save utilities.

---

## File Structure

- Modify `.gitignore`: ignore `.superpowers/` local brainstorming artifacts.
- Create `src/utils/batch-links.ts`: pure link extraction and URL filtering helpers.
- Create `src/utils/batch-links.test.ts`: Vitest coverage for visible link extraction, filtering, normalization, labels, and de-duplication.
- Create `src/utils/batch-queue.ts`: pure queue item types, queue mutation helpers, concurrency normalization, and a small concurrency runner.
- Create `src/utils/batch-queue.test.ts`: Vitest coverage for queue state transitions and concurrency limits.
- Create `src/utils/batch-renderer.ts`: render one extracted page into Obsidian note fields using the selected template while the temporary tab remains open.
- Create `src/utils/batch-renderer.test.ts`: Vitest coverage for template prompt blocking and rendered note output with mocked compiler/extraction helpers.
- Modify `src/content.ts`: add a `getVisibleLinks` message action that calls `extractVisibleLinks`.
- Modify `src/background.ts`: add temporary inactive tab lifecycle helpers and `openBatchClipTab` / `closeBatchClipTab` runtime actions.
- Modify `src/side-panel.html`: add side panel tabs and Batch tab markup.
- Modify `src/styles/side-panel.scss`: add restrained side panel tab, queue, and status styling.
- Create `src/core/batch-panel.ts`: side-panel-only controller for extraction, queue editing, batch execution, sequential saves, and retry failed.
- Modify `src/core/popup.ts`: initialize Batch tab only in the side panel context and pass the existing template/vault/save dependencies into `batch-panel`.
- Use existing `src/manifest.chrome.json`: avoid permission expansion unless implementation proves a Chrome-only permission is required.

---

### Task 1: Ignore Brainstorm Artifacts

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add `.superpowers/` to `.gitignore`**

Append this line near the existing local tool ignores:

```gitignore
.superpowers/
```

- [ ] **Step 2: Verify brainstorm files are ignored**

Run:

```bash
git status --short
```

Expected: `.superpowers/` does not appear in the untracked file list.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore brainstorm artifacts"
```

---

### Task 2: Link Extraction Helper

**Files:**
- Create: `src/utils/batch-links.ts`
- Create: `src/utils/batch-links.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/batch-links.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractVisibleLinks, normalizeLinkUrl } from './batch-links';

function doc(html: string): Document {
	const { document } = parseHTML(html);
	return document as unknown as Document;
}

describe('normalizeLinkUrl', () => {
	test('resolves relative URLs against the base URL', () => {
		expect(normalizeLinkUrl('/docs/page', 'https://example.com/start')).toBe('https://example.com/docs/page');
	});

	test('removes hash-only fragments from otherwise duplicate URLs', () => {
		expect(normalizeLinkUrl('https://example.com/page#section', 'https://example.com')).toBe('https://example.com/page#section');
	});

	test('rejects unsupported schemes', () => {
		expect(normalizeLinkUrl('mailto:hello@example.com', 'https://example.com')).toBe(null);
		expect(normalizeLinkUrl('javascript:void(0)', 'https://example.com')).toBe(null);
		expect(normalizeLinkUrl('#local', 'https://example.com/page')).toBe(null);
		expect(normalizeLinkUrl('chrome://extensions', 'https://example.com')).toBe(null);
	});
});

describe('extractVisibleLinks', () => {
	test('extracts visible normal links in document order', () => {
		const links = extractVisibleLinks(doc(`
			<a href="/a">First link</a>
			<a href="https://other.test/path" title="Other title"></a>
			<a href="/b" aria-label="ARIA label"><span></span></a>
		`), 'https://example.com/root');

		expect(links).toEqual([
			{ id: 'batch-link-1', text: 'First link', url: 'https://example.com/a' },
			{ id: 'batch-link-2', text: 'Other title', url: 'https://other.test/path' },
			{ id: 'batch-link-3', text: 'ARIA label', url: 'https://example.com/b' },
		]);
	});

	test('filters hidden and unsupported links', () => {
		const links = extractVisibleLinks(doc(`
			<a href="/visible">Visible</a>
			<a href="/hidden" hidden>Hidden</a>
			<div style="display:none"><a href="/inside-hidden">Inside hidden</a></div>
			<a href="tel:123">Phone</a>
			<a href="mailto:test@example.com">Mail</a>
			<a href="javascript:void(0)">JS</a>
			<a href="#section">Hash</a>
		`), 'https://example.com/root');

		expect(links).toEqual([
			{ id: 'batch-link-1', text: 'Visible', url: 'https://example.com/visible' },
		]);
	});

	test('de-duplicates by normalized URL and keeps the first label', () => {
		const links = extractVisibleLinks(doc(`
			<a href="/same">First</a>
			<a href="https://example.com/same">Second</a>
		`), 'https://example.com/root');

		expect(links).toEqual([
			{ id: 'batch-link-1', text: 'First', url: 'https://example.com/same' },
		]);
	});
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- src/utils/batch-links.test.ts
```

Expected: FAIL because `src/utils/batch-links.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/utils/batch-links.ts`:

```ts
export interface ExtractedBatchLink {
	id: string;
	text: string;
	url: string;
}

const UNSUPPORTED_PROTOCOLS = new Set([
	'about:',
	'chrome:',
	'chrome-extension:',
	'edge:',
	'file:',
	'javascript:',
	'mailto:',
	'tel:',
]);

export function normalizeLinkUrl(rawUrl: string | null, baseUrl: string): string | null {
	if (!rawUrl) return null;
	const trimmed = rawUrl.trim();
	if (!trimmed || trimmed.startsWith('#')) return null;

	try {
		const url = new URL(trimmed, baseUrl);
		if (UNSUPPORTED_PROTOCOLS.has(url.protocol)) return null;
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.href;
	} catch {
		return null;
	}
}

function hasHiddenStyle(element: Element): boolean {
	const style = element.getAttribute('style')?.toLowerCase() ?? '';
	return style.includes('display:none') ||
		style.includes('display: none') ||
		style.includes('visibility:hidden') ||
		style.includes('visibility: hidden');
}

function isElementVisible(element: Element): boolean {
	let current: Element | null = element;
	while (current) {
		if (current.hasAttribute('hidden')) return false;
		if (current.getAttribute('aria-hidden') === 'true') return false;
		if (hasHiddenStyle(current)) return false;

		const view = current.ownerDocument.defaultView;
		if (view?.getComputedStyle) {
			const computed = view.getComputedStyle(current);
			if (computed.display === 'none' || computed.visibility === 'hidden') return false;
		}

		current = current.parentElement;
	}
	return true;
}

function getLinkText(anchor: HTMLAnchorElement, url: string): string {
	const text = anchor.textContent?.replace(/\s+/g, ' ').trim();
	return text ||
		anchor.getAttribute('aria-label')?.trim() ||
		anchor.getAttribute('title')?.trim() ||
		url;
}

export function extractVisibleLinks(doc: Document, baseUrl: string = doc.URL): ExtractedBatchLink[] {
	const seenUrls = new Set<string>();
	const links: ExtractedBatchLink[] = [];

	for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
		if (!isElementVisible(anchor)) continue;

		const url = normalizeLinkUrl(anchor.getAttribute('href'), baseUrl);
		if (!url || seenUrls.has(url)) continue;

		seenUrls.add(url);
		links.push({
			id: `batch-link-${links.length + 1}`,
			text: getLinkText(anchor, url),
			url,
		});
	}

	return links;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
npm test -- src/utils/batch-links.test.ts
```

Expected: PASS for all tests in `batch-links.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/batch-links.ts src/utils/batch-links.test.ts
git commit -m "feat: add batch link extraction helper"
```

---

### Task 3: Queue State And Concurrency Helper

**Files:**
- Create: `src/utils/batch-queue.ts`
- Create: `src/utils/batch-queue.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/batch-queue.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
	BatchQueueItem,
	createBatchQueue,
	getBatchSummary,
	normalizeBatchConcurrency,
	runWithConcurrency,
	updateBatchQueueItem,
} from './batch-queue';

describe('createBatchQueue', () => {
	test('creates idle queue items from extracted links', () => {
		const queue = createBatchQueue([
			{ id: 'batch-link-1', text: 'A', url: 'https://example.com/a' },
			{ id: 'batch-link-2', text: 'B', url: 'https://example.com/b' },
		]);

		expect(queue).toEqual([
			{ id: 'batch-link-1', text: 'A', url: 'https://example.com/a', status: 'idle' },
			{ id: 'batch-link-2', text: 'B', url: 'https://example.com/b', status: 'idle' },
		]);
	});
});

describe('updateBatchQueueItem', () => {
	test('updates one item without mutating the original queue', () => {
		const original: BatchQueueItem[] = [
			{ id: 'one', text: 'One', url: 'https://example.com/one', status: 'idle' },
			{ id: 'two', text: 'Two', url: 'https://example.com/two', status: 'idle' },
		];

		const updated = updateBatchQueueItem(original, 'two', {
			status: 'failed',
			error: 'No content was extracted.',
		});

		expect(original[1].status).toBe('idle');
		expect(updated[1]).toEqual({
			id: 'two',
			text: 'Two',
			url: 'https://example.com/two',
			status: 'failed',
			error: 'No content was extracted.',
		});
	});
});

describe('normalizeBatchConcurrency', () => {
	test('clamps values to the supported range', () => {
		expect(normalizeBatchConcurrency(0)).toBe(1);
		expect(normalizeBatchConcurrency(2)).toBe(2);
		expect(normalizeBatchConcurrency(9)).toBe(3);
		expect(normalizeBatchConcurrency(Number.NaN)).toBe(1);
	});
});

describe('getBatchSummary', () => {
	test('counts queue statuses', () => {
		expect(getBatchSummary([
			{ id: '1', text: 'A', url: 'https://a.test', status: 'success' },
			{ id: '2', text: 'B', url: 'https://b.test', status: 'failed' },
			{ id: '3', text: 'C', url: 'https://c.test', status: 'queued' },
		])).toEqual({
			total: 3,
			success: 1,
			failed: 1,
			pending: 1,
		});
	});
});

describe('runWithConcurrency', () => {
	test('does not exceed the requested concurrency', async () => {
		let active = 0;
		let maxActive = 0;

		const results = await runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise(resolve => setTimeout(resolve, 5));
			active -= 1;
			return item * 2;
		});

		expect(results).toEqual([2, 4, 6, 8]);
		expect(maxActive).toBe(2);
	});
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- src/utils/batch-queue.test.ts
```

Expected: FAIL because `src/utils/batch-queue.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/utils/batch-queue.ts`:

```ts
import { ExtractedBatchLink } from './batch-links';

export type BatchQueueStatus = 'idle' | 'queued' | 'opening' | 'extracting' | 'rendering' | 'saving' | 'success' | 'failed';

export interface BatchQueueItem extends ExtractedBatchLink {
	status: BatchQueueStatus;
	error?: string;
}

export interface BatchSummary {
	total: number;
	success: number;
	failed: number;
	pending: number;
}

export function createBatchQueue(links: ExtractedBatchLink[]): BatchQueueItem[] {
	return links.map(link => ({
		...link,
		status: 'idle',
	}));
}

export function updateBatchQueueItem(
	queue: BatchQueueItem[],
	id: string,
	patch: Partial<Omit<BatchQueueItem, 'id'>>
): BatchQueueItem[] {
	return queue.map(item => item.id === id ? { ...item, ...patch } : item);
}

export function normalizeBatchConcurrency(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(3, Math.max(1, Math.floor(value)));
}

export function getBatchSummary(queue: BatchQueueItem[]): BatchSummary {
	let success = 0;
	let failed = 0;
	let pending = 0;

	for (const item of queue) {
		if (item.status === 'success') success += 1;
		else if (item.status === 'failed') failed += 1;
		else pending += 1;
	}

	return {
		total: queue.length,
		success,
		failed,
		pending,
	};
}

export async function runWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const limit = normalizeBatchConcurrency(concurrency);
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function runNext(): Promise<void> {
		const index = nextIndex;
		nextIndex += 1;
		if (index >= items.length) return;
		results[index] = await worker(items[index], index);
		await runNext();
	}

	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		() => runNext()
	);
	await Promise.all(workers);
	return results;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
npm test -- src/utils/batch-queue.test.ts
```

Expected: PASS for all tests in `batch-queue.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/batch-queue.ts src/utils/batch-queue.test.ts
git commit -m "feat: add batch queue helpers"
```

---

### Task 4: Batch Note Renderer

**Files:**
- Create: `src/utils/batch-renderer.ts`
- Create: `src/utils/batch-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/batch-renderer.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Template } from '../types/types';

const mocks = vi.hoisted(() => ({
	initializePageContent: vi.fn(),
	compileTemplate: vi.fn(),
	generateFrontmatter: vi.fn(),
}));

vi.mock('./content-extractor', () => ({
	initializePageContent: mocks.initializePageContent,
}));

vi.mock('./template-compiler', () => ({
	compileTemplate: mocks.compileTemplate,
}));

vi.mock('./obsidian-note-creator', () => ({
	generateFrontmatter: mocks.generateFrontmatter,
}));

vi.mock('./storage-utils', () => ({
	generalSettings: {
		interpreterEnabled: false,
		propertyTypes: [{ name: 'published', type: 'text' }],
	},
}));

import { canRunBatchTemplate, renderBatchNote } from './batch-renderer';

const template: Template = {
	id: 'default',
	name: 'Default',
	behavior: 'create',
	noteNameFormat: '{{title}}',
	path: 'Clips/{{site}}',
	noteContentFormat: '# {{title}}\n{{content}}',
	properties: [{ id: 'published', name: 'published', value: '{{published}}' }],
};

const extractedData = {
	content: '<article>Hello</article>',
	selectedHtml: '',
	extractedContent: {},
	schemaOrgData: {},
	fullHtml: '<html><body>Hello</body></html>',
	highlights: [],
	title: 'Example title',
	author: '',
	description: '',
	favicon: '',
	image: '',
	published: '2026-05-16',
	site: 'Example',
	wordCount: 10,
	language: 'en',
	metaTags: [],
};

describe('canRunBatchTemplate', () => {
	test('blocks prompt templates when interpreter is enabled', () => {
		const promptTemplate = {
			...template,
			noteContentFormat: '{{"summarize this page"}}',
		};

		expect(canRunBatchTemplate(promptTemplate, true)).toEqual({
			ok: false,
			error: 'Batch clipping does not support interpreter prompt variables yet.',
		});
	});

	test('allows normal templates when interpreter is enabled', () => {
		expect(canRunBatchTemplate(template, true)).toEqual({ ok: true });
	});
});

describe('renderBatchNote', () => {
	beforeEach(() => {
		mocks.initializePageContent.mockReset();
		mocks.compileTemplate.mockReset();
		mocks.generateFrontmatter.mockReset();

		mocks.initializePageContent.mockResolvedValue({
			currentVariables: {
				title: 'Example title',
				content: 'Hello',
				site: 'Example',
				published: '2026-05-16',
			},
		});
		mocks.compileTemplate.mockImplementation(async (_tabId, text: string) => {
			return text
				.replace('{{title}}', 'Example title')
				.replace('{{content}}', 'Hello')
				.replace('{{site}}', 'Example')
				.replace('{{published}}', '2026-05-16');
		});
		mocks.generateFrontmatter.mockResolvedValue('---\npublished: 2026-05-16\n---\n');
	});

	test('renders note fields for one extracted page', async () => {
		const rendered = await renderBatchNote({
			tabId: 12,
			url: 'https://example.com/post',
			template,
			extractedData,
			selectedVault: 'Main vault',
		});

		expect(rendered).toEqual({
			fileContent: '---\npublished: 2026-05-16\n---\n# Example title\nHello',
			noteName: 'Example title',
			path: 'Clips/Example',
			vault: 'Main vault',
			behavior: 'create',
			title: 'Example title',
		});
		expect(mocks.initializePageContent).toHaveBeenCalledWith(
			extractedData.content,
			extractedData.selectedHtml,
			extractedData.extractedContent,
			'https://example.com/post',
			extractedData.schemaOrgData,
			extractedData.fullHtml,
			extractedData.highlights,
			extractedData.title,
			extractedData.author,
			extractedData.description,
			extractedData.favicon,
			extractedData.image,
			extractedData.published,
			extractedData.site,
			extractedData.wordCount,
			extractedData.language,
			extractedData.metaTags
		);
	});
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- src/utils/batch-renderer.test.ts
```

Expected: FAIL because `src/utils/batch-renderer.ts` does not exist.

- [ ] **Step 3: Implement the renderer**

Create `src/utils/batch-renderer.ts`:

```ts
import { Template, Property } from '../types/types';
import { initializePageContent } from './content-extractor';
import { compileTemplate } from './template-compiler';
import { generateFrontmatter } from './obsidian-note-creator';
import { formatPropertyValue } from './shared';
import { unescapeValue } from './string-utils';
import { generalSettings } from './storage-utils';

export interface BatchExtractedPageContent {
	content: string;
	selectedHtml: string;
	extractedContent: { [key: string]: string };
	schemaOrgData: any;
	fullHtml: string;
	highlights: any[];
	title: string;
	author: string;
	description: string;
	favicon: string;
	image: string;
	published: string;
	site: string;
	wordCount: number;
	language: string;
	metaTags: { name?: string | null; property?: string | null; content: string | null }[];
}

export interface RenderBatchNoteOptions {
	tabId: number;
	url: string;
	template: Template;
	extractedData: BatchExtractedPageContent;
	selectedVault: string;
}

export interface RenderedBatchNote {
	fileContent: string;
	noteName: string;
	path: string;
	vault: string;
	behavior: Template['behavior'];
	title?: string;
}

export function canRunBatchTemplate(template: Template, interpreterEnabled: boolean): { ok: true } | { ok: false; error: string } {
	if (!interpreterEnabled) return { ok: true };
	const fields = [
		template.noteNameFormat,
		template.path,
		template.noteContentFormat,
		template.context ?? '',
		...template.properties.map(property => property.value),
	];
	const hasPromptVariable = fields.some(field => /{{\s*(?:prompt:)?"/.test(field));
	if (!hasPromptVariable) return { ok: true };
	return {
		ok: false,
		error: 'Batch clipping does not support interpreter prompt variables yet.',
	};
}

export async function renderBatchNote(options: RenderBatchNoteOptions): Promise<RenderedBatchNote> {
	const { tabId, url, template, extractedData, selectedVault } = options;
	const initializedContent = await initializePageContent(
		extractedData.content,
		extractedData.selectedHtml,
		extractedData.extractedContent,
		url,
		extractedData.schemaOrgData,
		extractedData.fullHtml,
		extractedData.highlights || [],
		extractedData.title,
		extractedData.author,
		extractedData.description,
		extractedData.favicon,
		extractedData.image,
		extractedData.published,
		extractedData.site,
		extractedData.wordCount,
		extractedData.language || '',
		extractedData.metaTags
	);

	if (!initializedContent) {
		throw new Error('Unable to initialize page content.');
	}

	const variables = initializedContent.currentVariables;
	const compile = (text: string) => compileTemplate(tabId, text, variables, url);

	const [noteName, path, noteContent, compiledProperties] = await Promise.all([
		compile(template.noteNameFormat),
		compile(template.path),
		template.noteContentFormat ? compile(template.noteContentFormat) : Promise.resolve(''),
		Promise.all(template.properties.map(async (property): Promise<Property> => {
			const compiledValue = await compile(unescapeValue(property.value));
			const propertyType = property.type || generalSettings.propertyTypes.find(type => type.name === property.name)?.type || 'text';
			return {
				id: property.id,
				name: property.name,
				value: formatPropertyValue(compiledValue, propertyType, property.value),
				type: propertyType,
			};
		})),
	]);

	const frontmatter = await generateFrontmatter(compiledProperties);
	const isDailyNote = template.behavior === 'append-daily' || template.behavior === 'prepend-daily';

	return {
		fileContent: frontmatter + noteContent,
		noteName: isDailyNote ? '' : noteName.trim(),
		path: isDailyNote ? '' : path,
		vault: selectedVault || template.vault || '',
		behavior: template.behavior,
		title: extractedData.title,
	};
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
npm test -- src/utils/batch-renderer.test.ts
```

Expected: PASS for all tests in `batch-renderer.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/batch-renderer.ts src/utils/batch-renderer.test.ts
git commit -m "feat: add batch note renderer"
```

---

### Task 5: Content Script Link Extraction Message

**Files:**
- Modify: `src/content.ts`

- [ ] **Step 1: Import the link extractor**

Add this import near the existing utility imports:

```ts
import { extractVisibleLinks } from './utils/batch-links';
```

- [ ] **Step 2: Add the `getVisibleLinks` message action**

Inside `browser.runtime.onMessage.addListener`, directly after the `ping` handler, add:

```ts
		if (request.action === "getVisibleLinks") {
			try {
				sendResponse({
					success: true,
					links: extractVisibleLinks(document, document.URL),
				});
			} catch (error) {
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			return true;
		}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- src/utils/batch-links.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript build for Chrome**

Run:

```bash
npm run build:chrome
```

Expected: build completes and writes `dist/`.

- [ ] **Step 5: Commit**

```bash
git add src/content.ts
git commit -m "feat: expose visible link extraction message"
```

---

### Task 6: Background Temporary Tab Extraction

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Add request and response types**

Near the top-level helper type area in `src/background.ts`, add:

```ts
interface BatchClipTabResult {
	success: boolean;
	tabId?: number;
	url?: string;
	content?: any;
	error?: string;
}
```

- [ ] **Step 2: Add tab load helpers**

Place these helpers near `ensureContentScriptLoadedInBackground`:

```ts
function waitForTabComplete(tabId: number, timeoutMs = 30000): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			browser.tabs.onUpdated.removeListener(listener);
			reject(new Error('Timed out waiting for page to load.'));
		}, timeoutMs);

		const listener = (updatedTabId: number, changeInfo: browser.Tabs.OnUpdatedChangeInfoType) => {
			if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
			clearTimeout(timeout);
			browser.tabs.onUpdated.removeListener(listener);
			resolve();
		};

		browser.tabs.onUpdated.addListener(listener);
	});
}

async function openBatchClipTab(url: string): Promise<BatchClipTabResult> {
	let tabId: number | undefined;
	try {
		if (!isValidUrl(url) || isBlankPage(url) || isRestrictedUrl(url)) {
			throw new Error('Page is restricted or unsupported.');
		}

		const tab = await browser.tabs.create({ url, active: false });
		tabId = tab.id;
		if (!tabId) throw new Error('Temporary tab was not created.');

		await waitForTabComplete(tabId);
		await ensureContentScriptLoadedInBackground(tabId);
		const content = await routeMessageToTab(tabId, { action: 'getPageContent' });
		if (!content || content.success === false) {
			throw new Error(content?.error || 'No content was extracted.');
		}

		const loadedTab = await browser.tabs.get(tabId);
		return {
			success: true,
			tabId,
			url: loadedTab.url || url,
			content,
		};
	} catch (error) {
		if (tabId) {
			await browser.tabs.remove(tabId).catch(() => undefined);
		}
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function closeBatchClipTab(tabId: number): Promise<void> {
	await browser.tabs.remove(tabId).catch(() => undefined);
}
```

- [ ] **Step 3: Add runtime message actions**

Inside the main `browser.runtime.onMessage.addListener` block, add these handlers before `sendMessageToTab`:

```ts
		if (typedRequest.action === "openBatchClipTab") {
			const url = (typedRequest as any).url;
			if (!url || typeof url !== 'string') {
				sendResponse({ success: false, error: 'Missing URL.' });
				return true;
			}
			openBatchClipTab(url).then(sendResponse);
			return true;
		}

		if (typedRequest.action === "closeBatchClipTab") {
			const tabId = (typedRequest as any).tabId;
			if (!tabId || typeof tabId !== 'number') {
				sendResponse({ success: false, error: 'Missing tab ID.' });
				return true;
			}
			closeBatchClipTab(tabId)
				.then(() => sendResponse({ success: true }))
				.catch((error) => sendResponse({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				}));
			return true;
		}
```

- [ ] **Step 4: Run Chrome build**

Run:

```bash
npm run build:chrome
```

Expected: build completes and writes `dist/`.

- [ ] **Step 5: Commit**

```bash
git add src/background.ts
git commit -m "feat: add batch temporary tab extraction"
```

---

### Task 7: Side Panel Batch Markup And Styles

**Files:**
- Modify: `src/side-panel.html`
- Modify: `src/styles/side-panel.scss`

- [ ] **Step 1: Add side panel tab markup**

In `src/side-panel.html`, wrap the existing `.clipper` block with a `Clip` panel and add a `Batch` panel after it. The body structure should become:

```html
	<body id="popup-container">
		<div id="popup-header">
			<!-- existing header content stays unchanged -->
		</div>
		<nav class="side-panel-tabs" aria-label="Clipper views">
			<button id="clip-tab" class="side-panel-tab is-active" type="button" data-panel="clip-panel">Clip</button>
			<button id="batch-tab" class="side-panel-tab" type="button" data-panel="batch-panel">Batch</button>
		</nav>
		<p class="error-message" style="display: none;"></p>
		<section id="clip-panel" class="side-panel-tab-panel is-active">
			<div class="clipper">
				<!-- existing clipper form stays unchanged -->
			</div>
		</section>
		<section id="batch-panel" class="side-panel-tab-panel" hidden>
			<div class="batch-controls">
				<div id="batch-context" class="batch-context">Using the selected template. Set vault and path in Clip.</div>
				<button id="batch-extract-links" type="button">Extract links</button>
				<label class="batch-concurrency-label" for="batch-concurrency">
					Concurrency
					<input id="batch-concurrency" type="number" min="1" max="3" value="1">
				</label>
			</div>
			<div id="batch-summary" class="batch-summary">No links extracted.</div>
			<div id="batch-queue" class="batch-queue"></div>
			<div class="batch-add-row">
				<input id="batch-new-text" type="text" placeholder="Link text">
				<input id="batch-new-url" type="url" placeholder="https://example.com/page">
				<button id="batch-add-link" type="button">Add link</button>
			</div>
			<div class="batch-run-row">
				<button id="batch-run" class="mod-cta" type="button">Run batch</button>
				<button id="batch-retry-failed" type="button" disabled>Retry failed</button>
			</div>
		</section>
		<script type="module" src="popup.js"></script>
	</body>
```

Keep all existing clipper form elements and IDs inside the `clip-panel`; do not duplicate `template-select`, `vault-select`, `path-name-field`, `note-name-field`, or `note-content-field`.

- [ ] **Step 2: Add side panel styles**

Append to `src/styles/side-panel.scss` inside `.is-side-panel:not(.is-embedded)`:

```scss
	.side-panel-tabs {
		display: flex;
		gap: 4px;
		padding: 8px 12px 0;
		border-bottom: 1px solid var(--divider-color);
	}

	.side-panel-tab {
		border: 0;
		border-bottom: 2px solid transparent;
		background: transparent;
		color: var(--text-muted);
		padding: 6px 8px;
		font-size: var(--font-ui-small);
		cursor: pointer;

		&.is-active {
			color: var(--text-normal);
			border-bottom-color: var(--interactive-accent);
		}
	}

	.side-panel-tab-panel {
		display: none;

		&.is-active {
			display: block;
		}
	}

	.batch-controls,
	.batch-add-row,
	.batch-run-row {
		display: flex;
		gap: 8px;
		padding: 12px;
		align-items: center;
	}

	.batch-controls,
	.batch-run-row {
		justify-content: space-between;
	}

	.batch-concurrency-label {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	#batch-concurrency {
		width: 52px;
	}

	.batch-summary {
		padding: 0 12px 8px;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	.batch-context {
		flex: 1;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}

	.batch-queue {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0 12px 12px;
	}

	.batch-queue-item {
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 8px;
		background: var(--background-primary);
	}

	.batch-queue-item-fields {
		display: grid;
		grid-template-columns: 1fr;
		gap: 6px;
	}

	.batch-queue-item-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 6px;
		font-size: var(--font-ui-small);
		color: var(--text-muted);
	}

	.batch-status-failed {
		color: var(--text-error);
	}

	.batch-status-success {
		color: var(--text-success);
	}
```

- [ ] **Step 3: Run Chrome build**

Run:

```bash
npm run build:chrome
```

Expected: build completes and writes `dist/`.

- [ ] **Step 4: Commit**

```bash
git add src/side-panel.html src/styles/side-panel.scss
git commit -m "feat: add batch side panel shell"
```

---

### Task 8: Batch Panel Controller

**Files:**
- Create: `src/core/batch-panel.ts`
- Modify: `src/core/popup.ts`

- [ ] **Step 1: Create the side panel controller**

Create `src/core/batch-panel.ts`:

```ts
import browser from '../utils/browser-polyfill';
import { Template } from '../types/types';
import { createBatchQueue, getBatchSummary, normalizeBatchConcurrency, runWithConcurrency, BatchQueueItem, updateBatchQueueItem } from '../utils/batch-queue';
import { ExtractedBatchLink, normalizeLinkUrl } from '../utils/batch-links';
import { canRunBatchTemplate, renderBatchNote } from '../utils/batch-renderer';
import { saveToObsidian } from '../utils/obsidian-note-creator';
import { generalSettings, incrementStat, setLocalStorage } from '../utils/storage-utils';

interface InitializeBatchPanelOptions {
	getCurrentTabId: () => number | undefined;
	getCurrentTemplate: () => Template | null;
	getSelectedVault: () => string;
	setLastSelectedVault: (vault: string) => void;
	showError: (message: string) => void;
}

interface OpenBatchClipTabResponse {
	success: boolean;
	tabId?: number;
	url?: string;
	content?: any;
	error?: string;
}

let queue: BatchQueueItem[] = [];
let isRunning = false;
let saveChain: Promise<void> = Promise.resolve();

export function initializeBatchPanel(options: InitializeBatchPanelOptions): void {
	const clipTab = document.getElementById('clip-tab') as HTMLButtonElement | null;
	const batchTab = document.getElementById('batch-tab') as HTMLButtonElement | null;
	const clipPanel = document.getElementById('clip-panel') as HTMLElement | null;
	const batchPanel = document.getElementById('batch-panel') as HTMLElement | null;
	const extractButton = document.getElementById('batch-extract-links') as HTMLButtonElement | null;
	const runButton = document.getElementById('batch-run') as HTMLButtonElement | null;
	const retryButton = document.getElementById('batch-retry-failed') as HTMLButtonElement | null;
	const addButton = document.getElementById('batch-add-link') as HTMLButtonElement | null;

	if (!clipTab || !batchTab || !clipPanel || !batchPanel || !extractButton || !runButton || !retryButton || !addButton) return;

	const activatePanel = (panel: 'clip' | 'batch') => {
		const showBatch = panel === 'batch';
		clipTab.classList.toggle('is-active', !showBatch);
		batchTab.classList.toggle('is-active', showBatch);
		clipPanel.classList.toggle('is-active', !showBatch);
		batchPanel.classList.toggle('is-active', showBatch);
		clipPanel.hidden = showBatch;
		batchPanel.hidden = !showBatch;
	};

	clipTab.addEventListener('click', () => activatePanel('clip'));
	batchTab.addEventListener('click', () => activatePanel('batch'));
	extractButton.addEventListener('click', () => extractLinks(options));
	addButton.addEventListener('click', addManualLink);
	runButton.addEventListener('click', () => runBatch(options, queue.filter(item => item.status !== 'success')));
	retryButton.addEventListener('click', () => runBatch(options, queue.filter(item => item.status === 'failed')));

	renderQueue();
}

async function extractLinks(options: InitializeBatchPanelOptions): Promise<void> {
	const tabId = options.getCurrentTabId();
	if (!tabId) {
		options.showError('No active tab found.');
		return;
	}

	const response = await browser.runtime.sendMessage({
		action: 'sendMessageToTab',
		tabId,
		message: { action: 'getVisibleLinks' },
	}) as { success?: boolean; links?: ExtractedBatchLink[]; error?: string };

	if (!response?.success || !response.links) {
		options.showError(response?.error || 'Failed to extract links.');
		return;
	}

	queue = createBatchQueue(response.links);
	renderQueue();
}

function addManualLink(): void {
	const textInput = document.getElementById('batch-new-text') as HTMLInputElement | null;
	const urlInput = document.getElementById('batch-new-url') as HTMLInputElement | null;
	if (!textInput || !urlInput) return;

	const normalizedUrl = normalizeLinkUrl(urlInput.value, window.location.href);
	if (!normalizedUrl) return;

	queue = [
		...queue,
		{
			id: `manual-${Date.now()}`,
			text: textInput.value.trim() || normalizedUrl,
			url: normalizedUrl,
			status: 'idle',
		},
	];
	textInput.value = '';
	urlInput.value = '';
	renderQueue();
}

function renderQueue(): void {
	const container = document.getElementById('batch-queue');
	const summary = document.getElementById('batch-summary');
	const retryButton = document.getElementById('batch-retry-failed') as HTMLButtonElement | null;
	if (!container || !summary) return;

	container.textContent = '';
	const counts = getBatchSummary(queue);
	summary.textContent = counts.total === 0
		? 'No links extracted.'
		: `${counts.total} links: ${counts.success} saved, ${counts.failed} failed, ${counts.pending} pending.`;
	if (retryButton) retryButton.disabled = !queue.some(item => item.status === 'failed') || isRunning;

	for (const item of queue) {
		const row = document.createElement('div');
		row.className = 'batch-queue-item';
		row.dataset.id = item.id;
		row.innerHTML = `
			<div class="batch-queue-item-fields">
				<input class="batch-link-text" type="text" value="${escapeAttribute(item.text)}">
				<input class="batch-link-url" type="url" value="${escapeAttribute(item.url)}">
			</div>
			<div class="batch-queue-item-actions">
				<span class="batch-status batch-status-${item.status}">${escapeAttribute(item.error || item.status)}</span>
				<button class="batch-remove-link" type="button">Remove</button>
			</div>
		`;

		row.querySelector('.batch-link-text')?.addEventListener('input', (event) => {
			queue = updateBatchQueueItem(queue, item.id, { text: (event.target as HTMLInputElement).value });
		});
		row.querySelector('.batch-link-url')?.addEventListener('input', (event) => {
			queue = updateBatchQueueItem(queue, item.id, { url: (event.target as HTMLInputElement).value });
		});
		row.querySelector('.batch-remove-link')?.addEventListener('click', () => {
			queue = queue.filter(link => link.id !== item.id);
			renderQueue();
		});
		container.appendChild(row);
	}
}

async function runBatch(options: InitializeBatchPanelOptions, items: BatchQueueItem[]): Promise<void> {
	if (isRunning || items.length === 0) return;
	const template = options.getCurrentTemplate();
	if (!template) {
		options.showError('No template selected.');
		return;
	}
	const templateCheck = canRunBatchTemplate(template, generalSettings.interpreterEnabled);
	if (!templateCheck.ok) {
		options.showError(templateCheck.error);
		return;
	}

	isRunning = true;
	renderQueue();
	const concurrencyInput = document.getElementById('batch-concurrency') as HTMLInputElement | null;
	const concurrency = normalizeBatchConcurrency(Number(concurrencyInput?.value || 1));

	await runWithConcurrency(items, concurrency, async (item) => {
		await processQueueItem(options, template, item);
	});

	isRunning = false;
	renderQueue();
}

async function processQueueItem(options: InitializeBatchPanelOptions, template: Template, item: BatchQueueItem): Promise<void> {
	let tempTabId: number | undefined;
	try {
		queue = updateBatchQueueItem(queue, item.id, { status: 'opening', error: undefined });
		renderQueue();

		const opened = await browser.runtime.sendMessage({
			action: 'openBatchClipTab',
			url: item.url,
		}) as OpenBatchClipTabResponse;

		if (!opened.success || !opened.tabId || !opened.content) {
			throw new Error(opened.error || 'No content was extracted.');
		}
		tempTabId = opened.tabId;

		queue = updateBatchQueueItem(queue, item.id, { status: 'rendering' });
		renderQueue();
		const rendered = await renderBatchNote({
			tabId: opened.tabId,
			url: opened.url || item.url,
			template,
			extractedData: opened.content,
			selectedVault: options.getSelectedVault(),
		});

		await browser.runtime.sendMessage({ action: 'closeBatchClipTab', tabId: tempTabId });
		tempTabId = undefined;

		queue = updateBatchQueueItem(queue, item.id, { status: 'saving' });
		renderQueue();
		await enqueueSave(async () => {
			await saveToObsidian(rendered.fileContent, rendered.noteName, rendered.path, rendered.vault, rendered.behavior);
			await incrementStat('addToObsidian', rendered.vault, rendered.path, item.url, rendered.title || item.text);
			options.setLastSelectedVault(rendered.vault);
			await setLocalStorage('lastSelectedVault', rendered.vault);
		});

		queue = updateBatchQueueItem(queue, item.id, { status: 'success', error: undefined });
		renderQueue();
	} catch (error) {
		if (tempTabId) {
			await browser.runtime.sendMessage({ action: 'closeBatchClipTab', tabId: tempTabId }).catch(() => undefined);
		}
		queue = updateBatchQueueItem(queue, item.id, {
			status: 'failed',
			error: error instanceof Error ? error.message : String(error),
		});
		renderQueue();
	}
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function enqueueSave(task: () => Promise<void>): Promise<void> {
	saveChain = saveChain.then(task, task);
	return saveChain;
}
```

- [ ] **Step 2: Wire the controller into `popup.ts`**

Add this import:

```ts
import { initializeBatchPanel } from './batch-panel';
```

After `determineMainAction();` in the DOM initialization block, add:

```ts
				if (isSidePanel && !isIframe) {
					initializeBatchPanel({
						getCurrentTabId: () => currentTabId,
						getCurrentTemplate: () => currentTemplate,
						getSelectedVault: () => {
							const vaultDropdown = document.getElementById('vault-select') as HTMLSelectElement | null;
							return vaultDropdown?.value || currentTemplate?.vault || '';
						},
						setLastSelectedVault: (vault: string) => {
							lastSelectedVault = vault;
						},
						showError,
					});
				}
```

- [ ] **Step 3: Run focused unit tests**

Run:

```bash
npm test -- src/utils/batch-links.test.ts src/utils/batch-queue.test.ts src/utils/batch-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run Chrome build**

Run:

```bash
npm run build:chrome
```

Expected: build completes and writes `dist/`.

- [ ] **Step 5: Commit**

```bash
git add src/core/batch-panel.ts src/core/popup.ts
git commit -m "feat: wire batch side panel controller"
```

---

### Task 9: Manual Browser Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Build Chrome extension**

Run:

```bash
npm run build:chrome
```

Expected: build completes and writes `dist/`.

- [ ] **Step 2: Load `dist/` in Chrome or Edge**

Open `chrome://extensions`, enable developer mode, click `Load unpacked`, and select `F:\code\git\obsidian-clipper\dist`.

Expected: extension loads without manifest errors.

- [ ] **Step 3: Verify existing Clip tab**

Open a normal HTTP or HTTPS page, open the extension side panel, keep the `Clip` tab active, and perform a normal single-page clip.

Expected: the current single-page clipper still extracts content and saves through Obsidian.

- [ ] **Step 4: Verify link extraction**

Open a page with several visible links, switch to `Batch`, and click `Extract links`.

Expected: queue rows appear in page order, unsupported links are absent, and duplicate URLs appear once.

- [ ] **Step 5: Verify editing**

Edit one label, edit one URL, remove one item, and add one manual link.

Expected: edited values remain in the queue and removed items do not reappear.

- [ ] **Step 6: Verify serial run**

Set concurrency to `1`, click `Run batch`, and wait for completion.

Expected: each item transitions through running statuses, successful items show `success`, failed items show a specific error, temporary tabs close after rendering, and Obsidian receives one save per successful link.

- [ ] **Step 7: Verify small concurrency**

Extract links again, set concurrency to `2`, and click `Run batch`.

Expected: multiple temporary tabs may open for extraction, but saves to Obsidian still happen one at a time from the side panel.

- [ ] **Step 8: Verify retry failed**

Add one invalid URL such as `https://localhost.invalid/missing`, run the batch, correct the failed row to a valid URL, and click `Retry failed`.

Expected: only failed rows run again.

- [ ] **Step 9: Commit verification notes if source changed**

If manual verification required source fixes, commit those fixes with a focused message after rerunning the relevant tests and build.

---

### Task 10: Full Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run all unit tests**

Run:

```bash
npm test
```

Expected: PASS for all test files.

- [ ] **Step 2: Run Chrome build**

Run:

```bash
npm run build:chrome
```

Expected: build completes and writes `dist/`.

- [ ] **Step 3: Run cross-browser builds**

Run:

```bash
npm run build:firefox
npm run build:safari
```

Expected: both builds complete. Batch UI remains Chrome side-panel-focused, and Firefox/Safari retain their existing popup behavior.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short --branch
```

Expected: only intentional source changes are present, and `.superpowers/` is not listed.
