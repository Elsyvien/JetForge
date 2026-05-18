import assert from "node:assert/strict";
import { detectTargetLanguage, detectTargetLanguageFromFileName } from "./detector";

assert.equal(detectTargetLanguage("<%@ jet %>\n<?xml version=\"1.0\"?><root><%= value %></root>"), "txtjet-xml");
assert.equal(detectTargetLanguage("<%@ jet %>\n<!doctype html><html><body><%= value %></body></html>"), "txtjet-html");
assert.equal(detectTargetLanguage("<%@ jet %>\n#ifndef SAMPLE_H\n#define SAMPLE_H\ntypedef struct sample_s { int value; } sample_t;"), "txtjet-c");
assert.equal(detectTargetLanguage("<%@ jet %>\nfrom enum import Enum\nclass Sample(Enum):\n    VALUE = 1"), "txtjet-python");
assert.equal(detectTargetLanguage("<%@ jet %>\npackage generated.sample;\npublic class Sample {}"), "txtjet-java");
assert.equal(detectTargetLanguage("<%@ jet %>\nplain generated text"), "txtjet");

assert.equal(detectTargetLanguageFromFileName("packet.c.txtjet"), "txtjet-c");
assert.equal(detectTargetLanguageFromFileName("packet_h.txtjet"), "txtjet-c");
assert.equal(detectTargetLanguageFromFileName("model.py.txtjet"), "txtjet-python");
assert.equal(detectTargetLanguageFromFileName("view-html.txtjet"), "txtjet-html");
assert.equal(detectTargetLanguageFromFileName("document.xml.txtjet"), "txtjet-xml");
assert.equal(detectTargetLanguageFromFileName("Generator.java.txtjet"), "txtjet-java");
assert.equal(detectTargetLanguageFromFileName("unknown.txtjet"), "txtjet");

console.log("detector tests ok");
