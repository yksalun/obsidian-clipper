import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

describe('side-panel error layout', () => {
	test('keeps clip availability errors inside the Clip panel so Batch remains usable', () => {
		const html = readFileSync(new URL('./side-panel.html', import.meta.url), 'utf8');
		const { document } = parseHTML(html);

		const clipPanel = document.getElementById('clip-panel');
		const batchPanel = document.getElementById('batch-panel');
		const errorMessage = document.querySelector('.error-message');

		expect(clipPanel).toBeTruthy();
		expect(batchPanel).toBeTruthy();
		expect(errorMessage).toBeTruthy();
		expect(clipPanel?.contains(errorMessage)).toBe(true);
		expect(batchPanel?.contains(errorMessage)).toBe(false);
	});
});
