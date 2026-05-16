export interface ExtractedBatchLink {
	id: string;
	text: string;
	url: string;
}

const UNSUPPORTED_PROTOCOLS = new Set([
	'about:',
	'chrome:',
	'chrome-extension:',
	'edge:',
	'file:',
	'javascript:',
	'mailto:',
	'tel:',
]);

export function normalizeLinkUrl(rawUrl: string | null, baseUrl: string): string | null {
	if (!rawUrl) return null;
	const trimmed = rawUrl.trim();
	if (!trimmed || trimmed.startsWith('#')) return null;

	try {
		const url = new URL(trimmed, baseUrl);
		if (UNSUPPORTED_PROTOCOLS.has(url.protocol)) return null;
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.href;
	} catch {
		return null;
	}
}

function hasHiddenStyle(element: Element): boolean {
	const style = element.getAttribute('style')?.toLowerCase() ?? '';
	return style.includes('display:none') ||
		style.includes('display: none') ||
		style.includes('visibility:hidden') ||
		style.includes('visibility: hidden');
}

function isElementVisible(element: Element): boolean {
	let current: Element | null = element;
	while (current) {
		if (current.hasAttribute('hidden')) return false;
		if (current.getAttribute('aria-hidden') === 'true') return false;
		if (hasHiddenStyle(current)) return false;

		const view = current.ownerDocument.defaultView;
		if (view?.getComputedStyle) {
			const computed = view.getComputedStyle(current);
			if (computed.display === 'none' || computed.visibility === 'hidden') return false;
		}

		current = current.parentElement;
	}
	return true;
}

function getLinkText(anchor: HTMLAnchorElement, url: string): string {
	const text = anchor.textContent?.replace(/\s+/g, ' ').trim();
	return text ||
		anchor.getAttribute('aria-label')?.trim() ||
		anchor.getAttribute('title')?.trim() ||
		url;
}

export function extractVisibleLinks(doc: Document, baseUrl: string = doc.URL): ExtractedBatchLink[] {
	const seenUrls = new Set<string>();
	const links: ExtractedBatchLink[] = [];

	for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
		if (!isElementVisible(anchor)) continue;

		const url = normalizeLinkUrl(anchor.getAttribute('href'), baseUrl);
		if (!url || seenUrls.has(url)) continue;

		seenUrls.add(url);
		links.push({
			id: `batch-link-${links.length + 1}`,
			text: getLinkText(anchor, url),
			url,
		});
	}

	return links;
}
