import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from './components/AdminLayout.jsx';
import SiteLayout from './components/SiteLayout.jsx';
import { AdminProvider, RequireAdmin, RequireStudent, StudentProvider } from './lib/auth.jsx';
import AdminLogin from './pages/admin/AdminLogin.jsx';
import CompetitionAdmin from './pages/admin/CompetitionAdmin.jsx';
import CompetitionNew from './pages/admin/CompetitionNew.jsx';
import CompetitionsAdmin from './pages/admin/CompetitionsAdmin.jsx';
import Departments from './pages/admin/Departments.jsx';
import Overview from './pages/admin/Overview.jsx';
import Students from './pages/admin/Students.jsx';
import CompetitionPage from './pages/CompetitionPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Home from './pages/Home.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Quiz from './pages/Quiz.jsx';
import Register from './pages/Register.jsx';
import Result from './pages/Result.jsx';

export default function App() {
  return (
    <Routes>
      <Route
        path="/admin/*"
        element={
          <AdminProvider>
            <Routes>
              <Route path="login" element={<AdminLogin />} />
              <Route
                element={
                  <RequireAdmin>
                    <AdminLayout />
                  </RequireAdmin>
                }
              >
                <Route index element={<Overview />} />
                <Route path="competitions" element={<CompetitionsAdmin />} />
                <Route path="competitions/new" element={<CompetitionNew />} />
                <Route path="competitions/:id" element={<CompetitionAdmin />} />
                <Route path="students" element={<Students />} />
                <Route path="departments" element={<Departments />} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Route>
            </Routes>
          </AdminProvider>
        }
      />
      <Route
        path="/*"
        element={
          <StudentProvider>
            <Routes>
              <Route
                path="quiz/:id"
                element={
                  <RequireStudent>
                    <Quiz />
                  </RequireStudent>
                }
              />
              <Route element={<SiteLayout />}>
                <Route index element={<Home />} />
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
                <Route
                  path="dashboard"
                  element={
                    <RequireStudent>
                      <Dashboard />
                    </RequireStudent>
                  }
                />
                <Route path="competitions/:id" element={<CompetitionPage />} />
                <Route path="competitions/:id/leaderboard" element={<Leaderboard />} />
                <Route
                  path="competitions/:id/result"
                  element={
                    <RequireStudent>
                      <Result />
                    </RequireStudent>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </StudentProvider>
        }
      />
    </Routes>
  );
}
