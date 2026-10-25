import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useStudent } from '../lib/auth.jsx';

export default function SiteLayout() {
  const { user, logout } = useStudent();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="site">
      <header className="site-header">
        <div className="container site-header-inner">
          <Link to={user ? '/dashboard' : '/'} className="brand">
            <span className="brand-mark">Q</span>
            <span className="brand-text">College Quiz</span>
          </Link>
          <nav className="site-nav">
            {user ? (
              <>
                <NavLink to="/dashboard">My quizzes</NavLink>
                <span className="nav-user" title={user.email}>
                  {user.name}
                  <small>{user.registerNo}</small>
                </span>
                <button type="button" className="btn btn-sm" onClick={onLogout}>
                  Log out
                </button>
              </>
            ) : user === null ? (
              <>
                <NavLink to="/login">Log in</NavLink>
                <Link to="/register" className="btn btn-primary btn-sm">
                  Register
                </Link>
              </>
            ) : null}
          </nav>
        </div>
      </header>
      <main className="container site-main">
        <Outlet />
      </main>
      <footer className="site-footer container">
        <span>College Quiz Competition</span>
        <Link to="/admin">Organiser login</Link>
      </footer>
    </div>
  );
}
