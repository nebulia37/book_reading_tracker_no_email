
// geminiService.ts

// We are commenting this out because Vite can't find the export locally
// import { GoogleGenerativeAI } from "@google/genai";

// Create a fake object so your other files don't crash when they try to use 'ai'
export const ai = {
  getGenerativeModel: () => ({
    generateContent: async () => ({ response: { text: () => "AI is disabled locally" } })
  })
} as any;

console.log("AI Module bypassed to fix Vite startup.")
