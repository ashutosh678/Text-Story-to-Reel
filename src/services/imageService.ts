import fs from "fs/promises"; // Use fs/promises import
import path from "path";
import { v4 as uuidv4 } from "uuid";

const OUTPUT_DIR: string = path.join(__dirname, "../../outputs"); // Store in project root/outputs

// Ensure output directory exists
const ensureOutputDir = async (): Promise<void> => {
	try {
		await fs.access(OUTPUT_DIR);
	} catch (error: any) {
		// Type error loosely or use NodeJS.ErrnoException
		if (error.code === "ENOENT") {
			try {
				await fs.mkdir(OUTPUT_DIR, { recursive: true });
				console.log(`Created output directory: ${OUTPUT_DIR}`);
			} catch (mkdirError) {
				console.error(
					`Failed to create output directory: ${OUTPUT_DIR}`,
					mkdirError
				);
				throw new Error(`Failed to create output directory: ${OUTPUT_DIR}`);
			}
		} else {
			console.error("Error accessing output directory:", error);
			throw new Error("Error accessing output directory."); // Re-throw other errors
		}
	}
};

// Define return type for the function
interface SaveResult {
	filePath: string;
	filename: string;
}

export const saveImageToFile = async (
	imageBase64Data: string
): Promise<SaveResult> => {
	// Ensure the directory exists, awaiting the promise
	await ensureOutputDir();

	if (!imageBase64Data) {
		throw new Error("No image data provided to save.");
	}

	try {
		const imageBuffer: Buffer = Buffer.from(imageBase64Data, "base64");
		const filename: string = `${uuidv4()}.png`; // Generate unique filename (assuming PNG)
		const filePath: string = path.join(OUTPUT_DIR, filename);

		await fs.writeFile(filePath, imageBuffer);
		console.log(`Image saved successfully to: ${filePath}`);
		return { filePath, filename }; // Return path and name
	} catch (error) {
		console.error(
			"Error saving image to file:",
			error instanceof Error ? error.message : String(error)
		);
		throw new Error("Failed to save generated image.");
	}
};
