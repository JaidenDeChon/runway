import { describe, expect, it } from 'vitest'
import {
  findNavGroupByPath,
  findNavItemByPath,
  navGroups,
  normalizeNavPath,
  resolveBreadcrumbs,
} from './navigation'

describe('navigation', () => {
  it('has the groups in order: "My money", then "Account"', () => {
    expect(navGroups.map((group) => group.id)).toEqual(['my-money', 'account'])
    expect(navGroups.map((group) => group.label)).toEqual(['My money', 'Account'])
  })

  it('has unique item ids across all groups', () => {
    const ids = navGroups.flatMap((group) => group.items.map((item) => item.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique item paths across all groups', () => {
    const paths = navGroups.flatMap((group) => group.items.map((item) => item.path))
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('gives every item a non-empty title', () => {
    for (const group of navGroups) {
      for (const item of group.items) {
        expect(item.title.length).toBeGreaterThan(0)
      }
    }
  })

  it('gives every item an icon', () => {
    for (const group of navGroups) {
      for (const item of group.items) {
        expect(item.icon).toBeDefined()
      }
    }
  })

  it('gives every item an absolute path with no trailing slash', () => {
    for (const group of navGroups) {
      for (const item of group.items) {
        expect(item.path.startsWith('/')).toBe(true)
        if (item.path !== '/') {
          expect(item.path.endsWith('/')).toBe(false)
        }
      }
    }
  })

  it('resolves every item back to its own group via findNavGroupByPath and findNavItemByPath', () => {
    for (const group of navGroups) {
      for (const item of group.items) {
        expect(findNavGroupByPath(item.path)?.id).toBe(group.id)
        expect(findNavItemByPath(item.path)?.id).toBe(item.id)
      }
    }
  })

  it('resolves the exact breadcrumb trail for /', () => {
    expect(resolveBreadcrumbs('/')).toEqual({ groupLabel: 'My money', pageTitle: 'Home' })
  })

  it('resolves the exact breadcrumb trail for /accounts', () => {
    expect(resolveBreadcrumbs('/accounts')).toEqual({
      groupLabel: 'Account',
      pageTitle: 'Accounts',
    })
  })

  it('resolves the exact breadcrumb trail for /recurring-items', () => {
    expect(resolveBreadcrumbs('/recurring-items')).toEqual({
      groupLabel: 'My money',
      pageTitle: 'Recurring Items',
    })
  })

  it('tolerates a trailing slash, resolving /accounts/ the same as /accounts', () => {
    expect(resolveBreadcrumbs('/accounts/')).toEqual(resolveBreadcrumbs('/accounts'))
    expect(findNavItemByPath('/accounts/')?.id).toBe('accounts')
    expect(findNavGroupByPath('/accounts/')?.id).toBe('account')
  })

  it('returns null for an unknown path', () => {
    expect(resolveBreadcrumbs('/does-not-exist')).toBeNull()
    expect(findNavGroupByPath('/does-not-exist')).toBeNull()
    expect(findNavItemByPath('/does-not-exist')).toBeNull()
  })
})

/**
 * The trailing-slash rule on its own.
 *
 * `resolveBreadcrumbs('/accounts/')` above proves the tolerance end to end, but
 * it cannot reach the case the guard exists for: the root path is *entirely* a
 * trailing slash, and stripping it would leave `''`, which matches no nav item
 * and would take the breadcrumb off the home page. The `path.length > 1` half of
 * that condition has no other test.
 */
describe('normalizeNavPath', () => {
  it('leaves the root path alone', () => {
    expect(normalizeNavPath('/')).toBe('/')
    expect(findNavItemByPath('/')?.id).toBe('home')
  })

  it('strips one trailing slash from a real path', () => {
    expect(normalizeNavPath('/accounts/')).toBe('/accounts')
  })

  it('leaves a path that has none alone', () => {
    expect(normalizeNavPath('/accounts')).toBe('/accounts')
  })

  it('is idempotent, so normalizing twice is normalizing once', () => {
    for (const path of ['/', '/accounts', '/accounts/', '/does-not-exist/']) {
      expect(normalizeNavPath(normalizeNavPath(path))).toBe(normalizeNavPath(path))
    }
  })

  it('strips only the last slash, leaving a deeper path recognisable', () => {
    // Not a route today. It is here so that the day one exists, the helper is
    // known to trim the path rather than flatten it.
    expect(normalizeNavPath('/accounts/checking/')).toBe('/accounts/checking')
  })
})
