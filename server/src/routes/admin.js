import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { queueEmailNotification } from '../services/email.js';
import { deleteCalendarEvent } from '../services/calendar.js';

const router = express.Router();

// Enforce Admin role for all routes in this file
router.use(authenticateToken);
router.use(requireRole(['ADMIN']));

/**
 * @route   GET /api/admin/doctors
 * @desc    Get all doctors and profiles
 * @access  Private (Admin)
 */
router.get('/doctors', async (req, res) => {
  try {
    const doctors = await prisma.user.findMany({
      where: { role: 'DOCTOR' },
      select: {
        id: true,
        email: true,
        fullName: true,
        doctorProfile: true,
      }
    });
    res.json(doctors);
  } catch (error) {
    console.error("Fetch doctors error:", error);
    res.status(500).json({ message: "Server error fetching doctors." });
  }
});

/**
 * @route   POST /api/admin/doctors
 * @desc    Create a new Doctor user and profile
 * @access  Private (Admin)
 */
router.post('/doctors', async (req, res) => {
  const { email, password, fullName, specialization, slotDuration, workingHoursStart, workingHoursEnd } = req.body;

  if (!email || !password || !fullName || !specialization || !workingHoursStart || !workingHoursEnd) {
    return res.status(400).json({ message: "Please fill all required fields." });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({ message: "A user with this email already exists." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Sanitize fullName by removing leading "Dr." or "Dr " prefix (case-insensitive)
    let cleanFullName = fullName.trim();
    if (cleanFullName.toLowerCase().startsWith('dr.')) {
      cleanFullName = cleanFullName.substring(3).trim();
    } else if (cleanFullName.toLowerCase().startsWith('dr ')) {
      cleanFullName = cleanFullName.substring(3).trim();
    }

    // Create user and profile in transaction
    const newDoctor = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          password: hashedPassword,
          fullName: cleanFullName,
          role: 'DOCTOR'
        }
      });

      const profile = await tx.doctorProfile.create({
        data: {
          userId: user.id,
          specialization,
          slotDuration: slotDuration ? parseInt(slotDuration) : 30,
          workingHoursStart,
          workingHoursEnd
        }
      });

      return { user, profile };
    });

    res.status(201).json({
      message: "Doctor profile created successfully.",
      doctor: {
        id: newDoctor.user.id,
        email: newDoctor.user.email,
        fullName: newDoctor.user.fullName,
        doctorProfile: newDoctor.profile
      }
    });
  } catch (error) {
    console.error("Create doctor error:", error);
    res.status(500).json({ message: "Server error creating doctor profile." });
  }
});

/**
 * @route   PUT /api/admin/doctors/:id
 * @desc    Update doctor profile
 * @access  Private (Admin)
 */
router.put('/doctors/:id', async (req, res) => {
  const { id } = req.params;
  const { fullName, specialization, slotDuration, workingHoursStart, workingHoursEnd } = req.body;

  try {
    const doctor = await prisma.user.findFirst({
      where: { id, role: 'DOCTOR' }
    });

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found." });
    }

    // Sanitize name if updated
    let cleanFullName = fullName ? fullName.trim() : undefined;
    if (cleanFullName) {
      if (cleanFullName.toLowerCase().startsWith('dr.')) {
        cleanFullName = cleanFullName.substring(3).trim();
      } else if (cleanFullName.toLowerCase().startsWith('dr ')) {
        cleanFullName = cleanFullName.substring(3).trim();
      }
    }

    await prisma.$transaction(async (tx) => {
      if (cleanFullName) {
        await tx.user.update({
          where: { id },
          data: { fullName: cleanFullName }
        });
      }


      await tx.doctorProfile.update({
        where: { userId: id },
        data: {
          specialization: specialization || undefined,
          slotDuration: slotDuration ? parseInt(slotDuration) : undefined,
          workingHoursStart: workingHoursStart || undefined,
          workingHoursEnd: workingHoursEnd || undefined
        }
      });
    });

    const updated = await prisma.user.findUnique({
      where: { id },
      include: { doctorProfile: true }
    });

    res.json({ message: "Doctor profile updated successfully.", doctor: updated });
  } catch (error) {
    console.error("Update doctor error:", error);
    res.status(500).json({ message: "Server error updating doctor." });
  }
});

/**
 * @route   POST /api/admin/doctors/:id/leaves
 * @desc    Mark doctor on leave for a specific date and notify affected patients
 * @access  Private (Admin)
 */
