# BabelMark

Markdown translation web app built with Next.js 15, React 18, Tailwind CSS, Radix UI, and Lucide React. Translates Markdown while preserving structure and formatting via an OpenAI-compatible streaming API.

## Features
- Preserve Markdown structure (headings, lists, tables, code blocks, inline code, links/images, frontmatter)
- Intelligent segmentation using remark AST
- Streaming translation via `/api/translate`
- Dual-pane editor (left) and live translated preview (right)
- Language and model selection
- Glossary and protected terms management (add/remove, persisted)
- Translation options: link text, image alt text, punctuation locale, light spellcheck
- Export (copy, download, ZIP with source + translated + settings)
- Settings persisted in localStorage
- Accessibility and i18n (en/zh), ARIA labels, toasts

## Keyboard Shortcuts

- Ctrl/Cmd + Enter: Start/Stop translation
- Ctrl/Cmd + C: Copy translated markdown
- Ctrl/Cmd + Shift + S: Download translated markdown
- Ctrl/Cmd + Shift + E: Export ZIP (source.md, translated.md, settings.json)

## Getting Started

1. Install dependencies

```bash
npm install
```

2. Configure environment (optional)

Copy `.env.example` to `.env` and set:

```
OPENAI_API_KEY=your_server_key_here
OPENAI_BASE_URL=https://api.openai.com # or your compatible endpoint
```

You can also supply an API key from the browser settings; it is sent only to `/api/translate`.

3. Run the dev server

```bash
npm run dev
```

4. Open http://localhost:3000

## Tech Stack
- Next.js 15 (App Router), React 18
- Tailwind CSS (+ typography)
- Radix UI, Lucide React
- unified/remark ecosystem

## Notes
- The translation API expects an OpenAI-compatible Chat Completions endpoint at `/v1/chat/completions` with `stream: true`.
- The app never translates code blocks, inline code, or link/image URLs.
- Link text and image alt text translation is configurable.
