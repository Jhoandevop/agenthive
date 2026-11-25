# Contributing

Thanks for helping! Keep changes small and focused.

- **Run it:** `npm install`, then `npm run demo` (fake agents, no Claude calls) or `npm start` with your `oficina.config.json`.
- **Before a pull request:** `npm run check` (types) and `npm test` must pass. Add a test for new logic, especially anything that touches security (tokens, Origin/Host checks, uploads, file serving, permissions).
- **Style:** TypeScript runs directly on Node (no build step), so only erasable syntax. The code and UI strings are in Spanish; new UI strings go in `public/i18n.js` in both `es` and `en`.
- **Never** add anything that auto-approves tool permissions, reads credential files, or changes Claude Code settings.
- **No personal data** in commits: real paths, names or screenshots of private projects belong in your local `oficina.config.json` and `capturas-locales/` (both git-ignored).
