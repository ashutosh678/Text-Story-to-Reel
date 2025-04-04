import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import ffprobe from "ffprobe";
import ffprobeStatic from "ffprobe-static";

const IMAGE_DIR = path.join(__dirname, "../../outputs"); // Base images directory
const AUDIO_DIR = path.join(__dirname, "../../outputs/audio");
const VIDEO_DIR = path.join(__dirname, "../../outputs/videos"); // Videos subdirectory

// Helper to get audio duration using ffprobe
const getAudioDuration = async (filePath: string): Promise<number> => {
	try {
		const info = await ffprobe(filePath, { path: ffprobeStatic.path });
		const duration = info?.streams?.[0]?.duration;
		if (duration) {
			return parseFloat(duration);
		} else {
			console.warn(
				`Could not determine duration for ${filePath}, defaulting to 1 second.`
			);
			return 1; // Default duration if ffprobe fails
		}
	} catch (err) {
		console.error(`ffprobe error for ${filePath}:`, err);
		console.warn(`Defaulting duration to 1 second for ${filePath}.`);
		return 1; // Default duration on error
	}
};

// Ensure video output directory exists
const ensureVideoOutputDir = async (): Promise<void> => {
	try {
		await fs.access(VIDEO_DIR);
	} catch (error: any) {
		if (error.code === "ENOENT") {
			try {
				await fs.mkdir(VIDEO_DIR, { recursive: true });
				console.log(`Created video output directory: ${VIDEO_DIR}`);
			} catch (mkdirError) {
				console.error(
					`Failed to create video output directory: ${VIDEO_DIR}`,
					mkdirError
				);
				throw new Error(
					`Failed to create video output directory: ${VIDEO_DIR}`
				);
			}
		} else {
			console.error("Error accessing video output directory:", error);
			throw new Error("Error accessing video output directory.");
		}
	}
};

interface SceneData {
	imageFilename: string; // e.g., scene_1.png
	audioFilename: string; // e.g., scene_1.mp3
}

interface CompileVideoParams {
	scenes: SceneData[];
	outputVideoFilename?: string; // Optional: Filename without extension
	transitionDuration?: number; // Duration of crossfade in seconds
	outputFps?: number; // Output video framerate
}

interface CompileVideoResult {
	videoPath: string;
	videoFilename: string;
}

export const compileScenesToVideo = async (
	params: CompileVideoParams
): Promise<CompileVideoResult> => {
	const {
		scenes,
		outputVideoFilename: customFilename,
		transitionDuration = 0.5, // Default transition duration (seconds)
		outputFps = 30, // Default output framerate
	} = params;

	if (!scenes || scenes.length === 0) {
		throw new Error("No scenes provided for video compilation.");
	}

	await ensureVideoOutputDir();

	const outputFilename = customFilename
		? `${customFilename}.mp4`
		: `${uuidv4()}.mp4`;
	const outputPath = path.join(VIDEO_DIR, outputFilename);

	const command = ffmpeg();
	let complexFilter: string[] = [];
	let inputIndex = 0;
	let lastVideoOutputTag = "";
	let totalDuration = 0;

	// Prepare inputs and get durations
	const sceneDetails = await Promise.all(
		scenes.map(async (scene, index) => {
			const imagePath = path.join(IMAGE_DIR, scene.imageFilename);
			const audioPath = path.join(AUDIO_DIR, scene.audioFilename);
			try {
				await fs.access(imagePath);
				await fs.access(audioPath);
				const audioDuration = await getAudioDuration(audioPath);
				return { ...scene, imagePath, audioPath, audioDuration, index };
			} catch (err) {
				console.warn(
					`Skipping scene ${index + 1} due to missing files: ${
						err instanceof Error ? err.message : String(err)
					}`
				);
				return null; // Skip scene if files are missing
			}
		})
	);

	const validScenes = sceneDetails.filter(Boolean) as (SceneData & {
		imagePath: string;
		audioPath: string;
		audioDuration: number;
		index: number;
	})[];

	if (validScenes.length === 0) {
		throw new Error(
			"No valid scenes with existing image and audio files found."
		);
	}

	// Add inputs to ffmpeg command
	validScenes.forEach((scene) => {
		command.input(scene.imagePath); // Video stream for scene
		command.input(scene.audioPath); // Audio stream for scene
	});

	// Build complex filter graph
	let audioConcatTags = "";
	validScenes.forEach((scene, i) => {
		const imageInputIndex = i * 2; // e.g., 0, 2, 4
		const audioInputIndex = i * 2 + 1; // e.g., 1, 3, 5
		const outputVideoStreamTag = `v${i}`;
		const outputAudioStreamTag = `a${i}`;

		// Scale/pad image to a standard size (e.g., 1080x1920 for Reels)
		// and set duration based on audio
		complexFilter.push(
			`[${imageInputIndex}:v] scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,format=pix_fmts=yuv420p,loop=loop=-1:size=1:start=0,setpts=N/(${outputFps}*TB) [img${i}]`
		);
		complexFilter.push(
			`[img${i}] trim=duration=${scene.audioDuration} [${outputVideoStreamTag}]`
		);

		// Tag audio stream
		complexFilter.push(
			`[${audioInputIndex}:a] asetpts=N/SR/TB [${outputAudioStreamTag}]`
		);
		audioConcatTags += `[${outputAudioStreamTag}]`;

		totalDuration += scene.audioDuration;
	});

	// Concatenate audio streams
	complexFilter.push(
		`${audioConcatTags} concat=n=${validScenes.length}:v=0:a=1 [outa]`
	);

	// Apply transitions (crossfade) between video segments
	let currentInput = "v0"; // Start with the first processed video stream
	for (let i = 1; i < validScenes.length; i++) {
		const nextInput = `v${i}`;
		const outputTag = `vt${i}`; // Intermediate tag for transition output
		const fadeOffset = validScenes[i - 1].audioDuration - transitionDuration;
		complexFilter.push(
			`[${currentInput}][${nextInput}] xfade=transition=fade:duration=${transitionDuration}:offset=${fadeOffset} [${outputTag}]`
		);
		currentInput = outputTag; // Output of this transition becomes input for the next
	}
	lastVideoOutputTag = currentInput; // The final video stream tag after all transitions

	command.complexFilter(complexFilter);

	return new Promise((resolve, reject) => {
		command
			.outputOptions([
				"-map",
				`[${lastVideoOutputTag}]`,
				"-map",
				"[outa]",
				"-c:v",
				"libx264",
				"-c:a",
				"aac",
				"-shortest",
			])
			.output(outputPath)
			.on("start", (commandLine) => {
				console.log("Spawned Ffmpeg with command: " + commandLine);
			})
			.on("end", () => {
				console.log(`Video compiled successfully: ${outputPath}`);
				resolve({ videoPath: outputPath, videoFilename: outputFilename });
			})
			.on("error", (err) => {
				console.error("Error compiling video:", err);
				reject(new Error("ffmpeg complex filter failed: " + err.message));
			})
			.run();
	});
};
