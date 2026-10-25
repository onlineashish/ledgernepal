import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateField } from '../src/components/DateField.jsx';
import { formatAmount, formatDay, parseAmountOrNull } from '../src/lib/format.js';
import { baseRoutes, mockApi, renderWithSession, sessionPayload } from './helpers.jsx';

afterEach(() => vi.unstubAllGlobals());

function Harness({ initial = '', error }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateField label="Date" value={value} onChange={setValue} error={error} />
      <output aria-label="stored value">{value}</output>
      <button type="button" onClick={() => setValue('')}>reset from outside</button>
    </>
  );
}
const stored = () => screen.getByLabelText('stored value').textContent;
const setup = (initial, dateDisplay = 'BS') => {
  mockApi(baseRoutes(sessionPayload({ dateDisplay })));
  return renderWithSession(<Harness initial={initial} />);
};

describe('DateField', () => {
  it('takes a BS date, hands the form the AD date, and shows the AD equivalent', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByLabelText('Date'), '2081-01-01');
    expect(stored()).toBe('2024-04-13');
    expect(screen.getByText('= 2024-04-13 AD')).toBeInTheDocument();
  });

  it('takes an AD date when the business prefers AD, and shows the BS equivalent in words', async () => {
    const user = userEvent.setup();
    setup('', 'AD');
    await user.type(await screen.findByLabelText('Date'), '2024-04-13');
    expect(stored()).toBe('2024-04-13');
    expect(screen.getByText('= 1 Baisakh 2081 BS')).toBeInTheDocument();
  });

  it('accepts other separators and one-digit months and days', async () => {
    const user = userEvent.setup();
    setup('', 'AD');
    await user.type(await screen.findByLabelText('Date'), '2024/4/3');
    expect(stored()).toBe('2024-04-03');
  });

  it('shows an existing value in the preferred calendar', async () => {
    setup('2024-04-13', 'BS');
    expect(await screen.findByLabelText('Date')).toHaveValue('2081-01-01');
  });

  it('converts the displayed text when the calendar is switched, without changing the stored date', async () => {
    const user = userEvent.setup();
    setup('2024-04-13', 'BS');
    const input = await screen.findByLabelText('Date');
    await user.selectOptions(screen.getByLabelText('Date calendar'), 'AD');
    expect(input).toHaveValue('2024-04-13');
    expect(stored()).toBe('2024-04-13');
    await user.selectOptions(screen.getByLabelText('Date calendar'), 'BS');
    expect(input).toHaveValue('2081-01-01');
  });

  it('keeps the stored value empty and complains after leaving the field with a date that does not exist', async () => {
    const user = userEvent.setup();
    setup();
    const input = await screen.findByLabelText('Date');
    await user.type(input, '2081-02-33'); // no BS month has 33 days
    expect(stored()).toBe('');
    expect(screen.queryByText(/Enter a real/)).not.toBeInTheDocument(); // not nagging while typing
    await user.tab();
    expect(screen.getByText('Enter a real BS date as YYYY-MM-DD')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the stored value when the text is cleared', async () => {
    const user = userEvent.setup();
    setup('2024-04-13');
    await user.clear(await screen.findByLabelText('Date'));
    expect(stored()).toBe('');
  });

  it('follows the form when the value is changed from outside', async () => {
    const user = userEvent.setup();
    setup('2024-04-13');
    const input = await screen.findByLabelText('Date');
    expect(input).toHaveValue('2081-01-01');
    await user.click(screen.getByRole('button', { name: 'reset from outside' }));
    expect(input).toHaveValue('');
  });

  it('shows an error from the server in place of the hint', async () => {
    mockApi(baseRoutes());
    renderWithSession(<Harness initial="2024-04-13" error="Transaction date must be a real date" />);
    expect(await screen.findByText('Transaction date must be a real date')).toBeInTheDocument();
  });

  it('does not crash on a date outside the BS tables', async () => {
    setup('2041-06-01');
    expect(await screen.findByLabelText('Date')).toBeInTheDocument();
  });
});

describe('formatting helpers', () => {
  it('formatAmount uses Nepali digit grouping and keeps the sign', () => {
    expect(formatAmount('1250.5')).toBe('रु 1,250.50');
    expect(formatAmount('12345678.00')).toBe('रु 1,23,45,678.00');
    expect(formatAmount('-300.00')).toBe('-रु 300.00');
    expect(formatAmount('0')).toBe('रु 0.00');
    expect(formatAmount('1250.5', { symbol: false })).toBe('1,250.50');
  });

  it('formatDay shows a date in the chosen calendar, accepts timestamps, and falls back instead of throwing', () => {
    expect(formatDay('2024-04-13', 'AD')).toBe('2024-04-13');
    expect(formatDay('2024-04-13', 'BS')).toBe('2081-01-01');
    expect(formatDay('2024-04-13T05:00:00Z', 'BS')).toBe('2081-01-01');
    expect(formatDay('1800-01-01', 'BS')).toBe('1800-01-01'); // outside the tables
    expect(formatDay(null, 'BS')).toBe('');
  });

  it('parseAmountOrNull only accepts a valid positive amount', () => {
    expect(parseAmountOrNull('12.5')).toBe(1250n);
    expect(parseAmountOrNull(' 100 ')).toBe(10000n);
    for (const bad of ['', '0', '-5', 'abc', '1.234', '1,000']) expect(parseAmountOrNull(bad), bad).toBeNull();
  });
});
