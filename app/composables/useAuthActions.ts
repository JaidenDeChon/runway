/**
 * Every call that changes who is signed in, in one place.
 *
 * The pages are forms; this is what they submit to. Keeping it here means the
 * neutral-message rule from `#shared/auth/errors` is applied once per operation
 * rather than once per page, and the redirect URL that every emailed link comes
 * back to is spelled out in exactly one spot.
 *
 * Each action returns a small result rather than throwing, because every caller
 * needs the same three things — did it work, what do I tell the user, and am I
 * still busy — and exceptions would turn that into a `try/catch` in four pages.
 */

import {
  type AuthOperation,
  authErrorMessage,
  NEUTRAL_EMAIL_SENT,
  NEUTRAL_SIGN_UP_SENT,
} from '#shared/auth/errors'
import { resolvePostSignInPath } from '#shared/auth/redirect'
import { SIGN_IN_PATH } from '#shared/auth/routes'

export interface AuthActionResult {
  readonly ok: boolean
  /**
   * What to show the user. Present on failure, and also on the successes whose
   * whole point is a message — "check your inbox" — so the caller never has to
   * write the copy that must stay identical between the two.
   */
  readonly message: string | null
  readonly tone: 'error' | 'notice'
}

const OK: AuthActionResult = { ok: true, message: null, tone: 'notice' }

function failed(operation: AuthOperation, error: unknown): AuthActionResult {
  return {
    ok: false,
    message: authErrorMessage(operation, error as { message?: string; code?: string }),
    tone: 'error',
  }
}

function notice(message: string): AuthActionResult {
  return { ok: true, message, tone: 'notice' }
}

export function useAuthActions() {
  const client = useSupabaseClient()
  const route = useRoute()

  /**
   * Where GoTrue sends the browser after an emailed link is clicked.
   *
   * Absolute, because it goes into an email — but built from the *live* origin
   * rather than from configuration, so a preview deploy sends links back to
   * itself instead of to production. Supabase only honours redirect targets on
   * its allow-list, which is what stops this being an open redirect; see
   * `docs/auth.md` for the list a hosted project needs.
   */
  function confirmUrl(next?: string): string {
    const origin = window.location.origin
    const url = new URL('/auth/confirm', origin)
    if (next) url.searchParams.set('next', next)
    return url.toString()
  }

  /** Where to land after a successful sign-in, honouring `?redirect=` safely. */
  function destination(): string {
    return resolvePostSignInPath(route.query.redirect)
  }

  async function signInWithPassword(email: string, password: string): Promise<AuthActionResult> {
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return failed('sign-in', error)
    await navigateTo(destination())
    return OK
  }

  /**
   * Passwordless sign-in.
   *
   * `shouldCreateUser: false` — a magic link must not quietly create an account
   * for a typo'd address, and sign-up is its own screen. The acknowledgement is
   * the same whether or not the address exists, so the response reveals nothing
   * the error message was careful not to.
   */
  async function signInWithMagicLink(email: string): Promise<AuthActionResult> {
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: confirmUrl(destination()) },
    })
    if (error) return failed('magic-link', error)
    return notice(NEUTRAL_EMAIL_SENT)
  }

  /**
   * Create an account.
   *
   * Two shapes come back, and both are handled rather than assumed:
   *
   * - A project with email confirmation **off** (the local stack's default)
   *   returns a live session, and the new user goes straight into the app.
   * - A project with it **on** (what a hosted project should run) returns no
   *   session, and the user is told to check their inbox.
   *
   * When the address is already registered, GoTrue with confirmations on
   * returns a decoy user and no error; with them off it returns "User already
   * registered". Both end at the same neutral sentence, so neither the message
   * nor the shape of the response answers "does this person have an account".
   */
  async function signUp(email: string, password: string): Promise<AuthActionResult> {
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: confirmUrl() },
    })
    if (error) return failed('sign-up', error)

    if (data.session) {
      await navigateTo(destination())
      return OK
    }
    return notice(NEUTRAL_SIGN_UP_SENT)
  }

  /**
   * Ask for a password-reset link.
   *
   * The acknowledgement is returned on failure too — see
   * `authErrorMessage('password-reset-request', …)` — so an unregistered
   * address is indistinguishable from a registered one. Rate limiting is the
   * one thing that does surface, because it is a fact about this browser.
   */
  async function requestPasswordReset(email: string): Promise<AuthActionResult> {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: confirmUrl('/reset-password'),
    })
    if (error) return failed('password-reset-request', error)
    return notice(NEUTRAL_EMAIL_SENT)
  }

  /** Set a new password. Requires the recovery session the emailed link created. */
  async function updatePassword(password: string): Promise<AuthActionResult> {
    const { error } = await client.auth.updateUser({ password })
    if (error) return failed('password-update', error)
    await navigateTo(resolvePostSignInPath(null))
    return OK
  }

  /**
   * Sign out, everywhere this browser is concerned.
   *
   * `scope: 'local'` would leave the refresh token valid for other sessions;
   * the default `global` revokes it, which is what a person pressing "Log out"
   * on a financial app means. The navigation is explicit rather than left to
   * the auth-state listener, so the visitor never sees a protected page repaint
   * empty on the way out.
   */
  async function signOut(): Promise<AuthActionResult> {
    const { error } = await client.auth.signOut()
    if (error) return failed('sign-out', error)
    await navigateTo(SIGN_IN_PATH)
    return OK
  }

  return {
    signInWithPassword,
    signInWithMagicLink,
    signUp,
    requestPasswordReset,
    updatePassword,
    signOut,
  }
}
