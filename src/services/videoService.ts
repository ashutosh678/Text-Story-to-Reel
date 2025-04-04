import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";

const IMAGE_DIR = path.join(__dirname, "../../outputs"); // Base images directory
const VIDEO_DIR = path.join(__dirname, "../../outputs/videos"); // Videos subdirectory

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

interface CompileVideoParams {
	imageFilenames: string[]; // List of filenames (relative to IMAGE_DIR)
	frameRate?: number; // Frames per second (or images per second)
	videoFilename?: string; // Optional output filename (without extension)
}

interface CompileVideoResult {
	videoPath: string;
	videoFilename: string;
}

export const compileImagesToVideo = async (
	params: CompileVideoParams
): Promise<CompileVideoResult> => {
	const {
		imageFilenames,
		frameRate = 1,
		videoFilename: customFilename,
	} = params;

	if (!imageFilenames || imageFilenames.length === 0) {
		throw new Error("No image filenames provided for video compilation.");
	}

	await ensureVideoOutputDir();

	const outputFilename = customFilename
		? `${customFilename}.mp4`
		: `${uuidv4()}.mp4`;
	const outputPath = path.join(VIDEO_DIR, outputFilename);

	// Verify all images exist before starting ffmpeg
	const validImagePaths: string[] = [];
	for (const filename of imageFilenames) {
		const fullPath = path.join(IMAGE_DIR, filename);
		try {
			await fs.access(fullPath);
			validImagePaths.push(fullPath);
		} catch {
			console.warn(`Skipping non-existent image: ${filename}`);
		}
	}

	if (validImagePaths.length === 0) {
		throw new Error("None of the provided image files were found.");
	}

	return new Promise((resolve, reject) => {
		const command = ffmpeg();

		// Add each valid image as an input
		// Using concat demuxer is more robust for varying image sizes/formats
		// Create a temporary file list for ffmpeg
		const listFileName = path.join(VIDEO_DIR, `${uuidv4()}_ffmpeg_list.txt`);
		// Construct file content line by line using simple concatenation
		let fileContent = "";
		for (const imgPath of validImagePaths) {
			const safePath = imgPath.replace(/\//g, "/");
			const duration = 1 / frameRate;
			fileContent += "file '" + safePath + "'\n"; // Use double backslash for newline
			fileContent += "duration " + duration + "\n"; // Use double backslash for newline
		}

		fs.writeFile(listFileName, fileContent)
			.then(() => {
				command
					.input(listFileName)
					.inputOptions(["-f", "concat", "-safe", "0"]) // Use concat demuxer
					// .inputFPS(frameRate) // framerate controlled by duration in list file
					.outputOptions([
						"-pix_fmt",
						"yuv420p", // Standard pixel format for compatibility
						"-c:v",
						"libx264", // Standard video codec
						"-r",
						"30", // Output video framerate (e.g., 30 fps)
					])
					.output(outputPath)
					.on("start", (commandLine) => {
						console.log("Spawned Ffmpeg with command: " + commandLine);
					})
					.on("end", async () => {
						console.log(`Video compiled successfully: ${outputPath}`);
						// Clean up the temporary list file
						try {
							await fs.unlink(listFileName);
						} catch (unlinkErr) {
							console.warn(
								`Could not delete temp file ${listFileName}:`,
								unlinkErr
							);
						}
						resolve({ videoPath: outputPath, videoFilename: outputFilename });
					})
					.on("error", async (err) => {
						console.error("Error compiling video:", err);
						// Clean up the temporary list file on error too
						try {
							await fs.unlink(listFileName);
						} catch (unlinkErr) {
							console.warn(
								`Could not delete temp file ${listFileName} after error:`,
								unlinkErr
							);
						}
						reject(new Error("ffmpeg failed: " + err.message));
					})
					.run();
			})
			.catch((err) => {
				reject(new Error("Failed to write ffmpeg list file: " + err.message));
			});
	});
};
