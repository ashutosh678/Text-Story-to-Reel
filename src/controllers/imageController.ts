// src/controllers/imageController.ts
import { Response, NextFunction } from "express";
import * as imageService from "../services/imageService";
import { RequestWithImageData } from "../types/express.d";

export const generateImage = async (
	req: RequestWithImageData,
	res: Response,
	next: NextFunction
) => {
	try {
		const imageBase64Data = req.generatedImageBase64;
		const { prompt } = req.body;

		if (!imageBase64Data) {
			console.error("Controller: Image data not found on request object.");
			return next(
				new Error(
					"Image generation failed: Missing image data from middleware."
				)
			);
		}

		const { filename } = await imageService.saveImageToFile(imageBase64Data);

		res.status(200).json({
			message: "Image generated and saved successfully.",
			filename: filename,
		});
	} catch (error) {
		console.error(
			"Controller Error:",
			error instanceof Error ? error.message : String(error)
		);
		next(error);
	}
};
