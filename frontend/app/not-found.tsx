import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6">
      <div className="panel max-w-md p-8 text-center">
        <span className="text-4xl" aria-hidden>🌾</span>
        <h2 className="mt-4 font-display text-xl font-semibold">Nothing grows here</h2>
        <p className="mt-2 text-sm text-text-secondary">
          That page does not exist.
        </p>
        <Link href="/" className="btn-primary mt-5">Back to the farm</Link>
      </div>
    </div>
  )
}
