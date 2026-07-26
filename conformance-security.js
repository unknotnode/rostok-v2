/**
 * conformance-security.mjs — гейт execution-security/1, шаг 1 §11:
 * канонизация, golden vectors, чистые валидаторы структур.
 * Нормативный источник: protocol/execution-security-1.md
 *   SHA-256 cb9fc1ff98be1efb428ee924c81163aab974b99faa8465f80f3d5697095cd04e
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  esCanonicalEncode, esCanonicalHash, esDecode, assertCanonicalBytes, assertShape,
  bytesToHex, hexToBytes, CanonError, CanonReason, esDomainHashBytes, compileShapeSpec, ES_CANON_ID, ES_BASE_CANON,
} from "../src/security/canonical-es.mjs";
import { canonicalBytes as archiveCanonicalBytes } from "../src/lib/canonical.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Custody (manifest-driven): гейт проверяет цепочку
//   law hash → artifact manifest → реально импортированный source → тесты.
// Хэши живут в manifest, а не как произвольные константы в гейте, чтобы
// связь артефакта с законом была явной и версионируемой.
function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
const MANIFEST = JSON.parse(readFileSync(join(root, "fixtures", "es-artifact-manifest.json"), "utf8"));
const LAW_PATH = join(root, "protocol", "execution-security-1.md");
// URL, которым пользуется сам гейт для импорта реализации — тот же файл.
const IMPORTED_SOURCE_PATH = fileURLToPath(new URL("../src/security/canonical-es.mjs", import.meta.url));

const V = JSON.parse(readFileSync(join(root, "fixtures", "es-canon-vectors.json"), "utf8"));
const enc = new TextEncoder();

let pass = 0, fail = 0;
function check(name, fn) {
  try { const m = fn(); pass++; console.log(`  ✓ ${name}${m ? " — " + m : ""}`); }
  catch (e) { fail++; console.log(`  ✗ ${name} — ${e.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
/** Раскрывает маркеры значений, невыразимых в JSON-тексте (например -0). */
function materialize(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(materialize);
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === "$special") {
    if (v.$special === "negative-zero") return -0;
    throw new Error(`неизвестный маркер $special: ${v.$special}`);
  }
  if (keys.includes("$special")) {
    throw new Error("marker object обязан иметь ровно одно поле $special");
  }
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = materialize(x);
  return out;
}
/** Ожидаем отказ на конкретной СТАДИИ (decode | shape | canonicality). */
function expectStage(fn, stage, what) {
  try { fn(); } catch (e) {
    assert(e instanceof CanonError, `${what}: не CanonError (${e.constructor.name}: ${e.message})`);
    assert(e.stage === stage, `${what}: стадия ${e.stage}, ожидалась ${stage}`);
    return;
  }
  throw new Error(`${what}: отказа не было`);
}

console.log("execution-security/1 — шаг 1: канонизация и структуры");

check("custody: law hash в manifest совпадает с законом", () => {
  const actual = sha256File(LAW_PATH);
  assert(actual === MANIFEST.lawSha256, `law ${actual} ≠ manifest ${MANIFEST.lawSha256}`);
  return MANIFEST.lawSha256.slice(0, 16) + "…";
});
check("custody: реально импортированный source совпадает с manifest", () => {
  const entry = MANIFEST.artifacts.find((a) => a.path === "src/security/canonical-es.mjs");
  assert(entry, "canonical-es отсутствует в manifest");
  const actual = sha256File(IMPORTED_SOURCE_PATH);
  assert(actual === entry.sha256, `imported source ${actual} ≠ manifest ${entry.sha256}`);
  return actual.slice(0, 16) + "…";
});
check("custody: все артефакты manifest на месте с ожидаемым хэшем", () => {
  let checked = 0;
  for (const a of MANIFEST.artifacts) {
    if (a.selfExcludedFromGate === true) {
      // Гейт не хэширует сам себя (рекурсия). Его хэш закрепляет внешний
      // якорь — регистрационный документ, не этот тест. Здесь лишь
      // проверяем корректность записи и наличие файла.
      assert(a.sha256 === null, `${a.path}: self-excluded не должен нести хэш в manifest`);
      readFileSync(join(root, a.path));
      continue;
    }
    const actual = sha256File(join(root, a.path));
    assert(actual === a.sha256, `${a.path}: ${actual} ≠ ${a.sha256}`);
    checked++;
  }
  return `${checked} артефакта под хэшем, гейт — под внешним якорем`;
});

