import Link from 'next/link'

/**
 * Room Page - /room/[code]
 *
 * V1 minimal placeholder for room session view.
 * Shows room code and confirms successful room creation.
 *
 * Future phases will add:
 * - Camera setup and photo capture
 * - Photo editor with filters/stickers/layouts
 * - Real-time collaboration (V1.5)
 * - Download functionality
 */

interface RoomPageProps {
  params: Promise<{
    code: string
  }>
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { code } = await params

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 sm:px-12 md:px-24">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        {/* Room Status */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M9 16L14 21L23 11"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold">Room Created</h1>
            <p className="text-[var(--text-secondary)]">
              Your photobooth room is ready
            </p>
          </div>
        </div>

        {/* Room Code Display */}
        <div className="w-full flex flex-col items-center gap-3 p-6 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
            Room Code
          </span>
          <div className="text-4xl font-bold tracking-wider font-mono">
            {code}
          </div>
          <p className="text-sm text-[var(--text-secondary)] text-center">
            Share this code with a friend to start capturing photos together
          </p>
        </div>

        {/* Placeholder Notice */}
        <div className="w-full p-4 rounded-lg bg-[var(--surface)] border border-[var(--border-active)]">
          <p className="text-sm text-[var(--text-secondary)] text-center">
            <span className="font-semibold text-[var(--text-primary)]">
              Coming soon:
            </span>{' '}
            Camera setup, photo capture, and editing features
          </p>
        </div>

        {/* Back to Home */}
        <Link
          href="/"
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors underline underline-offset-4"
        >
          ← Back to home
        </Link>
      </div>
    </main>
  )
}
