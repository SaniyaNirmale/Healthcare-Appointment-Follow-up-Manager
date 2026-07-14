import express from 'express';
import { prisma } from '../db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { generatePreVisitSummary } from '../services/llm.js';
import { queueEmailNotification } from '../services/email.js';
import { createCalendarEvent } from '../services/calendar.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole(['PATIENT']));

/**
 * @route   GET /api/patient/doctors
 * @desc    Search and list all doctors by specialization (optional query)
 * @access  Private (Patient)
 */
router.get('/doctors', async (req, res) => {
  const { specialization } = req.query;

  try {
    const doctors = await prisma.user.findMany({
      where: {
        role: 'DOCTOR',
        doctorProfile: specialization ? {
          specialization: {
            contains: specialization
          }
        } : {}
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        doctorProfile: true
      }
    });
    res.json(doctors);
  } catch (error) {
    console.error("Search doctors error:", error);
    res.status(500).json({ message: "Server error searching doctors." });
  }
});

/**
 * @route   GET /api/patient/doctors/:id/available-slots
 * @desc    Get all time slots for a doctor on a specific date, marking holds/bookings
 * @access  Private (Patient)
 */
router.get('/doctors/:id/available-slots', async (req, res) => {
  const { id } = req.params;
  const { date } = req.query; // Expect "YYYY-MM-DD"

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: "Please provide a valid date in YYYY-MM-DD format." });
  }

  try {
    const doctor = await prisma.user.findFirst({
      where: { id, role: 'DOCTOR' },
      include: { doctorProfile: true }
    });

    if (!doctor || !doctor.doctorProfile) {
      return res.status(404).json({ message: "Doctor or profile not found." });
    }

    // 1. Check if doctor is on leave
    const leave = await prisma.doctorLeave.findUnique({
      where: {
        doctorId_leaveDate: { doctorId: id, leaveDate: date }
      }
    });

    if (leave) {
      return res.json({
        onLeave: true,
        slots: []
      });
    }

    // 2. Generate slots based on working hours and slot duration
    const profile = doctor.doctorProfile;
    const [startHour, startMin] = profile.workingHoursStart.split(':').map(Number);
    const [endHour, endMin] = profile.workingHoursEnd.split(':').map(Number);
    const slotDuration = profile.slotDuration;

    // Create slot list for the day
    const slots = [];
    const now = new Date();

    // Start of doctor working day
    let currentSlotTime = new Date(`${date}T${profile.workingHoursStart}:00.000Z`);
    const endWorkTime = new Date(`${date}T${profile.workingHoursEnd}:00.000Z`);

    // Fetch existing confirmed/completed appointments
    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId: id,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        appointmentTime: {
          gte: new Date(`${date}T00:00:00.000Z`),
          lte: new Date(`${date}T23:59:59.999Z`)
        }
      }
    });

    // Fetch active slot holds (expiresAt > now)
    const activeHolds = await prisma.slotHold.findMany({
      where: {
        doctorId: id,
        expiresAt: { gt: now },
        slotTime: {
          gte: new Date(`${date}T00:00:00.000Z`),
          lte: new Date(`${date}T23:59:59.999Z`)
        }
      }
    });

    while (currentSlotTime < endWorkTime) {
      const slotStart = new Date(currentSlotTime);
      const slotEnd = new Date(slotStart.getTime() + slotDuration * 60 * 1000);
      
      // Format clean time label e.g. "09:30"
      const timeLabel = slotStart.toISOString().substring(11, 16);

      // Check bookings
      const isBooked = appointments.some(app => 
        new Date(app.appointmentTime).getTime() === slotStart.getTime()
      );

      // Check holds
      const currentHold = activeHolds.find(hold => 
        new Date(hold.slotTime).getTime() === slotStart.getTime()
      );

      const isHeld = !!currentHold;
      const isHeldByMe = currentHold ? currentHold.heldByUserId === req.user.id : false;

      // Ensure slot is in the future
      const isPast = slotStart.getTime() < now.getTime();

      slots.push({
        time: timeLabel,
        dateTime: slotStart.toISOString(),
        duration: slotDuration,
        available: !isBooked && !isPast && (!isHeld || isHeldByMe),
        isBooked,
        isHeld,
        isHeldByMe,
        isPast
      });

      // Advance by slotDuration minutes
      currentSlotTime = new Date(currentSlotTime.getTime() + slotDuration * 60 * 1000);
    }

    res.json({
      onLeave: false,
      slots
    });
  } catch (error) {
    console.error("Fetch available slots error:", error);
    res.status(500).json({ message: "Server error calculating slots." });
  }
});