console.log("Golden vectors (байты + хэш):");
check("позитивные векторы: байты совпадают побайтно", () => {
  for (const v of V.positive) {
    const b = esCanonicalEncode(v.value);
    assert(bytesToHex(b) === v.bytesHex, `${v.id}: байты разошлись`);
    assert(b.length === v.byteLength, `${v.id}: длина`);
  }
  return `${V.positive.length} векторов`;
});
check("позитивные векторы: domain-separated хэш совпадает", () => {
  for (const v of V.positive) {
    assert(esCanonicalHash(V.hashDomain, v.value) === v.hash, `${v.id}: хэш разошёлся`);
  }
  return "все совпали";
});
check("хэш зависит от домена (domain separation работает)", () => {
  const a = esCanonicalHash("domain/a", { x: 1 }), b = esCanonicalHash("domain/b", { x: 1 });
  assert(a !== b, "домен не влияет на хэш");
  return "домены дают разные хэши";
});
check("encode не хэширует внутри: возвращает Uint8Array", () => {
  const b = esCanonicalEncode({ a: 1 });
  assert(b instanceof Uint8Array, "не Uint8Array");
  assert(new TextDecoder().decode(b) === '{"a":1}', "не канонический текст");
  return "контракт encode→bytes соблюдён";
});
check("пустой домен отвергается", () => {
  expectStage(() => esCanonicalHash("", { a: 1 }), "shape", "пустой домен");
  return "domain обязателен";
});

console.log("Инвариант каноничности:");
check("порядок полей не влияет на байты и хэш", () => {
  const A = { b: 2, a: 1, c: { z: 1, y: 2 } }, B = { c: { y: 2, z: 1 }, a: 1, b: 2 };
  assert(bytesToHex(esCanonicalEncode(A)) === bytesToHex(esCanonicalEncode(B)), "байты разошлись");
  assert(esCanonicalHash("d", A) === esCanonicalHash("d", B), "хэши разошлись");
  return "один семантический объект ⇒ один hash";
});
check("неканонический ввод отвергается на стадии canonicality", () => {
  expectStage(() => assertCanonicalBytes(enc.encode('{"b":2,"a":1}')), "canonicality", "порядок ключей");
  expectStage(() => assertCanonicalBytes(enc.encode('{ "a" : 1 }')), "canonicality", "пробелы");
  expectStage(() => assertCanonicalBytes(enc.encode('{"a":1.0}')), "canonicality", "неминимальное число");
  return "порядок, пробелы, форма числа";
});
check("канонический ввод принимается", () => {
  const v = assertCanonicalBytes(enc.encode('{"a":1,"b":[1,2]}'));
  assert(v.a === 1 && Array.isArray(v.b), "значение не восстановлено");
  return "round-trip чист";
});

