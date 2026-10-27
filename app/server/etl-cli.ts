import { ensureContent } from './etl.js';

const result = ensureContent();
console.log(JSON.stringify(result, null, 2));
