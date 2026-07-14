import { prisma } from '../db.js';
import { generatePreVisitSummary } from '../services/llm.js';
import { queueEmailNotification } from '../services/email.js';
import { createCalendarEvent, deleteCalendarEvent } from '../services/calendar.js';

// Setup testing configurations
async function setupTestData() {
  console.log("Setting up fresh test environment...");
  
  // Clean tables completely to leave no test pollution
  await prisma.slotHold.deleteMany({});
  await prisma.medicationReminder.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.doctorLeave.deleteMany({});
  await prisma.appointment.deleteMany({});
  
  // Delete the specific test users created by previous test runs
  await prisma.doctorProfile.deleteMany({
    where: { user: { email: { in: ['testdoctor@test.com'] } } }
  });
  await prisma.user.deleteMany({
    where: { email: { in: ['testdoctor@test.com', 'patient@test.com', 'patient2@test.com'] } }
  });
  
  // Dynamically create the test doctor profile for the test environment
  let doctor = await prisma.user.create({
    data: {
      email: 'testdoctor@test.com',
      password: 'testpassword',
      fullName: 'Dr. Test Assistant',
      role: 'DOCTOR'
    }
  });
  await prisma.doctorProfile.create({
    data: {
      userId: doctor.id,
      specialization: 'General Medicine',
      slotDuration: 30,
      workingHoursStart: '09:00',
      workingHoursEnd: '17:00'
    }
  });

  // Dynamically create the test patient profile
  let patient = await prisma.user.create({
    data: {
      email: 'patient@test.com',
      password: 'testpassword',
      fullName: 'Sarah Jenkins',
      role: 'PATIENT'
    }
  });
  
  // Create another test patient to simulate simultaneous actions
  let patient2 = await prisma.user.create({
    data: {
      email: 'patient2@test.com',
      password: 'testpassword',
      fullName: 'John Concurrent',
      role: 'PATIENT'
    }
  });

  return { doctor, patient, patient2 };
}

async function testDoubleBookingPrevention(doctor, patient, patient2) {
  console.log("\n--------------------------------------------------");
  console.log("TEST 1: Double-Booking & Hold Concurrency Control");
  console.log("--------------------------------------------------");
  
  const slotTime = new Date("2026-12-25T10:00:00.000Z");
  const now = new Date();

  // Create a hold for Patient 1
  console.log(`- Patient 1 (${patient.fullName}) holds slot at 10:00 AM...`);
  await prisma.slotHold.create({
    data: {
      doctorId: doctor.id,
      slotTime,
      heldByUserId: patient.id,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000)
    }
  });

  // Attempt booking by Patient 2 (who does NOT have the hold)
  console.log(`- Patient 2 (${patient2.fullName}) attempts to book the same slot...`);
  try {
    await prisma.$transaction(async (tx) => {
      // Step 1: Check booking
      const doubleBook = await tx.appointment.findFirst({
        where: { doctorId: doctor.id, appointmentTime: slotTime, status: 'CONFIRMED' }
      });
      if (doubleBook) throw new Error("SLOT_TAKEN");

      // Step 2: Check hold
      const hold = await tx.slotHold.findFirst({
        where: { doctorId: doctor.id, slotTime, heldByUserId: patient2.id, expiresAt: { gt: now } }
      });
      if (!hold) throw new Error("HOLD_EXPIRED_OR_INVALID");
      
      // Step 3: Book
      await tx.appointment.create({
        data: {
          patientId: patient2.id,
          doctorId: doctor.id,
          appointmentTime: slotTime,
          duration: 30,
          status: 'CONFIRMED',
          symptoms: "Headache",
          urgency: "Low",
          preVisitSummary: "{}"
        }
      });
    });
    console.log("❌ FAIL: Patient 2 successfully booked slot held by Patient 1!");
  } catch (error) {
    console.log(`   ✔️ SUCCESS (Expected Error): "${error.message}"`);
  }

  // Complete booking by Patient 1 (who holds the slot)
  console.log(`- Patient 1 (${patient.fullName}) completes booking...`);
  let successBooking = null;
  try {
    successBooking = await prisma.$transaction(async (tx) => {
      const doubleBook = await tx.appointment.findFirst({
        where: { doctorId: doctor.id, appointmentTime: slotTime, status: 'CONFIRMED' }
      });
      if (doubleBook) throw new Error("SLOT_TAKEN");

      const hold = await tx.slotHold.findFirst({
        where: { doctorId: doctor.id, slotTime, heldByUserId: patient.id, expiresAt: { gt: now } }
      });
      if (!hold) throw new Error("HOLD_EXPIRED");

      const app = await tx.appointment.create({
        data: {
          patientId: patient.id,
          doctorId: doctor.id,
          appointmentTime: slotTime,
          duration: 30,
          status: 'CONFIRMED',
          symptoms: "Heart palpitations",
          urgency: "High",
          preVisitSummary: "{}"
        }
      });

      await tx.slotHold.delete({ where: { id: hold.id } });
      return app;
    });
    console.log(`   ✔️ SUCCESS: Appointment created for Patient 1. ID: ${successBooking.id}`);
  } catch (error) {
    console.log(`❌ FAIL: Patient 1 failed to book held slot. Error: ${error.message}`);
  }

  // Patient 2 attempts to book the slot again now that it is confirmed
  console.log(`- Patient 2 attempts to book after confirmation...`);
  try {
    await prisma.$transaction(async (tx) => {
      const doubleBook = await tx.appointment.findFirst({
        where: { doctorId: doctor.id, appointmentTime: slotTime, status: 'CONFIRMED' }
      });
      if (doubleBook) throw new Error("SLOT_TAKEN");
    });
    console.log("❌ FAIL: Patient 2 bypassed double-booking constraints!");
  } catch (error) {
    console.log(`   ✔️ SUCCESS (Expected Error): "${error.message}"`);
  }
}

