import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parseHTML } from 'linkedom';

vi.mock('../utils/browser-polyfill', () => ({
	default: { runtime: { sendMessage: vi.fn() } },
}));

vi.mock('../utils/obsidian-note-creator', () => ({
	saveToObsidian: vi.fn(),
}));

vi.mock('../utils/storage-utils', () => ({
	generalSettings: { interpreterEnabled: false },
	incrementStat: vi.fn(),
	setLocalStorage: vi.fn(),
}));

vi.mock('../utils/batch-renderer', () => ({
	canRunBatchTemplate: vi.fn(() => ({ ok: true })),
	renderBatchNote: vi.fn(),
}));

import { initializeBatchPanel, saveRenderedBatchNoteToPaths } from './batch-panel';

function setupDom(): void {
	const { document, window } = parseHTML(`
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

	Object.defineProperty(window, 'location', {
		value: { href: 'https://current.test/page' },
		configurable: true,
	});

	vi.stubGlobal('document', document);
	vi.stubGlobal('window', window);
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
		});

		(document.getElementById('batch-new-text') as HTMLInputElement).value = 'Example';
		(document.getElementById('batch-new-url') as HTMLInputElement).value = 'https://example.com/a';
		(document.getElementById('batch-new-path') as HTMLInputElement).value = 'Clippings/Manual';
		(document.getElementById('batch-add-link') as HTMLButtonElement).click();

		expect(document.querySelectorAll('.batch-path-input')).toHaveLength(1);
		expect((document.querySelector('.batch-path-input') as HTMLInputElement).value).toBe('Clippings/Manual');
	});

	test('shows page-dependent extract errors in the batch summary', () => {
		initializeBatchPanel({
			getCurrentTabId: () => 1,
			getCurrentTemplate: () => null,
			getSelectedVault: () => '',
			canExtractLinks: () => false,
			setLastSelectedVault: vi.fn(),
		});

		(document.getElementById('batch-extract-links') as HTMLButtonElement).click();

		expect(document.getElementById('batch-summary')?.textContent).toBe('pageCannotBeClipped');
	});
});

describe('saveRenderedBatchNoteToPaths', () => {
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
});