console.log("Внешняя негативная батарея (fixture, не зашита в JS):");
check("decode/canonicality-негативы: стадия и класс причины из fixture", () => {
  let n = 0;
  for (const c of V.negative) {
    const bytes = hexToBytes(c.inputHex);
    let err = null;
    try {
      if (c.expectedStage === "canonicality") assertCanonicalBytes(bytes);
      else esDecode(bytes);
    } catch (e) { err = e; }
    assert(err !== null, `${c.id}: отказа не было`);
    assert(err instanceof CanonError, `${c.id}: не CanonError (${err.message})`);
    assert(err.stage === c.expectedStage, `${c.id}: стадия ${err.stage}, ожидалась ${c.expectedStage}`);
    assert(err.reasonClass === c.expectedReasonClass, `${c.id}: класс ${err.reasonClass}, ожидался ${c.expectedReasonClass}`);
    n++;
  }
  return `${n} векторов`;
});
check("shape-негативы: стадия и класс причины из fixture", () => {
  let n = 0;
  for (const c of V.shapeNegative) {
    const raw = V.shapeSpecs[c.specId];
    assert(raw, `${c.id}: spec ${c.specId} отсутствует`);
    const spec = compileShapeSpec(raw);   // внешний spec компилируется до применения
    let err = null;
    try { assertShape(materialize(structuredClone(c.value)), spec); } catch (e) { err = e; }
    assert(err !== null, `${c.id}: отказа не было`);
    assert(err.stage === "shape", `${c.id}: стадия ${err.stage}`);
    assert(err.reasonClass === c.expectedReasonClass, `${c.id}: класс ${err.reasonClass}, ожидался ${c.expectedReasonClass}`);
    n++;
  }
  return `${n} векторов`;
});
check("лексика: спецтокены ВНУТРИ строк не отклоняются", () => {
  for (const src of ['{"s":"x:-0"}', '{"s":"NaN"}', '{"s":"Infinity"}', '{"s":"-Infinity"}']) {
    const v = esDecode(enc.encode(src));
    assert(typeof v.s === "string", `${src}: строка не разобрана`);
  }
  return "декодер лексический, не regex";
});
check("все формы отрицательного нуля отвергаются грамматически", () => {
  for (const src of ['{"a":-0}', '{"a":-0.0}', '{"a":-0e0}', '{"a":-0E+10}', '{"a":-0.000e5}']) {
    expectStage(() => esDecode(enc.encode(src)), "decode", src);
  }
  return "-0, -0.0, -0e0, -0E+10, -0.000e5";
});
check("дубли ключей сравниваются по декодированному значению", () => {
  for (const src of ['{"a":1,"\\u0061":2}', '{"\\u0061":1,"a":2}', '{"é":1,"\\u00e9":2}', '{"\\"":1,"\\u0022":2}']) {
    expectStage(() => esDecode(enc.encode(src)), "decode", src);
  }
  return "escaped-эквиваленты пойманы";
});
check("Unicode-нормализация НЕ выполняется: é ≠ e+U+0301", () => {
  const v = esDecode(enc.encode('{"é":1,"e\u0301":2}'));
  assert(Object.keys(v).length === 2, "ключи схлопнулись — выполнена нормализация");
  return "два различных ключа сохранены";
});
check("расхождение с archive-canon зафиксировано осознанно", () => {
  assert(archiveCanonicalBytes({ a: -0 }) === '{"a":-0}', "archive-canon изменился");
  expectStage(() => esCanonicalEncode({ a: -0 }), "shape", "es-слой");
  return "archive сохраняет -0, подписываемый слой запрещает";
});
check("canonical encoder не исполняет getter индекса массива", () => {
  let executed = false;
  const arr = [];
  Object.defineProperty(arr, "0", { enumerable: true, get() { executed = true; return 1; } });
  arr.length = 1;
  let err = null;
  try { esCanonicalEncode(arr); } catch (e) { err = e; }
  assert(executed === false, "encoder исполнил getter индекса");
  assert(err && err.reasonClass === CanonReason.ACCESSOR && err.path === "$[0]", `${err && err.reasonClass} @ ${err && err.path}`);
  return "encoder и shape закрывают accessor одинаково";
});
check("canonical encoder запрещает sparse arrays и лишние свойства", () => {
  let e1 = null;
  try { esCanonicalEncode(new Array(2)); } catch (e) { e1 = e; }
  assert(e1 && e1.reasonClass === CanonReason.MISSING_FIELD && e1.path === "$[0]", `sparse: ${e1 && e1.path}`);
  let e2 = null;
  try { esCanonicalEncode([1, , 3]); } catch (e) { e2 = e; }
  assert(e2 && e2.reasonClass === CanonReason.MISSING_FIELD && e2.path === "$[1]", "дырка в середине");
  const a = [1]; a.meta = 2;
  let e3 = null;
  try { esCanonicalEncode(a); } catch (e) { e3 = e; }
  assert(e3 && e3.reasonClass === CanonReason.UNSUPPORTED_VALUE, "нецелочисленное свойство массива принято");
  // контракт: то, что encoder принял, esDecode обязан разобрать
  assert(JSON.stringify(esDecode(esCanonicalEncode([1, 2, 3]))) === "[1,2,3]", "round-trip плотного массива нарушен");
  return "encoder держит собственный контракт esDecode∘esCanonicalEncode";
});
check("shape запрещает неперечислимые и symbol собственные поля", () => {
  const v1 = { x: 1 };
  Object.defineProperty(v1, "hidden", { enumerable: false, value: 2 });
  let e1 = null;
  try { assertShape(v1, { fields: { x: { type: "integer" } } }); } catch (e) { e1 = e; }
  assert(e1 && e1.reasonClass === CanonReason.UNSUPPORTED_VALUE, "неперечислимое поле прошло shape");
  const v2 = { x: 1 }; v2[Symbol("hidden")] = 2;
  let e2 = null;
  try { assertShape(v2, { fields: { x: { type: "integer" } } }); } catch (e) { e2 = e; }
  assert(e2 && e2.reasonClass === CanonReason.UNSUPPORTED_VALUE, "symbol-ключ прошёл shape");
  const mp = {}; mp[Symbol("k")] = 1;
  let e3 = null;
  try { assertShape({ m: mp }, { fields: { m: { type: "map", values: { type: "integer" } } } }); } catch (e) { e3 = e; }
  assert(e3 && e3.reasonClass === CanonReason.UNSUPPORTED_VALUE, "symbol-ключ прошёл map");
  return "домен shape совпал с canonical model (Reflect.ownKeys)";
});
check("непростые объекты и опасные значения отвергаются при кодировании", () => {
  expectStage(() => esCanonicalEncode({ d: new Date() }), "shape", "Date");
  expectStage(() => esCanonicalEncode({ m: new Map() }), "shape", "Map");
  expectStage(() => esCanonicalEncode({ t: new Uint8Array([1]) }), "shape", "TypedArray");
  expectStage(() => esCanonicalEncode({ u: undefined }), "shape", "undefined");
  expectStage(() => esCanonicalEncode({ b: 1n }), "shape", "BigInt");
  const cyc = {}; cyc.self = cyc;
  expectStage(() => esCanonicalEncode(cyc), "shape", "цикл");
  const g = {}; Object.defineProperty(g, "x", { get: () => 1, enumerable: true });
  expectStage(() => esCanonicalEncode(g), "shape", "getter");
  return "7 негативов";
});
check("валидная структура принимается без default и coercion", () => {
  const spec = V.shapeSpecs.basic;
  const ok = { id: "x", count: 2, ratio: 0.5, kind: "A", hash: "a".repeat(64), parent: null, items: [1] };
  const v = assertShape(structuredClone(ok), spec);
  assert(!Object.prototype.hasOwnProperty.call(v, "note"), "optional получил default");
  return "необязательное поле осталось отсутствующим";
});

