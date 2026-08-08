import { useEffect, useRef, useState } from 'react'
import { loadGoogleIdentity } from '../utils/googleIdentity'
import './GoogleSignInButton.css'

/**
 * GoogleSignInButton — renders Google's own GIS button (never a custom-styled
 * one — that would violate Google's branding requirements).
 *
 * Props:
 *   onSuccess(credential) — called with the raw Google ID token string
 *   text — 'signin_with' | 'signup_with'
 */
export default function GoogleSignInButton({ onSuccess, text = 'signin_with' }) {
  const divRef = useRef(null)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!clientId) { setFailed(true); return }
    let cancelled = false
    loadGoogleIdentity()
      .then((gid) => {
        if (cancelled || !divRef.current) return
        gid.initialize({
          client_id: clientId,
          callback: (resp) => onSuccess(resp.credential),
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
        })
        gid.renderButton(divRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text,
          width: 360,
          logo_alignment: 'left',
        })
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [clientId, text, onSuccess])

  if (failed) return null   // never show a broken button; the password form still works
  return <div className="google-signin" ref={divRef} aria-label="Sign in with Google" />
}
