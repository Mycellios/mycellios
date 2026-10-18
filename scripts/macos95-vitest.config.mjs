// The archived payload intentionally has no Vitest config. Do not discover the
// orchestration checkout's config or resolve its unrelated dependencies.
export default { root: process.cwd(), test: { include: ['tests/**/*.test.ts'], maxWorkers: 1 } };
