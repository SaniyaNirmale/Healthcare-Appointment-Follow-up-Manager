import React, { useState, useEffect } from 'react';
import { useAuth, useToast } from '../context/AppContext.jsx';
import API_BASE from '../lib/api.js';
import { 
  Users, Calendar, AlertTriangle, RefreshCw, Plus, 
  Trash2, Mail, Shield, User, Clock, Heart, ClipboardCheck 
} from 'lucide-react';

export default function AdminDashboard() {
  const { token } = useAuth();
  const { showToast } = useToast();

  // Metrics state
  const [stats, setStats] = useState({
    doctors: 0,
    patients: 0,
    appointments: 0,
    activeHolds: 0,
    failedNotifications: 0
  });

  // Doctor state
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [doctorLeaves, setDoctorLeaves] = useState([]);
  
  // Notification logs
  const [logs, setLogs] = useState([]);
  
  // Form inputs for new doctor
  const [docEmail, setDocEmail] = useState('');
  const [docPassword, setDocPassword] = useState('');
  const [docName, setDocName] = useState('');
  const [docSpec, setDocSpec] = useState('');
  const [docDuration, setDocDuration] = useState('30');
  const [docStart, setDocStart] = useState('09:00');
  const [docEnd, setDocEnd] = useState('17:00');
  const [submittingDoc, setSubmittingDoc] = useState(false);

  // Form inputs for leave
  const [leaveDate, setLeaveDate] = useState('');
  const [submittingLeave, setSubmittingLeave] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState('doctors'); // doctors | logs

  // Fetch admin metrics
  const fetchStats = async () => {
    try {
      const res = await fetch('${API_BASE}/api/admin/dashboard', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Fetch doctors list
  const fetchDoctors = async () => {
    try {
      const res = await fetch('${API_BASE}/api/admin/doctors', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDoctors(data);
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Fetch notification log audit list
  const fetchLogs = async () => {
    try {
      const res = await fetch('${API_BASE}/api/admin/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Fetch leaves for selected doctor
  const fetchDoctorLeaves = async (docId) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/doctors/${docId}/leaves`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDoctorLeaves(data);
      }
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchDoctors();
    fetchLogs();
  }, [token]);

  // Handle selected doctor change
  useEffect(() => {
    if (selectedDoctor) {
      fetchDoctorLeaves(selectedDoctor.id);
    } else {
      setDoctorLeaves([]);
    }
  }, [selectedDoctor]);

  // Create Doctor Profile
  const handleCreateDoctor = async (e) => {
    e.preventDefault();
    if (submittingDoc) return;
    setSubmittingDoc(true);

    try {
      const res = await fetch('${API_BASE}/api/admin/doctors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          email: docEmail,
          password: docPassword,
          fullName: docName,
          specialization: docSpec,
          slotDuration: docDuration,
          workingHoursStart: docStart,
          workingHoursEnd: docEnd
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to create doctor profile');
      }

      showToast(data.message, 'success');
      setDocEmail('');
      setDocPassword('');
      setDocName('');
      setDocSpec('');
      fetchDoctors();
      fetchStats();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSubmittingDoc(false);
    }
  };

  // Log Leave Day (Triggers leave conflict cancellations)
  const handleAddLeave = async (e) => {
    e.preventDefault();
    if (!selectedDoctor || !leaveDate) return;
    if (submittingLeave) return;
    setSubmittingLeave(true);

    try {
      const res = await fetch(`${API_BASE}/api/admin/doctors/${selectedDoctor.id}/leaves`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ leaveDate })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to record leave');
      }

      showToast(data.message, 'success');
      
      if (data.affectedBookingsCancelledCount > 0) {
        showToast(`Cancelled ${data.affectedBookingsCancelledCount} conflicting booking(s) and notified patients!`, 'info');
      }

      setLeaveDate('');
      fetchDoctorLeaves(selectedDoctor.id);
      fetchStats();
      fetchLogs(); // refresh cancellation logs
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSubmittingLeave(false);
    }
  };

  // Delete Leave
  const handleDeleteLeave = async (leaveId) => {
    if (!selectedDoctor) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/doctors/${selectedDoctor.id}/leaves/${leaveId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, 'success');
        fetchDoctorLeaves(selectedDoctor.id);
      }
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '2rem', background: 'linear-gradient(135deg, #0f766e 0%, #115e59 100%)', color: 'white' }}>
        <h2 style={{ color: 'white', display: 'flex', alignItems: 'center', gap: '0.75rem' }}><Shield /> Clinic Administration Dashboard</h2>
        <p style={{ opacity: 0.85, fontSize: '0.95rem', marginTop: '0.25rem' }}>Configure professional profiles, coordinate leave cancellations, and supervise email communications.</p>
      </div>

      {/* Metrics Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1.25rem',
        marginBottom: '2rem'
      }}>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary-dark)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
            <Users size={24} />
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>Active Doctors</div>
            <h3>{stats.doctors}</h3>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: 'var(--secondary-light)', color: 'var(--secondary)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
            <Users size={24} />
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>Registered Patients</div>
            <h3>{stats.patients}</h3>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: '#eff6ff', color: '#1e40af', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
            <Calendar size={24} />
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>Total Bookings</div>
            <h3>{stats.appointments}</h3>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: '#fef3c7', color: '#d97706', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
            <Clock size={24} />
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>Active Slot Holds</div>
            <h3>{stats.activeHolds}</h3>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ backgroundColor: '#fee2e2', color: '#dc2626', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>Failed Emails</div>
            <h3>{stats.failedNotifications}</h3>
          </div>
        </div>
      </div>

      {/* Main Administrative Navigation tabs */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '2rem' }}>
        <button 
          onClick={() => setActiveTab('doctors')}
          className={`btn ${activeTab === 'doctors' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, transform: 'none' }}
        >
          <User size={18} /> Manage Doctors & Leaves
        </button>
        <button 
          onClick={() => { setActiveTab('logs'); fetchLogs(); }}
          className={`btn ${activeTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, transform: 'none' }}
        >
          <Mail size={18} /> SMTP Notification Logs
        </button>
        <button 
          onClick={() => { fetchStats(); fetchDoctors(); fetchLogs(); showToast("Dashboard synced", "info"); }}
          className="btn btn-secondary"
          style={{ marginLeft: 'auto' }}
        >
          <RefreshCw size={16} /> Sync Data
        </button>
      </div>

      {/* Render Tabs */}
      {activeTab === 'doctors' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          
          {/* Doctor profiles & builder */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Create Doctor Form */}
            <div className="card">
              <h3 style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Plus size={20} style={{ color: 'var(--primary)' }} /> Add New Doctor Account</h3>
              <form onSubmit={handleCreateDoctor}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input type="text" className="form-control" placeholder="Dr. Sarah Stone" value={docName} onChange={(e) => setDocName(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Specialization</label>
                    <input type="text" className="form-control" placeholder="Dermatology" value={docSpec} onChange={(e) => setDocSpec(e.target.value)} required />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input type="email" className="form-control" placeholder="stone@clinic.com" value={docEmail} onChange={(e) => setDocEmail(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input type="password" className="form-control" placeholder="Create secure password" value={docPassword} onChange={(e) => setDocPassword(e.target.value)} required />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Slot Duration (Min)</label>
                    <select className="form-control" value={docDuration} onChange={(e) => setDocDuration(e.target.value)}>
                      <option value="15">15 Min</option>
                      <option value="30">30 Min</option>
                      <option value="45">45 Min</option>
                      <option value="60">60 Min</option>
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group">
                      <label className="form-label">Hours Start</label>
                      <input type="time" className="form-control" value={docStart} onChange={(e) => setDocStart(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Hours End</label>
                      <input type="time" className="form-control" value={docEnd} onChange={(e) => setDocEnd(e.target.value)} required />
                    </div>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={submittingDoc}>
                  {submittingDoc ? "Creating Profile..." : "Register Doctor Profile"}
                </button>
              </form>
            </div>

            {/* Doctors list */}
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>Registered Doctor Accounts</h3>
              {doctors.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No doctors registered yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {doctors.map((doc) => (
                    <div 
                      key={doc.id} 
                      onClick={() => setSelectedDoctor(doc)}
                      className={`card card-interactive ${selectedDoctor?.id === doc.id ? 'active' : ''}`}
                      style={{ 
                        padding: '1rem', 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        borderColor: selectedDoctor?.id === doc.id ? 'var(--primary)' : 'var(--border)',
                        backgroundColor: selectedDoctor?.id === doc.id ? 'var(--primary-light)' : 'white'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--primary-dark)' }}>{doc.fullName}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{doc.email}</div>
                        <div style={{ fontSize: '0.85rem', display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                          <span><strong>Spec:</strong> {doc.doctorProfile?.specialization}</span>
                          <span><strong>Hours:</strong> {doc.doctorProfile?.workingHoursStart}-{doc.doctorProfile?.workingHoursEnd}</span>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Select & Manage &rarr;</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Leave configurations */}
          <div className="card">
            {selectedDoctor ? (
              <div>
                <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
                  Manage Leaves: {selectedDoctor.fullName}
                </h3>
                
                {/* Add Leave Form */}
                <form onSubmit={handleAddLeave} style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: '#f8fafc', borderRadius: 'var(--radius-sm)' }}>
                  <h4 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Calendar size={16} style={{ color: 'var(--primary)' }} /> Log Leave Date
                  </h4>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">Leave Date</label>
                      <input 
                        type="date" 
                        className="form-control" 
                        min={new Date().toISOString().split('T')[0]}
                        value={leaveDate} 
                        onChange={(e) => setLeaveDate(e.target.value)} 
                        required 
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={submittingLeave}>
                      {submittingLeave ? "Logging..." : "Apply Leave"}
                    </button>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--danger)', marginTop: '0.5rem', fontWeight: 600 }}>
                    ⚠️ Note: Applying leave automatically cancels bookings on this date and alerts patients.
                  </p>
                </form>

                {/* Leaves list */}
                <h4>Existing Leave Schedules</h4>
                {doctorLeaves.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.9rem' }}>No leaves logged for this doctor.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                    {doctorLeaves.map((leave) => (
                      <div key={leave.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {new Date(leave.leaveDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                        </span>
                        <button 
                          onClick={() => handleDeleteLeave(leave.id)}
                          className="btn btn-secondary" 
                          style={{ padding: '0.35rem 0.65rem', color: 'var(--danger)' }}
                        >
                          <Trash2 size={16} /> Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: 'var(--text-muted)' }}>
                <Calendar size={48} style={{ marginBottom: '1rem', color: 'var(--border)' }} />
                <p>Select a doctor profile to manage leave days, cancel overlapping appointments, and review logs.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* SMTP logs audit */
        <div className="card">
          <h3 style={{ marginBottom: '1.25rem' }}>System Email Logs Audit</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
            Review status of registration confirmations, doctor leave alerts, medication reminders, and automatic retry attempts.
          </p>

          <div className="table-wrapper">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Recipient Email</th>
                  <th>Notification Type</th>
                  <th>Delivery Status</th>
                  <th>Retry Attempts</th>
                  <th>Error Log</th>
                  <th>Queued Date</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No notification logs found.</td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ fontWeight: 600 }}>{log.recipientEmail}</td>
                      <td>
                        <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', borderRadius: '4px', backgroundColor: '#f1f5f9', fontWeight: 600 }}>
                          {log.type.replace('_', ' ')}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-${log.status.toLowerCase()}`}>
                          {log.status}
                        </span>
                      </td>
                      <td>{log.retryCount} / 5</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--danger)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.errorMessage}>
                        {log.errorMessage || '—'}
                      </td>
                      <td>{new Date(log.createdAt).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
