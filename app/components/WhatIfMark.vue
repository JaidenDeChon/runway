<script setup lang="ts">
/**
 * The what-if mark: a dashed, rounded square with a question mark inside —
 * "a hypothetical", drawn. Lucide has `square-dashed` and
 * `circle-question-mark` but no combination of the two, so this is their
 * paths composed on Lucide's 24-unit grid with its stroke conventions, and it
 * sizes and colours like any other Lucide icon (`size-*`, `currentColor`).
 *
 * Always decorative: every place it appears also says "What-if" in words.
 */
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    data-slot="what-if-mark"
  >
    <!-- square-dashed -->
    <path d="M5 3a2 2 0 0 0-2 2" />
    <path d="M19 3a2 2 0 0 1 2 2" />
    <path d="M21 19a2 2 0 0 1-2 2" />
    <path d="M5 21a2 2 0 0 1-2-2" />
    <path d="M9 3h1" />
    <path d="M9 21h1" />
    <path d="M14 3h1" />
    <path d="M14 21h1" />
    <path d="M3 9v1" />
    <path d="M21 9v1" />
    <path d="M3 14v1" />
    <path d="M21 14v1" />
    <!-- the question mark from circle-question-mark -->
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
</template>
