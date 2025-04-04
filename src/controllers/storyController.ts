import { Request, Response, NextFunction } from "express";
import { StoryRequestBody } from "../types/express.d";
import {
	splitStoryIntoScenes,
	refinePromptForImage,
	generateImage,
} from "../services/generationService";
import * as imageService from "../services/imageService"; // For saving images
import { compileImagesToVideo } from "../services/videoService"; // Import the video service

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

		const scenes = await splitStoryIntoScenes(story, apiKey);

		const results: {
			sceneIndex: number;
			sceneText: string;
			filename: string | null;
			error?: string;
		}[] = [];
		const successfulImageFilenames: string[] = [];

		let sceneIndex = 0;
		for (const scene of scenes) {
			sceneIndex++;
			const baseFilename = `scene_${sceneIndex}`;
			console.log(
				`Processing scene ${sceneIndex}: "${scene.substring(0, 50)}..."`
			);
			let filename: string | null = null;
			let errorMsg: string | undefined = undefined;

			try {
				const refinedPrompt = await refinePromptForImage(scene, apiKey);
				const imageBase64 = await generateImage(refinedPrompt, apiKey);
				const savedImage = await imageService.saveImageToFile(
					imageBase64,
					baseFilename
				);
				filename = savedImage.filename;
				successfulImageFilenames.push(filename);
				console.log(`Image saved for scene ${sceneIndex}: ${filename}`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					`Failed to process scene ${sceneIndex} "${scene.substring(
						0,
						50
					)}...": ${message}`
				);
				errorMsg = message;
			}

			results.push({ sceneIndex, sceneText: scene, filename, error: errorMsg });
		}

		console.log("Finished processing all scenes.");

		let videoResult: { videoFilename: string } | null = null;
		let videoError: string | undefined = undefined;

		if (successfulImageFilenames.length > 0) {
			try {
				console.log(
					`Compiling video from ${successfulImageFilenames.length} images...`
				);
				const videoBaseName = `story_video_${Date.now()}`;
				const compilationResult = await compileImagesToVideo({
					imageFilenames: successfulImageFilenames,
					frameRate: 1,
					videoFilename: videoBaseName,
				});
				videoResult = { videoFilename: compilationResult.videoFilename };
				console.log(
					`Video compilation successful: ${videoResult.videoFilename}`
				);
			} catch (compileErr) {
				const message =
					compileErr instanceof Error ? compileErr.message : String(compileErr);
				console.error(`Video compilation failed: ${message}`);
				videoError = message;
			}
		}

		res.status(200).json({
			message: "Story processing complete.",
			sceneResults: results,
			videoResult: videoResult,
			videoError: videoError,
		});
	} catch (error) {
		console.error("Error in story-to-images controller:", error);
		next(error);
	}
};