/**
 * @route   POST /api/patient/hold-slot
 * @desc    Hold an available time slot for 5 minutes
 * @access  Private (Patient)
 */
router.post('/hold-slot', async (req, res) => {
  const { doctorId, slotTime } = req.body; // slotTime should be ISO string

  if (!doctorId || !slotTime) {
    return res.status(400).json({ message: "Doctor ID and slot time are required." });
  }

  try {
    const slotDate = new Date(slotTime);
    const now = new Date();

    if (slotDate < now) {
      return res.status(400).json({ message: "Cannot hold a slot in the past." });
    }

    // Use a transaction to safely handle concurrent holds
    const result = await prisma.$transaction(async (tx) => {
      // 1. Check if slot is already booked
      const booking = await tx.appointment.findFirst({
        where: {
          doctorId,
          appointmentTime: slotDate,
          status: { in: ['CONFIRMED', 'COMPLETED'] }
        }
      });

      if (booking) {
        throw new Error("SLOT_BOOKED");
      }

      // 2. Check if another user holds this slot
      const existingHold = await tx.slotHold.findFirst({
        where: {
          doctorId,
          slotTime: slotDate,
          expiresAt: { gt: now },
          heldByUserId: { not: req.user.id }
        }
      });

      if (existingHold) {
        throw new Error("SLOT_HELD");
      }

      // 3. Clear any other holds for THIS user on this slot or doctor to prevent spamming
      await tx.slotHold.deleteMany({
        where: {
          heldByUserId: req.user.id,
          doctorId
        }
      });

      // 4. Create new slot hold expiring in 5 minutes
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
      const hold = await tx.slotHold.create({
        data: {
          doctorId,
          slotTime: slotDate,
          heldByUserId: req.user.id,
          expiresAt
        }
      });

      return hold;
    });

    res.json({
      message: "Slot held successfully for 5 minutes.",
      hold: result
    });
  } catch (error) {
    if (error.message === "SLOT_BOOKED") {
      return res.status(400).json({ message: "This slot is already booked." });
    }
    if (error.message === "SLOT_HELD") {
      return res.status(400).json({ message: "This slot is currently held by another patient." });
    }
    console.error("Hold slot error:", error);
    res.status(500).json({ message: "Server error holding slot." });
  }
});

/**
 * @route   POST /api/patient/book
 * @desc    Confirm booking by supplying symptoms. Generates LLM summaries & notifications.
 * @access  Private (Patient)
 */
