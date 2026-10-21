import { useEffect, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'nsi-theme'
const listeners = new Set<() => void>()

function detect(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let current: Theme = detect()
let applied = false

function apply(theme: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  applied = true
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setTheme(theme: Theme) {
  current = theme
  apply(theme)
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* storage can be unavailable in private contexts */
  }
  listeners.forEach((l) => l())
}

// Apply once on module load so the first paint matches the stored preference.
if (!applied && typeof document !== 'undefined') apply(current)

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => 'light' as Theme,
  )

  useEffect(() => {
    apply(theme)
  }, [theme])

  return {
    theme,
    isDark: theme === 'dark',
    toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    set: setTheme,
  }
}
