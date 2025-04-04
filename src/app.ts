import express, { Express, Request, Response, NextFunction } from "express";
import imageRoutes from "./routes/imageRoutes"; // Use import syntax

const app: Express = express();

// Basic Middleware (add more as needed)
app.use(express.json()); // for parsing application/json

// Mount Routes
app.use("/api/v1", imageRoutes); // Mount image routes under /api/v1 (or /api if preferred)

// Basic Route (we'll move this later) - REMOVED
/*
app.get("/", (req, res) => {
	res.send("Hello World from the new structure!");
});
*/

// Error Handling Middleware (example)
// Add types for err, req, res, next
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
	console.error("Error Handler:", err.message); // Log just the message or the full stack
	console.error(err.stack);
	// Avoid sending stack trace in production
	res.status(500).json({
		message: "Something broke!",
		error: process.env.NODE_ENV === "development" ? err.message : undefined,
	});
});

export default app; // Use export default syntax
