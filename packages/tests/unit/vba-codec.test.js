import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FUENTE = await readFile("clients/excel/vba/KcmCodec.bas", "utf8");

const B64_ESTANDAR = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_WEB = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const HEX = "0123456789abcdef";
const HEX_MAYUSCULA = "0123456789ABCDEF";

function bytesUtf16(texto) {
  const salida = new Uint8Array(texto.length * 2);
  for (let i = 0; i < texto.length; i += 1) {
    const unidad = texto.charCodeAt(i);
    salida[i * 2] = unidad & 0xff;
    salida[i * 2 + 1] = Math.floor(unidad / 256);
  }
  return salida;
}

function utf8Codificar(value) {
  if (value.length === 0) return new Uint8Array(0);
  const origen = bytesUtf16(value);
  const tope = origen.length - 1;
  const salida = new Uint8Array(value.length * 3);
  let indice = 0;
  let usados = 0;
  while (indice < tope) {
    let punto = origen[indice + 1] * 256 + origen[indice];
    indice += 2;
    if (punto >= 0xd800 && punto <= 0xdbff && indice < tope) {
      const siguiente = origen[indice + 1] * 256 + origen[indice];
      if (siguiente >= 0xdc00 && siguiente <= 0xdfff) {
        punto = 0x10000 + (punto - 0xd800) * 0x400 + (siguiente - 0xdc00);
        indice += 2;
      }
    }
    if (punto < 0x80) {
      salida[usados] = punto;
      usados += 1;
    } else if (punto < 0x800) {
      salida[usados] = 0xc0 | Math.floor(punto / 0x40);
      salida[usados + 1] = 0x80 | (punto & 0x3f);
      usados += 2;
    } else if (punto < 0x10000) {
      salida[usados] = 0xe0 | Math.floor(punto / 0x1000);
      salida[usados + 1] = 0x80 | (Math.floor(punto / 0x40) & 0x3f);
      salida[usados + 2] = 0x80 | (punto & 0x3f);
      usados += 3;
    } else {
      salida[usados] = 0xf0 | Math.floor(punto / 0x40000);
      salida[usados + 1] = 0x80 | (Math.floor(punto / 0x1000) & 0x3f);
      salida[usados + 2] = 0x80 | (Math.floor(punto / 0x40) & 0x3f);
      salida[usados + 3] = 0x80 | (punto & 0x3f);
      usados += 4;
    }
  }
  return salida.subarray(0, usados);
}

function utf8Texto(bytes, usados = bytes.length) {
  if (usados <= 0) return "";
  const destino = new Uint8Array(usados * 2);
  let indice = 0;
  let escritos = 0;
  while (indice < usados) {
    const primero = bytes[indice];
    let punto;
    if (primero < 0x80) {
      punto = primero;
      indice += 1;
    } else if ((primero & 0xe0) === 0xc0 && indice + 1 < usados) {
      punto = ((primero & 0x1f) * 0x40) | (bytes[indice + 1] & 0x3f);
      indice += 2;
    } else if ((primero & 0xf0) === 0xe0 && indice + 2 < usados) {
      punto =
        ((primero & 0xf) * 0x1000) |
        ((bytes[indice + 1] & 0x3f) * 0x40) |
        (bytes[indice + 2] & 0x3f);
      indice += 3;
    } else if ((primero & 0xf8) === 0xf0 && indice + 3 < usados) {
      punto =
        ((primero & 0x7) * 0x40000) |
        ((bytes[indice + 1] & 0x3f) * 0x1000) |
        ((bytes[indice + 2] & 0x3f) * 0x40) |
        (bytes[indice + 3] & 0x3f);
      indice += 4;
    } else {
      punto = 0xfffd;
      indice += 1;
    }
    if (punto >= 0x10000) {
      punto -= 0x10000;
      const alto = 0xd800 | Math.floor(punto / 0x400);
      destino[escritos] = alto & 0xff;
      destino[escritos + 1] = Math.floor(alto / 0x100);
      const bajo = 0xdc00 | (punto & 0x3ff);
      destino[escritos + 2] = bajo & 0xff;
      destino[escritos + 3] = Math.floor(bajo / 0x100);
      escritos += 4;
    } else {
      destino[escritos] = punto & 0xff;
      destino[escritos + 1] = Math.floor(punto / 0x100);
      escritos += 2;
    }
  }
  let texto = "";
  for (let i = 0; i < escritos; i += 2) {
    texto += String.fromCharCode(destino[i] + destino[i + 1] * 256);
  }
  return texto;
}

