<script setup lang="ts">
import { Rocket } from '@lucide/vue'
import AppUserMenu from '@/components/AppUserMenu.vue'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { navGroups } from '@/lib/navigation'

const route = useRoute()

// On mobile the sidebar is an overlay Sheet, so navigating without closing it
// leaves the destination hidden behind the menu. Desktop has no overlay and
// `openMobile` is inert there, so this needs no `isMobile` guard.
const { setOpenMobile } = useSidebar()
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child tooltip="Runway">
            <NuxtLink to="/" @click="setOpenMobile(false)">
              <div
                class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
              >
                <Rocket class="size-4" />
              </div>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-medium">Runway</span>
                <span class="truncate text-xs text-muted-foreground">Personal cash flow</span>
              </div>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup v-for="group in navGroups" :key="group.id">
        <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in group.items" :key="item.id">
              <SidebarMenuButton as-child :tooltip="item.title" :is-active="route.path === item.path">
                <NuxtLink :to="item.path" @click="setOpenMobile(false)">
                  <component :is="item.icon" />
                  <span>{{ item.title }}</span>
                </NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <AppUserMenu />
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
