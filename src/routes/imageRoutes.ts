import { Router } from "express";
import * as imageController from "../controllers/imageController";
import * as storyController from "../controllers/storyController";
import { generateImageWithGemini } from "../middlewares/geminiMiddleware";

const router = Router();

router.post(
	"/generate",
	generateImageWithGemini,
	imageController.generateImage
);

router.post("/story-to-images", storyController.generateImagesFromStory);

export default router;
