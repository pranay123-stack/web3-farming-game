'use client'

import { useEffect } from 'react'

/**
 * Route-level error boundary. Renders a recoverable state rather than a blank
 * page when a client component throws.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app] unhandled error', error)
  }, [error])

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6">
      <div className="panel max-w-md p-8 text-center">
        <span className="text-4xl" aria-hidden>🌧️</span>
        <h2 className="mt-4 font-display text-xl font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          The page hit an unexpected error. Your farm is safe — everything you
          own lives on-chain, not in this tab.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-text-muted">ref: {error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={reset} className="btn-primary">Try again</button>
          <a href="/" className="btn-secondary">Go home</a>
        </div>
      </div>
    </div>
  )
}
