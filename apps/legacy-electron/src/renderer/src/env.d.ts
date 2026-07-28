/// <reference types="vite/client" />

import type { AnvilApi } from '../../preload/index'

declare global {
  interface Window {
    anvil: AnvilApi
  }
}

export {}
