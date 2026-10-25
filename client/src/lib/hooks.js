import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { formatDay } from './format.js';

/** A value that follows `value` only after it has stopped changing for `delay` ms (for search boxes). */
export function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Returns a function that shows a date in the business's preferred calendar (BS or AD). */
export function useDayFormatter() {
  const calendar = useAuth().activeBusiness?.dateDisplay ?? 'AD';
  return (iso) => formatDay(iso, calendar);
}
