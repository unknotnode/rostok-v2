# JOURNAL — execution-security/1, шаг 7 (реализация)

Дата среза: 31 июля 2026. Точка входа для новой сессии. Всё ниже —
проверяемые факты, сверенные с деревом, не пересказ.

## Как развернуться в новой сессии

1. Распаковать рабочее дерево. Прогнать восемь гейтов (см. ниже) —
   обязаны дать зелёный, три эталона неизменны.
2. Прочитать docs/ в порядке README: CURRENT_STATE → NEXT_STEP →
   CONFORMANCE → ARCHITECTURAL_LAWS → DECISIONS → OPEN_QUESTIONS.
3. Сверить trust anchor: таблица хэшей в конце docs/CONFORMANCE.md должна
   совпасть с фактическими SHA-256 файлов.
4. Инвариант процесса: код пишется против зафиксированного документа
   (закон cb9fc1ff…d04e), НЕ против переписки. При расхождении нормативен
   документ.

## Где мы стоим

Спецификация execution-security/1.0.0 ПРИНЯТА и зафиксирована (draft1→
draft4 через ревизию). Реализация ОТКРЫТА и идёт.

**Шаг 7, слой 1 (канонизация + shape-engine) — ЗАКРЫТ.** Гейт
conformance-security 46/46 (слой 1). Единый допустимый домен значений:
обе публичные функции (esCanonicalEncode, assertShape) отвергают один
класс программно сконструированных значений. Custody machine-checked:
manifest→артефакты + внешний якорь в CONFORMANCE.md.

**Шаг 7, слой 2 (семь структур §3) — ЗАКРЫТ (структурный).** Гейт
conformance-security 65/65 (слой 1 + слой 2). Семь spec-объектов против
закона cb9fc1ff…d04e, поверх проверенного compileShapeSpec/assertShape:
ProposalEnvelope (§3.1, 18 полей), SupportAttestation (§3.2, 7),
EvidenceLeaf (§3.3, 5), AdministrativeDecision (§3.4, 18),
Authorization (§3.5, 5), AuthorityKeyRecord (§3.6, 8),
CALIBRATION_APPLY (§3.7, 19). 7 позитивных векторов, 57 негативов +
5 cross-structure consistency tests (PE↔SA: nodeId, epoch, evidenceWindow,
hash-поля, parentCommitRef).

**Шаг 7, слой 2b (вычисляемые хэши) — НЕ НАЧАТ.** Это следующее задание:
proposalHash, decisionHash, calibrationApplyHash, Merkle-root,
domain separation — ОТДЕЛЬНЫЙ срез против уже зафиксированных байтов.

kernel-feedback-gate/1 — ЗАКРЫТ до прохождения полного гейта
execution-security.

## Исследовательская линия (параллельная, не блокирует нормативную)

relation-state-falsification/0 draft2 (reviewed) — ЗАМОРОЖЕН.
relation-state-harness/0 draft2 (reviewed) — ЗАМОРОЖЕН.
Хэши в research/FREEZE-RECORD.md. Следующая фаза — эмпирическая,
отдельным процессом.

emergent-geometry-experiments/0 — НЕ НАЧАТ, статус hypothesis.
OAL / Selection Pressure Engine — hypothesis E-N. В ядро не
интегрируется до получения воспроизводимых экспериментальных
результатов, демонстрирующих либо: (1) самопроизвольное возникновение
селекционного давления из локальной динамики отношений и ограниченности
ресурса, либо (2) невозможность его возникновения без явного механизма.
Операторы σ⁺/σ⁻/τ/δ/ρ/π — язык наблюдения эксперимента, не
обязательные операторы реализации.

## Research Queue

| ID | Тема | Статус | Условие входа | Условие выхода | Блокирует |
|---|---|---|---|---|---|
| E-F | relation-state-falsification | draft2 (reviewed), заморожен | — | эмпирический harness | ничего |
| E-H | relation-state-harness | draft2 (reviewed), заморожен | E-F frozen | реализация + прогон | ничего |
| E-G | emergent-geometry-experiments | hypothesis, не начат | — | формулировка E-1…E-k | ничего |
| E-N | Selection Pressure Engine | hypothesis | E-G оформлен | воспроизводимые результаты | ничего |

Ни один элемент очереди не блокирует нормативную линию
(execution-security/1). Исследовательская и нормативная ветки
пересекаются только в точках интеграции, определённых отдельным
процессом.

## Восемь гейтов (все зелёные на срезе)

```
node tools/run-fixtures.mjs        # 52
node tools/conformance-step1.mjs   # 35
node tools/conformance-step2.mjs   # 14
node tools/conformance-step3.mjs   # 18
node tools/conformance-step4.mjs   # 21
node tools/conformance-step5.mjs   # 21
node tools/conformance-step6.mjs   # 57
node tools/conformance-security.mjs # 65
```

Три эталона (НЕ меняются): a7cdfd3b306c5a77, 20e11a6290f1c3bd,
4d036ba986b6d554.

## Комплект execution-security (хэши среза)

