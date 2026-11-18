const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dest = path.join(root, "public");
const names = [
  "index.html",
  "admin.html",
  "config.json",
  "favicon.svg",
  "manifest.webmanifest",
  "sw.js",
  "css",
  "js",
  "icons",
  "vendor",
];

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const name of names) {
  fs.cpSync(path.join(root, name), path.join(dest, name), { recursive: true });
}