console.log("Shape-engine: расширения слоя 1:");
check("длина строк измеряется в БАЙТАХ UTF-8, не в code units", () => {
  const L = { fields: { s: { type: "string", minUtf8Bytes: 2, maxUtf8Bytes: 4 } } };
  assertShape({ s: "😀" }, L);                       // 4 байта, но .length === 2
  assert("😀".length === 2, "предпосылка теста неверна");
  expectStage(() => assertShape({ s: "a" }, L), "shape", "1 байт < min");
  expectStage(() => assertShape({ s: "abcde" }, L), "shape", "5 байт > max");
  expectStage(() => assertShape({ s: "😀a" }, L), "shape", "5 байт > max");
  return "emoji = 4 байта, JS .length не используется";
});
check("maxItems ограничивает сверху", () => {
  const L = { fields: { arr: { type: "array", maxItems: 2, items: { type: "integer" } } } };
  assertShape({ arr: [1, 2] }, L);
  expectStage(() => assertShape({ arr: [1, 2, 3] }, L), "shape", "maxItems");
  return "верхняя граница активна";
});
check("порядок: валидация элемента предшествует uniqueItems", () => {
  const S = { fields: { a: { type: "array", uniqueItems: true, items: { type: "integer" } } } };
  let err = null;
  try { assertShape({ a: [{ x: 1 }] }, S); } catch (e) { err = e; }
  assert(err && err.reasonClass === CanonReason.TYPE_MISMATCH, `ожидался структурный отказ, получен ${err && err.reasonClass}`);
  assert(err.path === "$.a[0]", `путь ${err.path} вместо $.a[0]`);
  // getter внутри элемента: тоже структурный путь, не отказ encoder-а с чужим путём
  const S2 = { fields: { a: { type: "array", uniqueItems: true, items: { type: "integer" } } } };
  const g = {}; Object.defineProperty(g, "v", { get: () => 1, enumerable: true });
  let err2 = null;
  try { assertShape({ a: [g] }, S2); } catch (e) { err2 = e; }
  assert(err2.reasonClass === CanonReason.TYPE_MISMATCH, `getter-элемент дал ${err2.reasonClass} вместо структурного отказа`);
  return "valid shape → canonical identity → uniqueness";
});
check("compileShapeSpec отклоняет неверные типы ограничений (whitelist)", () => {
  expectStage(() => compileShapeSpec({ fields: { x: { type: "string", enum: {} } } }), "shape", "enum не массив");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "array", minItems: "2" } } }), "shape", "minItems с coercion");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "string", optional: 1 } } }), "shape", "optional не boolean");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "string", maxUTF8Bytes: 4 } } }), "shape", "опечатка в имени ограничения");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "integer", minimum: "10" } } }), "shape", "minimum строкой");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "integer", minimum: 1.5 } } }), "shape", "дробная граница integer");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "integer", minimum: 5, maximum: 1 } } }), "shape", "min > max");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "string", items: { type: "integer" } } } }), "shape", "items не для string");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "array", keyPattern: "^a$" } } }), "shape", "keyPattern не для array");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "string", enum: ["A", "A"] } } }), "shape", "дубль в enum");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "string", enum: [1] } } }), "shape", "enum несовместим с типом");
  expectStage(() => compileShapeSpec({ fields: { x: { type: "array", uniqueItems: "yes" } } }), "shape", "uniqueItems не boolean");
  return "12 негативов: опечатка не снимает ограничение молча";
});
check("верхний уровень spec тоже под whitelist", () => {
  expectStage(() => compileShapeSpec({ fields: {}, typo: true }), "shape", "опечатка на верхнем уровне");
  expectStage(() => compileShapeSpec({ discriminator: "kind", variants: { A: { fields: { kind: { type: "string", enum: ["A"] } } } }, fields: {} }), "shape", "fields рядом с variants");
  expectStage(() => compileShapeSpec({ fields: {}, variants: {} }), "shape", "variants без discriminator");
  return "лишние свойства spec не игнорируются молча";
});
check("тег варианта закреплён дискриминатором самим engine", () => {
  expectStage(() => compileShapeSpec({ discriminator: "kind", variants: { A: { fields: { kind: { type: "string", enum: ["B"] } } } } }), "shape", "enum ≠ тегу");
  expectStage(() => compileShapeSpec({ discriminator: "kind", variants: { A: { fields: { other: { type: "string" } } } } }), "shape", "нет поля дискриминатора");
  expectStage(() => compileShapeSpec({ discriminator: "kind", variants: { A: { fields: { kind: { type: "string", enum: ["A"], optional: true } } } } }), "shape", "optional дискриминатор");
  expectStage(() => compileShapeSpec({ discriminator: "kind", variants: { A: { fields: { kind: { type: "string", enum: ["A"], nullable: true } } } } }), "shape", "nullable дискриминатор");
  expectStage(() => compileShapeSpec({ discriminator: "kind", variants: { A: { fields: { kind: { type: "integer", enum: [1] } } } } }), "shape", "нестроковый дискриминатор");
  compileShapeSpec({ discriminator: "kind", variants: { A: { fields: { kind: { type: "string", enum: ["A"] }, alpha: { type: "integer" } } } } });
  return "внутренне противоречивый вариант не компилируется";
});
check("prototype-safe: ключ __proto__ из JSON остаётся обычным свойством", () => {
  const rawFields = JSON.parse('{"fields":{"__proto__":{"type":"string"}}}');
  const compiledFields = compileShapeSpec(rawFields);
  assert(Object.getPrototypeOf(compiledFields.fields) === null, "fields не prototype-free");
  assert(Object.prototype.hasOwnProperty.call(compiledFields.fields, "__proto__"), "__proto__ не стал собственным свойством");
  assertShape(JSON.parse('{"__proto__":"x"}'), compiledFields);
  const rawVariants = JSON.parse('{"discriminator":"kind","variants":{"__proto__":{"fields":{"kind":{"type":"string","enum":["__proto__"]}}}}}');
  const compiledVariants = compileShapeSpec(rawVariants);
  assert(Object.getPrototypeOf(compiledVariants.variants) === null, "variants не prototype-free");
  assert(Object.prototype.hasOwnProperty.call(compiledVariants.variants, "__proto__"), "__proto__ вариант потерян");
  assertShape(JSON.parse('{"kind":"__proto__"}'), compiledVariants);
  return "прототип не подменяется ни в fields, ни в variants";
});
check("compiled spec не зависит от последующих мутаций raw spec", () => {
  const raw = { fields: { mode: { type: "string", enum: ["A"] } } };
  const compiled = compileShapeSpec(raw);
  raw.fields.mode.enum.push("B");
  let err = null;
  try { assertShape({ mode: "B" }, compiled); } catch (e) { err = e; }
  assert(err && err.reasonClass === CanonReason.ENUM, "enum протёк по ссылке");
  assert(Object.isFrozen(compiled.fields.mode.enum), "enum не заморожен");
  raw.fields.mode.type = "integer";
  assertShape({ mode: "A" }, compiled);
  return "массивы пересозданы и заморожены, тип зафиксирован";
});
check("compileShapeSpec: повреждённый spec даёт CanonError, а не TypeError", () => {
  expectStage(() => compileShapeSpec({ fields: { a: { type: "string", pattern: "([a-z" } } }), "shape", "битый regex");
  expectStage(() => compileShapeSpec({ fields: { a: { type: "weird" } } }), "shape", "неизвестный тип");
  expectStage(() => compileShapeSpec({ discriminator: "k", variants: {} }), "shape", "пустые variants");
  expectStage(() => compileShapeSpec("nope"), "shape", "spec не объект");
  expectStage(() => compileShapeSpec({ fields: { a: { type: "map", keyPattern: "[" } } }), "shape", "битый keyPattern");
  const c = compileShapeSpec({ fields: { a: { type: "string", pattern: "^x$" } } });
  assert(Object.isFrozen(c) && Object.isFrozen(c.fields), "spec не заморожен");
  assertShape({ a: "x" }, c);
  expectStage(() => assertShape({ a: "y" }, c), "shape", "pattern работает после компиляции");
  return "regex и структура проверены однократно, spec заморожен";
});
check("uniqueItems сравнивает по каноническим байтам, не по ссылке", () => {
  const S = { fields: { a: { type: "array", uniqueItems: true, items: { type: "object" } } } };
  assertShape({ a: [{ x: 1 }, { x: 2 }] }, S);
  let err = null;
  try { assertShape({ a: [{ x: 1, y: 2 }, { y: 2, x: 1 }] }, S); } catch (e) { err = e; }
  assert(err && err.reasonClass === CanonReason.DUPLICATE_ITEM, `порядок ключей не распознан как дубль: ${err && err.reasonClass}`);
  return "структурно равные объекты — дубли независимо от порядка ключей";
});
check("map-like: четыре независимых ограничения", () => {
  const M = { fields: { m: { type: "map", keyPattern: "^[a-z]+$", minEntries: 1, maxEntries: 2, values: { type: "integer", minimum: 0 } } } };
  assertShape({ m: { ab: 1 } }, M);
  expectStage(() => assertShape({ m: [] }, M), "shape", "не plain object");
  expectStage(() => assertShape({ m: { AB: 1 } }, M), "shape", "keyPattern");
  expectStage(() => assertShape({ m: {} }, M), "shape", "minEntries");
  expectStage(() => assertShape({ m: { a: 1, b: 2, c: 3 } }, M), "shape", "maxEntries");
  expectStage(() => assertShape({ m: { a: -1 } }, M), "shape", "spec значения");
  return "тип, ключ, cardinality, значение";
});
check("discriminator: ровно один вариант, смешение полей невозможно", () => {
  const D = { discriminator: "kind", variants: {
    A: { fields: { kind: { type: "string", enum: ["A"] }, alpha: { type: "integer" } } },
    B: { fields: { kind: { type: "string", enum: ["B"] }, beta: { type: "string" } } } } };
  assertShape({ kind: "A", alpha: 1 }, D);
  assertShape({ kind: "B", beta: "x" }, D);
  let err = null;
  try { assertShape({ kind: "A", alpha: 1, beta: "x" }, D); } catch (e) { err = e; }
  assert(err && err.reasonClass === CanonReason.UNKNOWN_FIELD, `смешение вариантов принято: ${err && err.reasonClass}`);
  expectStage(() => assertShape({ kind: "C" }, D), "shape", "неизвестный вариант");
  expectStage(() => assertShape({ alpha: 1 }, D), "shape", "отсутствует дискриминатор");
  expectStage(() => assertShape({ kind: 1 }, D), "shape", "нестроковый дискриминатор");
  return "поля чужого варианта отвергаются как unknown-field";
});

