import { resolveWorkflowMode } from '../src/story-modes.js';
console.log(resolveWorkflowMode(process.env.INPUT_MODE, process.env.LEGACY_MODE));
