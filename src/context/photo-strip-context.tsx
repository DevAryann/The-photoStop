'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface CapturedPhoto {
  blob: Blob
  objectUrl: string
}

interface PhotoStripContextType {
  photos: CapturedPhoto[]
  setPhotos: (photos: CapturedPhoto[]) => void
  clearPhotos: () => void
  backgroundColor: string
  setBackgroundColor: (color: string) => void
  stripStyle: 'plain' | 'polaroid' | 'retro'
  setStripStyle: (style: 'plain' | 'polaroid' | 'retro') => void
}

const PhotoStripContext = createContext<PhotoStripContextType | undefined>(undefined)

export function PhotoStripProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [backgroundColor, setBackgroundColor] = useState<string>('#ffffff')
  const [stripStyle, setStripStyle] = useState<'plain' | 'polaroid' | 'retro'>('plain')

  const clearPhotos = useCallback(() => {
    // Revoke all object URLs to free memory
    photos.forEach((photo) => {
      URL.revokeObjectURL(photo.objectUrl)
    })
    setPhotos([])
    setBackgroundColor('#ffffff')
    setStripStyle('plain')
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
