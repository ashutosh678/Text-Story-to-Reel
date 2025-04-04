import { Request, Response, NextFunction } from "express";
import {
	GoogleGenerativeAI,
	GenerateContentCandidate,
	Part,
	GenerateContentResponse,
	GoogleGenerativeAI as GoogleGenAIClient,
} from "@google/generative-ai";
import { RequestWithImageData } from "../types/express.d";
import { getRefinementPrompt } from "../prompts/imagePrompts";

async function _refinePrompt(
	initialPrompt: string,
	genAI: GoogleGenAIClient
): Promise<string> {
	const textModelIdentifier = "gemini-1.5-flash";
	const textModel = genAI.getGenerativeModel({ model: textModelIdentifier });
	const refinementMetaPrompt = getRefinementPrompt(initialPrompt);

	console.log(
		`Sending initial prompt to ${textModelIdentifier} for refinement...`
	);
	const textResult = await textModel.generateContent(refinementMetaPrompt);
	const textResponse: GenerateContentResponse = textResult.response;

	let refinedPrompt = "";
	if (textResponse?.candidates?.[0]?.content?.parts) {
		for (const part of textResponse.candidates[0].content.parts) {
			if (part.text) {
				refinedPrompt += part.text;
			}
		}
	}
	refinedPrompt = refinedPrompt.trim();

	if (!refinedPrompt) {
		console.error("Text model did not return a refined prompt.", textResponse);
		throw new Error("Failed to refine prompt for image generation.");
	}
	console.log(`Refined Prompt: \"${refinedPrompt}\"`);
	return refinedPrompt;
}

async function _generateImageFromPrompt(
	refinedPrompt: string,
	genAI: GoogleGenAIClient
): Promise<string> {
	const imageModelIdentifier = "gemini-2.0-flash-exp-image-generation";
	const imageModel = genAI.getGenerativeModel({ model: imageModelIdentifier });

	const imageGenResult = await imageModel.generateContent({
		contents: [{ role: "user", parts: [{ text: refinedPrompt }] }],
		generationConfig: {
			responseModalities: ["Text", "Image"],
		} as any,
	});

	const imageGenResponse = imageGenResult.response;
	console.log(
		"Received response from image generation model (Gemini 2.0 Flash Exp)"
	);

	let foundImage = false;
	let imageBase64Data: string | null = null;

	if (imageGenResponse?.candidates?.[0]?.content?.parts) {
		const candidate: GenerateContentCandidate = imageGenResponse.candidates[0];
		const parts: Part[] = candidate.content.parts;
		for (const part of parts) {
			if (part.inlineData?.mimeType?.startsWith("image/")) {
				imageBase64Data = part.inlineData.data;
				foundImage = true;
				console.log(
					`Found image data (mime type: ${part.inlineData.mimeType})`
				);
				break;
			}
		}
	}

	if (foundImage && imageBase64Data) {
		return imageBase64Data;
	} else {
		console.error(
			"Model response (Gemini 2.0 Flash Exp) did not contain expected image data. Response:",
			JSON.stringify(imageGenResponse, null, 2)
		);
		throw new Error(
			"Failed to generate image: No valid image data found in API response (using Gemini 2.0 Flash Exp)."
		);
	}
}

export const generateImageWithGemini = async (
	req: RequestWithImageData,
	res: Response,
	next: NextFunction
) => {
	const initialPrompt: string =
		typeof req.body.prompt === "string" ? req.body.prompt : "";
	const apiKey: string | undefined = process.env.GOOGLE_API_KEY;

	if (!initialPrompt) {
		console.error("Middleware Error: Initial prompt is required");
		return next(new Error("Initial prompt is required"));
	}
	if (!apiKey) {
		console.error("Missing GOOGLE_API_KEY in .env");
		return next(new Error("Server configuration error: API key missing"));
	}

	try {
		const genAI = new GoogleGenerativeAI(apiKey);

		const refinedPrompt = await _refinePrompt(initialPrompt, genAI);

		const imageBase64Data = await _generateImageFromPrompt(
			refinedPrompt,
			genAI
		);

		req.generatedImageBase64 = imageBase64Data;
		console.log("Image data generated and attached, passing to controller...");
		next();
	} catch (error) {
		console.error(
			"Error in middleware chain:",
			error instanceof Error ? error.message : String(error)
		);
		next(error);
	}
};