function base64Con(bytes, usados, alfabeto, conRelleno) {
  if (usados <= 0) return "";
  const grupos = Math.floor(usados / 3);
  const sobrantes = usados - grupos * 3;
  let caracteres = grupos * 4;
  if (sobrantes > 0) caracteres += conRelleno ? 4 : sobrantes + 1;
  const destino = new Array(caracteres);
  let d = 0;
  for (let indice = 0; indice < grupos; indice += 1) {
    const origen = indice * 3;
    const valor = bytes[origen] * 0x10000 + bytes[origen + 1] * 0x100 + bytes[origen + 2];
    destino[d] = alfabeto[Math.floor(valor / 0x40000) & 0x3f];
    destino[d + 1] = alfabeto[Math.floor(valor / 0x1000) & 0x3f];
    destino[d + 2] = alfabeto[Math.floor(valor / 0x40) & 0x3f];
    destino[d + 3] = alfabeto[valor & 0x3f];
    d += 4;
  }
  if (sobrantes === 1) {
    const valor = bytes[grupos * 3] * 0x10000;
    destino[d] = alfabeto[Math.floor(valor / 0x40000) & 0x3f];
    destino[d + 1] = alfabeto[Math.floor(valor / 0x1000) & 0x3f];
    d += 2;
    if (conRelleno) {
      destino[d] = "=";
      destino[d + 1] = "=";
      d += 2;
    }
  } else if (sobrantes === 2) {
    const valor = bytes[grupos * 3] * 0x10000 + bytes[grupos * 3 + 1] * 0x100;
    destino[d] = alfabeto[Math.floor(valor / 0x40000) & 0x3f];
    destino[d + 1] = alfabeto[Math.floor(valor / 0x1000) & 0x3f];
    destino[d + 2] = alfabeto[Math.floor(valor / 0x40) & 0x3f];
    d += 3;
    if (conRelleno) {
      destino[d] = "=";
      d += 1;
    }
  }
  assert.equal(d, caracteres, "el búfer de base64 se llena exactamente");
  return destino.join("");
}

function base64WebDecode(value) {
  if (value.length === 0) return "";
  const inversa = new Uint8Array(256).fill(255);
  for (let i = 0; i < 64; i += 1) inversa[B64_ESTANDAR.charCodeAt(i)] = i;
  for (let i = 0; i < 64; i += 1) inversa[B64_WEB.charCodeAt(i)] = i;
  const salida = new Uint8Array((Math.floor(value.length / 4) + 1) * 3 + 1);
  let valor = 0;
  let acumulados = 0;
  let usados = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unidad = value.charCodeAt(i);
    if (unidad > 255) continue;
    const codigo = inversa[unidad];
    if (codigo >= 64) continue;
    valor = valor * 64 + codigo;
    acumulados += 1;
    if (acumulados === 4) {
      salida[usados] = Math.floor(valor / 0x10000) & 0xff;
      salida[usados + 1] = Math.floor(valor / 0x100) & 0xff;
      salida[usados + 2] = valor & 0xff;
      usados += 3;
      valor = 0;
      acumulados = 0;
    }
  }
  if (acumulados === 2) {
    valor *= 4096;
    salida[usados] = Math.floor(valor / 0x10000) & 0xff;
    usados += 1;
  } else if (acumulados === 3) {
    valor *= 64;
    salida[usados] = Math.floor(valor / 0x10000) & 0xff;
    salida[usados + 1] = Math.floor(valor / 0x100) & 0xff;
    usados += 2;
  }
  return utf8Texto(salida, usados);
}

function urlEncode(value) {
  if (value.length === 0) return "";
  const bytes = utf8Codificar(value);
  if (bytes.length === 0) return "";
  let salida = "";
  for (const byteValue of bytes) {
    const esNoReservado =
      (byteValue >= 65 && byteValue <= 90) ||
      (byteValue >= 97 && byteValue <= 122) ||
      (byteValue >= 48 && byteValue <= 57) ||
      byteValue === 45 ||
      byteValue === 46 ||
      byteValue === 95 ||
      byteValue === 126;
    salida += esNoReservado
      ? String.fromCharCode(byteValue)
      : "%" + HEX_MAYUSCULA[Math.floor(byteValue / 16)] + HEX_MAYUSCULA[byteValue & 15];
  }
  return salida;
}

