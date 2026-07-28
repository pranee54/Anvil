import type { AnvilApi } from './index'

declare global {
  interface Window {
    anvil: AnvilApi
  }
}

export {}
