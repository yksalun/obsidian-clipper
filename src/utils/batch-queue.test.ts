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
