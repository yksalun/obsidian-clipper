import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('./manifest.chrome.json', import.meta.url), 'utf-8'));

describe('Chrome manifest side panel behavior', () => {
	test('uses side panel as the Chrome action surface', () => {
		expect(manifest.side_panel?.default_path).toBe('side-panel.html');
		expect(manifest.action?.default_popup).toBeUndefined();
	});
});
