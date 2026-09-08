'use strict';

/**
 * 토스 입금 알림에는 "입금자명"이 없고 금액만 표시됩니다.
 * 따라서 각 충전 요청마다 겹치지 않는 고유 금액을 배정하고,
 * 실제 입금된 금액으로 어떤 유저의 요청인지 식별합니다.
 */

// 요청 유효 시간 (기본 30분)
const REQUEST_TTL_MS = Number(process.env.DEPOSIT_REQUEST_TTL_MS) || 30 * 60 * 1000;

// 금액 충돌 시 붙일 수 있는 최대 추가 원(1~MAX_OFFSET)
const MAX_OFFSET = Number(process.env.DEPOSIT_MAX_OFFSET) || 99;

/**
 * @typedef {object} DepositRequest
 * @property {string} userId
 * @property {string} username
 * @property {number} requestedAmount 유저가 입력한 금액
 * @property {number} depositAmount 실제 입금해야 하는 고유 금액
 * @property {number} createdAt
 * @property {number} expiresAt
 */

/** @type {Map<number, DepositRequest>} depositAmount -> 요청 */
const pendingByAmount = new Map();

function now() {
  return Date.now();
}

/** 만료된 요청을 정리합니다. */
function pruneExpired() {
  const current = now();
  for (const [amount, request] of pendingByAmount) {
    if (request.expiresAt <= current) {
      pendingByAmount.delete(amount);
    }
  }
}

/** 특정 유저의 기존 대기 요청을 모두 취소합니다. */
function cancelUserRequests(userId) {
  for (const [amount, request] of pendingByAmount) {
    if (request.userId === userId) {
      pendingByAmount.delete(amount);
    }
  }
}

/**
 * 충돌하지 않는 고유 입금 금액을 찾습니다.
 * base부터 시작해 필요하면 1~MAX_OFFSET원을 더해 봅니다.
 * @param {number} base
 * @returns {number | null}
 */
function findUniqueAmount(base) {
  if (!pendingByAmount.has(base)) {
    return base;
  }

  for (let offset = 1; offset <= MAX_OFFSET; offset += 1) {
    const candidate = base + offset;
    if (!pendingByAmount.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * 새로운 충전 요청을 생성합니다.
 * @param {string} userId
 * @param {string} username
 * @param {number} requestedAmount
 * @returns {{ status: 'ok', request: DepositRequest } | { status: 'invalid' | 'full' }}
 */
function createRequest(userId, username, requestedAmount) {
  pruneExpired();

  if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) {
    return { status: 'invalid' };
  }

  // 같은 유저의 이전 요청은 새 요청으로 대체합니다.
  cancelUserRequests(userId);

  const depositAmount = findUniqueAmount(requestedAmount);
  if (depositAmount === null) {
    return { status: 'full' };
  }

  const createdAt = now();
  /** @type {DepositRequest} */
  const request = {
    userId,
    username,
    requestedAmount,
    depositAmount,
    createdAt,
    expiresAt: createdAt + REQUEST_TTL_MS,
  };

  pendingByAmount.set(depositAmount, request);
  return { status: 'ok', request };
}

/**
 * 입금된 금액과 일치하는 대기 요청을 찾아 소비합니다.
 * @param {number} amount
 * @returns {DepositRequest | null}
 */
function matchDeposit(amount) {
  pruneExpired();

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }

  const request = pendingByAmount.get(amount);
  if (!request) {
    return null;
  }

  pendingByAmount.delete(amount);
  return request;
}

/** 현재 대기중인 요청 수 (진단용) */
function pendingCount() {
  pruneExpired();
  return pendingByAmount.size;
}

module.exports = {
  createRequest,
  matchDeposit,
  cancelUserRequests,
  pendingCount,
  REQUEST_TTL_MS,
};