check("integer enum применяется при валидации", () => {
  const spec = compileShapeSpec({ fields: { version: { type: "integer", enum: [1, 2] } } });
  assertShape({ version: 1 }, spec);
  assertShape({ version: 2 }, spec);
  let err = null;
  try { assertShape({ version: 3 }, spec); } catch (e) { err = e; }
  assert(err && err.reasonClass === CanonReason.ENUM, `integer enum проигнорирован: ${err && err.reasonClass}`);
  expectStage(() => compileShapeSpec({ fields: { version: { type: "integer", enum: [-0, 1] } } }), "shape", "-0 внутри integer enum");
  return "enum целых применяется, -0 в enum запрещён";
});
check("assertShape не исполняет accessors (объект, массив, map)", () => {
  let executed = false;
  const value = {};
  Object.defineProperty(value, "x", { enumerable: true, get() { executed = true; return 1; } });
  let err = null;
  try { assertShape(value, { fields: { x: { type: "integer" } } }); } catch (e) { err = e; }
  assert(executed === false, "getter объекта был исполнен");
  assert(err && err.reasonClass === CanonReason.ACCESSOR, `accessor не классифицирован: ${err && err.reasonClass}`);
  assert(err.path === "$.x", `неточный путь: ${err.path}`);

  let executedArr = false;
  const arr = [];
  Object.defineProperty(arr, "0", { enumerable: true, configurable: true, get() { executedArr = true; return 1; } });
  arr.length = 1;
  let errArr = null;
  try { assertShape({ a: arr }, { fields: { a: { type: "array", items: { type: "integer" } } } }); } catch (e) { errArr = e; }
  assert(executedArr === false, "getter на индексе массива был исполнен");
  assert(errArr && errArr.reasonClass === CanonReason.ACCESSOR && errArr.path === "$.a[0]", `массив: ${errArr && errArr.reasonClass} @ ${errArr && errArr.path}`);

  let executedMap = false;
  const mp = {};
  Object.defineProperty(mp, "k", { enumerable: true, get() { executedMap = true; return 1; } });
  let errMap = null;
  try { assertShape({ m: mp }, { fields: { m: { type: "map", values: { type: "integer" } } } }); } catch (e) { errMap = e; }
  assert(executedMap === false, "getter в map был исполнен");
  assert(errMap && errMap.reasonClass === CanonReason.ACCESSOR && errMap.path === "$.m.k", `map: ${errMap && errMap.reasonClass} @ ${errMap && errMap.path}`);
  return "чтение только через descriptor.value, единая норма с каноническим слоем";
});

