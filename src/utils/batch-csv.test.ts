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
