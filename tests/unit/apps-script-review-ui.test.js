import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const INDEX = new URL("../../src/apps-script/web/Index.html", import.meta.url);

async function source() {
  return readFile(INDEX, "utf8");
}

test("la revision OCR tiene lista accesible, detalle y navegacion de pendientes", async () => {
  const html = await source();
  assert.match(html, /id="review-candidate-list"[^>]*class="review-candidate-list"/);
  assert.match(html, /aria-labelledby="review-list-title"/);
  assert.match(html, /id="previous-pending"[^>]*>Anterior pendiente</);
  assert.match(html, /id="next-pending"[^>]*>Siguiente pendiente</);
  assert.match(html, /state\.reviewCandidates=received\.slice\(0,40\)/);
  assert.match(html, /button\.setAttribute\("aria-current"/);
  assert.doesNotMatch(html, /id="confirm-candidate"|id="ocr-correction"|Recorte 5 casillas/);
});

test("exige cinco digitos, motivo y evidencia completa antes de confirmar", async () => {
  const html = await source();
  assert.match(html, /id="review-correction"[^>]*pattern="\[0-9\]\{5\}"[^>]*minlength="5"[^>]*maxlength="5"[^>]*required/);
  assert.match(html, /id="review-reason"[^>]*maxlength="300"[^>]*required/);
  assert.match(html, /if\(!\/\^\\d\{5\}\$\/\.test\(corrected\)\)/);
  assert.match(html, /if\(!reason\)/);
  assert.match(html, /if\(!state\.reviewEvidenceReady\)/);
  assert.match(html, /correctedValue:corrected,reason:reason/);
});

test("crea cinco pares original-procesado con confianza por casilla", async () => {
  const html = await source();
  assert.match(html, /for\(var digitIndex=0;digitIndex<5;digitIndex\+=1\)/);
  assert.match(html, /Original sin umbralizar/);
  assert.match(html, /Procesada para OCR/);
  assert.match(html, /confidenceLabel\(confidences\[digitIndex\]\)/);
  assert.match(html, /image\.loading="lazy"/);
  assert.match(html, /evidenceIsComplete\(crops\).*crops\.length===5/);
});

test("carga candidatos y evidencia diferida por contratos explicitos", async () => {
  const html = await source();
  assert.match(html, /call\("listOcrCandidates",\{documentId:state\.document\.documentId\}\)/);
  assert.match(html, /call\("reviewEvidence",\{documentId:/);
  assert.match(html, /candidate\.originalCropUrls/);
  assert.match(html, /candidate\.processedCropUrls/);
  assert.match(html, /state\.reviewEvidenceRequest/);
  assert.match(html, /document-local-raster-v1/);
});

test("usa el envelope HTTP local solicitado y conserva fallback sintetico", async () => {
  const html = await source();
  assert.match(html, /fetch\(window\.KCM_LOCAL_API_BASE,\{method:"POST",headers:\{"Content-Type":"application\/json"\},body:JSON\.stringify\(\{action:action,payload:payload\}\)\}\)/);
  assert.match(html, /\["listOcrCandidates","reviewEvidence","reviewOcrCandidate"\]/);
  assert.match(html, /candidate-demo-01/);
  assert.match(html, /canvas\.toDataURL\("image\/png"\)/);
  assert.match(html, /example\.invalid/);
});

test("la UI no inserta datos como HTML y su script conserva sintaxis valida", async () => {
  const html = await source();
  assert.doesNotMatch(html, /\.innerHTML\s*=/);
  assert.match(html, /safeImageUrl/);
  assert.match(html, /\.textContent=/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: "Index.review.inline.js" }));
});

test("las imagenes remotas se limitan a datos raster, mismo origen relativo o loopback", async () => {
  const html = await source();
  const safeBlock = html.match(/function safeImageUrl\(value\)\{([\s\S]*?)\n      \}\n      function evidenceItems/);
  assert.ok(safeBlock, "debe existir safeImageUrl");
  assert.match(safeBlock[1], /data:image\\\/\(png\|jpe\?g\|webp\);base64/);
  assert.match(safeBlock[1], /localhost\|127\\\.0\\\.0\\\.1\|\\\[::1\\\]/);
  assert.match(safeBlock[1], /anchor\.protocol===window\.location\.protocol&&anchor\.host===window\.location\.host/);
  assert.doesNotMatch(safeBlock[1], /\^https:\\\/\\\//, "no debe aceptar cualquier origen HTTPS");
  assert.match(safeBlock[1], /!\/\^\\\/\\\//, "debe bloquear URLs relativas de protocolo");
});

test("habilita confirmar solamente despues de load real de las diez imagenes", async () => {
  const html = await source();
  assert.match(html, /image\.addEventListener\("load"/);
  assert.match(html, /image\.addEventListener\("error"/);
  assert.match(html, /if\(completed===10&&failed===0\)\{state\.reviewEvidenceReady=true;/);
  assert.match(html, /failed\+" de 10 imágenes fallaron\. Confirmación bloqueada\."/);
  assert.doesNotMatch(html, /reviewEvidenceReady=evidenceIsComplete/);
  assert.match(html, /reviewEvidenceReady=false;\$\("confirm-review-candidate"\)\.disabled=true/);
});

test("ignora eventos load y error de un candidato anterior", async () => {
  const html = await source();
  const applyBlock = html.match(/function applyReviewEvidence\([\s\S]*?\n      \}\n      function loadReviewEvidence/);
  assert.ok(applyBlock, "debe existir applyReviewEvidence");
  const raceGuard = /requestNumber!==state\.reviewEvidenceRequest\|\|candidate!==currentCandidate\(\)/g;
  assert.ok((applyBlock[0].match(raceGuard) || []).length >= 2, "debe validar la solicitud antes de renderizar y en cada evento de imagen");
});

test("permite confirmar explicitamente un renglon vacio sin inventar identidad", async () => {
  const html = await source();
  assert.match(html, /id="confirm-empty-ocr-row"[^>]*disabled/);
  assert.match(html, /\$\("confirm-empty-ocr-row"\)\.disabled=false/);
  assert.match(html, /if\(!reason\)\{notify\("El motivo es obligatorio"\)/);
  assert.match(html, /if\(!state\.reviewEvidenceReady\)\{notify\("Espere a que carguen las diez imágenes de comparación"\)/);
  assert.match(html, /call\("confirmEmptyOcrRow",\{candidateId:candidate\.candidateId,reason:reason\}\)/);
  assert.match(html, /decision:"CONFIRMADO_VACIO"/);
  assert.doesNotMatch(html, /confirmEmptyOcrRow",\{[^}]*employeeId/);
  assert.doesNotMatch(html, /confirmEmptyOcrRow",\{[^}]*correctedValue/);
});

test("el worker real depende de rol y modo GOOGLE y conserva requestId al reintentar", async () => {
  const html = await source();
  assert.match(html, /id="process-remote-ocr"[^>]*hidden disabled/);
  assert.match(html, /function canManageOcr\(\)\{return state\.role==="CAPACITACION"\|\|state\.role==="ADMINISTRADOR"\}/);
  assert.match(html, /var realMode=state\.mode==="GOOGLE";var mockMode=state\.mode==="MOCK"/);
  assert.match(html, /state\.remoteOcrRequestId=state\.remoteOcrRequestId\|\|uid\("remote-ocr"\)/);
  assert.match(html, /processRemoteOcrDocument",\{documentId:state\.document\.documentId,requestId:state\.remoteOcrRequestId\}/);
  assert.match(html, /data\.status==="REVISION_OCR"&&!data\.retryRequired/);
  assert.match(html, /Reintentar OCR y completar evidencia/);
  assert.match(html, /if\(state\.mode==="MOCK"&&state\.document\)run\("beginOcrProcessing"/);
  assert.match(html, /if\(state\.mode==="MOCK"&&state\.document\)run\("ingestOcrCandidates"/);
});
