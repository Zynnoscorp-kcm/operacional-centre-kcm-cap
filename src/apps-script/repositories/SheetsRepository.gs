function KcmWithRepositoryWriteLock(callback) {
  var lock;
  if (typeof KcmScriptLock !== "undefined") {
    lock = KcmScriptLock.acquire(30000, "El almacen esta ocupado; reintente la operacion");
  } else {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      var busy = new Error("El almacen esta ocupado; reintente la operacion");
      busy.code = "CONFLICT"; busy.retryable = true; throw busy;
    }
  }
  try { return callback(); }
  finally { lock.releaseLock(); }
}

var KcmSheetsRepository = (function () {
  "use strict";

  function openSpreadsheet() {
    var spreadsheetId = KcmConfig.property("KCM_DATA_SPREADSHEET_ID", "");
    if (!spreadsheetId) KcmValidation.fail("INTERNAL_ERROR", "No se configuro el almacen de datos");
    return SpreadsheetApp.openById(spreadsheetId);
  }

  function sheetOrFail(name) {
    var sheet = openSpreadsheet().getSheetByName(name);
    if (!sheet) KcmValidation.fail("INTERNAL_ERROR", "Falta una tabla requerida");
    return sheet;
  }

  function expectedHeaders(name) {
    var headers = KcmConfig.HEADERS[name];
    if (!headers) KcmValidation.fail("INTERNAL_ERROR", "Tabla no reconocida");
    return headers;
  }

  function readTable(name) {
    var sheet = sheetOrFail(name);
    var values = sheet.getDataRange().getValues();
    if (!values.length || values[0].length === 0) return { sheet: sheet, headers: expectedHeaders(name), rows: [] };
    var headers = values[0].map(String);
    expectedHeaders(name).forEach(function (header) {
      if (headers.indexOf(header) === -1) KcmValidation.fail("INTERNAL_ERROR", "El esquema de datos no coincide con la version esperada");
    });
    var rows = values.slice(1).map(function (row, index) {
      var object = { __rowNumber: index + 2 };
      headers.forEach(function (header, column) { object[header] = row[column]; });
      return object;
    }).filter(function (row) {
      return headers.some(function (header) {
        return row[header] !== "" && row[header] !== null && row[header] !== undefined;
      });
    });
    return { sheet: sheet, headers: headers, rows: rows };
  }

  function toRow(headers, object) {
    return headers.map(function (header) {
      var value = object[header];
      if (value === undefined || value === null) return "";
      return KcmValidation.forSheet(value);
    });
  }

  function formatTextColumns(sheet, headers, startRow, count) {
    if (!count) return;
    ["employeeId", "rawDigits", "normalizedEmployeeId", "correctedValue", "originalValue"].forEach(function (name) {
      var index = headers.indexOf(name);
      if (index !== -1) sheet.getRange(startRow, index + 1, count, 1).setNumberFormat("@");
    });
  }

  function cellValue(value) {
    if (value === undefined || value === null) return "";
    return KcmValidation.forSheet(value);
  }

  function rangeContainsContent(range) {
    var values = range.getValues();
    if (values.some(function (row) { return row.some(function (value) { return value !== ""; }); })) return true;
    if (typeof range.getFormulas !== "function") return false;
    return range.getFormulas().some(function (row) {
      return row.some(function (formula) { return formula !== ""; });
    });
  }

  function insertMany(name, objects) {
    if (!objects.length) return [];
    return KcmWithRepositoryWriteLock(function () {
      var table = readTable(name);
      var lastRow = table.sheet.getLastRow();
      var startRow = Math.max(lastRow + 1, 2);
      var values = objects.map(function (object) { return toRow(table.headers, object); });
      var target = table.sheet.getRange(startRow, 1, values.length, table.headers.length);
      if (table.sheet.getLastRow() !== lastRow || rangeContainsContent(target)) {
        KcmValidation.fail("CONFLICT", "La tabla cambio durante la insercion; reintente la operacion");
      }
      formatTextColumns(table.sheet, table.headers, startRow, values.length);
      target.setValues(values);
      return objects;
    });
  }

  function updateMany(name, keyField, updates) {
    if (!updates.length) return [];
    var table = readTable(name);
    if (table.headers.indexOf(keyField) === -1) KcmValidation.fail("INTERNAL_ERROR", "La clave de la tabla no existe");

    var updateKeys = Object.create(null);
    updates.forEach(function (update) {
      var key = update && update[keyField];
      if (key === undefined || key === null || String(key) === "") {
        KcmValidation.fail("INVALID_INPUT", "Una actualizacion no contiene su clave");
      }
      var normalized = String(key);
      if (Object.prototype.hasOwnProperty.call(updateKeys, normalized)) {
        KcmValidation.fail("DUPLICATE", "La actualizacion contiene claves duplicadas");
      }
      updateKeys[normalized] = true;
    });

    var rowsByKey = Object.create(null);
    table.rows.forEach(function (row) {
      var value = row[keyField];
      if (value === undefined || value === null || String(value) === "") {
        KcmValidation.fail("CONFLICT", "La tabla contiene una fila sin clave");
      }
      var normalized = String(value);
      if (Object.prototype.hasOwnProperty.call(rowsByKey, normalized)) {
        KcmValidation.fail("CONFLICT", "La tabla contiene claves duplicadas");
      }
      rowsByKey[normalized] = row;
    });

    var textColumns = {
      employeeId: true, rawDigits: true, normalizedEmployeeId: true,
      correctedValue: true, originalValue: true
    };
    var writes = [];
    var changed = [];
    updates.forEach(function (patch) {
      var normalized = String(patch[keyField]);
      var row = rowsByKey[normalized];
      if (!row) KcmValidation.fail("NOT_FOUND", "Uno o mas registros no existen");
      var updated = Object.assign({}, row);
      var cells = [];
      Object.keys(patch).forEach(function (field) {
        if (field === "__rowNumber" || field === keyField) return;
        var column = table.headers.indexOf(field);
        if (column === -1) return;
        updated[field] = patch[field];
        cells.push({
          column: column + 1,
          value: cellValue(patch[field]),
          text: Boolean(textColumns[field])
        });
      });
      cells.sort(function (left, right) { return left.column - right.column; });
      var groups = [];
      cells.forEach(function (cell) {
        var current = groups.length ? groups[groups.length - 1] : null;
        if (!current || current.text !== cell.text || current.startColumn + current.values.length !== cell.column) {
          current = { rowNumber: row.__rowNumber, startColumn: cell.column, text: cell.text, values: [] };
          groups.push(current);
        }
        current.values.push(cell.value);
      });
      writes = writes.concat(groups);
      changed.push(updated);
    });

    writes.forEach(function (write) {
      var range = table.sheet.getRange(write.rowNumber, write.startColumn, 1, write.values.length);
      if (write.text) range.setNumberFormat("@");
      range.setValues([write.values]);
    });
    return changed;
  }

  function replaceOne(name, keyField, replacement) {
    if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) {
      KcmValidation.fail("INVALID_INPUT", "El reemplazo de fila no es valido");
    }
    return KcmWithRepositoryWriteLock(function () {
      var table = readTable(name);
      var keyColumn = table.headers.indexOf(keyField);
      if (keyColumn === -1) KcmValidation.fail("INTERNAL_ERROR", "La clave de la tabla no existe");
      var key = replacement[keyField];
      if (key === undefined || key === null || String(key) === "") {
        KcmValidation.fail("INVALID_INPUT", "El reemplazo de fila no contiene su clave");
      }
      var matches = table.rows.filter(function (row) { return String(row[keyField]) === String(key); });
      if (!matches.length) KcmValidation.fail("NOT_FOUND", "El registro no existe");
      if (matches.length !== 1) KcmValidation.fail("CONFLICT", "La tabla contiene claves duplicadas");
      var current = matches[0];
      var intended = Object.assign({}, current, replacement);
      if (String(intended[keyField]) !== String(key)) KcmValidation.fail("CONFLICT", "La clave del registro cambio");
      var observedKey = table.sheet.getRange(current.__rowNumber, keyColumn + 1, 1, 1).getDisplayValue();
      if (String(observedKey) !== String(key)) {
        KcmValidation.fail("CONFLICT", "La tabla cambio durante el reemplazo; reintente la operacion");
      }
      formatTextColumns(table.sheet, table.headers, current.__rowNumber, 1);
      table.sheet.getRange(current.__rowNumber, 1, 1, table.headers.length).setValues([
        toRow(table.headers, intended)
      ]);
      delete intended.__rowNumber;
      return intended;
    });
  }

  function list(name, predicate) {
    var rows = readTable(name).rows;
    return predicate ? rows.filter(predicate) : rows;
  }

  function findOne(name, predicate) {
    var matches = list(name, predicate);
    return matches.length ? matches[0] : null;
  }

  function ensureSchema() {
    var spreadsheet = openSpreadsheet();
    Object.keys(KcmConfig.HEADERS).forEach(function (name) {
      var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
      var headers = KcmConfig.HEADERS[name];
      var current = sheet.getLastRow() ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0] : [];
      if (!current.some(String)) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        return;
      }
      var existing = current.map(String).filter(Boolean);
      var missing = headers.filter(function (header) { return existing.indexOf(header) === -1; });
      if (missing.length) sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
    });
  }

  return Object.freeze({
    insertMany: insertMany, updateMany: updateMany, replaceOne: replaceOne, list: list,
    findOne: findOne, ensureSchema: ensureSchema
  });
}());

