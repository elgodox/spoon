import type { SpoonAPI } from './index'

declare global {
  interface Window {
    spoon: SpoonAPI
  }
}

export {}
