/**
 * Which routes need a session, and which are reachable without one.
 *
 * Pure and framework-free so the same answer is available to the route
 * middleware in the browser, to server-side rendering, and to a unit test that
 * boots nothing. A route's access level is a fact about the application, not
 * about where the question is being asked from.
 *
 * The default is `protected`. Adding a page therefore protects it, and opening
 * one up is a deliberate edit to the list below — the failure mode of
 * forgetting is a locked door, not an open one.
 */

/** Where an unauthenticated visitor is sent, and where sign-in lives. */
export const SIGN_IN_PATH = '/sign-in'

/** Where a freshly authenticated visitor lands when nothing else was requested. */
export const AFTER_SIGN_IN_PATH = '/'

/**
 * - `protected` — needs a session; without one the visitor is sent to sign-in.
 * - `guest-only` — the sign-in surfaces. A signed-in visitor is sent onward,
 *   because offering "sign in" to somebody already signed in is a dead end.
 * - `public` — reachable either way. The password-reset screen is the reason
 *   this level exists: the visitor arriving there *is* authenticated, by a
 *   recovery session, and bouncing them to the dashboard would strand them
 *   one step short of the new password they came to set.
 */
export type RouteAccess = 'protected' | 'guest-only' | 'public'

const GUEST_ONLY_PATHS = new Set<string>([SIGN_IN_PATH, '/sign-up', '/forgot-password'])

const PUBLIC_PATHS = new Set<string>(['/reset-password', '/auth/confirm', '/auth/error'])

/**
 * Issue #10's chart-library bake-off (`app/pages/lab/chart-bakeoff/`).
 *
 * A prefix rather than another `PUBLIC_PATHS` entry because the tree grows one
 * page per candidate. It is safe to leave open: every page under it renders
 * only `domain/seed.ts`'s synthetic fixture, never a signed-in user's data, and
 * `nuxt.config.ts`'s `RUNWAY_LAB` gate means the tree does not exist as a route
 * at all in a production build — this classification only ever matters inside
 * a `RUNWAY_LAB` build, where a reviewer should be able to open it without a
 * local Supabase and an account.
 */
export const LAB_PATH_PREFIX = '/lab/'

/** Strips a trailing slash so `/sign-in/` and `/sign-in` classify identically. */
export function normalizeAuthPath(path: string): string {
  const withoutQuery = path.split('?')[0]?.split('#')[0] ?? ''
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) return withoutQuery.slice(0, -1)
  return withoutQuery || '/'
}

export function routeAccess(path: string): RouteAccess {
  const normalized = normalizeAuthPath(path)
  if (GUEST_ONLY_PATHS.has(normalized)) return 'guest-only'
  if (PUBLIC_PATHS.has(normalized)) return 'public'
  if (normalized.startsWith(LAB_PATH_PREFIX)) return 'public'
  return 'protected'
}

export function requiresSession(path: string): boolean {
  return routeAccess(path) === 'protected'
}
