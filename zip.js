import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const tempDir = './temp_zip';
const zipName = 'medical_appointment_manager.zip';

console.log("Starting code packaging...");

// Clean up old temporary files
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
if (fs.existsSync(zipName)) {
  fs.unlinkSync(zipName);
}

fs.mkdirSync(tempDir);

/**
 * Copies files recursively while ignoring bulky items
 */
function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  const isDirectory = stats.isDirectory();
  const baseName = path.basename(src);

  // Skip dependencies, local builds, SQLite databases, and git records
  if (
    baseName === 'node_modules' ||
    baseName === 'dist' ||
    baseName === '.git' ||
    baseName.startsWith('dev.db')
  ) {
    return;
  }

  if (isDirectory) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItem) => {
      copyRecursive(path.join(src, childItem), path.join(dest, childItem));
    });
  } else {
    // Ensure parent folder exists
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// Copy server and client folders
console.log("- Copying server source files...");
copyRecursive('./server', path.join(tempDir, 'server'));

console.log("- Copying client source files...");
copyRecursive('./client', path.join(tempDir, 'client'));

// Compress using powershell
console.log("- Compressing archive...");
try {
  execSync(`powershell -Command "Compress-Archive -Path ${tempDir}/* -DestinationPath ${zipName} -Force"`);
  console.log(`\n✔️ Successfully created ${zipName}!`);
} catch (err) {
  console.error("Zipping failed:", err.message);
} finally {
  console.log("- Cleaning up temp files...");
  fs.rmSync(tempDir, { recursive: true, force: true });
}
