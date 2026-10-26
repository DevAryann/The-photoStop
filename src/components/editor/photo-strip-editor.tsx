'use client'

import {
  CAPTION_MAX_LENGTH,
  MAX_STICKERS,
  usePhotoStrip,
  type PhotoFilter,
  type PhotoStripSticker,
} from '@/context/photo-strip-context'
import { useMemo, useState } from 'react'

/**
 * Photo Strip Editor V1
 *
 * Displays captured photos in a photobooth strip layout with:
 * - Vertical stack of 4 photos
 * - Reversible photo filter presets
 * - Background color options
 * - Strip style presets
 * - Built-in emoji stickers and an optional bottom caption
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

interface FilterOption {
  label: string
  value: PhotoFilter
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

const FILTER_OPTIONS: FilterOption[] = [
  { label: 'Original', value: 'original' },
  { label: 'Vintage', value: 'vintage' },
  { label: 'Grayscale', value: 'grayscale' },
  { label: 'Warm', value: 'warm' },
]

// Reused by the DOM preview and Canvas renderer so every output gets the same grade.
const PHOTO_FILTER_CSS: Record<PhotoFilter, string> = {
  original: 'none',
  vintage: 'sepia(35%) saturate(85%) contrast(92%) brightness(106%)',
  grayscale: 'grayscale(100%)',
  warm: 'sepia(18%) saturate(118%) hue-rotate(-8deg) brightness(103%)',
}

const STICKER_OPTIONS = [
  { label: 'Heart', emoji: '❤️' },
  { label: 'Star', emoji: '⭐' },
  { label: 'Sparkle', emoji: '✨' },
  { label: 'Flower', emoji: '🌸' },
  { label: 'Smiley', emoji: '😊' },
]

// Decoration coordinates and typography are shared by the SVG preview and PNG canvas.
const PHOTO_WIDTH = 1080
const PHOTO_HEIGHT = 810 // 4:3 aspect ratio
const STICKER_FONT_SIZE = 120
const EMOJI_FONT_FAMILY = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
const CAPTION_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const CAPTION_FONT_SIZE = 42
const CAPTION_LINE_HEIGHT = 58
const CAPTION_PADDING = 24
const CAPTION_FONT = `500 ${CAPTION_FONT_SIZE}px ${CAPTION_FONT_FAMILY}`

interface CaptionLayout {
  lines: string[]
  height: number
}

function getStickerPlacement(slot: number) {
  const isTopRight = slot < 4
  return {
    photoIndex: slot % 4,
    x: PHOTO_WIDTH * (isTopRight ? 0.89 : 0.11),
    y: PHOTO_HEIGHT * (isTopRight ? 0.15 : 0.85),
    corner: isTopRight ? 'top right' : 'bottom left',
  }
}

function getCaptionLayout(caption: string): CaptionLayout | null {
  const text = caption.trim().replace(/\s+/g, ' ')
  if (!text) return null

  const ctx = typeof document === 'undefined'
    ? null
    : document.createElement('canvas').getContext('2d')
  if (ctx) ctx.font = CAPTION_FONT
  const measure = (value: string) => ctx?.measureText(value).width ?? value.length * CAPTION_FONT_SIZE
  const maxWidth = PHOTO_WIDTH - CAPTION_PADDING * 4
  const lines: string[] = []
  let line = ''

  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = ''
    // Also wrap long words rather than clipping them or shrinking the photos.
    for (const character of word) {
      if (line && measure(line + character) > maxWidth) {
        lines.push(line)
        line = character
      } else {
        line += character
      }
    }
  }
  if (line) lines.push(line)

  return {
    lines,
    height: CAPTION_PADDING * 2 + lines.length * CAPTION_LINE_HEIGHT,
  }
}

function getCaptionColor(backgroundColor: string) {
  return backgroundColor.toLowerCase() === '#000000' ? '#ffffff' : '#1a1a1a'
}

/**
 * Renders the photo strip onto a canvas and resolves with the resulting PNG Blob.
 * Shared by both download and share paths so both actions produce identical output.
 */
