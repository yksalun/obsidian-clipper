export interface BatchCsvImportLink {
	id: string;
	text: string;
	url: string;
	paths: string[];
}

export interface BatchCsvImportError {
	row: number;
	message: string;
}

export interface BatchCsvImportResult {
	links: BatchCsvImportLink[];
	importedRows: number;
	mergedRows: number;
	skippedRows: number;
	errors: BatchCsvImportError[];
}

export interface BatchCsvSample {
	filename: string;
	content: string;
}

interface ParsedCsvRow {
	fields: string[];
	row: number;
}

interface MutableBatchCsvImportLink extends BatchCsvImportLink {
	hasText: boolean;
	seenPaths: Set<string>;
}

function parseCsv(csvText: string): ParsedCsvRow[] {
	const rows: ParsedCsvRow[] = [];
	let fields: string[] = [];
	let field = '';
	let inQuotes = false;
	let fieldStart = true;
	let row = 1;
	let currentRow = 1;

	function finishField() {
		fields.push(field);
		field = '';
		fieldStart = true;
	}

	function finishRow() {
		finishField();
		rows.push({ fields, row: currentRow });
		fields = [];
		currentRow = row + 1;
	}

	for (let index = 0; index < csvText.length; index += 1) {
		const character = csvText[index];

		if (inQuotes) {
			if (character === '"') {
				if (csvText[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					inQuotes = false;
				}
			} else {
				field += character;
				if (character === '\n') row += 1;
			}
			continue;
		}

		if (fieldStart && character === '"') {
			inQuotes = true;
			fieldStart = false;
			continue;
		}

		if (character === ',') {
			finishField();
			continue;
		}

		if (character === '\r' || character === '\n') {
			finishRow();
			if (character === '\r' && csvText[index + 1] === '\n') index += 1;
			row += 1;
			continue;
		}

		field += character;
		fieldStart = false;
	}

	if (field || fields.length > 0 || csvText.length > 0) {
		finishRow();
	}

	return rows;
}

function isEmptyRow(row: string[]): boolean {
	return row.every(field => field.trim() === '');
}

function normalizeUrl(rawUrl: string): string | null {
	try {
		const url = new URL(rawUrl.trim());
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.href;
	} catch {
		return null;
	}
}

export function importBatchCsv(csvText: string): BatchCsvImportResult {
	const rows = parseCsv(csvText);
	const result: BatchCsvImportResult = {
		links: [],
		importedRows: 0,
		mergedRows: 0,
		skippedRows: 0,
		errors: [],
	};

	const headerRow = rows.find(row => !isEmptyRow(row.fields));
	if (!headerRow) return result;

	const headers = headerRow.fields.map(header => header.trim().toLowerCase());
	const urlColumn = headers.indexOf('url');
	const textColumn = headers.indexOf('text');
	const pathColumn = headers.indexOf('path');

	if (urlColumn === -1) {
		result.errors.push({
			row: headerRow.row,
			message: 'CSV header must include a url column.',
		});
		return result;
	}

	const links: MutableBatchCsvImportLink[] = [];
	const linksByUrl = new Map<string, MutableBatchCsvImportLink>();
	const dataRows = rows.slice(rows.indexOf(headerRow) + 1);

	for (const row of dataRows) {
		if (isEmptyRow(row.fields)) continue;

		const url = normalizeUrl(row.fields[urlColumn] ?? '');
		if (!url) {
			result.skippedRows += 1;
			result.errors.push({
				row: row.row,
				message: 'Row must include an http or https URL.',
			});
			continue;
		}

		result.importedRows += 1;
		const rawText = textColumn === -1 ? '' : (row.fields[textColumn] ?? '').trim();
		const rawPath = pathColumn === -1 ? '' : (row.fields[pathColumn] ?? '').trim();
		let link = linksByUrl.get(url);

		if (!link) {
			link = {
				id: `csv-link-${links.length + 1}`,
				text: rawText || url,
				url,
				paths: [],
				hasText: rawText !== '',
				seenPaths: new Set<string>(),
			};
			linksByUrl.set(url, link);
			links.push(link);
		} else {
			result.mergedRows += 1;
			if (!link.hasText && rawText) {
				link.text = rawText;
				link.hasText = true;
			}
		}

		if (rawPath && !link.seenPaths.has(rawPath)) {
			link.seenPaths.add(rawPath);
			link.paths.push(rawPath);
		}
	}

	result.links = links.map(({ hasText, seenPaths, ...link }) => link);
	return result;
}

export function createBatchCsvSample(): BatchCsvSample {
	return {
		filename: 'obsidian-batch-import-sample.csv',
		content: [
			'url,text,path',
			'https://example.com/a,Example A,Clippings/News',
			'https://example.com/a,Example A,Clippings/Archive',
			'https://example.com/b,Example B,',
		].join('\n'),
	};
}
