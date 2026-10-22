'use client'

import { usePhotoStrip } from '@/context/photo-strip-context'
import { useState } from 'react'

/**
 * Photo Strip Editor V1
 *
 * Displays captured photos in a photobooth strip layout with:
 * - Vertical stack of 4 photos
 * - Background color options
 * - Strip style presets
 * - Real-time preview
 * - Back button to return to capture
 * - Export to PNG with selected styling
 * - Share via Web Share API (with graceful fallback)
 *
 * Photos stay in React context during the session.
 * Object URLs remain valid while component is mounted.
 * All processing is client-side; no photos are uploaded or shared externally.
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

/**
 * Renders the photo strip onto a canvas and resolves with the resulting PNG Blob.
 * Shared by both download and share paths so both actions produce identical output.
 */
async function buildPhotoStripBlob(
  photos: Array<{ objectUrl: string }>,
  backgroundColor: string,
  stripStyle: 'plain' | 'polaroid' | 'retro'
): Promise<Blob> {
  // High resolution export: 1080px width, 4:3 aspect ratio × 4 photos
  const PHOTO_WIDTH = 1080
  const PHOTO_HEIGHT = 810 // 4:3 aspect ratio

  // Style configuration at export resolution
  const styles = {
    plain: {
      photoGap: 24,
      containerPadding: 0,
      containerBorder: 0,
      photoBorder: 0,
    },
    polaroid: {
      photoGap: 32,
      containerPadding: 0,
      containerBorder: 0,
      photoBorder: 0,
    },
    retro: {
      photoGap: 24,
      containerPadding: 32,
      containerBorder: 16,
      photoBorder: 8,
    },
  }

  const style = styles[stripStyle]
  const totalWidth = PHOTO_WIDTH + style.containerPadding * 2
  const totalHeight =
    PHOTO_HEIGHT * 4 +
    style.photoGap * 3 +
    (stripStyle === 'polaroid' ? 96 : 0) +
    style.containerPadding * 2 +
    style.containerBorder * 2

  const canvas = document.createElement('canvas')
  canvas.width = totalWidth
  canvas.height = totalHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  // Fill container background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, totalWidth, totalHeight)

  // Draw border if retro style
  if (style.containerBorder > 0) {
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(style.containerBorder, style.containerBorder, totalWidth - style.containerBorder * 2, totalHeight - style.containerBorder * 2)
    ctx.fillStyle = backgroundColor
    ctx.fillRect(
      style.containerBorder + style.containerBorder / 2,
      style.containerBorder + style.containerBorder / 2,
      totalWidth - style.containerBorder * 3,
      totalHeight - style.containerBorder * 3
    )
  }

  // Load and draw each photo
  let currentY = style.containerPadding + style.containerBorder / 2

  for (const photo of photos) {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.crossOrigin = 'anonymous'
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error(`Failed to load photo`))
      element.src = photo.objectUrl
    })

    const currentX = style.containerPadding + style.containerBorder / 2

    // Draw photo border if retro
    if (style.photoBorder > 0) {
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(currentX, currentY, PHOTO_WIDTH, PHOTO_HEIGHT)
    }

    // Draw photo with aspect ratio preservation
    ctx.drawImage(img, currentX + style.photoBorder, currentY + style.photoBorder, PHOTO_WIDTH - style.photoBorder * 2, PHOTO_HEIGHT - style.photoBorder * 2)

    currentY += PHOTO_HEIGHT + style.photoGap
  }

  // Convert canvas to Blob
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Canvas export failed'))
      else resolve(blob)
    }, 'image/png')
  })
}

/** Returns true when the browser supports sharing PNG files via the Web Share API. */
function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) {
    return false
  }
  try {
    const probe = new File([''], 'probe.png', { type: 'image/png' })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

export function PhotoStripEditor({ onBack }: { onBack: () => void }) {
  const { photos, backgroundColor, setBackgroundColor, stripStyle, setStripStyle } =
    usePhotoStrip()
  const [isExporting, setIsExporting] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [shareMessage, setShareMessage] = useState<string | null>(null)

  const isBusy = isExporting || isSharing

  const handleExport = async () => {
    setIsExporting(true)
    setExportError(null)
    setShareMessage(null)
    try {
      const blob = await buildPhotoStripBlob(photos, backgroundColor, stripStyle)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'photobooth-strip.png'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  const handleShare = async () => {
    setIsSharing(true)
    setExportError(null)
    setShareMessage(null)
    try {
      const blob = await buildPhotoStripBlob(photos, backgroundColor, stripStyle)
      const file = new File([blob], 'photobooth-strip.png', { type: 'image/png' })
      await navigator.share({
        files: [file],
        title: 'My Photo Strip',
      })
    } catch (err) {
      // AbortError means the user dismissed the share sheet — not an error
      if (err instanceof Error && err.name === 'AbortError') {
        // do nothing
      } else {
        setExportError(err instanceof Error ? err.message : 'Share failed')
      }
    } finally {
      setIsSharing(false)
    }
  }

  const fileShareSupported = canShareFiles()

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
      <div className="w-full flex flex-col gap-3">
        <div className="flex gap-3 pt-4">
          <button
            onClick={onBack}
            className="flex-1 px-6 py-3 rounded-lg border border-[var(--border-active)] text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors font-medium"
          >
            ← Back
          </button>

          {/* Download PNG */}
          <button
            onClick={handleExport}
            disabled={isBusy}
            className="flex-1 px-6 py-3 rounded-lg bg-[var(--surface)] border border-[var(--border-active)] text-[var(--text-primary)] font-semibold hover:bg-[var(--canvas)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Download photo strip as PNG"
          >
            {isExporting ? 'Exporting…' : 'Download'}
          </button>

          {/* Share — only shown when Web Share API with file support is available */}
          {fileShareSupported && (
            <button
              onClick={handleShare}
              disabled={isBusy}
              className="flex-1 px-6 py-3 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Share photo strip"
            >
              {isSharing ? 'Sharing…' : 'Share'}
            </button>
          )}
        </div>

        {/* Fallback message when file sharing is unsupported */}
        {!fileShareSupported && (
          <p className="text-xs text-[var(--text-secondary)] text-center leading-relaxed">
            Download the PNG then share it from your device — your browser doesn&apos;t support direct file sharing yet.
          </p>
        )}

        {/* Share success message */}
        {shareMessage && (
          <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm text-center">
            {shareMessage}
          </div>
        )}

        {/* Error message (export or share) */}
        {exportError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {exportError}
          </div>
        )}
      </div>

      {/* Info Text */}
      <p className="text-xs text-[var(--text-tertiary)] text-center">
        High-resolution PNG — ready to share or print.
      </p>
    </div>
  )
}