check("getter дискриминатора не исполняется (четвёртая accessor-поверхность)", () => {
  let executed = false;
  const value = {};
  Object.defineProperty(value, "kind", { enumerable: true, get() { executed = true; return "A"; } });
  const D = { discriminator: "kind", variants: { A: { fields: { kind: { type: "string", enum: ["A"] } } } } };
  let err = null;
  try { assertShape(value, D); } catch (e) { err = e; }
  assert(executed === false, "getter дискриминатора был исполнен");
  assert(err && err.reasonClass === CanonReason.ACCESSOR, `не классифицирован: ${err && err.reasonClass}`);
  assert(err.path === "$.kind", `неточный путь: ${err.path}`);
  assertShape({ kind: "A" }, D);
  return "variant dispatch не исполняет пользовательский код";
});
check("разреженные массивы запрещены", () => {
  const spec = { fields: { a: { type: "array", minItems: 2, items: { type: "integer" } } } };
  let err = null;
  try { assertShape({ a: new Array(2) }, spec); } catch (e) { err = e; }
  assert(err && err.reasonClass === CanonReason.MISSING_FIELD, `holes прошли: ${err && err.reasonClass}`);
  assert(err.path === "$.a[0]", `неточный путь: ${err.path}`);
  let err2 = null;
  try { assertShape({ a: [1, , 3] }, { fields: { a: { type: "array", items: { type: "integer" } } } }); } catch (e) { err2 = e; }
  assert(err2 && err2.reasonClass === CanonReason.MISSING_FIELD && err2.path === "$.a[1]", `дырка в середине: ${err2 && err2.path}`);
  assertShape({ a: [1, 2] }, spec);
  return "length не подменяет наличие элементов";
});

