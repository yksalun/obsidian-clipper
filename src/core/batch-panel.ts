import browser from '../utils/browser-polyfill';
import { Template } from '../types/types';
import {
	BatchQueueItem,
	createBatchQueue,
	getBatchSummary,
	normalizeBatchConcurrency,
	resolveBatchSavePaths,
	runWithConcurrency,
	updateBatchQueueItem,
} from '../utils/batch-queue';
import { ExtractedBatchLink, normalizeLinkUrl } from '../utils/batch-links';
import { canRunBatchTemplate, renderBatchNote, BatchExtractedPageContent, RenderedBatchNote } from '../utils/batch-renderer';
import { createBatchCsvSample, importBatchCsv } from '../utils/batch-csv';
import { saveToObsidian } from '../utils/obsidian-note-creator';
import { generalSettings, incrementStat, setLocalStorage } from '../utils/storage-utils';
import { initializeIcons } from '../icons/icons';

interface InitializeBatchPanelOptions {
	getCurrentTabId: () => number | undefined;
	getCurrentTemplate: () => Template | null;
	getSelectedVault: () => string;
	getDefaultPath?: () => string;
	canExtractLinks?: () => boolean;
	setLastSelectedVault: (vault: string) => void;
}

interface ExtractLinksResponse {
	success?: boolean;
	links?: ExtractedBatchLink[];
	error?: string;
}

interface OpenBatchClipTabResponse {
	success: boolean;
	tabId?: number;
	url?: string;
	content?: BatchExtractedPageContent;
	error?: string;
}

let queue: BatchQueueItem[] = [];
let isRunning = false;
let saveChain: Promise<void> = Promise.resolve();
let manualLinkId = 0;

const SAVE_SETTLE_DELAY_MS = 1500;

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

export function initializeBatchPanel(options: InitializeBatchPanelOptions): void {
	const elements = getBatchPanelElements();
	if (!elements) return;

	const { clipTab, batchTab, extractButton, importInput, downloadSampleButton, runButton, retryButton, addButton, defaultPathInput } = elements;

	defaultPathInput.value = options.getDefaultPath?.() || '';

	clipTab.addEventListener('click', () => activatePanel('clip', elements));
	batchTab.addEventListener('click', () => activatePanel('batch', elements));
	extractButton.addEventListener('click', () => extractLinks(options));
	importInput.addEventListener('change', () => importCsv(importInput, options));
	downloadSampleButton.addEventListener('click', () => downloadSampleCsv());
	addButton.addEventListener('click', () => addManualLink());
	runButton.addEventListener('click', () => runBatch(options, queue.filter(item => item.status !== 'success')));
	retryButton.addEventListener('click', () => runBatch(options, queue.filter(item => item.status === 'failed')));

	renderQueue();
}

interface BatchPanelElements {
	clipTab: HTMLButtonElement;
	batchTab: HTMLButtonElement;
	clipPanel: HTMLElement;
	batchPanel: HTMLElement;
	extractButton: HTMLButtonElement;
	importInput: HTMLInputElement;
	downloadSampleButton: HTMLButtonElement;
	runButton: HTMLButtonElement;
	retryButton: HTMLButtonElement;
	addButton: HTMLButtonElement;
	defaultPathInput: HTMLInputElement;
}

function getBatchPanelElements(): BatchPanelElements | null {
	const clipTab = document.getElementById('clip-tab') as HTMLButtonElement | null;
	const batchTab = document.getElementById('batch-tab') as HTMLButtonElement | null;
	const clipPanel = document.getElementById('clip-panel') as HTMLElement | null;
	const batchPanel = document.getElementById('batch-panel') as HTMLElement | null;
	const extractButton = document.getElementById('batch-extract-links') as HTMLButtonElement | null;
	const importInput = document.getElementById('batch-import-csv') as HTMLInputElement | null;
	const downloadSampleButton = document.getElementById('batch-download-sample') as HTMLButtonElement | null;
	const runButton = document.getElementById('batch-run') as HTMLButtonElement | null;
	const retryButton = document.getElementById('batch-retry-failed') as HTMLButtonElement | null;
	const addButton = document.getElementById('batch-add-link') as HTMLButtonElement | null;
	const defaultPathInput = document.getElementById('batch-default-path') as HTMLInputElement | null;

	if (
		!clipTab ||
		!batchTab ||
		!clipPanel ||
		!batchPanel ||
		!extractButton ||
		!importInput ||
		!downloadSampleButton ||
		!runButton ||
		!retryButton ||
		!addButton ||
		!defaultPathInput
	) {
		return null;
	}

	return {
		clipTab,
		batchTab,
		clipPanel,
		batchPanel,
		extractButton,
		importInput,
		downloadSampleButton,
		runButton,
		retryButton,
		addButton,
		defaultPathInput,
	};
}

