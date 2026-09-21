import "dotenv/config";
import { app } from "./app.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CS2 Faceit Comparison Tool listening on http://localhost:${PORT}`);
});