console.log("Тотальность классификации и формат маркера:");
check("каждый путь отказа несёт reasonClass из реестра", () => {
  const e2 = new TextEncoder();
  const paths = [
    () => esCanonicalEncode({ a: NaN }), () => esCanonicalEncode({ a: -0 }),
    () => esCanonicalEncode({ a: undefined }), () => esCanonicalEncode({ a: 1n }),
    () => esCanonicalEncode({ a: () => 1 }), () => esCanonicalEncode({ a: Symbol() }),
    () => { const c = {}; c.s = c; return esCanonicalEncode(c); },
    () => esCanonicalEncode({ a: new Date() }),
    () => { const g = {}; Object.defineProperty(g, "x", { get: () => 1, enumerable: true }); return esCanonicalEncode(g); },
    () => esCanonicalHash("", { a: 1 }), () => hexToBytes("0g"),
    () => esDecode(e2.encode('{"a":-Infinity}')), () => esDecode(e2.encode('{"a":NaN}')),
    () => esDecode(e2.encode('{"a":Infinity}')), () => esDecode(new Uint8Array([0x7b, 0xff, 0x7d])),
    () => esDecode(new Uint8Array([])), () => assertShape({ a: 1 }, { fields: { a: { type: "weird" } } }),
    () => esDomainHashBytes("", new Uint8Array()), () => esDomainHashBytes("d", "not-bytes"),
    () => esDomainHashBytes("d", null),
    () => assertShape({ a: [{ x: 1 }, { x: 1 }] }, { fields: { a: { type: "array", uniqueItems: true, items: { type: "object" } } } }),
    () => assertShape({ m: { A: 1 } }, { fields: { m: { type: "map", keyPattern: "^[a-z]$", values: { type: "integer" } } } }),
    () => assertShape({ kind: "Z" }, { discriminator: "kind", variants: { A: { fields: { kind: { type: "string", enum: ["A"] } } } } }),
    () => assertShape({ a: new Array(1) }, { fields: { a: { type: "array", items: { type: "integer" } } } }),
    () => assertCanonicalBytes(e2.encode('{"b":1,"a":2}')),
  ];
  const known = new Set(Object.values(CanonReason));
  let n = 0;
  for (const f of paths) {
    let err = null;
    try { f(); } catch (e) { err = e; }
    assert(err instanceof CanonError, `путь #${n}: не CanonError`);
    assert(known.has(err.reasonClass), `путь #${n}: класс "${err.reasonClass}" вне реестра`);
    n++;
  }
  return `${n} путей, все классифицированы`;
});
check("CanonError с неизвестным классом невозможен", () => {
  let threw = false;
  try { new CanonError("decode", "выдуманный-класс", "x"); } catch { threw = true; }
  assert(threw, "конструктор принял класс вне реестра");
  return "конструктор отвергает";
});
check("маркер $special строгий: ровно одно поле", () => {
  let threw = false;
  try { materialize({ $special: "negative-zero", other: 1 }); } catch { threw = true; }
  assert(threw, "объект с посторонним полем принят за маркер");
  assert(Object.is(materialize({ $special: "negative-zero" }), -0), "чистый маркер не раскрылся");
  const plain = materialize({ other: 1 });
  assert(plain.other === 1, "обычный объект повреждён");
  return "посторонние поля отвергаются";
});

