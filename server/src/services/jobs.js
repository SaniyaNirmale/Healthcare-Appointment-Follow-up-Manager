import { prisma } from '../db.js';
import { sendEmailDirectly } from './email.js';

let isProcessingEmails = false;
let isProcessingReminders = false;

/**
 * Processes the email notification queue (NotificationLog)
 */
export async function processEmailQueue() {
  if (isProcessingEmails) return;
  isProcessingEmails = true;

  try {
    // Find notifications that are PENDING or FAILED but have retry counts < 5
    const pendingNotifications = await prisma.notificationLog.findMany({
      where: {
        OR: [
          { status: 'PENDING' },
          { status: 'FAILED', retryCount: { lt: 5 } }
        ]
      },
      orderBy: { createdAt: 'asc' },
      take: 10 // process in small batches
    });

    for (const notification of pendingNotifications) {
      try {
        const payload = JSON.parse(notification.payload);
        
        await sendEmailDirectly(
          notification.recipientEmail,
          payload.subject,
          payload.html,
          payload.text
        );

        // Update to SENT on success
        await prisma.notificationLog.update({
          where: { id: notification.id },
          data: {
            status: 'SENT',
            updatedAt: new Date()
          }
        });
      } catch (error) {
        console.error(`Error sending queued email ${notification.id}:`, error.message);
        
        await prisma.notificationLog.update({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            retryCount: notification.retryCount + 1,
            errorMessage: error.message || String(error),
            updatedAt: new Date()
          }
        });
      }
    }
  } catch (error) {
    console.error("Error in processEmailQueue background worker:", error);
  } finally {
    isProcessingEmails = false;
  }
}

/**
 * Processes active medication reminders and schedules the next intervals
 */
export async function processMedicationReminders() {
  if (isProcessingReminders) return;
  isProcessingReminders = true;

  try {
    const now = new Date();
    
    // Find active reminders that are due
    const dueReminders = await prisma.medicationReminder.findMany({
      where: {
        status: 'ACTIVE',
        nextSendTime: { lte: now }
      },
      include: {
        patient: true,
        appointment: {
          include: {
            doctor: true
          }
        }
      }
    });

    for (const reminder of dueReminders) {
      try {
        // Send email warning/reminder
        const subject = `Medication Reminder: ${reminder.medicationName}`;
        const text = `Hello ${reminder.patient.fullName},\n\nThis is a reminder to take your medication:\n\n- Medication: ${reminder.medicationName}\n- Dosage: ${reminder.dosage}\n- Frequency: ${reminder.frequency.replace('_', ' ')}\n\nPrescribed by: Dr. ${reminder.appointment.doctor.fullName}\n\nBe well,\nClinic Appointment Manager`;
        
        const html = `
          <h2>Medication Reminder</h2>
          <p>Hello <strong>${reminder.patient.fullName}</strong>,</p>
          <p>This is a reminder to take your prescribed medication:</p>
          <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 15px 0;">
            <p style="margin: 0;"><strong>Medication:</strong> ${reminder.medicationName}</p>
            <p style="margin: 5px 0 0 0;"><strong>Dosage:</strong> ${reminder.dosage}</p>
            <p style="margin: 5px 0 0 0;"><strong>Frequency:</strong> ${reminder.frequency.replace('_', ' ')}</p>
          </div>
          <p>Prescribed by: Dr. ${reminder.appointment.doctor.fullName}</p>
          <br/>
          <hr/>
          <p style="font-size: 0.85em; color: #64748b;">This reminder is sent automatically by Clinic Appointment Manager.</p>
        `;

        // Queue email notification instead of direct sending to prevent blocking reminder updates
        const payload = JSON.stringify({ subject, html, text });
        await prisma.notificationLog.create({
          data: {
            recipientEmail: reminder.patient.email,
            type: 'MEDICATION',
            status: 'PENDING',
            payload,
            retryCount: 0
          }
        });

        // Calculate next send time based on frequency
        let hoursToAdd = 24; // default daily
        if (reminder.frequency === 'twice_daily') hoursToAdd = 12;
        else if (reminder.frequency === 'thrice_daily') hoursToAdd = 8;
        
        const nextSendTime = new Date(reminder.nextSendTime.getTime() + hoursToAdd * 60 * 60 * 1000);

        // Check if reminder limit reached (e.g. reminders are kept active for a maximum of 30 days or completed manually)
        // For simulation, let's keep scheduling next times unless marked completed, or auto-complete after 14 days of creation
        const durationLimit = 14 * 24 * 60 * 60 * 1000; // 14 days limit
        const totalDuration = now.getTime() - reminder.createdAt.getTime();
        
        const status = totalDuration >= durationLimit ? 'COMPLETED' : 'ACTIVE';

        await prisma.medicationReminder.update({
          where: { id: reminder.id },
          data: {
            nextSendTime,
            lastSentTime: now,
            status
          }
        });

        console.log(`[MEDICATION REMINDER PROCESSED] Patient: ${reminder.patient.email} | Medication: ${reminder.medicationName} | Next send: ${nextSendTime}`);
      } catch (err) {
        console.error(`Error processing medication reminder ${reminder.id}:`, err);
      }
    }
  } catch (error) {
    console.error("Error in processMedicationReminders background worker:", error);
  } finally {
    isProcessingReminders = false;
  }
}

/**
 * Initializes and starts background cron intervals
 */
export function startBackgroundWorkers() {
  console.log("Background workers initialized.");
  
  // Run email queue processing every 10 seconds
  setInterval(processEmailQueue, 10000);
  
  // Run medication reminder checks every 30 seconds
  setInterval(processMedicationReminders, 30000);
}
