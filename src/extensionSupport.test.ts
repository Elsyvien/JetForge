import assert from "node:assert/strict";
import { COMPLETION_TRIGGER_CHARACTERS, isTxtJetPath, shouldOfferMarkerCompletions } from "./extensionSupport";

assert.deepEqual(COMPLETION_TRIGGER_CHARACTERS, ["<"]);

assert.equal(shouldOfferMarkerCompletions("<"), true);
assert.equal(shouldOfferMarkerCompletions("prefix <"), true);
assert.equal(shouldOfferMarkerCompletions("prefix"), false);
assert.equal(shouldOfferMarkerCompletions("@"), false);
assert.equal(shouldOfferMarkerCompletions(" "), false);

assert.equal(isTxtJetPath("/workspace/example.txtjet"), true);
assert.equal(isTxtJetPath("/workspace/EXAMPLE.TXTJET"), true);
assert.equal(isTxtJetPath("/workspace/example.txt"), false);
assert.equal(isTxtJetPath("vscode-remote://ssh-remote+host/workspace/example.txtjet"), true);

console.log("extension support tests ok");
