# Research Reader — Project Plan

## Vision

An AI-powered PDF reader and annotation tool. Load any PDF, annotate it (highlights,
notes, bookmarks), and get help from an AI that can see what you're reading, create
annotations on your behalf, and converse via chat or voice.

---

## Tech Stack

| Layer              | Technology                    | Notes                                            |
|--------------------|-------------------------------|--------------------------------------------------|
| Desktop shell      | Tauri 2.0 (Rust)             | Light (~10MB), native OS integration, emerging iOS support |
| Frontend           | React + TypeScript            | Shares code with future React Native iPad app    |
| Build tool         | Vite                          | Fast dev server, first-class Tauri integration    |
| PDF rendering      | react-pdf (PDF.js)            | Industry standard browser-based PDF rendering     |
| State management   | Zustand                       | Lightweight, good for complex annotation state    |
| Styling            | Tailwind CSS v4               | Fast to build, dark mode, consistent design       |
| AI abstraction     | Vercel AI SDK                 | Model-agnostic: Gemini, OpenAI, Anthropic, local  |
| Voice (default)    | Web Speech API / Whisper      | Push-to-talk STT, TTS for AI responses            |
| Voice (advanced)   | Gemini Live / OpenAI Realtime | Full conversation mode, toggled in settings        |
| AI key management  | BYOK (Bring Your Own Key)     | User provides API keys in settings panel           |

---

## `.rr` File Format (Research Reader)

A ZIP-based container that bundles a PDF with its annotations in a single shareable file.

### Internal Structure

```
myresearch.rr  (ZIP file)
├── manifest.json       { version, format, created_at }
├── document.pdf        Original PDF (stored uncompressed for speed)
└── data.sqlite         Annotations, notes, bookmarks, AI conversations
```

### Key Properties

- **Non-destructive**: Original PDF is stored byte-identical, never modified
- **Portable**: Rename to .zip, extract document.pdf — readable without Research Reader
- **Extensible**: Can add thumbnails/, ai-config.json, etc. later

### SQLite Schema (inside data.sqlite)

```sql
metadata        (key TEXT PK, value TEXT)  -- format version, title, etc.

annotations
├── id              TEXT PK (UUID)
├── type            TEXT        -- 'highlight' | 'note' | 'bookmark'
├── page_number     INTEGER
├── color           TEXT        -- hex color
├── content         TEXT        -- note text (null for plain highlights)
├── position_data   TEXT (JSON) -- rects, pageWidth/Height, selectedText, offsets
├── created_at      DATETIME
└── updated_at      DATETIME

conversations  (future — Phase 2)
├── id              TEXT PK
├── role            TEXT        -- 'user' | 'assistant'
├── content         TEXT
├── created_at      DATETIME
```

### Data Flow

1. **Open .rr**: Unzip to temp dir -> open SQLite -> load PDF via PDF.js
2. **Open raw .pdf**: Prompt to import -> create .rr container -> proceed as above
3. **Annotate**: Zustand updates instantly (optimistic) -> write to temp SQLite
4. **Save**: Re-pack temp dir into .rr file (fast — PDF is uncompressed copy)
5. **Close**: Clean up temp directory

### Annotation Position Data

