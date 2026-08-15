import { describe, expect, it } from 'vitest'
import { findNavGroupByPath, findNavItemByPath, navGroups, resolveBreadcrumbs } from './navigation'

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
