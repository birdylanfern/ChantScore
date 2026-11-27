// Minimal TypeScript test loader (no extra dependencies beyond `typescript`).
// Resolves the "@/" alias and extensionless imports, and transpiles .ts/.tsx
// with TypeScript so type-only imports are elided correctly.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
