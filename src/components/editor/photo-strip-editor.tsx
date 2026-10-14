'use client'

import { usePhotoStrip } from '@/context/photo-strip-context'

/**
 * Photo Strip Editor V1
 *
 * Displays captured photos in a photobooth strip layout with:
 * - Vertical stack of 4 photos
 * - Background color options
 * - Strip style presets
 * - Real-time preview
 * - Back button to return to capture
 *
 * Photos stay in React context during the session.
 * Object URLs remain valid while component is mounted.
 */

interface BackgroundOption {
  label: string
  value: string
  hex: string
}

interface StripStyleOption {
  label: string
  value: 'plain' | 'polaroid' | 'retro'
  description: string
}

const BACKGROUND_OPTIONS: BackgroundOption[] = [
  { label: 'White', value: 'white', hex: '#ffffff' },
  { label: 'Black', value: 'black', hex: '#000000' },
  { label: 'Cream', value: 'cream', hex: '#faf8f3' },
  { label: 'Mint', value: 'mint', hex: '#d4f1f0' },
  { label: 'Rose', value: 'rose', hex: '#fde8e8' },
]

const STRIP_STYLES: StripStyleOption[] = [
  {
    label: 'Clean',
    value: 'plain',
    description: 'Minimal spacing, modern look',
  },
  {
    label: 'Polaroid',
    value: 'polaroid',
    description: 'Larger bottom margin, nostalgic',
  },
  {
    label: 'Retro',
    value: 'retro',
    description: 'Colored borders, film strip style',
  },
]

export function PhotoStripEditor({ onBack }: { onBack: () => void }) {
  const { photos, backgroundColor, setBackgroundColor, stripStyle, setStripStyle } =
    usePhotoStrip()

  if (photos.length !== 4) {
    return (
      <div className="w-full flex flex-col items-center justify-center gap-4 py-12">
        <p className="text-[var(--text-secondary)]">No photos loaded</p>
        <button
          onClick={onBack}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors underline underline-offset-4"
        >
          ← Back
        </button>
      </div>
    )
  }

  // Determine spacing and styling based on stripStyle
  const getStripClasses = () => {
    switch (stripStyle) {
      case 'polaroid':
        return 'gap-4 pb-12'
      case 'retro':
        return 'gap-3 p-4 border-4 border-gray-900'
      default:
        return 'gap-3'
    }
  }

  const getPhotoClasses = () => {
    switch (stripStyle) {
      case 'retro':
        return 'border-2 border-gray-900'
      default:
        return ''
    }
  }

  return (
    <div className="w-full flex flex-col items-center gap-8">
      {/* Preview Section */}
      <div className="w-full max-w-sm flex flex-col items-center">
        {/* Title */}
        <div className="mb-4">
          <h2 className="text-xl font-bold text-center">Photo Strip</h2>
          <p className="text-sm text-[var(--text-secondary)] text-center mt-1">
            Customize your strip
          </p>
        </div>

        {/* Photo Strip Preview */}
        <div
          className={`w-full rounded-lg overflow-hidden flex flex-col items-center ${getStripClasses()}`}
          style={{
            backgroundColor: backgroundColor,
          }}
        >
          {photos.map((photo, index) => (
            <div
              key={photo.objectUrl}
              className={`w-full aspect-[4/3] rounded overflow-hidden bg-[var(--canvas)] flex-shrink-0 ${getPhotoClasses()}`}
            >
              <img
                src={photo.objectUrl}
                alt={`Photo ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Background Color Options */}
      <div className="w-full flex flex-col gap-3">
        <label className="text-sm font-medium text-[var(--text-primary)]">
          Background
        </label>
        <div className="grid grid-cols-5 gap-2">
          {BACKGROUND_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setBackgroundColor(option.hex)}
              className={`py-3 px-2 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                backgroundColor === option.hex
                  ? 'border-[var(--primary)]'
                  : 'border-[var(--border)] hover:border-[var(--border-active)]'
              }`}
              title={option.label}
            >
              <div
                className="w-8 h-8 rounded border border-[var(--border)]"
                style={{ backgroundColor: option.hex }}
              />
              <span className="text-xs text-[var(--text-secondary)]">
                {option.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Strip Style Options */}
      <div className="w-full flex flex-col gap-3">
        <label className="text-sm font-medium text-[var(--text-primary)]">
          Style
        </label>
        <div className="grid grid-cols-3 gap-3">
          {STRIP_STYLES.map((style) => (
            <button
              key={style.value}
              onClick={() => setStripStyle(style.value)}
              className={`py-4 px-3 rounded-lg border-2 transition-all flex flex-col items-center text-center ${
                stripStyle === style.value
                  ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                  : 'border-[var(--border)] hover:border-[var(--border-active)]'
              }`}
            >
              <span className="font-medium text-sm">{style.label}</span>
              <span className="text-xs text-[var(--text-secondary)] mt-1">
                {style.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="w-full flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="flex-1 px-6 py-3 rounded-lg border border-[var(--border-active)] text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors font-medium"
        >
          ← Back
        </button>
        <button
          className="flex-1 px-6 py-3 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          disabled
        >
          Download
        </button>
      </div>

      {/* Info Text */}
      <p className="text-xs text-[var(--text-tertiary)] text-center">
        Download feature coming soon. Your strip is ready to customize.
      </p>
    </div>
  )
}
