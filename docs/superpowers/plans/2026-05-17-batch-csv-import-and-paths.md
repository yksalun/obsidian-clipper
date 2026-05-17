# Batch CSV Import and Multi-Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the side-panel Batch tab usable on blank tabs, import CSV rows into a merged queue, and save one link to one or more Obsidian paths.

**Architecture:** Keep the existing side-panel, queue, renderer, and Obsidian save chain. Add CSV parsing as a small utility, add path-aware queue helpers, then wire those helpers into `batch-panel.ts` and loosen side-panel initialization in `popup.ts` so batch setup is independent from current-page clip validation.

**Tech Stack:** TypeScript, WebExtension APIs through `browser-polyfill`, Vitest, linkedom-style DOM tests where needed, Webpack.

---

## Files and Responsibilities

- Create `src/utils/batch-csv.ts`: parse CSV text, validate absolute HTTP(S) URLs, merge duplicate URL rows, generate the sample CSV download payload.
- Create `src/utils/batch-csv.test.ts`: cover CSV parsing, merging, invalid rows, and sample content.
- Modify `src/utils/batch-queue.ts`: add `paths: string[]` to queue items and add save-path resolution helpers.
- Modify `src/utils/batch-queue.test.ts`: cover empty path defaults, path preservation, and save-path resolution order.
- Modify `src/core/batch-panel.ts`: add default path, CSV import/download, per-row path editors, manual initial path, and multi-path save execution.
- Modify `src/side-panel.html`: add Batch controls for default path, CSV import, sample download, and manual path input.
- Modify `src/styles/side-panel.scss`: layout the new controls and per-row path inputs without disturbing the Clip tab.
- Modify `src/utils/active-tab-manager.ts`: add a small clip-availability helper that distinguishes clip blocking from batch availability.
- Modify `src/utils/active-tab-manager.test.ts`: cover blank/restricted page availability messages.
- Modify `src/core/popup.ts`: initialize the side panel shell and Batch tab before current-tab clip validation blocks the Clip tab.

---

### Task 1: CSV Import Utility

**Files:**
- Create: `src/utils/batch-csv.ts`
- Create: `src/utils/batch-csv.test.ts`

- [ ] **Step 1: Write failing CSV utility tests**

Add `src/utils/batch-csv.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { createBatchCsvSample, importBatchCsv } from './batch-csv';

describe('importBatchCsv', () => {
	test('merges duplicate URL rows into one link with multiple paths', () => {
		const result = importBatchCsv([
			'url,text,path',
			'https://example.com/a,Example A,Clippings/News',
			'https://example.com/a,Example A,Clippings/Archive',
			'https://example.com/b,Example B,',
		].join('\n'));

		expect(result.links).toEqual([
			{
				id: 'csv-link-1',
				text: 'Example A',
				url: 'https://example.com/a',
				paths: ['Clippings/News', 'Clippings/Archive'],
			},
			{
				id: 'csv-link-2',
				text: 'Example B',
				url: 'https://example.com/b',
				paths: [],
			},
		]);
		expect(result.importedRows).toBe(3);
		expect(result.mergedRows).toBe(1);
		expect(result.skippedRows).toBe(0);
	});

	test('parses quoted commas and trims headers case-insensitively', () => {
		const result = importBatchCsv([
			' URL , TEXT , PATH , ignored',
			'"https://example.com/a","Example, A","Clippings, News",x',
		].join('\n'));

		expect(result.links[0]).toEqual({
			id: 'csv-link-1',
			text: 'Example, A',
			url: 'https://example.com/a',
			paths: ['Clippings, News'],
		});
	});

	test('skips invalid and unsupported URLs while importing valid rows', () => {
		const result = importBatchCsv([
			'url,text,path',
			'not-a-url,Bad,Clips',
			'mailto:test@example.com,Mail,Clips',
			'https://example.com/good,Good,Clips',
		].join('\n'));

		expect(result.links).toHaveLength(1);
		expect(result.links[0].url).toBe('https://example.com/good');
		expect(result.skippedRows).toBe(2);
		expect(result.errors.map(error => error.row)).toEqual([2, 3]);
	});

	test('uses the URL as text when text is empty', () => {
		const result = importBatchCsv('url,text,path\nhttps://example.com/a,,Clips');

		expect(result.links[0].text).toBe('https://example.com/a');
	});
});

describe('createBatchCsvSample', () => {
	test('returns a stable filename and sample content', () => {
		expect(createBatchCsvSample()).toEqual({
			filename: 'obsidian-batch-import-sample.csv',
			content: [
				'url,text,path',
				'https://example.com/a,Example A,Clippings/News',
				'https://example.com/a,Example A,Clippings/Archive',
				'https://example.com/b,Example B,',
			].join('\n'),
		});
	});
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/utils/batch-csv.test.ts`

