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
