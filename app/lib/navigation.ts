import { ArrowLeftRight, Calculator, House, Landmark, Repeat } from '@lucide/vue'
import type { Component } from 'vue'

/**
 * The single source of truth for app navigation.
 *
 * Both the sidebar menu (app/components/AppSidebar.vue) and the breadcrumb
 * header (app/layouts/default.vue) read from here. Adding a route means
 * adding an entry here AND creating the matching file in app/pages/ — there
 * is deliberately no second route -> label mapping anywhere in the codebase.
 *
 * This module is pure TypeScript: no Nuxt imports, no composables, no runtime
 * side effects. It is unit-tested in a plain node environment.
 */

export type NavGroupId = 'my-money' | 'account'

export interface NavItem {
  /** Stable identifier, unique across every group. Safe to use as a v-for key. */
  readonly id: string
  /** Rendered in the sidebar, as the `tooltip` when collapsed, and as breadcrumb level 2. */
  readonly title: string
  /** Route path. Must correspond to a file in app/pages/. */
  readonly path: string
  /** Lucide icon component. The only thing the sidebar shows in icon-collapsed state. */
  readonly icon: Component
}

export interface NavGroup {
  readonly id: NavGroupId
  /** Rendered as SidebarGroupLabel and as breadcrumb level 1. */
  readonly label: string
  readonly items: readonly NavItem[]
}

export const navGroups: readonly NavGroup[] = [
  {
    id: 'my-money',
    label: 'My money',
    items: [
      { id: 'home', title: 'Home', path: '/', icon: House },
      { id: 'will-i-make-it', title: 'Will I Make It?', path: '/will-i-make-it', icon: Calculator },
      { id: 'recurring-items', title: 'Recurring Items', path: '/recurring-items', icon: Repeat },
      { id: 'transfers', title: 'Transfers', path: '/transfers', icon: ArrowLeftRight },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [{ id: 'accounts', title: 'Accounts', path: '/accounts', icon: Landmark }],
  },
] as const

export interface BreadcrumbTrail {
  /** Breadcrumb level 1 — the nav group. Rendered non-interactively. */
  readonly groupLabel: string
  /** Breadcrumb level 2 — the current page. */
  readonly pageTitle: string
}

/** Strips a trailing slash so `/accounts/` and `/accounts` resolve identically. */
export function normalizeNavPath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

export function findNavGroupByPath(path: string): NavGroup | null {
  const target = normalizeNavPath(path)
  return navGroups.find((group) => group.items.some((item) => item.path === target)) ?? null
}

export function findNavItemByPath(path: string): NavItem | null {
  const target = normalizeNavPath(path)
  for (const group of navGroups) {
    const item = group.items.find((candidate) => candidate.path === target)
    if (item) return item
  }
  return null
}

/** Returns null for any path not in the nav — callers should hide the breadcrumb. */
export function resolveBreadcrumbs(path: string): BreadcrumbTrail | null {
  const group = findNavGroupByPath(path)
  const item = findNavItemByPath(path)
  if (!group || !item) return null
  return { groupLabel: group.label, pageTitle: item.title }
}