Expected: FAIL because `src/utils/batch-csv.ts` does not exist.

- [ ] **Step 3: Implement CSV utility**

Create `src/utils/batch-csv.ts` with these exported shapes:

```ts
export interface BatchCsvImportLink {
	id: string;
	text: string;
	url: string;
	paths: string[];
}

export interface BatchCsvImportError {
	row: number;
	message: string;
}

export interface BatchCsvImportResult {
	links: BatchCsvImportLink[];
	importedRows: number;
	mergedRows: number;
	skippedRows: number;
	errors: BatchCsvImportError[];
}

export interface BatchCsvSample {
	filename: string;
	content: string;
}

export function importBatchCsv(csvText: string): BatchCsvImportResult;
export function createBatchCsvSample(): BatchCsvSample;
```

Implementation requirements:

- Parse RFC4180-style quoted fields for commas, double quotes, CRLF, and LF.
- Require a header row with a `url` column after trimming and lowercasing header names.
- Treat `text` and `path` as optional columns.
- Ignore unknown columns.
- Ignore fully empty rows.
- Validate imported URLs with `new URL(raw.trim())` and accept only `http:` and `https:`.
- Normalize accepted URLs to `url.href`.
- Merge rows by normalized URL.
- Preserve first non-empty text.
- Preserve path first-seen order after trimming and de-duplicating per URL.
- Generate IDs as `csv-link-1`, `csv-link-2`, in first-seen URL order.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm test -- src/utils/batch-csv.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/utils/batch-csv.ts src/utils/batch-csv.test.ts
git commit -m "feat: add batch csv import utility"
```

---

### Task 2: Path-Aware Queue Helpers

**Files:**
- Modify: `src/utils/batch-queue.ts`
- Modify: `src/utils/batch-queue.test.ts`

- [ ] **Step 1: Write failing queue path tests**

Update `src/utils/batch-queue.test.ts` imports to include `resolveBatchSavePaths`, then add:

```ts
describe('createBatchQueue paths', () => {
	test('assigns empty paths for extracted links without paths', () => {
		const queue = createBatchQueue([
			{ id: 'batch-link-1', text: 'A', url: 'https://example.com/a' },
		]);

		expect(queue[0].paths).toEqual([]);
	});

	test('preserves imported paths when present', () => {
		const queue = createBatchQueue([
			{ id: 'csv-link-1', text: 'A', url: 'https://example.com/a', paths: ['One', 'Two'] },
		]);

		expect(queue[0].paths).toEqual(['One', 'Two']);
	});
});

