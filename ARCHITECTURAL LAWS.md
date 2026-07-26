# ROST/0k v2 — зафиксированные законы

Только принятое и версионированное. Изменение семантики = новая версия
идентификатора. Молчаливых изменений не бывает.

## Нормативные документы

| Идентификатор | Файл | Статус |
|---|---|---|
| kernel-abi/2.2.0 | protocol/kernel-abi-2.md; schema/kernel-metadata,kernel-state | зафиксирован (аддитивно к 2.1.0: causalFacts, factStreams, seqScope, causalConfig, causalConfigHash — всё опционально; reference-профиль валиден без них) |
| causal-state-hash/fnv1a64-le-v1 | эталон: tools/causal-hash.mjs | зафиксирован |
| archive-canon/json-v1 | src/lib/canonical.mjs | зафиксирован |
| archive-content/sha256-json-v1 | src/lib/canonical.mjs + sha256.mjs | зафиксирован |
| reference-relaxation-kernel/1 rev3 | protocol/kernels/ | зафиксирован |
| series-view@1 | protocol/views/series-view-1.md | зафиксирован |
| two-tier-journal/1.0.0 | protocol/two-tier-journal-1.md | зафиксирован |
| integration-relaxation/1.0.0 | src/kernels/integration-relaxation.mjs | зафиксирован (Integration Profile: causalFacts=true, владеет nextFactSeq; эталоны в fixtures/integration-hash-vectors.json) |
| runtime-integration/1.0.0 | src/runtime/integration-layer.mjs | зафиксирован (шаг 6; transaction staging, единый #runtimeState, двухфазный commit/publish, seal-verify) |

## Допущения модели исполнения (нормативно, runtime-integration/1.0.0)

Эти два положения — часть закона, не деталь реализации. Их нельзя потерять
при чтении только реестра.

**Д-исп-1. Атомарность commit — логическая, не аппаратная.** Принятие
перехода выполняется построением полного следующего immutable
`#runtimeState` вне общих структур (пока rollback разрешён) и затем
переключением корневой ссылки одной операцией с последующим применением
подготовленного retention-custody и фиксацией стадии commit. Зона install
не содержит user-кода, IO, await, валидации и намеренных throw.
Переключение корневой ссылки рассматривается как логически атомарная
операция в принятой модели исполнения, но **не** как аппаратная гарантия.
Любое непредвиденное исключение в install-зоне переводит Runtime в
CAUSAL_INDETERMINATE (fail-closed): доказать атомарность уже нельзя,
обычный rollback запрещён.

**Д-исп-2. Парность causalConfig/causalConfigHash — Runtime-страж.**
Парность обеспечивается стражем в open(), поскольку минимальный
бездепендентный валидатор (дисциплина шага 0: неизвестные ключевые слова —
ошибка) не выражает условие «оба-или-ни-одного» без запрещённых
конструктов (not/anyOf/allOf/if). Это ограничение схемного слоя, а **не**
отсутствие проверки. Schema-level pairing — Т-долг (см. OPEN_QUESTIONS).

## Д1. Закон наблюдателя

Предзаданность запрещена в причинном контуре. В наблюдательном —
неустранима и потому обязана быть явной: каждый детектор имеет id,
версию, полные параметры в протоколе. Журнал различает «детектор X@v с
параметрами P сработал» (факт наблюдения) и «система открыла X»
(интерпретация). Каждый детектор эмерджентности сопровождается
нуль-моделью. Ожидаемые наблюдаемые фиксируются до запуска.

## Д2. Двухъярусный журнал

Факты ядра и заявления наблюдателей — разные схемы. Смешение
синтаксически невозможно: у факта нет поля провенанса детектора, у
заявления оно обязательно. Заявление никогда не становится причиной
для ядра автоматически — только через записанную команду.

## Д3. Декларация морфопространства

KernelMetadata объявляет: moveClasses + moves, growthCapabilities
(вектор из пяти), buffers (causal × numericClass), dormant (адресация
компонент), ceilings, symmetries (версионированные), views, deadRegions.
Ядро без конструктивных ходов обязано это декларировать — «неактивация
роста» не выдаётся за результат. Спящая компонента без канала инертна
по построению; её молчание — не результат.

## Д4. Ownership-протокол снимков

Живое состояние ядра никогда не передаётся и не разделяется. Снимок —
отдельный буфер пула. Режим A (по умолчанию): кольцо ≥3 transferable,
состояния владения явные, возврат — физическое отсоединение буфера.
**Политика: drop, never block** — нет свободного буфера, снимок
пропускается, физика не ждёт; счётчик пропусков обязателен. Режим B —
копирование. Режим C — SAB+epoch, только при cross-origin isolation.

## C1–C9. Conformance-законы ABI

C1 детерминизм: seed → траектория. C2 step(n) ≡ n×step(1). C3 полнота
checkpoint. C4 чистота checkpoint (не тянет RNG). C5 терминальность
shutdown. C6 валидность metadata + кросс-проверки. **C7 пассивность:
удаление любого подмножества анализаторов ⇒ бит-идентичная траектория.**
C8 схемный гейт журнала. C9 канонический base64-LE + совпадение с
эталоном хэша.

## O1. Изоляция наблюдателей

Кодек возвращает read-only accessor (length + геттеры). Анализатор
физически не получает TypedArray или ArrayBuffer: мутация входа соседа
невозможна, а не запрещена. Порядок регистрации безразличен.

## Семантика CausalStateHash

RawCausalRecordHash: равенство хэшей **достаточно** для равенства
состояния; неравенство **не всегда** означает различие будущего, если
ядро декларирует deadRegions. Анализаторы обязаны не трактовать
различие мёртвой роли как физическое расхождение.

## ArchiveValue

Разрешены: null, boolean, string, конечные числа (−0 **сохраняется**),
массивы, простые объекты. Отклоняются с E_ARCHIVE_VALUE: NaN, ±Infinity,
undefined, функции, Symbol, BigInt, циклы, Date/Map/Set/toJSON, сырые
TypedArray, symbol-ключи, неперечислимые поля, getter/setter. Копия — на
Object.create(null): «__proto__» — обычные данные. Ключи сортируются по
байтам UTF-8 канонически экранированного представления (полный порядок
даже для непарных суррогатов). Бинарное — только нормативным
дескриптором.

## Идентичности

- **documentHash** — весь протокольный документ.
- **experimentIdentityHash** — семантическая проекция постановки (без
  id, createdAt, environment).
- **executionEnvironmentHash** — runtime, платформа, движок, численная
  политика, host.
- **runIdentityHash** = experimentIdentityHash + executionEnvironmentHash
  + причинный журнал команд (commandSeq, commandId, body,
  requestedTick|scheduledTick — **не схлопываются**, commandOutcome,
  resolvedTick, kernelFactId).
- **runIdentityClass** — causal-confirmed | causal-indeterminate.
  Сравнения разрешены только между confirmed.

**НЕ входят в идентичность:** journalStatus, archiveSeq, archivedAt,
retries, ошибки backend, repair-попытки, seal, audit.

## Команды: две независимые оси

```
commandOutcome: PENDING → APPLIED | REJECTED | FAILED_BY_KERNEL | OUTCOME_UNKNOWN
journalStatus:  RECORDED → RESULT_RECORDED | RESULT_MISSING
```

Судьба backend не окрашивает физическую идентичность прогона.
Fail-closed: команда пишется до применения; нет журнала — нет
применения. APPLIED/REJECTED невозможны без подтверждающего факта ядра.

## Три оси статуса запуска

```
runExecutionStatus: RUNNING | COMPLETED | ABORTED
runSealStatus:      OPEN | SEALED | UNSEALED
auditStatus:        COMPLETE | INCOMPLETE
```

SEALED разрешён при COMPLETED **и** ABORTED (для ABORTED обязательны
terminationReason, terminalTick, верифицированный checkpoint или явное
обоснование его отсутствия). SEALED запрещён при OUTCOME_UNKNOWN,
RESULT_MISSING, PENDING или нарушениях согласованности. UNSEALED
терминален. auditStatus пересчитывается читателем, не читается.

## Полнота летописи ≠ идентичность входов

Потеря факта не меняет runIdentityHash, но даёт INCOMPLETE. Dropped
snapshots — штатный транспорт, не потеря фактов. RESULT_MISSING — вопрос
seal, не audit. Единый булев флаг вместо manifest запрещён.

## Repair

Только повторная выдача уже порождённого факта из детерминированного
источника: не вызывает step, не меняет состояние, стабильный factId,
идемпотентная запись, сверка content identity против producer evidence.
Реконструкция анализатором или перепрогон ядра — запрещены (это вывод, а
не факт). Permanent-пропуск никогда не маскируется.
