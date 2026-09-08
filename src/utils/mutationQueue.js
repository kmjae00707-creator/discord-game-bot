'use strict';

/**
 * 잔액(원)·gppoint·재고 등 여러 데이터 파일을 건드리는 변경 작업을
 * 하나의 큐로 직렬화해 동시 실행에 의한 값 유실(race)을 방지합니다.
 */

let queue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
function enqueue(operation) {
  const result = queue.then(operation);
  // 다음 작업이 이전 실패에 막히지 않도록 에러는 삼켜 체인을 유지합니다.
  queue = result.catch(() => {});
  return result;
}

module.exports = { enqueue };
