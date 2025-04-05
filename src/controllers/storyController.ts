import { Request, Response, NextFunction } from "express";
import { StoryRequestBody } from "../types/express.d";
import {
	splitStoryIntoScenes,
	refinePromptForImage,
	generateImage,
	generateVisualPromptsFromStory,
} from "../services/generationService";
import { synthesizeSpeech, getAudioDuration } from "../services/audioService"; // Import audio service and getAudioDuration
import { compileVideoWithFullAudio } from "../services/videoService"; // Use a potentially renamed/new video function
import * as imageService from "../services/imageService"; // For saving images
import path from "path";

// Result structure for each scene
interface SceneProcessingResult {
	sceneIndex: number;
	sceneText: string;
	imageFilename: string | null;
	error?: string; // Error during image generation for this scene
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

	let fullAudioFilename: string | null = null;
	let fullAudioPath: string | null = null;
	let totalAudioDuration: number = 0;
	let fullAudioError: string | undefined = undefined;

	try {
		// 1. Generate Audio for the Full Story FIRST
		console.log("Synthesizing audio for the full story...");
		try {
			const fullAudioBaseName = `full_story_audio_${Date.now()}`;
			const savedFullAudio = await synthesizeSpeech({
				text: story,
				outputFilename: fullAudioBaseName,
			});
			fullAudioFilename = savedFullAudio.audioFilename;
			fullAudioPath = savedFullAudio.audioFilePath;
			console.log(`Full story audio saved: ${fullAudioFilename}`);
			totalAudioDuration = await getAudioDuration(fullAudioPath);
			if (totalAudioDuration <= 0) {
				throw new Error("Failed to get a valid audio duration.");
			}
		} catch (audioErr) {
			const message =
				audioErr instanceof Error ? audioErr.message : String(audioErr);
			console.error(`Failed to generate audio for the full story: ${message}`);
			// Decide if you want to proceed without audio or return an error
			// For now, we'll record the error and proceed to image generation
			fullAudioError = `Failed to generate audio for the full story: ${message}`;
			// Optionally return an error response here if audio is mandatory:
			// return next(new Error(fullAudioError));
		}

		// 2. Split story into scenes (even if audio failed, we might still want images)
		console.log("Splitting story into scenes...");
		const scenes = await splitStoryIntoScenes(story, apiKey);

		const sceneResults: SceneProcessingResult[] = [];
		const successfulImageFilenames: string[] = []; // Only image filenames needed now

		// 3. Process each scene for IMAGE ONLY
		let sceneIndex = 0;
		for (const scene of scenes) {
			sceneIndex++;
			const baseFilename = `scene_${sceneIndex}`;
			console.log(
				`Processing scene ${sceneIndex} for image: "${scene.substring(
					0,
					50
				)}..."`
			);

			let currentImageFilename: string | null = null;
			let errorMsg: string | undefined = undefined;

			try {
				const refinedPrompt = await refinePromptForImage(scene, apiKey);
				const imageBase64 = await generateImage(refinedPrompt, apiKey);
				const savedImage = await imageService.saveImageToFile(
					imageBase64,
					baseFilename
				);
				currentImageFilename = savedImage.filename;
				successfulImageFilenames.push(currentImageFilename); // Collect successful image filenames
				console.log(
					`Image saved for scene ${sceneIndex}: ${currentImageFilename}`
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					`Failed to process scene ${sceneIndex} image: ${message}`
				);
				errorMsg = message;
			}

			sceneResults.push({
				sceneIndex,
				sceneText: scene,
				imageFilename: currentImageFilename,
				error: errorMsg,
			});
		}

		console.log("Finished processing all scenes for images.");

		// 4. Compile Video using images and the single audio file
		let videoResult: VideoCompilationResult | null = null;
		let videoError: string | undefined = fullAudioError; // Start with potential audio error

		// Attempt video compilation only if we have images AND the full story audio
		if (successfulImageFilenames.length > 0 && fullAudioFilename) {
			try {
				console.log(
					`Compiling video from ${successfulImageFilenames.length} images and full audio...`
				);
				const videoBaseName = `story_video_${Date.now()}`;

				// Call the (potentially renamed) video service function
				const compilationResult = await compileVideoWithFullAudio({
					imageFilenames: successfulImageFilenames,
					fullAudioFilename: fullAudioFilename,
					totalAudioDuration: totalAudioDuration,
					outputVideoFilename: videoBaseName,
				});
				videoResult = { videoFilename: compilationResult.videoFilename };
				console.log(
					`Video compilation successful: ${videoResult.videoFilename}`
				);
			} catch (compileErr) {
				const message =
					compileErr instanceof Error ? compileErr.message : String(compileErr);
				console.error(`Video compilation failed: ${message}`);
				videoError = videoError
					? `${videoError}; Video compile error: ${message}`
					: `Video compile error: ${message}`;
			}
		} else if (!fullAudioFilename && successfulImageFilenames.length > 0) {
			console.log(
				"Skipping video compilation because full story audio generation failed."
			);
			if (!videoError)
				videoError =
					"Video compilation skipped: Full story audio generation failed.";
		} else if (successfulImageFilenames.length === 0) {
			console.log(
				"Skipping video compilation because no scene images were generated successfully."
			);
			if (!videoError)
				videoError = "Video compilation skipped: No scene images generated.";
		}

		res.status(200).json({
			message: "Story processing complete.",
			sceneImageResults: sceneResults, // Renamed for clarity
			fullAudioFilename: fullAudioFilename,
			videoResult: videoResult,
			videoError: videoError,
		});
	} catch (error) {
		console.error("Error in story-to-images controller:", error);
		next(error);
	}
};