Dual-anchored for resilience:
- **Rects** (x, y, width, height) — for fast rendering at any zoom
- **Text + character offsets** — for re-anchoring if rendering differs
- All coordinates normalized to zoom=1.0, scaled on render

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Tauri Shell                       │
│  ┌───────────────────────────────────────────────┐  │
│  │              React Frontend (Vite)             │  │
│  │                                                │  │
│  │  ┌──────────┐ ┌────────────┐ ┌─────────────┐ │  │
│  │  │ PDF View │ │ Annotation │ │  AI Panel    │ │  │
│  │  │ (PDF.js) │ │   Layer    │ │ (Chat+Voice) │ │  │
│  │  └──────────┘ └────────────┘ └─────────────┘ │  │
│  │                                                │  │
│  │  ┌────────────────────────────────────────┐   │  │
│  │  │         Zustand Stores                 │   │  │
│  │  │  pdf-store: pages, zoom, viewport      │   │  │
│  │  │  annotation-store: highlights, notes   │   │  │
│  │  │  ai-store: conversations, context      │   │  │
│  │  └────────────────────────────────────────┘   │  │
│  │                                                │  │
│  │  ┌──────────────────┐ ┌────────────────────┐  │  │
│  │  │ AI Provider      │ │ .rr File Manager   │  │  │
│  │  │ (Vercel AI SDK)  │ │ (ZIP + SQLite)     │  │  │
│  │  └──────────────────┘ └────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
│                    Rust Backend                       │
│         (File I/O, SQLite, ZIP, IPC, file dialog)    │
└─────────────────────────────────────────────────────┘
```

Store actions (addHighlight, addNote, etc.) are the shared API surface — called
by both UI event handlers and AI tool invocations. Same code path, same persistence.

---

## Implementation Phases

### Phase 1: Foundation — PDF Viewer + Annotations ✅ COMPLETE

All core functionality is implemented and working.

| # | Task | Status |
|---|------|--------|
| 1 | Scaffold Tauri 2.0 + Vite + React + TypeScript + Tailwind | ✅ Done |
| 2 | Implement .rr file format (ZIP container, SQLite, Tauri commands) | ✅ Done |
| 3 | PDF viewer: render pages, scroll, zoom, page navigation, viewport tracking | ✅ Done |
| 4 | Toolbar: open file (.rr or .pdf with import), page number, zoom controls | ✅ Done |
| 5 | Text selection -> highlight creation with color picker | ✅ Done |
| 6 | Sticky notes: click-to-place, drag-to-reposition, expand/collapse, edit | ✅ Done |
| 7 | Annotation sidebar: list all annotations, click to navigate, filter by type | ✅ Done |
| 8 | Highlight + note overlay rendering on PDF pages | ✅ Done |
| 9 | Auto-save .rr file (30s interval), persist page count + last page | ✅ Done |

**Phase 1 details — what was built:**

- **Rust backend** (9 Tauri IPC commands): `open_file`, `save_file`, `close_file`, `read_pdf_bytes`, `get_annotations`, `create_annotation`, `update_annotation`, `delete_annotation`, `set_document_metadata`
- **PDF viewer**: Page virtualization (PAGE_BUFFER=2), `useDeferredValue(zoom)` for smooth zoom, RAF-throttled scroll handler, `window.__scrollToPage` for cross-component navigation
- **Pinch-to-zoom**: Document-level WebKit GestureEvent handlers + wheel+ctrlKey fallback, continuous multiplicative scaling (0.25x–4.0x)
- **Keyboard shortcuts** (centralized in App.tsx): Ctrl+O open, Ctrl+S save, Ctrl+=/- zoom, Ctrl+B toggle bookmark, N toggle note mode, Escape deselect/exit mode
- **Annotations**: Optimistic create/update/delete with rollback on failure, pre-indexed by page via `Map<number, Annotation[]>` useMemo
- **Sticky notes**: Shared drag handler with 3px threshold (click vs drag), RAF-batched positioning, collapsed (icon) and expanded (card) states
- **Error handling**: Top-level ErrorBoundary (shows error + stack trace + reload), inner ErrorBoundary around `<Document>`, console.error with `[module]` prefixes
- **Context menu**: Right-click on PDF pages → "Add note here"

**Bugs fixed during Phase 1:**
1. Click outside expanded sticky note now collapses it (deselect on page/container click)
2. Collapsed sticky notes are draggable (shared `startDrag()` with click fallback)
3. Slow zoom fixed with `useDeferredValue(zoom)` for deferred canvas re-renders
4. Crash prevention: ErrorBoundary + try/catch around note creation + defensive guards
5. Blank screen on load: `useCallback` was placed after early returns (hooks ordering violation)

### Phase 2: AI Integration ✅ COMPLETE

| # | Task | Status |
|---|------|--------|
| 1 | AI chat side panel with Vercel AI SDK + Gemini (BYOK) | ✅ Done |
| 2 | Context system: full PDF text + current viewport focus + annotations | ✅ Done |
| 3 | AI tools: addHighlight(), addNote(), goToPage() — calls store actions | ✅ Done |
| 4 | Push-to-talk voice input (Web Speech API / Whisper) | ✅ Done |
| 5 | TTS for AI responses | ✅ Done |
| 6 | Settings: model selection, API keys, voice mode toggle | ✅ Done |

**Design notes:**
- AI shares the same store actions as UI (addHighlight, addNote, goToPage) — no separate code paths
- BYOK: user provides their own API keys (Gemini, OpenAI, Anthropic) via a settings panel
- Context window: extract full PDF text + serialize visible page range + current annotations as structured context for the AI
- AI tools are function-calling based — the AI SDK invokes store actions, results appear in the UI instantly via optimistic updates

### Phase 3: Advanced Voice ⬜ FUTURE

| # | Task | Status |
|---|------|--------|
| 1 | Full conversation mode (Gemini Live / OpenAI Realtime API) | ⬜ Not started |
| 2 | Streaming bidirectional audio | ⬜ Not started |
| 3 | Settings toggle between push-to-talk and conversation mode | ⬜ Not started |

### Phase 4: Platform Expansion ⬜ FUTURE

| # | Task | Status |
|---|------|--------|
| 1 | Web page ingestion (readability parsing -> .rr container) | ⬜ Not started |
| 2 | iPad app (Tauri mobile or React Native with shared logic) | ⬜ Not started |
| 3 | Multi-document library view | ⬜ Not started |
| 4 | Export annotations (Markdown, annotated PDF copy) | ⬜ Not started |
| 5 | iCloud/Dropbox sync of .rr files | ⬜ Not started |

### Additionals

- Add OCR for document extraction

---

## Key Design Decisions

1. **Non-destructive**: Never modify original PDFs — annotations stored separately in .rr container
2. **Optimistic UI**: Zustand updates instantly, SQLite persists async, rollback on failure
3. **Normalized coordinates**: Annotation positions stored at zoom=1.0, scaled on render
4. **Dual anchoring**: Rects for fast render + text offsets for re-anchoring resilience
5. **Store actions as API**: UI and AI share the same mutation interface
6. **ZIP container**: .rr files are inspectable, portable, extensible
7. **BYOK for AI**: No backend costs, user brings their own API keys
