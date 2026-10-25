import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { AdminLayout, RequireRole, StudentLayout } from './components/Layouts.jsx';
import { Spinner } from './components/ui.jsx';
import AdminCompetitionDetail from './pages/admin/CompetitionDetail.jsx';
import AdminCompetitionForm from './pages/admin/CompetitionForm.jsx';
import AdminCompetitions from './pages/admin/Competitions.jsx';
import AdminDashboard from './pages/admin/Dashboard.jsx';
import AdminQuestions from './pages/admin/Questions.jsx';
import AdminStudentDetail from './pages/admin/StudentDetail.jsx';
import AdminStudents from './pages/admin/Students.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import StudentCompetition from './pages/student/Competition.jsx';
import StudentDashboard from './pages/student/Dashboard.jsx';
import Profile from './pages/student/Profile.jsx';
import Quiz from './pages/student/Quiz.jsx';
import Result from './pages/student/Result.jsx';

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;
  return <Landing />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<RequireRole role="student" />}>
        {/* The quiz runs full-screen, outside the normal layout. */}
        <Route path="/quiz/:id" element={<Quiz />} />
        <Route element={<StudentLayout />}>
          <Route path="/dashboard" element={<StudentDashboard />} />
          <Route path="/competitions/:id" element={<StudentCompetition />} />
          <Route path="/competitions/:id/result" element={<Result />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="admin" />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="competitions" element={<AdminCompetitions />} />
          <Route path="competitions/new" element={<AdminCompetitionForm />} />
          <Route path="competitions/:id" element={<AdminCompetitionDetail />} />
          <Route path="competitions/:id/edit" element={<AdminCompetitionForm />} />
          <Route path="questions" element={<AdminQuestions />} />
          <Route path="students" element={<AdminStudents />} />
          <Route path="students/:id" element={<AdminStudentDetail />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
