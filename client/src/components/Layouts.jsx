import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Spinner } from './ui.jsx';

export function RequireRole({ role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;
  return <Outlet />;
}

function Brand({ to }) {
  return (
    <Link to={to} className="brand">
      <span className="brand-mark">Q</span>
      <span>QuizArena</span>
    </Link>
  );
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const links = [
    ['/admin', 'Dashboard', true],
    ['/admin/competitions', 'Competitions'],
    ['/admin/questions', 'Question Bank'],
    ['/admin/students', 'Students'],
  ];
  return (
    <div className={`admin-shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <Brand to="/admin" />
        <nav onClick={() => setOpen(false)}>
          {links.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="muted small">Signed in as</div>
          <div className="truncate">{user?.email}</div>
          <button
            type="button"
            className="btn btn-sm btn-ghost-light"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Log out
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
            ☰
          </button>
          <span className="muted">Admin console</span>
        </header>
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function StudentLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="student-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand to="/dashboard" />
          <nav className="top-nav">
            <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
              Competitions
            </NavLink>
            <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
              Profile
            </NavLink>
            <span className="muted hide-sm">{user?.name}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="container student-content">
        <Outlet />
      </main>
    </div>
  );
}
