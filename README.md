# MedClinic Manager - Healthcare Appointment & Follow-up Manager

🌐 **Hosted Application URL**: [https://healthcare-appointment-follow-up-manager-4ug5-kpxtbil2i.vercel.app](https://healthcare-appointment-follow-up-manager-4ug5-kpxtbil2i.vercel.app)

MedClinic Manager is a complete, role-based clinic management system designed for Patients, Doctors, and Administrators. It implements secure authentication, dynamic slot scheduling with a 5-minute concurrency hold, automatic leave-conflict cancellations, automated pre-visit symptom analysis, and post-consultation visit summaries with background-queued email alerts and medication reminders.

---

## 🚀 Quick Start Setup Guide

### 1. Prerequisites
- **Node.js** (v18.0.0 or higher is recommended)
- **npm** (v9.0.0 or higher)

### 2. Dependency Installation
First, open your terminal and install dependencies for both the backend and frontend components.

```bash
# Install Server dependencies
cd server
npm install

# Install Client dependencies
cd ../client
npm install --legacy-peer-deps
```

### 3. Database Initialization & Seeding
The database is built on SQLite, which requires zero external configuration. Run the commands below in the `server/` directory to construct tables, generate the Prisma Client, and seed testing accounts.

```bash
cd ../server

# Generate Prisma Client & sync SQLite database tables
npx prisma db push

# Initialize the database
npm run db:seed
```

### 4. Running the Application Locally
To launch both components locally, open two terminal windows:

#### Terminal 1: Backend Server (runs on port `5000`)
```bash
cd server
npm run dev
```

#### Terminal 2: Vite React Frontend Client (runs on port `5173`)
```bash
cd client
npm run dev
```

Open your browser and navigate to **[http://localhost:5173](http://localhost:5173)** to access the login page.

---

## 🔑 Starting with a Clean Slate
The database starts as a completely clean slate with zero registered users (no patients, doctors, or administrators). You have full control over all credentials:

### Setup Steps:
1. **Register Admin**: Open the app, click the **Register Account** tab, enter your details, select **Administrator** in the "Register As" dropdown, and click register.
2. **Add Doctors**: Log in with your new Administrator account and register doctors (they will instantly appear on the patient booking screen).
3. **Register Patients**: Patients can sign up by choosing **Patient** in the Register Account page, then log in to book appointments.



---

## 🛠️ Environment Variables Config (.env)

The server configuration resides in `server/.env`. A template is provided in `server/.env.example`.

```env
PORT=5000
DATABASE_URL="file:./dev.db"
JWT_SECRET="medical_appointment_manager_jwt_secret_key_2026"
SYMPTOM_ANALYSIS_KEY="YOUR_OPTIONAL_API_KEY"

# Email Configuration (Nodemailer SMTP)
# Leave blank to enable local simulation (emails are saved under server/temp/emails/)
SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASS=""
EMAIL_FROM="no-reply@clinicmanager.com"

# Google Calendar OAuth 2.0 Credentials
# Leave blank to enable local simulation (generates mock events automatically)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_REDIRECT_URI="http://localhost:5000/api/google/oauth/callback"
```

---

## 📅 Google Calendar OAuth 2.0 Integration Setup

To connect live doctor calendars, configure the Google Cloud Console credentials:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project and navigate to **APIs & Services > Credentials**.
3. Configure your **OAuth Consent Screen** (external type) and add scope `.../auth/calendar.events`.
4. Click **Create Credentials > OAuth Client ID** (select **Web Application**).
5. Under **Authorized Redirect URIs**, insert:
   `http://localhost:5000/api/google/oauth/callback`
6. Copy the **Client ID** and **Client Secret** and add them to your `server/.env`.
7. Start your server. Navigate to the **Doctor Dashboard**, click **Connect Google Calendar**, and authenticate.

> [!NOTE]
> If Google Calendar API credentials are not set in the `.env` file, the server automatically defaults to **Simulated Mode**, generating local calendar identifiers without breaking application flows.

---

## 🧠 Automated Symptom Analysis & Visit Summaries

The system includes an automated symptom classification and visit note translation layer. It includes safety fallbacks when API keys are not configured.

### 1. Pre-Visit Symptom Analysis (Patient Checkout)
- **How it works**: When a patient submits symptoms, the system analyses the text and returns an urgency level (Low / Medium / High), chief complaint, and three suggested consultation questions for the doctor.
- **Storage**: Captured as structured data in `Appointment.preVisitSummary` and `Appointment.urgency`.
- **Fallback**: If the analysis service is unavailable, a built-in rule-based engine identifies key medical terms (e.g. "chest pain", "shortness of breath" → High; "fever", "diarrhea" → Medium) and populates standard diagnostic questions automatically.

### 2. Post-Visit Patient-Friendly Summary (Doctor Consultation)
- **How it works**: After a doctor submits clinical notes, the system converts those notes into a clear, jargon-free patient-friendly summary with medication schedule and follow-up steps.
- **Storage**: Stored in `Appointment.postVisitSummary`.
- **Fallback**: If the service is unavailable, the system formats the doctor's notes with clean Markdown headers so patients can still read the consultation instructions.

---

## 🌐 Core API Endpoints

### 1. Authentication Router (`/api/auth`)
- `POST /register` - Registers a patient (roles are locked to PATIENT on signup).
- `POST /login` - Sign-in for Patients, Doctors, and Admins. Returns JWT.
- `GET /me` - Fetches the authenticated user profile.

### 2. Patient Router (`/api/patient`)
- `GET /doctors` - Search doctors by name or specialization.
- `GET /doctors/:id/available-slots?date=YYYY-MM-DD` - Evaluates slot availability, including holds and leaves.
- `POST /hold-slot` - Creates a 5-minute temporary reservation lock.
- `POST /book` - Confirms booking with symptoms, running the LLM pre-visit analysis.
- `GET /appointments` - Lists past and future appointments.
- `POST /appointments/:id/cancel` - Cancels booking, removes calendar event, and queues notifications.
- `GET /reminders` - Fetches active medication reminders.

### 3. Doctor Router (`/api/doctor`)
- `GET /appointments` - Returns appointments scheduled with the authenticated doctor.
- `POST /appointments/:id/complete` - Completes consultation, creates reminders, and runs LLM summary conversion.
- `GET /calendar/status` - Checks Google Calendar links.
- `GET /calendar/auth-url` - Returns Google Consent URL.
- `DELETE /calendar/disconnect` - Disconnects Google integration.

### 4. Admin Router (`/api/admin`)
- `POST /doctors` - Registers new doctor profiles with working hours.
- `GET /doctors` - Lists doctor profiles.
- `POST /doctors/:id/leaves` - Marks doctor on leave, triggering bulk cancellations, calendar deletions, and patient alerts.
- `GET /notifications` - Audits queued emails and retry logs.
- `GET /dashboard` - Returns system diagnostics metrics.

---

## 📦 Deliverables
- **medical_appointment_manager.zip**: Source code archive.
- **system_design.md**: In-depth design write-up covering concurrency controls.
- **README.md**: Setup guide, API docs, schema description, and LLM configurations.
