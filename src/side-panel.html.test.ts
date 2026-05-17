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

	test('keeps batch actions above the summary in a sticky header', () => {
		const html = readFileSync(new URL('./side-panel.html', import.meta.url), 'utf8');
		const styles = readFileSync(new URL('./styles/side-panel.scss', import.meta.url), 'utf8');
		const { document } = parseHTML(html);

		const stickyHeader = document.querySelector('.batch-sticky-header');
		const controls = document.querySelector('.batch-controls');
		const runRow = document.querySelector('.batch-run-row');
		const summary = document.getElementById('batch-summary');
		const queue = document.getElementById('batch-queue');

		expect(stickyHeader?.contains(controls)).toBe(true);
		expect(stickyHeader?.contains(runRow)).toBe(true);
		expect(stickyHeader?.contains(summary)).toBe(true);
		expect(stickyHeader?.contains(queue)).toBe(false);
		expect(Array.from(stickyHeader!.children)).toEqual([controls, runRow, summary]);
		expect(styles).toMatch(/\.batch-sticky-header\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;/);
	});
});
