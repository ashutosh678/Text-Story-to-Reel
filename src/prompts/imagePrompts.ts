// src/prompts/imagePrompts.ts
export const getRefinementPrompt = (initialPrompt: string): string => {
	return `Enhance the following user request into a detailed and vivid prompt suitable for an image generation model. Focus on visual details, atmosphere, and style. User request: "${initialPrompt}"`;
};
