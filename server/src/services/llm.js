import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

let genAI = null;
if (process.env.GEMINI_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  } catch (error) {
    console.error("Failed to initialize Gemini AI client:", error);
  }
} else {
  console.log("GEMINI_API_KEY is not defined in .env. Running LLM service in local fallback mode.");
}

/**
 * Classifies symptoms locally using keyword rules if Gemini is unavailable
 */
function localSymptomAnalyzer(symptoms = "") {
  const text = symptoms.toLowerCase();
  let urgency = "Low";
  let chiefComplaint = "General consultation requested.";
  const suggestedQuestions = [
    "How long have you been experiencing these symptoms?",
    "Does anything make the symptoms better or worse?",
    "Are you currently taking any over-the-counter medications for this?"
  ];

  // Simple Urgency Classification Rules
  if (
    text.includes("chest pain") || 
    text.includes("breath") || 
    text.includes("bleeding") || 
    text.includes("unconscious") || 
    text.includes("severe pain") || 
    text.includes("stroke") || 
    text.includes("seizure")
  ) {
    urgency = "High";
    chiefComplaint = "Potentially severe symptoms requiring urgent evaluation.";
    suggestedQuestions[0] = "When did this acute episode begin, and are you feeling dizzy?";
    suggestedQuestions[1] = "Have you experienced similar severe episodes in the past?";
    suggestedQuestions[2] = "Do you have a history of cardiovascular or respiratory conditions?";
  } else if (
    text.includes("fever") || 
    text.includes("cough") || 
    text.includes("vomit") || 
    text.includes("diarrhea") || 
    text.includes("rash") || 
    text.includes("infection") || 
    text.includes("migraine")
  ) {
    urgency = "Medium";
    chiefComplaint = "Moderate symptoms indicating potential infectious or inflammatory process.";
    suggestedQuestions[0] = "What is your current body temperature?";
    suggestedQuestions[1] = "Are you able to keep fluids down and stay hydrated?";
    suggestedQuestions[2] = "Have you been in close contact with anyone who has been sick recently?";
  } else {
    // Low Urgency
    if (symptoms.trim().length > 0) {
      chiefComplaint = symptoms.split(/[.!?]/)[0] || "Routine check-up or minor symptoms.";
    }
  }

  return { urgency, chiefComplaint, suggestedQuestions };
}

/**
 * Analyzes patient symptoms using Gemini LLM (with fallback to local rule-based engine)
 */
export async function generatePreVisitSummary(symptoms) {
  if (!symptoms || symptoms.trim() === "") {
    return {
      urgency: "Low",
      chiefComplaint: "No symptoms reported.",
      suggestedQuestions: ["How can the clinic help you today?", "Are you here for a routine check-up?"]
    };
  }

  if (!genAI) {
    return localSymptomAnalyzer(symptoms);
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptoms}

You MUST return ONLY a valid JSON object matching this structure (do not wrap in markdown blocks, just return raw JSON):
{
  "urgency": "Low" | "Medium" | "High",
  "chiefComplaint": "Short description of patient's chief complaint",
  "suggestedQuestions": ["question 1", "question 2", "question 3"]
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    
    // Clean potential markdown wrappers if LLM returned them despite prompt
    let cleanJson = text;
    if (cleanJson.startsWith("```json")) {
      cleanJson = cleanJson.slice(7);
    }
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.slice(3);
    }
    if (cleanJson.endsWith("```")) {
      cleanJson = cleanJson.slice(0, -3);
    }
    cleanJson = cleanJson.trim();

    try {
      const parsed = JSON.parse(cleanJson);
      // Validate structure
      if (parsed.urgency && parsed.chiefComplaint && Array.isArray(parsed.suggestedQuestions)) {
        return {
          urgency: ["Low", "Medium", "High"].includes(parsed.urgency) ? parsed.urgency : "Medium",
          chiefComplaint: parsed.chiefComplaint,
          suggestedQuestions: parsed.suggestedQuestions.slice(0, 3)
        };
      }
      throw new Error("Invalid response keys");
    } catch (parseError) {
      console.warn("Failed to parse Gemini JSON output. Attempting regex extract. Raw text:", text);
      
      // Regex extraction fallback
      const urgencyMatch = text.match(/urgency["\s:]+["\s]*(Low|Medium|High)/i);
      const urgency = urgencyMatch ? urgencyMatch[1] : "Medium";
      
      return {
        urgency,
        chiefComplaint: symptoms.split(/[.!?]/)[0] || "Symptom review requested.",
        suggestedQuestions: [
          "What is the frequency and duration of these symptoms?",
          "Are you experiencing any other secondary symptoms?",
          "Have you tried any home remedies or medications?"
        ]
      };
    }
  } catch (error) {
    console.error("Gemini AI API call failed. Falling back to local rule-based analysis:", error);
    return localSymptomAnalyzer(symptoms);
  }
}

/**
 * Converts clinical notes into patient-friendly text using Gemini LLM (with local fallback)
 */
export async function generatePostVisitSummary(notes) {
  if (!notes || notes.trim() === "") {
    return "No clinical notes provided by the doctor.";
  }

  if (!genAI) {
    return `### Local Post-Visit Summary\n\n**Notes Summary:**\n${notes}\n\n*Please contact your care provider if you have any questions about these recommendations.*`;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${notes}`;
    
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Gemini AI API call failed during post-visit summary generation. Falling back to default format:", error);
    return `### Post-Visit Summary\n\n**Doctor's Clinical Notes:**\n${notes}\n\n*Note: Patient summary was generated with fallback due to temporary AI API connectivity issue.*`;
  }
}