var KcmMockRepository = (function () {
  "use strict";
  var PREFIX = "KCM_MOCK_TABLE_";

  function read(name) {
    var properties = PropertiesService.getScriptProperties();
    var chunkCount = Number(properties.getProperty(PREFIX + name + "_COUNT") || "0");
    if (chunkCount > 0) {
      var chunks = [];
      for (var index = 0; index < chunkCount; index += 1) chunks.push(properties.getProperty(PREFIX + name + "_" + index) || "");
      return JSON.parse(chunks.join(""));
    }
    var value = properties.getProperty(PREFIX + name);
    return value ? JSON.parse(value) : [];
  }

  function write(name, rows) {
    var properties = PropertiesService.getScriptProperties();
    var serialized = JSON.stringify(rows);
    var chunkSize = 7000;
    var chunks = [];
    for (var offset = 0; offset < serialized.length; offset += chunkSize) chunks.push(serialized.slice(offset, offset + chunkSize));
    if (!chunks.length) chunks.push("[]");
    var previousCount = Number(properties.getProperty(PREFIX + name + "_COUNT") || "0");
    var updates = {};
    updates[PREFIX + name + "_COUNT"] = String(chunks.length);
    chunks.forEach(function (chunk, index) { updates[PREFIX + name + "_" + index] = chunk; });
    properties.setProperties(updates, false);
    for (var stale = chunks.length; stale < previousCount; stale += 1) properties.deleteProperty(PREFIX + name + "_" + stale);
    properties.deleteProperty(PREFIX + name);
  }

  function insertMany(name, objects) {
    return KcmWithRepositoryWriteLock(function () {
      var rows = read(name).concat(objects);
      write(name, rows);
      return objects;
    });
  }

  function updateMany(name, keyField, updates) {
    var rows = read(name);
    var changed = [];
    updates.forEach(function (update) {
      var index = rows.findIndex(function (row) { return String(row[keyField]) === String(update[keyField]); });
      if (index === -1) KcmValidation.fail("NOT_FOUND", "Uno o mas registros no existen");
      rows[index] = Object.assign({}, rows[index], update);
      changed.push(rows[index]);
    });
    write(name, rows);
    return changed;
  }

  function replaceOne(name, keyField, replacement) {
    return KcmWithRepositoryWriteLock(function () {
      var rows = read(name);
      var matches = [];
      rows.forEach(function (row, index) {
        if (String(row[keyField]) === String(replacement[keyField])) matches.push(index);
      });
      if (!matches.length) KcmValidation.fail("NOT_FOUND", "El registro no existe");
      if (matches.length !== 1) KcmValidation.fail("CONFLICT", "La tabla contiene claves duplicadas");
      var intended = Object.assign({}, replacement);
      delete intended.__rowNumber;
      rows[matches[0]] = intended;
      write(name, rows);
      return intended;
    });
  }

  function list(name, predicate) {
    var rows = read(name);
    return predicate ? rows.filter(predicate) : rows;
  }

  function findOne(name, predicate) {
    var rows = list(name, predicate);
    return rows.length ? rows[0] : null;
  }

  function ensureSchema() { return true; }

  function seedSynthetic() {
    if (!read(KcmConfig.SHEETS.EMPLOYEES).length) {
      write(KcmConfig.SHEETS.EMPLOYEES, [
        { employeeId: "00123", displayName: "Persona Uno", area: "Area A", position: "Rol A", shift: "1", active: true, version: "1.0.0" },
        { employeeId: "04567", displayName: "Persona Dos", area: "Area B", position: "Rol B", shift: "2", active: true, version: "1.0.0" },
        { employeeId: "89012", displayName: "Persona Tres", area: "Area C", position: "Rol C", shift: "3", active: true, version: "1.0.0" }
      ]);
    }
    if (!read(KcmConfig.SHEETS.TRAININGS).length) {
      write(KcmConfig.SHEETS.TRAININGS, [{ trainingId: "CAP-SINT-001", trainingName: "Capacitacion sintetica", active: true, version: "1.0.0" }]);
    }
    if (!read(KcmConfig.SHEETS.MATRIX_MAPPING).length) {
      write(KcmConfig.SHEETS.MATRIX_MAPPING, [{
        trainingId: "CAP-SINT-001", destinationSheet: "HC", destinationColumn: "J",
        destinationHeader: "REINDUCCION A LA EMPRESA", headerRow: 3,
        mappingVersion: "mock-v1", overwritePolicy: "NO_OVERWRITE", active: true
      }]);
    }
  }

  return Object.freeze({
    insertMany: insertMany, updateMany: updateMany, replaceOne: replaceOne, list: list,
    findOne: findOne, ensureSchema: ensureSchema, seedSynthetic: seedSynthetic
  });
}());

var KcmRepository = (function () {
  "use strict";
  function current() {
    if (KcmConfig.isMockMode()) {
      KcmMockRepository.seedSynthetic();
      return KcmMockRepository;
    }
    return KcmSheetsRepository;
  }
  return Object.freeze({ current: current });
}());