async function buildPhotoStripBlob(
  photos: Array<{ objectUrl: string }>,
  backgroundColor: string,
  stripStyle: 'plain' | 'polaroid' | 'retro',
  photoFilter: PhotoFilter,
  stickers: PhotoStripSticker[],
  caption: string
): Promise<Blob> {
  // Keep the existing high-resolution photo dimensions and style settings.
  const captionLayout = getCaptionLayout(caption)

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
    style.containerBorder * 2 +
    (captionLayout ? style.photoGap + captionLayout.height : 0)

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

  for (const [index, photo] of photos.entries()) {
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

    // Filter only the photo pixels; stickers, borders, and captions stay unchanged.
    ctx.save()
    ctx.filter = PHOTO_FILTER_CSS[photoFilter]
    ctx.drawImage(img, currentX + style.photoBorder, currentY + style.photoBorder, PHOTO_WIDTH - style.photoBorder * 2, PHOTO_HEIGHT - style.photoBorder * 2)
    ctx.restore()

    ctx.save()
    ctx.font = `${STICKER_FONT_SIZE}px ${EMOJI_FONT_FAMILY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#1a1a1a'
    for (const sticker of stickers) {
      const placement = getStickerPlacement(sticker.slot)
      if (placement.photoIndex === index) {
        ctx.fillText(sticker.emoji, currentX + placement.x, currentY + placement.y)
      }
    }
    ctx.restore()

    currentY += PHOTO_HEIGHT + style.photoGap
  }

  if (captionLayout) {
    ctx.font = CAPTION_FONT
    ctx.fillStyle = getCaptionColor(backgroundColor)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    captionLayout.lines.forEach((line, index) => {
      ctx.fillText(
        line,
        style.containerPadding + style.containerBorder / 2 + PHOTO_WIDTH / 2,
        currentY + CAPTION_PADDING + CAPTION_FONT_SIZE + index * CAPTION_LINE_HEIGHT
      )
    })
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
  const {
    photos, backgroundColor, setBackgroundColor, stripStyle, setStripStyle,
    photoFilter, setPhotoFilter,
    stickers, addSticker, removeSticker, caption, setCaption,
  } = usePhotoStrip()
  const captionLayout = useMemo(() => getCaptionLayout(caption), [caption])
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
      const blob = await buildPhotoStripBlob(photos, backgroundColor, stripStyle, photoFilter, stickers, caption)
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
      const blob = await buildPhotoStripBlob(photos, backgroundColor, stripStyle, photoFilter, stickers, caption)
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
              className={`relative w-full aspect-[4/3] rounded overflow-hidden bg-[var(--canvas)] flex-shrink-0 ${getPhotoClasses()}`}
            >
              <img
                src={photo.objectUrl}
                alt={`Photo ${index + 1}`}
                className="w-full h-full object-cover"
                style={{ filter: PHOTO_FILTER_CSS[photoFilter] }}
              />
              <svg
                viewBox={`0 0 ${PHOTO_WIDTH} ${PHOTO_HEIGHT}`}
                className="absolute inset-0 w-full h-full pointer-events-none"
                aria-hidden="true"
              >
                {stickers.map((sticker) => {
                  const placement = getStickerPlacement(sticker.slot)
                  return placement.photoIndex === index ? (
                    <text
                      key={sticker.id}
                      x={placement.x}
                      y={placement.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily={EMOJI_FONT_FAMILY}
                      fontSize={STICKER_FONT_SIZE}
                      fill="#1a1a1a"
                    >
                      {sticker.emoji}
                    </text>
                  ) : null
                })}
              </svg>
            </div>
          ))}
          {captionLayout && (
            <svg
              viewBox={`0 0 ${PHOTO_WIDTH} ${captionLayout.height}`}
              width={PHOTO_WIDTH}
              height={captionLayout.height}
              className="w-full h-auto flex-shrink-0"
              role="img"
              aria-label={`Caption: ${caption.trim()}`}
            >
              {captionLayout.lines.map((line, index) => (
                <text
                  key={index}
                  x={PHOTO_WIDTH / 2}
                  y={CAPTION_PADDING + CAPTION_FONT_SIZE + index * CAPTION_LINE_HEIGHT}
                  textAnchor="middle"
                  fontFamily={CAPTION_FONT_FAMILY}
                  fontSize={CAPTION_FONT_SIZE}
                  fontWeight={500}
                  fill={getCaptionColor(backgroundColor)}
                >
                  {line}
                </text>
              ))}
            </svg>
          )}
        </div>
      </div>

      {/* Photo Filter Options */}
      <fieldset className="w-full flex flex-col gap-3">
        <legend className="text-sm font-medium text-[var(--text-primary)] mb-3">
          Filter
        </legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {FILTER_OPTIONS.map((option) => {
            const isActive = photoFilter === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setPhotoFilter(option.value)}
                aria-pressed={isActive}
                className={`min-h-11 p-2 rounded-lg border-2 transition-colors flex flex-col gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${
                  isActive
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                    : 'border-[var(--border)] hover:border-[var(--border-active)]'
                }`}
              >
                <span className="block w-full aspect-[4/3] rounded overflow-hidden bg-[var(--canvas)]" aria-hidden="true">
                  <img
                    src={photos[0].objectUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{ filter: PHOTO_FILTER_CSS[option.value] }}
                  />
                </span>
                <span className="flex items-center justify-between gap-2 px-1">
                  <span className="text-xs font-medium">{option.label}</span>
                  {isActive && (
                    <span className="text-[10px] text-[var(--primary)]" aria-hidden="true">
                      Selected
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

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

      {/* Stickers */}
      <fieldset className="w-full flex flex-col gap-3">
        <legend className="text-sm font-medium text-[var(--text-primary)] mb-3">
          Stickers
        </legend>
        <div className="grid grid-cols-5 gap-2">
          {STICKER_OPTIONS.map((option) => (
            <button
              key={option.emoji}
              type="button"
              onClick={() => addSticker(option.emoji)}
              disabled={stickers.length >= MAX_STICKERS}
              aria-label={`Add ${option.label.toLowerCase()} sticker`}
              aria-describedby="sticker-help"
              className="min-h-11 py-3 px-1 rounded-lg border-2 border-[var(--border)] hover:border-[var(--border-active)] transition-colors flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              <span className="text-2xl" aria-hidden="true">{option.emoji}</span>
              <span className="text-xs text-[var(--text-secondary)]">{option.label}</span>
            </button>
          ))}
        </div>
        <p id="sticker-help" className="text-xs text-[var(--text-secondary)]" role="status">
          {stickers.length === MAX_STICKERS
            ? 'All 8 corners are used. Remove a sticker to add another.'
            : `${stickers.length} of ${MAX_STICKERS} stickers · Added to photo corners.`}
        </p>
        {stickers.length > 0 && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {stickers.map((sticker) => {
              const placement = getStickerPlacement(sticker.slot)
              const label = STICKER_OPTIONS.find((option) => option.emoji === sticker.emoji)?.label ?? 'Emoji'
              return (
                <li key={sticker.id}>
                  <button
                    type="button"
                    onClick={() => removeSticker(sticker.id)}
                    aria-label={`Remove ${label.toLowerCase()} sticker from photo ${placement.photoIndex + 1}, ${placement.corner}`}
                    className="w-full min-h-11 px-3 py-2 rounded-lg border border-[var(--border)] hover:border-[var(--border-active)] transition-colors flex items-center justify-between gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-xl" aria-hidden="true">{sticker.emoji}</span>
                      <span className="text-sm">{label} · Photo {placement.photoIndex + 1}</span>
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]" aria-hidden="true">Remove</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>

      {/* Optional caption */}
      <div className="w-full flex flex-col gap-3">
        <label htmlFor="strip-caption" className="text-sm font-medium text-[var(--text-primary)]">
          Caption <span className="font-normal text-[var(--text-secondary)]">(optional)</span>
        </label>
        <input
          id="strip-caption"
          type="text"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          maxLength={CAPTION_MAX_LENGTH}
          autoComplete="off"
          placeholder="e.g. A day to remember"
          aria-describedby="caption-help caption-count"
          className="w-full min-w-0 px-4 py-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-base text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        />
        <div className="flex items-start justify-between gap-3 text-xs text-[var(--text-secondary)]">
          <p id="caption-help">Shown below the photos. Leave blank for no caption.</p>
          <span id="caption-count" className="flex-shrink-0 tabular-nums">{caption.length}/{CAPTION_MAX_LENGTH}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="w-full flex flex-col gap-3">
        <div className="flex flex-wrap gap-3 pt-4">
          <button
            onClick={onBack}
            className="flex-1 px-4 sm:px-6 py-3 whitespace-nowrap rounded-lg border border-[var(--border-active)] text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors font-medium"
          >
            ← Back
          </button>

          {/* Download PNG */}
          <button
            onClick={handleExport}
            disabled={isBusy}
            className="flex-1 px-4 sm:px-6 py-3 whitespace-nowrap rounded-lg bg-[var(--surface)] border border-[var(--border-active)] text-[var(--text-primary)] font-semibold hover:bg-[var(--canvas)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Download photo strip as PNG"
          >
            {isExporting ? 'Exporting…' : 'Download'}
          </button>

          {/* Share — only shown when Web Share API with file support is available */}
          {fileShareSupported && (
            <button
              onClick={handleShare}
              disabled={isBusy}
              className="flex-1 px-4 sm:px-6 py-3 whitespace-nowrap rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
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