router.post('/doctors/:id/leaves', async (req, res) => {
  const { id } = req.params;
  const { leaveDate } = req.body; // Expect "YYYY-MM-DD"

  if (!leaveDate || !/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) {
    return res.status(400).json({ message: "Please provide a valid leave date in YYYY-MM-DD format." });
  }

  try {
    const doctor = await prisma.user.findFirst({
      where: { id, role: 'DOCTOR' },
      include: { doctorProfile: true }
    });

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found." });
    }

    // Check if leave already exists
    const existingLeave = await prisma.doctorLeave.findUnique({
      where: {
        doctorId_leaveDate: { doctorId: id, leaveDate }
      }
    });

    if (existingLeave) {
      return res.status(400).json({ message: "Doctor is already marked on leave for this date." });
    }

    // Add Doctor Leave
    await prisma.doctorLeave.create({
      data: {
        doctorId: id,
        leaveDate
      }
    });

    // Find affected appointments on this date
    // Set search range for the entire day (UTC or local, depending on string match)
    const startDate = new Date(`${leaveDate}T00:00:00.000Z`);
    const endDate = new Date(`${leaveDate}T23:59:59.999Z`);

    const affectedAppointments = await prisma.appointment.findMany({
      where: {
        doctorId: id,
        status: 'CONFIRMED',
        appointmentTime: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        patient: true,
        doctor: true
      }
    });

    const cancellations = [];

    // Cancel appointments, trigger google calendar deletion, and queue emails
    for (const appointment of affectedAppointments) {
      // 1. Update appointment status in DB
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: 'CANCELLED' }
      });

      // 2. Delete event from Google Calendar (runs asynchronously)
      deleteCalendarEvent(appointment.id).catch(err => 
        console.error(`Error deleting calendar event for ${appointment.id}:`, err)
      );

      // 3. Queue email to Patient
      const patientSubject = `Appointment Cancelled: Dr. ${doctor.fullName} on Leave`;
      const patientText = `Dear ${appointment.patient.fullName},\n\nWe regret to inform you that your appointment with Dr. ${doctor.fullName} scheduled for ${new Date(appointment.appointmentTime).toLocaleString()} has been cancelled due to the doctor being on leave. Please log back in to reschedule.\n\nBe well,\nClinic Management`;
      const patientHtml = `
        <h3>Appointment Cancelled</h3>
        <p>Dear <strong>${appointment.patient.fullName}</strong>,</p>
        <p>We regret to inform you that your appointment with <strong>Dr. ${doctor.fullName}</strong> scheduled for <strong>${new Date(appointment.appointmentTime).toLocaleString()}</strong> has been cancelled due to the doctor being on leave.</p>
        <p>You can log back into your portal to reschedule with Dr. ${doctor.fullName} or choose another doctor.</p>
        <br/>
        <p>Be well,</p>
        <p><strong>Clinic Management Team</strong></p>
      `;

      await queueEmailNotification(appointment.patient.email, 'CANCELLATION', patientSubject, patientHtml, patientText);

      // 4. Queue email to Doctor
      const doctorSubject = `Leave Conflict: Appointment with ${appointment.patient.fullName} Cancelled`;
      const doctorText = `Dear Dr. ${doctor.fullName},\n\nYour appointment with patient ${appointment.patient.fullName} scheduled for ${new Date(appointment.appointmentTime).toLocaleString()} has been cancelled because you were marked on leave for ${leaveDate}.`;
      const doctorHtml = `
        <h3>Leave Conflict Cancellation Notice</h3>
        <p>Dear <strong>Dr. ${doctor.fullName}</strong>,</p>
        <p>An appointment with patient <strong>${appointment.patient.fullName}</strong> scheduled for <strong>${new Date(appointment.appointmentTime).toLocaleString()}</strong> has been cancelled because you were marked on leave for <strong>${leaveDate}</strong>.</p>
      `;

      await queueEmailNotification(doctor.email, 'CANCELLATION', doctorSubject, doctorHtml, doctorText);

      cancellations.push({
        appointmentId: appointment.id,
        patientName: appointment.patient.fullName,
        appointmentTime: appointment.appointmentTime
      });
    }

    res.json({
      message: `Doctor successfully marked on leave for ${leaveDate}.`,
      affectedBookingsCancelledCount: affectedAppointments.length,
      cancelledBookings: cancellations
    });
  } catch (error) {
    console.error("Leave creation error:", error);
    res.status(500).json({ message: "Server error recording doctor leave." });
  }
});

/**
 * @route   GET /api/admin/doctors/:id/leaves
 * @desc    Get all leave dates for a doctor
 * @access  Private (Admin)
 */
router.get('/doctors/:id/leaves', async (req, res) => {
  const { id } = req.params;
  try {
    const leaves = await prisma.doctorLeave.findMany({
      where: { doctorId: id },
      orderBy: { leaveDate: 'asc' }
    });
    res.json(leaves);
  } catch (error) {
    console.error("Fetch doctor leaves error:", error);
    res.status(500).json({ message: "Server error fetching doctor leaves." });
  }
});

/**
 * @route   DELETE /api/admin/doctors/:id/leaves/:leaveId
 * @desc    Remove a leave record
 * @access  Private (Admin)
 */
router.delete('/doctors/:id/leaves/:leaveId', async (req, res) => {
  const { leaveId } = req.params;
  try {
    await prisma.doctorLeave.delete({
      where: { id: leaveId }
    });
    res.json({ message: "Leave record removed successfully." });
  } catch (error) {
    console.error("Delete leave error:", error);
    res.status(500).json({ message: "Server error deleting leave record." });
  }
});

/**
 * @route   GET /api/admin/notifications
 * @desc    Get system notification logs
 * @access  Private (Admin)
 */
router.get('/notifications', async (req, res) => {
  try {
    const logs = await prisma.notificationLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json(logs);
  } catch (error) {
    console.error("Fetch notifications error:", error);
    res.status(500).json({ message: "Server error fetching notification logs." });
  }
});

/**
 * @route   GET /api/admin/dashboard
 * @desc    Get dashboard metrics
 * @access  Private (Admin)
 */
router.get('/dashboard', async (req, res) => {
  try {
    const doctorCount = await prisma.user.count({ where: { role: 'DOCTOR' } });
    const patientCount = await prisma.user.count({ where: { role: 'PATIENT' } });
    const appointmentCount = await prisma.appointment.count();
    const activeHolds = await prisma.slotHold.count({
      where: { expiresAt: { gte: new Date() } }
    });
    const notificationFailureCount = await prisma.notificationLog.count({
      where: { status: 'FAILED' }
    });

    res.json({
      doctors: doctorCount,
      patients: patientCount,
      appointments: appointmentCount,
      activeHolds,
      failedNotifications: notificationFailureCount
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ message: "Server error fetching dashboard metrics." });
  }
});

export default router;
