# Batch Side Panel Design

## Summary

This feature adds a batch clipping workspace to the existing Chrome/Chromium side panel. The project stays on its current Webpack and handwritten manifest architecture. WXT migration is explicitly out of scope for this feature.

The `main` branch remains the upstream-sync branch. Feature work happens on `codex/batch-side-panel`; future upstream updates should be merged into `main` first, then merged from `main` into this feature branch.

## Goals

- Keep the existing single-page clipper behavior intact.
- Add a dedicated `Batch` tab to the current side panel UI.
- Extract visible normal links from the active page into an editable queue.
- Let users remove links, edit link text and URL, and add links manually.
- Process the queue into independent Obsidian notes using the currently selected template.
- Reuse the existing extraction, template rendering, and Obsidian save flow wherever possible.
- Support configurable small concurrency with stable sequential saves to Obsidian.

## Non-Goals

- No WXT migration.
- No rewrite of the popup or side panel architecture.
- No first-version support for JavaScript-only button navigation.
- No direct filesystem writes from the browser extension.
- No first-version batch UI for Firefox or Safari.
- No automatic background batch execution without a user pressing the run button.
- No first-version automatic execution of interpreter prompt variables during batch runs.

## Browser Scope

The first version targets Chrome and Chromium-based browsers. The repository already declares `sidePanel` permission and `side_panel.default_path` in `src/manifest.chrome.json`, and already ships `src/side-panel.html`.

Firefox and Safari should continue to build and use the existing popup flow. The batch side panel controls can be hidden or unavailable on browsers that do not support the Chrome side panel API.

## UX Design

The existing side panel becomes a two-tab workspace:

- `Clip`: the current single-page clipper experience.
- `Batch`: the new batch link queue and execution view.

The `Clip` tab should preserve current behavior and visual structure as much as possible.

The `Batch` tab contains:

1. A top control area using the current selected template, vault, and path context.
2. A concurrency input, defaulting to `1`, with a small supported range such as `1-3`.
3. An `Extract links` button.
4. An editable queue of extracted links.
5. An `Add link` control for manual entries.
6. A `Run batch` button.
7. Per-link status output and a summary area.
8. A `Retry failed` control after a run with failures.

Extracting links should only populate the queue. It must not open target pages or save anything until the user clicks `Run batch`.

## Link Extraction

The first version extracts visible normal links from the active page:

- Include visible `<a href>` elements.
- Resolve relative URLs to absolute URLs.
- Use visible link text as the default label; fall back to `aria-label`, `title`, or URL when text is empty.
- Filter out `mailto:`, `tel:`, `javascript:`, empty hash-only links, browser-restricted URLs, extension URLs, and invalid URLs.
- De-duplicate by normalized URL.
- Preserve source order from the page.

The user can then edit the queue:

- Delete unwanted links.
- Edit label text.
- Edit URL.
- Add a new label and URL manually.

## Batch Execution Data Flow

Each queue item is processed as an independent clipping task.

The scheduler takes runnable queue items up to the configured concurrency. For each link:

1. Create a temporary inactive tab for the URL.
2. Wait for the target page to load enough for extraction.
3. Ensure the existing content script is available.
4. Call the existing page extraction flow used by the clipper.
5. Render the selected template using the extracted data for that target page while the temporary tab is still available for selector variables.
6. Generate frontmatter and final Markdown content.
7. Close the temporary tab after rendering succeeds or fails.
8. Save to Obsidian using the existing `saveToObsidian` behavior.
9. Update the item status.

The selected template is fixed for the run. Batch execution should not re-run template trigger matching per target URL in the first version.

Each successful link creates or updates one independent Obsidian note according to the selected template behavior, note name format, path, vault, and content format.

If the selected template contains interpreter prompt variables while interpreter features are enabled, the first version should show a clear unsupported-template message instead of running the batch.

## Concurrency Model

Content extraction can run with small configurable concurrency. The default is serial execution with concurrency `1`.

Saving to Obsidian should run through a sequential save queue even when extraction is concurrent. This avoids simultaneous clipboard writes and multiple `obsidian://` URL opens racing each other.

If the first implementation finds that concurrent temporary tabs create instability, the UI can keep the concurrency setting but internally constrain saving-sensitive steps to serial behavior. Stability is more important than speed for the first version.

## Error Handling

Batch runs should be item-isolated. A failure on one link should not stop the rest of the queue.

Each queue item can have these states:

- `idle`
- `queued`
- `opening`
- `extracting`
- `saving`
- `success`
- `failed`

Failure messages should be concise and actionable where possible:

- URL cannot be opened.
- Page is restricted or unsupported.
- Content script injection failed.
- No content was extracted.
- Template rendering failed.
- Save to Obsidian failed.

After a run completes, failed items remain in the queue with their error messages. Users can edit them and run `Retry failed`.

Temporary tabs should be closed after each task whenever possible, including failed tasks.

## Existing Code Integration

The implementation should favor existing boundaries:

- Side panel shell: `src/side-panel.html`
- Shared popup/side-panel controller: `src/core/popup.ts`
- Page extraction: `src/utils/content-extractor.ts`
- Content script request handling: `src/content.ts`
- Template compilation: `src/utils/template-compiler.ts`
- Frontmatter and Obsidian save: `src/utils/obsidian-note-creator.ts`
- Browser messaging and temporary tab orchestration: `src/background.ts`

If `popup.ts` becomes too large while adding this feature, extract focused batch modules rather than mixing all new logic into the existing file:

- A link extraction helper for content-script-side DOM scanning.
- A queue state helper for batch item status transitions.
- A background-side temporary tab processor.
- A small side-panel UI controller for the Batch tab.

These modules should expose clear functions and keep the existing single-page clipper path readable.

## Permissions

Chrome already has the important baseline permissions for this design:

- `sidePanel`
- `activeTab`
- `scripting`
- host permissions for HTTP and HTTPS pages

The implementation should prefer existing background helpers and host permissions before adding new permissions. If temporary-tab processing requires a manifest change, document why it is necessary and keep it Chrome-only when possible. During implementation, compare the final built Chrome manifest against the current source manifest and avoid unnecessary permission expansion.

## Testing Strategy

Unit tests should cover:

- Link extraction and filtering rules.
- URL normalization and de-duplication.
- Queue state transitions.
- Concurrency scheduling limits.
- Sequential save queue behavior.

Manual tests should cover:

- Existing single-page clipper still works.
- Side panel opens and defaults to the expected tab.
- `Batch` tab can extract visible links from a normal page.
- Users can edit, delete, and add queue items.
- Serial batch run creates separate Obsidian notes.
- Small-concurrency batch run extracts multiple pages without racing saves.
- Restricted or failing links show per-item failures and do not stop the rest.
- `Retry failed` only retries failed items.
- Firefox and Safari builds still complete and keep the old popup behavior.

Build verification should include at least:

- `npm test`
- `npm run build:chrome`

If implementation touches browser-specific manifest or shared build behavior, also run:

- `npm run build:firefox`
- `npm run build:safari`
