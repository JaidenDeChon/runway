<script setup lang="ts">
/**
 * The signed-in user, and the way out.
 *
 * This was a placeholder with a hardcoded "Jordan Rivers" waiting on issue #6.
 * It now reads `useAuthUser()`, which is filled during server-side rendering
 * from a validated session — so the correct name is in the first HTML the
 * browser receives, not swapped in after hydration.
 *
 * Account and Settings stay inert. They are screens that do not exist yet
 * (`user_settings` has no editor — see `docs/database/schema.md`), and this
 * issue's scope is authentication, not building them. They are disabled rather
 * than removed so the menu keeps the shape the design gave it, and so a click
 * does nothing visible instead of navigating to a 404.
 */

import { BadgeCheck, ChevronsUpDown, LogOut, Settings } from '@lucide/vue'
import { computed, ref } from 'vue'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

const { isMobile } = useSidebar()
const user = useAuthUser()
const { signOut } = useAuthActions()

const signingOut = ref(false)

/**
 * A rendered fallback for the moment before the session resolves, so the
 * sidebar does not collapse and reflow. Never a real person's details.
 */
const displayName = computed(() => user.value?.displayName ?? 'Signed in')
const email = computed(() => user.value?.email ?? '')
const initials = computed(() => user.value?.initials ?? '·')

async function onSignOut(): Promise<void> {
  if (signingOut.value) return
  signingOut.value = true
  try {
    await signOut()
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Avatar class="size-8 rounded-lg">
              <AvatarFallback class="rounded-lg">{{ initials }}</AvatarFallback>
            </Avatar>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-medium">{{ displayName }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ email }}</span>
            </div>
            <ChevronsUpDown class="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="w-(--reka-dropdown-menu-trigger-width) min-w-56 rounded-lg"
          :side="isMobile ? 'bottom' : 'right'"
          align="end"
          :side-offset="4"
        >
          <DropdownMenuLabel class="p-0 font-normal">
            <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar class="size-8 rounded-lg">
                <AvatarFallback class="rounded-lg">{{ initials }}</AvatarFallback>
              </Avatar>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-medium">{{ displayName }}</span>
                <span class="truncate text-xs text-muted-foreground">{{ email }}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled>
              <BadgeCheck />
              Account
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Settings />
              Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="signingOut" @select="onSignOut">
            <LogOut />
            {{ signingOut ? 'Signing out…' : 'Log out' }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
