// Shared formatting helpers. Money is stored as integer öre.

export function formatKr(ore: number): string {
  return (ore / 100).toLocaleString('sv-SE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' kr';
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  uploaded: { label: 'Uploaded', className: 'bg-gray-100 text-gray-600' },
  processing: { label: 'Processing', className: 'bg-blue-50 text-blue-600' },
  pending_review: { label: 'Needs review', className: 'bg-amber-50 text-amber-700' },
  confirmed: { label: 'Confirmed', className: 'bg-green-50 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-600' },
};

export function statusBadge(status: string) {
  const s = STATUS_STYLES[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.className}`}>
      {s.label}
    </span>
  );
}
