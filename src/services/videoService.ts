import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import ffprobe from "ffprobe";
import ffprobeStatic from "ffprobe-static";

const IMAGE_DIR = path.join(__dirname, "../../outputs"); // Base images directory
const AUDIO_DIR = path.join(__dirname, "../../outputs/audio");
const VIDEO_DIR = path.join(__dirname, "../../outputs/videos"); // Videos subdirectory
const TEMP_DIR = path.join(__dirname, "../../outputs/temp"); // Temporary directory for segments

// Helper to get audio duration
const getAudioDuration = async (filePath: string): Promise<number> => {
	try {
		const result: ffprobe.FFProbeResult = await ffprobe(filePath, {
			path: ffprobeStatic.path,
		});

		// Try getting duration from the first audio stream first
		if (
			result.streams &&
			result.streams.length > 0 &&
			result.streams[0].codec_type === "audio" &&
			result.streams[0].duration
		) {
			const duration = parseFloat(result.streams[0].duration);
			if (!isNaN(duration)) {
				return duration;
			}
		}

		// Fallback to format duration (using type assertion)
		const format = (result as any).format;
		if (format && format.duration) {
			const duration = parseFloat(format.duration);
			if (!isNaN(duration)) {
				return duration;
			}
		}

		// If neither worked, throw an error
		console.error(
			"Could not determine audio duration from ffprobe result:",
			result
		);
		throw new Error(`Could not determine audio duration for ${filePath}`);
	} catch (error: any) {
		console.error(
			`Error getting audio duration for ${filePath}: ${error.message}`
		);
		throw new Error(`Failed to get audio duration for ${filePath}`);
	}
};

// Ensure output directories exist (including temp)
const ensureDirs = async (): Promise<void> => {
	try {
		await fs.mkdir(VIDEO_DIR, { recursive: true });
		await fs.mkdir(TEMP_DIR, { recursive: true }); // Ensure TEMP_DIR exists
		console.log(`Ensured output directories exist: ${VIDEO_DIR}, ${TEMP_DIR}`);
	} catch (error: any) {
		console.error("Error creating output/temp directories:", error);
		throw new Error("Failed to create necessary output directories.");
	}
};

// Helper function to create a single video segment from an image
const createSegment = (
	imagePath: string,
	segmentDuration: number,
	segmentOutputPath: string,
	outputFps: number
): Promise<void> => {
	return new Promise((resolve, reject) => {
		ffmpeg()
			.input(imagePath)
			.inputOptions(["-loop", "1"]) // Loop the single image
			.inputFPS(outputFps) // Interpret the image input at the target FPS
			.outputOptions([
				"-c:v",
				"libx264",
				"-t",
				segmentDuration.toString(), // Set exact duration
				"-pix_fmt",
				"yuv420p",
				"-vf",
				"scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black", // Scale/pad filter
			])
			.noAudio() // No audio for segments
			.output(segmentOutputPath)
			.on("end", () => resolve())
			.on("error", (err) =>
				reject(
					new Error(
						`Failed to create segment ${segmentOutputPath}: ${err.message}`
					)
				)
			)
			.run();
	});
};

// Parameters for the main function
interface CompileVideoWithFullAudioParams {
	imageFilenames: string[];
	fullAudioFilename: string;
	totalAudioDuration: number;
	outputVideoFilename?: string;
	outputFps?: number;
}

interface CompileVideoResult {
	videoPath: string;
	videoFilename: string;
}

