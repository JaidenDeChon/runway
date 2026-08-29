# Authentication

Runway's sessions are Supabase Auth sessions, held in cookies, validated on the
server. This document is the map: where each piece lives, which decisions were
deliberate, and what a human still has to do on the hosted project.

The security posture underneath it — row-level security, deny by default, the
`user_id` predicate on every table — is [`database/rls.md`](./database/rls.md).
This document does not repeat it, and neither replaces the other: route
protection is a usability boundary, RLS is the security one.

---

## The shape of it

```
browser                          server (Nitro)                 Supabase
───────                          ──────────────                 ────────
app/plugins/supabase.client.ts   server/middleware/auth.ts       GoTrue
  createBrowserClient              serverSupabaseClient(event)     /auth/v1/*
  → cookies                        getUser()  ← validates here   PostgREST
  onAuthStateChange                → event.context.runwayUser      RLS on
      │                                     │                    auth.uid()
      └──────── useAuthUser() ──────────────┘
                     │
        app/middleware/auth.global.ts  (redirects)
        server/utils/supabase.ts       (requireUser → 401)
```

| File | Holds |
| --- | --- |
| `shared/auth/routes.ts` | Which routes need a session. Default is **protected**. |
| `shared/auth/redirect.ts` | The open-redirect guard on `?redirect=` and `?next=`. |
| `shared/auth/errors.ts` | Every message the user sees. The enumeration rule lives here. |
| `shared/auth/session.ts` | `AuthUser`, expiry arithmetic, display name and initials. |
| `shared/auth/password.ts` | The password rule, shared with `supabase/config.toml`. |
| `shared/auth/cookies.ts` | Cookie options, and the `httpOnly` note below. |
| `app/lib/supabase/client.ts` | The browser client. |
| `server/utils/supabase.ts` | The request-scoped server client, `getSessionUser`, `requireUser`. |
| `server/middleware/auth.ts` | One validated `getUser()` per request. |
| `server/routes/auth/confirm.get.ts` | Where every emailed link lands. |
| `app/middleware/auth.global.ts` | The door on every route. |
| `app/composables/useAuth*.ts` | `useAuthUser()`, `useSupabaseClient()`, the actions. |

---

## Decisions worth knowing about

### Cookies, not `localStorage`

`@supabase/ssr` rather than plain `@supabase/supabase-js`. A session in
`localStorage` is invisible to the server, which means no server-side
validation, no server-rendered protected page, and a signed-out flash on every
load. Cookies are what make `requireUser()` possible at all.

The E2E fixture moved with it — see the note at the top of
`tests/e2e/fixtures.ts`.

### The cookies are not `httpOnly`

The issue asks for httpOnly "where the framework allows". It does not, here, and
the reason is structural rather than an oversight: the **browser** Supabase
client reads the same cookies through `document.cookie` to attach tokens to its
own requests and to refresh them before they expire. Mark them `httpOnly` and
the browser silently loses its session.

`shared/auth/cookies.ts` carries the full note, and a unit test asserts the flag
is absent so that setting it is a red test rather than a silent outage.

**The alternative, if this is ever judged insufficient**: the browser never
holds a token at all, and every Supabase call is proxied through Nitro routes
with the session in a server-only cookie. That is a real option and a real
commitment — it shapes every data-reading feature after this one, starting with
issue #7 — so it is written down here rather than half-taken. What is done in
the meantime: `sameSite=lax`, `secure` on https, and no token in any log, URL or
analytics event.

### `user_id` is derived, never accepted

`requireUser(event)` is the only sanctioned way a handler learns who is calling.
No handler reads a `user_id` from a query string, a body, or a header — see
`server/api/user-settings.get.ts`, which is the worked example.

Two tests hold that: `tests/integration/session-scoping.test.ts` at the data
layer, and `tests/e2e/authentication.spec.ts` against the running server. They
prove different things and both are needed — the E2E test proves *this* handler
does not read a client-supplied id, and the integration test proves it would not
matter if a future one did.

### Route protection defaults to closed