describe('resolveBatchSavePaths', () => {
	test('uses item paths before the default and rendered paths', () => {
		expect(resolveBatchSavePaths(
			{ id: '1', text: 'A', url: 'https://a.test', paths: ['One', 'Two'], status: 'idle' },
			'Default',
			'Rendered'
		)).toEqual(['One', 'Two']);
	});

	test('uses default path when item paths are empty', () => {
		expect(resolveBatchSavePaths(
			{ id: '1', text: 'A', url: 'https://a.test', paths: [], status: 'idle' },
			'Default',
			'Rendered'
		)).toEqual(['Default']);
	});

	test('falls back to rendered template path when item and default paths are empty', () => {
		expect(resolveBatchSavePaths(
			{ id: '1', text: 'A', url: 'https://a.test', paths: [], status: 'idle' },
			'',
			'Rendered'
		)).toEqual(['Rendered']);
	});

	test('trims, removes empty paths, and de-duplicates paths', () => {
		expect(resolveBatchSavePaths(
			{ id: '1', text: 'A', url: 'https://a.test', paths: [' One ', '', 'One', 'Two'], status: 'idle' },
			'Default',
			'Rendered'
		)).toEqual(['One', 'Two']);
	});
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/utils/batch-queue.test.ts`

Expected: FAIL because `paths` and `resolveBatchSavePaths` do not exist.

- [ ] **Step 3: Implement path-aware queue helpers**

Change `BatchQueueItem` to include `paths: string[]`.

Allow `ExtractedBatchLink` inputs with optional paths by changing or locally typing:

```ts
export function createBatchQueue(links: Array<ExtractedBatchLink & { paths?: string[] }>): BatchQueueItem[] {
	return links.map(link => ({
		...link,
		paths: Array.isArray(link.paths) ? normalizePathList(link.paths) : [],
		status: 'idle',
	}));
}
```

Add:

```ts
export function resolveBatchSavePaths(
	item: Pick<BatchQueueItem, 'paths'>,
	defaultPath: string,
	renderedPath: string
): string[] {
	const itemPaths = normalizePathList(item.paths);
	if (itemPaths.length > 0) return itemPaths;

	const defaultPaths = normalizePathList([defaultPath]);
	if (defaultPaths.length > 0) return defaultPaths;

	return normalizePathList([renderedPath]);
}

function normalizePathList(paths: string[]): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const path of paths) {
		const trimmed = path.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		normalized.push(trimmed);
	}
	return normalized;
}
```

Update existing test expected queue items to include `paths: []`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm test -- src/utils/batch-queue.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/utils/batch-queue.ts src/utils/batch-queue.test.ts
git commit -m "feat: add batch save path resolution"
```

---

### Task 3: Batch Panel CSV and Path UI

**Files:**
- Modify: `src/side-panel.html`
- Modify: `src/styles/side-panel.scss`
- Modify: `src/core/batch-panel.ts`

- [ ] **Step 1: Write failing import wiring test**

Create `src/core/batch-panel.test.ts` with a DOM-focused test for the utility-facing behavior:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parseHTML } from 'linkedom';

vi.mock('../utils/browser-polyfill', () => ({
	default: { runtime: { sendMessage: vi.fn() } },
}));
vi.mock('../utils/obsidian-note-creator', () => ({ saveToObsidian: vi.fn() }));
vi.mock('../utils/storage-utils', () => ({
	generalSettings: { interpreterEnabled: false },
	incrementStat: vi.fn(),
	setLocalStorage: vi.fn(),
}));

import { initializeBatchPanel } from './batch-panel';

function setupDom() {
	const { document } = parseHTML(`
		<button id="clip-tab"></button>
		<button id="batch-tab"></button>
		<section id="clip-panel"></section>
		<section id="batch-panel"></section>
		<input id="batch-default-path">
		<input id="batch-import-csv" type="file">
		<button id="batch-download-sample"></button>
		<button id="batch-extract-links"></button>
		<input id="batch-concurrency">
		<div id="batch-summary"></div>
		<div id="batch-queue"></div>
		<input id="batch-new-text">
		<input id="batch-new-url">
		<input id="batch-new-path">
		<button id="batch-add-link"></button>
		<button id="batch-run"></button>
		<button id="batch-retry-failed"></button>
	`);
	global.document = document as unknown as Document;
	global.window = document.defaultView as unknown as Window & typeof globalThis;
}

