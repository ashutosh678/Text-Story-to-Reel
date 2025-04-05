import say from "say";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import ffprobe from "ffprobe";
import ffprobeStatic from "ffprobe-static";

const AUDIO_DIR = path.join(__dirname, "../../outputs/audio");

// Ensure audio output directory exists
const ensureAudioOutputDir = async (): Promise<void> => {
	try {
		await fs.access(AUDIO_DIR);
	} catch (error: any) {
		if (error.code === "ENOENT") {
			try {
				await fs.mkdir(AUDIO_DIR, { recursive: true });
				console.log(`Created audio output directory: ${AUDIO_DIR}`);
			} catch (mkdirError) {
				console.error(
					`Failed to create audio output directory: ${AUDIO_DIR}`,
					mkdirError
				);
				throw new Error(
					`Failed to create audio output directory: ${AUDIO_DIR}`
				);
			}
		} else {
			console.error("Error accessing audio output directory:", error);
			throw new Error("Error accessing audio output directory.");
		}
	}
};

// Helper to get audio duration using ffprobe
export const getAudioDuration = async (filePath: string): Promise<number> => {
	try {
		await fs.access(filePath);
		const info = await ffprobe(filePath, { path: ffprobeStatic.path });
		const duration = info?.streams?.[0]?.duration;
		if (duration) {
			console.log(
				`Audio duration for ${path.basename(filePath)}: ${duration}s`
			);
			return parseFloat(duration);
		} else {
			console.warn(
				`Could not determine duration for ${filePath}, defaulting to 1 second.`
			);
			return 1;
		}
	} catch (err) {
		console.error(`ffprobe error for ${filePath}:`, err);
		if (
			err instanceof Error &&
			(err as NodeJS.ErrnoException).code === "ENOENT"
		) {
			throw new Error(`Audio file not found: ${filePath}`);
		}
		console.warn(`Defaulting duration to 1 second for ${filePath}.`);
		return 1;
	}
};

interface SynthesizeSpeechParams {
	text: string;
	outputFilename?: string; // Optional: Filename without extension
	// Note: Voice/speed options are limited and platform-dependent with say.js
	// voice?: string;
	// speed?: number; // Typically 1 is normal speed
}

interface SynthesizeSpeechResult {
	audioFilePath: string;
	audioFilename: string;
}

// Using say.js export function
export const synthesizeSpeech = (
	params: SynthesizeSpeechParams
): Promise<SynthesizeSpeechResult> => {
	return new Promise(async (resolve, reject) => {
		const {
			text,
			outputFilename: customFilename,
			// voice, // Can pass voice name if known for the platform
			// speed = 1
		} = params;

		try {
			await ensureAudioOutputDir();

			// Use .wav format as it's generally compatible across say/espeak/festival
			const outputFilename = customFilename
				? `${customFilename}.wav`
				: `${uuidv4()}.wav`;
			const outputPath = path.join(AUDIO_DIR, outputFilename);

			console.log(
				`Synthesizing speech (using OS TTS) for text: "${text.substring(
					0,
					50
				)}..."`
			);

			// Use say.export - arguments: text, voice, speed, filename, callback
			say.export(
				text,
				undefined,
				1,
				outputPath,
				(err: Error | string | null) => {
					if (err) {
						// Handle potential string error or Error object
						const errMsg = err instanceof Error ? err.message : String(err);
						console.error("say.export Error:", errMsg);
						return reject(
							new Error(`Failed to synthesize speech using OS TTS: ${errMsg}`)
						);
					}
					console.log(`Audio content written to file: ${outputPath}`);
					resolve({ audioFilePath: outputPath, audioFilename: outputFilename });
				}
			);
		} catch (error) {
			// Catch errors from ensureAudioOutputDir or other setup issues
			console.error("Error preparing speech synthesis:", error);
			reject(error);
		}
	});
};
