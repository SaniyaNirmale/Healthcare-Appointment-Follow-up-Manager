import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AppContext.jsx';
import { Stethoscope, KeyRound, Mail, UserPlus, LogIn } from 'lucide-react';

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('PATIENT');
  const [loading, setLoading] = useState(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      if (isRegister) {
        await register(email, password, fullName, role);
      } else {
        await login(email, password);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '80vh',
      padding: '1rem'
    }}>
      <div className="card" style={{
        width: '100%',
        maxWidth: '450px',
        padding: '2.5rem',
        boxShadow: 'var(--shadow-lg)'
      }}>
        {/* Branding header */}
        <div style={{
          textAlign: 'center',
          marginBottom: '2rem'
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            backgroundColor: 'var(--primary-light)',
            color: 'var(--primary)',
            marginBottom: '1rem'
          }}>
            <Stethoscope size={32} />
          </div>
          <h2>MedClinic Portal</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            {isRegister ? "Create an account to start booking or managing" : "Log in to manage appointments & consultations"}
          </p>
        </div>

        {/* Tab Selection */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          marginBottom: '1.5rem',
          gap: '1rem'
        }}>
          <button 
            type="button"
            onClick={() => { setIsRegister(false); setEmail(''); setPassword(''); }}
            style={{
              flex: 1,
              padding: '0.75rem 0',
              background: 'none',
              border: 'none',
              borderBottom: !isRegister ? '2px solid var(--primary)' : '2px solid transparent',
              fontFamily: 'var(--font-heading)',
              fontWeight: 700,
              fontSize: '0.95rem',
              color: !isRegister ? 'var(--primary-dark)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'var(--transition-fast)'
            }}
          >
            Sign In
          </button>
          <button 
            type="button"
            onClick={() => { setIsRegister(true); setEmail(''); setPassword(''); setFullName(''); setRole('PATIENT'); }}
            style={{
              flex: 1,
              padding: '0.75rem 0',
              background: 'none',
              border: 'none',
              borderBottom: isRegister ? '2px solid var(--primary)' : '2px solid transparent',
              fontFamily: 'var(--font-heading)',
              fontWeight: 700,
              fontSize: '0.95rem',
              color: isRegister ? 'var(--primary-dark)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'var(--transition-fast)'
            }}
          >
            Register Account
          </button>
        </div>

        {/* Auth Form */}
        <form onSubmit={handleSubmit}>
          {isRegister && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="fullName">Full Name</label>
                <input 
                  type="text" 
                  id="fullName"
                  className="form-control" 
                  placeholder="Sarah Jenkins"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="role">Register As</label>
                <select 
                  id="role"
                  className="form-control"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                >
                  <option value="PATIENT">Patient (Book slots & view summaries)</option>
                  <option value="ADMIN">Administrator (Manage clinic & doctor profiles)</option>
                </select>
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email Address</label>
            <input 
              type="email" 
              id="email"
              className="form-control" 
              placeholder="user@clinic.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input 
              type="password" 
              id="password"
              className="form-control" 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={loading}
            style={{ width: '100%', marginTop: '1.25rem', padding: '0.8rem' }}
          >
            {loading ? (
              "Loading..."
            ) : isRegister ? (
              <>
                <UserPlus size={18} /> Register Account
              </>
            ) : (
              <>
                <LogIn size={18} /> Sign In
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