`shared/auth/routes.ts` classifies an unknown path as `protected`. Adding a page
therefore protects it, and opening one up is a deliberate edit. `routes.test.ts`
additionally walks `navGroups` and asserts every navigable route requires a
session, so a nav entry added without thought is covered too.

`/reset-password` is `public` rather than `guest-only` on purpose: the visitor
arriving there **is** authenticated, by a recovery session, and the guest-only
rule would bounce them to the dashboard one step short of the password they came
to set.

### Emailed links land on a server route

`/auth/confirm` is a Nitro route, not a page, so the session cookie is set by the
response that redirects onward. It accepts both shapes an email link can take:

- `?token_hash=…&type=…` — Supabase's recommended form. Works when the link is
  opened on a different device from the one that asked. **Needs a template
  change on the hosted project** (below).
- `?code=…` — what the default templates produce, exchanged against the PKCE
  verifier the requesting browser stored. Works today, in that browser only.

Every failure redirects to `/auth/error`, which explains nothing. A used link, an
expired one, and one opened in the wrong browser are the same message, because
distinguishing them tells whoever holds the link something about the account.

### Rate limiting is GoTrue's

Runway has **no auth endpoint of its own** — the forms call GoTrue directly. The
limits are `[auth.rate_limit]` in `supabase/config.toml` for the local stack and
the dashboard equivalents for the hosted project.
`tests/integration/auth-rate-limit.test.ts` pins the local values so they cannot
be quietly removed; it deliberately does not exhaust the limit, because the limit
is per IP over five minutes and every other suite signs in.

---

## Configuration

Two variables, both public, both runtime rather than build-time — see
`.env.example` and the note in `nuxt.config.ts`:

```
NUXT_PUBLIC_SUPABASE_URL
NUXT_PUBLIC_SUPABASE_ANON_KEY
```

The anon/publishable key reaches the browser by design. It identifies the
project, not a person; RLS is what protects the data. The **service-role** key
is a different thing entirely — `BYPASSRLS`, server-only, and still with no
reader in this codebase.

Missing configuration fails at boot with an error naming both variables, rather
than rendering a sign-in form that can never work.

Local development: `supabase start` prints the local URL and key. See
[`database/local-development.md`](./database/local-development.md).

---

## What a human still has to do on the hosted project

None of the following can be done from this repository, and none of it is done.

1. **Set the two environment variables** on the deploy target (Netlify:
   Site configuration → Environment variables). Nothing in `nuxt.config.ts`
   reads `process.env`, so these apply at runtime with no rebuild.
2. **Add the redirect URLs to the allow-list** (Authentication → URL
   Configuration): the site URL, and `<origin>/auth/confirm` for production and
   for any preview domain. Supabase refuses to redirect anywhere else, which is
   what keeps `emailRedirectTo` from being an open redirect.
3. **Turn on email confirmation** for sign-up. The local stack runs with it off
   so the E2E suite can complete a sign-up without a mailbox;
   `useAuthActions().signUp` handles both, but a real project should confirm.
4. **Configure SMTP.** Supabase's built-in sender is rate-limited to a handful of
   messages an hour and is not for production. Without it, password reset and
   magic links do not arrive.
5. **Switch the email templates to `{{ .TokenHash }}`**, pointing at
   `<origin>/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=…`. The
   `code` path works with the default templates, but only in the browser that
   requested the link — a link opened in a mail client's own browser, or on a
   phone after asking on a laptop, fails. See the recovery and magic-link
   templates.
6. **Set the password policy** to match `shared/auth/password.ts` — minimum
   length 8. The local stack is held to it by a test; the hosted project is not
   reachable from one.
7. **Review the auth rate limits** in the dashboard against
   `[auth.rate_limit]` in `supabase/config.toml`.
8. **Apply the migrations.** `supabase db push` is a deliberate human act
   performed outside this repo's scripts — see `supabase/config.toml`. The
   trigger in `*_user_settings_on_signup.sql` is what gives a new account its
   settings row; without it, sign-up succeeds and `/api/user-settings` returns
   `null`.
