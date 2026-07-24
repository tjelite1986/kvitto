'use client';

// Rectangular crop tool for receipt photos: drag the corners in so only the
// receipt is kept and the table background is discarded before upload/OCR.
// Renders the crop client-side via canvas — the server receives a plain JPEG.
// Note: drawing to canvas bakes in the EXIF orientation, so the output needs
// no rotation server-side.

import { useCallback, useEffect, useRef, useState } from 'react';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ImageCropperProps {
  src: string; // object URL of the selected image
  onCancel: () => void;
  onCrop: (blob: Blob) => void;
}

type DragMode =
  | 'move'
  | 'nw' | 'ne' | 'sw' | 'se' // corners
  | 'n' | 's' | 'w' | 'e'; // edges

const MIN_SIZE = 40; // px in display space
const HANDLE_HIT = 24; // touch target radius around corners/edges

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function ImageCropper({ src, onCancel, onCrop }: ImageCropperProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [cropping, setCropping] = useState(false);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startCrop: CropRect;
  } | null>(null);

  // Display size the current crop rect was placed against. The rect is in
  // display pixels, so it must be rescaled when the image is re-laid-out
  // (phone rotation, window resize) or applyCrop maps the wrong region.
  const displaySize = useRef<{ w: number; h: number } | null>(null);

  // Start with a slight inset so the crop rect is visibly adjustable
  const initCrop = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const inset = 0.04;
    displaySize.current = { w: img.clientWidth, h: img.clientHeight };
    setCrop({
      x: img.clientWidth * inset,
      y: img.clientHeight * inset,
      w: img.clientWidth * (1 - inset * 2),
      h: img.clientHeight * (1 - inset * 2),
    });
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.clientWidth > 0) initCrop();
  }, [initCrop, src]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const observer = new ResizeObserver(() => {
      const w = img.clientWidth;
      const h = img.clientHeight;
      if (!w || !h) return;
      const prev = displaySize.current;
      displaySize.current = { w, h };
      if (!prev || (prev.w === w && prev.h === h)) return;
      setCrop((c) =>
        c
          ? {
              x: (c.x * w) / prev.w,
              y: (c.y * h) / prev.h,
              w: (c.w * w) / prev.w,
              h: (c.h * h) / prev.h,
            }
          : c
      );
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, [src]);

  function hitTest(px: number, py: number, rect: CropRect): DragMode | null {
    const nearLeft = Math.abs(px - rect.x) < HANDLE_HIT;
    const nearRight = Math.abs(px - (rect.x + rect.w)) < HANDLE_HIT;
    const nearTop = Math.abs(py - rect.y) < HANDLE_HIT;
    const nearBottom = Math.abs(py - (rect.y + rect.h)) < HANDLE_HIT;
    const insideX = px > rect.x - HANDLE_HIT && px < rect.x + rect.w + HANDLE_HIT;
    const insideY = py > rect.y - HANDLE_HIT && py < rect.y + rect.h + HANDLE_HIT;

    if (nearTop && nearLeft) return 'nw';
    if (nearTop && nearRight) return 'ne';
    if (nearBottom && nearLeft) return 'sw';
    if (nearBottom && nearRight) return 'se';
    if (nearTop && insideX) return 'n';
    if (nearBottom && insideX) return 's';
    if (nearLeft && insideY) return 'w';
    if (nearRight && insideY) return 'e';
    if (px > rect.x && px < rect.x + rect.w && py > rect.y && py < rect.y + rect.h) {
      return 'move';
    }
    return null;
  }

  function pointerPos(e: React.PointerEvent): { x: number; y: number } {
    const bounds = imgRef.current!.getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!crop || !imgRef.current) return;
    const { x, y } = pointerPos(e);
    const mode = hitTest(x, y, crop);
    if (!mode) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: x, startY: y, startCrop: { ...crop } };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const img = imgRef.current;
    if (!drag || !img) return;
    e.preventDefault();
    const { x, y } = pointerPos(e);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    const s = drag.startCrop;
    const W = img.clientWidth;
    const H = img.clientHeight;

    let next: CropRect;
    if (drag.mode === 'move') {
      next = {
        x: clamp(s.x + dx, 0, W - s.w),
        y: clamp(s.y + dy, 0, H - s.h),
        w: s.w,
        h: s.h,
      };
    } else {
      let left = s.x;
      let top = s.y;
      let right = s.x + s.w;
      let bottom = s.y + s.h;
      if (drag.mode.includes('w')) left = clamp(s.x + dx, 0, right - MIN_SIZE);
      if (drag.mode.includes('e')) right = clamp(s.x + s.w + dx, left + MIN_SIZE, W);
      if (drag.mode.includes('n')) top = clamp(s.y + dy, 0, bottom - MIN_SIZE);
      if (drag.mode.includes('s')) bottom = clamp(s.y + s.h + dy, top + MIN_SIZE, H);
      next = { x: left, y: top, w: right - left, h: bottom - top };
    }
    setCrop(next);
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function applyCrop() {
    const img = imgRef.current;
    if (!img || !crop) return;
    setCropping(true);
    // Map display coordinates back to natural image pixels
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const sx = Math.round(crop.x * scaleX);
    const sy = Math.round(crop.y * scaleY);
    const sw = Math.max(1, Math.round(crop.w * scaleX));
    const sh = Math.max(1, Math.round(crop.h * scaleY));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCropping(false);
      return;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    canvas.toBlob(
      (blob) => {
        setCropping(false);
        if (blob) onCrop(blob);
      },
      'image/jpeg',
      0.92
    );
  }

  const handleClass =
    'absolute w-5 h-5 border-2 border-white bg-green-600 rounded-full shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none';

  return (
    <div>
      <div ref={containerRef} className="relative mx-auto w-fit max-w-full select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt="Crop receipt"
          onLoad={initCrop}
          className="max-h-96 max-w-full rounded-lg border border-gray-200"
          draggable={false}
        />
        {crop && (
          <div
            className="absolute inset-0 touch-none cursor-move"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* Dim everything outside the crop rect */}
            <div className="absolute bg-black/50 left-0 right-0 top-0" style={{ height: crop.y }} />
            <div
              className="absolute bg-black/50 left-0 right-0 bottom-0"
              style={{ top: crop.y + crop.h }}
            />
            <div
              className="absolute bg-black/50 left-0"
              style={{ top: crop.y, height: crop.h, width: crop.x }}
            />
            <div
              className="absolute bg-black/50 right-0"
              style={{ top: crop.y, height: crop.h, left: crop.x + crop.w }}
            />
            {/* Crop border + corner handles */}
            <div
              className="absolute border-2 border-green-500"
              style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
            />
            <div className={handleClass} style={{ left: crop.x, top: crop.y }} />
            <div className={handleClass} style={{ left: crop.x + crop.w, top: crop.y }} />
            <div className={handleClass} style={{ left: crop.x, top: crop.y + crop.h }} />
            <div className={handleClass} style={{ left: crop.x + crop.w, top: crop.y + crop.h }} />
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400 text-center mt-2">
        Drag the corners so only the receipt is inside the frame.
      </p>
      <div className="flex gap-3 mt-4">
        <button
          onClick={onCancel}
          disabled={cropping}
          className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-md hover:bg-gray-200 text-sm font-medium disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={applyCrop}
          disabled={cropping || !crop}
          className="flex-1 bg-green-600 text-white py-2 rounded-md hover:bg-green-700 text-sm font-medium disabled:opacity-50"
        >
          {cropping ? 'Cropping...' : 'Apply crop'}
        </button>
      </div>
    </div>
  );
}