// Main function using concat demuxer
export const compileVideoWithFullAudio = async (
	params: CompileVideoWithFullAudioParams
): Promise<CompileVideoResult> => {
	const {
		imageFilenames,
		fullAudioFilename,
		totalAudioDuration,
		outputVideoFilename: customFilename,
		outputFps = 30,
	} = params;

	if (
		!imageFilenames ||
		imageFilenames.length === 0 ||
		totalAudioDuration <= 0
	) {
		throw new Error(
			"Invalid input: Missing images, audio filename, or valid audio duration."
		);
	}

	await ensureDirs(); // Ensure all needed directories exist

	const outputFilename = customFilename
		? `${customFilename}.mp4`
		: `${uuidv4()}.mp4`;
	const finalOutputPath = path.join(VIDEO_DIR, outputFilename);
	const fullAudioPath = path.join(AUDIO_DIR, fullAudioFilename);
	const concatListPath = path.join(TEMP_DIR, `${uuidv4()}_concat_list.txt`);
	const tempSegmentPaths: string[] = [];

	try {
		// --- 1. Prepare valid images and calculate segment duration ---
		const validImagePaths: string[] = [];
		for (const filename of imageFilenames) {
			const imagePath = path.join(IMAGE_DIR, filename);
			try {
				await fs.access(imagePath);
				validImagePaths.push(imagePath);
			} catch (err: any) {
				console.warn(`Skipping image due to missing file: ${filename}`);
			}
		}
		if (validImagePaths.length === 0) {
			throw new Error("No valid image files were found.");
		}
		const actualDurationPerSegment =
			totalAudioDuration / validImagePaths.length;
		console.log(
			`Total Audio: ${totalAudioDuration}s, Segments: ${validImagePaths.length}, Duration/Segment: ${actualDurationPerSegment}s`
		);

		// --- 2. Create individual video segments ---
		console.log("Creating temporary video segments...");
		const segmentCreationPromises: Promise<void>[] = [];
		for (let i = 0; i < validImagePaths.length; i++) {
			const imgPath = validImagePaths[i];
			const segmentPath = path.join(TEMP_DIR, `temp_segment_${i}.mp4`);
			tempSegmentPaths.push(segmentPath);
			segmentCreationPromises.push(
				createSegment(imgPath, actualDurationPerSegment, segmentPath, outputFps)
			);
		}
		await Promise.all(segmentCreationPromises);
		console.log("Temporary video segments created successfully.");

		// --- 3. Create concat list file ---
		const concatFileContent = tempSegmentPaths
			.map((p) => `file '${p.replace(/\\/g, "/")}'`)
			.join("\n"); // Correct path separator replacement
		await fs.writeFile(concatListPath, concatFileContent);
		console.log("Concat list file created.");

		// --- 4. Concatenate segments and add audio ---
		console.log("Concatenating segments and adding audio...");
		await new Promise<void>((resolve, reject) => {
			ffmpeg()
				.input(concatListPath)
				.inputOptions(["-f", "concat", "-safe", "0"])
				.input(fullAudioPath)
				.outputOptions([
					"-map",
					"0:v", // Map video from concat input
					"-map",
					"1:a", // Map audio from audio input
					"-c:v",
					"libx264",
					"-c:a",
					"aac",
					"-pix_fmt",
					"yuv420p",
					"-shortest", // Use shortest to ensure alignment with concat video length
				])
				.output(finalOutputPath)
				.on("start", (cmd) =>
					console.log("Spawned Ffmpeg concat command: " + cmd)
				)
				.on("end", () => {
					console.log(`Final video created: ${finalOutputPath}`);
					resolve();
				})
				.on("error", (err) => {
					console.error("Error during final concatenation:", err);
					reject(new Error("ffmpeg concatenation failed: " + err.message));
				})
				.run();
		});

		return { videoPath: finalOutputPath, videoFilename: outputFilename };
	} catch (error) {
		console.error("Error during video compilation process:", error);
		throw error; // Re-throw the error
	} finally {
		// --- 5. Cleanup temporary files ---
		console.log("Cleaning up temporary files...");
		const cleanupPromises = [
			fs
				.unlink(concatListPath)
				.catch((e) => console.warn(`Failed to delete ${concatListPath}`, e)),
		];
		for (const tempPath of tempSegmentPaths) {
			cleanupPromises.push(
				fs
					.unlink(tempPath)
					.catch((e) => console.warn(`Failed to delete ${tempPath}`, e))
			);
		}
		await Promise.allSettled(cleanupPromises);
		console.log("Temporary file cleanup finished.");
	}
};