describe('initializeBatchPanel path UI', () => {
	beforeEach(() => {
		setupDom();
	});

	test('adds a manual link with an initial path', () => {
		initializeBatchPanel({
			getCurrentTabId: () => undefined,
			getCurrentTemplate: () => null,
			getSelectedVault: () => '',
			getDefaultPath: () => '',
			setLastSelectedVault: vi.fn(),
			showError: vi.fn(),
		});

		(document.getElementById('batch-new-text') as HTMLInputElement).value = 'Example';
		(document.getElementById('batch-new-url') as HTMLInputElement).value = 'https://example.com/a';
		(document.getElementById('batch-new-path') as HTMLInputElement).value = 'Clippings/Manual';
		(document.getElementById('batch-add-link') as HTMLButtonElement).click();

		expect(document.querySelectorAll('.batch-path-input')).toHaveLength(1);
		expect((document.querySelector('.batch-path-input') as HTMLInputElement).value).toBe('Clippings/Manual');
	});
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/core/batch-panel.test.ts`

Expected: FAIL because new DOM IDs and `getDefaultPath` support do not exist.

- [ ] **Step 3: Update side-panel HTML**

In `src/side-panel.html`, replace the Batch top controls and add-row with:

```html
<div class="batch-controls">
	<div id="batch-context" class="batch-context">Using the selected template and vault.</div>
	<label class="batch-default-path-label" for="batch-default-path">
		Default path
		<input id="batch-default-path" type="text" placeholder="Clippings">
	</label>
	<div class="batch-import-row">
		<input id="batch-import-csv" type="file" accept=".csv,text/csv">
		<button id="batch-download-sample" type="button">Download sample CSV</button>
		<button id="batch-extract-links" type="button">Extract links</button>
	</div>
	<label class="batch-concurrency-label" for="batch-concurrency">
		Concurrency
		<input id="batch-concurrency" type="number" min="1" max="3" value="1">
	</label>
</div>
```

Change the add row to include:

```html
<input id="batch-new-path" type="text" placeholder="Obsidian path">
```

- [ ] **Step 4: Update batch panel DOM code**

In `src/core/batch-panel.ts`:

- Add `getDefaultPath: () => string` to `InitializeBatchPanelOptions`.
- Read new elements: `defaultPathInput`, `importInput`, `downloadSampleButton`, and `newPathInput`.
- Initialize `defaultPathInput.value` from `options.getDefaultPath()`.
- Import `importBatchCsv` and `createBatchCsvSample` from `../utils/batch-csv`.
- On CSV import, read the selected file with `await file.text()`, call `importBatchCsv`, convert `result.links` through `createBatchQueue`, render the queue, and show a concise summary in `batch-summary`.
- On sample download, create a `Blob` from sample content, create an object URL, click a temporary `<a download>`, and revoke the object URL.
- In `addManualLink()`, read `batch-new-path`; create the queue item with `paths: trimmedPath ? [trimmedPath] : []`.
- In `createQueueRow()`, render one or more `.batch-path-input` fields and an `Add path` button. If `item.paths` is empty, render one blank path input so the user can add an override.
- On path input changes, update `item.paths` after trimming blank fields out of the stored value.

- [ ] **Step 5: Update CSS**

In `src/styles/side-panel.scss`, keep the current compact side-panel style and add classes:

```scss
.batch-default-path-label,
.batch-import-row,
.batch-path-list,
.batch-path-row {
	display: flex;
	gap: 8px;
	min-width: 0;
}

.batch-default-path-label,
.batch-path-list {
	flex-direction: column;
}

.batch-import-row {
	flex-wrap: wrap;
	grid-column: 1 / -1;
}

.batch-path-row input,
.batch-default-path-label input {
	min-width: 0;
	width: 100%;
}
```

- [ ] **Step 6: Run tests to verify GREEN**

Run: `npm test -- src/core/batch-panel.test.ts src/utils/batch-csv.test.ts src/utils/batch-queue.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- src/side-panel.html src/styles/side-panel.scss src/core/batch-panel.ts src/core/batch-panel.test.ts
git commit -m "feat: wire batch csv path controls"
```

---

### Task 4: Multi-Path Batch Saving

**Files:**
- Modify: `src/core/batch-panel.ts`
- Modify: `src/core/batch-panel.test.ts`
- Modify: `src/utils/batch-queue.ts`

- [ ] **Step 1: Write failing save-path behavior test**

Add focused tests in `src/core/batch-panel.test.ts` for a new exported helper named `saveRenderedBatchNoteToPaths`:

```ts
import { saveRenderedBatchNoteToPaths } from './batch-panel';

test('saves one rendered note to every resolved path', async () => {
	const save = vi.fn().mockResolvedValue(undefined);
	const wait = vi.fn().mockResolvedValue(undefined);

	await saveRenderedBatchNoteToPaths(
		{
			fileContent: '# Example',
			noteName: 'Example',
			path: 'Rendered',
			vault: 'Main',
			behavior: 'create',
			title: 'Example',
		},
		['One', 'Two'],
		save,
		wait
	);

	expect(save).toHaveBeenCalledTimes(2);
	expect(save).toHaveBeenNthCalledWith(1, '# Example', 'Example', 'One', 'Main', 'create');
	expect(save).toHaveBeenNthCalledWith(2, '# Example', 'Example', 'Two', 'Main', 'create');
	expect(wait).toHaveBeenCalledTimes(2);
});

test('wraps path-specific save failures with the destination path', async () => {
	const save = vi.fn()
		.mockResolvedValueOnce(undefined)
		.mockRejectedValueOnce(new Error('Obsidian rejected the request'));
	const wait = vi.fn().mockResolvedValue(undefined);

	await expect(saveRenderedBatchNoteToPaths(
		{
			fileContent: '# Example',
			noteName: 'Example',
			path: 'Rendered',
			vault: 'Main',
			behavior: 'create',
			title: 'Example',
		},
		['One', 'Two'],
		save,
		wait
	)).rejects.toThrow('Failed to save to Two: Obsidian rejected the request');
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/core/batch-panel.test.ts src/utils/batch-queue.test.ts`

Expected: FAIL because `saveRenderedBatchNoteToPaths` is not exported yet.

- [ ] **Step 3: Implement multi-path save loop**

Add this exported helper in `src/core/batch-panel.ts`:

```ts
type BatchSaveFunction = typeof saveToObsidian;
type BatchWaitFunction = (ms: number) => Promise<void>;

export async function saveRenderedBatchNoteToPaths(
	rendered: RenderedBatchNote,
	paths: string[],
	save: BatchSaveFunction = saveToObsidian,
	wait: BatchWaitFunction = delay
): Promise<void> {
	for (const path of paths) {
		try {
			await save(rendered.fileContent, rendered.noteName, path, rendered.vault, rendered.behavior);
			await wait(SAVE_SETTLE_DELAY_MS);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to save to ${path}: ${message}`);
		}
	}
}
```

In `processQueueItem()`:

- Pass the batch default path into `processQueueItem()`.
- After `renderBatchNote()`, call `resolveBatchSavePaths(item, defaultPath, rendered.path)`.
- Save the same rendered note once per resolved path through the helper:

```ts
const savePaths = resolveBatchSavePaths(item, defaultPath, rendered.path);
await enqueueSave(async () => {
	await saveRenderedBatchNoteToPaths(rendered, savePaths);
});
```

- Use `savePaths[0]` for the existing `incrementStat()` call so stats remain one entry per queue item.

- [ ] **Step 4: Run targeted tests**

Run: `npm test -- src/core/batch-panel.test.ts src/utils/batch-queue.test.ts src/utils/batch-renderer.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/core/batch-panel.ts src/core/batch-panel.test.ts src/utils/batch-queue.ts
git commit -m "feat: save batch links to multiple paths"
```

---

### Task 5: Blank Tab Side-Panel Initialization

**Files:**
- Modify: `src/utils/active-tab-manager.ts`
- Modify: `src/utils/active-tab-manager.test.ts`
- Modify: `src/core/popup.ts`

- [ ] **Step 1: Write failing availability tests**

Add to `src/utils/active-tab-manager.test.ts`:

```ts
import { getClipAvailability } from './active-tab-manager';

describe('getClipAvailability', () => {
	test('marks blank pages unavailable for Clip but not as a fatal side-panel setup condition', () => {
		expect(getClipAvailability('about:blank')).toEqual({
			canClip: false,
			errorKey: 'pageCannotBeClipped',
			canUseBatch: true,
			canExtractLinks: false,
		});
	});

	test('allows normal HTTP pages for clip and batch extraction', () => {
		expect(getClipAvailability('https://example.com')).toEqual({
			canClip: true,
			errorKey: undefined,
			canUseBatch: true,
			canExtractLinks: true,
		});
	});

	test('marks restricted pages unavailable for Clip and extraction while keeping Batch usable', () => {
		expect(getClipAvailability('https://chromewebstore.google.com/detail/test')).toEqual({
			canClip: false,
			errorKey: 'pageCannotBeClipped',
			canUseBatch: true,
			canExtractLinks: false,
		});
	});
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/utils/active-tab-manager.test.ts`

Expected: FAIL because `getClipAvailability` does not exist.

- [ ] **Step 3: Implement availability helper**

Add to `src/utils/active-tab-manager.ts`:

```ts
export interface ClipAvailability {
	canClip: boolean;
	errorKey?: 'pageCannotBeClipped' | 'onlyHttpSupported';
	canUseBatch: boolean;
	canExtractLinks: boolean;
}

export function getClipAvailability(url: string | undefined): ClipAvailability {
	if (!url || isBlankPage(url)) {
		return { canClip: false, errorKey: 'pageCannotBeClipped', canUseBatch: true, canExtractLinks: false };
	}
	if (!isValidUrl(url)) {
		return { canClip: false, errorKey: 'onlyHttpSupported', canUseBatch: true, canExtractLinks: false };
	}
	if (isRestrictedUrl(url)) {
		return { canClip: false, errorKey: 'pageCannotBeClipped', canUseBatch: true, canExtractLinks: false };
	}
	return { canClip: true, canUseBatch: true, canExtractLinks: true };
}
```

- [ ] **Step 4: Refactor popup initialization**

In `src/core/popup.ts`:

- Import `getClipAvailability`.
- Keep loading settings, translations, language direction, browser class, templates, triggers, and last vault regardless of blank tab state.
- Replace the early `return` in `initializeExtension()` for blank/invalid/restricted pages with returning an availability object or setting module-level availability.
- In `DOMContentLoaded`, always call `updateVaultDropdown()`, `populateTemplateDropdown()`, and `initializeBatchPanel()` for side panel mode after common setup succeeds.
- Keep the template dropdown change listener active even when `availability.canClip` is false by extracting it into `setupTemplateDropdownListener()`.
- Only call page-dependent listeners such as highlighter, reader, share, copy, save-downloads, `determineMainAction()`, and `refreshFields(currentTabId)` when `availability.canClip` is true.
- When `availability.canClip` is false, call `showError(availability.errorKey)` for the Clip tab but leave Batch controls live.
- Pass `canExtractLinks` into `initializeBatchPanel()` so `Extract links` can be disabled or can show the page-dependent error while manual/CSV operations stay enabled.

- [ ] **Step 5: Run tests**

Run: `npm test -- src/utils/active-tab-manager.test.ts src/utils/batch-queue.test.ts src/core/batch-panel.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/utils/active-tab-manager.ts src/utils/active-tab-manager.test.ts src/core/popup.ts src/core/batch-panel.ts
git commit -m "fix: initialize batch panel on blank tabs"
```

---

### Task 6: Full Verification and Build

**Files:**
- No new files expected.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Build Chrome extension**

Run: `npm run build:chrome`

Expected: PASS and regenerate `dist/` with `side-panel.html` and `manifest.json`.

- [ ] **Step 3: Inspect built side panel controls**

Run:

```powershell
Select-String -Path 'dist\\side-panel.html' -Pattern 'batch-default-path','batch-import-csv','batch-download-sample','batch-new-path'
```

Expected: all four IDs appear in `dist/side-panel.html`.

- [ ] **Step 4: Inspect Chrome manifest remains side-panel based**

Run:

```powershell
Get-Content -Path 'dist\\manifest.json' | Select-String -Pattern 'side_panel','default_path','"action"'
```

Expected: `side_panel.default_path` is `side-panel.html` and `action` has no `default_popup`.

- [ ] **Step 5: Final status**

Run: `git status --short --branch`

Expected: only intended build artifacts or source changes are present. Do not commit generated `dist/` unless this branch already tracks it and the user expects built output in commits.
