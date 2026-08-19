import assert from "node:assert/strict";
import {
  buildIpxactSchemaIndex,
  ipxactGeneratedStructures,
  ipxactXmlContextAt,
  ipxactXmlNameAt,
  MAX_IPXACT_XML_DEPTH,
  schemaAttributesFor,
  schemaChildrenFor,
  schemaElementsNamed
} from "./ipxactSchema";

const schemaFile = "/workspace/schemas/ieee1685-mini.xsd";
const schema = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="http://www.accellera.org/XMLSchema/IPXACT/1685-2022">
  <xs:element name="component" type="componentType">
    <xs:annotation><xs:documentation>Top-level IP-XACT component.</xs:documentation></xs:annotation>
  </xs:element>
  <xs:complexType name="componentType">
    <xs:sequence>
      <xs:element name="vendor" type="xs:string">
        <xs:annotation><xs:documentation>Vendor identifier.</xs:documentation></xs:annotation>
      </xs:element>
      <xs:element name="memoryMaps" type="memoryMapsType"/>
    </xs:sequence>
    <xs:attribute name="version" type="xs:string" use="required">
      <xs:annotation><xs:documentation>Schema version.</xs:documentation></xs:annotation>
    </xs:attribute>
  </xs:complexType>
  <xs:complexType name="memoryMapsType">
    <xs:sequence>
      <xs:element name="memoryMap" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

const index = buildIpxactSchemaIndex([{ fileName: schemaFile, text: schema }]);
assert.deepEqual(index.globalElements, ["component"]);
const component = schemaElementsNamed(index, "component")[0];
assert.ok(component);
assert.match(component.documentation ?? "", /Top-level IP-XACT component/);
assert.deepEqual(component.children, ["vendor", "memoryMaps"]);
assert.deepEqual(schemaChildrenFor(index, "component").map((element) => element.name), ["vendor", "memoryMaps"]);
const version = schemaAttributesFor(index, "component").find((attribute) => attribute.name === "version");
assert.ok(version);
assert.equal(version.required, true);
assert.match(version.documentation ?? "", /Schema version/);
assert.equal(component.location.fileName, schemaFile);
assert.match(schema.slice(component.location.range.start, component.location.range.end), /name="component"/);

const sharedTypesFile = "/workspace/schemas/shared-types.xsd";
const crossDocumentIndex = buildIpxactSchemaIndex([
  {
    fileName: schemaFile,
    text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="component" type="sharedType"/></xs:schema>'
  },
  {
    fileName: sharedTypesFile,
    text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:complexType name="sharedType"><xs:attribute name="vendor" use="required"/></xs:complexType></xs:schema>'
  }
]);
assert.equal(schemaAttributesFor(crossDocumentIndex, "component")[0]?.location.fileName, sharedTypesFile);

const inheritanceSchema = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:t="urn:test" targetNamespace="urn:test">
  <xs:group name="commonChildren">
    <xs:sequence><xs:element name="vendor" type="xs:string"/></xs:sequence>
  </xs:group>
  <xs:attributeGroup name="commonAttributes">
    <xs:attribute name="version" type="xs:string" use="required"/>
  </xs:attributeGroup>
  <xs:complexType name="baseType">
    <xs:sequence>
      <xs:element name="baseChild" type="xs:string"/>
      <xs:group ref="t:commonChildren"/>
    </xs:sequence>
    <xs:attributeGroup ref="t:commonAttributes"/>
  </xs:complexType>
  <xs:complexType name="derivedType">
    <xs:complexContent>
      <xs:extension base="t:baseType">
        <xs:sequence><xs:element name="derivedChild" type="xs:string"/></xs:sequence>
        <xs:attribute name="local" type="xs:string"/>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
  <xs:element name="component" type="t:derivedType"/>
