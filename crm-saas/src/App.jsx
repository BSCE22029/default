import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Layout from './components/Layout';
import Dashboard from './pages/tenant/Dashboard';
import Leads from './pages/tenant/Leads';
import Pipeline from './pages/tenant/Pipeline';
import Generator from './pages/tenant/Generator';
import Analytics from './pages/tenant/Analytics';
import Team from './pages/tenant/Team';
import AdminHome from './pages/admin/AdminHome';
import AdminOrgs from './pages/admin/AdminOrgs';

function Protected({ children, allow }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <div className="center">Setting up your account…</div>;
  if (allow && !allow.includes(profile.role)) return <Navigate to="/" replace />;
  return children;
}

// Send users to the right home based on role.
function HomeRedirect() {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <div className="center">Setting up your account…</div>;
  return <Navigate to={profile.role === 'super_admin' ? '/admin' : '/app'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/" element={<HomeRedirect />} />

      {/* Tenant (admin/member) app */}
      <Route path="/app" element={<Protected allow={['admin', 'member', 'super_admin']}><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="leads" element={<Leads />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="generator" element={<Generator />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="team" element={<Team />} />
      </Route>

      {/* Super-admin platform console */}
      <Route path="/admin" element={<Protected allow={['super_admin']}><Layout admin /></Protected>}>
        <Route index element={<AdminHome />} />
        <Route path="orgs" element={<AdminOrgs />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
