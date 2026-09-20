import { useState, useEffect, useRef } from 'react'

function write(key, value) {
  try {
    if (value !== undefined) {
      window.sessionStorage.setItem(key, JSON.stringify(value))
    } else {
      window.sessionStorage.removeItem(key)
    }
  } catch {
    // Ignore quota exceeded or private mode restrictions
  }
}

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

  // The home page keeps six of these, each holding a full movie array, and one
  // page load flips several of them in the same tick. Writing on every change
  // meant several synchronous JSON.stringify passes on the main thread while
  // the page was still painting. The write is deferred so a burst coalesces,
  // and flushed on unmount so navigating away never loses the cached value.
  const timer = useRef(null)
  const pending = useRef(false)
  const latest = useRef(state)

  useEffect(() => {
    latest.current = state
    pending.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      pending.current = false
      write(key, latest.current)
    }, 120)

    return () => clearTimeout(timer.current)
  }, [key, state])

  useEffect(() => {
    return () => {
      if (pending.current) write(key, latest.current)
    }
  }, [key])

  return [state, setState]
}