| Файл | SHA-256 | Назначение |
|---|---|---|
| protocol/execution-security-1.md | `cb9fc1ff98be1efb428ee924c81163aab974b99faa8465f80f3d5697095cd04e` | закон execution-security/1.0.0 |
| protocol/calibration-surface-1.md | `d4b6f02b0f345f207a3ab7d5b012858f910ddd0c0542fe8122e82dd8c153afaf` | профиль калибруемой поверхности |
| protocol/stability-profile-1.md | `de90716293e976981c07ab8c79d526579a1a5f1b03a5c13491283b42c7642ba3` | профиль устойчивости |
| protocol/authority-registry-schema-1.md | `0d58efa56bda4ebdfc137c4c94a208f606881534b165666660f71af199632b4e` | схема реестра полномочий |
| protocol/authority-policy-1.md | `59f338b934cbf77c754450f03d4f60382ba6615fc4296e36b8c0137465968c6f` | политики авторизации |
| protocol/evidence-merkle-1.md | `fd3a2cdd1762b4c782c17899065d4f82ef978281153e49dbd2bf20c388c16966` | канон дерева доказательств |
| src/security/canonical-es.mjs | `379610aa19678fc5b5c4173d593702a24bbf0f342bf360bd22faffc7bfe27e9d` | слой 1: канонизация + shape-engine |
| tools/conformance-security.mjs | `dd35e3d53e59044ed8fdbe72109ec76bcd6413bcbd2fadb97f32f35101679d4f` | гейт execution-security (65/65) |
| fixtures/es-canon-vectors.json | `bde175ba0e9d5069c653411e25e5816e37b898e98b4b0a4e9cfade94582fe63f` | переносимые векторы канонизации |
| fixtures/es-artifact-manifest.json | `63849c0d4066f12150cb873e2e749b011fc6b4f5296535c77d8dd3d32483310d` | manifest custody |

Внешний якорь provenance — таблица в конце docs/CONFORMANCE.md
(закон+manifest+гейт+реализация+векторы). Хэш гейта закреплён якорем, не
manifest (гейт не хэширует сам себя: selfExcludedFromGate).

## Что делает слой 1 (src/security/canonical-es.mjs)

- esCanonicalEncode(value)→Uint8Array — без хэширования внутри.
- esCanonicalHash(domain,value)=SHA256(domain‖bytes) — домен обязателен.
- esDomainHashBytes(domain,...parts) — для Merkle-узлов; framing
  неоднозначен для переменных длин, безопасен для 32-байтных частей
  (зафиксировано контрактом и тестом).
- esDecode(bytes) — сканер JSON с состояниями (не regex): отвергает −0 во
  всех формах, NaN/Infinity, дубли ключей по ДЕКОДИРОВАННОМУ значению; без
  Unicode-нормализации.
- assertCanonicalBytes — round-trip проверка каноничности.
- compileShapeSpec(spec) + assertShape(value,spec) — spec-engine.

Реестр CanonReason заморожен (25 классов); reasonClass — ОБЯЗАТЕЛЬНЫЙ
аргумент CanonError (тотальность классификации: путь отказа без класса
невозможен). $special — маркер значений, невыразимых в JSON (−0), строгий:
ровно одно поле. Единица длины — minUtf8Bytes/maxUtf8Bytes (БАЙТЫ, не
code units). discriminator: отдельный spec на вариант, тег привязан к
enum движком, смешение полей вариантов ⇒ unknown-field. Четыре
accessor-поверхности закрыты (поля объекта, индексы массива, ключи map,
дискриминатор); holes, symbol-ключи, неперечислимые и лишние свойства
отвергаются; prototype-safe словари (__proto__ — обычный ключ).

−0: archive-canon сохраняет (Р13), подписываемый слой ЗАПРЕЩАЕТ. Это
осознанное СУЖЕНИЕ, зафиксировано отдельным тестом; архивный слой не
тронут.

## Следующее задание — слой 2b (вычисляемые хэши, §4)

Порядок (зафиксирован):

    2b.1  canonical serialization (без proposalHash/decisionHash/calibrationApplyHash)
    2b.2  proposalHash
    2b.3  decisionHash
    2b.4  calibrationApplyHash
    2b.5  EvidenceLeaf hashing
    2b.6  Merkle-root (evidence-merkle/1, fd3a2cdd…6966)
    2b.7  full-chain cross-structure validation
    2b.8  golden vectors (точные хэши)
    2b.9  mutation negatives

Главный инвариант: одинаковое логическое значение → одинаковые canonical
bytes → одинаковый hash. Защитный инвариант: любое изменение значимого
поля → изменение bytes → изменение hash → разрыв цепочки.

Три уровня валидности (не смешивать): STRUCTURE_VALID (слой 2, закрыт),
HASH_VALID (слой 2b), CHAIN_VALID (слой 2b.7).

Тестовый экземпляр authority-registry-instance с детерминированной парой
ключей завести отдельно, помеченным как conformance fixture, НЕ раньше
среза подписей/авторизации.

## Инварианты, которые нельзя нарушить

- Код против зафиксированного документа, не против переписки.
- reversible-only калибровка; monotonic/irreversible в runtime denied.
- Причинный контур не пишет CALIBRATION_APPLY, не владеет ключами, не
  выбирает policy evaluator, не влияет на проверку происхождения.
- Каждый срез: маленький шаг → гейт → мутационный контроль → полный
  регресс восьми гейтов + сверка трёх эталонов → показ файлов.
- Custody: SHA-256 импортированного гейтом source == SHA-256
  предъявленного на ревью. Проверяется самим гейтом.
