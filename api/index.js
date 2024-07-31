import Fastify from "fastify";
import * as dotenv from "dotenv";
import {router} from "./routes/routes.js";

dotenv.config();

// CREATE APP
const app = Fastify({
  logger: true,
});

const doc = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hello World</title>
  </head>
  <body>
    <h1>Home Page</h1>
  </body>
</html>
`;

// ROUTER
app.get("/", async (req, res) => {
  return res.status(200).type("text/html").send(doc);
});
app.register(router, {prefix: "/api"});

// RUN APPLICATION
export default async function handler(req, reply) {
  await app.ready();
  app.server.emit("request", req, reply);
}
