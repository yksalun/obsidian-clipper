import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Template } from '../types/types';

const mocks = vi.hoisted(() => ({
	initializePageContent: vi.fn(),
	compileTemplate: vi.fn(),
}));

vi.mock('./content-extractor', () => ({
	initializePageContent: mocks.initializePageContent,
}));

vi.mock('./template-compiler', () => ({
	compileTemplate: mocks.compileTemplate,
}));

vi.mock('./storage-utils', () => ({
	generalSettings: {
		interpreterEnabled: false,
		propertyTypes: [],
	},
}));

import { canRunBatchTemplate, renderBatchNote } from './batch-renderer';

const template: Template = {
	id: 'default',
	name: 'Default',
	behavior: 'create',
	noteNameFormat: '{{title}}',
	path: 'Clips/{{site}}',
	noteContentFormat: '# {{title}}\n{{content}}',
	properties: [{ id: 'published', name: 'published', value: '{{published}}', type: 'date' }],
};

const extractedData = {
	content: '<article>Hello</article>',
	selectedHtml: '',
	extractedContent: {},
	schemaOrgData: {},
	fullHtml: '<html><body>Hello</body></html>',
	highlights: [],
	title: 'Example title',
	author: '',
	description: '',
	favicon: '',
	image: '',
	published: '2026-05-16',
	site: 'Example',
	wordCount: 10,
	language: 'en',
	metaTags: [],
};

describe('canRunBatchTemplate', () => {
	test('blocks prompt templates when interpreter is enabled', () => {
		const promptTemplate = {
			...template,
			noteContentFormat: '{{"summarize this page"}}',
		};

		expect(canRunBatchTemplate(promptTemplate, true)).toEqual({
			ok: false,
			error: 'Batch clipping does not support interpreter prompt variables yet.',
		});
	});

	test('allows normal templates when interpreter is enabled', () => {
		expect(canRunBatchTemplate(template, true)).toEqual({ ok: true });
	});
});

describe('renderBatchNote', () => {
	beforeEach(() => {
		mocks.initializePageContent.mockReset();
		mocks.compileTemplate.mockReset();

		mocks.initializePageContent.mockResolvedValue({
			currentVariables: {
				title: 'Example title',
				content: 'Hello',
				site: 'Example',
				published: '2026-05-16',
				wordCount: 10,
			},
		});
		mocks.compileTemplate.mockImplementation(async (_tabId, text: string) => {
			return text
				.replace('{{title}}', 'Example title')
				.replace('{{content}}', 'Hello')
				.replace('{{site}}', 'Example')
				.replace('{{published}}', '2026-05-16')
				.replace('{{wordCount}}', '10');
		});
	});

	test('renders note fields for one extracted page', async () => {
		const rendered = await renderBatchNote({
			tabId: 12,
			url: 'https://example.com/post',
			template,
			extractedData,
			selectedVault: 'Main vault',
		});

		expect(rendered).toEqual({
			fileContent: '---\npublished: 2026-05-16\n---\n# Example title\nHello',
			noteName: 'Example title',
			path: 'Clips/Example',
			vault: 'Main vault',
			behavior: 'create',
			title: 'Example title',
		});
		expect(mocks.initializePageContent).toHaveBeenCalledWith(
			extractedData.content,
			extractedData.selectedHtml,
			extractedData.extractedContent,
			'https://example.com/post',
			extractedData.schemaOrgData,
			extractedData.fullHtml,
			extractedData.highlights,
			extractedData.title,
			extractedData.author,
			extractedData.description,
			extractedData.favicon,
			extractedData.image,
			extractedData.published,
			extractedData.site,
			extractedData.wordCount,
			extractedData.language,
			extractedData.metaTags
		);
	});

	test('does not compile note name or path for daily notes with missing fields', async () => {
		const dailyTemplate = {
			...template,
			behavior: 'append-daily',
			noteNameFormat: undefined,
			path: undefined,
		} as unknown as Template;

		const rendered = await renderBatchNote({
			tabId: 12,
			url: 'https://example.com/post',
			template: dailyTemplate,
			extractedData,
			selectedVault: 'Main vault',
		});

		expect(rendered.noteName).toBe('');
		expect(rendered.path).toBe('');
		expect(mocks.compileTemplate).not.toHaveBeenCalledWith(12, undefined, expect.anything(), 'https://example.com/post');
	});

	test('uses template property types when generating frontmatter', async () => {
		const numericTemplate: Template = {
			...template,
			properties: [{ id: 'wordCount', name: 'wordCount', value: '{{wordCount}}', type: 'number' }],
		};

		const rendered = await renderBatchNote({
			tabId: 12,
			url: 'https://example.com/post',
			template: numericTemplate,
			extractedData,
			selectedVault: 'Main vault',
		});

		expect(rendered.fileContent).toBe('---\nwordCount: 10\n---\n# Example title\nHello');
	});
});
