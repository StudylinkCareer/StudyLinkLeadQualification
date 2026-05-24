// src/components/TrailBackButton.jsx
//
// PURPOSE
//   A "<" back-arrow button that pops one level off the nav trail and
//   navigates to the new top. Designed to sit at the top-left of a page
//   header (the same spot as breadcrumbs in many apps).
//
//   Hidden entirely when the trail has fewer than 2 entries — there's
//   nothing to go back to.

import { FiArrowLeft } from 'react-icons/fi';
import { useNavTrail } from '../contexts/NavTrailContext';

export default function TrailBackButton({ size = 16 }) {
  const { trail, pop } = useNavTrail();

  // If there's no previous entry, render nothing (keeps the page header
  // from showing a disabled button that does nothing).
  if (!trail || trail.length < 2) return null;

  const previousLabel = trail[trail.length - 2]?.label || 'previous page';

  return (
    <button
      type="button"
      onClick={pop}
      title={`Back to ${previousLabel}`}
      aria-label={`Back to ${previousLabel}`}
      className="btn btn--ghost btn--icon"
      style={{ marginRight:'8px' }}
    >
      <FiArrowLeft size={size} />
    </button>
  );
}
