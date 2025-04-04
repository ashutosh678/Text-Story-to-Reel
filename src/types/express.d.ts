import { Request } from "express";

// Interface extending Express Request to include our custom property
export interface RequestWithImageData extends Request {
	generatedImageBase64?: string;
}
