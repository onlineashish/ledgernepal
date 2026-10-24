import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { Icon } from '../components/Icon.jsx';
import { t } from '../i18n/en.js';
import { NAV_ITEMS, visibleTo } from './navigation.js';

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-navy-700 text-white' : 'text-slate-300 hover:bg-navy-800 hover:text-white'
  }`;

const subLinkClass = ({ isActive }) =>
  `block rounded-md py-1.5 pl-11 pr-3 text-sm transition-colors ${
    isActive ? 'text-white' : 'text-slate-400 hover:text-white'
  }`;

function AccountFooter() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  async function switchBusiness(event) {
    setError(null);
    try {
      await auth.chooseBusiness(event.target.value);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="border-t border-navy-700 p-3 text-sm">
      {auth.memberships.length > 1 ? (
        <>
          <label htmlFor="business-switcher" className="sr-only">Switch business</label>
          <select
            id="business-switcher"
            value={auth.activeBusiness.id}
            onChange={switchBusiness}
            className="mb-2 w-full rounded-md border border-navy-700 bg-navy-800 px-2 py-1.5 text-white"
          >
            {auth.memberships.map((m) => (
              <option key={m.businessId} value={m.businessId}>{m.businessName}</option>
            ))}
          </select>
        </>
      ) : (
        <p className="truncate font-medium text-white">{auth.activeBusiness.name}</p>
      )}
      {error && <p role="alert" className="mb-1 text-xs text-red-300">{error}</p>}
      <p className="truncate text-xs text-slate-400">
        {auth.user.fullName} · {auth.activeBusiness.roleName}
      </p>
      <NavLink to="/account" className="mt-2 block rounded-md px-2 py-1.5 text-slate-300 hover:bg-navy-800 hover:text-white">
        Account & security
      </NavLink>
      <button
        type="button"
        onClick={() => auth.logout()}
        className="mt-1 w-full rounded-md border border-navy-700 px-2 py-1.5 text-left text-slate-300 hover:bg-navy-800 hover:text-white"
      >
        Log out
      </button>
    </div>
  );
}

function Sidebar({ onNavigate }) {
  const { pathname } = useLocation();
  const auth = useAuth();
  return (
    <nav aria-label={t('nav.main')} className="flex h-full flex-col bg-navy-900 text-slate-200">
      <div className="px-5 py-5">
        <p className="text-lg font-semibold text-white">{t('app.name')}</p>
        <p className="text-xs text-slate-400">{t('app.tagline')}</p>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {visibleTo(auth, NAV_ITEMS).map((item) => (
          <li key={item.key}>
            <NavLink to={item.to} end={item.end ?? Boolean(item.children)} onClick={onNavigate} className={linkClass}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
            {item.children && pathname.startsWith(item.to) && (
              <ul className="mt-1 space-y-0.5">
                {visibleTo(auth, item.children).map((child) => (
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
      <AccountFooter />
    </nav>
  );
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const auth = useAuth();

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
          <span className="font-semibold text-navy-900">{auth.activeBusiness.name}</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
