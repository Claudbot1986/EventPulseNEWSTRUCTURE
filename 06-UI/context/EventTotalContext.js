import { createContext, useContext, useEffect, useState } from 'react';
import { fetchPublishedEventTotal } from '../services/eventServiceClient';

const EventTotalContext = createContext(null);

export function EventTotalProvider({ children }) {
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchPublishedEventTotal()
      .then((count) => {
        if (!cancelled && typeof count === 'number' && count > 0) {
          setTotal(count);
        }
      })
      .catch((err) => {
        console.warn('[EventTotal] failed to fetch Supabase total:', err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <EventTotalContext.Provider value={{ total, loading }}>
      {children}
    </EventTotalContext.Provider>
  );
}

export function usePublishedEventTotal() {
  return useContext(EventTotalContext);
}

export function formatPublishedEventTotal(total) {
  if (typeof total !== 'number' || total <= 0) {
    return null;
  }
  return total.toLocaleString('sv-SE');
}
