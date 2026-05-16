import browser from '../utils/browser-polyfill';
import { Template } from '../types/types';
import {
	BatchQueueItem,
	createBatchQueue,
	getBatchSummary,
	normalizeBatchConcurrency,
	runWithConcurrency,
	updateBatchQueueItem,
} from '../utils/batch-queue';
import { ExtractedBatchLink, normalizeLinkUrl } from '../utils/batch-links';
import { canRunBatchTemplate, renderBatchNote, BatchExtractedPageContent } from '../utils/batch-renderer';
import { saveToObsidian } from '../utils/obsidian-note-creator';
import { generalSettings, incrementStat, setLocalStorage } from '../utils/storage-utils';

interface InitializeBatchPanelOptions {
	getCurrentTabId: () => number | undefined;
	getCurrentTemplate: () => Template | null;
	getSelectedVault: () => string;
	setLastSelectedVault: (vault: string) => void;
	showError: (message: string) => void;
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

export function initializeBatchPanel(options: InitializeBatchPanelOptions): void {
	const elements = getBatchPanelElements();
	if (!elements) return;

	const { clipTab, batchTab, extractButton, runButton, retryButton, addButton } = elements;

	clipTab.addEventListener('click', () => activatePanel('clip', elements));
	batchTab.addEventListener('click', () => activatePanel('batch', elements));
	extractButton.addEventListener('click', () => extractLinks(options));
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
	runButton: HTMLButtonElement;
	retryButton: HTMLButtonElement;
	addButton: HTMLButtonElement;
}

function getBatchPanelElements(): BatchPanelElements | null {
	const clipTab = document.getElementById('clip-tab') as HTMLButtonElement | null;
	const batchTab = document.getElementById('batch-tab') as HTMLButtonElement | null;
	const clipPanel = document.getElementById('clip-panel') as HTMLElement | null;
	const batchPanel = document.getElementById('batch-panel') as HTMLElement | null;
	const extractButton = document.getElementById('batch-extract-links') as HTMLButtonElement | null;
	const runButton = document.getElementById('batch-run') as HTMLButtonElement | null;
	const retryButton = document.getElementById('batch-retry-failed') as HTMLButtonElement | null;
	const addButton = document.getElementById('batch-add-link') as HTMLButtonElement | null;

	if (!clipTab || !batchTab || !clipPanel || !batchPanel || !extractButton || !runButton || !retryButton || !addButton) {
		return null;
	}

	return {
		clipTab,
		batchTab,
		clipPanel,
		batchPanel,
		extractButton,
		runButton,
		retryButton,
		addButton,
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
	const tabId = options.getCurrentTabId();
	if (!tabId) {
		options.showError('No active tab found.');
		return;
	}

	try {
		const response = await browser.runtime.sendMessage({
			action: 'sendMessageToTab',
			tabId,
			message: { action: 'getVisibleLinks' },
		}) as ExtractLinksResponse;

		if (!response?.success || !response.links) {
			options.showError(response?.error || 'Failed to extract links.');
			return;
		}

		queue = createBatchQueue(response.links);
		renderQueue();
	} catch (error) {
		options.showError(error instanceof Error ? error.message : 'Failed to extract links.');
	}
}

function addManualLink(): void {
	const textInput = document.getElementById('batch-new-text') as HTMLInputElement | null;
	const urlInput = document.getElementById('batch-new-url') as HTMLInputElement | null;
	if (!textInput || !urlInput) return;

	const normalizedUrl = normalizeLinkUrl(urlInput.value, window.location.href);
	if (!normalizedUrl) return;

	manualLinkId += 1;
	queue = [
		...queue,
		{
			id: `manual-${Date.now()}-${manualLinkId}`,
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
	const runButton = document.getElementById('batch-run') as HTMLButtonElement | null;
	const retryButton = document.getElementById('batch-retry-failed') as HTMLButtonElement | null;
	const extractButton = document.getElementById('batch-extract-links') as HTMLButtonElement | null;
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
	if (addButton) addButton.disabled = isRunning;

	for (const item of queue) {
		container.appendChild(createQueueRow(item));
	}
}

function createQueueRow(item: BatchQueueItem): HTMLElement {
	const row = document.createElement('div');
	row.className = 'batch-queue-item';
	row.dataset.id = item.id;

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

	const actions = document.createElement('div');
	actions.className = 'batch-queue-item-actions';

	const status = document.createElement('span');
	status.className = `batch-status batch-status-${item.status}`;
	status.textContent = item.error || item.status;

	const removeButton = document.createElement('button');
	removeButton.className = 'batch-remove-link';
	removeButton.type = 'button';
	removeButton.textContent = 'Remove';
	removeButton.disabled = isRunning;
	removeButton.addEventListener('click', () => {
		queue = queue.filter(link => link.id !== item.id);
		renderQueue();
	});

	actions.append(status, removeButton);
	row.append(fields, actions);
	return row;
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

	try {
		const concurrencyInput = document.getElementById('batch-concurrency') as HTMLInputElement | null;
		const concurrency = normalizeBatchConcurrency(Number(concurrencyInput?.value || 1));
		const selectedVault = options.getSelectedVault();

		await runWithConcurrency(items, concurrency, async (item) => {
			await processQueueItem(options, template, selectedVault, item);
		});
	} catch (error) {
		options.showError(error instanceof Error ? error.message : 'Batch failed.');
	} finally {
		isRunning = false;
		renderQueue();
	}
}

async function processQueueItem(
	options: InitializeBatchPanelOptions,
	template: Template,
	selectedVault: string,
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

		await enqueueSave(async () => {
			await saveToObsidian(rendered.fileContent, rendered.noteName, rendered.path, rendered.vault, rendered.behavior);
			await delay(SAVE_SETTLE_DELAY_MS);
		});

		queue = updateBatchQueueItem(queue, item.id, { status: 'success', error: undefined });
		renderQueue();

		try {
			await incrementStat('addToObsidian', rendered.vault, rendered.path, item.url, rendered.title || item.text);
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
