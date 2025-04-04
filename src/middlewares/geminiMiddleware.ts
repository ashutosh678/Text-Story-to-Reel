import { Request, Response, NextFunction } from "express";
import {
	GoogleGenerativeAI,
	GenerateContentCandidate,
	Part,
} from "@google/generative-ai";
import { RequestWithImageData } from "../types/express.d"; // Import custom type

// Middleware to generate image using Google Generative AI SDK
export const generateImageWithGemini = async (
	req: RequestWithImageData,
	res: Response,
	next: NextFunction
) => {
	// Extract prompt, ensuring it's a string
	const prompt: string =
		typeof req.body.prompt === "string" ? req.body.prompt : "";
	const apiKey: string | undefined = process.env.GOOGLE_API_KEY;

	if (!prompt) {
		// Pass an error to the central handler instead of responding directly
		console.error("Middleware Error: Prompt is required");
		// You might want to create custom error types later to handle status codes
		return next(new Error("Prompt is required"));
	}
	if (!apiKey) {
		console.error("Missing GOOGLE_API_KEY in .env");
		// Pass error to central handler
		return next(new Error("Server configuration error: API key missing"));
	}

	try {
		const genAI = new GoogleGenerativeAI(apiKey);
		const modelIdentifier = "gemini-2.0-flash-exp-image-generation"; // Or your chosen model

		console.log(
			`Sending prompt to Gemini model (${modelIdentifier}): \"${prompt}\"...`
		);

		const model = genAI.getGenerativeModel({ model: modelIdentifier });

		const result = await model.generateContent({
			contents: [{ role: "user", parts: [{ text: prompt }] }],
		});

		// Type the response for better safety
		const response = result.response;
		console.log("Received response from Gemini");

		let foundImage = false;
		let imageBase64Data: string | null = null;

		// Type the candidate and parts
		if (response?.candidates?.[0]?.content?.parts) {
			const candidate: GenerateContentCandidate = response.candidates[0];
			const parts: Part[] = candidate.content.parts;
			for (const part of parts) {
				if (part.inlineData?.mimeType?.startsWith("image/")) {
					imageBase64Data = part.inlineData.data;
					foundImage = true;
					console.log(
						`Found image data (mime type: ${part.inlineData.mimeType})`
					);
					break; // Exit loop once image is found
				}
			}
		}

		if (foundImage && imageBase64Data) {
			// Attach data to the extended request object
			req.generatedImageBase64 = imageBase64Data;
			console.log("Image data found, passing to next handler...");
			next(); // Pass control to the next middleware/handler (controller)
		} else {
			console.error(
				"Gemini response did not contain expected image data. Response:",
				JSON.stringify(response, null, 2)
			);
			// Pass an error to the central handler
			next(
				new Error(
					"Failed to generate image: No image data found in API response"
				)
			);
		}
	} catch (error) {
		console.error(
			"Error calling Google Generative AI:",
			error instanceof Error ? error.message : String(error)
		);
		next(error); // Pass error to the central error handler
	}
};

// Remove CommonJS export if not needed
/*
module.exports = {
	generateImageWithGemini,
};
*/
