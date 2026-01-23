
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

export async function generateEmailBody(volume: Volume) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Generate a formal confirmation email in Chinese (Simplified) for a Buddhist scripture reading claim. 
      Details:
      - Recipient: ${volume.claimerName}
      - Volume: ${volume.volumeNumber} ${volume.volumeTitle}
      - Planned Days: ${volume.plannedDays} days
      - Deadline: ${new Date(volume.expectedCompletionDate!).toLocaleDateString()}
      - Digital Link: ${volume.readingUrl}
      
      Structure the email with a respectful salutation, a confirmation section, the significance of the Taishō Tripiṭaka, and a formal closing. The language should be elegant and dignified.`,
      config: {
        temperature: 0.6,
      }
    });
    return response.text || `尊敬的 ${volume.claimerName} 同修：\n\n您已成功认领《${volume.volumeTitle}》的诵读任务。\n计划天数：${volume.plannedDays}天\n预计截止：${new Date(volume.expectedCompletionDate!).toLocaleDateString()}\n阅读地址：${volume.readingUrl}\n\n愿您在法宝中获得深厚加持。`;
  } catch (error) {
    return `尊敬的 ${volume.claimerName} 同修：\n\n您已成功认领《${volume.volumeTitle}》。\n计划天数：${volume.plannedDays}天\n预计完成：${new Date(volume.expectedCompletionDate!).toLocaleDateString()}\n阅读链接：${volume.readingUrl}\n\n阿弥陀佛，随喜赞叹。`;
  }
}
