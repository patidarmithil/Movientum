import { useState, useEffect } from 'react'

export function useSessionState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const item = window.sessionStorage.getItem(key)
      if (item !== null) {
        return JSON.parse(item)
      }
      return typeof initialValue === 'function' ? initialValue() : initialValue
    } catch {
      return typeof initialValue === 'function' ? initialValue() : initialValue
    }
  })

  useEffect(() => {
    try {
      if (state !== undefined) {
        window.sessionStorage.setItem(key, JSON.stringify(state))
      } else {
        window.sessionStorage.removeItem(key)
      }
    } catch {
      // Ignore quota exceeded or private mode restrictions
    }
  }, [key, state])

  return [state, setState]
}
