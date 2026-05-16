import { afterEach, describe, expect, test } from 'vitest';
import { detectBrowser } from './browser-detection';

const originalBrowser = (globalThis as any).browser;
const originalChrome = (globalThis as any).chrome;
const originalWindow = (globalThis as any).window;

afterEach(() => {
	setGlobal('browser', originalBrowser);
	setGlobal('chrome', originalChrome);
	setGlobal('window', originalWindow);
});

function setGlobal(name: string, value: unknown) {
	if (value === undefined) {
		delete (globalThis as any)[name];
		return;
	}

	Object.defineProperty(globalThis, name, {
		configurable: true,
		value,
	});
}

describe('detectBrowser', () => {
	test('uses Chrome side panel capability in background contexts before browser global fallback', async () => {
		setGlobal('window', undefined);
		setGlobal('browser', { runtime: { id: 'polyfill-or-compatible-global' } });
		setGlobal('chrome', {
			runtime: { id: 'chrome-extension-id' },
			sidePanel: {
				open: () => undefined,
				setPanelBehavior: () => undefined,
			},
		});

		await expect(detectBrowser()).resolves.toBe('chrome');
	});
});
