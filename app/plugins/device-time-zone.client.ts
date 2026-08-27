/**
 * Tells the app which timezone the device is in, once, after hydration.
 *
 * It has to be after. A server has no device to ask, so it renders with UTC; if
 * the client resolved the real zone *before* hydrating, the two would disagree
 * about what day it is and Vue would report a mismatch on every page. Running on
 * `app:mounted` makes it an ordinary re-render instead: the client renders what
 * the server rendered, then learns something the server could not know.
 *
 * The value is held in app state and never written into the user's data. A
 * resolved zone is a fact about a device — storing it would freeze the first
 * device the user happened to open the app on. See `useTimeZone`.
 */

import { deviceTimeZone, useDeviceTimeZone } from '@/composables/useTimeZone'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => {
    const device = useDeviceTimeZone()
    const resolved = deviceTimeZone()
    if (resolved && resolved !== device.value) device.value = resolved
  })
})
