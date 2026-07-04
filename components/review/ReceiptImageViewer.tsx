'use client';

// Receipt image with an SVG overlay in image-pixel coordinate space.
// Renders faint rectangles for all OCR words, colored boxes for item bboxes,
// and a highlight for the selected item. Tapping a word fires onWordTap so the
// review page can assign it to the focused item; tapping an item box selects it.

export interface OverlayWord {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayItem {
  index: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
}

interface ReceiptImageViewerProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  words: OverlayWord[];
  items: OverlayItem[];
  selectedIndex: number | null;
  onWordTap: (word: OverlayWord) => void;
  onItemTap: (index: number) => void;
}

const ITEM_COLORS = [
  '#16a34a', '#2563eb', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#be185d', '#65a30d', '#b45309', '#4f46e5',
];

export default function ReceiptImageViewer({
  imageUrl,
  imageWidth,
  imageHeight,
  words,
  items,
  selectedIndex,
  onWordTap,
  onItemTap,
}: ReceiptImageViewerProps) {
  return (
    <div className="relative w-full overflow-auto max-h-[75vh] rounded border border-gray-100">
      <div className="relative" style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Receipt" className="w-full h-auto block select-none" draggable={false} />
        <svg
          viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* faint word boxes — tappable */}
          {words.map((word, i) => (
            <rect
              key={`w${i}`}
              x={word.x - 2}
              y={word.y - 2}
              width={word.w + 4}
              height={word.h + 4}
              fill="transparent"
              stroke="rgba(37, 99, 235, 0.25)"
              strokeWidth={1}
              rx={2}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onWordTap(word);
              }}
            />
          ))}

          {/* item bounding boxes, color-keyed to table rows */}
          {items.map((item) =>
            item.bbox ? (
              <rect
                key={`i${item.index}`}
                x={item.bbox.x - 4}
                y={item.bbox.y - 4}
                width={item.bbox.w + 8}
                height={item.bbox.h + 8}
                fill={
                  selectedIndex === item.index
                    ? `${ITEM_COLORS[item.index % ITEM_COLORS.length]}33`
                    : 'transparent'
                }
                stroke={ITEM_COLORS[item.index % ITEM_COLORS.length]}
                strokeWidth={selectedIndex === item.index ? 3 : 1.5}
                rx={3}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onItemTap(item.index);
                }}
              />
            ) : null
          )}
        </svg>
      </div>
    </div>
  );
}

export { ITEM_COLORS };
