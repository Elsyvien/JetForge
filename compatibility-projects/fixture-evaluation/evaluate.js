"use strict";

const fs = require("node:fs");

const [, , templatePath, fixturePath, outputPath] = process.argv;
if (!templatePath || !fixturePath || !outputPath) {
  throw new Error("Usage: evaluate.js TEMPLATE FIXTURE OUTPUT");
}
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const template = fs.readFileSync(templatePath, "utf8");
const output = template
  .replace(/<%@[^%]*%>\s*/g, "")
  .replace(/<%=\s*model\.([A-Za-z_$][\w$]*)\s*%>/g, (_match, name) => {
    if (!(name in fixture)) {
      throw new Error(`Fixture is missing model.${name}`);
    }
    return String(fixture[name]);
  });
fs.writeFileSync(outputPath, output, "utf8");