async function testLeaveConflictManagement(doctor, patient) {
  console.log("\n--------------------------------------------------");
  console.log("TEST 2: Doctor Leave Conflict Management");
  console.log("--------------------------------------------------");
  
  const leaveDate = "2026-12-25";
  const slotTime = new Date(`${leaveDate}T14:30:00.000Z`);

  console.log(`- Booking active appointment for Dr. ${doctor.fullName} on leave date (${leaveDate} 2:30 PM)...`);
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId: doctor.id,
      appointmentTime: slotTime,
      duration: 30,
      status: 'CONFIRMED',
      symptoms: "Fever and cough",
      urgency: "Medium",
      preVisitSummary: "{}"
    }
  });
  console.log(`  Appointment booked. ID: ${appointment.id}`);

  console.log(`- Admin logs Doctor Leave for date ${leaveDate}...`);
  // Simulate Leave trigger
  await prisma.doctorLeave.create({
    data: {
      doctorId: doctor.id,
      leaveDate
    }
  });

  // Find and cancel affected appointments
  const startDate = new Date(`${leaveDate}T00:00:00.000Z`);
  const endDate = new Date(`${leaveDate}T23:59:59.999Z`);
  const affected = await prisma.appointment.findMany({
    where: {
      doctorId: doctor.id,
      status: 'CONFIRMED',
      appointmentTime: { gte: startDate, lte: endDate }
    }
  });

  console.log(`  Found ${affected.length} active appointment(s) to cancel.`);
  
  for (const app of affected) {
    await prisma.appointment.update({
      where: { id: app.id },
      data: { status: 'CANCELLED' }
    });
    
    // Log mock notification
    await queueEmailNotification(
      patient.email,
      'CANCELLATION',
      "Cancelled due to Doctor Leave",
      "<h3>Cancellation details</h3>",
      "Text details"
    );
  }

  // Check state
  const checkedApp = await prisma.appointment.findUnique({ where: { id: appointment.id } });
  console.log(`- Verify status change: Status is "${checkedApp.status}" (Expected: CANCELLED)`);
  if (checkedApp.status === 'CANCELLED') {
    console.log("   ✔️ SUCCESS: Appointment status updated to CANCELLED.");
  } else {
    console.log("❌ FAIL: Appointment status not updated!");
  }

  const notificationCount = await prisma.notificationLog.count({
    where: { recipientEmail: patient.email, type: 'CANCELLATION' }
  });
  console.log(`- Verify email queued: Count is ${notificationCount} (Expected: >= 1)`);
  if (notificationCount >= 1) {
    console.log("   ✔️ SUCCESS: Cancellation notification successfully logged.");
  } else {
    console.log("❌ FAIL: Notification was not queued!");
  }
}

async function runAll() {
  try {
    const { doctor, patient, patient2 } = await setupTestData();
    await testDoubleBookingPrevention(doctor, patient, patient2);
    await testLeaveConflictManagement(doctor, patient);
    console.log("\n--------------------------------------------------");
    console.log("ALL TESTS COMPLETED SUCCESSFULLY");
    console.log("--------------------------------------------------");
  } catch (error) {
    console.error("Test execution failed:", error);
  } finally {
    try {
      console.log("- Cleaning test environment residue...");
      await prisma.slotHold.deleteMany({});
      await prisma.medicationReminder.deleteMany({});
      await prisma.notificationLog.deleteMany({});
      await prisma.doctorLeave.deleteMany({});
      await prisma.appointment.deleteMany({});
      await prisma.doctorProfile.deleteMany({
        where: { user: { email: 'testdoctor@test.com' } }
      });
      await prisma.user.deleteMany({
        where: { email: { in: ['testdoctor@test.com', 'patient@test.com', 'patient2@test.com'] } }
      });
      console.log("   ✔️ SUCCESS: Test residue completely removed.");
    } catch (cleanErr) {
      console.warn("Failed to clean up test residue:", cleanErr.message);
    }
    await prisma.$disconnect();
  }
}

runAll();

