import path from 'path'

/**
 * Saved-session paths shared by auth.setup.ts (which writes them), the
 * Playwright projects (which read them) and specs that switch session
 * mid-file. Kept out of auth.setup.ts because Playwright refuses to let a spec
 * import a setup file.
 */
const AUTH_DIR = path.join(__dirname, '..', '.auth')

export const ADMIN_STORAGE = path.join(AUTH_DIR, 'admin.json')
export const EDITOR_GLOBAL_STORAGE = path.join(AUTH_DIR, 'editor-global.json')
export const EDITOR_SCOPED_STORAGE = path.join(AUTH_DIR, 'editor-scoped.json')
