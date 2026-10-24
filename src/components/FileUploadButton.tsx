// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { downscaleImageDataUrl } from '../lib/imageInput'

interface FileUploadButtonProps {
  onFileSelect: (file: File, content: string) => void
  disabled?: boolean
}

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv',
  'application/json', 'application/typescript',
  'text/javascript', 'text/typescript', 'text/x-python',
]

export function FileUploadButton({ onFileSelect, disabled }: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const { t } = useI18n()

  const handleFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      alert(t('fileupload.tooBig'))
      return
    }

    setReading(true)
    try {
      let content = ''
      
      if (file.type.startsWith('image/')) {
        // For images, convert to base64 data URL
        content = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
        // Phone photos are scaled to the size the vision models actually use.
        content = await downscaleImageDataUrl(content)
      } else if (file.type === 'application/pdf') {
        // For PDFs, note that we can't easily extract text client-side
        content = `[PDF: ${file.name} — ${(file.size / 1024).toFixed(1)}KB]`
      } else {
        // Text files — read as text
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsText(file)
        })
      }

      onFileSelect(file, content)
    } catch (err) {
      alert(t('fileupload.readFailed', { reason: err instanceof Error ? err.message : t('fileupload.unknownError') }))
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled || reading}
        title={t('fileupload.attach')}
        style={{
          background: 'transparent',
          border: 'none',
          color: disabled ? '#444' : '#666',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: '16px',
          padding: '0',
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.color = '#f97316' }}
        onMouseLeave={e => { if (!disabled) e.currentTarget.style.color = '#666' }}
      >
        {reading ? '⏳' : '📎'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
    </>
  )
}
