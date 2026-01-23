
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


export async function generateBlessingMessage(volumeTitle: string, claimerName: string) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Generate a short, evocative, and traditional Buddhist-style blessing message in Chinese (Simplified) for "${claimerName}" who has claimed to recite "${volumeTitle}" from the Taishō Tripiṭaka. The tone should be spiritual, respectful, and highly encouraging. Focus on the merit (功德) of the Dharma and the joy of practice. Keep it between 30 and 50 words. Use classical phrasing if possible.`,
      config: {
        temperature: 0.8,
      }
    });
    return response.text || "随喜赞叹认领功德，祝愿法喜充满，福慧双增。";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "佛光普照，功德无量。愿此次诵持，能利乐有情，同证菩提。";
  }
}