</xs:schema>`;
const inheritanceIndex = buildIpxactSchemaIndex([{
  fileName: "/workspace/schemas/inheritance.xsd",
  text: inheritanceSchema
}]);
assert.deepEqual(
  schemaChildrenFor(inheritanceIndex, "component").map((element) => element.name),
  ["baseChild", "vendor", "derivedChild"]
);
assert.deepEqual(
  schemaAttributesFor(inheritanceIndex, "component").map((attribute) => [attribute.name, attribute.required]),
  [["version", true], ["local", false]]
);

const namespaceIndex = buildIpxactSchemaIndex([
  {
    fileName: "/workspace/schemas/a.xsd",
    text: `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:a="urn:a" targetNamespace="urn:a">
      <xs:complexType name="sharedType"><xs:sequence><xs:element name="aChild"/></xs:sequence></xs:complexType>
      <xs:element name="aRoot" type="a:sharedType"/>
    </xs:schema>`
  },
  {
    fileName: "/workspace/schemas/b.xsd",
    text: `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:b="urn:b" targetNamespace="urn:b">
      <xs:complexType name="sharedType"><xs:sequence><xs:element name="bChild"/></xs:sequence></xs:complexType>
      <xs:element name="bRoot" type="b:sharedType"/>
    </xs:schema>`
  }
]);
assert.deepEqual(schemaElementsNamed(namespaceIndex, "aRoot")[0]?.children, ["aChild"]);
assert.deepEqual(schemaElementsNamed(namespaceIndex, "bRoot")[0]?.children, ["bChild"]);

const referenceIndex = buildIpxactSchemaIndex([{
  fileName: "/workspace/schemas/references.xsd",
  text: `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:t="urn:refs" targetNamespace="urn:refs">
    <xs:complexType name="componentType"><xs:sequence><xs:element ref="t:item"/></xs:sequence></xs:complexType>
    <xs:element name="component" type="t:componentType"/>
    <xs:element name="item"><xs:annotation><xs:documentation>Global item.</xs:documentation></xs:annotation></xs:element>
  </xs:schema>`
}]);
const referencedItem = schemaChildrenFor(referenceIndex, "component")[0];
assert.equal(referencedItem?.global, true);
assert.match(referencedItem?.documentation ?? "", /Global item/);

const elementTemplate = "<component>\n  <mem";
const elementContext = ipxactXmlContextAt(elementTemplate, elementTemplate.length);
assert.equal(elementContext?.kind, "element");
assert.equal(elementContext?.parentElement, "component");
assert.equal(elementContext?.prefix, "mem");

const namespacedTemplate = "<ipxact:component>\n  <ipxact:mem";
const namespacedContext = ipxactXmlContextAt(namespacedTemplate, namespacedTemplate.length);
assert.equal(namespacedContext?.parentElement, "component");
assert.equal(namespacedContext?.namespacePrefix, "ipxact");
assert.equal(namespacedContext?.prefix, "mem");

const attributeTemplate = "<component ver";
const attributeContext = ipxactXmlContextAt(attributeTemplate, attributeTemplate.length);
assert.equal(attributeContext?.kind, "attribute");
assert.equal(attributeContext?.element, "component");
assert.equal(attributeContext?.prefix, "ver");

const mixedTemplate = "<component>\n<% if (ready) { %>\n  <vendor>demo</vendor>\n<% } %>\n</component>";
const vendorOffset = mixedTemplate.indexOf("vendor") + 2;
const vendorName = ipxactXmlNameAt(mixedTemplate, vendorOffset);
assert.equal(vendorName?.kind, "element");
assert.equal(vendorName?.name, "vendor");

const generatedStructures = ipxactGeneratedStructures(`<component>
  <name>demo.component</name>
  <busInterfaces>
    <busInterface><name>control</name></busInterface>
  </busInterfaces>
  <memoryMaps>
    <memoryMap>
      <name>registers</name>
      <addressBlock>
        <name>csr</name>
        <register><name>STATUS</name><field><name>ready</name></field></register>
      </addressBlock>
    </memoryMap>
  </memoryMaps>
</component>`);
assert.equal(generatedStructures[0]?.kind, "component");
assert.equal(generatedStructures[0]?.name, "demo.component");
assert.equal(generatedStructures[0]?.children[0]?.kind, "busInterface");
assert.equal(generatedStructures[0]?.children[1]?.kind, "memoryMap");
assert.equal(generatedStructures[0]?.children[1]?.children[0]?.kind, "addressBlock");
assert.equal(generatedStructures[0]?.children[1]?.children[0]?.children[0]?.kind, "register");
assert.equal(generatedStructures[0]?.children[1]?.children[0]?.children[0]?.children[0]?.name, "ready");

const malformedComments = "<!--".repeat(30000);
const malformedCommentsStart = performance.now();
assert.deepEqual(ipxactGeneratedStructures(malformedComments), []);
const malformedCommentsElapsedMs = performance.now() - malformedCommentsStart;
assert.ok(
  malformedCommentsElapsedMs < 1000,
  `malformed comment scan took ${malformedCommentsElapsedMs.toFixed(1)} ms; expected a linear scan below 1000 ms`
);

const maximumDepthXml = "<component>" + "<memoryMap>".repeat(MAX_IPXACT_XML_DEPTH - 1);
assert.doesNotThrow(() => ipxactGeneratedStructures(maximumDepthXml));
const excessiveDepthXml = "<component>" + "<memoryMap>".repeat(MAX_IPXACT_XML_DEPTH);
assert.throws(() => ipxactGeneratedStructures(excessiveDepthXml), /IP-XACT XML depth exceeded its limit/);

const schemaInheritanceDepth = 1000;
const inheritanceChain = Array.from({ length: schemaInheritanceDepth }, (_, index) =>
  index === schemaInheritanceDepth - 1
    ? `<xs:complexType name="T${index}"><xs:sequence><xs:element name="terminal"/></xs:sequence></xs:complexType>`
    : `<xs:complexType name="T${index}"><xs:complexContent><xs:extension base="T${index + 1}"/></xs:complexContent></xs:complexType>`
).join("");
const deepInheritanceIndex = buildIpxactSchemaIndex([{
  fileName: "/workspace/schemas/deep-inheritance.xsd",
  text: `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="component" type="T0"/>${inheritanceChain}</xs:schema>`
}]);
assert.deepEqual(schemaChildrenFor(deepInheritanceIndex, "component").map((element) => element.name), ["terminal"]);

console.log("ipxact schema tests ok");
