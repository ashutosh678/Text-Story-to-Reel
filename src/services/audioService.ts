import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import fs from "fs/promises";
import path from "path";
import util from "util";
import { v4 as uuidv4 } from "uuid";

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

interface SynthesizeSpeechParams {
	text: string;
	outputFilename?: string; // Optional: Filename without extension
	languageCode?: string;
	voiceName?: string;
	speakingRate?: number;
}

interface SynthesizeSpeechResult {
	audioFilePath: string;
	audioFilename: string;
}

// Initialize the Text-to-Speech client
const ttsClient = new TextToSpeechClient();

export const synthesizeSpeech = async (
	params: SynthesizeSpeechParams
): Promise<SynthesizeSpeechResult> => {
	const {
		text,
		outputFilename: customFilename,
		languageCode = "en-US",
		// Consider using a WaveNet voice for higher quality
		voiceName = "en-US-Standard-C", // Example: Female standard voice
		// voiceName = 'en-US-Wavenet-D', // Example: Male WaveNet voice
		speakingRate = 1.0,
	} = params;

	await ensureAudioOutputDir();

	const outputFilename = customFilename
		? `${customFilename}.mp3`
		: `${uuidv4()}.mp3`;
	const outputPath = path.join(AUDIO_DIR, outputFilename);

	const request = {
		input: { text: text },
		voice: { languageCode: languageCode, name: voiceName },
		audioConfig: {
			audioEncoding: "MP3" as const, // Explicitly type as const for SDK
			speakingRate: speakingRate,
		},
	};

	try {
		console.log(`Synthesizing speech for text: "${text.substring(0, 50)}..."`);
		const [response] = await ttsClient.synthesizeSpeech(request);

		if (!response.audioContent) {
			throw new Error("API response did not contain audio content.");
		}

		// Write the binary audio content to a file
		await fs.writeFile(outputPath, response.audioContent, "binary");
		console.log(`Audio content written to file: ${outputPath}`);

		return { audioFilePath: outputPath, audioFilename: outputFilename };
	} catch (error) {
		console.error("ERROR synthesising speech:", error);
		throw new Error(
			`Failed to synthesize speech: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
};
