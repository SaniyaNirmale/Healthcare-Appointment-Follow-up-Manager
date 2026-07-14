# MedClinic Manager - System Design Document

This document explains in simple terms how we designed the clinic system to solve common scheduling and notification problems.

---

## 1. Double-Booking Prevention

**The Problem:** Two patients click "Book" at the exact same fraction of a second for the same slot, and both get confirmed.

**How we solved it:**
We use a two-step protection system to ensure a slot is never double-booked:

1. **Database Rule (Unique Index):**
   We set a strict rule directly inside our database. The database will only allow one row to exist with the same Doctor ID and time slot when the status is `CONFIRMED`. If a second write attempt happens for that same slot, the database will block it and throw an error.
   
2. **Transaction Code:**
   When our backend runs the booking code, it wraps the steps inside a "transaction". This means the server checks if the slot is free and saves the booking together in one single step. No other request can sneak in between the check and the save.

---

## 2. Doctor Leave Conflict Handling

**The Problem:** An admin puts a doctor on leave for a day, but that doctor already has patients booked on that day.

**How we solved it:**
When an admin registers a leave date for a doctor, the system automatically runs a cleanup process:

1. **Find & Cancel:** It searches the database for any `CONFIRMED` appointments for that doctor on that date and changes their status to `CANCELLED`.
2. **Notify the Patients:** It automatically adds a cancellation email notification to the queue for each affected patient.
3. **Clean up Google Calendar:** The system deletes the calendar events from the doctor's Google Calendar in the background so the admin's screen doesn't freeze waiting for the API call.

---

## 3. Slot Hold Mechanism

**The Problem:** Two patients are typing their symptom descriptions for the same time slot. They both finish typing, click submit, and one gets a failure error because the other was slightly faster. This is frustrating for patients.

**How we solved it:**
We added a 5-minute temporary lock (slot hold):

1. **Locking the Slot:** When a patient clicks a time slot, we write a temporary hold record in the database with an expiration timer set to `now + 5 minutes`.
2. **Exclusivity:** While the hold is active, other patients cannot select that slot. It will appear greyed out for them.
3. **Checkout:** If the patient completes the symptom form and books within 5 minutes, we convert the hold into a confirmed booking and delete the hold record.
4. **Auto-Release:** If they close the browser or wait too long, the hold expires and the slot automatically becomes available again for everyone else.

---

## 4. Notification Failure Handling

**The Problem:** The email service goes down or experiences a temporary glitch, causing patients to miss their appointment details or medication reminders.

**How we solved it:**
We use a queue database table to handle notifications:

1. **Queueing instead of Sending:** We never send emails directly during a user action. Instead, we write the email details to a `NotificationLog` table with a `PENDING` status.
2. **Background Dispatcher:** A separate background job checks this table every 10 seconds for pending or failed emails and tries to send them.
3. **Retry Counter:** If an email fails, we log the error, increment a `retryCount` counter, and keep trying.
4. **Retry Limit:** The system will attempt to send the email up to 5 times. If it still fails, it flags it so it doesn't try forever.
