import { useEffect, useId, useState } from 'react';
import { formatBsLong, formatDate, parseDateInput } from '@ledgernepal/shared/dates';
import { useAuth } from '../auth/AuthContext.jsx';

const tryParse = (text, calendar) => {
  try {
    return parseDateInput(text, calendar);
  } catch {
    return '';
  }
};
const tryFormat = (iso, calendar) => {
  try {
    return iso ? formatDate(iso, calendar) : '';
  } catch {
    return '';
  }
};

/**
 * A date the person can type in BS or AD. The value handed to the form is always the AD date
 * "YYYY-MM-DD" (what the server stores), or '' while the text is empty or not yet a real date.
 * It starts in the business's preferred calendar and shows the same day in the other one underneath,
 * so nobody has to convert in their head.
 */
export function DateField({ label, value, onChange, error, required = false, className = '' }) {
  const auth = useAuth();
  const id = useId();
  const [calendar, setCalendar] = useState(auth.activeBusiness?.dateDisplay ?? 'BS');
  const [text, setText] = useState(() => tryFormat(value, calendar));
  const [touched, setTouched] = useState(false);

  // If the form changes the value from outside (a reset, a loaded record), show it.
  useEffect(() => {
    if ((value || '') !== tryParse(text, calendar)) setText(tryFormat(value, calendar));
    // only when the value changes: while the person types, text and value agree or the value is empty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function onType(event) {
    setText(event.target.value);
    onChange(tryParse(event.target.value, calendar));
  }

  function switchCalendar(event) {
    const next = event.target.value;
    setCalendar(next);
    setText(tryFormat(value, next));
    if (!value) onChange(tryParse(text, next)); // what was typed may be a valid date in the other calendar
  }

  const typedButInvalid = touched && text.trim() !== '' && !value;
  const shown = error ?? (typedButInvalid ? `Enter a real ${calendar} date as YYYY-MM-DD` : null);
  let equivalent = null;
  if (value) {
    try {
      equivalent = calendar === 'BS' ? `${formatDate(value, 'AD')} AD` : `${formatBsLong(value)} BS`;
    } catch {
      equivalent = null; // outside the BS tables
    }
  }

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={text}
          onChange={onType}
          onBlur={() => setTouched(true)}
          placeholder="YYYY-MM-DD"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={shown ? 'true' : undefined}
          aria-describedby={`${id}-hint`}
          className={`block w-full rounded-lg border px-3 py-2 text-sm focus:outline-2 focus:outline-brand-600 ${shown ? 'border-red-500' : 'border-slate-300'}`}
        />
        <select
          aria-label={`${label} calendar`}
          value={calendar}
          onChange={switchCalendar}
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        >
          <option value="BS">BS</option>
          <option value="AD">AD</option>
        </select>
      </div>
      <p id={`${id}-hint`} className={`mt-1 text-xs ${shown ? 'text-red-700' : 'text-slate-500'}`}>
        {shown ?? (equivalent ? `= ${equivalent}` : ' ')}
      </p>
    </div>
  );
}
