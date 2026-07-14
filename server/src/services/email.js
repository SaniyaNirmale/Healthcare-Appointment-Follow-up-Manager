import nodemailer from 'nodemailer';
import { prisma } from '../db.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Create transporter if SMTP settings are present
let transporter = null;
if (
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
) {
  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } catch (error) {
    console.error("Failed to initialize Nodemailer SMTP transporter:", error);
  }
} else {
  console.log("SMTP configuration is not fully defined in .env. Emails will be logged locally.");
}

/**
 * Directly attempts to send an email. Uses Mock mode if transporter is not configured.
 */
export async function sendEmailDirectly(to, subject, html, text) {
  const from = process.env.EMAIL_FROM || 'no-reply@clinicmanager.com';

  if (transporter) {
    try {
      await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
      });
      return { success: true };
    } catch (error) {
      console.error(`SMTP delivery failed to ${to}:`, error);
      throw error;
    }
  } else {
    // Mock delivery - save to local directory and log
    try {
      const emailDir = path.resolve('temp/emails');
      if (!fs.existsSync(emailDir)) {
        fs.mkdirSync(emailDir, { recursive: true });
      }

      const timestamp = new Date().getTime();
      const sanitizedTo = to.replace(/[^a-zA-Z0-9]/g, '_');
      const filepath = path.join(emailDir, `${timestamp}_${sanitizedTo}.html`);

      const emailContent = `
<!-- SMTP Mock Send -->
<strong>TO:</strong> ${to}<br/>
<strong>FROM:</strong> ${from}<br/>
<strong>SUBJECT:</strong> ${subject}<br/>
<hr/>
<strong>TEXT CONTENT:</strong><br/>
<pre>${text}</pre>
<hr/>
<strong>HTML CONTENT:</strong><br/>
<div>${html}</div>
`;

      fs.writeFileSync(filepath, emailContent, 'utf-8');
      console.log(`[MOCK EMAIL SENT] to: ${to} | Subject: ${subject} | Logged to: ${filepath}`);
      return { success: true, mockPath: filepath };
    } catch (err) {
      console.error("Failed to write mock email to disk:", err);
      throw err;
    }
  }
}

/**
 * Queues an email notification in the database for asynchronous processing.
 */
export async function queueEmailNotification(recipientEmail, type, subject, html, text) {
  try {
    const payload = JSON.stringify({ subject, html, text });
    const notification = await prisma.notificationLog.create({
      data: {
        recipientEmail,
        type,
        status: 'PENDING',
        payload,
        retryCount: 0,
      },
    });
    return notification;
  } catch (error) {
    console.error("Failed to queue email notification:", error);
    // Return a dummy object to not break the caller
    return { id: 'failed_queue', recipientEmail, type };
  }
}
