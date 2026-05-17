import { describe, expect, test } from 'vitest';
import {
	BatchQueueItem,
	createBatchQueue,
	getBatchSummary,
	normalizeBatchConcurrency,
	resolveBatchSavePaths,
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
			{ id: 'batch-link-1', text: 'A', url: 'https://example.com/a', paths: [], status: 'idle' },
			{ id: 'batch-link-2', text: 'B', url: 'https://example.com/b', paths: [], status: 'idle' },
		]);
	});

	test('preserves imported paths when present', () => {
		const queue = createBatchQueue([
			{ id: 'csv-link-1', text: 'A', url: 'https://example.com/a', paths: ['One', 'Two'] },
		]);

		expect(queue[0].paths).toEqual(['One', 'Two']);
	});
});

describe('updateBatchQueueItem', () => {
	test('updates one item without mutating the original queue', () => {
		const original: BatchQueueItem[] = [
			{ id: 'one', text: 'One', url: 'https://example.com/one', paths: [], status: 'idle' },
			{ id: 'two', text: 'Two', url: 'https://example.com/two', paths: [], status: 'idle' },
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
			paths: [],
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
			{ id: '1', text: 'A', url: 'https://a.test', paths: [], status: 'success' },
			{ id: '2', text: 'B', url: 'https://b.test', paths: [], status: 'failed' },
			{ id: '3', text: 'C', url: 'https://c.test', paths: [], status: 'queued' },
		])).toEqual({
			total: 3,
			success: 1,
			failed: 1,
			pending: 1,
		});
	});
});

describe('resolveBatchSavePaths', () => {
	test('uses item paths before the default and rendered paths', () => {
		expect(resolveBatchSavePaths(
			{ paths: ['One', 'Two'] },
			'Default',
			'Rendered'
		)).toEqual(['One', 'Two']);
	});

	test('uses default path when item paths are empty', () => {
		expect(resolveBatchSavePaths(
			{ paths: [] },
			'Default',
			'Rendered'
		)).toEqual(['Default']);
	});

	test('falls back to rendered template path when item and default paths are empty', () => {
		expect(resolveBatchSavePaths(
			{ paths: [] },
			'',
			'Rendered'
		)).toEqual(['Rendered']);
	});

	test('trims, removes empty paths, and de-duplicates paths', () => {
		expect(resolveBatchSavePaths(
			{ paths: [' One ', '', 'One', 'Two'] },
			'Default',
			'Rendered'
		)).toEqual(['One', 'Two']);
	});

	test('returns root path when item, default, and rendered paths are empty', () => {
		expect(resolveBatchSavePaths(
			{ paths: [] },
			'',
			''
		)).toEqual(['']);
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

	test('waits for active worker chains to settle before rejecting', async () => {
		const error = new Error('Extraction failed.');
		const started: number[] = [];
		let slowSettled = false;

		await expect(runWithConcurrency([1, 2, 3], 2, async (item) => {
			started.push(item);

			if (item === 1) {
				await new Promise(resolve => setTimeout(resolve, 5));
				slowSettled = true;
				return item;
			}

			if (item === 2) {
				throw error;
			}

			return item;
		})).rejects.toBe(error);

		expect(slowSettled).toBe(true);
		expect(started).toEqual([1, 2]);
	});
});
