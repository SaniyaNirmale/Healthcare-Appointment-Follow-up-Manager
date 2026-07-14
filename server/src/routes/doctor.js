import express from 'express';
import { prisma } from '../db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { generatePostVisitSummary } from '../services/llm.js';
import { queueEmailNotification } from '../services/email.js';
import { getAuthUrl, handleOAuthCallback, isGoogleConfigured } from '../services/calendar.js';

const router = express.Router();

// ==========================================
// PUBLIC GOOGLE OAUTH CALLBACK ENDPOINT
// ==========================================
/**
 * @route   GET /api/google/oauth/callback
 * @desc    Public callback url for Google OAuth redirection
 * @access  Public
 */
router.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query; // state contains doctorId

  if (!code || !state) {
    return res.status(400).send("<h3>OAuth Error</h3><p>Authorization code or state is missing.</p>");
  }

  try {
    await handleOAuthCallback(code, state);
    
    // Redirect back to frontend dashboard with success indicator
    // Assuming frontend runs on localhost:5173 (standard Vite port)
    res.redirect('http://localhost:5173/dashboard?google_calendar=success');
  } catch (error) {
    console.error("Google OAuth Callback Error:", error);
    res.redirect(`http://localhost:5173/dashboard?google_calendar=error&message=${encodeURIComponent(error.message)}`);
  }
});

// ==========================================
// SECURE DOCTOR ONLY ENDPOINTS
// ==========================================
router.use(authenticateToken);
router.use(requireRole(['DOCTOR']));

/**
 * @route   GET /api/doctor/appointments
 * @desc    Get all appointments for the logged-in doctor
 * @access  Private (Doctor)
 */
router.get('/appointments', async (req, res) => {
  try {
    const appointments = await prisma.appointment.findMany({
      where: { doctorId: req.user.id },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            fullName: true
          }
        }
      },
      orderBy: { appointmentTime: 'desc' }
    });
    res.json(appointments);
  } catch (error) {
    console.error("Fetch doctor appointments error:", error);
    res.status(500).json({ message: "Server error fetching appointments." });
  }
});

/**
 * @route   POST /api/doctor/appointments/:id/complete
 * @desc    Submit clinical notes, generate patient-friendly summary, and schedule reminders
 * @access  Private (Doctor)
 */
router.post('/appointments/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { notes, prescription, reminders } = req.body; // reminders: [{ medicationName, dosage, frequency }]

  if (!notes) {
    return res.status(400).json({ message: "Please provide clinical notes." });
  }

  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id, doctorId: req.user.id },
      include: { patient: true, doctor: true }
    });

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found." });
    }

    if (appointment.status === 'COMPLETED') {
      return res.status(400).json({ message: "Appointment is already marked completed." });
    }

    // 1. Generate patient friendly summary using LLM (Gemini)
    console.log("Generating post-visit summary using LLM...");
    const postVisitSummary = await generatePostVisitSummary(notes);

    // 2. Update appointment
    const updatedAppointment = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        notes,
        prescription: prescription || null,
        postVisitSummary
      }
    });

    // 3. Setup Medication Reminders
    if (prescription && Array.isArray(reminders) && reminders.length > 0) {
      const reminderData = reminders.map((r) => {
        // First reminder is sent 1 hour from now for testing convenience
        const nextSendTime = new Date(Date.now() + 60 * 60 * 1000); 
        return {
          appointmentId: id,
          patientId: appointment.patientId,
          medicationName: r.medicationName,
          dosage: r.dosage,
          frequency: r.frequency, // 'daily', 'twice_daily', 'thrice_daily'
          nextSendTime,
          status: 'ACTIVE'
        };
      });

      await prisma.medicationReminder.createMany({
        data: reminderData
      });
    }

    // 4. Queue patient email with summary and prescription
    const subject = `Post-Visit Summary: Appointment with Dr. ${appointment.doctor.fullName}`;
    const text = `Hello ${appointment.patient.fullName},\n\nDr. ${appointment.doctor.fullName} has updated your appointment records with a summary and prescription details:\n\n---\nPOST-VISIT SUMMARY:\n${postVisitSummary}\n\n---\nPRESCRIPTION:\n${prescription || 'No prescription written.'}\n\nMedication reminders have been configured and will be emailed according to your schedule.\n\nTake care,\nClinic Management`;
    
    const html = `
      <h3>Your Visit Summary</h3>
      <p>Hello <strong>${appointment.patient.fullName}</strong>,</p>
      <p>Here is the patient-friendly summary and instructions from your visit with <strong>Dr. ${appointment.doctor.fullName}</strong>:</p>
      
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin: 15px 0;">
        <h4 style="margin-top: 0; color: #0f172a;">Doctor's Summary</h4>
        <p style="white-space: pre-wrap; margin-bottom: 0;">${postVisitSummary}</p>
      </div>

      ${prescription ? `
      <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; padding: 15px; border-radius: 8px; margin: 15px 0;">
        <h4 style="margin-top: 0; color: #0369a1;">Prescription & Dosages</h4>
        <p style="white-space: pre-wrap; margin-bottom: 0;"><strong>Rx:</strong><br/>${prescription}</p>
      </div>
      ` : ''}

      <p>If you were prescribed medications, reminders have been scheduled to alert you via email.</p>
      <br/>
      <p>Be well,</p>
      <p><strong>Clinic Care Team</strong></p>
    `;

    await queueEmailNotification(appointment.patient.email, 'REMINDER', subject, html, text);

    res.json({
      message: "Appointment completed and summary generated.",
      appointment: updatedAppointment
    });
  } catch (error) {
    console.error("Complete appointment error:", error);
    res.status(500).json({ message: "Server error finalizing appointment." });
  }
});

/**
 * @route   GET /api/doctor/calendar/auth-url
 * @desc    Generate Google Consent URL for calendar access
 * @access  Private (Doctor)
 */
router.get('/calendar/auth-url', (req, res) => {
  try {
    if (!isGoogleConfigured()) {
      return res.status(400).json({
        message: "Google Calendar connection is running in Mock Mode because credentials are not configured in the server's .env file."
      });
    }
    const url = getAuthUrl(req.user.id);
    res.json({ url });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @route   GET /api/doctor/calendar/status
 * @desc    Check Google Calendar status for the doctor
 * @access  Private (Doctor)
 */
router.get('/calendar/status', async (req, res) => {
  try {
    const authRecord = await prisma.doctorGoogleAuth.findUnique({
      where: { doctorId: req.user.id }
    });
    res.json({
      connected: !!authRecord,
      mockMode: !isGoogleConfigured()
    });
  } catch (error) {
    res.status(500).json({ message: "Error checking calendar link status." });
  }
});

/**
 * @route   DELETE /api/doctor/calendar/disconnect
 * @desc    Revoke Google Calendar credentials locally
 * @access  Private (Doctor)
 */
router.delete('/calendar/disconnect', async (req, res) => {
  try {
    await prisma.doctorGoogleAuth.deleteMany({
      where: { doctorId: req.user.id }
    });
    res.json({ message: "Google Calendar disconnected." });
  } catch (error) {
    res.status(500).json({ message: "Error disconnecting calendar." });
  }
});

export default router;