function activatePanel(panel: 'clip' | 'batch', elements: BatchPanelElements): void {
	const showBatch = panel === 'batch';
	setTabState(elements.clipTab, elements.clipPanel, !showBatch);
	setTabState(elements.batchTab, elements.batchPanel, showBatch);
}

function setTabState(tab: HTMLButtonElement, panel: HTMLElement, isActive: boolean): void {
	tab.classList.toggle('is-active', isActive);
	tab.setAttribute('aria-selected', String(isActive));
	tab.tabIndex = isActive ? 0 : -1;
	panel.classList.toggle('is-active', isActive);
	panel.hidden = !isActive;
}

async function extractLinks(options: InitializeBatchPanelOptions): Promise<void> {
	if (options.canExtractLinks && !options.canExtractLinks()) {
		showBatchError('pageCannotBeClipped');
		return;
	}

	const tabId = options.getCurrentTabId();
	if (!tabId) {
		showBatchError('No active tab found.');
		return;
	}

	try {
		const response = await browser.runtime.sendMessage({
			action: 'sendMessageToTab',
			tabId,
			message: { action: 'getVisibleLinks' },
		}) as ExtractLinksResponse;

		if (!response?.success || !response.links) {
			showBatchError(response?.error || 'Failed to extract links.');
			return;
		}

		queue = createBatchQueue(response.links);
		renderQueue();
	} catch (error) {
		showBatchError(error instanceof Error ? error.message : 'Failed to extract links.');
	}
}

async function importCsv(importInput: HTMLInputElement, options: InitializeBatchPanelOptions): Promise<void> {
	const file = importInput.files?.[0];
	if (!file) return;

	try {
		const result = importBatchCsv(await file.text());
		queue = createBatchQueue(result.links);
		renderQueue();
		setBatchSummary(`${result.links.length} links imported from ${result.importedRows} rows. ${result.mergedRows} merged, ${result.skippedRows} skipped.`);
	} catch (error) {
		showBatchError(error instanceof Error ? error.message : 'Failed to import CSV.');
	} finally {
		importInput.value = '';
	}
}

