# 데이터 처리 기준과 화면 공통 계약

이 문서는 계산 로직과 화면이 같은 행 집합, 집계 순서, 필터 결과를 사용하도록 입력·검증·표시·내보내기 규칙을 고정한다. 원본 CSV는 `data/programs/2024.csv`, `2025.csv`, `2026.csv`이며, 오류 확인 자료는 연도별 하위 폴더가 아닌 `data/programs/errors.csv` 한 파일이다.

## 입력 행과 파싱

정규화된 데이터 행은 다음 필드를 갖는다.

`{ year, id, name, field, region, participants, completers, source, line }`

`year`, `id`, `name`, `field`, `region`, `source`는 문자열로 보존한다. `participants`, `completers`는 정수로 읽으며 빈 칸이나 정수로 해석할 수 없는 값은 `null`로 둔다. 음수와 소수는 값 자체를 보존해 검증에서 제외 사유를 기록한다. `source`는 파일명 또는 호출자가 제공한 자료 식별자이고, `line`은 CSV의 실제 1-based 줄 번호다(헤더가 1행이면 첫 데이터 행은 2행). CSV 파서는 따옴표로 감싼 쉼표·따옴표·개행을 처리해야 한다.

```js
parseCsv(text, source) -> rows
```

파서는 헤더를 `연도,사업ID,사업명,분야,지역,참여자수,수료자수` 순서로 읽어 정규화 행으로 만든다. `source`와 원본 줄 번호는 오류를 화면에 표시할 수 있도록 항상 붙인다.

## 검증과 제외

```js
validateRows(rows) -> {
  validRows,
  rejectedRows: [{ row, reasonCode, reason }]
}
```

검증은 입력 순서를 유지하며 다음 순서로 수행한다.

1. 필수 식별·표시값(year, id, name, field, region)과 참여자·수료자 숫자가 있어야 한다. 숫자 누락/해석 불가, 음수, 정수가 아닌 값은 제외한다.
2. 참여자와 수료자는 0 이상의 정수여야 한다.
3. 수료자는 참여자보다 클 수 없다.
4. 위 검증을 통과한 행에 한해 `(year, id)` 중복을 확인한다. 같은 키의 첫 유효 행만 남기고 이후 행을 `duplicate`로 제외한다. 앞선 행이 다른 사유로 제외됐다면 뒤의 유효 행이 키를 차지한다.
5. 참여자·수료자가 모두 0인 행은 유효 행에 남긴다. 개별 수료율과 주의 판정은 `null`/계산 불가로 표현한다.

`reasonCode`는 기계적으로 분기할 수 있는 안정된 값으로 `missing_value`, `invalid_number`, `negative_count`, `non_integer_count`, `completers_exceed_participants`, `duplicate`를 사용한다. 사용자에게 보여줄 `reason`은 한국어 설명이다. 한 행에 사유가 여러 개면 위 순서에서 처음 발견된 사유 하나를 기록한다.

수료율은 행 또는 집계마다 `completers / participants * 100`으로 산출한다. 참여자 합계가 0이면 수료율은 `null`이다. 주의는 계산 가능한 수료율이 임계값보다 엄격히 낮을 때만 해당한다. 기본 임계값은 70이며, 정확히 70%는 주의가 아니다. 임계값 80에서는 75%가 주의이고 정확히 80%는 주의가 아니다. 화면에는 적절한 자릿수로 반올림해 보여도 비교 및 CSV 계산은 반올림 전 값을 사용한다.

## 공통 계산 계약

```js
buildView(validRows, selectedYears, threshold = 70) -> {
  selectedYears,
  threshold,
  rows,
  summary,
  charts,
  tableRows,
  csvRows
}
```

`validRows`는 `validateRows`에서 나온 전체 유효 행이다. `selectedYears`는 선택된 연도 문자열 배열이며, 선택 결과에 없는 연도는 화면 자료에서 제외한다. 기본 선택은 입력에 있는 모든 연도다. 빈 선택은 0행 결과다. 집계·차트·상세 표·CSV는 모두 동일하게 필터된 `rows`를 사용한다. 연도 선택 상태의 순서와 비교 없이 임의로 일부 화면에 전체 연도를 섞지 않는다. 차트 축/범례는 필터 뒤에도 색이 바뀌지 않도록 고정 분류 색상을 사용한다.

