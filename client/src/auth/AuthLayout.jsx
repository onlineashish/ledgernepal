import { t } from '../i18n/en.js';

/** Centered card used by login, sign-up, invitation and business-picker pages. */
export function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-2xl font-semibold text-navy-900">{t('app.name')}</p>
          <p className="text-sm text-slate-500">{t('app.tagline')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