function urlDecode(value) {
  if (value.length === 0) return "";
  const valorHex = (codigo) => {
    if (codigo >= 48 && codigo <= 57) return codigo - 48;
    if (codigo >= 65 && codigo <= 70) return codigo - 55;
    if (codigo >= 97 && codigo <= 102) return codigo - 87;
    return -1;
  };
  const salida = new Uint8Array(value.length * 3);
  let indice = 0;
  let usados = 0;
  while (indice < value.length) {
    const punto = value.charCodeAt(indice);
    if (punto === 37) {
      if (indice + 2 >= value.length) throw new Error("Texto URL invalido");
      const alto = valorHex(value.charCodeAt(indice + 1));
      const bajo = valorHex(value.charCodeAt(indice + 2));
      if (alto < 0 || bajo < 0) throw new Error("Texto URL invalido");
      salida[usados] = alto * 16 + bajo;
      usados += 1;
      indice += 3;
    } else if (punto === 43) {
      salida[usados] = 32;
      usados += 1;
      indice += 1;
    } else if (punto < 0x80) {
      salida[usados] = punto;
      usados += 1;
      indice += 1;
    } else {
      const trozo = utf8Codificar(value[indice]);
      salida.set(trozo, usados);
      usados += trozo.length;
      indice += 1;
    }
  }
  return utf8Texto(salida, usados);
}

function claveCodificada(clave) {
  if (clave.length === 0) return "-";
  const origen = bytesUtf16(clave);
  let salida = "";
  for (let indice = 0; indice < clave.length; indice += 1) {
    const alto = origen[indice * 2 + 1];
    const bajo = origen[indice * 2];
    salida +=
      HEX[Math.floor(alto / 16)] + HEX[alto & 15] + HEX[Math.floor(bajo / 16)] + HEX[bajo & 15];
  }
  return salida;
}

const CASOS = [
  "",
  "a",
  "ab",
  "abc",
  "Hola",
  "MUÑOZ",
  "JOSÉ MARÍA ÁLVAREZ-OÑATE",
  "línea 1\nlínea 2\tcon tabulador",
  "ção € 100",
  "emoji 🚀 al final",
  "🚀🌎",
  " ",
  '{"schemaVersion":"HC_SNAPSHOT_V1","employees":[{"displayName":"PÉREZ Ñ"}]}',
  "a".repeat(1000) + "Ñ" + "b".repeat(1000),
];

function aleatorio(semilla) {
  let estado = semilla;
  return () => {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff;
    return estado / 0x7fffffff;
  };
}

function casosAleatorios(cuantos) {
  const siguiente = aleatorio(20260819);
  const salida = [];
  for (let n = 0; n < cuantos; n += 1) {
    const largo = Math.floor(siguiente() * 40);
    let texto = "";
    for (let i = 0; i < largo; i += 1) {
      const dado = siguiente();
      if (dado < 0.5) texto += String.fromCharCode(32 + Math.floor(siguiente() * 95));
      else if (dado < 0.75) texto += String.fromCharCode(160 + Math.floor(siguiente() * 1000));
      else if (dado < 0.9) texto += String.fromCharCode(0x3000 + Math.floor(siguiente() * 2000));
      else texto += String.fromCodePoint(0x10000 + Math.floor(siguiente() * 0xffff));
    }
    salida.push(texto);
  }
  return salida;
}

const TODOS = [...CASOS, ...casosAleatorios(400)];

test("la conversión a UTF-8 coincide con la de Node en todos los casos", () => {
  for (const texto of TODOS) {
    const propio = Buffer.from(utf8Codificar(texto));
    const referencia = Buffer.from(texto, "utf8");
    assert.deepEqual(propio, referencia, `UTF-8 de ${JSON.stringify(texto).slice(0, 60)}`);
  }
});

test("la vuelta desde UTF-8 reconstruye la cadena original", () => {
  for (const texto of TODOS) {
    assert.equal(utf8Texto(Buffer.from(texto, "utf8")), texto);
    assert.equal(utf8Texto(utf8Codificar(texto)), texto);
  }
});

test("el base64 estándar con relleno coincide con el de Node", () => {
  for (const texto of TODOS) {
    const bytes = Buffer.from(texto, "utf8");
    if (bytes.length === 0) continue;
    assert.equal(base64Con(bytes, bytes.length, B64_ESTANDAR, true), bytes.toString("base64"));
  }
});