function downloadSampleCsv(): void {
	const sample = createBatchCsvSample();
	const blob = new Blob([sample.content], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = sample.filename;
	link.click();
	URL.revokeObjectURL(url);
}

function addManualLink(): void {
	const textInput = document.getElementById('batch-new-text') as HTMLInputElement | null;
	const urlInput = document.getElementById('batch-new-url') as HTMLInputElement | null;
	const pathInput = document.getElementById('batch-new-path') as HTMLInputElement | null;
	if (!textInput || !urlInput) return;

	const normalizedUrl = normalizeLinkUrl(urlInput.value, window.location.href);
	if (!normalizedUrl) return;

	const path = pathInput?.value.trim() || '';
	manualLinkId += 1;
	queue = [
		...queue,
		{
			id: `manual-${Date.now()}-${manualLinkId}`,
			text: textInput.value.trim() || normalizedUrl,
			url: normalizedUrl,
			paths: path ? [path] : [],
			status: 'idle',
		},
	];

	textInput.value = '';
	urlInput.value = '';
	if (pathInput) pathInput.value = '';
	renderQueue();
}

function renderQueue(): void {
	const container = document.getElementById('batch-queue');
	const summary = document.getElementById('batch-summary');
	const runButton = document.getElementById('batch-run') as HTMLButtonElement | null;
	const retryButton = document.getElementById('batch-retry-failed') as HTMLButtonElement | null;
	const extractButton = document.getElementById('batch-extract-links') as HTMLButtonElement | null;
	const importInput = document.getElementById('batch-import-csv') as HTMLInputElement | null;
	const downloadSampleButton = document.getElementById('batch-download-sample') as HTMLButtonElement | null;
	const addButton = document.getElementById('batch-add-link') as HTMLButtonElement | null;
	if (!container || !summary) return;

	container.textContent = '';
	const counts = getBatchSummary(queue);
	summary.textContent = counts.total === 0
		? 'No links extracted.'
		: `${counts.total} links: ${counts.success} saved, ${counts.failed} failed, ${counts.pending} pending.`;

	if (runButton) runButton.disabled = isRunning || !queue.some(item => item.status !== 'success');
	if (retryButton) retryButton.disabled = isRunning || !queue.some(item => item.status === 'failed');
	if (extractButton) extractButton.disabled = isRunning;
	if (importInput) importInput.disabled = isRunning;
	if (downloadSampleButton) downloadSampleButton.disabled = isRunning;
	if (addButton) addButton.disabled = isRunning;

	for (const item of queue) {
		container.appendChild(createQueueRow(item));
	}
}

function setBatchSummary(message: string): void {
	const summary = document.getElementById('batch-summary');
	if (summary) summary.textContent = message;
}

function showBatchError(message: string): void {
	setBatchSummary(message);
}

function createQueueRow(item: BatchQueueItem): HTMLElement {
	const row = document.createElement('div');
	row.className = 'batch-queue-item';
	row.dataset.id = item.id;

	const header = document.createElement('div');
	header.className = 'batch-queue-item-header';

	const removeButton = createIconButton('batch-remove-link batch-link-remove-button', 'Remove link', 'trash-2');
	removeButton.addEventListener('click', () => {
		queue = queue.filter(link => link.id !== item.id);
		renderQueue();
	});
	header.appendChild(removeButton);

	const fields = document.createElement('div');
	fields.className = 'batch-queue-item-fields';

	const textInput = document.createElement('input');
	textInput.className = 'batch-link-text';
	textInput.type = 'text';
	textInput.value = item.text;
	textInput.disabled = isRunning;
	textInput.addEventListener('input', () => {
		queue = updateBatchQueueItem(queue, item.id, { text: textInput.value });
	});

	const urlInput = document.createElement('input');
	urlInput.className = 'batch-link-url';
	urlInput.type = 'url';
	urlInput.value = item.url;
	urlInput.disabled = isRunning;
	urlInput.addEventListener('input', () => {
		queue = updateBatchQueueItem(queue, item.id, { url: urlInput.value });
	});

	fields.append(textInput, urlInput);
	fields.appendChild(createPathList(item));

	row.append(header, fields);

	if (item.error) {
		const status = document.createElement('span');
		status.className = 'batch-status batch-status-failed';
		status.textContent = item.error;
		row.appendChild(status);
	}

	initializeIcons(row);
	return row;
}

function createPathList(item: BatchQueueItem): HTMLElement {
	const pathList = document.createElement('div');
	pathList.className = 'batch-path-list';

	const paths = item.paths.length > 0 ? item.paths : [''];
	for (const path of paths) {
		appendPathRow(pathList, item.id, path);
	}

	return pathList;
}

function appendPathRow(pathList: HTMLElement, itemId: string, path: string, afterRow?: HTMLElement): HTMLElement {
	const row = document.createElement('div');
	row.className = 'batch-path-row';

	const input = document.createElement('input');
	input.className = 'batch-path-input';
	input.type = 'text';
	input.placeholder = 'Obsidian path';
	input.value = path;
	input.disabled = isRunning;
	input.addEventListener('input', () => {
		updateItemPathsFromPathList(itemId, pathList);
	});

	const actions = document.createElement('div');
	actions.className = 'batch-path-actions';

	const addButton = createIconButton('batch-add-path batch-path-icon-button', 'Add path', 'plus');
	addButton.addEventListener('click', () => {
		const newRow = appendPathRow(pathList, itemId, '', row);
		const newInput = newRow.querySelector<HTMLInputElement>('.batch-path-input');
		newInput?.focus();
		updateItemPathsFromPathList(itemId, pathList);
	});

	const removeButton = createIconButton('batch-remove-path batch-path-icon-button', 'Remove path', 'trash-2');
	removeButton.addEventListener('click', () => {
		row.remove();
		if (!pathList.querySelector('.batch-path-input')) {
			appendPathRow(pathList, itemId, '');
		}
		updateItemPathsFromPathList(itemId, pathList);
	});

	actions.append(addButton, removeButton);
	row.append(input, actions);

	if (afterRow?.parentElement === pathList) {
		afterRow.after(row);
	} else {
		pathList.appendChild(row);
	}
	initializeIcons(row);
	return row;
}

function createIconButton(className: string, label: string, iconName: string): HTMLButtonElement {
	const button = document.createElement('button');
	button.className = `${className} clickable-icon`;
	button.type = 'button';
	button.setAttribute('aria-label', label);
	button.title = label;
	button.disabled = isRunning;

	const icon = document.createElement('i');
	icon.setAttribute('data-lucide', iconName);
	icon.setAttribute('aria-hidden', 'true');
	button.appendChild(icon);

	return button;
}

function updateItemPathsFromPathList(itemId: string, pathList: HTMLElement): void {
	const paths = Array.from(pathList.querySelectorAll<HTMLInputElement>('.batch-path-input'))
		.map(input => input.value.trim())
		.filter(Boolean);
	queue = updateBatchQueueItem(queue, itemId, { paths });
}

async function runBatch(options: InitializeBatchPanelOptions, items: BatchQueueItem[]): Promise<void> {
	if (isRunning || items.length === 0) return;

	const template = options.getCurrentTemplate();
	if (!template) {
		showBatchError('No template selected.');
		return;
	}

	const templateCheck = canRunBatchTemplate(template, generalSettings.interpreterEnabled);
	if (!templateCheck.ok) {
		showBatchError(templateCheck.error);
		return;
	}

	isRunning = true;
	renderQueue();

	try {
		const concurrencyInput = document.getElementById('batch-concurrency') as HTMLInputElement | null;
		const concurrency = normalizeBatchConcurrency(Number(concurrencyInput?.value || 1));
		const selectedVault = options.getSelectedVault();
		const defaultPath = getBatchDefaultPath();

		await runWithConcurrency(items, concurrency, async (item) => {
			await processQueueItem(options, template, selectedVault, defaultPath, item);
		});
	} catch (error) {
		showBatchError(error instanceof Error ? error.message : 'Batch failed.');
	} finally {
		isRunning = false;
		renderQueue();
	}
}

async function processQueueItem(
	options: InitializeBatchPanelOptions,
	template: Template,
	selectedVault: string,
	defaultPath: string,
	item: BatchQueueItem
): Promise<void> {
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
			tabId: tempTabId,
			url: opened.url || item.url,
			template,
			extractedData: opened.content,
			selectedVault,
		});

		await closeTemporaryTab(tempTabId);
		tempTabId = undefined;

		queue = updateBatchQueueItem(queue, item.id, { status: 'saving' });
		renderQueue();

		const savePaths = resolveBatchSavePaths(item, defaultPath, rendered.path);
		await enqueueSave(async () => saveRenderedBatchNoteToPaths(rendered, savePaths));

		queue = updateBatchQueueItem(queue, item.id, { status: 'success', error: undefined });
		renderQueue();

		try {
			await incrementStat('addToObsidian', rendered.vault, savePaths[0] ?? rendered.path, item.url, rendered.title || item.text);
			options.setLastSelectedVault(rendered.vault);
			await setLocalStorage('lastSelectedVault', rendered.vault);
		} catch (error) {
			console.warn('Batch clip saved, but post-save bookkeeping failed:', error);
		}
	} catch (error) {
		if (tempTabId !== undefined) {
			await closeTemporaryTab(tempTabId).catch(() => undefined);
		}

		queue = updateBatchQueueItem(queue, item.id, {
			status: 'failed',
			error: error instanceof Error ? error.message : String(error),
		});
		renderQueue();
	}
}

function getBatchDefaultPath(): string {
	const defaultPathInput = document.getElementById('batch-default-path') as HTMLInputElement | null;
	return defaultPathInput?.value.trim() || '';
}

async function closeTemporaryTab(tabId: number): Promise<void> {
	await browser.runtime.sendMessage({ action: 'closeBatchClipTab', tabId });
}

function enqueueSave(task: () => Promise<void>): Promise<void> {
	saveChain = saveChain.then(task, task);
	return saveChain;
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
