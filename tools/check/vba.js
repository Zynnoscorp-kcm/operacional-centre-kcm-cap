#!/usr/bin/env node
/**
 * Analisis estatico de las fuentes `.bas` del cliente Excel.
 *
 * El editor VBA solo existe en Windows, asi que este proyecto no puede compilar los modulos aqui.
 * Sin una comprobacion lexica propia, un literal de cadena mal escapado pasa `npm test` intacto y
 * recien falla al compilar el libro, cuando ya no hay evidencia local. El linter reproduce las
 * reglas del lexer de VBA que si pueden verificarse fuera de Excel:
 *
 * - literales de cadena cerrados, con `""` como unica forma de comillas internas;
 * - continuaciones ` _` validas y por debajo del limite del editor;
 * - ausencia de caracteres que VBA nunca acepta fuera de una cadena o comentario;
 * - bloques `Sub`/`Function`/`If`/`For`/`Do`/`With`/`Select`/`Type`/`#If` balanceados;
 * - `Option Explicit` presente y variables declaradas realmente usadas;
 * - toda referencia `Kcm*` resuelta contra una declaracion del propio cliente;
 * - la frontera de plataforma: `#If Mac` solo puede aparecer en el puerto.
 *
 * Esa ultima regla es la que sostiene la estrategia "Mac primero, Windows en paralelo". El
 * compilador de cada sistema compila SOLO su rama de un `#If`, de modo que un error escrito dentro
 * de `#If Mac` no se manifiesta al compilar en Windows ni al reves. La unica defensa disponible sin
 * Excel es mantener esa superficie chica y verificable: el linter analiza el texto completo de las
 * dos ramas, y ademas exige que vivan donde estan declaradas.
 *
 * No sustituye a la compilacion en Excel; acota la clase de fallo que si es detectable sin Excel.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const VBA_DIR = "clients/excel/vba";
const MAX_CONTINUATIONS = 24;
const VBA_EXTENSIONS = [".bas", ".cls"];

/**
 * El unico modulo autorizado a compilar codigo distinto por sistema: `KcmPlataforma`, el puerto.
 */
const PLATFORM_FILES = new Set(["KcmPlataforma.bas"]);

/** VBA solo admite `""` dentro de una cadena; una comilla suelta la termina. */
const STRING_FOLLOWERS = new Set([
  "&", ")", ",", ":", "=", "<", ">", "+", "-", "*", "/", "\\", "^", ".", ";", "'", " ", ""
]);

const FORBIDDEN_OUTSIDE_STRINGS = new Map([
  ["{", "VBA no admite llaves fuera de una cadena"],
  ["}", "VBA no admite llaves fuera de una cadena"],
  ["`", "VBA no admite acento grave"],
  ["[", "VBA reserva los corchetes para identificadores foraneos"],
  ["]", "VBA reserva los corchetes para identificadores foraneos"]
]);

