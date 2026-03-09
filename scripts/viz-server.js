import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const HOST = "127.0.0.1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const defaultFile = path.join(rootDir, "viz", "index.html");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const requestPath = req.url === "/" ? "/viz/index.html" : req.url;
  const cleanPath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(rootDir, cleanPath);
  const resolvedPath = filePath.startsWith(rootDir) ? filePath : defaultFile;

  fs.readFile(resolvedPath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const extension = path.extname(resolvedPath);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Visualization server: http://${HOST}:${PORT}/`);
});
