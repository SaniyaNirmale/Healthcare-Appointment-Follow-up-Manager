import { prisma } from './db.js';
import bcrypt from 'bcryptjs';

async function main() {
  console.log("Seeding database...");

  // Clean existing data
  await prisma.slotHold.deleteMany({});
  await prisma.medicationReminder.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.doctorLeave.deleteMany({});
  await prisma.appointment.deleteMany({});
  await prisma.doctorProfile.deleteMany({});
  await prisma.user.deleteMany({});

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('password123', salt);

  // 1. (Deleted seeded Admin account as requested so user can create it themselves)


  // 2. (Deleted seeded doctor accounts as requested so Admin can add them manually)
  
  // 3. (Deleted seeded patient account as requested)

  console.log("\nDatabase seeded successfully!");
  console.log("Password for all accounts: password123");
}


main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


