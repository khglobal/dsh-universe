// The plugin's identity, in one place (the runtime package is `@khglobal/dsh-universe`). Every id,
// route, storage name and key is derived from PLUGIN_ID, so a rename is this one line plus the root package.json.
export const PLUGIN_ID = '@khglobal/dsh-universe';
/** PLUGIN_ID without the scope punctuation, for places that take plain names (route path, panel key, keys). */
export const PLUGIN_SLUG = PLUGIN_ID.replace(/^@/, '').replace(/[^a-z0-9]+/gi, '-');
/** The storage domain name (letters, digits and underscores). */
export const STORAGE_DOMAIN = PLUGIN_SLUG.replace(/-/g, '_');