router.post('/book', async (req, res) => {
  const { doctorId, slotTime, symptoms } = req.body;

  if (!doctorId || !slotTime || !symptoms || symptoms.trim() === "") {
    return res.status(400).json({ message: "Please fill out symptoms and select a slot." });
  }

  try {
    const slotDate = new Date(slotTime);
    const now = new Date();

    const doctor = await prisma.user.findFirst({
      where: { id: doctorId, role: 'DOCTOR' },
      include: { doctorProfile: true }
    });

    if (!doctor || !doctor.doctorProfile) {
      return res.status(404).json({ message: "Doctor profile not found." });
    }

    // Enforce lock using transaction
    const newAppointment = await prisma.$transaction(async (tx) => {
      // 1. Double check booking
      const doubleBook = await tx.appointment.findFirst({
        where: {
          doctorId,
          appointmentTime: slotDate,
          status: 'CONFIRMED'
        }
      });

      if (doubleBook) {
        throw new Error("SLOT_TAKEN");
      }

      // 2. Check hold expiration
      const hold = await tx.slotHold.findFirst({
        where: {
          doctorId,
          slotTime: slotDate,
          heldByUserId: req.user.id,
          expiresAt: { gt: now }
        }
      });

      if (!hold) {
        throw new Error("HOLD_EXPIRED");
      }

      // 3. AI pre-visit generation (runs within transaction to ensure data integrity)
      // Since generating is fast, we call it here. We wrap it to handle failure gracefully.
      let urgency = "Medium";
      let preVisitSummary = "Symptom summary processing.";
      let parsedSummary = {};

      try {
        parsedSummary = await generatePreVisitSummary(symptoms);
        urgency = parsedSummary.urgency || "Medium";
        preVisitSummary = JSON.stringify({
          chiefComplaint: parsedSummary.chiefComplaint || symptoms,
          suggestedQuestions: parsedSummary.suggestedQuestions || []
        });
      } catch (llmError) {
        console.error("LLM Pre-visit generation failure, writing placeholders:", llmError);
        preVisitSummary = JSON.stringify({
          chiefComplaint: symptoms.split(/[.!?]/)[0] || "General symptom consultation",
          suggestedQuestions: [
            "How long have you felt these symptoms?",
            "What makes them better or worse?",
            "Are you taking any medications?"
          ]
        });
      }

      // 4. Create appointment
      const appointment = await tx.appointment.create({
        data: {
          patientId: req.user.id,
          doctorId,
          appointmentTime: slotDate,
          duration: doctor.doctorProfile.slotDuration,
          status: 'CONFIRMED',
          symptoms,
          urgency,
          preVisitSummary
        },
        include: {
          patient: true,
          doctor: true
        }
      });

      // 5. Delete slot hold
      await tx.slotHold.delete({
        where: { id: hold.id }
      });

      return { appointment, parsedSummary };
    });

    const appointment = newAppointment.appointment;
    const summaryData = newAppointment.parsedSummary;

    // Trigger Google Calendar Sync (Async fallback handles it)
    createCalendarEvent(appointment.id).catch(err => 
      console.error(`Google Calendar creation error for ${appointment.id}:`, err)
    );

    // Queue booking emails for both patient and doctor
    const patientSubject = `Appointment Confirmed: Dr. ${doctor.fullName} on ${slotDate.toLocaleString()}`;
    const patientText = `Dear ${appointment.patient.fullName},\n\nYour appointment with Dr. ${doctor.fullName} is confirmed.\n\nTime: ${slotDate.toLocaleString()}\nUrgency Level: ${appointment.urgency}\n\nBe well,\nClinic Team`;
    const patientHtml = `
      <h3>Appointment Confirmed</h3>
      <p>Dear <strong>${appointment.patient.fullName}</strong>,</p>
      <p>Your healthcare appointment has been successfully booked.</p>
      <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 15px 0;">
        <p style="margin: 0;"><strong>Doctor:</strong> Dr. ${doctor.fullName}</p>
        <p style="margin: 5px 0 0 0;"><strong>Date & Time:</strong> ${slotDate.toLocaleString()}</p>
        <p style="margin: 5px 0 0 0;"><strong>Urgency Assessment:</strong> ${appointment.urgency}</p>
      </div>
      <p>A Google Calendar invite has been scheduled. If you need to cancel or reschedule, please use the Patient Dashboard.</p>
    `;

    await queueEmailNotification(appointment.patient.email, 'BOOKING_CONFIRMATION', patientSubject, patientHtml, patientText);

    const doctorSubject = `New Appointment: ${appointment.patient.fullName} on ${slotDate.toLocaleString()}`;
    const doctorText = `Dear Dr. ${doctor.fullName},\n\nA new appointment has been scheduled by patient ${appointment.patient.fullName}.\n\nTime: ${slotDate.toLocaleString()}\nUrgency Level: ${appointment.urgency}\nChief Complaint: ${summaryData.chiefComplaint || symptoms}\n\nPlease check the portal to view full details.`;
    const doctorHtml = `
      <h3>New Booking Scheduled</h3>
      <p>Dear <strong>Dr. ${doctor.fullName}</strong>,</p>
      <p>A patient has scheduled an appointment with you:</p>
      <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 15px 0;">
        <p style="margin: 0;"><strong>Patient:</strong> ${appointment.patient.fullName}</p>
        <p style="margin: 5px 0 0 0;"><strong>Date & Time:</strong> ${slotDate.toLocaleString()}</p>
      </div>
      <h4>Pre-Visit Assessment</h4>
      <ul>
        <li><strong>Urgency:</strong> ${appointment.urgency}</li>
        <li><strong>Chief Complaint:</strong> ${summaryData.chiefComplaint || symptoms}</li>
      </ul>
      <p>Please access your dashboard for symptom summaries and suggested questions.</p>
    `;

    await queueEmailNotification(doctor.email, 'BOOKING_CONFIRMATION', doctorSubject, doctorHtml, doctorText);

    res.status(201).json({
      message: "Appointment successfully booked and synced.",
      appointment
    });
  } catch (error) {
    if (error.message === "SLOT_TAKEN") {
      return res.status(400).json({ message: "This slot has already been booked by another patient." });
    }
    if (error.message === "HOLD_EXPIRED") {
      return res.status(400).json({ message: "Your slot hold expired. Please re-select the slot and try again." });
    }
    console.error("Booking confirmation error:", error);
    res.status(500).json({ message: "Server error confirming your booking." });
  }
});

