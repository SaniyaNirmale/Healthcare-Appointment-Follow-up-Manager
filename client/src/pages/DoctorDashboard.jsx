import React, { useState, useEffect } from 'react';
import { useAuth, useToast } from '../context/AppContext.jsx';
import API_BASE from '../lib/api.js';
import { 
  Stethoscope, Calendar, CheckCircle2, XCircle, Clock, 
  HelpCircle, Sparkles, FileText, Plus, Trash2, CalendarCheck, Link, RefreshCw
} from 'lucide-react';
import confetti from 'canvas-confetti';


export default function DoctorDashboard() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [appointments, setAppointments] = useState([]);
  const [selectedApp, setSelectedApp] = useState(null);
  
  // Google Calendar status
  const [calendarStatus, setCalendarStatus] = useState({ connected: false, mockMode: true });
  const [fetchingCal, setFetchingCal] = useState(false);

  // Complete consultation form states
  const [notes, setNotes] = useState('');
  const [prescription, setPrescription] = useState('');
  const [reminders, setReminders] = useState([]); // [{ medicationName, dosage, frequency }]
  const [submitting, setSubmitting] = useState(false);

  // Fetch appointments list
  const fetchAppointments = async () => {
    try {
      const res = await fetch('${API_BASE}/api/doctor/appointments', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAppointments(data);
        
        // Refresh selected appointment if open
        if (selectedApp) {
          const updated = data.find(a => a.id === selectedApp.id);
          if (updated) setSelectedApp(updated);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch Google Calendar status
  const fetchCalendarStatus = async () => {
    try {
      const res = await fetch('${API_BASE}/api/doctor/calendar/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCalendarStatus(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchAppointments();
    fetchCalendarStatus();
  }, [token]);

  // Connect Google Calendar (Fetches auth url and redirects doctor)
  const handleConnectCalendar = async () => {
    setFetchingCal(true);
    try {
      const res = await fetch('${API_BASE}/api/doctor/calendar/auth-url', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || "Could not retrieve calendar link");
      }

      if (data.url) {
        window.location.href = data.url; // Redirect to google consent screen
      }
    } catch (error) {
      showToast(error.message, 'info'); // info toast for simulated mode warnings
    } finally {
      setFetchingCal(false);
    }
  };

  // Disconnect Google Calendar
  const handleDisconnectCalendar = async () => {
    try {
      const res = await fetch('${API_BASE}/api/doctor/calendar/disconnect', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showToast("Google Calendar disconnected.", "success");
        fetchCalendarStatus();
      }
    } catch (error) {
      showToast("Error disconnecting calendar.", "error");
    }
  };

  // Add a medication reminder row
  const addReminderRow = () => {
    setReminders([...reminders, { medicationName: '', dosage: '', frequency: 'daily' }]);
  };

  // Remove a medication reminder row
  const removeReminderRow = (index) => {
    setReminders(reminders.filter((_, i) => i !== index));
  };

  // Update a medication reminder row field
  const updateReminderField = (index, field, value) => {
    const updated = [...reminders];
    updated[index][field] = value;
    setReminders(updated);
  };

  // Submit Post-visit Notes & Prescriptions
  const handleCompleteConsultation = async (e) => {
    e.preventDefault();
    if (!notes) {
      return showToast("Please write clinical notes first.", "error");
    }
    if (submitting) return;
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/api/doctor/appointments/${selectedApp.id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          notes,
          prescription,
          reminders: reminders.filter(r => r.medicationName.trim() !== '')
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to submit consultation details");
      }

      showToast("Consultation completed successfully!", "success");
      
      // Celebratory Confetti explosion!
      try {
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 }
        });
      } catch (confettiErr) {
        console.error("Confetti trigger failed:", confettiErr);
      }

      setNotes('');


      setPrescription('');
      setReminders([]);
      
      // Reload appointment details
      fetchAppointments();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Parse JSON Pre-visit summaries safely
  const getPreVisitSummary = (summaryStr) => {
    try {
      return JSON.parse(summaryStr || '{}');
    } catch (e) {
      return { chiefComplaint: selectedApp?.symptoms, suggestedQuestions: [] };
    }
  };

  const selectedSummary = selectedApp ? getPreVisitSummary(selectedApp.preVisitSummary) : null;

  return (
    <div>
      {/* Calendar Connect Header */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Stethoscope /> Doctor Consultation Panel</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Review patient symptoms, submit clinical prescriptions, and manage calendar notifications.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              Calendar Integration:
            </span>
            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: calendarStatus.connected ? 'var(--secondary)' : 'var(--text-muted)' }}>
              {calendarStatus.connected ? "Connected to Google Calendar" : calendarStatus.mockMode ? "Simulated Calendar Mode" : "Calendar Offline"}
            </span>
          </div>
          {calendarStatus.connected ? (
            <button onClick={handleDisconnectCalendar} className="btn btn-secondary" style={{ padding: '0.5rem 1rem', color: 'var(--danger)' }}>
              Disconnect
            </button>
          ) : (
            <button onClick={handleConnectCalendar} className="btn btn-outline-primary" style={{ padding: '0.5rem 1rem' }} disabled={fetchingCal}>
              <Link size={16} /> Connect Google Calendar
            </button>
          )}
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Appointments Sidebar List */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem' }}>Patient Schedule</h3>
            <button onClick={fetchAppointments} className="btn btn-secondary" style={{ padding: '0.35rem 0.5rem' }} title="Reload list">
              <RefreshCw size={14} />
            </button>
          </div>

          {appointments.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No appointments booked.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '600px', overflowY: 'auto' }}>
              {appointments.map((app) => {
                const dateLabel = new Date(app.appointmentTime).toLocaleString(undefined, { 
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });
                return (
                  <div 
                    key={app.id} 
                    onClick={() => setSelectedApp(app)}
                    className="card card-interactive"
                    style={{ 
                      padding: '0.9rem',
                      borderColor: selectedApp?.id === app.id ? 'var(--primary)' : 'var(--border)',
                      backgroundColor: selectedApp?.id === app.id ? 'var(--primary-light)' : 'white'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--primary-dark)' }}>
                        {app.patient.fullName}
                      </span>
                      <span className={`urgency-badge ${app.urgency.toLowerCase()}`}>
                        {app.urgency}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Clock size={12} /> {dateLabel}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem' }}>
                      <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700,
                        backgroundColor: app.status === 'COMPLETED' ? '#d1fae5' : app.status === 'CANCELLED' ? '#fee2e2' : '#fef3c7',
                        color: app.status === 'COMPLETED' ? '#065f46' : app.status === 'CANCELLED' ? '#991b1b' : '#92400e'
                      }}>
                        {app.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Appointment Main Sheet */}
        <div className="card">
          {selectedApp ? (
            <div>
              {/* Header Details */}
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ color: 'var(--primary-dark)' }}>{selectedApp.patient.fullName}</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                    <span><strong>Email:</strong> {selectedApp.patient.email}</span>
                    <span><strong>Date & Time:</strong> {new Date(selectedApp.appointmentTime).toLocaleString()}</span>
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Assessment Urgency:</span>
                  <span className={`urgency-badge ${selectedApp.urgency.toLowerCase()}`} style={{ fontSize: '0.9rem', padding: '0.3rem 0.75rem' }}>
                    {selectedApp.urgency}
                  </span>
                </div>
              </div>

              {/* Pre-Visit summary Panel */}
              <div style={{
                background: 'linear-gradient(135deg, var(--primary-light) 0%, #e0f2fe 100%)',
                border: '1px solid #bae6fd',
                borderRadius: 'var(--radius-md)',
                padding: '1.5rem',
                marginBottom: '2rem'
              }}>
                <h3 style={{ fontSize: '1.05rem', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <Sparkles size={20} /> Pre-Visit Consultation Summary
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800, color: '#0369a1' }}>Chief Complaint:</span>
                    <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', marginTop: '0.15rem' }}>
                      {selectedSummary?.chiefComplaint || selectedApp.symptoms}
                    </p>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800, color: '#0369a1' }}>Patient symptoms:</span>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '0.15rem' }}>
                      "{selectedApp.symptoms}"
                    </p>
                  </div>
                  {selectedSummary?.suggestedQuestions?.length > 0 && (
                    <div>
                      <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800, color: '#0369a1' }}>Suggested Questions:</span>
                      <ul style={{ paddingLeft: '1.25rem', marginTop: '0.25rem', fontSize: '0.9rem', color: '#0f172a', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {selectedSummary.suggestedQuestions.map((q, idx) => (
                          <li key={idx} style={{ fontWeight: 500 }}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Consultation Results / Submission */}
              {selectedApp.status === 'CONFIRMED' ? (
                <div>
                  <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={20} style={{ color: 'var(--primary)' }} /> Log Consultation & Prescriptions</h3>
                  
                  <form onSubmit={handleCompleteConsultation}>
                    <div className="form-group">
                      <label className="form-label">Clinical Visit Notes (required)</label>
                      <textarea 
                        className="form-control" 
                        rows="4" 
                        placeholder="Detail patient symptoms diagnostics, assessment findings, and recommendations..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        required
                        style={{ resize: 'vertical' }}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Prescription (Rx Details - optional)</label>
                      <textarea 
                        className="form-control" 
                        rows="3" 
                        placeholder="Amoxicillin 500mg - Take 3 times daily for 7 days."
                        value={prescription}
                        onChange={(e) => setPrescription(e.target.value)}
                        style={{ resize: 'vertical' }}
                      />
                    </div>

                    {/* Reminders scheduler panel */}
                    {prescription && (
                      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem', backgroundColor: '#f8fafc', marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <h4 style={{ fontSize: '0.95rem' }}>Medication Reminders</h4>
                          <button type="button" onClick={addReminderRow} className="btn btn-outline-primary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
                            <Plus size={14} /> Add Medication Alert
                          </button>
                        </div>
                        {reminders.length === 0 ? (
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No reminders added. Patient will check their summary, but won't receive periodic alerts.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {reminders.map((rem, idx) => (
                              <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <input 
                                  type="text" 
                                  className="form-control" 
                                  placeholder="Medication Name" 
                                  value={rem.medicationName}
                                  onChange={(e) => updateReminderField(idx, 'medicationName', e.target.value)}
                                  required 
                                />
                                <input 
                                  type="text" 
                                  className="form-control" 
                                  placeholder="Dosage (e.g. 1 pill)" 
                                  value={rem.dosage}
                                  onChange={(e) => updateReminderField(idx, 'dosage', e.target.value)}
                                  required 
                                />
                                <select 
                                  className="form-control" 
                                  value={rem.frequency}
                                  onChange={(e) => updateReminderField(idx, 'frequency', e.target.value)}
                                >
                                  <option value="daily">Daily</option>
                                  <option value="twice_daily">Twice Daily</option>
                                  <option value="thrice_daily">Thrice Daily</option>
                                </select>
                                <button type="button" onClick={() => removeReminderRow(idx)} className="btn btn-secondary" style={{ padding: '0.5rem', color: 'var(--danger)' }}>
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
                      {submitting ? "Finalizing Consultation..." : "Submit Consultation & Summary"}
                    </button>
                  </form>
                </div>
              ) : selectedApp.status === 'COMPLETED' ? (
                /* Completed Consultation Details */
                <div>
                  <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-sm)', padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#166534' }}>
                    <CheckCircle2 size={20} /> <strong>Consultation Finalized</strong>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div>
                      <h4 style={{ fontSize: '0.95rem', color: 'var(--primary-dark)', marginBottom: '0.4rem' }}>Clinical Visit Notes</h4>
                      <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#f8fafc', whiteSpace: 'pre-wrap', fontSize: '0.95rem' }}>
                        {selectedApp.notes}
                      </div>
                    </div>

                    {selectedApp.prescription && (
                      <div>
                        <h4 style={{ fontSize: '0.95rem', color: 'var(--primary-dark)', marginBottom: '0.4rem' }}>Prescription (Rx)</h4>
                        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#eff6ff', whiteSpace: 'pre-wrap', fontSize: '0.95rem' }}>
                          {selectedApp.prescription}
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 style={{ fontSize: '0.95rem', color: 'var(--primary-dark)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Sparkles size={16} style={{ color: 'var(--primary)' }} /> Patient-Friendly Visit Summary
                      </h4>
                      <div style={{ padding: '1.25rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fdfbf7', whiteSpace: 'pre-wrap', fontSize: '0.95rem', borderLeft: '4px solid #d97706' }}>
                        {selectedApp.postVisitSummary}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Cancelled Appointment Details */
                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 'var(--radius-sm)', padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#991b1b' }}>
                  <XCircle size={20} /> <strong>Appointment Cancelled</strong>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', color: 'var(--text-muted)' }}>
              <Stethoscope size={64} style={{ marginBottom: '1.5rem', color: 'var(--border)' }} />
              <h3>No Patient Selected</h3>
              <p style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>Select a scheduled patient appointment from the sidebar to review symptoms, initiate complete consultation diagnostics, or connect Google Calendar.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
