import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDb } from './db.js';
import { startBackgroundWorkers, processEmailQueue, processMedicationReminders } from './services/jobs.js';

// Route Imports
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import doctorRoutes from './routes/doctor.js';
import patientRoutes from './routes/patient.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Body parser
app.use(express.json());

// API Route Bindings
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);

// Doctor routes handles both secure routes and the public google callback
app.use('/api/doctor', doctorRoutes);
app.use('/api/google', doctorRoutes); // fallback mapping to bind /api/google/oauth/callback

// Root ping
app.get('/ping', (req, res) => {
  res.json({ status: "healthy", message: "Healthcare Appointment Manager API is running." });
});

// Webhook for Serverless Cron Job execution (e.g. from Vercel cron)
app.get('/api/jobs/trigger', async (req, res) => {
  try {
    await processEmailQueue();
    await processMedicationReminders();
    res.json({ success: true, message: "Serverless background workers triggered successfully." });
  } catch (error) {
    console.error("Cron trigger error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled Server Error:", err);
  res.status(500).json({ 
    message: "A internal server error occurred.", 
    error: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

// App Startup
async function startServer() {
  // 1. Initialize Database
  await initDb();

  // 2. Start Background Workers for Medication Reminders & Email Retries
  // Only start intervals locally; on Vercel they will be triggered via cron URL
  if (!process.env.VERCEL) {
    startBackgroundWorkers();

    // 3. Listen
    app.listen(PORT, () => {
      console.log(`[SERVER RUNNING] http://localhost:${PORT}`);
    });
  } else {
    console.log("[SERVER RUNNING] Serverless mode enabled on Vercel.");
  }
}

startServer();

export default app;