/**
 * @route   GET /api/patient/appointments
 * @desc    Get all appointments for the logged-in patient
 * @access  Private (Patient)
 */
router.get('/appointments', async (req, res) => {
  try {
    const appointments = await prisma.appointment.findMany({
      where: { patientId: req.user.id },
      include: {
        doctor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            doctorProfile: true
          }
        }
      },
      orderBy: { appointmentTime: 'desc' }
    });
    res.json(appointments);
  } catch (error) {
    console.error("Fetch patient appointments error:", error);
    res.status(500).json({ message: "Server error fetching appointments." });
  }
});

/**
 * @route   POST /api/patient/appointments/:id/cancel
 * @desc    Cancel an appointment
 * @access  Private (Patient)
 */
router.post('/appointments/:id/cancel', async (req, res) => {
  const { id } = req.params;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id, patientId: req.user.id },
      include: { patient: true, doctor: true }
    });

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found." });
    }

    if (appointment.status === 'CANCELLED') {
      return res.status(400).json({ message: "Appointment is already cancelled." });
    }

    // Cancel in DB
    const cancelled = await prisma.appointment.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    // Delete Google Calendar Event
    deleteCalendarEvent(id).catch(err => 
      console.error(`Google Calendar deletion error for ${id}:`, err)
    );

    // Queue cancellation email to Doctor
    const doctorSubject = `Appointment Cancelled by Patient: ${appointment.patient.fullName}`;
    const doctorText = `Dear Dr. ${appointment.doctor.fullName},\n\nYour appointment with patient ${appointment.patient.fullName} scheduled for ${new Date(appointment.appointmentTime).toLocaleString()} has been cancelled by the patient.\n\nClinic Management`;
    const doctorHtml = `
      <h3>Appointment Cancelled by Patient</h3>
      <p>Dear <strong>Dr. ${appointment.doctor.fullName}</strong>,</p>
      <p>Your appointment with patient <strong>${appointment.patient.fullName}</strong> scheduled for <strong>${new Date(appointment.appointmentTime).toLocaleString()}</strong> has been cancelled by the patient.</p>
    `;

    await queueEmailNotification(appointment.doctor.email, 'CANCELLATION', doctorSubject, doctorHtml, doctorText);

    res.json({ message: "Appointment cancelled successfully.", appointment: cancelled });
  } catch (error) {
    console.error("Cancel appointment error:", error);
    res.status(500).json({ message: "Server error cancelling appointment." });
  }
});

/**
 * @route   GET /api/patient/reminders
 * @desc    Get active medication reminders for the patient
 * @access  Private (Patient)
 */
router.get('/reminders', async (req, res) => {
  try {
    const reminders = await prisma.medicationReminder.findMany({
      where: { patientId: req.user.id },
      include: {
        appointment: {
          include: {
            doctor: {
              select: { fullName: true }
            }
          }
        }
      },
      orderBy: { nextSendTime: 'asc' }
    });
    res.json(reminders);
  } catch (error) {
    console.error("Fetch reminders error:", error);
    res.status(500).json({ message: "Server error fetching reminders." });
  }
});

export default router;
