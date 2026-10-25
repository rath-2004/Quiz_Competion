import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAdmin } from '../lib/auth.jsx';

const NAV = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/competitions', label: 'Competitions' },
  { to: '/admin/students', label: 'Students' },
  { to: '/admin/departments', label: 'Departments' },
];

export default function AdminLayout() {
  const { user, logout } = useAdmin();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const onLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  return (
    <div className={`admin ${open ? 'nav-open' : ''}`}>
      <aside className="admin-sidebar">
        <div className="brand">
          <span className="brand-mark">Q</span>
          <span className="brand-text">Quiz Admin</span>
        </div>
        <nav onClick={() => setOpen(false)}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="admin-nav-link">
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <span className="muted small">{user.email}</span>
          <button type="button" className="btn btn-sm btn-block" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>
      <div className="admin-content">
        <header className="admin-topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
            ☰
          </button>
          <span className="muted">Signed in as {user.name}</span>
        </header>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
