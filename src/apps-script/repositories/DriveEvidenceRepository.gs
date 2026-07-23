/** Almacenamiento Drive desacoplado; la hoja conserva solo metadatos, nunca binarios. */
var KcmDriveEvidenceRepository = (function () {
  "use strict";
  var ALLOWED_MIME = ["image/jpeg", "image/png", "application/pdf"];

  function bytesToHex(bytes) {
    return bytes.map(function (byte) { return ("0" + ((byte < 0 ? byte + 256 : byte).toString(16))).slice(-2); }).join("");
  }

  function sha256(bytes) {
    return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  }

  function actualMime(bytes) {
    var unsigned = bytes.slice(0, 8).map(function (value) { return value < 0 ? value + 256 : value; });
    if (unsigned[0] === 0xFF && unsigned[1] === 0xD8 && unsigned[2] === 0xFF) return "image/jpeg";
    if (unsigned.join(",") === "137,80,78,71,13,10,26,10") return "image/png";
    var prefix = String.fromCharCode.apply(null, unsigned.slice(0, 5));
    if (prefix === "%PDF-") return "application/pdf";
    KcmValidation.fail("INVALID_FILE", "El contenido del archivo no corresponde a un formato permitido");
  }

  function pdfPageCount(bytes) {
    var content = Utilities.newBlob(bytes).getDataAsString("ISO-8859-1");
    var pages = content.match(/\/Type\s*\/Page\b/g);
    return pages ? pages.length : 0;
  }

  function unsigned(bytes, index) { var value = bytes[index]; return value < 0 ? value + 256 : value; }

  function pngChunkType(bytes, offset) {
    return String.fromCharCode(unsigned(bytes, offset), unsigned(bytes, offset + 1), unsigned(bytes, offset + 2), unsigned(bytes, offset + 3));
  }

  function validatePngStructure(bytes) {
    if (!bytes || bytes.length < 58) KcmValidation.fail("INVALID_FILE", "El PNG esta truncado");
    var offset = 8;
    var first = true;
    var hasData = false;
    var ended = false;
    while (offset + 12 <= bytes.length) {
      var length = unsigned(bytes, offset) * 16777216 + unsigned(bytes, offset + 1) * 65536 + unsigned(bytes, offset + 2) * 256 + unsigned(bytes, offset + 3);
      if (!isFinite(length) || length < 0 || length > bytes.length - offset - 12) KcmValidation.fail("INVALID_FILE", "La estructura PNG es invalida");
      var type = pngChunkType(bytes, offset + 4);
      if (first && (type !== "IHDR" || length !== 13)) KcmValidation.fail("INVALID_FILE", "El encabezado PNG es invalido");
      if (type === "IDAT" && length > 0) hasData = true;
      offset += length + 12;
      if (type === "IEND") {
        if (length !== 0 || offset !== bytes.length) KcmValidation.fail("INVALID_FILE", "El cierre PNG es invalido");
        ended = true;
        break;
      }
      first = false;
    }
    if (!hasData || !ended) KcmValidation.fail("INVALID_FILE", "El PNG no contiene imagen completa");
  }

  function checkedDimensions(width, height) {
    if (!isFinite(width) || !isFinite(height) || Math.floor(width) !== width || Math.floor(height) !== height || width < 1 || height < 1) {
      KcmValidation.fail("INVALID_FILE", "No fue posible validar la resolucion de la imagen");
    }
    return { width: width, height: height };
  }

  function imageDimensions(bytes, mimeType) {
    if (mimeType === "image/png") {
      validatePngStructure(bytes);
      var width = unsigned(bytes, 16) * 16777216 + unsigned(bytes, 17) * 65536 + unsigned(bytes, 18) * 256 + unsigned(bytes, 19);
      var height = unsigned(bytes, 20) * 16777216 + unsigned(bytes, 21) * 65536 + unsigned(bytes, 22) * 256 + unsigned(bytes, 23);
      return checkedDimensions(width, height);
    }
    var offset = 2;
    while (offset + 9 < bytes.length) {
      if (unsigned(bytes, offset) !== 0xFF) { offset += 1; continue; }
      var marker = unsigned(bytes, offset + 1);
      var length = unsigned(bytes, offset + 2) * 256 + unsigned(bytes, offset + 3);
      if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].indexOf(marker) !== -1) {
        return checkedDimensions(
          unsigned(bytes, offset + 7) * 256 + unsigned(bytes, offset + 8),
          unsigned(bytes, offset + 5) * 256 + unsigned(bytes, offset + 6)
        );
      }
      if (length < 2) break;
      offset += 2 + length;
    }
    KcmValidation.fail("INVALID_FILE", "No fue posible validar la resolucion de la imagen");
  }

  function parseDataUrl(dataUrl, declaredMime) {
    var value = KcmValidation.text(dataUrl, "file", Math.ceil(KcmConfig.maxUploadBytes() * 1.5), true);
    var match = value.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=_-]+)$/i);
    if (!match || match[1].toLowerCase() !== declaredMime) KcmValidation.fail("INVALID_FILE", "Archivo o tipo declarado invalido");
    var bytes;
    try { bytes = Utilities.base64Decode(match[2]); } catch (error) { KcmValidation.fail("INVALID_FILE", "Archivo codificado incorrectamente"); }
    if (!bytes.length || bytes.length > KcmConfig.maxUploadBytes()) KcmValidation.fail("INVALID_FILE", "El archivo excede el limite permitido");
    var detectedMime = actualMime(bytes);
    if (ALLOWED_MIME.indexOf(detectedMime) === -1 || detectedMime !== declaredMime) KcmValidation.fail("INVALID_FILE", "El tipo real del archivo no coincide");
    var pageCount = detectedMime === "application/pdf" ? pdfPageCount(bytes) : 1;
    if (pageCount !== 1) KcmValidation.fail("INVALID_FILE", "Se requiere exactamente una pagina");
    if (detectedMime !== "application/pdf") {
      var dimensions = imageDimensions(bytes, detectedMime);
      var shortSide = Math.min(dimensions.width, dimensions.height);
      var longSide = Math.max(dimensions.width, dimensions.height);
      if (shortSide < KcmConfig.minImageShortSide() || longSide < KcmConfig.minImageLongSide()) KcmValidation.fail("INVALID_FILE", "La resolucion de la imagen es insuficiente");
    }
    return { bytes: bytes, mimeType: detectedMime, byteSize: bytes.length, pageCount: pageCount, sha256: sha256(bytes) };
  }

  function parseReviewCropDataUrl(dataUrl, declaredMime) {
    if (["image/png", "image/jpeg"].indexOf(String(declaredMime)) === -1) KcmValidation.fail("INVALID_FILE", "El recorte debe ser PNG o JPEG");
    var maximumBytes = KcmConfig.maxReviewCropBytes();
    if (!isFinite(maximumBytes) || maximumBytes < 1024 || maximumBytes > KcmConfig.maxUploadBytes()) KcmValidation.fail("INTERNAL_ERROR", "El limite de recorte no es valido");
    var value = KcmValidation.text(dataUrl, "cropData", Math.ceil(maximumBytes * 1.5) + 100, true);
    var match = value.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=_-]+)$/i);
    if (!match || match[1].toLowerCase() !== String(declaredMime)) KcmValidation.fail("INVALID_FILE", "El recorte o su tipo declarado es invalido");
    var bytes;
    try { bytes = Utilities.base64Decode(match[2]); } catch (error) { KcmValidation.fail("INVALID_FILE", "El recorte esta codificado incorrectamente"); }
    if (!bytes.length || bytes.length > maximumBytes) KcmValidation.fail("INVALID_FILE", "El recorte excede el limite permitido");
    var detectedMime = actualMime(bytes);
    if (detectedMime !== declaredMime) KcmValidation.fail("INVALID_FILE", "El tipo real del recorte no coincide");
    var dimensions = imageDimensions(bytes, detectedMime);
    var maximumDimension = KcmConfig.maxReviewCropDimension();
    if (!isFinite(maximumDimension) || maximumDimension < 64 || maximumDimension > 8192) KcmValidation.fail("INTERNAL_ERROR", "El limite de dimensiones no es valido");
    if (dimensions.width < 8 || dimensions.height < 8 || dimensions.width > maximumDimension || dimensions.height > maximumDimension) KcmValidation.fail("INVALID_FILE", "Las dimensiones del recorte no son validas");
    return { bytes: bytes, mimeType: detectedMime, byteSize: bytes.length, width: dimensions.width, height: dimensions.height, sha256: sha256(bytes) };
  }

  function stableId(prefix, value) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
    return String(prefix) + "-" + bytesToHex(digest).slice(0, 40);
  }

  function reviewCropFileName(parsed, metadata) {
    var extension = parsed.mimeType === "image/png" ? ".png" : ".jpg";
    return stableId("ocr-crop", [metadata.sessionId, metadata.documentId, metadata.candidateId, metadata.cropId, metadata.variant, parsed.sha256].join("|")) + extension;
  }

  function verifyStoredCrop(file, parsed) {
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    if (bytes.length !== parsed.byteSize || actualMime(bytes) !== parsed.mimeType || sha256(bytes) !== parsed.sha256) {
      KcmValidation.fail("CONFLICT", "Un recorte existente no coincide con su hash inmutable");
    }
  }

  function verifyStoredOriginal(file, parsed) {
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    if (bytes.length !== parsed.byteSize || actualMime(bytes) !== parsed.mimeType || sha256(bytes) !== parsed.sha256) {
      KcmValidation.fail("CONFLICT", "Una evidencia original existente no coincide con su hash inmutable");
    }
  }

  function saveReviewCrop(parsed, metadata) {
    var fileName = reviewCropFileName(parsed, metadata);
    if (KcmConfig.isMockMode()) return { driveFileId: stableId("mock-crop", fileName), reused: false, fileName: fileName };
    var folderId = KcmConfig.property("KCM_REVIEW_CROP_FOLDER_ID", KcmConfig.property("KCM_EVIDENCE_FOLDER_ID", ""));
    if (!folderId) KcmValidation.fail("INTERNAL_ERROR", "No se configuro la carpeta de recortes OCR");
    var folder = DriveApp.getFolderById(folderId);
    var existing = folder.getFilesByName(fileName);
    if (existing.hasNext()) {
      var storedFile = existing.next();
      verifyStoredCrop(storedFile, parsed);
      storedFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      return { driveFileId: storedFile.getId(), reused: true, fileName: fileName };
    }
    var blob = Utilities.newBlob(parsed.bytes, parsed.mimeType, fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    file.setDescription("KCM recorte OCR inmutable; sha256=" + parsed.sha256 + "; variant=" + metadata.variant);
    return { driveFileId: file.getId(), reused: false, fileName: fileName };
  }

  function saveOriginal(parsed, safeFileName) {
    if (KcmConfig.isMockMode()) {
      return { driveFileId: stableId("mock-original", safeFileName + "|" + parsed.sha256), reused: false, fileName: safeFileName };
    }
    var folderId = KcmConfig.property("KCM_EVIDENCE_FOLDER_ID", "");
    if (!folderId) KcmValidation.fail("INTERNAL_ERROR", "No se configuro la carpeta de evidencia");
    var folder = DriveApp.getFolderById(folderId);
    var existing = folder.getFilesByName(safeFileName);
    if (existing.hasNext()) {
      var storedFile = existing.next();
      if (existing.hasNext()) KcmValidation.fail("CONFLICT", "La evidencia original tiene mas de un archivo canonico");
      verifyStoredOriginal(storedFile, parsed);
      storedFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      return { driveFileId: storedFile.getId(), reused: true, fileName: safeFileName };
    }
    var blob = Utilities.newBlob(parsed.bytes, parsed.mimeType, safeFileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    file.setDescription("KCM evidencia original; sha256=" + parsed.sha256 + "; no editar");
    return { driveFileId: file.getId(), reused: false, fileName: safeFileName };
  }

  function previewDataUrl(driveFileId, expected) {
    if (KcmConfig.isMockMode()) return null;
    var file = DriveApp.getFileById(KcmValidation.identifier(driveFileId, "driveFileId"));
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    var isReviewCrop = expected && /^OCR_CROP(?:_|$)/.test(String(expected.kind || ""));
    var maximumBytes = isReviewCrop ? KcmConfig.maxReviewCropBytes() : KcmConfig.maxUploadBytes();
    if (!isFinite(maximumBytes) || maximumBytes < 1024 || maximumBytes > KcmConfig.maxUploadBytes()) {
      KcmValidation.fail("INTERNAL_ERROR", "El limite de vista previa no es valido");
    }
    if (bytes.length > maximumBytes) KcmValidation.fail("INVALID_FILE", "Vista previa demasiado grande");
    var mimeType = actualMime(bytes);
    if (ALLOWED_MIME.indexOf(mimeType) === -1) KcmValidation.fail("INVALID_FILE", "La evidencia no tiene un formato permitido");
    if (expected) {
      if (String(expected.mimeType) !== mimeType || String(expected.sha256) !== sha256(bytes)) {
        KcmValidation.fail("INVALID_FILE", "La evidencia ya no coincide con su registro inmutable");
      }
    }
    return "data:" + mimeType + ";base64," + Utilities.base64Encode(bytes);
  }

  function previewEvidence(evidence) {
    if (!evidence || !evidence.driveFileId || !evidence.sha256 || !evidence.mimeType) {
      KcmValidation.fail("NOT_FOUND", "La evidencia de revision no esta disponible");
    }
    return previewDataUrl(String(evidence.driveFileId), evidence);
  }

  function readOriginalBytes(evidence) {
    if (!evidence || String(evidence.kind) !== "LISTA_FISICA_ORIGINAL" ||
        !KcmServiceSupport.asBoolean(evidence.immutable) || !evidence.driveFileId ||
        !evidence.sha256 || !evidence.mimeType) {
      KcmValidation.fail("NOT_FOUND", "La evidencia OCR original no esta disponible");
    }
    if (KcmConfig.isMockMode()) KcmValidation.fail("INTERNAL_ERROR", "El worker OCR remoto no opera con evidencia simulada");
    var file = DriveApp.getFileById(KcmValidation.identifier(evidence.driveFileId, "driveFileId"));
    var bytes = file.getBlob().getBytes();
    if (!bytes.length || bytes.length > KcmConfig.maxUploadBytes()) KcmValidation.fail("INVALID_FILE", "La evidencia OCR original excede el limite permitido");
    var mimeType = actualMime(bytes);
    var digest = sha256(bytes);
    if (mimeType !== String(evidence.mimeType) || digest !== String(evidence.sha256).toLowerCase()) {
      KcmValidation.fail("INVALID_FILE", "La evidencia OCR original ya no coincide con su registro inmutable");
    }
    if (mimeType === "application/pdf" && pdfPageCount(bytes) !== 1) KcmValidation.fail("INVALID_FILE", "Se requiere exactamente una pagina");
    return { bytes: bytes, mimeType: mimeType, sha256: digest, byteSize: bytes.length };
  }

  return Object.freeze({
    parseDataUrl: parseDataUrl, parseReviewCropDataUrl: parseReviewCropDataUrl,
    saveOriginal: saveOriginal, saveReviewCrop: saveReviewCrop, stableId: stableId,
    previewDataUrl: previewDataUrl, previewEvidence: previewEvidence,
    readOriginalBytes: readOriginalBytes
  });
}());
