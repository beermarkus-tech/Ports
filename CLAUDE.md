# Here Be Dragons (formerly Deadweight)

Read `docs/HANDOVER.md` first: it holds the project state, the owner's standing
instructions, the architecture, what's next (the WebGL map rewrite) and the build log.

The short version of the rules:
- After every change: `npm test`, `npm run build`, check it in a browser (Playwright),
  commit, then push to the session branch **and** to `main` (main deploys to GitHub Pages).
- Tell the owner the build number (`git rev-list --count HEAD`) after each deploy.
- When the owner asks for a proposal or says "no programming", don't change the app.
- Keep `docs/HANDOVER.md` up to date (build log, next steps) as work lands.
