import { google } from 'googleapis';
import { prisma } from '../db.js';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

/**
 * Helper to construct an OAuth2 Client
 */
function getOAuth2Client() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return null;
  }
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

/**
 * Returns whether Google OAuth is configured in environment variables
 */
export function isGoogleConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

/**
 * Generates Google Auth URL for doctors
 */
export function getAuthUrl(doctorId) {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    throw new Error("Google Calendar API is not configured on this server (missing environment variables).");
  }

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // crucial to get refresh token
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    prompt: 'consent',
    state: doctorId // pass doctorId so we can map the token on redirect callback
  });
}

/**
 * Handles Google OAuth callback, saving credentials for the doctor
 */
export async function handleOAuthCallback(code, doctorId) {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    throw new Error("Google OAuth configuration is missing.");
  }

  const { tokens } = await oauth2Client.getToken(code);
  
  if (!tokens.refresh_token) {
    // If we didn't get a refresh token, check if we already have one.
    // Google only sends the refresh token on the first authorization prompt (when prompt='consent').
    const existing = await prisma.doctorGoogleAuth.findUnique({
      where: { doctorId }
    });
    if (!existing) {
      throw new Error("Refresh token not received. Please revoke access from Google Account settings and connect again.");
    }
    return existing;
  }

  // Save or update the doctor's Google auth token
  const oauthRecord = await prisma.doctorGoogleAuth.upsert({
    where: { doctorId },
    update: { refreshToken: tokens.refresh_token },
    create: {
      doctorId,
      refreshToken: tokens.refresh_token
    }
  });

  return oauthRecord;
}

/**
 * Gets authenticated oauth2Client for a doctor
 */
async function getAuthorizedClientForDoctor(doctorId) {
  const authRecord = await prisma.doctorGoogleAuth.findUnique({
    where: { doctorId }
  });

  if (!authRecord) {
    return null;
  }

  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    return null;
  }

  oauth2Client.setCredentials({
    refresh_token: authRecord.refreshToken
  });

  return oauth2Client;
}

/**
 * Creates Google Calendar event for an appointment
 */
export async function createCalendarEvent(appointmentId) {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctor: true
      }
    });

    if (!appointment) return null;

    const doctorId = appointment.doctorId;
    const authClient = await getAuthorizedClientForDoctor(doctorId);

    const eventDetails = {
      summary: `Clinic Appointment: ${appointment.patient.fullName} with Dr. ${appointment.doctor.fullName}`,
      description: `Symptom Chief Complaint: ${JSON.parse(appointment.preVisitSummary || '{}').chiefComplaint || appointment.symptoms}\nUrgency: ${appointment.urgency}`,
      start: {
        dateTime: appointment.appointmentTime.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: new Date(appointment.appointmentTime.getTime() + appointment.duration * 60 * 1000).toISOString(),
        timeZone: 'UTC',
      },
      attendees: [
        { email: appointment.patient.email },
        { email: appointment.doctor.email }
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 },
        ],
      },
    };

    if (!authClient) {
      console.log(`[SIMULATED CALENDAR EVENT CREATION] Appointment: ${appointmentId} | Patient: ${appointment.patient.email} | Doctor: ${appointment.doctor.email}`);
      // Save a mock calendar event ID
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { calendarEventId: `mock-event-${appointmentId}` }
      });
      return `mock-event-${appointmentId}`;
    }

    const calendar = google.calendar({ version: 'v3', auth: authClient });
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: eventDetails,
      sendUpdates: 'all' // notifies attendees via email
    });

    const calendarEventId = response.data.id;
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { calendarEventId }
    });

    console.log(`[GOOGLE CALENDAR EVENT CREATED] ID: ${calendarEventId} for appointment ${appointmentId}`);
    return calendarEventId;
  } catch (error) {
    console.error(`Failed to create calendar event for appointment ${appointmentId}:`, error);
    // Don't break the application, fallback to mock status
    return null;
  }
}

/**
 * Updates Google Calendar event when appointment is rescheduled
 */
export async function updateCalendarEvent(appointmentId) {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctor: true
      }
    });

    if (!appointment || !appointment.calendarEventId) return;

    if (appointment.calendarEventId.startsWith('mock-event-')) {
      console.log(`[SIMULATED CALENDAR EVENT UPDATE] Appointment: ${appointmentId} rescheduled to ${appointment.appointmentTime}`);
      return;
    }

    const doctorId = appointment.doctorId;
    const authClient = await getAuthorizedClientForDoctor(doctorId);
    if (!authClient) return;

    const eventDetails = {
      summary: `Clinic Appointment: ${appointment.patient.fullName} with Dr. ${appointment.doctor.fullName} (RESCHEDULED)`,
      description: `Symptom Chief Complaint: ${JSON.parse(appointment.preVisitSummary || '{}').chiefComplaint || appointment.symptoms}\nUrgency: ${appointment.urgency}`,
      start: {
        dateTime: appointment.appointmentTime.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: new Date(appointment.appointmentTime.getTime() + appointment.duration * 60 * 1000).toISOString(),
        timeZone: 'UTC',
      },
      attendees: [
        { email: appointment.patient.email },
        { email: appointment.doctor.email }
      ]
    };

    const calendar = google.calendar({ version: 'v3', auth: authClient });
    await calendar.events.patch({
      calendarId: 'primary',
      eventId: appointment.calendarEventId,
      resource: eventDetails,
      sendUpdates: 'all'
    });

    console.log(`[GOOGLE CALENDAR EVENT UPDATED] ID: ${appointment.calendarEventId}`);
  } catch (error) {
    console.error(`Failed to update calendar event for appointment ${appointmentId}:`, error);
  }
}

/**
 * Deletes Google Calendar event on appointment cancellation
 */
export async function deleteCalendarEvent(appointmentId) {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId }
    });

    if (!appointment || !appointment.calendarEventId) return;

    if (appointment.calendarEventId.startsWith('mock-event-')) {
      console.log(`[SIMULATED CALENDAR EVENT DELETION] Event: ${appointment.calendarEventId} cancelled`);
      return;
    }

    const doctorId = appointment.doctorId;
    const authClient = await getAuthorizedClientForDoctor(doctorId);
    if (!authClient) return;

    const calendar = google.calendar({ version: 'v3', auth: authClient });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: appointment.calendarEventId,
      sendUpdates: 'all'
    });

    console.log(`[GOOGLE CALENDAR EVENT DELETED] ID: ${appointment.calendarEventId}`);
  } catch (error) {
    console.error(`Failed to delete calendar event for appointment ${appointmentId}:`, error);
  }
}
