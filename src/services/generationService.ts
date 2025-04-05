import {
	GoogleGenerativeAI,
	GenerateContentCandidate,
	Part,
	GenerateContentResponse,
} from "@google/generative-ai";
import { getRefinementPrompt } from "../prompts/imagePrompts";

// --- Service Function: Refine Prompt ---
export async function refinePromptForImage(
	initialPrompt: string,
	apiKey: string
): Promise<string> {
	if (!apiKey) throw new Error("API key is required for refining prompt.");

	const genAI = new GoogleGenerativeAI(apiKey);
	const textModelIdentifier = "gemini-1.5-flash";
	const textModel = genAI.getGenerativeModel({ model: textModelIdentifier });
	const refinementMetaPrompt = getRefinementPrompt(initialPrompt);

	console.log(`Sending prompt to ${textModelIdentifier} for refinement...`);
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

// --- Service Function: Generate Image ---
export async function generateImage(
	refinedPrompt: string,
	apiKey: string
): Promise<string> {
	if (!apiKey) throw new Error("API key is required for generating image.");

	const genAI = new GoogleGenerativeAI(apiKey);
	const imageModelIdentifier = "gemini-2.0-flash-exp-image-generation";
	const imageModel = genAI.getGenerativeModel({ model: imageModelIdentifier });

	console.log(
		`Sending refined prompt to ${imageModelIdentifier} via generateContent: \"${refinedPrompt}\"...`
	);

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

// --- Service Function: Split Story into Scenes ---
// Uses a text model to identify logical scene breaks in a story.
export async function splitStoryIntoScenes(
	story: string,
	apiKey: string
): Promise<string[]> {
	if (!apiKey) throw new Error("API key is required for splitting story.");

	const genAI = new GoogleGenerativeAI(apiKey);
	const textModelIdentifier = "gemini-1.5-flash"; // Or another capable text model
	const textModel = genAI.getGenerativeModel({ model: textModelIdentifier });

	// Prompt asking the model to split the story into visual scenes
	const splittingPrompt = `Analyze the following story and split it into distinct visual scenes. Each scene should represent a moment or location that can be visualized as a single image. Output *only* the scenes, separated by a unique delimiter like "<SCENE_BREAK>". Do not add any commentary before or after the scenes.

Story:
---
${story}
---

Scenes (separated by "<SCENE_BREAK>"):
`;

	console.log(`Sending story to ${textModelIdentifier} for scene splitting...`);
	const result = await textModel.generateContent(splittingPrompt);
	const response = result.response;
	const combinedScenesText = response.text();

	if (!combinedScenesText) {
		console.error("Model did not return text for scene splitting.", response);
		throw new Error("Failed to split story into scenes.");
	}

	// Split the result by the delimiter
	const scenes = combinedScenesText
		.split("<SCENE_BREAK>")
		.map((scene) => scene.trim())
		.filter((scene) => scene.length > 0);

	if (scenes.length === 0) {
		console.warn(
			"Scene splitting resulted in zero scenes. Returning the original story as one scene."
		);
		return [story]; // Fallback to the whole story if splitting fails
	}

	console.log(`Split story into ${scenes.length} scenes.`);
	return scenes;
}

// --- Service Function: Generate N Visual Prompts from Story ---
// Asks a text model to break a story into a specific number of visual prompts.
export async function generateVisualPromptsFromStory(
	story: string,
	numberOfPrompts: number,
	apiKey: string
): Promise<string[]> {
	if (!apiKey)
		throw new Error("API key is required for generating visual prompts.");
	if (numberOfPrompts <= 0)
		throw new Error("Number of prompts must be greater than zero.");

	const genAI = new GoogleGenerativeAI(apiKey);
	const textModelIdentifier = "gemini-1.5-flash"; // Or another capable text model
	const textModel = genAI.getGenerativeModel({
		model: textModelIdentifier,
	});

	// Prompt asking the model to generate N distinct visual prompts
	const generationPrompt = `Analyze the following story and generate exactly ${numberOfPrompts} distinct visual scene descriptions suitable for an image generation model. Each description should capture a key moment or visual element progression through the story. Output *only* the descriptions, separated by the delimiter "<PROMPT_BREAK>". Do not add any commentary, numbering, or introduction before or after the descriptions.

Story:
---
${story}
---

${numberOfPrompts} Visual Scene Descriptions (separated by "<PROMPT_BREAK>"):
`;

	console.log(
		`Sending story to ${textModelIdentifier} to generate ${numberOfPrompts} prompts...`
	);
	const result = await textModel.generateContent(generationPrompt);
	const response = result.response;
	let combinedPromptsText = "";
	if (response?.candidates?.[0]?.content?.parts) {
		for (const part of response.candidates[0].content.parts) {
			if (part.text) {
				combinedPromptsText += part.text;
			}
		}
	}

	if (!combinedPromptsText) {
		console.error("Model did not return text for prompt generation.", response);
		throw new Error("Failed to generate visual prompts from story.");
	}

	// Split the result by the delimiter
	const prompts = combinedPromptsText
		.split("<PROMPT_BREAK>")
		.map((p) => p.trim())
		.filter((p) => p.length > 0);

	// Validate if we got roughly the number requested (can sometimes be imperfect)
	if (prompts.length === 0) {
		console.error(
			"Prompt generation resulted in zero prompts.",
			combinedPromptsText
		);
		throw new Error("Prompt generation failed.");
	}
	if (prompts.length !== numberOfPrompts) {
		console.warn(
			`Requested ${numberOfPrompts} prompts, but received ${prompts.length}. Proceeding with received prompts.`
		);
		// Optional: Could try to truncate/pad, but using what we got is simpler
	}

	console.log(`Generated ${prompts.length} visual prompts.`);
	return prompts;
}
