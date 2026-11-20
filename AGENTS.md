# Project Rules & Guardrails

- `src/worker/**` and `src/shared/**` are already modularized. DO NOT modify business logic inside `src/worker/**`.
- Browser scripts (`src/web/core.mjs` and `src/web/app.mjs`) are bundled into classic browser scripts for `index.html`.
- All top-level global symbols listed in `test/web-bindings.json` MUST remain exposed in the browser global scope after bundling.
- NEVER include CJK characters (Chinese, Japanese, Korean) anywhere in code, comments, or strings—`scripts/check-refactor.mjs` will fail the build.
- Keep `starter/**` intact.
- After any code change, you MUST run `node scripts/build.mjs` and `node scripts/check-refactor.mjs`. Never claim a task is complete unless `node scripts/check-refactor.mjs` passes with 0 errors.
