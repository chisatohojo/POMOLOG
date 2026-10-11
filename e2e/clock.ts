import type { Page } from '@playwright/test'

export async function installPausedClock(page: Page, time: Date): Promise<void> {
  // Install earlier on the blank page so RPC latency cannot put pauseAt in the past.
  await page.clock.install({ time: new Date(time.getTime() - 60_000) })
  await page.clock.pauseAt(time)
}
