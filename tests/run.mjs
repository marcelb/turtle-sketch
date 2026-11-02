// Test entry point: starts the server + browser, registers all tests, runs them, tears down.
// Usage: npm test   (builds the client first)
import { setup, teardown, run } from './harness.mjs';

await setup();
await import('./text.test.mjs');
await import('./arrows.test.mjs');
await import('./groups.test.mjs');
await import('./clipboard.test.mjs');
await import('./align.test.mjs');
await import('./size-snap.test.mjs');
await import('./tools.test.mjs');
await import('./style.test.mjs');
await import('./diamond.test.mjs');
await import('./elbow.test.mjs');
await import('./rotation.test.mjs');
await import('./frames.test.mjs');
await import('./border-resize.test.mjs');
await import('./arrow-label.test.mjs');
await import('./name-input.test.mjs');
await import('./multi-ops.test.mjs');
await import('./workspaces.test.mjs');
await import('./keys.test.mjs');
await run();
await teardown();
