'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ScanDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function ScanDialog({ open, onClose }: ScanDialogProps) {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  if (!open) return null;

  function selectFile(f: File) {
    setError('');
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) selectFile(f);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) selectFile(f);
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setError('');
    setUploading(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await fetch('/api/receipts', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed');
        setUploading(false);
        return;
      }
      router.push(`/receipts/${data.id}/review`);
    } catch {
      setError('Upload failed. Check your connection.');
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Scan receipt</h2>
          <button onClick={close} className="text-gray-400 hover:text-gray-600 p-1" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}

        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver ? 'border-green-500 bg-green-50' : 'border-gray-300'
            }`}
          >
            <p className="text-sm text-gray-500 mb-4">
              Photograph the receipt, or choose an image or PDF
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-sm font-medium"
              >
                Take photo
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-200 text-sm font-medium"
              >
                Choose image or PDF
              </button>
            </div>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleInputChange}
              className="hidden"
            />
            <input
              ref={fileInputRef}
              type="file"
              // Some Android pickers match extensions rather than MIME types,
              // so list both — otherwise PDFs are greyed out in the picker.
              accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
              onChange={handleInputChange}
              className="hidden"
            />
          </div>
        ) : (
          <div>
            {file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? (
              <div className="h-40 flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-50 gap-2">
                <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-gray-500">{file.name}</p>
                <p className="text-xs text-gray-400">The first page will be used as the receipt image</p>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl!}
                alt="Receipt preview"
                className="max-h-96 mx-auto rounded-lg border border-gray-200 object-contain"
              />
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={reset}
                disabled={uploading}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-md hover:bg-gray-200 text-sm font-medium disabled:opacity-50"
              >
                Retake
              </button>
              <button
                onClick={upload}
                disabled={uploading}
                className="flex-1 bg-green-600 text-white py-2 rounded-md hover:bg-green-700 text-sm font-medium disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Use this image'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
