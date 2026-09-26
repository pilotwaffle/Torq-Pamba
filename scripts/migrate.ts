import { getDb } from "../src/db";

getDb()
  .then(() => {
    console.log("Migrations applied");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
