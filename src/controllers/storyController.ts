import { Request, Response, NextFunction } from "express";
import { StoryRequestBody } from "../types/express.d";
import {
	splitStoryIntoScenes,
	refinePromptForImage,
	generateImage,
} from "../services/generationService";
import { synthesizeSpeech } from "../services/audioService"; // Import audio service
import { compileScenesToVideo } from "../services/videoService";
import * as imageService from "../services/imageService"; // For saving images

// Result structure for each scene
interface SceneProcessingResult {
	sceneIndex: number;
	sceneText: string;
	imageFilename: string | null;
	audioFilename: string | null;
	error?: string; // Combined error for image/audio generation for this scene
}

// Result structure for the video compilation
interface VideoCompilationResult {
	videoFilename: string;
}

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
		console.log("Processing story to generate images and audio...");

		const scenes = await splitStoryIntoScenes(story, apiKey);

		const sceneResults: SceneProcessingResult[] = [];
		// Collect data needed for video compilation
		const videoSceneData: { imageFilename: string; audioFilename: string }[] =
			[];

		let sceneIndex = 0;
		for (const scene of scenes) {
			sceneIndex++;
			const baseFilename = `scene_${sceneIndex}`;
			console.log(
				`Processing scene ${sceneIndex}: "${scene.substring(0, 50)}..."`
			);

			let currentImageFilename: string | null = null;
			let currentAudioFilename: string | null = null;
			let errorMsg: string | undefined = undefined;

			try {
				// Generate Image
				const refinedPrompt = await refinePromptForImage(scene, apiKey);
				const imageBase64 = await generateImage(refinedPrompt, apiKey);
				const savedImage = await imageService.saveImageToFile(
					imageBase64,
					baseFilename
				);
				currentImageFilename = savedImage.filename;
				console.log(
					`Image saved for scene ${sceneIndex}: ${currentImageFilename}`
				);

				// Generate Audio
				const savedAudio = await synthesizeSpeech({
					text: scene,
					outputFilename: baseFilename,
				});
				currentAudioFilename = savedAudio.audioFilename;
				console.log(
					`Audio saved for scene ${sceneIndex}: ${currentAudioFilename}`
				);

				// If both succeeded, add to video data list
				if (currentImageFilename && currentAudioFilename) {
					videoSceneData.push({
						imageFilename: currentImageFilename,
						audioFilename: currentAudioFilename,
					});
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					`Failed to process scene ${sceneIndex} "${scene.substring(
						0,
						50
					)}...": ${message}`
				);
				// Record error only if we didn't already get an image/audio
				if (!currentImageFilename && !currentAudioFilename) {
					errorMsg = message;
				}
			}

			sceneResults.push({
				sceneIndex,
				sceneText: scene,
				imageFilename: currentImageFilename,
				audioFilename: currentAudioFilename,
				error: errorMsg,
			});
		}

		console.log("Finished processing all scenes for images and audio.");

		let videoResult: VideoCompilationResult | null = null;
		let videoError: string | undefined = undefined;

		// Attempt video compilation only if we have valid scene data
		if (videoSceneData.length > 0) {
			try {
				console.log(`Compiling video from ${videoSceneData.length} scenes...`);
				const videoBaseName = `story_video_${Date.now()}`;
				const compilationResult = await compileScenesToVideo({
					scenes: videoSceneData,
					outputVideoFilename: videoBaseName,
					// Add transitionDuration or outputFps here if needed
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
			sceneResults: sceneResults,
			videoResult: videoResult,
			videoError: videoError,
		});
	} catch (error) {
		console.error("Error in story-to-images controller:", error);
		next(error);
	}
};
