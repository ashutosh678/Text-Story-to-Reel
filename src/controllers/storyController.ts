import { Request, Response, NextFunction } from "express";
import { StoryRequestBody } from "../types/express.d";
import {
	splitStoryIntoScenes,
	refinePromptForImage,
	generateImage,
} from "../services/generationService";
import * as imageService from "../services/imageService"; // For saving images

export const generateImagesFromStory = async (
	req: Request<{}, {}, StoryRequestBody>,
	res: Response,
	next: NextFunction
) => {
	const { story } = req.body;
	const apiKey: string | undefined = process.env.GOOGLE_API_KEY;

	if (!story) {
		return next(new Error("Story content is required in the request body."));
	}
	if (!apiKey) {
		return next(new Error("Server configuration error: API key missing"));
	}

	try {
		console.log("Processing story to generate images...");

		// 1. Split story into scenes
		const scenes = await splitStoryIntoScenes(story, apiKey);

		const results: {
			scene: string;
			filename: string | null;
			error?: string;
		}[] = [];

		for (const scene of scenes) {
			console.log(`Processing scene: "${scene.substring(0, 50)}..."`);
			let filename: string | null = null;
			let errorMsg: string | undefined = undefined;

			try {
				// 3. Refine scene description into a prompt
				const refinedPrompt = await refinePromptForImage(scene, apiKey);

				// 4. Generate image for the refined prompt
				const imageBase64 = await generateImage(refinedPrompt, apiKey);

				// 5. Save the image
				const savedImage = await imageService.saveImageToFile(imageBase64);
				filename = savedImage.filename;
				console.log(`Image saved for scene: ${filename}`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					`Failed to process scene "${scene.substring(0, 50)}...": ${message}`
				);
				errorMsg = message;
			}

			results.push({ scene, filename, error: errorMsg });
		}

		console.log("Finished processing all scenes.");
		res.status(200).json({
			message: "Story processing complete.",
			results,
		});
	} catch (error) {
		console.error("Error in story-to-images controller:", error);
		next(error);
	}
};
