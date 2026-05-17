# Batch CSV Import and Multi-Path Design

## Summary

This design extends the existing `Batch` tab in the Chrome/Chromium side panel. It keeps the current batch clipping flow, but makes the batch workspace usable even when the active tab is blank or unclippable, adds a batch-level default Obsidian path, lets each link target one or more Obsidian paths, and supports CSV import plus a downloadable CSV sample.

The import scope is CSV only. Excel import is intentionally out of scope for this iteration.

## Goals

- Let users open the side panel on a blank or unclippable tab and still use the `Batch` tab.
- Keep the `Clip` tab's current validation and error behavior for pages that cannot be clipped.
- Add a batch default path input in the `Batch` tab.
- Let each batch link override the default path with one or more paths.
- Save one URL to multiple Obsidian paths when that link has multiple paths.
- Add CSV import that converts rows into editable batch queue items.
- Add CSV sample download so users can fill a stable template and re-upload it.
- Keep the implementation aligned with the existing side panel, queue, renderer, and Obsidian save flow.

## Non-Goals

- No Excel import in this iteration.
- No per-row vault override.
- No per-row template override.
- No per-row note name override.
- No automatic batch run after importing a CSV.
- No change to the existing single-page `Clip` save behavior.
- No background batch execution without a user pressing `Run batch`.

## Current Behavior and Problem

The side panel currently initializes the batch panel only after the active tab passes the normal clipper validation path. Blank pages and restricted pages fail that validation early. As a result, the user can open the side panel but the `Batch` tab does not behave as an independent workflow, even though manual URL entry and CSV import do not depend on the active page.

The current batch queue stores one path indirectly through the selected template and selected vault. It does not let a link carry its own Obsidian path, and it cannot represent "save this same URL to several directories."

## UX Design

The side panel remains a two-tab workspace:

- `Clip`: single-page clipping for the current active tab.
- `Batch`: batch URL preparation, import, editing, and execution.

The `Batch` tab adds a top import/default area:

- A default path input. It is initialized from the current compiled Clip path when available; otherwise it starts empty so the user can enter a batch default manually.
- An `Import CSV` file control.
- A `Download sample CSV` button.
- The existing `Extract links` button.
- The existing concurrency input.

The `Extract links` button remains page-dependent. On a blank, restricted, or otherwise unclippable tab, it should be disabled or show a clear page-dependent error. Manual link entry, CSV import, path editing, and running imported/manual links remain available.

Each queue row displays:

- Link text.
- URL.
- One or more path inputs.
- Controls to add or remove path inputs.
- Status and remove-link controls.

If a queue item has no paths, it uses the batch default path at run time.

## CSV Format

The downloadable sample CSV uses exactly these columns:

```csv
url,text,path
https://example.com/a,Example A,Clippings/News
https://example.com/a,Example A,Clippings/Archive
https://example.com/b,Example B,
```

Column rules:

- `url` is required.
- `text` is optional.
- `path` is optional.
- Unknown extra columns are ignored.
- Header names are matched case-insensitively after trimming.
- Empty rows are ignored.
- Invalid or unsupported URLs are skipped and reported to the user.

Duplicate URL rules:

- Rows with the same normalized URL are merged into one queue item.
- The first non-empty `text` value becomes the link text.
- Non-empty `path` values become that link's path list.
- Duplicate paths for the same URL are de-duplicated while preserving first-seen order.
- If all merged rows for a URL have empty `path`, the link stores an empty path list and uses the batch default path when saved.

## Data Model

The batch queue item should extend the existing extracted link shape with optional paths:

```ts
interface BatchQueueItem {
	id: string;
	text: string;
	url: string;
	paths: string[];
	status: BatchQueueStatus;
	error?: string;
}
```

Extracted links from the active page start with `paths: []`.

Manual links can include one optional initial path in the add-link row. If that field is blank, the new link starts with `paths: []` and uses the batch default path when saved.

Imported CSV links are normalized and merged before becoming queue items.

## Execution Flow

For each queue item:

1. Open the URL in the existing temporary background tab.
2. Extract page content once.
3. Render the note once with the currently selected template and vault.
4. Resolve save paths:
   - Use `item.paths` when it has at least one non-empty path.
   - Otherwise use the batch default path.
   - Otherwise fall back to the rendered template path.
5. Save the rendered note once per resolved path through the existing Obsidian save chain.
6. Treat the item as successful only after all path saves succeed.

This preserves the current extraction and rendering cost while allowing multiple destination directories for one link.

## Error Handling

CSV import should not fail the whole import because of one bad row. It should import valid rows and report a concise summary, such as how many rows were imported, merged, skipped, or had invalid URLs.

Run-time save errors remain per queue item. If saving to one of several paths fails, the item is marked failed and the error should mention the path when possible.

Blank or restricted active pages should not block batch initialization. They only affect current-page operations such as `Extract links` and the `Clip` tab.

## Testing

Focused tests should cover:

- CSV parsing with quoted fields, commas, blank rows, and unknown columns.
- CSV import merging repeated URLs into one item with multiple paths.
- Invalid URL rows being skipped without blocking valid rows.
- Queue creation assigning empty `paths` for extracted links.
- Queue updates preserving multiple paths.
- Batch path resolution using item paths before default path before rendered template path.
- Multi-path execution saving one rendered note to each resolved path.
- Side panel initialization allowing the batch panel on blank or unclippable tabs.
- The downloadable sample CSV content and filename.

## Implementation Notes

The implementation boundaries are:

- Add CSV parsing and sample generation in a new small utility, for example `src/utils/batch-csv.ts`.
- Extend queue item types and helpers in `src/utils/batch-queue.ts`.
- Extend rendering or save orchestration in `src/core/batch-panel.ts` so per-link paths override the final save path without re-rendering the page for each path.
- Adjust `src/core/popup.ts` so common side panel setup and `initializeBatchPanel()` can run before or independently from current-tab clip validation.
- Update `src/side-panel.html` and `src/styles/side-panel.scss` for the import controls, default path input, and per-row path editor.