test("el base64 web-safe sin relleno coincide con base64url de Node", () => {
  for (const texto of TODOS) {
    const bytes = Buffer.from(texto, "utf8");
    if (bytes.length === 0) continue;
    assert.equal(base64Con(bytes, bytes.length, B64_WEB, false), bytes.toString("base64url"));
  }
});

test("los tres restos posibles del último grupo base64 se escriben completos", () => {
  for (let largo = 1; largo <= 130; largo += 1) {
    const bytes = Buffer.from(Array.from({ length: largo }, (_, i) => (i * 37 + 11) % 256));
    assert.equal(
      base64Con(bytes, largo, B64_ESTANDAR, true),
      bytes.toString("base64"),
      `largo ${largo}`,
    );
    assert.equal(
      base64Con(bytes, largo, B64_WEB, false),
      bytes.toString("base64url"),
      `largo ${largo}`,
    );
  }
});

test("el decodificador acepta los dos alfabetos, con relleno y sin él", () => {
  for (const texto of TODOS) {
    const bytes = Buffer.from(texto, "utf8");
    if (bytes.length === 0) continue;
    assert.equal(base64WebDecode(bytes.toString("base64url")), texto, "web-safe sin relleno");
    assert.equal(base64WebDecode(bytes.toString("base64")), texto, "estándar con relleno");
    assert.equal(base64WebDecode(bytes.toString("base64").replace(/(.{8})/g, "$1\r\n")), texto);
  }
});

test("la codificación porcentual coincide con RFC 3986", () => {
  const referencia = (texto) =>
    encodeURIComponent(texto).replace(
      /[!'()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  for (const texto of TODOS) {
    assert.equal(urlEncode(texto), referencia(texto), `URL de ${JSON.stringify(texto).slice(0, 60)}`);
  }
});

test("la decodificación porcentual devuelve el original y entiende lo que manda el servidor", () => {
  for (const texto of TODOS) {
    assert.equal(urlDecode(urlEncode(texto)), texto);
    assert.equal(urlDecode(encodeURIComponent(texto)), texto);
  }
  assert.equal(urlDecode("a+b"), "a b", "el signo más es un espacio en un cuerpo de formulario");
  assert.equal(urlDecode("%c3%91"), "Ñ", "los dígitos hexadecimales en minúsculas también valen");
  assert.throws(() => urlDecode("%zz"), /Texto URL invalido/);
  assert.throws(() => urlDecode("abc%4"), /Texto URL invalido/);
});

test("la clave del diccionario distingue mayúsculas pese a que Collection no lo haga", () => {
  const vistas = new Map();
  for (const texto of TODOS) {
    const codificada = claveCodificada(texto);
    const plegada = codificada.toUpperCase();
    if (vistas.has(plegada)) {
      assert.equal(vistas.get(plegada), texto, `dos claves distintas colisionan: ${plegada}`);
    }
    vistas.set(plegada, texto);
    assert.match(codificada, /^(?:[0-9a-f]+|-)$/, "la clave codificada es hexadecimal o el guion");
  }
  assert.notEqual(claveCodificada("hc"), claveCodificada("HC"));
  assert.notEqual(claveCodificada("hc").toUpperCase(), claveCodificada("HC").toUpperCase());
  assert.equal(claveCodificada(""), "-", "Collection rechaza la cadena vacía como clave");
});

test("la transcripción sigue reflejando las constantes del módulo VBA", () => {
  assert.ok(FUENTE.includes(`"${B64_ESTANDAR}"`), "alfabeto base64 estándar");
  assert.ok(FUENTE.includes(`"${B64_WEB}"`), "alfabeto base64 web-safe");
  assert.ok(FUENTE.includes(`KCM_HEX As String = "${HEX}"`), "hexadecimal en minúsculas");
  assert.ok(
    FUENTE.includes(`KCM_HEX_MAYUSCULA As String = "${HEX_MAYUSCULA}"`),
    "hexadecimal en mayúsculas",
  );
  assert.match(FUENTE, /ReDim salida\(0 To \(Len\(value\) \* 3\) - 1\)/, "cota del búfer UTF-8");
  assert.match(FUENTE, /ReDim destino\(0 To \(usados \* 2\) - 1\)/, "cota del búfer UTF-16");
  assert.match(FUENTE, /ReDim destino\(0 To \(usados \* 6\) - 1\)/, "cota del búfer de URL");
});
