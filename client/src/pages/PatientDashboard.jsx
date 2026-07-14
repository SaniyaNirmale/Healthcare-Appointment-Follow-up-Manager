import React, { useState, useEffect, useRef } from 'react';
import { useAuth, useToast } from '../context/AppContext.jsx';
import API_BASE from '../lib/api.js';
import { 
  Search, Calendar, Clock, Clipboard, AlertCircle, 
  Sparkles, CheckCircle2, Pill, ShieldAlert, X, ChevronRight, User
} from 'lucide-react';
import confetti from 'canvas-confetti';

export default function PatientDashboard() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [appointments, setAppointments] = useState([]);
  const [reminders, setReminders] = useState([]);
  
  // Booking flow states
  const [bookingActive, setBookingActive] = useState(false);
  const [specializations, setSpecializations] = useState([]);
  const [selectedSpec, setSelectedSpec] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  
  const [selectedDate, setSelectedDate] = useState('');
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [onLeave, setOnLeave] = useState(false);

  // Hold slot state
  const [heldSlot, setHeldSlot] = useState(null); // { time, dateTime }
  const [holdTimer, setHoldTimer] = useState(300); // 5 minutes in seconds
  const [symptoms, setSymptoms] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const timerRef = useRef(null);

  // Care summary view modal state
  const [activeSummaryApp, setActiveSummaryApp] = useState(null);

  // Fetch appointments and reminders
  const fetchDashboardData = async () => {
    try {
      const appRes = await fetch('${API_BASE}/api/patient/appointments', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const remRes = await fetch('${API_BASE}/api/patient/reminders', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (appRes.ok) {
        const data = await appRes.json();
        setAppointments(data);
      }
      if (remRes.ok) {
        const data = await remRes.json();
        setReminders(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch doctors and spec lists
  const fetchDoctorsAndSpecs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/patient/doctors${selectedSpec ? `?specialization=${selectedSpec}` : ''}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDoctors(data);

        // Build list of unique specializations if not selected
        if (!selectedSpec) {
          const specs = [...new Set(data.map(d => d.doctorProfile?.specialization).filter(Boolean))];
          setSpecializations(specs);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [token]);

  useEffect(() => {
    if (bookingActive) {
      fetchDoctorsAndSpecs();
    }
  }, [bookingActive, selectedSpec]);

  // Fetch available slots for selected doctor and date
  const fetchSlots = async () => {
    if (!selectedDoctor || !selectedDate) return;
    setLoadingSlots(true);
    setOnLeave(false);
    try {
      const res = await fetch(`${API_BASE}/api/patient/doctors/${selectedDoctor.id}/available-slots?date=${selectedDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setOnLeave(data.onLeave);
        setSlots(data.slots);
      } else {
        showToast(data.message || "Failed to load slots", "error");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchSlots();
  }, [selectedDoctor, selectedDate]);

  // Manage hold slot timer countdown
  useEffect(() => {
    if (heldSlot) {
      setHoldTimer(300); // Reset to 5 mins
      timerRef.current = setInterval(() => {
        setHoldTimer((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            showToast("Your slot hold has expired. Please choose a slot again.", "error");
            setHeldSlot(null);
            fetchSlots();
            return 300;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [heldSlot]);

  // Lock Hold Slot
  const handleHoldSlot = async (slot) => {
    try {
      const res = await fetch('${API_BASE}/api/patient/hold-slot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          doctorId: selectedDoctor.id,
          slotTime: slot.dateTime
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to lock time slot");
      }

      setHeldSlot(slot);
      showToast(data.message, 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  // Confirm Final Booking
  const handleConfirmBooking = async (e) => {
    e.preventDefault();
    if (!symptoms.trim()) {
      return showToast("Please describe your symptoms briefly.", "error");
    }
    if (bookingLoading) return;
    setBookingLoading(true);

    try {
      const res = await fetch('${API_BASE}/api/patient/book', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          doctorId: selectedDoctor.id,
          slotTime: heldSlot.dateTime,
          symptoms
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to finalize booking");
      }

      // Celebratory Confetti explosion!
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });

      showToast("Appointment booked successfully!", "success");
      
      // Reset Booking Flow
      setBookingActive(false);
      setSelectedDoctor(null);
      setSelectedDate('');
      setHeldSlot(null);
      setSymptoms('');

      // Refresh appointments list
      fetchDashboardData();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBookingLoading(false);
    }
  };

  // Cancel Appointment
  const handleCancelAppointment = async (appId) => {
    if (!window.confirm("Are you sure you want to cancel this appointment? This will remove it from your calendar.")) return;

    try {
      const res = await fetch(`${API_BASE}/api/patient/appointments/${appId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (res.ok) {
        showToast(data.message, 'success');
        fetchDashboardData();
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Format timer into MM:SS
  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}:${remainingSecs < 10 ? '0' : ''}${remainingSecs}`;
  };

  return (
    <div>
      {/* Header card with action button */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Patient Care Hub</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Schedule medical slots, review post-visit directives, and set automated reminders.</p>
        </div>
        {!bookingActive && (
          <button onClick={() => setBookingActive(true)} className="btn btn-primary">
            <Calendar size={18} /> Schedule New Appointment
          </button>
        )}
      </div>

      {/* RENDER BOOKING SCHEDULER WIZARD */}
      {bookingActive && (
        <div className="card" style={{ marginBottom: '2rem', border: '2px solid var(--primary)', position: 'relative' }}>
          <button 
            onClick={() => { setBookingActive(false); setHeldSlot(null); setSelectedDoctor(null); setSelectedDate(''); }}
            style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={20} />
          </button>

          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary-dark)', marginBottom: '1.5rem' }}>
            <Calendar /> Appointment Booking Wizard
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            {/* Step 1 & 2 left side */}
            <div>
              {/* Doctor Search & Select */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Search size={16} style={{ color: 'var(--primary)' }} /> 1. Select Specialization & Doctor
                </h4>
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <select 
                    className="form-control" 
                    value={selectedSpec} 
                    onChange={(e) => { setSelectedSpec(e.target.value); setSelectedDoctor(null); setSelectedDate(''); }}
                    style={{ flex: 1 }}
                  >
                    <option value="">All Specializations</option>
                    {specializations.map((spec, i) => (
                      <option key={i} value={spec}>{spec}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {doctors.map((doc) => (
                    <div 
                      key={doc.id}
                      onClick={() => { setSelectedDoctor(doc); setSelectedDate(''); }}
                      className={`card card-interactive`}
                      style={{ 
                        padding: '0.75rem 1rem', 
                        borderColor: selectedDoctor?.id === doc.id ? 'var(--primary)' : 'var(--border)',
                        backgroundColor: selectedDoctor?.id === doc.id ? 'var(--primary-light)' : 'white',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--primary-dark)' }}>{doc.fullName}</span>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {doc.doctorProfile?.specialization} | Duration: {doc.doctorProfile?.slotDuration} mins
                        </div>
                      </div>
                      {selectedDoctor?.id === doc.id ? (
                        <CheckCircle2 size={16} style={{ color: 'var(--primary)' }} />
                      ) : (
                        <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Date selection */}
              {selectedDoctor && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <h4 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Calendar size={16} style={{ color: 'var(--primary)' }} /> 2. Choose Date
                  </h4>
                  <input 
                    type="date" 
                    className="form-control" 
                    min={new Date().toISOString().split('T')[0]} 
                    value={selectedDate}
                    onChange={(e) => { setSelectedDate(e.target.value); setHeldSlot(null); }}
                  />
                </div>
              )}
            </div>

            {/* Time Slot display / Symptom checkout */}
            <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '2rem' }}>
              {selectedDoctor && selectedDate ? (
                <div>
                  {onLeave ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', textAlign: 'center' }}>
                      <ShieldAlert size={36} style={{ color: 'var(--urgency-medium)', marginBottom: '0.5rem' }} />
                      <h4 style={{ color: 'var(--urgency-medium)' }}>Doctor on Leave</h4>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Dr. {selectedDoctor.fullName} is out of the office on this date. Please select another date.</p>
                    </div>
                  ) : loadingSlots ? (
                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>Recalculating slot grids...</p>
                  ) : (
                    <div>
                      {!heldSlot ? (
                        <div>
                          <h4 style={{ marginBottom: '0.5rem' }}>3. Pick time slot</h4>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                            Working Hours: {selectedDoctor.doctorProfile?.workingHoursStart} - {selectedDoctor.doctorProfile?.workingHoursEnd}
                          </p>
                          {slots.length === 0 ? (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No slots available. They may be fully booked or in the past.</p>
                          ) : (
                            <div className="slots-container">
                              {slots.map((slot, index) => (
                                <button 
                                  key={index}
                                  type="button"
                                  onClick={() => slot.available && handleHoldSlot(slot)}
                                  disabled={!slot.available}
                                  className={`slot-item ${slot.isBooked ? 'booked' : slot.isHeldByMe ? 'held-by-me' : slot.isHeld ? 'held' : 'available'}`}
                                >
                                  {slot.time}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Symptom Fill Checkout (Held Slot) */
                        <div>
                          <div style={{ 
                            backgroundColor: 'var(--urgency-medium-bg)', 
                            border: '1px solid #f59e0b', 
                            padding: '0.75rem 1rem', 
                            borderRadius: 'var(--radius-sm)', 
                            marginBottom: '1.25rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <div>
                              <strong style={{ color: '#b45309', fontSize: '0.9rem' }}>Slot Held Successfully</strong>
                              <div style={{ fontSize: '0.8rem', color: '#b45309' }}>
                                Dr. {selectedDoctor.fullName} | {new Date(heldSlot.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--urgency-high)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                              <Clock size={16} /> {formatTime(holdTimer)}
                            </span>
                          </div>

                          <form onSubmit={handleConfirmBooking}>
                            <div className="form-group">
                              <label className="form-label">Briefly describe your symptoms</label>
                              <textarea 
                                className="form-control" 
                                rows="4" 
                                placeholder="Describe symptoms e.g. severe headache, mild fever for past 2 days, dry cough..."
                                value={symptoms}
                                onChange={(e) => setSymptoms(e.target.value)}
                                required
                              />
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                              <button type="button" onClick={() => setHeldSlot(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                                Change Slot
                              </button>
                              <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={bookingLoading}>
                                {bookingLoading ? "Analyzing & Booking..." : "Confirm & Book Slot"}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', color: 'var(--text-muted)' }}>
                  <Clock size={36} style={{ color: 'var(--border)', marginBottom: '0.5rem' }} />
                  <p style={{ fontSize: '0.85rem' }}>Choose doctor and date to view calendar slot availability.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN PATIENT VIEW GRIDS */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem' }}>
        
        {/* Appointments history */}
        <div className="card">
          <h3 style={{ marginBottom: '1.25rem' }}>Your Care Bookings</h3>
          {appointments.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No medical appointments scheduled yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {appointments.map((app) => {
                const appDate = new Date(app.appointmentTime);
                return (
                  <div key={app.id} className="animate-fade-in" style={{ display: 'flex', gap: '1rem', border: '1px solid var(--border)', padding: '1.25rem', borderRadius: 'var(--radius-md)' }}>
                    {/* Date Block */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: '70px', padding: '0.5rem', backgroundColor: '#f1f5f9', borderRadius: 'var(--radius-sm)' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                        {appDate.toLocaleString(undefined, { month: 'short' })}
                      </span>
                      <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary-dark)', lineHeight: 1.1 }}>
                        {appDate.getDate()}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        {appDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Details Block */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <h4 style={{ color: 'var(--primary-dark)', fontSize: '1.05rem' }}>Dr. {app.doctor.fullName}</h4>
                        <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700,
                          backgroundColor: app.status === 'COMPLETED' ? '#d1fae5' : app.status === 'CANCELLED' ? '#fee2e2' : '#fef3c7',
                          color: app.status === 'COMPLETED' ? '#065f46' : app.status === 'CANCELLED' ? '#991b1b' : '#92400e'
                        }}>
                          {app.status}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                        <strong>Specialization:</strong> {app.doctor.doctorProfile?.specialization}
                      </p>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '400px' }}>
                        <strong>Symptoms:</strong> "{app.symptoms}"
                      </p>

                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                        {app.status === 'COMPLETED' && (
                          <button onClick={() => setActiveSummaryApp(app)} className="btn btn-outline-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                            <Sparkles size={14} /> View Care Summary
                          </button>
                        )}
                        {app.status === 'CONFIRMED' && (
                          <button onClick={() => handleCancelAppointment(app.id)} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', color: 'var(--danger)' }}>
                            Cancel Booking
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Medication reminders panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Active Reminders */}
          <div className="card">
            <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Pill size={20} style={{ color: 'var(--primary)' }} /> Medication Schedule
            </h3>
            {reminders.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No active medication reminders configured.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {reminders.map((rem) => (
                  <div key={rem.id} className="animate-fade-in" style={{ border: '1px solid var(--border)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', backgroundColor: rem.status === 'ACTIVE' ? '#f0fdf4' : '#f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ color: 'var(--primary-dark)', fontSize: '0.95rem' }}>{rem.medicationName}</strong>
                      <span className="role-tag patient" style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem', backgroundColor: rem.status === 'ACTIVE' ? '#d1fae5' : '#e2e8f0', color: rem.status === 'ACTIVE' ? '#065f46' : '#64748b' }}>
                        {rem.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                      <span><strong>Dose:</strong> {rem.dosage}</span> | <span><strong>Freq:</strong> {rem.frequency.replace('_', ' ')}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Next email: {new Date(rem.nextSendTime).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CARE SUMMARY MODAL DIALOG */}
      {activeSummaryApp && (
        <div className="modal-overlay" onClick={() => setActiveSummaryApp(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary-dark)' }}>
                <Sparkles /> Consultation Summary
              </h3>
              <button onClick={() => setActiveSummaryApp(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <strong>Doctor:</strong> Dr. {activeSummaryApp.doctor.fullName} ({activeSummaryApp.doctor.doctorProfile?.specialization})
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Consultation Date: {new Date(activeSummaryApp.appointmentTime).toLocaleString()}
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--primary)' }}>Patient-Friendly Visit Summary:</span>
                <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fdfbf7', borderLeft: '4px solid #d97706', fontSize: '0.9rem', whiteSpace: 'pre-wrap', marginTop: '0.25rem' }}>
                  {activeSummaryApp.postVisitSummary}
                </div>
              </div>

              {activeSummaryApp.prescription && (
                <div>
                  <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--primary)' }}>Prescription (Rx Details):</span>
                  <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#eff6ff', borderLeft: '4px solid #3b82f6', fontSize: '0.9rem', whiteSpace: 'pre-wrap', marginTop: '0.25rem' }}>
                    {activeSummaryApp.prescription}
                  </div>
                </div>
              )}

              <div>
                <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-secondary)' }}>Your Reported symptoms:</span>
                <p style={{ fontStyle: 'italic', fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid var(--border)', marginTop: '0.25rem' }}>
                  "{activeSummaryApp.symptoms}"
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setActiveSummaryApp(null)} className="btn btn-primary">Close summary</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
