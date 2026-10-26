'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface CapturedPhoto {
  blob: Blob
  objectUrl: string
}

export const MAX_STICKERS = 8
export const CAPTION_MAX_LENGTH = 80

export type PhotoFilter = 'original' | 'vintage' | 'grayscale' | 'warm'

export interface PhotoStripSticker {
  id: string
  emoji: string
  slot: number
}

interface PhotoStripContextType {
  photos: CapturedPhoto[]
  setPhotos: (photos: CapturedPhoto[]) => void
  clearPhotos: () => void
  backgroundColor: string
  setBackgroundColor: (color: string) => void
  stripStyle: 'plain' | 'polaroid' | 'retro'
  setStripStyle: (style: 'plain' | 'polaroid' | 'retro') => void
  photoFilter: PhotoFilter
  setPhotoFilter: (filter: PhotoFilter) => void
  stickers: PhotoStripSticker[]
  addSticker: (emoji: string) => void
  removeSticker: (id: string) => void
  caption: string
  setCaption: (caption: string) => void
}

const PhotoStripContext = createContext<PhotoStripContextType | undefined>(undefined)

export function PhotoStripProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [backgroundColor, setBackgroundColor] = useState<string>('#ffffff')
  const [stripStyle, setStripStyle] = useState<'plain' | 'polaroid' | 'retro'>('plain')
  const [photoFilter, setPhotoFilter] = useState<PhotoFilter>('original')
  const [stickers, setStickers] = useState<PhotoStripSticker[]>([])
  const [caption, setCaptionValue] = useState('')

  const addSticker = useCallback((emoji: string) => {
    const id = crypto.randomUUID()
    setStickers((current) => {
      // Reuse the first empty corner without moving any existing stickers.
      const slot = Array.from({ length: MAX_STICKERS }, (_, index) => index).find(
        (index) => !current.some((sticker) => sticker.slot === index)
      )
      if (slot === undefined) return current
      return [...current, { id, emoji, slot }]
    })
  }, [])

  const removeSticker = useCallback((id: string) => {
    setStickers((current) => current.filter((sticker) => sticker.id !== id))
  }, [])

  const setCaption = useCallback((value: string) => {
    setCaptionValue(value.slice(0, CAPTION_MAX_LENGTH))
  }, [])

  const clearPhotos = useCallback(() => {
    // Revoke all object URLs to free memory
    photos.forEach((photo) => {
      URL.revokeObjectURL(photo.objectUrl)
    })
    setPhotos([])
    setBackgroundColor('#ffffff')
    setStripStyle('plain')
    setPhotoFilter('original')
    setStickers([])
    setCaptionValue('')
  }, [photos])

  return (
    <PhotoStripContext.Provider
      value={{
        photos,
        setPhotos,
        clearPhotos,
        backgroundColor,
        setBackgroundColor,
        stripStyle,
        setStripStyle,
        photoFilter,
        setPhotoFilter,
        stickers,
        addSticker,
        removeSticker,
        caption,
        setCaption,
      }}
    >
      {children}
    </PhotoStripContext.Provider>
  )
}

export function usePhotoStrip() {
  const context = useContext(PhotoStripContext)
  if (context === undefined) {
    throw new Error('usePhotoStrip must be used within PhotoStripProvider')
  }
  return context
}
