import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Icon } from '../components/Icon.jsx';
import { t } from '../i18n/en.js';
import { NAV_ITEMS } from './navigation.js';

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-navy-700 text-white' : 'text-slate-300 hover:bg-navy-800 hover:text-white'
  }`;

const subLinkClass = ({ isActive }) =>
  `block rounded-md py-1.5 pl-11 pr-3 text-sm transition-colors ${
    isActive ? 'text-white' : 'text-slate-400 hover:text-white'
  }`;

function Sidebar({ onNavigate }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label={t('nav.main')} className="flex h-full flex-col bg-navy-900 text-slate-200">
      <div className="px-5 py-5">
        <p className="text-lg font-semibold text-white">{t('app.name')}</p>
        <p className="text-xs text-slate-400">{t('app.tagline')}</p>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {NAV_ITEMS.map((item) => (
          <li key={item.key}>
            <NavLink to={item.to} end={item.end ?? Boolean(item.children)} onClick={onNavigate} className={linkClass}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
            {item.children && pathname.startsWith(item.to) && (
              <ul className="mt-1 space-y-0.5">
                {item.children.map((child) => (
                  <li key={child.key}>
                    <NavLink to={child.to} end={child.end} onClick={onNavigate} className={subLinkClass}>
                      {child.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the mobile drawer after navigating.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="flex h-full">
      {/* Desktop / tablet: fixed sidebar */}
      <aside className="no-print hidden w-64 shrink-0 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile: slide-over drawer */}
      {menuOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <aside className="relative h-full w-72 max-w-[85%]">
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label={t('nav.closeMenu')}
              className="absolute right-2 top-3 rounded-md p-2 text-slate-300 hover:text-white"
            >
              <Icon name="close" />
            </button>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center gap-3 border-b border-slate-200 px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t('nav.openMenu')}
            className="rounded-md p-1.5 text-slate-700 hover:bg-slate-100"
          >
            <Icon name="menu" />
          </button>
          <span className="font-semibold text-navy-900">{t('app.name')}</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
