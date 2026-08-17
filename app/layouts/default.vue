<script setup lang="ts">
import AppSidebar from '@/components/AppSidebar.vue'
import AppThemeToggle from '@/components/AppThemeToggle.vue'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { resolveBreadcrumbs } from '@/lib/navigation'

const route = useRoute()
const crumbs = computed(() => resolveBreadcrumbs(route.path))

// SSR safety: SidebarProvider's own `defaultOpen` default is
// `!defaultDocument?.cookie.includes('sidebar_state=false')`, which evaluates
// to `true` on the server (no document) but can be `false` on the client.
// For a user who has collapsed the sidebar, that is a guaranteed hydration
// mismatch. Reading the cookie via Nuxt's SSR-aware useCookie and passing it
// explicitly makes both sides agree. SidebarProvider still owns writing the
// cookie back on toggle, so do not also v-model it.
const sidebarOpen = useCookie<boolean>('sidebar_state', { default: () => true })
</script>

<template>
  <SidebarProvider :default-open="sidebarOpen">
    <AppSidebar />
    <SidebarInset>
      <header
        class="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
      >
        <div class="flex w-full items-center gap-2 px-4">
          <SidebarTrigger class="-ml-1" />
          <Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb v-if="crumbs">
            <BreadcrumbList>
              <BreadcrumbItem class="hidden md:block">
                <BreadcrumbPage class="text-muted-foreground">{{ crumbs.groupLabel }}</BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbSeparator class="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{{ crumbs.pageTitle }}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <span class="ml-auto shrink-0 text-sm font-semibold tracking-tight">Runway</span>
          <AppThemeToggle />
        </div>
      </header>
      <div class="flex flex-1 flex-col gap-4 p-4">
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
