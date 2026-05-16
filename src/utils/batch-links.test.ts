import { describe, expect, test } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractVisibleLinks, normalizeLinkUrl } from './batch-links';

function doc(html: string): Document {
	const { document } = parseHTML(html);
	return document as unknown as Document;
}

describe('normalizeLinkUrl', () => {
	test('resolves relative URLs against the base URL', () => {
		expect(normalizeLinkUrl('/docs/page', 'https://example.com/start')).toBe('https://example.com/docs/page');
	});

	test('removes hash-only fragments from otherwise duplicate URLs', () => {
		expect(normalizeLinkUrl('https://example.com/page#section', 'https://example.com')).toBe('https://example.com/page#section');
	});

	test('rejects unsupported schemes', () => {
		expect(normalizeLinkUrl('mailto:hello@example.com', 'https://example.com')).toBe(null);
		expect(normalizeLinkUrl('javascript:void(0)', 'https://example.com')).toBe(null);
		expect(normalizeLinkUrl('#local', 'https://example.com/page')).toBe(null);
		expect(normalizeLinkUrl('chrome://extensions', 'https://example.com')).toBe(null);
	});
});

describe('extractVisibleLinks', () => {
	test('extracts visible normal links in document order', () => {
		const links = extractVisibleLinks(doc(`
			<a href="/a">First link</a>
			<a href="https://other.test/path" title="Other title"></a>
			<a href="/b" aria-label="ARIA label"><span></span></a>
		`), 'https://example.com/root');

		expect(links).toEqual([
			{ id: 'batch-link-1', text: 'First link', url: 'https://example.com/a' },
			{ id: 'batch-link-2', text: 'Other title', url: 'https://other.test/path' },
			{ id: 'batch-link-3', text: 'ARIA label', url: 'https://example.com/b' },
		]);
	});

	test('filters hidden and unsupported links', () => {
		const links = extractVisibleLinks(doc(`
			<a href="/visible">Visible</a>
			<a href="/hidden" hidden>Hidden</a>
			<div style="display:none"><a href="/inside-hidden">Inside hidden</a></div>
			<a href="tel:123">Phone</a>
			<a href="mailto:test@example.com">Mail</a>
			<a href="javascript:void(0)">JS</a>
			<a href="#section">Hash</a>
		`), 'https://example.com/root');

		expect(links).toEqual([
			{ id: 'batch-link-1', text: 'Visible', url: 'https://example.com/visible' },
		]);
	});

	test('de-duplicates by normalized URL and keeps the first label', () => {
		const links = extractVisibleLinks(doc(`
			<a href="/same">First</a>
			<a href="https://example.com/same">Second</a>
		`), 'https://example.com/root');

		expect(links).toEqual([
			{ id: 'batch-link-1', text: 'First', url: 'https://example.com/same' },
		]);
	});
});
