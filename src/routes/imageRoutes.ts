import { Router } from "express";
import * as imageController from "../controllers/imageController";
import { generateImageWithGemini } from "../middlewares/geminiMiddleware";

const router = Router();

router.post(
	"/generate",
	generateImageWithGemini,
	imageController.generateImage
);

export default router;
