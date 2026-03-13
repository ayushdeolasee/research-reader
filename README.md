# Research Reader

Research Reader is an AI-powered PDF reader built with Tauri + React + TypeScript.

It supports:

- Smooth PDF viewing (scroll, zoom, navigation)
- Highlights, sticky notes, and annotation sidebar
- AI chat panel with document-aware context
- Voice input (push-to-talk) and TTS output
- Markdown + LaTeX rendering in AI responses

## Tech Stack

- Tauri 2
- React + TypeScript + Vite
- Zustand
- PDF.js via `react-pdf`

## Local Development

1. Clone the repository:

```bash
git clone git@github.com:ayushdeolasee/research-reader.git
cd research-reader
```

2. Install dependencies:

```bash
npm install
```

3. Run the desktop app in development mode:

```bash
npm run tauri dev
```

## Website (Landing Page)

A standalone marketing website lives in `website/`.

Run it locally:

```bash
npm run website:dev
```

Build static output:

```bash
npm run website:build
```

Preview production build:

```bash
npm run website:preview
```

## Notes

- AI features use BYOK (bring your own API key) from the in-app AI settings panel.

## Auto-Updates and GitHub Releases

This app is now wired for Tauri's built-in updater and a GitHub Releases publish workflow.

### What you need to do once

1. Generate a Tauri updater signing keypair:

```bash
npm run tauri signer generate -- -w ~/.tauri/vellum.key
```

2. Open the generated public key and copy its contents into
   `src-tauri/tauri.conf.json` by replacing `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`.

3. Add these GitHub Actions repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the private key file contents or a path available in CI
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional password used when generating the key

4. Make sure GitHub Actions has `Read and write permissions` for the repository token.

### Publishing a release

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
2. Commit and push the change.
3. Create and push a version tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

That triggers `.github/workflows/publish.yml`, which builds both macOS targets, signs the updater artifacts, creates the GitHub Release, and uploads `latest.json` for in-app updates.

### Recommended for production macOS releases

For the smoothest end-user install experience, also add Apple code signing and notarization before broad distribution. The updater signing added here is required for Tauri updates, but it does not replace Apple's Gatekeeper requirements.
