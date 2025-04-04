import dotenv from "dotenv"; // Use import syntax
dotenv.config(); // Load environment variables first

import app from "./app"; // Use import syntax (./app will resolve to ./app.ts)

// Define type for port (can be string from env or number)
const port: string | number = process.env.PORT || 3000;

app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});
