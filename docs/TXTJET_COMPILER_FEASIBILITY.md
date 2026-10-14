# Integrierter TxtJet-Compiler: Machbarkeit

Recherche vom 13. Oktober 2026. Dies ist eine technische Einschätzung, keine fertig implementierte Compilerintegration. Gegenstand sind die Java-basierten Templates von JetForge und ihre mögliche Kompatibilität mit klassischem EMF JET.

## Verifizierte Grundlagen

Die echte Pipeline lautet: **Template → Java-Quelltext → kompilierte Java-Klasse → Aufruf mit Modell → erzeugter Text**. Expressions und Scriptlets bleiben Java; sie müssen nicht in TypeScript interpretiert werden. Die aktuelle Eclipse-Anleitung zeigt einen Driver, der die generierte Klasse mit einem Java-Modell aufruft. Ein Skeleton kann die Signatur auf einen konkreten Modelltyp ändern. Offizielle Skeletons bestehen aus Java-Klassen, beispielsweise `public class CLASS` mit einer `generate(IndexModel model)`-Methode. Das ist kein Format mit `${class}`-Platzhaltern. [Eclipse: JET Comprehensive Overview](https://help.eclipse.org/latest/topic/org.eclipse.emf.doc/tutorials/jet/jet.html#specialization-using-a-skeleton-class)

Der aktuelle `JETSkeleton` erzeugt standardmäßig `public String generate(Object argument)`. Damit braucht eine eigene Implementierung eine definierte Aufrufschnittstelle; eine parameterlose Vorschauklasse reicht für bestehende modellbasierte Templates nicht. [Offizieller JETSkeleton-Quelltext](https://github.com/eclipse-emf/org.eclipse.emf/blob/master/plugins/org.eclipse.emf.codegen/src/org/eclipse/emf/codegen/jet/JETSkeleton.java)

`JETCompiler` ist der niedrigere Template-zu-Java-Compiler. Seine API trennt `parse()` und `generate(OutputStream)`; `generate` schreibt Java-Quelltext und führt das Template nicht aus. Der aktuelle Quelltext behandelt Includes, deren alternative Abschnitte, Skeletons, Imports, veränderte Tags und Optionen wie `builder`, `nlString` und `minimize`. Eine eigene Frontend-Implementierung muss diese Semantik explizit übernehmen oder ihren unterstützten Umfang benennen. Der Quelltext steht unter EPL-2.0; eine Integration muss die Lizenzinformationen mitführen und die einschlägigen Verteilungspflichten prüfen. Dies ersetzt keine rechtliche Bewertung. [Offizieller JETCompiler-Quelltext](https://github.com/eclipse-emf/org.eclipse.emf/blob/master/plugins/org.eclipse.emf.codegen/src/org/eclipse/emf/codegen/jet/JETCompiler.java)

`JETEmitter` bietet dynamisches Übersetzen, Kompilieren und Ausführen. Allerdings ruft der **aktuelle** Quelltext seine Compilerinitialisierung nur auf, wenn `EMFPlugin.IS_ECLIPSE_RUNNING` wahr ist. Der Eclipse-Pfad verwendet Workspace, JDT und JavaBuilder. Ohne Eclipse und ohne vorher gesetzte Methode kann `generate` lediglich einen leeren String zurückgeben. Eine einzelne eingebundene JAR plus `new JETEmitter(...)` ist deshalb kein fertiger Standalone-Compiler. Ein bereits kompiliertes Template kann hingegen über die gesetzte Methode ausgeführt werden. [Offizieller JETEmitter-Quelltext](https://github.com/eclipse-emf/org.eclipse.emf/blob/master/plugins/org.eclipse.emf.codegen/src/org/eclipse/emf/codegen/jet/JETEmitter.java)

Das aktuelle Bundle-Manifest nennt `org.eclipse.core.runtime`, `org.eclipse.core.resources`, `org.eclipse.jdt.core`, `org.eclipse.jdt.launching`, `org.eclipse.debug.core`, `org.eclipse.text` und `org.eclipse.emf.common` als erforderliche Bundles. Diese Bundle-Anforderungen sind keine experimentell ermittelte minimale Classpath-Liste für alleinige Nutzung von `JETCompiler`. Welche JARs ein schlanker Runner tatsächlich benötigt, muss ein gepinnter Standalone-Prototyp zeigen. [Offizielles Bundle-Manifest](https://github.com/eclipse-emf/org.eclipse.emf/blob/master/plugins/org.eclipse.emf.codegen/META-INF/MANIFEST.MF)

## Empfehlungen für JetForge

**Eine eigene integrierte Compilerstrecke ist sinnvoll und machbar.** Empfohlenes Produktdesign:

1. Ein gemeinsames Compilerfrontend für Editor und CLI erzeugt echten Java-Code und Quellzuordnungen.
2. Das vorhandene JDK kompiliert den Java-Code mit Projektklassen und JARs.
3. Ein Java-Runner lädt das passende Modell und ruft die Generator-Methode auf.
4. JetForge übernimmt Ergebnisvorschau, Diff, Fixtures, Ausgabe und zurückgeführte Compilerfehler.

Als Frontend sind zwei Wege möglich:

| Weg | Vorteil | Zu klärender Aufwand |
| --- | --- | --- |
| Eigenes TxtJet-zu-Java-Frontend in TypeScript | Direkte Integration mit Parser, Includes und Quellzuordnungen von JetForge | Nachweis der klassischen JET-Semantik, insbesondere Whitespace, Skeletons und Include-Alternativen |
| Offizieller `JETCompiler` im Java-Helfer | Referenzimplementierung der EMF-JET-Semantik | Gepinnte Abhängigkeiten, Standalone-Test, Kommunikation mit Extension und Java-Diagnostik |

Für den ersten nutzbaren Ausbau bietet sich das eigene Frontend plus JDK-Runner an; bei hoher Priorität auf Bestandsprojekt-Kompatibilität sollte vorher der offizielle Compiler als Referenz beziehungsweise Backend getestet werden. Einen eigenen Java-Interpreter würde ich nicht entwickeln.

Das Modell ist eine eigene Integrationsentscheidung: Ein JSON-Modell kann beispielsweise als Map bereitgestellt werden, ersetzt aber keine existierenden Java-/EMF-Modellklassen. Dafür braucht es Classpath und einen projektabhängigen Loader beziehungsweise Driver. Vollständige Eclipse-Projekt-Kompatibilität darf erst nach Tests mit solchen Projekten zugesagt werden.

## Lokaler Machbarkeitsnachweis und offene Abnahme

In diesem Arbeitslauf wurde das bestehende Java-Vorschaufrontend mit Imports, einer deklarierten Hilfsmethode, Java-Schleife und Expression benutzt. Der resultierende Java-Code wurde mit dem lokalen OpenJDK 24 kompiliert und ausgeführt; die Ausgabe war exakt `<item>ALPHA</item><item>BETA</item>`. Dies belegt die Kernstrecke, nicht vollständige JET-Kompatibilität. Die aktuelle Vorschau erzeugt eine parameterlose `generate()`-Methode; das wurde in `src/templateModel.ts` geprüft. Der temporäre Test wurde anschließend entfernt.

Vor Produktfreigabe fehlen insbesondere echte Modellübergabe, verschachtelte Includes, klassische Skeletons, Fehlerzuordnung über Includes, konsistente Zeilenumbrüche, Projektabhängigkeiten, Laufabbruch und identische CLI-/Editor-Ergebnisse. Versions- und Packagingentscheidungen sowie ein minimaler Standalone-Classpath wurden in dieser Recherche nicht praktisch validiert.
