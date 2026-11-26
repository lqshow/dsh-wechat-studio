# Brief File Import Implementation Plan

Open a PDF or Word document in the existing brief dialog. The host extracts text without invoking the model. The dialog lets users review and edit the text before requesting extraction of brief fields.

1. Add bounded DOCX ZIP and XML parsing in `src/docx-text.js`, and bundle it in `scripts/build.mjs`. Preserve body paragraphs, table text and hyperlink destinations.
2. Use the bundled PDF text layer in `src/brief-file.js`. Add a binary import route in `src/host.js` and return readable errors for scans, invalid inputs and text beyond the limit.
3. Wire the file picker and pending state in `client/prep.jsx` and `client/state.js`. Append to existing text and keep the existing confirmation flow.
4. Verify document parsing via the host route, then run the full build, tests, package validation and offline installed-package smoke test.
