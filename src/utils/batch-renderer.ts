import { Template, Property } from '../types/types';
import { initializePageContent } from './content-extractor';
import { compileTemplate } from './template-compiler';
import { formatPropertyValue, generateFrontmatter } from './shared';
import { unescapeValue } from './string-utils';
import { generalSettings } from './storage-utils';

export interface BatchExtractedPageContent {
	content: string;
	selectedHtml: string;
	extractedContent: { [key: string]: string };
	schemaOrgData: any;
	fullHtml: string;
	highlights: any[];
	title: string;
	author: string;
	description: string;
	favicon: string;
	image: string;
	published: string;
	site: string;
	wordCount: number;
	language: string;
	metaTags: { name?: string | null; property?: string | null; content: string | null }[];
}

export interface RenderBatchNoteOptions {
	tabId: number;
	url: string;
	template: Template;
	extractedData: BatchExtractedPageContent;
	selectedVault: string;
}

export interface RenderedBatchNote {
	fileContent: string;
	noteName: string;
	path: string;
	vault: string;
	behavior: Template['behavior'];
	title?: string;
}

export function canRunBatchTemplate(template: Template, _interpreterEnabled: boolean): { ok: true } | { ok: false; error: string } {
	const fields = [
		template.noteNameFormat,
		template.path,
		template.noteContentFormat,
		template.context ?? '',
		...template.properties.map(property => property.value),
	];
	const hasPromptVariable = fields.some(field => /{{\s*(?:prompt:)?"/.test(field ?? ''));
	if (!hasPromptVariable) return { ok: true };
	return {
		ok: false,
		error: 'Batch clipping does not support interpreter prompt variables yet.',
	};
}

export async function renderBatchNote(options: RenderBatchNoteOptions): Promise<RenderedBatchNote> {
	const { tabId, url, template, extractedData, selectedVault } = options;
	const initializedContent = await initializePageContent(
		extractedData.content,
		extractedData.selectedHtml,
		extractedData.extractedContent,
		url,
		extractedData.schemaOrgData,
		extractedData.fullHtml,
		extractedData.highlights || [],
		extractedData.title,
		extractedData.author,
		extractedData.description,
		extractedData.favicon,
		extractedData.image,
		extractedData.published,
		extractedData.site,
		extractedData.wordCount,
		extractedData.language || '',
		extractedData.metaTags
	);

	if (!initializedContent) {
		throw new Error('Unable to initialize page content.');
	}

	const variables = initializedContent.currentVariables;
	const compile = (text: string) => compileTemplate(tabId, text, variables, url);
	const isDailyNote = template.behavior === 'append-daily' || template.behavior === 'prepend-daily';

	const [noteName, path, noteContent, compiledProperties] = await Promise.all([
		isDailyNote ? Promise.resolve('') : compile(template.noteNameFormat ?? ''),
		isDailyNote ? Promise.resolve('') : compile(template.path ?? ''),
		template.noteContentFormat ? compile(template.noteContentFormat) : Promise.resolve(''),
		Promise.all(template.properties.map(async (property): Promise<Property> => {
			const compiledValue = await compile(unescapeValue(property.value));
			const propertyType = property.type || generalSettings.propertyTypes.find(type => type.name === property.name)?.type || 'text';
			return {
				id: property.id,
				name: property.name,
				value: formatPropertyValue(compiledValue, propertyType, property.value),
				type: propertyType,
			};
		})),
	]);

	const propertyTypeMap = compiledProperties.reduce<Record<string, string>>((types, property) => {
		types[property.name] = property.type || 'text';
		return types;
	}, {});
	const frontmatter = generateFrontmatter(compiledProperties, propertyTypeMap);

	return {
		fileContent: frontmatter + noteContent,
		noteName: isDailyNote ? '' : noteName.trim(),
		path: isDailyNote ? '' : path,
		vault: selectedVault || template.vault || '',
		behavior: template.behavior,
		title: extractedData.title,
	};
}