const BLOCK_OPENERS = [
  { name: "Sub", open: /^(?:public\s+|private\s+|friend\s+)?(?:static\s+)?sub\b/, close: /^end\s+sub\b/ },
  { name: "Function", open: /^(?:public\s+|private\s+|friend\s+)?(?:static\s+)?function\b/, close: /^end\s+function\b/ },
  { name: "Property", open: /^(?:public\s+|private\s+|friend\s+)?(?:static\s+)?property\s+(?:get|let|set)\b/, close: /^end\s+property\b/ },
  { name: "Type", open: /^(?:public\s+|private\s+)?type\b/, close: /^end\s+type\b/ },
  { name: "With", open: /^with\b/, close: /^end\s+with\b/ },
  { name: "Select", open: /^select\s+case\b/, close: /^end\s+select\b/ },
  { name: "Do", open: /^do\b/, close: /^loop\b/ },
  { name: "While", open: /^while\b/, close: /^wend\b/ },
  { name: "For", open: /^for\b/, close: /^next\b/ },
  { name: "If", open: null, close: /^end\s+if\b/ },
  { name: "#If", open: /^#if\b/, close: /^#end\s+if\b/ }
];

/**
 * Recorre una linea fisica separando codigo, cadenas y comentario.
 * Devuelve los hallazgos lexicos y si la linea termina en continuacion.
 */
function scanPhysicalLine(text) {
  const issues = [];
  let inString = false;
  let code = "";
  let comment = false;
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (inString) {
      if (character === "\"") {
        if (text[index + 1] === "\"") {
          index += 2;
          continue;
        }
        inString = false;
        const next = text[index + 1] === undefined ? "" : text[index + 1];
        if (!STRING_FOLLOWERS.has(next)) {
          issues.push({
            column: index + 2,
            message: `un literal de cadena termina antes de ${JSON.stringify(next)}; ` +
              "una comilla interna debe escribirse \"\""
          });
        }
        code += "\"\"";
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }
    if (character === "'") {
      comment = true;
      break;
    }
    if (character === "\"") {
      inString = true;
      index += 1;
      continue;
    }
    const forbidden = FORBIDDEN_OUTSIDE_STRINGS.get(character);
    if (forbidden) issues.push({ column: index + 1, message: forbidden });
    code += character;
    index += 1;
  }
  if (inString) {
    issues.push({ column: text.length + 1, message: "un literal de cadena queda sin cerrar" });
  }
  const continued = !comment && /\s_$/.test(code);
  return { issues, code: continued ? code.replace(/\s_$/, " ") : code, continued, comment };
}

/** Une continuaciones para obtener sentencias completas sin perder la linea de origen. */
function logicalLines(source) {
  const statements = [];
  const physical = source.split(/\r?\n/);
  const lexical = [];
  let buffer = "";
  let startLine = 0;
  let run = 0;
  let maxRun = 0;
  physical.forEach((text, offset) => {
    const line = offset + 1;
    const scanned = scanPhysicalLine(text);
    scanned.issues.forEach((issue) => lexical.push({ line, ...issue }));
    if (buffer === "") startLine = line;
    buffer += scanned.code;
    if (scanned.continued) {
      run += 1;
      maxRun = Math.max(maxRun, run);
      return;
    }
    run = 0;
    const statement = buffer.trim();
    buffer = "";
    if (statement !== "") statements.push({ line: startLine, text: statement });
  });
  if (buffer.trim() !== "") {
    lexical.push({ line: startLine, column: 1, message: "la ultima linea queda en continuacion" });
  }
  return { statements, lexical, maxRun };
}

/** `If ... Then` abre bloque solo cuando `Then` cierra la sentencia. */
function opensIfBlock(text) {
  if (!/^if\b/i.test(text)) return false;
  return /\bthen$/i.test(text.replace(/\s*''.*$/, "").trim());
}

/**
 * `#If Mac` fuera del puerto rompe la garantia de que probar en un sistema dice algo del otro.
 * Se senala la directiva, no su contenido: basta con impedir que la frontera se mueva.
 */
function checkPlatformBoundary(statements, file) {
  if (PLATFORM_FILES.has(file)) return [];
  return statements
    .filter(({ text }) => /^#if\b/i.test(text) && /\bmac\b/i.test(text))
    .map(({ line }) => ({
      file,
      line,
      message:
        "declara una rama por sistema con #If Mac; el codigo dependiente de plataforma vive en " +
        "KcmPlataforma.bas y solo ahi",
    }));
}

function checkBlocks(statements, file) {
  const findings = [];
  const stack = [];
  for (const { line, text } of statements) {
    const lower = text.toLowerCase();
    if (/^(?:public|private|friend)?\s*declare\b/.test(lower) || /\bdeclare\s+(?:ptrsafe\s+)?(?:sub|function)\b/.test(lower)) {
      continue;
    }
    if (/^(?:public|private)?\s*(?:const|dim|enum)\b/.test(lower)) {
      if (!/^(?:public|private)?\s*enum\b/.test(lower)) continue;
    }
    let closed = false;
    for (const block of BLOCK_OPENERS) {
      if (block.close.test(lower)) {
        const top = stack.pop();
        if (!top) {
          findings.push({ file, line, message: `${text} cierra un bloque que nunca se abrio` });
        } else if (top.name !== block.name) {
          findings.push({ file, line, message: `${text} cierra ${block.name} pero el bloque abierto es ${top.name} (linea ${top.line})` });
        }
        closed = true;
        break;
      }
    }
    if (closed) continue;
    if (opensIfBlock(lower)) {
      stack.push({ name: "If", line });
      continue;
    }
    // `Exit Sub` y `Exit Function` no cierran el bloque; `End` a secas si terminaria la ejecucion.
    const salida = /^exit\s+(sub|function|property)\b/.exec(lower);
    if (salida) {
      // Salir con la palabra del procedimiento equivocado no compila, y es facil de escribir al
      // convertir un Sub en Function o al mover codigo de un procedimiento a otro.
      const dentro = [...stack].reverse().find((entry) =>
        ["Sub", "Function", "Property"].includes(entry.name),
      );
      if (dentro && dentro.name.toLowerCase() !== salida[1]) {
        findings.push({
          file,
          line,
          message: `${text} sale de un ${dentro.name} (linea ${dentro.line}); VBA exige Exit ${dentro.name}`,
        });
      }
      continue;
    }
    if (/^exit\s+(for|do)\b/.test(lower)) continue;
    for (const block of BLOCK_OPENERS) {
      if (block.open && block.open.test(lower)) {
        // Un `For ... : Next` de una sola linea no deja bloque abierto.
        if (block.name === "For" && /(?:^|:)\s*next\b/.test(lower)) break;
        // VBA no admite procedimientos anidados: si uno abre dentro de otro, falta un `End`.
        if (["Sub", "Function", "Property"].includes(block.name)) {
          const open = stack.find((entry) => ["Sub", "Function", "Property"].includes(entry.name));
          if (open) {
            findings.push({
              file,
              line,
              message: `${text} abre un procedimiento dentro de ${open.name} (linea ${open.line}); ` +
                "falta su End"
            });
          }
        }
        stack.push({ name: block.name, line });
        break;
      }
    }
  }
  stack.forEach((entry) => {
    findings.push({ file, line: entry.line, message: `el bloque ${entry.name} nunca se cierra` });
  });
  return findings;
}

const DECLARATION = /^(?:public\s+|private\s+|friend\s+)?(?:static\s+)?(sub|function|property\s+(?:get|let|set)|const|type|enum)\s+(kcm[a-z0-9_]*)/i;

function declaredNames(statements, source) {
  const names = new Set();
  // `Attribute VB_Name` bautiza al modulo. En un `.cls` ese nombre ES el tipo: `New KcmDiccionario`
  // no se resuelve contra ninguna declaracion `Sub` ni `Function`, sino contra esta linea. Se lee
  // del texto original porque el analizador lexico vacia los literales de cadena.
  const moduleName = /^\s*Attribute\s+VB_Name\s*=\s*"(Kcm[A-Za-z0-9_]*)"/m.exec(source ?? "");
  if (moduleName) names.add(moduleName[1].toLowerCase());
  for (const { text } of statements) {
    const match = DECLARATION.exec(text);
    if (match) names.add(match[2].toLowerCase());
    // `Declare` importa una API externa; su nombre tambien queda disponible en el modulo.
    const external = /\bdeclare\s+(?:ptrsafe\s+)?(?:sub|function)\s+(kcm[a-z0-9_]*)/i.exec(text);
    if (external) names.add(external[1].toLowerCase());
  }
  return names;
}

function referencedNames(statements) {
  const references = new Map();
  for (const { line, text } of statements) {
    const declaration = DECLARATION.exec(text);
    for (const match of text.matchAll(/\bKcm[A-Za-z0-9_]*/g)) {
      const name = match[0].toLowerCase();
      if (declaration && declaration[2].toLowerCase() === name) continue;
      if (!references.has(name)) references.set(name, line);
    }
  }
  return references;
}

/** Detecta `Dim` sin ningun uso posterior: casi siempre un resto de una version anterior. */
function unusedLocals(statements, file) {
  const findings = [];
  let scope = null;
  const flush = () => {
    if (!scope) return;
    for (const [name, line] of scope.declared) {
      const used = scope.body.some((text) => new RegExp(`\\b${name}\\b`, "i").test(text));
      if (!used) findings.push({ file, line, message: `la variable ${name} se declara y nunca se usa` });
    }
    scope = null;
  };
  for (const { line, text } of statements) {
    const lower = text.toLowerCase();
    const opener =
      /^(?:public\s+|private\s+|friend\s+)?(?:static\s+)?(?:sub|function|property\s+(?:get|let|set))\b/;
    if (opener.test(lower) && !/\bdeclare\b/.test(lower)) {
      flush();
      scope = { declared: new Map(), body: [] };
      continue;
    }
    if (/^end\s+(sub|function|property)\b/.test(lower)) {
      flush();
      continue;
    }
    if (!scope) continue;
    const dim = /^dim\s+([a-z_][a-z0-9_]*)/i.exec(text);
    if (dim) {
      scope.declared.set(dim[1], line);
      continue;
    }
    scope.body.push(text);
  }
  flush();
  return findings;
}

async function main() {
  const files = (await readdir(VBA_DIR))
    .filter((name) => VBA_EXTENSIONS.some((extension) => name.endsWith(extension)))
    .sort();
  if (!files.length) throw new Error(`No hay fuentes VBA en ${VBA_DIR}`);
  const findings = [];
  const modules = new Map();
  for (const file of files) {
    const source = await readFile(path.join(VBA_DIR, file), "utf8");
    const { statements, lexical, maxRun } = logicalLines(source);
    modules.set(file, { statements, source });
    lexical.forEach((issue) => findings.push({ file, line: issue.line, message: issue.message }));
    // `File > Import File` del editor VBA interpreta el `.bas` con la pagina de codigos de Windows,
    // no como UTF-8: una vocal acentuada literal llegaria corrompida al modulo compilado. Los
    // caracteres no ASCII que el codigo necesita se construyen con `ChrW$`.
    source.split(/\r?\n/).forEach((text, offset) => {
      const match = /[^\x00-\x7F]/.exec(text);
      if (match) {
        findings.push({
          file,
          line: offset + 1,
          message: `contiene el caracter no ASCII ${JSON.stringify(match[0])}; use ChrW$(` +
            `${match[0].codePointAt(0)}) para que la importacion no dependa de la pagina de codigos`
        });
      }
    });
    if (maxRun > MAX_CONTINUATIONS) {
      findings.push({ file, line: 0, message: `usa ${maxRun} continuaciones consecutivas; el editor VBA admite ${MAX_CONTINUATIONS}` });
    }
    if (!statements.some(({ text }) => /^option\s+explicit$/i.test(text))) {
      findings.push({ file, line: 1, message: "falta Option Explicit" });
    }
    // Un `.cls` sin su encabezado de clase se importa como modulo normal y `New` deja de compilar.
    if (file.endsWith(".cls") && !/^VERSION\s+[\d.]+\s+CLASS/m.test(source)) {
      findings.push({ file, line: 1, message: "falta el encabezado VERSION ... CLASS del modulo de clase" });
    }
    // VBA no admite un procedimiento con el mismo nombre que su modulo: el proyecto deja de
    // compilar con "Name conflicts with existing module". Es un fallo que solo aparece en Excel.
    const owner = /^\s*Attribute\s+VB_Name\s*=\s*"([^"]*)"/m.exec(source);
    if (owner) {
      const clash = statements.find(({ text }) =>
        new RegExp(
          `^(?:public\\s+|private\\s+|friend\\s+)?(?:static\\s+)?(?:sub|function)\\s+${owner[1]}\\b`,
          "i",
        ).test(text),
      );
      if (clash) {
        findings.push({
          file,
          line: clash.line,
          message: `declara un procedimiento llamado ${owner[1]}, igual que su modulo; VBA no lo admite`,
        });
      }
    }
    findings.push(...checkBlocks(statements, file));
    findings.push(...checkPlatformBoundary(statements, file));
    findings.push(...unusedLocals(statements, file));
  }

  const declared = new Set();
  for (const { statements, source } of modules.values()) {
    for (const name of declaredNames(statements, source)) declared.add(name);
  }
  for (const [file, { statements }] of modules) {
    for (const [name, line] of referencedNames(statements)) {
      if (!declared.has(name)) {
        findings.push({ file, line, message: `${name} no esta declarado en ningun modulo del cliente` });
      }
    }
  }

  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  if (findings.length) {
    for (const finding of findings) {
      process.stderr.write(`${VBA_DIR}/${finding.file}:${finding.line}: ${finding.message}\n`);
    }
    process.stderr.write(`\n${findings.length} hallazgos en ${files.length} modulos VBA\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`OK, ${files.length} modulos VBA sin hallazgos estaticos\n`);
}

await main();
