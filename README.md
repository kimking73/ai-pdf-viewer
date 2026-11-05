**English** | [한국어](README.ko.md)

# AI PDF Viewer

A macOS desktop PDF reader with an AI tutor beside the page. Ask about the page you are on, a text selection, or a dragged area, and get answers with page citations you can click.

This is a personal project. It runs on your own API key, with no backend server. The app's interface is in Korean.

## Features

- **PDF reading:** scrolling, page navigation, zoom, text selection, and a list of recent documents.
- **Questions in context:** ask about the current page, selected text, or a dragged area of the page.
- **Pages without text:** when a page has no usable text and nothing is selected, the page is sent as an image, so scans and figure-only pages still work.
- **Formatted answers:** streaming text with headings, lists, code, and math rendered by [Temml](https://temml.org/).
- **Page citations:** click a citation to jump to that page.
- **Recap and correction:** see what the tutor read, and correct what it misread.
- **Visible send scope:** the panel shows what will be sent before you ask.

## Privacy and security

- **What is sent:** only the scope shown in the panel goes to the provider you chose: nearby page text, your selection, an area or page image, recent turns, and your corrections. The app never sends the whole document.
- **Copy-protected PDFs:** you can read them, but their content is not copied or sent. Password-protected PDFs are not decrypted.
- **API key:** it is handled only in the main process and encrypted with Electron `safeStorage`. It is never exposed to the renderer.
- **Conversations:** they are kept in memory and are gone when you quit. OpenAI requests use `store: false`.
- **Local data:** recent document paths are stored unencrypted in `recent-documents.json` in the app's data folder, with `0600` permissions.
- **Process isolation:** the renderer is treated as untrusted, with `contextIsolation` and `sandbox` on and `nodeIntegration` off. IPC is limited to narrow operations validated with zod.

## Download

**[Download the DMG for Apple Silicon](https://github.com/kimking73/ai-pdf-viewer/releases/latest/download/AI-PDF-Viewer-arm64.dmg)**. It does not run on Intel Macs.

1. Open the DMG and drag the app to `Applications`.
2. The app is not signed with a Developer ID or notarized, so macOS blocks it and may say it is damaged. If you trust this build, remove the download flag once in Terminal:

   ```sh
   xattr -cr "/Applications/AI PDF Viewer.app"
   ```

3. Open the app, press `⌘,`, choose OpenAI, and save your API key.

## Build from source

You need macOS, Node.js, and an OpenAI API key. The project was developed and tested on Apple Silicon with Node.js 26.

```sh
git clone https://github.com/kimking73/ai-pdf-viewer.git
cd ai-pdf-viewer
npm ci
npm run dev
```

Then:

1. Press `⌘,` to open Settings.
2. Choose OpenAI and save your API key.
3. Press `⌘O` to open a PDF and ask a question in the panel.

### Build an installable app

```sh
npm run package:mac
```

The DMG is written to `release/`. Open it and drag the app to `Applications`. The build is ad-hoc signed, not signed with a Developer ID or notarized, so Gatekeeper may block a copy moved to another Mac.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘O` | Open a PDF |
| `⌘,` | Open Settings |
| `⌥⌘G` | Go to a page number |
| `⌘+` / `⌘-` | Zoom in / out |
| `⌘0` | Fit to width |
| `⇧⌘R` | Area selection |
| `⌘L` | Focus the question input |
| `⌘.` | Stop the answer |

## Development

| Command | Purpose |
|---|---|
| `npm run dev` | Run with hot reload. Restart it after changing main-process or preload code |
| `npm run build` | Build to `out/` |
| `npm run typecheck` | Type check |
| `npm run lint` | Lint |
| `npm test` | Unit tests |
| `npm run test:e2e` | Build, then run Electron end-to-end tests with a fake provider. Windows open on screen |
| `npm run package:mac` | Build the DMG |
| `npm run test:packaged` | Launch and check the packaged app. Run it after `package:mac` |

Built with Electron, React, TypeScript, electron-vite, pdf.js, Temml, zod, Vitest, and Playwright.

The source is organized as:

```
src/main/      Main process: AI providers, key storage, documents, IPC handlers
src/preload/   Narrow API exposed to the renderer
src/renderer/  React UI: viewer and tutor panel
src/shared/    IPC contract and code shared across processes
e2e/           Electron end-to-end tests
```

Project documents are in Korean: [architecture](docs/architecture.md), [decisions](docs/decisions.md), [tasks](docs/tasks.md), and the [PRD](PRD.md).

## Known limitations

- **POSTECH AI:** it appears in Settings but does not work yet. Use OpenAI.
- **OpenAI model:** the model is fixed in `src/shared/ai-model.ts`, and the current value is provisional.
- **Math:** `\pmb` and `\sideset` lose their styling in packaged builds because of the content security policy.
- **Scans:** there is no OCR. Questions about text-free pages rely on the page image.

## License

No license has been chosen yet, so no rights to reuse the code are granted.