check("esDomainHashBytes: контракт и ограничение framing", () => {
  const b = (s) => new TextEncoder().encode(s);
  const a1 = esDomainHashBytes("d", b("ab"), b("c"));
  const a2 = esDomainHashBytes("d", b("a"), b("bc"));
  assert(a1 === a2, "конкатенация внезапно стала однозначной — контракт изменился");
  assert(esDomainHashBytes("d", b("a")) !== esDomainHashBytes("e", b("a")), "домен не влияет");
  const fixed = esDomainHashBytes("node", new Uint8Array(32), new Uint8Array(32));
  assert(/^[0-9a-f]{64}$/.test(fixed), "не hex-дайджест");
  return "неоднозначность при переменных длинах зафиксирована, 32-байтные части безопасны";
});
check("JSON-литерал null не связан с именем класса причины", () => {
  const enc2 = new TextEncoder();
  assert(typeof CanonReason.NULL_VALUE === "string", "класс причины не строка");
  assert(new TextDecoder().decode(esCanonicalEncode({ a: null })) === '{"a":null}', "encoder пишет не null");
  assert(esDecode(enc2.encode('{"a":null}')).a === null, "parser не разобрал null");
  return "проверено поведение, а не значение класса";
});

console.log("Служебное:");
check("hex round-trip корректен", () => {
  const b = new Uint8Array([0, 1, 15, 16, 255]);
  assert(bytesToHex(b) === "00010f10ff", "encode");
  assert(bytesToHex(hexToBytes("00010f10ff")) === "00010f10ff", "decode");
  expectStage(() => hexToBytes("0g"), "shape", "невалидный hex");
  return "00010f10ff";
});
check("идентификаторы слоя объявлены", () => {
  assert(ES_CANON_ID === "execution-security/canon-json-v1" && ES_BASE_CANON === "archive-canon/json-v1", "id");
  return `${ES_CANON_ID} над ${ES_BASE_CANON}`;
});

console.log(`\nИтог execution-security шаг 1: ${pass} прошло, ${fail} провалено.`);
if (fail > 0) process.exit(1);
