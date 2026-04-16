import { GoogleGenAI, Type } from "@google/genai";
import { FeatureRecord } from "./analyzer";

export interface AIAnalysisResult {
  summary: string;
  scientificContext: string;
  recommendations: string[];
  confidenceScore: number;
  stressLevel: "Low" | "Moderate" | "High" | "Critical";
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function analyzeAzollaWithAI(
  imageBuffer: string, // Base64
  features: FeatureRecord,
  history: FeatureRecord[]
): Promise<AIAnalysisResult> {
  const prompt = `
    You are a specialized agricultural AI expert focusing on Azolla (aquatic fern) health monitoring.
    Analyze the provided image and the extracted features to provide a scientific assessment of the plant's stress level.

    Extracted Features:
    ${JSON.stringify(features, null, 2)}

    Historical Context (last ${history.length} points):
    ${JSON.stringify(history.slice(-5), null, 2)}

    Scientific Context:
    - RG Ratio (Red/Green): High values (>0.8) indicate anthocyanin accumulation, a classic stress response in Azolla.
    - Coverage: Sudden drops indicate biomass loss or fragmentation.
    - GLCM Entropy: Higher values suggest increased leaf surface complexity or irregular growth patterns.
    - Mean Green: Decreasing values suggest chlorophyll degradation.

    Please provide your analysis in JSON format with the following structure:
    {
      "summary": "A brief overview of the current status.",
      "scientificContext": "Detailed scientific explanation of the observed features and their biological implications.",
      "recommendations": ["List of actionable steps for the grower."],
      "confidenceScore": 0.95,
      "stressLevel": "Low" | "Moderate" | "High" | "Critical"
    }
    
    The response must be in Turkish as requested by the user.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/png",
                data: imageBuffer.split(",")[1] || imageBuffer,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            scientificContext: { type: Type.STRING },
            recommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            confidenceScore: { type: Type.NUMBER },
            stressLevel: {
              type: Type.STRING,
              enum: ["Low", "Moderate", "High", "Critical"],
            },
          },
          required: ["summary", "scientificContext", "recommendations", "confidenceScore", "stressLevel"],
        },
      },
    });

    const result = JSON.parse(response.text || "{}");
    return result as AIAnalysisResult;
  } catch (error) {
    console.error("AI Analysis failed:", error);
    throw new Error("Yapay zeka analizi başarısız oldu.");
  }
}
