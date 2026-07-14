import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function initDb() {
  try {
    // Enable WAL mode for better concurrency performance in SQLite
    await prisma.$executeRawUnsafe(`PRAGMA journal_mode=WAL;`);
    
    // SQLite partial unique index: ensures doctor is only booked for a slot if it is active (status = CONFIRMED)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_appointment 
      ON Appointment (doctorId, appointmentTime) 
      WHERE status = 'CONFIRMED';
    `);
    
    console.log("Database initialized with WAL mode and partial unique index constraints.");
  } catch (error) {
    console.error("Database initialization warning:", error);
  }
}

export { prisma };