`summary`의 6개 요약 값은 같은 필터 `rows`에서 산출하며, 이 6개만 요약 카드로 표시한다.

- `participants`: 참여자 합계
- `completers`: 수료자 합계
- `completionRate`: 합계 수료자 ÷ 합계 참여자 × 100, 분모 0이면 `null`
- `programCount`: 필터 결과의 고유 사업 ID 수
- `selectedYearCount`: 선택된 연도 수(`selectedYears.length`)
- `cautionCount`: 계산 가능한 행 중 수료율이 `threshold` 미만인 행 수

`validRowCount`(필터 결과 행 수)와 `uncalculableCount`(참여자 0명 행 수)는 필요하면 보조 필드로 제공할 수 있지만, 6개 요약 카드에 포함하지 않는다.

`charts`는 3종을 제공한다.

- `fieldShare`: 분야별 참여 비중 파이. 항목은 `{ key: field, participants, share, color }`; `share`는 전체 참여자 합계 대비 비율이며 전체가 0이면 `null`. 분야별 색상은 분야 키마다 고정한다.
- `programComparison`: 사업별 참여·수료 비교 막대. 선택 연도들의 같은 사업 ID를 합산해 `{ id, name, participants, completers }`로 제공한다. 참여자/수료자 계열의 색은 각각 고정한다.
- `yearlyCompletion`: 연도별 수료율 추이 꺾은선. 선택 연도마다 `{ year, participants, completers, completionRate }`를 제공하고 분모가 0이면 `completionRate: null`로 둔다. 연도 오름차순을 유지한다.

모든 차트 데이터에는 UI가 제목, 단위, 범례, 값, 계산 불가/빈 상태 안내를 붙일 수 있도록 위의 이름 있는 값이 포함된다. 분야별 참여 비중의 분모는 선택 연도 전체 참여자 합계다.

`tableRows`와 `csvRows`는 같은 `rows`의 같은 순서와 같은 사업 값을 갖는다. 표의 각 데이터 행에는 원본 필드 외에 `completionRate`와 `status`를 계산해 붙일 수 있다. `status`는 `caution`, `ok`, `uncalculable` 중 하나이며, 0명은 `uncalculable`이다.

```js
exportCsv(rows) -> csvText
```

`exportCsv`는 유효하고 현재 선택 연도로 필터된 행 배열을 받는다. 출력 열과 순서는 원본 CSV와 동일한 `연도,사업ID,사업명,분야,지역,참여자수,수료자수`다. 계산 열, 출처, 줄 번호, 제외 행은 통합 CSV에 추가하지 않는다. 콤마·따옴표·개행이 있는 문자열은 표준 CSV 인용 규칙으로 이스케이프한다. 파일을 한글 스프레드시트에서 열 수 있도록 UTF-8 BOM을 붙이는 구현을 권장한다. 유효 행이 0개여도 헤더를 출력한다.

`rejectedRows`는 오류 설명 UI에 사용하며, 통합 표·집계·차트·CSV에 들어가지 않는다. 정상 파일과 오류 파일은 함께 합쳐 검증하지 않고 각각 검증해 결과를 확인한다.

## 기대값

정상 자료를 모두 읽으면 2024·2025·2026년 각 6행으로 총 18행이며, `(year, id)` 기준 유효 사업 행은 18개다. 참여자 합계는 1,410명, 수료자 합계는 1,171명이고, 전체 수료율은 `1171 / 1410 * 100 = 83.04964539007092...%`다. 화면에서 정수 반올림 표시를 쓰면 83%다. 단순 사업별 수료율 평균을 사용하지 않는다.

`data/programs/errors.csv`의 첫 번째 `2024/X01` 행을 남기며 두 번째 중복 행, 참여자 누락 행, 수료자가 참여자를 초과한 행을 제외한다. `2024/X03` 0명 행은 유효하게 남긴다. 따라서 유효 2행, 제외 3행, 참여자 20명, 수료자 15명, 전체 수료율 75%다. X03의 개별 수료율과 판정은 계산 불가다. 임계값 70에서 X01은 주의가 아니며, 임계값 80에서는 X01이 주의다.

선택 연도를 변경하면 요약 6개, 차트 3개, 표 행, CSV 행의 원천은 같은 필터 행 집합이어야 한다. 정상 전체 연도 선택의 상세 표 및 CSV 데이터는 18행이며, 오류 자료의 제외 3행은 그 결과에 포함되지 않는다.

\n