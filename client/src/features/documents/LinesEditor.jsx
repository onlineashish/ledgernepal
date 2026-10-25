import { fromPaisa } from '@ledgernepal/shared/money';
import { Amount } from '../../components/Money.jsx';
import { Button, Field } from '../../components/ui.jsx';

/**
 * The rows of an invoice or bill. Each row is a small group so it reads well on a phone as well as on a wide
 * screen. `preview` is the live calculation (see lib/invoicePreview.js); `errors[i]` holds messages for row i.
 */
export function LinesEditor({ lines, onChange, preview, errors, isVatRegistered, defaultVatRate, newKey }) {
  const setLine = (index, patch) => onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const remove = (index) => onChange(lines.filter((_, i) => i !== index));
  const add = () => onChange([...lines, { key: newKey(), description: '', quantity: '1', unit: '', unitPrice: '', discount: '', taxable: false, taxRate: '' }]);

  return (
    <div>
      <ol className="space-y-4">
        {lines.map((line, i) => {
          const e = errors[i] ?? {};
          const problem = preview.lineProblems?.[i];
          const computed = preview.ok ? preview.lines[i] : null;
          const id = (name) => `${line.key}-${name}`;
          return (
            <li key={line.key}>
              <div role="group" aria-label={`Line ${i + 1}`} className={`rounded-lg border p-3 ${problem ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                  <Field id={id('description')} label="Item" className="col-span-2 sm:col-span-6" value={line.description} onChange={(ev) => setLine(i, { description: ev.target.value })} error={e.description} autoComplete="off" />
                  <Field id={id('quantity')} label="Quantity" inputMode="decimal" className="sm:col-span-1" value={line.quantity} onChange={(ev) => setLine(i, { quantity: ev.target.value })} error={e.quantity} />
                  <Field id={id('unit')} label="Unit" placeholder="kg, pcs" className="sm:col-span-1" value={line.unit} onChange={(ev) => setLine(i, { unit: ev.target.value })} error={e.unit} />
                  <Field id={id('unitPrice')} label="Unit price" inputMode="decimal" placeholder="0.00" className="sm:col-span-2" value={line.unitPrice} onChange={(ev) => setLine(i, { unitPrice: ev.target.value })} error={e.unitPrice} />
                  <Field id={id('discount')} label="Discount" inputMode="decimal" placeholder="0.00" className="sm:col-span-2" value={line.discount} onChange={(ev) => setLine(i, { discount: ev.target.value })} error={e.discount} />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {isVatRegistered && (
                      <>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={line.taxable} onChange={(ev) => setLine(i, { taxable: ev.target.checked })} />
                          Charge VAT
                        </label>
                        {line.taxable && (
                          <Field id={id('taxRate')} label="VAT rate %" inputMode="decimal" placeholder={defaultVatRate ? String(Number(defaultVatRate)) : 'rate'} className="w-28" value={line.taxRate} onChange={(ev) => setLine(i, { taxRate: ev.target.value })} error={e.taxRate} />
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-sm text-slate-600">
                      Line total <strong className="text-slate-900">{computed ? <Amount value={fromPaisa(computed.total)} /> : '–'}</strong>
                    </p>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`} className="text-sm font-medium text-red-700 hover:underline">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                {(problem || e.line) && <p role="alert" className="mt-2 text-sm text-red-700">{e.line ?? problem}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <Button variant="secondary" className="mt-4" onClick={add}>Add line</Button>
    </div>
  );
}
