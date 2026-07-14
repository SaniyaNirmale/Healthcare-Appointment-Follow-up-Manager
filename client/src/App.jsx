import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AppProvider, useAuth, useToast } from './context/AppContext.jsx';
import Login from './pages/Login.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import DoctorDashboard from './pages/DoctorDashboard.jsx';
import PatientDashboard from './pages/PatientDashboard.jsx';
import { Stethoscope, LogOut, Shield, User, HeartPulse } from 'lucide-react';

// Wrapper to handle OAuth redirects and global headers
function AppContent() {
  const { user, loading, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // Watch for Google Calendar OAuth redirect status parameters
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const googleStatus = params.get('google_calendar');
    
    if (googleStatus === 'success') {
      showToast("Google Calendar connected successfully!", "success");
      // Clean url parameters
      navigate(location.pathname, { replace: true });
    } else if (googleStatus === 'error') {
      const errorMsg = params.get('message') || "Could not connect your Google Calendar account.";
      showToast(`Google Calendar connection failed: ${errorMsg}`, "error");
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate, showToast]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem' }}>
        <HeartPulse size={48} className="pulse" style={{ color: 'var(--primary)' }} />
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Verifying credentials...</span>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Persistent navbar if authenticated */}
      {user && (
        <nav className="navbar">
          <div className="nav-brand" onClick={() => navigate('/dashboard')}>
            <Stethoscope size={28} />
            <span>MedClinic Manager</span>
          </div>

          <div className="nav-user">
            <span className="user-badge">
              <User size={14} />
              <span>{user.fullName}</span>
              <span className={`role-tag ${user.role.toLowerCase()}`}>
                {user.role}
              </span>
            </span>

            <button onClick={logout} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </nav>
      )}

      {/* Main viewport */}
      <main className="main-content">
        <Routes>
          <Route 
            path="/login" 
            element={!user ? <Login /> : <Navigate to="/dashboard" replace />} 
          />
          
          <Route 
            path="/dashboard" 
            element={
              user ? (
                user.role === 'ADMIN' ? (
                  <AdminDashboard />
                ) : user.role === 'DOCTOR' ? (
                  <DoctorDashboard />
                ) : (
                  <PatientDashboard />
                )
              ) : (
                <Navigate to="/login" replace />
              )
            } 
          />

          {/* Catch-all */}
          <Route 
            path="*" 
            element={<Navigate to={user ? "/dashboard" : "/login"} replace />} 
          />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </Router>
  );
}
