import { useEffect, useState } from 'react';
import { getToken } from '../api';

function initialsOf(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '👤';
}

export default function Avatar({ name, photo, size = 40, className = '' }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;

    if (!photo) {
      setSrc(null);
      return undefined;
    }

    (async () => {
      try {
        const token = getToken();
        const res = await fetch(photo, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`fetch fail: ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo]);

  const base = `flex items-center justify-center rounded-full overflow-hidden shrink-0 ${className}`;

  if (src) {
    return <img src={src} alt="profile" className={`${base} object-cover`} />;
  }

  return (
    <div
      className={`${base} bg-gradient-to-br from-brand to-lemon text-sm font-bold text-white`}
      title={name || 'Customer'}
    >
      {initialsOf(name)}
    </div>
  );
}